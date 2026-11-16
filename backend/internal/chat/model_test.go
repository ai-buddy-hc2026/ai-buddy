package chat

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPreferencesMapToAIServiceValues(t *testing.T) {
	cases := []struct{ tone, lang, wantTone, wantLang string }{
		{"short", "ru", "short", "ru"},
		{"detailed", "en", "friendly", "en"},
		{"", "", "", ""},
		{"loud", "de", "", ""},
	}
	for _, c := range cases {
		tone, lang := Preferences(c.tone, c.lang)
		if tone != c.wantTone || lang != c.wantLang {
			t.Fatalf("%q/%q -> %q/%q", c.tone, c.lang, tone, lang)
		}
	}
	raw, _ := json.Marshal(Payload{History: []HistoryMessage{}})
	if json.Valid(raw) && (strings.Contains(string(raw), "tone") || strings.Contains(string(raw), "language")) {
		t.Fatalf("empty preferences must be omitted: %s", raw)
	}
}

func TestFailureUsesSafeFallbackForUnknownCode(t *testing.T) {
	event := Failure("10000000-0000-0000-0000-000000000001", 1, "UNRECOGNIZED")
	var detail Error
	if err := json.Unmarshal(event.Data, &detail); err != nil {
		t.Fatal(err)
	}
	if event.Type != "error" || detail.Code != "INTERNAL_ERROR" || detail.Message == "" {
		t.Fatalf("unexpected safe failure event: %+v %+v", event, detail)
	}
}
