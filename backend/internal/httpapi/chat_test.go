package httpapi

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
)

func TestLastEventID(t *testing.T) {
	id := "20000000-0000-0000-0000-000000000001"
	for _, tc := range []struct {
		name    string
		values  []string
		want    int
		invalid bool
	}{
		{"absent", nil, 0, false},
		{"valid", []string{id + ":7"}, 7, false},
		{"empty", []string{""}, 0, true},
		{"duplicate", []string{id + ":1", id + ":2"}, 0, true},
		{"foreign", []string{"20000000-0000-0000-0000-000000000002:1"}, 0, true},
		{"zero", []string{id + ":0"}, 0, true},
		{"leading-zero", []string{id + ":01"}, 0, true},
		{"negative", []string{id + ":-1"}, 0, true},
		{"overflow", []string{id + ":2147483648"}, 0, true},
		{"extra", []string{id + ":1:2"}, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			for _, value := range tc.values {
				req.Header.Add("Last-Event-ID", value)
			}
			got, err := lastEventID(req, id)
			if (err != nil) != tc.invalid || got != tc.want {
				t.Fatalf("got %d, %v", got, err)
			}
		})
	}
}

func TestSSEHeartbeatAndClientDisconnect(t *testing.T) {
	finished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(finished)
		serveFeed(w, r, &chat.Feed{}, 0, 10*time.Millisecond)
	}))
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatal("proxy buffering enabled")
	}
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() || scanner.Text() != ": ping" {
		t.Fatal("heartbeat missing", scanner.Err())
	}
	_ = response.Body.Close()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("disconnected SSE handler did not exit")
	}
}
