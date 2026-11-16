package growth

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestBragInputValidate(t *testing.T) {
	tests := []struct {
		name string
		in   BragInput
		ok   bool
	}{
		{"manual", BragInput{Kind: "manual", Title: "Сделала доклад", Date: "2026-11-10"}, true},
		{"with link", BragInput{Kind: "pr", Title: "MR !1", Link: ptr("https://gitlab.test/1"), Date: "2026-11-10"}, true},
		{"unknown kind", BragInput{Kind: "bonus", Title: "x", Date: "2026-11-10"}, false},
		{"blank title", BragInput{Kind: "manual", Title: "  ", Date: "2026-11-10"}, false},
		{"long title", BragInput{Kind: "manual", Title: strings.Repeat("я", TitleMax+1), Date: "2026-11-10"}, false},
		{"bad date", BragInput{Kind: "manual", Title: "x", Date: "10.11.2026"}, false},
		{"js link", BragInput{Kind: "manual", Title: "x", Link: ptr("javascript:alert(1)"), Date: "2026-11-10"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.in.Validate(); (err == nil) != tt.ok {
				t.Fatalf("Validate() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestFeedbackInputValidate(t *testing.T) {
	valid := FeedbackInput{ToID: "u", ArtifactURL: "https://gitlab.test/mr/1", ArtifactTitle: "MR", Question: "Что улучшить?"}
	tests := []struct {
		name   string
		mutate func(FeedbackInput) FeedbackInput
		ok     bool
	}{
		{"valid", func(in FeedbackInput) FeedbackInput { return in }, true},
		{"no url", func(in FeedbackInput) FeedbackInput { in.ArtifactURL = ""; return in }, false},
		{"long question", func(in FeedbackInput) FeedbackInput { in.Question = strings.Repeat("a", QuestionMax+1); return in }, false},
		{"empty external", func(in FeedbackInput) FeedbackInput { in.ExternalID = ptr(""); return in }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.mutate(valid).Validate(); (err == nil) != tt.ok {
				t.Fatalf("Validate() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestFeedbackStatus(t *testing.T) {
	expires := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name     string
		answered bool
		now      time.Time
		want     string
	}{
		{"open", false, expires.Add(-time.Hour), "sent"},
		{"expired at deadline", false, expires, "expired"},
		{"answered late still answered", true, expires.Add(time.Hour), "answered"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FeedbackStatus(tt.answered, expires, tt.now); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeTags(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want []string
		err  bool
	}{
		{"lower and dedupe", []string{"#Бег", "бег", " Настолки  игры "}, []string{"бег", "настолки игры"}, false},
		{"empty list", []string{}, []string{}, false},
		{"blank tag", []string{"  "}, nil, true},
		{"too long", []string{strings.Repeat("a", TagMax+1)}, nil, true},
		{"too many", []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"}, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeTags(tt.in)
			if (err != nil) != tt.err || !slices.Equal(got, tt.want) {
				t.Fatalf("got %v, %v; want %v, err=%v", got, err, tt.want, tt.err)
			}
		})
	}
}

func TestTracksValidate(t *testing.T) {
	module := func(s string) json.RawMessage {
		return json.RawMessage(`{"status":"` + s + `","lastScore":null,"lastAttempt":null}`)
	}
	tests := []struct {
		name string
		in   Tracks
		ok   bool
	}{
		{"valid", Tracks{Selected: []string{"access", "deploy"}, Modules: map[string]json.RawMessage{"access-1": module("skipped_by_test")}}, true},
		{"nil modules", Tracks{Selected: []string{}}, false},
		{"duplicate track", Tracks{Selected: []string{"a", "a"}, Modules: map[string]json.RawMessage{}}, false},
		{"bad status", Tracks{Selected: []string{}, Modules: map[string]json.RawMessage{"m": module("half")}}, false},
		{"bad id", Tracks{Selected: []string{"a b"}, Modules: map[string]json.RawMessage{}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.in.Validate(); (err == nil) != tt.ok {
				t.Fatalf("Validate() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestMeetingDraftValidate(t *testing.T) {
	agreement := Agreement{ID: "a1", Owner: "intern", What: "Прислать MR", DueDate: ptr("2026-11-20")}
	tests := []struct {
		name string
		in   MeetingDraft
		ok   bool
	}{
		{"valid", MeetingDraft{Summary: "Обсудили задачу", Agreements: []Agreement{agreement}}, true},
		{"summary only", MeetingDraft{Summary: "Обсудили", Agreements: []Agreement{}}, true},
		{"nil agreements", MeetingDraft{Summary: "Обсудили"}, false},
		{"blank summary", MeetingDraft{Summary: " ", Agreements: []Agreement{}}, false},
		{"bad owner", MeetingDraft{Summary: "x", Agreements: []Agreement{{ID: "a", Owner: "boss", What: "x"}}}, false},
		{"bad due", MeetingDraft{Summary: "x", Agreements: []Agreement{{ID: "a", Owner: "intern", What: "x", DueDate: ptr("завтра")}}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.in.Validate(); (err == nil) != tt.ok {
				t.Fatalf("Validate() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestAgreementTasks(t *testing.T) {
	got := AgreementTasks("slot-1", []Agreement{
		{ID: "a1", Owner: "intern", What: " Прислать MR "},
		{ID: "a2", Owner: "mentor", What: "Выдать доступ", DueDate: ptr("2026-11-20")},
		{ID: "a3", Owner: "other", What: "Прислать MR"},
	})
	if len(got) != 2 {
		t.Fatalf("want duplicates collapsed to 2 tasks, got %d", len(got))
	}
	if got[0].SeedKey != "meeting:slot-1:a1" || got[0].Title != "Прислать MR" || got[0].ForMentor {
		t.Fatalf("unexpected intern task %+v", got[0])
	}
	if !got[1].ForMentor || *got[1].DueDate != "2026-11-20" || !strings.Contains(got[1].Description, "meeting:slot-1") {
		t.Fatalf("unexpected mentor task %+v", got[1])
	}
}

func TestPlanPairs(t *testing.T) {
	tests := []struct {
		name     string
		users    []string
		previous []Pair
		want     []Pair
	}{
		{"even", []string{"d", "b", "a", "c"}, nil, []Pair{{"a", "b"}, {"c", "d"}}},
		{"odd leaves one out", []string{"a", "b", "c"}, nil, []Pair{{"a", "b"}}},
		{"avoid repeat", []string{"a", "b", "c", "d"}, []Pair{{"b", "a"}}, []Pair{{"a", "c"}, {"b", "d"}}},
		{"repeat if no choice", []string{"a", "b"}, []Pair{{"a", "b"}}, []Pair{{"a", "b"}}},
		{"duplicates ignored", []string{"a", "a"}, nil, []Pair{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := slices.Clone(tt.users)
			got := PlanPairs(tt.users, tt.previous)
			if !slices.Equal(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			if !slices.Equal(input, tt.users) {
				t.Fatal("input mutated")
			}
		})
	}
}

func TestClassify(t *testing.T) {
	tests := []struct {
		err    error
		status int
	}{
		{ErrInvalid, 400}, {ErrDenied, 403}, {ErrNotFound, 404}, {ErrLimit, 409}, {ErrConflict, 409},
		{errors.New("db down"), 503},
	}
	for _, tt := range tests {
		if got := classify(tt.err).status; got != tt.status {
			t.Errorf("classify(%v) = %d, want %d", tt.err, got, tt.status)
		}
	}
}
