package growth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	teamID  = "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2"
	anyaID  = "a24a3478-cf42-51b1-b05b-9833260247a5"
	ilyaID  = "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"
	mariaID = "10000000-0000-0000-0000-000000000003"
	boardID = "7c1e0a51-4d2b-5f0e-9a11-000000000003"
)

// testStore поднимает чистую схему с миграциями и seed. Нужен TEST_DATABASE_URL
// и CHECKLIST_SEED_PATH (по умолчанию ../../../seed/checklist.json).
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("growth_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	// vector ставим в public один раз, иначе DROP SCHEMA ... CASCADE удалит тип у других тестов.
	if _, err := admin.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector SCHEMA public"); err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	seed := os.Getenv("CHECKLIST_SEED_PATH")
	if seed == "" {
		seed = "../../../seed/checklist.json"
	}
	if err := database.Prepare(ctx, pool, seed); err != nil {
		t.Fatal(err)
	}
	return NewStore(pool)
}

func TestStoreFlows(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	anya := Actor{ID: anyaID, TeamID: teamID, BuddyID: ptr(ilyaID)}
	ilya := Actor{ID: ilyaID, TeamID: teamID}
	maria := Actor{ID: mariaID, TeamID: teamID}

	t.Run("brag add list delete", func(t *testing.T) {
		item, err := s.AddBrag(ctx, anya, BragInput{Kind: "manual", Title: "Доклад", Date: "2026-11-12"})
		if err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteBrag(ctx, anya, item.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteBrag(ctx, ilya, item.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign delete: %v", err)
		}
		items, err := s.ListBrag(ctx, anya)
		if err != nil || len(items) < 2 {
			t.Fatalf("seeded brag missing: %v %v", items, err)
		}
		for _, it := range items {
			if it.ID == item.ID {
				t.Fatal("deleted item listed")
			}
		}
	})

	t.Run("feedback limit and answer", func(t *testing.T) {
		in := FeedbackInput{ToID: ilyaID, ArtifactURL: "https://gitlab.test/9", ArtifactTitle: "MR 9", Question: "Ок?"}
		var first FeedbackRequest
		for i := range MaxOpenPerPerson {
			f, err := s.CreateFeedback(ctx, anya, in)
			if err != nil {
				t.Fatalf("request %d: %v", i, err)
			}
			first = f
		}
		if _, err := s.CreateFeedback(ctx, anya, in); !errors.Is(err, ErrLimit) {
			t.Fatalf("want limit, got %v", err)
		}
		if _, err := s.AnswerFeedback(ctx, anya, first.ID, "сам себе"); !errors.Is(err, ErrConflict) {
			t.Fatalf("requester answered: %v", err)
		}
		answered, err := s.AnswerFeedback(ctx, ilya, first.ID, "Норм")
		if err != nil || answered.Status != "answered" {
			t.Fatalf("answer: %v %v", answered, err)
		}
		if _, err := s.MarkFeedbackSaved(ctx, anya, first.ID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("event capacity", func(t *testing.T) {
		s.now = func() time.Time { return time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC) }
		defer func() { s.now = time.Now }()
		if _, err := s.pool.Exec(ctx, `UPDATE community_events SET capacity=1 WHERE id=$1`, boardID); err != nil {
			t.Fatal(err)
		}
		if err := s.JoinEvent(ctx, anya, boardID); err != nil {
			t.Fatal(err)
		}
		if err := s.JoinEvent(ctx, anya, boardID); err != nil {
			t.Fatalf("repeat join: %v", err)
		}
		if err := s.JoinEvent(ctx, maria, boardID); !errors.Is(err, ErrLimit) {
			t.Fatalf("want full, got %v", err)
		}
		if err := s.LeaveEvent(ctx, anya, boardID); err != nil {
			t.Fatal(err)
		}
		events, err := s.ListEvents(ctx, anya)
		if err != nil || len(events) == 0 {
			t.Fatalf("events: %v %v", events, err)
		}
	})

	t.Run("interests groups", func(t *testing.T) {
		got, err := s.SaveInterests(ctx, anya, []string{"настолки"})
		if err != nil || len(got.Tags) != 1 || len(got.Groups) != 1 || len(got.Groups[0].Members) != 3 {
			t.Fatalf("interests: %+v %v", got, err)
		}
	})

	t.Run("tracks roundtrip", func(t *testing.T) {
		in := Tracks{Selected: []string{"deploy"}, Modules: map[string]json.RawMessage{
			"deploy-1": json.RawMessage(`{"status":"skipped_by_test","lastScore":5,"lastAttempt":null}`)}}
		if _, err := s.SaveTracks(ctx, anya, in); err != nil {
			t.Fatal(err)
		}
		got, found, err := s.Tracks(ctx, anya)
		if err != nil || !found || got.Selected[0] != "deploy" || len(got.Modules) != 1 {
			t.Fatalf("tracks: %+v %v %v", got, found, err)
		}
	})

	t.Run("meeting agreements become tasks once", func(t *testing.T) {
		draft := MeetingDraft{Summary: "Итоги", Agreements: []Agreement{
			{ID: "a1", Owner: "intern", What: "Прислать MR"},
			{ID: "a2", Owner: "mentor", What: "Выдать доступ", DueDate: ptr("2026-11-20")},
		}}
		first, err := s.SaveMeeting(ctx, anya, "slot-1", draft)
		if err != nil || first.TaskCount != 2 {
			t.Fatalf("first save: %+v %v", first, err)
		}
		again, err := s.SaveMeeting(ctx, anya, "slot-1", draft)
		if err != nil || again.TaskCount != 2 {
			t.Fatalf("repeat save duplicated tasks: %+v %v", again, err)
		}
		var mentorTasks int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE seed_key LIKE 'meeting:slot-1:%' AND assignee_id=$1`, ilyaID).Scan(&mentorTasks); err != nil || mentorTasks != 1 {
			t.Fatalf("mentor task: %d %v", mentorTasks, err)
		}
		if _, err := s.SaveMeeting(ctx, ilya, "slot-1", draft); !errors.Is(err, ErrNotFound) {
			t.Fatalf("buddy without plan: %v", err)
		}
		records, err := s.Meetings(ctx, anya)
		if err != nil || records["slot-1"].Summary != "Итоги" {
			t.Fatalf("meetings: %v %v", records, err)
		}
	})

	t.Run("coffee pairs", func(t *testing.T) {
		if err := s.SaveCoffeePairs(ctx, teamID, "2026-11-16", []Pair{{A: ilyaID, B: anyaID}}); err != nil {
			t.Fatal(err)
		}
		if err := s.SaveCoffeePairs(ctx, teamID, "2026-11-16", []Pair{{A: anyaID, B: ilyaID}}); err != nil {
			t.Fatal(err)
		}
		pairs, err := s.CoffeePairs(ctx, anya)
		if err != nil || len(pairs) != 1 || pairs[0].PartnerID != ilyaID {
			t.Fatalf("pairs: %+v %v", pairs, err)
		}
	})
}
