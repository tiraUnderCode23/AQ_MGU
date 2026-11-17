package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const firewallTag = "mgu-obd-adapter:"

type firewallRule struct {
	chain string
	args  []string
}

func (r firewallRule) key() string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(r.chain+" "+strings.Join(r.args, " "))))[:16]
}

type ownedRule struct {
	rule       firewallRule
	references int
}
type nftRunner func(...string) (string, error)

type firewall struct {
	mu           sync.Mutex
	run          nftRunner
	wanted       map[string]ownedRule
	listeners    []string
	closed       bool
	state        atomic.Value
	batchTimeout time.Duration
}

func runNFT(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, e := exec.CommandContext(ctx, "nft", args...).CombinedOutput()
	if e != nil {
		message := strings.TrimSpace(string(out))
		if len(message) > 256 {
			message = message[:256]
		}
		return "", fmt.Errorf("nft operation failed: %w (%s)", e, message)
	}
	return string(out), nil
}

func newFirewall(run nftRunner) *firewall {
	f := &firewall{run: run, wanted: make(map[string]ownedRule), batchTimeout: 8 * time.Second}
	f.state.Store("unconfigured")
	return f
}

func quoted(s string) string { return `"` + s + `"` }
func hotspotRules(h link, tcp, udp int) []firewallRule {
	return []firewallRule{
		{"input", []string{"iifname", quoted(h.Name), "ip", "daddr", h.IP.String(), "tcp", "dport", itoa(tcp), "accept"}},
		{"input", []string{"iifname", quoted(h.Name), "udp", "dport", itoa(udp), "accept"}},
		{"output", []string{"oifname", quoted(h.Name), "ip", "saddr", h.IP.String(), "ip", "daddr", h.Network.String(), "udp", "sport", itoa(udp), "accept"}},
	}
}

func probeRules(l link, localPort, discoveryPort int) []firewallRule {
	return []firewallRule{
		{"input", []string{"iifname", quoted(l.Name), "ip", "saddr", l.Network.String(), "ip", "daddr", l.IP.String(), "udp", "sport", itoa(discoveryPort), "udp", "dport", itoa(localPort), "accept"}},
		{"output", []string{"oifname", quoted(l.Name), "ip", "saddr", l.IP.String(), "ip", "daddr", l.Network.String(), "udp", "sport", itoa(localPort), "udp", "dport", itoa(discoveryPort), "accept"}},
	}
}

func gatewayRules(g gateway, port int) []firewallRule {
	return []firewallRule{
		{"output", []string{"oifname", quoted(g.Device), "ip", "saddr", g.Local, "ip", "daddr", g.Address, "tcp", "dport", itoa(port), "accept"}},
		{"input", []string{"iifname", quoted(g.Device), "ip", "saddr", g.Address, "ip", "daddr", g.Local, "tcp", "sport", itoa(port), "ct", "state", "established", "accept"}},
	}
}

var ownHandle = regexp.MustCompile(`comment "mgu-obd-adapter:([a-f0-9]{16})".*# handle ([0-9]+)`)

func (f *firewall) syncLocked() (err error) {
	f.state.Store("updating")
	defer func() {
		if err != nil {
			f.state.Store("error")
		}
	}()
	// Bound the whole reconciliation, not just each individual nft process.
	// runNFT itself has a three-second process deadline, so an operation
	// already in flight can extend this batch budget by at most three seconds.
	deadline := time.Now().Add(f.batchTimeout)
	run := func(args ...string) (string, error) {
		if !time.Now().Before(deadline) {
			return "", context.DeadlineExceeded
		}
		return f.run(args...)
	}
	// A bare emulator may have no stock table. A failed nft command is not
	// interpreted as an absent firewall unless listing tables confirms it.
	tables, e := run("list", "tables")
	if e != nil {
		return e
	}
	present := false
	for _, line := range strings.Split(tables, "\n") {
		if strings.TrimSpace(line) == "table ip filter" {
			present = true
		}
	}
	if !present {
		f.state.Store("not_present")
		return nil
	}
	for _, chain := range []string{"input", "output"} {
		listed, e := run("-a", "list", "chain", "ip", "filter", chain)
		if e != nil {
			return e
		}
		seen := make(map[string]bool)
		for _, line := range strings.Split(listed, "\n") {
			m := ownHandle.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			want, ok := f.wanted[m[1]]
			if ok && want.rule.chain == chain && !seen[m[1]] {
				seen[m[1]] = true
				continue
			}
			if _, e = run("delete", "rule", "ip", "filter", chain, "handle", m[2]); e != nil {
				return e
			}
		}
		keys := make([]string, 0, len(f.wanted))
		for key, w := range f.wanted {
			if w.rule.chain == chain && !seen[key] {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			args := append([]string{"insert", "rule", "ip", "filter", chain}, f.wanted[key].rule.args...)
			args = append(args, "comment", quoted(firewallTag+key))
			if _, e = run(args...); e != nil {
				return e
			}
		}
	}
	f.state.Store("scoped")
	return nil
}

func (f *firewall) add(rules []firewallRule) []string {
	keys := make([]string, 0, len(rules))
	for _, r := range rules {
		key := r.key()
		v := f.wanted[key]
		v.rule = r
		v.references++
		f.wanted[key] = v
		keys = append(keys, key)
	}
	return keys
}
func (f *firewall) remove(keys []string) {
	for _, key := range keys {
		v, ok := f.wanted[key]
		if !ok {
			continue
		}
		v.references--
		if v.references <= 0 {
			delete(f.wanted, key)
		} else {
			f.wanted[key] = v
		}
	}
}

func (f *firewall) setListeners(h *link, tcp, udp int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.remove(f.listeners)
	f.listeners = nil
	if h != nil {
		f.listeners = f.add(hotspotRules(*h, tcp, udp))
	}
	return f.syncLocked()
}

func (f *firewall) acquire(rules []firewallRule) (func(), error) {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil, fmt.Errorf("firewall closed")
	}
	keys := f.add(rules)
	if e := f.syncLocked(); e != nil {
		f.remove(keys)
		f.syncLocked()
		f.mu.Unlock()
		return nil, e
	}
	f.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			f.mu.Lock()
			defer f.mu.Unlock()
			if !f.closed {
				f.remove(keys)
				f.syncLocked()
			}
		})
	}, nil
}

func (f *firewall) refresh() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	return f.syncLocked()
}
func (f *firewall) snapshot() string {
	if value := f.state.Load(); value != nil {
		return value.(string)
	}
	return "unconfigured"
}
func (f *firewall) close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	f.wanted = make(map[string]ownedRule)
	f.listeners = nil
	return f.syncLocked()
}
