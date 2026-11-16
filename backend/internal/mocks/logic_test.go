package mocks

import (
	"testing"
	"time"
)

func TestMatchOwner(t *testing.T) {
	team := []Employee{
		{Code: "ilya", Tags: []string{"code review", "go"}},
		{Code: "oleg", Tags: []string{"деплой", "grafana", "доступы"}},
		{Code: "sveta", Tags: []string{"a/b", "метрики"}},
	}
	for _, tc := range []struct {
		name, topic, want string
		fallback          bool
		tag               string
	}{
		{"tag in topic", "Как получить доступы к Grafana?", "oleg", false, "grafana"},
		{"case and slash", "Кто ведёт A/B тесты", "sveta", false, "a/b"},
		{"fallback to mentor", "где взять пропуск", "ilya", true, ""},
		{"empty topic", "", "ilya", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := MatchOwner(tc.topic, team, "ilya")
			if got.Owner == nil || got.Owner.Code != tc.want || got.Fallback != tc.fallback {
				t.Fatalf("got %+v", got)
			}
			if tc.tag != "" && (got.MatchedTag == nil || *got.MatchedTag != tc.tag) {
				t.Fatalf("tag %v", got.MatchedTag)
			}
			if tc.tag == "" && got.MatchedTag != nil {
				t.Fatalf("unexpected tag %s", *got.MatchedTag)
			}
		})
	}
	if got := MatchOwner("ничего", team, "nobody"); got.Owner != nil || !got.Fallback {
		t.Fatalf("missing mentor: %+v", got)
	}
}

func TestFindPlace(t *testing.T) {
	places := []Place{
		{ID: "kitchen", Name: "Кухня", Aliases: []string{"кофе"}},
		{ID: "room-baikal", Name: "Переговорка Байкал", Aliases: []string{"байкал"}},
		{ID: "room-altai", Name: "Переговорка Алтай", Aliases: []string{"алтай"}},
	}
	for _, tc := range []struct {
		name, query, match string
		similar            int
	}{
		{"alias", "где байкал?", "room-baikal", 0},
		{"full name any case", "ПЕРЕГОВОРКА АЛТАЙ", "room-altai", 0},
		{"yo normalized", "хочу кофё", "kitchen", 0},
		{"partial prefix", "переговорки", "", 2},
		{"nothing", "бассейн", "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			match, similar := FindPlace(tc.query, places)
			if tc.match == "" && match != nil || tc.match != "" && (match == nil || match.ID != tc.match) {
				t.Fatalf("match %+v", match)
			}
			if len(similar) != tc.similar {
				t.Fatalf("similar %d", len(similar))
			}
		})
	}
}

func TestAccessStatus(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Minute)
	ten, hour := 10, 3600
	for _, tc := range []struct {
		name      string
		requested *time.Time
		after     *int
		want      string
		ready     bool
	}{
		{"not requested", nil, &ten, AccessNotRequested, false},
		{"manual", &past, nil, AccessPending, false},
		{"timer passed", &past, &ten, AccessGranted, true},
		{"timer running", &past, &hour, AccessPending, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, ready := AccessStatus(tc.requested, tc.after, now)
			if status != tc.want || (ready != nil) != tc.ready {
				t.Fatalf("status=%s ready=%v", status, ready)
			}
		})
	}
}
