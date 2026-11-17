package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

type vehicle interface {
	ReadFrame() ([]byte, error)
	WriteFrame([]byte) error
	Close() error
}

type gatewaySession struct{ net.Conn }

type leasedVehicle struct {
	vehicle
	release func()
	once    sync.Once
}

func (v *leasedVehicle) Close() error { e := v.vehicle.Close(); v.once.Do(v.release); return e }

func (g gatewaySession) ReadFrame() ([]byte, error) { return readFrame(g.Conn) }
func (g gatewaySession) WriteFrame(b []byte) error {
	g.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return writeAll(g.Conn, b)
}

func writeAll(w io.Writer, b []byte) error {
	for len(b) != 0 {
		n, e := w.Write(b)
		if e != nil {
			return e
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		b = b[n:]
	}
	return nil
}

type status struct {
	TASUTrace            tasuTrace       `json:"tasuTrace"`
	DME                  dmeReadEvidence `json:"dmeReads"`
	LastDeniedIdentifier string          `json:"lastDeniedIdentifier,omitempty"`
	Version              string          `json:"version"`
	Enabled              bool            `json:"enabled"`
	State                string          `json:"state"`
	Hotspot              string          `json:"hotspot"`
	Address              string          `json:"address"`
	Backend              string          `json:"backend"`
	Client               bool            `json:"clientConnected"`
	LastError            string          `json:"lastError,omitempty"`
	Requests             uint64          `json:"requests"`
	Responses            uint64          `json:"responses"`
	Capabilities         []string        `json:"capabilities"`
	Validation           string          `json:"validation"`
	Firewall             string          `json:"firewall"`
	ExpectedHotspot      string          `json:"expectedHotspot"`
	DiscoveryRequests    uint64          `json:"discoveryRequests"`
	DiscoveryReplies     uint64          `json:"discoveryReplies"`
	TASU                 string          `json:"tasu"`
	TASUError            string          `json:"tasuError,omitempty"`
	TASUVINError         string          `json:"tasuVinError,omitempty"`
	TASUVINTarget        string          `json:"tasuVinTarget,omitempty"`
	TASUVINNRC           string          `json:"tasuVinNrc,omitempty"`
	DeniedRequests       uint64          `json:"deniedRequests"`
	LastDeniedService    string          `json:"lastDeniedService,omitempty"`
}

type service struct {
	mu                sync.Mutex
	probeGate         chan struct{}
	config            config
	status            status
	operations        []diagnosticOperation
	events            []event
	current           gateway
	gatewayAt         time.Time
	client            net.Conn
	cancelListeners   context.CancelFunc
	resolve           func(context.Context) (gateway, error)
	open              func(context.Context, gateway) (vehicle, error)
	firewall          *firewall
	tasuMu            sync.Mutex
	tasu              vehicle
	newTASU           func(context.Context) (vehicle, error)
	hotspotMAC        func() (net.HardwareAddr, error)
	tasuContext       context.Context
	vinAttemptTimeout time.Duration
}

type event struct {
	Time string `json:"time"`
	Code string `json:"code"`
}

func newService(c config) *service {
	s := &service{config: c, probeGate: make(chan struct{}, 1), status: status{Version: version, Enabled: true, State: "waiting_hotspot", Backend: "unverified", Capabilities: []string{"bm3_protocol", "diagnostic_reads", "connection_sessions", "dme_metadata_reads", "bounded_dynamic_memory_probe"}, Validation: "BM3 protocol only; compatibility depends on the vehicle and BM3 version"}}
	s.firewall = newFirewall(runNFT)
	s.status.ExpectedHotspot = c.HotspotInterface
	s.newTASU = s.openTASU
	s.hotspotMAC = func() (net.HardwareAddr, error) {
		i, e := net.InterfaceByName(c.HotspotInterface)
		if e != nil {
			return nil, e
		}
		return i.HardwareAddr, nil
	}
	s.resolve = s.resolveVehicle
	s.open = func(ctx context.Context, g gateway) (vehicle, error) {
		if g.Backend == "tasu" {
			return s.ensureTASU(ctx)
		}
		release, e := s.firewall.acquire(gatewayRules(g, c.GatewayPort))
		if e != nil {
			return nil, errFirewall
		}
		n, e := dialGateway(ctx, g, c.GatewayPort)
		if e != nil {
			release()
			return nil, e
		}
		return &leasedVehicle{vehicle: gatewaySession{n}, release: release}, nil
	}
	return s
}

func (s *service) record(code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event{time.Now().UTC().Format(time.RFC3339), code})
	if len(s.events) > 100 {
		s.events = s.events[len(s.events)-100:]
	}
}

