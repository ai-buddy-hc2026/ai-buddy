package tools

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAbsenceDatesAndTypes(t *testing.T) {
	now := time.Date(2026, 11, 11, 20, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		date, kind string
		valid      bool
	}{
		{"2026-11-15", "day_off", true}, // В Якутске уже следующий день.
		{"2026-11-11", "day_off", false},
		{"2027-11-12", "day_off", true},
		{"2027-11-13", "day_off", true},
		{"2026-02-30", "day_off", false},
		{"2026-11-12T00:00:00Z", "day_off", false},
		{"2026-11-12", "unknown", false},
	} {
		err := ValidateAbsence(AbsenceParameters{Date: tc.date, Type: tc.kind}, now, "Asia/Yakutsk")
		if (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
}

func TestStrictArguments(t *testing.T) {
	for _, raw := range []string{`null`, `{} {}`, `{"action_id":"id","confirmed":true}`, `{"action_id":"id","team_id":"other"}`} {
		if Decode(json.RawMessage(raw), &ActionInput{}) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
