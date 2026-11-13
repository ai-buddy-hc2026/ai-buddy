package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

func TestPythonClientContract(t *testing.T) {
	id, _ := identifier.NewUUID()
	for _, tc := range []struct {
		name              string
		status            int
		body              string
		wantErr, definite bool
	}{
		{"accepted", 202, `{"request_id":"` + id + `","accepted":true,"duplicate":false}`, false, false},
		{"duplicate", 202, `{"request_id":"` + id + `","accepted":true,"duplicate":true}`, false, false},
		{"rejected", 503, `private-error`, true, true},
		{"malformed", 202, `{`, true, false},
		{"wrong ID", 202, `{"request_id":"other","accepted":true,"duplicate":false}`, true, false},
		{"missing flag", 202, `{"request_id":"` + id + `","accepted":true}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/chat" || r.Header.Get("Authorization") != "Bearer synthetic-token" {
					t.Error("wrong HTTP contract")
				}
				var p Payload
				if json.NewDecoder(r.Body).Decode(&p) != nil || p.RequestID != id {
					t.Error("wrong payload")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			err := (&PythonClient{URL: server.URL, Token: "synthetic-token"}).Send(context.Background(), Payload{RequestID: id})
			if (err != nil) != tc.wantErr || (err != nil && definiteDispatch(err) != tc.definite) {
				t.Fatalf("unexpected result %v", err)
			}
		})
	}
}

func TestProfileEventValidation(t *testing.T) {
	id, _ := identifier.NewUUID()
	metadataEvent, err := ParseEvent([]byte(`{"event":"done","request_id":"`+id+`","seq":1,"data":{"full_text":"Ответ","sources":[{"document_id":"40000000-0000-0000-0000-000000000001","revision":3,"title":"Guide","section":"Setup","url":"kb/guide"}],"answer_status":"answered","question_category":"process"}}`), id)
	if err != nil {
		t.Fatal("valid source and classification fields rejected", err)
	}
	var metadata map[string]any
	if err := json.Unmarshal(metadataEvent.Data, &metadata); err != nil || metadata["answer_status"] != "answered" || metadata["question_category"] != "process" {
		t.Fatal("done metadata was dropped", string(metadataEvent.Data), err)
	}
	for _, raw := range []string{
		`{"event":"token","request_id":"` + id + `","seq":1,"data":{"text":" "}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[]}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[{"document_id":"40000000-0000-0000-0000-000000000001","revision":3,"title":"Guide","section":"Setup","url":"kb/guide"}],"answer_status":"answered","question_category":"process"}}`,
		`{"event":"error","request_id":"` + id + `","seq":1,"data":{"code":"LLM_UNAVAILABLE","message":"private-token"}}`,
	} {
		event, err := ParseEvent([]byte(raw), id)
		if err != nil {
			t.Fatal(err)
		}
		if event.Type == "error" && string(event.Data) == `{"code":"LLM_UNAVAILABLE","message":"private-token"}` {
			t.Fatal("private details forwarded")
		}
	}
	for _, raw := range []string{
		`null`, `{`,
		`{"event":"token","request_id":"` + id + `","seq":0,"data":{"text":"x"}}`,
		`{"event":"token","request_id":"` + id + `","seq":1,"data":{"text":null}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":null}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[{"document_id":"foreign","revision":1,"title":"Guide","section":"Setup","url":"kb/guide"}]}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[{"document_id":"40000000-0000-0000-0000-000000000001","title":"Guide","section":"Setup","url":"kb/guide"}]}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[],"answer_status":"unsure"}}`,
		`{"event":"done","request_id":"` + id + `","seq":1,"data":{"full_text":"Ответ","sources":[],"question_category":"personal"}}`,
		`{"event":"error","request_id":"` + id + `","seq":1,"data":{"code":"invented","message":"x"}}`,
	} {
		if _, err := ParseEvent([]byte(raw), id); err == nil {
			t.Fatalf("invalid event accepted: %s", raw)
		}
	}
}