func (s *service) fail(code string) {
	s.mu.Lock()
	s.status.LastError = code
	s.mu.Unlock()
	s.record(code)
}

func (s *service) snapshot() status {
	s.mu.Lock()
	st := s.status
	s.mu.Unlock()
	if s.firewall != nil {
		st.Firewall = s.firewall.snapshot()
	}
	return st
}

var errDiagnosticClientActive = errors.New("diagnostic client owns the vehicle response stream")

// This protects readers inside the bridge, not TASU access by other HU apps.
// The cross-process coordinator still releases after each transaction.
func (s *service) lockProbe(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	select {
	case s.probeGate <- struct{}{}:
		if e := ctx.Err(); e != nil {
			s.unlockProbe()
			return e
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *service) unlockProbe()       { <-s.probeGate }
func (s *service) clientActive() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.client != nil }
func (s *service) probe(ctx context.Context, fresh bool) (gateway, error) {
	if s.clientActive() {
		return gateway{}, errDiagnosticClientActive
	}
	if e := s.lockProbe(ctx); e != nil {
		return gateway{}, e
	}
	defer s.unlockProbe()
	if s.clientActive() {
		return gateway{}, errDiagnosticClientActive
	}
	return s.probeLocked(ctx, fresh)
}

func (s *service) probeLocked(ctx context.Context, fresh bool) (gateway, error) {
	if e := ctx.Err(); e != nil {
		return gateway{}, e
	}
	s.mu.Lock()
	if !fresh && s.current.Address != "" && time.Since(s.gatewayAt) < 30*time.Second {
		g := s.current
		s.mu.Unlock()
		return g, nil
	}
	s.mu.Unlock()
	g, e := s.resolve(ctx)
	if e != nil {
		if errors.Is(e, errVehicleUnavailable) {
			s.fail("gateway_and_tasu_unavailable")
		} else if errors.Is(e, errFirewall) {
			s.fail("vehicle_firewall_failed")
		} else {
			s.fail("gateway_unreachable_or_ambiguous")
		}
		return gateway{}, e
	}
	s.mu.Lock()
	s.current = g
	s.gatewayAt = time.Now()
	if g.Backend == "tasu" {
		s.status.Backend = "tasu_vin_verified"
	} else {
		s.status.Backend = "gateway_discovered"
	}
	s.status.LastError = ""
	s.mu.Unlock()
	s.record("gateway_discovered")
	return g, nil
}

func (s *service) run(ctx context.Context) error {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var binding string
	var retryAfter, refreshAfter time.Time
	defer s.firewall.close()
	defer s.stopListeners()
	for {
		st := s.snapshot()
		available := links([]string{s.config.HotspotInterface})
		var h link
		for _, l := range available {
			if l.Name == s.config.HotspotInterface {
				if h.Name != "" {
					h = link{}
					break
				}
				h = l
			}
		}
		key := ""
		if st.Enabled && h.Name != "" {
			ap := true
			if s.config.RequireHotspotAP {
				ap, _ = isHotspotAP(h.Name)
			}
			if ap {
				key = h.Name + "/" + h.IP.String() + "/" + itoa(h.Index)
			} else {
				s.mu.Lock()
				s.status.LastError = "hotspot_ap_mode_unavailable"
				s.mu.Unlock()
			}
		}
		if key != binding && (key == "" || time.Now().After(retryAfter)) {
			s.stopListeners()
			binding = ""
			if key != "" {
				if e := s.startListeners(ctx, h); e != nil {
					if errors.Is(e, errFirewall) {
						s.fail("hotspot_firewall_failed")
					} else {
						s.fail("hotspot_bind_failed")
					}
					s.mu.Lock()
					s.status.State = "network_error"
					s.mu.Unlock()
					retryAfter = time.Now().Add(5 * time.Second)
				} else {
					binding = key
					refreshAfter = time.Now().Add(30 * time.Second)
				}
			}
		}
		if binding != "" && time.Now().After(refreshAfter) {
			if e := s.firewall.refresh(); e != nil {
				s.stopListeners()
				binding = ""
				retryAfter = time.Now().Add(5 * time.Second)
				s.fail("hotspot_firewall_failed")
				s.mu.Lock()
				s.status.State = "network_error"
				s.mu.Unlock()
			}
			refreshAfter = time.Now().Add(30 * time.Second)
		}
		// A disable/re-enable between ticks still needs to recreate listeners.
		if key != "" && key == binding {
			s.mu.Lock()
			stopped := s.cancelListeners == nil
			s.mu.Unlock()
			if stopped {
				binding = ""
			}
		}
		if key == "" {
			s.mu.Lock()
			if s.status.Enabled {
				s.status.State = "waiting_hotspot"
			} else {
				s.status.State = "disabled"
			}
			s.mu.Unlock()
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}

func (s *service) stopListeners() {
	s.mu.Lock()
	cancel := s.cancelListeners
	s.cancelListeners = nil
	c := s.client
	s.status.Address = ""
	s.status.Hotspot = ""
	s.current = gateway{}
	s.status.Backend = "unverified"
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if c != nil {
		c.Close()
	}
	s.closeTASU()
	if s.firewall != nil {
		if e := s.firewall.setListeners(nil, 0, 0); e != nil {
			s.fail("firewall_cleanup_failed")
		}
	}
}

func (s *service) startListeners(parent context.Context, h link) error {
	ctx, cancel := context.WithCancel(parent)
	lc := net.ListenConfig{Control: socketControl(h.Name)}
	tcp, e := lc.Listen(ctx, "tcp4", net.JoinHostPort(h.IP.String(), itoa(s.config.TCPPort)))
	if e != nil {
		cancel()
		return e
	}
	udp, e := listenPacket(ctx, h.Name, net.JoinHostPort("0.0.0.0", itoa(s.config.DiscoveryPort)))
	if e != nil {
		tcp.Close()
		cancel()
		return e
	}
	if s.firewall != nil {
		if e = s.firewall.setListeners(&h, s.config.TCPPort, s.config.DiscoveryPort); e != nil {
			tcp.Close()
			udp.Close()
			cancel()
			s.firewall.setListeners(nil, 0, 0)
			return errFirewall
		}
	}
	s.mu.Lock()
	s.tasuContext = ctx
	s.cancelListeners = cancel
	s.status.Address = tcp.Addr().String()
	s.status.Hotspot = h.Name
	s.status.State = "listening_unverified"
	s.status.LastError = ""
	s.mu.Unlock()
	s.record("hotspot_listening")
	go func() { <-ctx.Done(); tcp.Close(); udp.Close() }()
	go s.serveTCP(ctx, tcp, h.Network)
	go s.serveDiscovery(ctx, udp, h.Network)
	if s.tasuAllowed() {
		go func() {
			_, e := s.ensureTASU(ctx)
			if e != nil && ctx.Err() == nil {
				s.record("tasu_helper_unavailable")
			}
		}()
	}
	return nil
}

func peerInNetwork(addr net.Addr, n *net.IPNet) bool {
	if n == nil {
		return false
	}
	h, _, e := net.SplitHostPort(addr.String())
	return e == nil && n.Contains(net.ParseIP(h))
}

func (s *service) serveDiscovery(ctx context.Context, pc net.PacketConn, network *net.IPNet) {
	defer pc.Close()
	buf := make([]byte, 4096)
	var last time.Time
	for {
		n, addr, e := pc.ReadFrom(buf)
		if e != nil {
			return
		}
		if n != len(discoveryProbe) || string(buf[:n]) != string(discoveryProbe) || !peerInNetwork(addr, network) {
			continue
		}
		s.mu.Lock()
		busy := s.client != nil
		enabled := s.status.Enabled
		s.mu.Unlock()
		if busy || !enabled || time.Since(last) < time.Second {
			continue
		}
		s.mu.Lock()
		s.status.DiscoveryRequests++
		s.mu.Unlock()
		last = time.Now()
		// Only a client-triggered request reaches the vehicle. No discovery polling.
		g, e := s.probe(ctx, false)
		if e == nil {
			if _, e = pc.WriteTo(g.Identification, addr); e == nil {
				s.mu.Lock()
				s.status.DiscoveryReplies++
				s.mu.Unlock()
			}
		}
	}
}

func (s *service) serveTCP(ctx context.Context, ln net.Listener, network *net.IPNet) {
	defer ln.Close()
	for {
		c, e := ln.Accept()
		if e != nil {
			return
		}
		if !peerInNetwork(c.RemoteAddr(), network) {
			c.Close()
			continue
		}
		s.mu.Lock()
		if !s.status.Enabled || s.client != nil {
			s.mu.Unlock()
			c.Close()
			continue
		}
		s.client = c
		s.status.Client = true
		s.status.DME = dmeReadEvidence{}
		s.status.LastDeniedService = ""
		s.status.LastDeniedIdentifier = ""
		s.status.LastError = ""
		s.operations = nil
		s.status.State = "connecting_vehicle"
		s.mu.Unlock()
		go s.handleClient(ctx, c)
	}
}

func (s *service) handleClient(parent context.Context, c net.Conn) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer func() {
		c.Close()
		s.mu.Lock()
		if s.client == c {
			s.client = nil
			s.status.Client = false
			if s.status.Enabled {
				if s.status.Address != "" {
					s.status.State = "listening_unverified"
				} else {
					s.status.State = "waiting_hotspot"
				}
			} else {
				s.status.State = "disabled"
			}
		}
		s.mu.Unlock()
		s.record("client_disconnected")
		if s.tasuAllowed() && parent.Err() == nil {
			go func() { s.ensureTASU(parent) }()
		}
	}()
	go func() { <-ctx.Done(); c.Close() }()
	if e := s.lockProbe(ctx); e != nil {
		return
	}
	defer s.unlockProbe()
	g, e := s.probeLocked(ctx, false)
	var v vehicle
	if e == nil {
		v, e = s.open(ctx, g)
	}
	if e != nil && s.tasuAllowed() {
		g, e = s.discoverTASU(ctx)
		if e == nil {
			v, e = s.ensureTASU(ctx)
		}
	}
	if e != nil {
		s.fail("vehicle_transport_unavailable")
		return
	}
	defer v.Close()
	s.mu.Lock()
	s.status.State = "connected_unverified"
	s.mu.Unlock()
	s.record("client_connected")
	if e := s.relay(ctx, c, v, tasuGatewayVIN(g)); e != nil && !errors.Is(e, io.EOF) {
		s.fail("session_closed_transport_or_operation_error")
	}
}

func (s *service) relay(ctx context.Context, c net.Conn, v vehicle, localVIN ...string) error {
	done := make(chan error, 2)
	pendingReads := make(map[byte]byte)
	var writer sync.Mutex
	writeClient := func(frames ...[]byte) error {
		writer.Lock()
		defer writer.Unlock()
		c.SetWriteDeadline(time.Now().Add(10 * time.Second))
		for _, b := range frames {
			if e := writeAll(c, b); e != nil {
				return e
			}
		}
		return nil
	}
	activity := func() { c.SetReadDeadline(time.Now().Add(time.Duration(s.config.IdleTimeoutSeconds) * time.Second)) }
	activity()
	go func() {
		for {
			b, e := readFrame(c)
			if e != nil {
				done <- e
				return
			}
			if e = checkRequest(b); e != nil {
				var denied requestDenied
				if errors.As(e, &denied) {
					s.mu.Lock()
					s.status.DeniedRequests++
					s.status.LastDeniedIdentifier = ""
					if len(b) >= 12 && (b[8] == 0x31 || b[8] == 0x2c) {
						s.status.LastDeniedIdentifier = fmt.Sprintf("0x%04X", binary.BigEndian.Uint16(b[10:12]))
					}
					s.status.LastDeniedService = fmt.Sprintf("0x%02X", b[8])
					s.mu.Unlock()
					s.logOperation(b, "request", "blocked")
					s.record("operation_unavailable")
					activity()
					if e = writeClient(frame(2, b[6:]), frame(1, []byte{b[7], b[6], 0x7f, b[8], denied.nrc})); e == nil {
						continue
					}
				}
				s.record("operation_unvalidated_or_malformed")
				done <- e
				return
			}
			activity()
			if len(b) == 11 && len(localVIN) == 1 && validVIN(localVIN[0]) && bytes.Equal(b[7:], []byte{0x10, 0x22, 0xf1, 0x90}) {
				s.logOperation(b, "request", "gateway_vin_cache")
				// TASU exposes a virtual ENET gateway. Its VIN is the same real
				// vehicle VIN already validated during this discovery session.
				response := frame(1, append([]byte{0x10, b[6], 0x62, 0xf1, 0x90}, []byte(localVIN[0])...))
				if e = writeClient(frame(2, b[6:]), response); e != nil {
					done <- e
					return
				}
				s.mu.Lock()
				s.status.Requests++
				s.status.Responses++
				s.mu.Unlock()
				continue
			}
			s.noteDMERequest(pendingReads, b)
			s.logOperation(b, "request", "allowed")
			if e = v.WriteFrame(b); e != nil {
				done <- e
				return
			}
			s.mu.Lock()
			s.status.Requests++
			s.mu.Unlock()
		}
	}()
	go func() {
		for {
			b, e := v.ReadFrame()
			if e != nil {
				done <- e
				return
			}
			activity()
			s.noteDMEReply(pendingReads, b)
			s.logOperation(b, "response", "received")
			if e = writeClient(b); e != nil {
				done <- e
				return
			}
			if binary.BigEndian.Uint16(b[4:]) == 1 {
				s.mu.Lock()
				s.status.Responses++
				s.mu.Unlock()
			}
		}
	}()
	var err error
	received := 0
	select {
	case err = <-done:
		received = 1
	case <-ctx.Done():
		err = ctx.Err()
	}
	c.Close()
	v.Close()
	// Both pumps terminate when their transports close; no session survives a
	// disconnect and no diagnostic write is ever retried automatically.
	for ; received < 2; received++ {
		<-done
	}
	return err
}
