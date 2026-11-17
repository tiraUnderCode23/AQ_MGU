package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStatusRespondsWhileFirewallCommandIsBlocked(t *testing.T) {
	s := newService(defaults())
	entered, release := make(chan struct{}), make(chan struct{})
	s.firewall = newFirewall(func(...string) (string, error) {
		close(entered)
		<-release
		return "", nil
	})
	done := make(chan error, 1)
	go func() { done <- s.firewall.refresh() }()
	<-entered
	defer func() {
		close(release)
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	response := httptest.NewRecorder()
	answered := make(chan struct{})
	go func() {
		s.controlHandler().ServeHTTP(response, httptest.NewRequest("GET", "/status", nil))
		close(answered)
	}()
	select {
	case <-answered:
	case <-time.After(time.Second):
		t.Fatal("control status waited for the firewall command")
	}
	var state status
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &state) != nil || state.Firewall != "updating" {
		t.Fatal(response.Code, response.Body.String())
	}
}
