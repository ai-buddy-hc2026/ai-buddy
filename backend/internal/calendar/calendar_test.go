package calendar

import (
	"strings"
	"testing"
	"time"
)

func TestCalendarBoundaries(t *testing.T) {
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, duration := range []time.Duration{0, -time.Hour, 32 * 24 * time.Hour} {
		if (Window{From: now, To: now.Add(duration)}).Valid() {
			t.Fatal("invalid window accepted")
		}
	}
	if !(Window{From: now, To: now.Add(31 * 24 * time.Hour)}).Valid() {
		t.Fatal("31 days rejected")
	}
	valid := Input{SlotID: "30000000-0000-4000-8000-000000000001", Topic: "1:1", Confirmed: true}
	key := "40000000-0000-4000-8000-000000000001"
	if !valid.Valid(key) {
		t.Fatal("valid confirmation rejected")
	}
	for _, input := range []Input{{SlotID: valid.SlotID, Topic: "1:1"}, {SlotID: valid.SlotID, Topic: " ", Confirmed: true}, {SlotID: valid.SlotID, Topic: strings.Repeat("я", 501), Confirmed: true}, {SlotID: "bad", Topic: "1:1", Confirmed: true}} {
		if input.Valid(key) {
			t.Fatal("invalid booking accepted")
		}
	}
}
