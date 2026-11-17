package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestFirewallCleanupHasOneBatchBudget(t *testing.T) {
	calls := 0
	f := newFirewall(func(args ...string) (string, error) {
		calls++
		if calls == 1 {
			time.Sleep(20 * time.Millisecond)
			return "table ip filter\n", nil
		}
		return "", errors.New("cleanup continued beyond its deadline")
	})
	f.batchTimeout = 5 * time.Millisecond
	started := time.Now()
	if e := f.close(); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	if calls != 1 || time.Since(started) > time.Second || f.snapshot() != "error" {
		t.Fatal("unbounded or silently successful cleanup", calls)
	}
}

type fakeNft struct {
	present, fail bool
	next          int
	rules         map[string]map[string]string
	calls         []string
}

func newFakeNft() *fakeNft {
	return &fakeNft{present: true, next: 10, rules: map[string]map[string]string{"input": {"1": `tcp dport 8470 accept comment "mgu-updater-web" # handle 1`}, "output": {}}}
}
func (n *fakeNft) run(args ...string) (string, error) {
	n.calls = append(n.calls, strings.Join(args, " "))
	if n.fail {
		return "", errors.New("permission denied")
	}
	if strings.Join(args, " ") == "list tables" {
		if n.present {
			return "table ip filter\n", nil
		}
		return "", nil
	}
	if len(args) == 6 && args[0] == "-a" {
		var lines []string
		for _, r := range n.rules[args[5]] {
			lines = append(lines, r)
		}
		return strings.Join(lines, "\n"), nil
	}
	if len(args) > 6 && args[0] == "insert" {
		n.next++
		h := strconv.Itoa(n.next)
		n.rules[args[4]][h] = strings.Join(args[5:], " ") + " # handle " + h
		return "", nil
	}
	if len(args) == 7 && args[0] == "delete" {
		if args[6] == "1" {
			panic("deleted an unrelated rule")
		}
		delete(n.rules[args[4]], args[6])
		return "", nil
	}
	return "", fmt.Errorf("unexpected nft invocation: %v", args)
}
func (n *fakeNft) count() int {
	count := 0
	for _, rs := range n.rules {
		for _, r := range rs {
			if ownHandle.MatchString(r) {
				count++
			}
		}
	}
	return count
}
func testHotspot() link {
	ip, n, _ := net.ParseCIDR("172.16.222.97/24")
	return link{Name: "wlan_bridge", IP: ip, Network: n}
}

func TestFirewallScopesRulesAndCleansOnlyItsOwn(t *testing.T) {
	n := newFakeNft()
	f := newFirewall(n.run)
	h := testHotspot()
	if e := f.setListeners(&h, 6801, 6811); e != nil {
		t.Fatal(e)
	}
	if f.snapshot() != "scoped" || n.count() != 3 {
		t.Fatal("missing listener rules", f.snapshot(), n.count())
	}
	for _, r := range n.rules["input"] {
		if ownHandle.MatchString(r) && !strings.Contains(r, `iifname "wlan_bridge"`) {
			t.Fatal("rule escaped hotspot", r)
		}
	}
	if e := f.setListeners(nil, 0, 0); e != nil || n.count() != 0 || len(n.rules["input"]) != 1 {
		t.Fatal("disable did not clean only owned rules", e, n.rules)
	}
	for _, cmd := range n.calls {
		if strings.Contains(cmd, "flush") || strings.Contains(cmd, "policy") {
			t.Fatal("global firewall mutation", cmd)
		}
	}
}

func TestFirewallRestoresRulesAfterStockReload(t *testing.T) {
	n := newFakeNft()
	f := newFirewall(n.run)
	h := testHotspot()
	f.setListeners(&h, 6801, 6811)
	n.rules["input"] = map[string]string{}
	n.rules["output"] = map[string]string{}
	if e := f.refresh(); e != nil || n.count() != 3 {
		t.Fatal("reload recovery", e, n.count())
	}
	if e := f.refresh(); e != nil || n.count() != 3 {
		t.Fatal("duplicate rules", e, n.count())
	}
}

func TestFirewallDiscoveryAndGatewayLeasesAreBounded(t *testing.T) {
	n := newFakeNft()
	f := newFirewall(n.run)
	h := testHotspot()
	f.setListeners(&h, 6801, 6811)
	ip, network, _ := net.ParseCIDR("169.254.10.20/16")
	l := link{Name: "socnet0", IP: ip, Network: network}
	release, e := f.acquire(probeRules(l, 43210, 6811))
	if e != nil || n.count() != 5 {
		t.Fatal(e, n.count())
	}
	releaseAgain, e := f.acquire(probeRules(l, 43210, 6811))
	if e != nil || n.count() != 5 {
		t.Fatal("duplicate probe lease", e, n.count())
	}
	release()
	release()
	if n.count() != 5 {
		t.Fatal("shared lease released early")
	}
	releaseAgain()
	if n.count() != 3 {
		t.Fatal("probe rules leaked")
	}
	g := gateway{Address: "169.254.0.2", Local: l.IP.String(), Device: l.Name}
	end, e := f.acquire(gatewayRules(g, 6801))
	if e != nil || n.count() != 5 {
		t.Fatal(e, n.count())
	}
	if e = f.close(); e != nil || n.count() != 0 {
		t.Fatal("shutdown cleanup", e, n.count())
	}
	end()
	if n.count() != 0 {
		t.Fatal("late release reopened firewall")
	}
}

func TestFirewallAbsenceAndCommandFailureAreDistinct(t *testing.T) {
	n := newFakeNft()
	n.present = false
	f := newFirewall(n.run)
	h := testHotspot()
	if e := f.setListeners(&h, 6801, 6811); e != nil || f.snapshot() != "not_present" {
		t.Fatal(e, f.snapshot())
	}
	n.present = true
	n.fail = true
	if e := f.refresh(); e == nil || f.snapshot() != "error" {
		t.Fatal("nft failure treated as absent firewall")
	}
}

func TestHotspotDefaultUsesCarBridge(t *testing.T) {
	c := defaults()
	if c.HotspotInterface != "wlan_bridge" || !c.RequireHotspotAP {
		t.Fatal(c)
	}
}

func TestTASUHelperKeepsRenamedAppIdentity(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "oap_12252")
	if e := os.MkdirAll(filepath.Join(app, "source"), 0700); e != nil {
		t.Fatal(e)
	}
	os.MkdirAll(filepath.Join(app, "someipInterfaces"), 0700)
	os.WriteFile(filepath.Join(app, "source", "package.json"), []byte(`{"name":"noahg_obdbridge"}`), 0600)
	os.WriteFile(filepath.Join(app, "someipInterfaces", "com_harman_infotainment_systemfunctions_tasu_tasu_InternalTasu.json"), []byte(`{}`), 0600)
	found, uid, e := installedApp(root)
	if e != nil || found != app || uid != 12252 {
		t.Fatal(found, uid, e)
	}
}
