package scheduler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/companion"
)

// 2026-11-16 - понедельник.
func at(t *testing.T, value string) time.Time {
	t.Helper()
	loc, err := time.LoadLocation(companion.DefaultTimezone)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := time.ParseInLocation("2006-01-02 15:04", value, loc)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func recipient(id, team, role string, mutate func(*companion.Recipient)) companion.Recipient {
	r := companion.Recipient{UserID: id, TeamID: team, Role: role, Name: id, Settings: companion.Defaults(companion.DefaultTimezone), BuddyEnabled: true}
	if mutate != nil {
		mutate(&r)
	}
	return r
}

func keys(items []Candidate) map[string]int {
	out := map[string]int{}
	for _, c := range items {
		out[c.UserID+"|"+c.DedupKey]++
	}
	return out
}

func TestJobs(t *testing.T) {
	now := at(t, "2026-11-16 11:00")
	coffee := func(r *companion.Recipient) { r.Settings.Toggles.RandomCoffee = true }
	snap := Snapshot{
		Recipients: []companion.Recipient{
			recipient("anya", "t1", "intern", coffee),
			recipient("ilya", "t1", "buddy", coffee),
			recipient("maria", "t1", "lead", nil),
			recipient("petr", "t2", "intern", coffee),
		},
		Tasks: []Task{
			{ID: "today", AssigneeID: "anya", Title: "A", Status: "todo", DueDate: "2026-11-16", UpdatedAt: now},
			{ID: "tomorrow", AssigneeID: "anya", Title: "B", Status: "todo", DueDate: "2026-11-17", UpdatedAt: now},
			{ID: "late", AssigneeID: "anya", SeedKey: "course:security", Title: "C", Status: "todo", DueDate: "2026-11-10", UpdatedAt: now},
			{ID: "stale", AssigneeID: "anya", Title: "D", Status: "in_progress", UpdatedAt: now.Add(-72 * time.Hour)},
			{ID: "fresh", AssigneeID: "anya", Title: "E", Status: "in_progress", UpdatedAt: now.Add(-time.Hour)},
		},
		Birthdays: []Birthday{
			{UserID: "ilya", TeamID: "t1", Name: "Ilya", Month: 11, Day: 17},
			{UserID: "petr", TeamID: "t2", Name: "Petr", Month: 11, Day: 17},
		},
	}
	for _, tc := range []struct {
		name string
		job  Job
		want map[string]int
	}{
		{"briefing interns only", Briefing, map[string]int{"anya|briefing:2026-11-16": 1, "petr|briefing:2026-11-16": 1}},
		{"hint for tomorrow", Hints, map[string]int{"anya|hint:tomorrow:2026-11-17": 1}},
		{"stuck after 48h", Stuck, map[string]int{"anya|stuck:stale:" + now.Add(-72*time.Hour).UTC().Format(time.RFC3339): 1}},
		{"overdue reminder", Reminders, map[string]int{"anya|overdue:late:2026-11-10": 1}},
		{"coffee pairs inside team", RandomCoffee, map[string]int{"anya|coffee:2026-W47": 1, "ilya|coffee:2026-W47": 1}},
		{"birthday same team, not self", Birthdays, map[string]int{"anya|birthday:ilya:2026": 1, "maria|birthday:ilya:2026": 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := keys(tc.job(now, snap))
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for key, count := range tc.want {
				if got[key] != count {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestBriefingSkipsWeekend(t *testing.T) {
	snap := Snapshot{Recipients: []companion.Recipient{recipient("anya", "t1", "intern", nil)}}
	if got := Briefing(at(t, "2026-11-15 11:00"), snap); len(got) != 0 {
		t.Fatalf("weekend briefing: %v", got)
	}
}

func TestCoffeeOnlyOnMonday(t *testing.T) {
	coffee := func(r *companion.Recipient) { r.Settings.Toggles.RandomCoffee = true }
	snap := Snapshot{Recipients: []companion.Recipient{recipient("a", "t", "intern", coffee), recipient("b", "t", "intern", coffee)}}
	if got := RandomCoffee(at(t, "2026-11-17 11:00"), snap); len(got) != 0 {
		t.Fatalf("tuesday coffee: %v", got)
	}
}

func TestPlanAppliesGate(t *testing.T) {
	now := at(t, "2026-11-16 23:00")
	snap := Snapshot{Recipients: []companion.Recipient{
		recipient("on", "t", "intern", nil),
		recipient("off", "t", "intern", func(r *companion.Recipient) { r.Settings.Toggles.Briefing = false }),
		recipient("control", "t", "intern", func(r *companion.Recipient) { r.BuddyEnabled = false }),
	}}
	job := func(time.Time, Snapshot) []Candidate {
		return []Candidate{
			{UserID: "on", Feature: companion.FeatureBriefing, DedupKey: "k", Title: "x"},
			{UserID: "off", Feature: companion.FeatureBriefing, DedupKey: "k", Title: "x"},
			{UserID: "control", Feature: companion.FeatureBriefing, DedupKey: "k", Title: "x"},
			{UserID: "ghost", Feature: companion.FeatureBriefing, DedupKey: "k", Title: "x"},
		}
	}
	got := Plan(now, snap, []Job{job})
	if len(got) != 1 || got[0].UserID != "on" || got[0].TeamID != "t" {
		t.Fatalf("got %+v", got)
	}
	if want := at(t, "2026-11-17 08:00"); !got[0].DeliverAt.Equal(want) {
		t.Fatalf("deliverAt = %v, want %v", got[0].DeliverAt, want)
	}
}

type fakeSource struct {
	snap Snapshot
	err  error
}

func (f fakeSource) Snapshot(context.Context) (Snapshot, error) { return f.snap, f.err }

type fakeSink struct {
	seen map[string]bool
}

func (f *fakeSink) Enqueue(_ context.Context, items []companion.Notification) (int, error) {
	inserted := 0
	for _, n := range items {
		key := n.UserID + "|" + n.DedupKey
		if !f.seen[key] {
			f.seen[key] = true
			inserted++
		}
	}
	return inserted, nil
}

func TestTickIsIdempotent(t *testing.T) {
	now := at(t, "2026-11-16 11:00")
	sink := &fakeSink{seen: map[string]bool{}}
	snap := Snapshot{Recipients: []companion.Recipient{recipient("anya", "t1", "intern", nil)}}
	s := New(fakeSource{snap: snap}, sink, func() time.Time { return now }, nil)
	first, err := s.Tick(context.Background())
	if err != nil || first != 1 {
		t.Fatalf("first = %d, %v", first, err)
	}
	second, err := s.Tick(context.Background())
	if err != nil || second != 0 {
		t.Fatalf("second = %d, %v", second, err)
	}
}

func TestTickSourceError(t *testing.T) {
	s := New(fakeSource{err: errors.New("db down")}, &fakeSink{seen: map[string]bool{}}, nil, nil)
	if _, err := s.Tick(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	sink := &fakeSink{seen: map[string]bool{}}
	snap := Snapshot{Recipients: []companion.Recipient{recipient("anya", "t1", "intern", nil)}}
	done := make(chan struct{})
	now := at(t, "2026-11-16 11:00")
	s := New(fakeSource{snap: snap}, sink, func() time.Time { return now }, nil)
	go func() {
		s.Run(ctx, time.Hour)
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop")
	}
}
