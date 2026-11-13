package chat

import (
	"encoding/json"
	"testing"
)

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
