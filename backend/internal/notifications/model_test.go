package notifications

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestNotificationWorkingHours(t *testing.T) {
	s := Settings{WorkDays: []int{1, 2, 3, 4, 5}, WorkStart: "10:00", WorkEnd: "19:00", Timezone: "Europe/Moscow"}
	for _, tc := range []struct{ now, want, zone string }{
		{"2026-11-16T07:00:00Z", "2026-11-16T07:00:00Z", "Europe/Moscow"},
		{"2026-11-16T06:59:00Z", "2026-11-16T07:00:00Z", "Europe/Moscow"},
		{"2026-11-20T16:00:00Z", "2026-11-23T07:00:00Z", "Europe/Moscow"},
		{"2026-11-15T23:30:00Z", "2026-11-16T01:00:00Z", "Asia/Yakutsk"},
		{"2026-03-29T07:00:00Z", "2026-03-30T08:00:00Z", "Europe/Berlin"},
	} {
		now, err := time.Parse(time.RFC3339, tc.now)
		if err != nil {
			t.Fatal(err)
		}
		s.Timezone = tc.zone
		actual, err := NextAllowed(now, s)
		if err != nil || actual.Format(time.RFC3339) != tc.want {
			t.Fatalf("%+v actual=%s err=%v", tc, actual, err)
		}
	}
	s.Timezone = "invalid/zone"
	if _, err := NextAllowed(time.Now(), s); err == nil {
		t.Fatal("invalid timezone accepted")
	}
}

func TestNotificationSettingsValidation(t *testing.T) {
	version := 1
	enabled := true
	valid := SettingsInput{Version: &version, Preferences: &PreferencesInput{MeetingReminders: &enabled}, WorkDays: []int{1, 2, 3}, WorkStart: "10:00", WorkEnd: "19:00"}
	if !valid.Valid() {
		t.Fatal("valid settings rejected")
	}
	for _, mutate := range []func(*SettingsInput){
		func(s *SettingsInput) { s.Version = nil }, func(s *SettingsInput) { s.Preferences = &PreferencesInput{} },
		func(s *SettingsInput) { s.WorkDays = []int{} }, func(s *SettingsInput) { s.WorkDays = []int{1, 1} },
		func(s *SettingsInput) { s.WorkStart = "20:00" }, func(s *SettingsInput) { s.WorkEnd = "bad" },
	} {
		input := valid
		mutate(&input)
		if input.Valid() {
			t.Fatal("invalid settings accepted")
		}
	}
}

type stoppingProcessor struct {
	started  chan struct{}
	finished chan struct{}
}

func (p *stoppingProcessor) Backfill(context.Context, time.Time) error { return nil }
func (p *stoppingProcessor) ProcessDue(ctx context.Context, _ time.Time) error {
	close(p.started)
	<-ctx.Done()
	close(p.finished)
	return ctx.Err()
}

func TestNotificationWorkerStopsInFlightProcessing(t *testing.T) {
	p := &stoppingProcessor{started: make(chan struct{}), finished: make(chan struct{})}
	stop := StartWorker(context.Background(), p, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Hour)
	select {
	case <-p.started:
	case <-time.After(2 * time.Second):
		stop()
		t.Fatal("worker did not start")
	}
	stop()
	select {
	case <-p.finished:
	default:
		t.Fatal("worker returned before processor stopped")
	}
}
