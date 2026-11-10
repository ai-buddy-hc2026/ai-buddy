package main

import (
	"net"
	"strconv"
	"testing"
)

func TestRunInvalidConfig(t *testing.T) {
	t.Setenv("PORT", "invalid")
	if err := run(); err == nil {
		t.Fatal("expected invalid configuration to stop startup")
	}
}

func TestRunAddressInUse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := listener.Close(); err != nil {
			t.Error(err)
		}
	})
	t.Setenv("HOST", "127.0.0.1")
	t.Setenv("PORT", strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	t.Setenv("LOG_LEVEL", "INFO")
	if err := run(); err == nil {
		t.Fatal("expected occupied port to stop startup")
	}
}
