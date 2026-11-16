package growth

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// Матрица компетенций (идея 29). Самооценку читает и пишет только сам пользователь:
// все запросы фильтруют по Actor.ID, другого пользователя передать нельзя.

const (
	CompetencyLevelMin = 1
	CompetencyLevelMax = 4
	defaultTrack       = "backend"
)

var competencyCode = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,39}$`)

// ValidCompetencyCode проверяет код компетенции из пути запроса.
func ValidCompetencyCode(code string) bool { return competencyCode.MatchString(code) }

// ValidCompetencyLevel - уровень самооценки 1-4.
func ValidCompetencyLevel(level int) bool {
	return level >= CompetencyLevelMin && level <= CompetencyLevelMax
}

type Localized struct {
	Ru string `json:"ru"`
	En string `json:"en"`
}

type CompetencyLevel struct {
	Level       int       `json:"level"`
	Description Localized `json:"description"`
}

// Competency - строка матрицы: описания уровней и своя оценка (nil, если не ставил).
type Competency struct {
	Code    string            `json:"code"`
	Name    Localized         `json:"name"`
	Levels  []CompetencyLevel `json:"levels"`
	MyLevel *int              `json:"myLevel"`
}

type CompetencyMatrix struct {
	Track string       `json:"track"`
	Items []Competency `json:"items"`
}

// CompetencyMatrix отдаёт матрицу трека пользователя и только его самооценку.
func (s *Store) CompetencyMatrix(ctx context.Context, a Actor) (CompetencyMatrix, error) {
	track, err := s.competencyTrack(ctx, a)
	if err != nil {
		return CompetencyMatrix{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT c.code,c.name_ru,c.name_en,l.level,l.description_ru,l.description_en,sa.level
 FROM competencies c
 JOIN competency_levels l ON l.competency_id=c.id
 LEFT JOIN competency_self_assessments sa ON sa.competency_id=c.id AND sa.user_id=$2 AND sa.team_id=$3
 WHERE c.track=$1 ORDER BY c.position,l.level`, track, a.ID, a.TeamID)
	if err != nil {
		return CompetencyMatrix{}, fmt.Errorf("list competencies: %w", err)
	}
	defer rows.Close()
	matrix := CompetencyMatrix{Track: track, Items: []Competency{}}
	for rows.Next() {
		var (
			code    string
			name    Localized
			level   CompetencyLevel
			myLevel *int
		)
		if err := rows.Scan(&code, &name.Ru, &name.En, &level.Level, &level.Description.Ru, &level.Description.En, &myLevel); err != nil {
			return CompetencyMatrix{}, fmt.Errorf("read competency: %w", err)
		}
		last := len(matrix.Items) - 1
		if last < 0 || matrix.Items[last].Code != code {
			matrix.Items = append(matrix.Items, Competency{Code: code, Name: name, Levels: []CompetencyLevel{}, MyLevel: myLevel})
			last++
		}
		matrix.Items[last].Levels = append(matrix.Items[last].Levels, level)
	}
	if err := rows.Err(); err != nil {
		return CompetencyMatrix{}, fmt.Errorf("read competencies: %w", err)
	}
	return matrix, nil
}

// SetCompetencyLevel сохраняет самооценку по компетенции своего трека и возвращает матрицу.
func (s *Store) SetCompetencyLevel(ctx context.Context, a Actor, code string, level int) (CompetencyMatrix, error) {
	if !ValidCompetencyCode(code) || !ValidCompetencyLevel(level) {
		return CompetencyMatrix{}, ErrInvalid
	}
	track, err := s.competencyTrack(ctx, a)
	if err != nil {
		return CompetencyMatrix{}, err
	}
	tag, err := s.pool.Exec(ctx, `INSERT INTO competency_self_assessments(user_id,team_id,competency_id,level)
 SELECT $1,$2,c.id,$5 FROM competencies c WHERE c.track=$3 AND c.code=$4
 ON CONFLICT (user_id,competency_id) DO UPDATE SET level=EXCLUDED.level,updated_at=now()`, a.ID, a.TeamID, track, code, level)
	if err != nil {
		return CompetencyMatrix{}, fmt.Errorf("save competency level: %w", mapConstraint(err))
	}
	if tag.RowsAffected() == 0 {
		return CompetencyMatrix{}, ErrNotFound
	}
	return s.CompetencyMatrix(ctx, a)
}

func (s *Store) competencyTrack(ctx context.Context, a Actor) (string, error) {
	var track string
	err := s.pool.QueryRow(ctx, `SELECT track FROM competency_profiles WHERE user_id=$1 AND team_id=$2`, a.ID, a.TeamID).Scan(&track)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultTrack, nil
	}
	if err != nil {
		return "", fmt.Errorf("read competency track: %w", err)
	}
	return track, nil
}
