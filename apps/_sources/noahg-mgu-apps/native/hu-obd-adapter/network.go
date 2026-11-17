package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

type link struct {
	Name    string
	IP      net.IP
	Network *net.IPNet
	Index   int
}
type gateway struct {
	Address, Local, Device string
	Identification         []byte
	Backend                string
}

func links(prefixes []string) []link {
	var out []link
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		match := false
		for _, p := range prefixes {
			if i.Name == p || strings.HasPrefix(i.Name, p+".") {
				match = true
			}
		}
		if !match {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ip, n, e := net.ParseCIDR(a.String())
			if e == nil && ip.To4() != nil && !ip.IsLoopback() {
				out = append(out, link{i.Name, ip.To4(), n, i.Index})
			}
		}
	}
	return out
}

var errFirewall = errors.New("diagnostic firewall access failed")

func discover(ctx context.Context, routes []link, port int, timeout time.Duration, fw *firewall) (gateway, error) {
	type result struct {
		g   gateway
		err error
	}
	results := make(chan result, len(routes))
	for _, route := range routes {
		go func(l link) {
			var found gateway
			pc, err := listenPacket(ctx, l.Name, net.JoinHostPort(l.IP.String(), "0"))
			if err != nil {
				results <- result{err: err}
				return
			}
			defer pc.Close()
			if fw != nil {
				release, e := fw.acquire(probeRules(l, pc.LocalAddr().(*net.UDPAddr).Port, port))
				if e != nil {
					results <- result{err: fmt.Errorf("%w: %v", errFirewall, e)}
					return
				}
				defer release()
			}
			if ctx.Err() != nil {
				results <- result{err: ctx.Err()}
				return
			}
			go func() {
				select {
				case <-ctx.Done():
					pc.Close()
				case <-time.After(timeout):
				}
			}()
			pc.SetDeadline(time.Now().Add(timeout))
			broadcast := append(net.IP(nil), l.IP...)
			for i := range broadcast {
				broadcast[i] |= ^l.Network.Mask[i]
			}
			_, err = pc.WriteTo(discoveryProbe, &net.UDPAddr{IP: broadcast, Port: port})
			if err != nil {
				results <- result{err: err}
				return
			}
			buf := make([]byte, 4096)
			for {
				n, addr, e := pc.ReadFrom(buf)
				if e != nil {
					break
				}
				u, ok := addr.(*net.UDPAddr)
				if !ok || u.Port != port || u.IP.Equal(l.IP) || !l.Network.Contains(u.IP) {
					continue
				}
				if _, ok := identification(buf[:n]); !ok {
					continue
				}
				if found.Address != "" && found.Address != u.IP.String() {
					results <- result{err: errors.New("multiple diagnostic gateways")}
					return
				}
				found = gateway{Address: u.IP.String(), Local: l.IP.String(), Device: l.Name, Identification: append([]byte(nil), buf[:n]...)}
			}
			if found.Address == "" {
				results <- result{err: errors.New("no gateway identification reply")}
				return
			}
			results <- result{g: found}
		}(route)
	}
	var found gateway
	var firewallFailure error
	for range routes {
		r := <-results
		if errors.Is(r.err, errFirewall) {
			firewallFailure = r.err
		}
		if r.err != nil && r.err.Error() == "multiple diagnostic gateways" {
			return gateway{}, r.err
		}
		if r.g.Address == "" {
			continue
		}
		if found.Address != "" && (found.Address != r.g.Address || found.Device != r.g.Device) {
			return gateway{}, errors.New("multiple diagnostic gateway routes")
		}
		found = r.g
	}
	if found.Address == "" {
		if firewallFailure != nil {
			return gateway{}, firewallFailure
		}
		return gateway{}, errors.New("no reachable ENET gateway; TASU validation required")
	}
	return found, nil
}

func dialGateway(ctx context.Context, g gateway, port int) (net.Conn, error) {
	d := net.Dialer{Timeout: 3 * time.Second, LocalAddr: &net.TCPAddr{IP: net.ParseIP(g.Local)}, Control: socketControl(g.Device)}
	return d.DialContext(ctx, "tcp4", net.JoinHostPort(g.Address, itoa(port)))
}
