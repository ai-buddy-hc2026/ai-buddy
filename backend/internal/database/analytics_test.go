package database

import (
	"context"
	"errors"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/analytics"
)

const analyticsLead = "10000000-0000-0000-0000-000000000003"

func TestAnalyticsSummaryCountsScopedData(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	if _, err := s.ProcessEvent(ctx, id, escalationEvent(id, 1, map[string]any{"question": "Нет в базе"})); err != nil {
		t.Fatal(err)
	}
	finishChat(t, NewChat(s.pool), id, "Не знаю")
	store := NewAnalytics(s.pool)
	for _, actor := range []string{analyticsLead, confirmTestBuddy} {
		summary, err := store.Summary(ctx, actor)
		if err != nil {
			t.Fatal(err)
		}
		if summary.Questions != 1 || summary.ActionsProposed != 1 || summary.Interns < 1 || summary.TasksTotal == 0 {
			t.Fatalf("%s: unexpected summary %+v", actor, summary)
		}
		if len(summary.Days) != 7 || summary.Days[6].Questions != 1 {
			t.Fatalf("%s: days %+v", actor, summary.Days)
		}
		if summary.DeflectionRate != 100 || summary.MentorMinutesSaved != analytics.MinutesPerQuestion {
			t.Fatalf("%s: derived %+v", actor, summary)
		}
	}
}

func TestAnalyticsSummaryDeniedForIntern(t *testing.T) {
	s, _ := toolFixture(t)
	if _, err := NewAnalytics(s.pool).Summary(context.Background(), chatAnya); !errors.Is(err, analytics.ErrDenied) {
		t.Fatal(err)
	}
}
