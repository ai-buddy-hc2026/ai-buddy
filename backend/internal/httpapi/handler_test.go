package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutes(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/health", http.StatusOK},
		{http.MethodPost, "/health", http.StatusMethodNotAllowed},
		{http.MethodGet, "/missing", http.StatusNotFound},
		{http.MethodGet, "/health/extra", http.StatusNotFound},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			var logs bytes.Buffer
			handler := NewHandler(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(tc.method, tc.path, nil))
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.status)
			}
			if tc.status == http.StatusOK {
				if recorder.Header().Get("Content-Type") != "application/json" {
					t.Fatal("expected JSON content type")
				}
				var body map[string]string
				if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body["status"] != "ok" {
					t.Fatalf("unexpected health response: %s", recorder.Body.String())
				}
			}
			var entry map[string]any
			if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
				t.Fatal(err)
			}
			if entry["method"] != tc.method || entry["path"] != tc.path {
				t.Fatalf("request missing from log: %v", entry)
			}
		})
	}
}

type failedWriter struct{ header http.Header }

func (w failedWriter) Header() http.Header       { return w.header }
func (w failedWriter) WriteHeader(int)           {}
func (w failedWriter) Write([]byte) (int, error) { return 0, errors.New("disconnected") }

func TestHealthWriteError(t *testing.T) {
	var logs bytes.Buffer
	handler := NewHandler(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
	handler.ServeHTTP(failedWriter{header: make(http.Header)}, httptest.NewRequest(http.MethodGet, "/health", nil))
	if !strings.Contains(logs.String(), "disconnected") {
		t.Fatal("write failure was not logged")
	}
}
