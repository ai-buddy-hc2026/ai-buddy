package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
)

func TestServeAndShutdown(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	go func() { result <- Serve(ctx, listener, httpapi.NewHandler(logger, nil, nil), logger) }()
	client := &http.Client{Timeout: 3 * time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Get("http://" + listener.Addr().String() + "/health")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || string(body) != "{\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected response: %d %s", response.StatusCode, body)
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not shut down")
	}
	if _, err := client.Get("http://" + listener.Addr().String() + "/health"); err == nil {
		t.Fatal("server still accepts connections after shutdown")
	}
}

func TestServeListenerError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Serve(context.Background(), listener, http.NotFoundHandler(), slog.New(slog.NewJSONHandler(io.Discard, nil))); err == nil {
		t.Fatal("expected closed listener to fail")
	}
}

func TestShutdownDrainsActiveRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	release := make(chan struct{})
	releaseRequest := sync.OnceFunc(func() { close(release) })
	defer releaseRequest()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	result := make(chan error, 1)
	go func() { result <- Serve(ctx, listener, handler, slog.New(slog.NewJSONHandler(io.Discard, nil))) }()
	client := &http.Client{Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	responseResult := make(chan error, 1)
	go func() {
		response, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			err = response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				err = errors.New("active request did not complete normally")
			}
		}
		responseResult <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not reach handler")
	}
	cancel()
	select {
	case err := <-result:
		t.Fatalf("server exited before active request completed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	releaseRequest()
	select {
	case err := <-responseResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("active request did not finish")
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not finish graceful shutdown")
	}
}

func TestShutdownTimeoutClosesActiveRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	requestCancelled := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(requestCancelled)
	})
	result := make(chan error, 1)
	go func() { result <- Serve(ctx, listener, handler, slog.New(slog.NewJSONHandler(io.Discard, nil))) }()
	client := &http.Client{Timeout: 15 * time.Second}
	defer client.CloseIdleConnections()
	responseResult := make(chan error, 1)
	go func() {
		response, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			if closeErr := response.Body.Close(); closeErr != nil {
				t.Error(closeErr)
			}
		}
		responseResult <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not reach handler")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected shutdown deadline, got %v", err)
		}
	case <-time.After(13 * time.Second):
		t.Fatal("server did not force close after shutdown deadline")
	}
	select {
	case <-requestCancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("force close did not cancel the active request")
	}
	select {
	case err := <-responseResult:
		if err == nil {
			t.Fatal("expected connection to be closed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("client remained connected after force close")
	}
}
