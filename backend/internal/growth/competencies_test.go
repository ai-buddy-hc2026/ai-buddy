package growth

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/database"
)

const (
	team2ID = "e5aba0fd-91e6-59e4-a046-7960848af1a2"
	petrID  = "2db7cc77-4114-52d8-a833-f670ab60e4e0"
)

func levelOf(m CompetencyMatrix, code string) *int {
	for _, item := range m.Items {
		if item.Code == code {
			return item.MyLevel
		}
	}
	return nil
}

func TestCompetencyMatrix(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	anya := Actor{ID: anyaID, TeamID: teamID, BuddyID: ptr(ilyaID)}
	ilya := Actor{ID: ilyaID, TeamID: teamID}
	maria := Actor{ID: mariaID, TeamID: teamID}
	petr := Actor{ID: petrID, TeamID: team2ID}

	t.Run("matrix has four levels per competency and own levels", func(t *testing.T) {
		m, err := s.CompetencyMatrix(ctx, anya)
		if err != nil {
			t.Fatal(err)
		}
		if m.Track != "backend" || len(m.Items) < 6 || len(m.Items) > 8 {
			t.Fatalf("matrix: track %q, %d items", m.Track, len(m.Items))
		}
		for _, item := range m.Items {
			if len(item.Levels) != 4 || item.Levels[0].Level != 1 || item.Levels[3].Level != 4 || item.Levels[0].Description.En == "" {
				t.Fatalf("levels of %s: %+v", item.Code, item.Levels)
			}
		}
		if got := levelOf(m, "tests"); got == nil || *got != 1 {
			t.Fatalf("seeded tests level: %v", got)
		}
		if got := levelOf(m, "api"); got != nil {
			t.Fatalf("unrated competency has level %v", *got)
		}
	})

	t.Run("frontend track from profile", func(t *testing.T) {
		m, err := s.CompetencyMatrix(ctx, petr)
		if err != nil || m.Track != "frontend" || levelOf(m, "react") != nil || len(m.Items) != 7 {
			t.Fatalf("petr matrix: %+v %v", m, err)
		}
		if _, err := s.SetCompetencyLevel(ctx, petr, "sql", 2); !errors.Is(err, ErrNotFound) {
			t.Fatalf("code from other track: %v", err)
		}
	})

	t.Run("set level upserts", func(t *testing.T) {
		if _, err := s.SetCompetencyLevel(ctx, anya, "tests", 3); err != nil {
			t.Fatal(err)
		}
		m, err := s.SetCompetencyLevel(ctx, anya, "api", 2)
		if err != nil {
			t.Fatal(err)
		}
		if got := levelOf(m, "tests"); got == nil || *got != 3 {
			t.Fatalf("tests level after update: %v", got)
		}
		if got := levelOf(m, "api"); got == nil || *got != 2 {
			t.Fatalf("api level: %v", got)
		}
		for _, bad := range []int{0, 5} {
			if _, err := s.SetCompetencyLevel(ctx, anya, "tests", bad); !errors.Is(err, ErrInvalid) {
				t.Fatalf("level %d: %v", bad, err)
			}
		}
		if _, err := s.SetCompetencyLevel(ctx, anya, "nope", 2); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown code: %v", err)
		}
	})

	t.Run("buddy and lead never see intern levels", func(t *testing.T) {
		for name, viewer := range map[string]Actor{"buddy": ilya, "lead": maria} {
			m, err := s.CompetencyMatrix(ctx, viewer)
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range m.Items {
				if item.MyLevel != nil {
					t.Fatalf("%s sees level %d for %s", name, *item.MyLevel, item.Code)
				}
			}
		}
		// Своя оценка наставника не меняет оценку стажёра.
		if _, err := s.SetCompetencyLevel(ctx, ilya, "tests", 4); err != nil {
			t.Fatal(err)
		}
		m, err := s.CompetencyMatrix(ctx, anya)
		if err != nil {
			t.Fatal(err)
		}
		if got := levelOf(m, "tests"); got == nil || *got != 3 {
			t.Fatalf("anya level changed by buddy: %v", got)
		}
	})

	t.Run("mentor analytics does not include self-assessment", func(t *testing.T) {
		analytics := database.NewAnalytics(s.pool)
		for _, viewer := range []string{ilyaID, mariaID} {
			summary, err := analytics.Summary(ctx, viewer)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(summary)
			if err != nil {
				t.Fatal(err)
			}
			lower := strings.ToLower(string(raw))
			for _, word := range []string{"competenc", "skill", "self_assess", "selfassess"} {
				if strings.Contains(lower, word) {
					t.Fatalf("summary for %s mentions %q: %s", viewer, word, raw)
				}
			}
		}
	})
}

// Самооценку читает только этот пакет: защита от случайного запроса в сводке, аналитике или инструментах.
func TestSelfAssessmentsReadOnlyHere(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if filepath.Base(path) == "competencies.go" && filepath.Base(filepath.Dir(path)) == "growth" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(data), "competency_self_assessments") {
			t.Errorf("%s reads competency_self_assessments", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
