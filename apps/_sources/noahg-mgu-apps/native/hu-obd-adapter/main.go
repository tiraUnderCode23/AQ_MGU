package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const version = "1.0.0"

type config struct {
	RequireHotspotAP   bool     `json:"requireHotspotAP"`
	HotspotInterface   string   `json:"hotspotInterface"`
	VehicleInterfaces  []string `json:"vehicleInterfaces"`
	TCPPort            int      `json:"tcpPort"`
	DiscoveryPort      int      `json:"discoveryPort"`
	GatewayPort        int      `json:"gatewayPort"`
	DiscoveryTimeoutMS int      `json:"discoveryTimeoutMs"`
	IdleTimeoutSeconds int      `json:"idleTimeoutSeconds"`
	ExperimentalTASU   bool     `json:"experimentalTasu"`
	TASUFallback       bool     `json:"tasuFallback"`
	OAPDirectory       string   `json:"oapDirectory"`
	ControlSocket      string   `json:"controlSocket"`
	StateFile          string   `json:"stateFile"`
	AppGID             int      `json:"appGid"`
}

func defaults() config {
	return config{RequireHotspotAP: true, HotspotInterface: "wlan_bridge", VehicleInterfaces: []string{"socnet0", "vlan73"}, TCPPort: 6801, DiscoveryPort: 6811, GatewayPort: 6801, DiscoveryTimeoutMS: 800, IdleTimeoutSeconds: 60, TASUFallback: true, OAPDirectory: "/var/opt/public/oap", ControlSocket: "/run/mgu-obd-adapter/control.sock", StateFile: "/var/opt/mgu-obd-adapter/settings.json", AppGID: 12202}
}
func itoa(i int) string { return strconv.Itoa(i) }

func (c config) validate() error {
	if c.HotspotInterface == "" || len(c.VehicleInterfaces) == 0 {
		return fmt.Errorf("network interfaces required")
	}
	for _, n := range append([]string{c.HotspotInterface}, c.VehicleInterfaces...) {
		if len(n) > 15 {
			return fmt.Errorf("invalid interface")
		}
		for _, r := range n {
			if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-') {
				return fmt.Errorf("invalid interface")
			}
		}
	}
	for _, n := range c.VehicleInterfaces {
		if n == c.HotspotInterface {
			return fmt.Errorf("vehicle and hotspot interfaces must differ")
		}
	}
	for _, p := range []int{c.TCPPort, c.DiscoveryPort, c.GatewayPort} {
		if p < 1 || p > 65535 {
			return fmt.Errorf("invalid port")
		}
	}
	if c.DiscoveryTimeoutMS < 100 || c.DiscoveryTimeoutMS > 5000 || c.IdleTimeoutSeconds < 5 || c.IdleTimeoutSeconds > 600 {
		return fmt.Errorf("invalid timeout")
	}
	abs := func(p string) bool { return strings.HasPrefix(p, "/") || filepath.IsAbs(p) }
	if !abs(c.ControlSocket) || !abs(c.StateFile) || !abs(c.OAPDirectory) || c.AppGID < 1 {
		return fmt.Errorf("invalid local paths or group")
	}
	return nil
}

func main() {
	configPath := flag.String("config", "/var/opt/mgu-obd-adapter/config.json", "root-owned configuration")
	group := flag.Int("app-gid", 12202, "OAP app group")
	showVersion := flag.Bool("version", false, "print version")
	cleanup := flag.Bool("cleanup-firewall", false, "remove only this service's firewall rules")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if *cleanup {
		if e := newFirewall(runNFT).close(); e != nil {
			fmt.Fprintln(os.Stderr, "cannot remove adapter firewall rules:", e)
			os.Exit(1)
		}
		return
	}
	c := defaults()
	if b, e := os.ReadFile(*configPath); e == nil {
		if e = json.Unmarshal(b, &c); e != nil {
			fmt.Fprintln(os.Stderr, "invalid adapter configuration")
			os.Exit(1)
		}
	} else if !os.IsNotExist(e) {
		fmt.Fprintln(os.Stderr, "cannot read adapter configuration")
		os.Exit(1)
	}
	c.AppGID = *group
	if e := c.validate(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	s := newService(c)
	if e := s.loadState(); e != nil {
		fmt.Fprintln(os.Stderr, "cannot read enabled state")
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := s.startControl(ctx); e != nil {
		fmt.Fprintln(os.Stderr, "cannot start local adapter control:", e)
		os.Exit(1)
	}
	if e := s.run(ctx); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
