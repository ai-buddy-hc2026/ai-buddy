package growth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

// Actor - текущий пользователь. Все запросы ограничены его командой.
type Actor struct {
	ID      string
	TeamID  string
	BuddyID *string
}

// Store хранит данные роста в PostgreSQL.
type Store struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, now: time.Now}
}

const listMax = 200

/* ---------- brag ---------- */

// ListBrag сначала дописывает выполненные задачи плана (автосбор), затем отдаёт живые записи.
func (s *Store) ListBrag(ctx context.Context, a Actor) ([]BragItem, error) {
	if _, err := s.pool.Exec(ctx, `INSERT INTO brag_items(team_id,user_id,kind,title,occurred_on,source_task_id)
 SELECT t.team_id,t.assignee_id,'task',left(t.title,300),t.updated_at::date,t.id FROM tasks t
 WHERE t.assignee_id=$1 AND t.team_id=$2 AND t.status='done'
 ON CONFLICT (user_id,source_task_id) DO NOTHING`, a.ID, a.TeamID); err != nil {
		return nil, fmt.Errorf("collect brag from tasks: %w", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,kind,title,link,occurred_on::text FROM brag_items
 WHERE user_id=$1 AND team_id=$2 AND deleted_at IS NULL ORDER BY occurred_on DESC,created_at DESC LIMIT $3`, a.ID, a.TeamID, listMax)
	if err != nil {
		return nil, fmt.Errorf("list brag: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (BragItem, error) {
		var item BragItem
		err := row.Scan(&item.ID, &item.Kind, &item.Title, &item.Link, &item.Date)
		return item, err
	})
	if err != nil {
		return nil, fmt.Errorf("read brag: %w", err)
	}
	return items, nil
}

func (s *Store) AddBrag(ctx context.Context, a Actor, in BragInput) (BragItem, error) {
	item := BragItem{Kind: in.Kind, Title: in.Title, Link: in.Link, Date: in.Date}
	err := s.pool.QueryRow(ctx, `INSERT INTO brag_items(team_id,user_id,kind,title,link,occurred_on)
 VALUES ($1,$2,$3,$4,$5,$6::date) RETURNING id::text`, a.TeamID, a.ID, in.Kind, in.Title, in.Link, in.Date).Scan(&item.ID)
	if err != nil {
		return BragItem{}, fmt.Errorf("add brag: %w", mapConstraint(err))
	}
	return item, nil
}

// DeleteBrag скрывает запись, чтобы автосбор не вернул удалённую задачу.
func (s *Store) DeleteBrag(ctx context.Context, a Actor, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE brag_items SET deleted_at=now()
 WHERE id=$1 AND user_id=$2 AND team_id=$3 AND deleted_at IS NULL`, id, a.ID, a.TeamID)
	if err != nil {
		return fmt.Errorf("delete brag: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

/* ---------- feedback ---------- */

const feedbackColumns = `id::text,requester_id::text,recipient_id::text,artifact_url,artifact_title,question,answer,sent_at,expires_at,answered_at,saved_to_brag,external_id`

func (s *Store) scanFeedback(row pgx.Row) (FeedbackRequest, error) {
	var f FeedbackRequest
	err := row.Scan(&f.ID, &f.FromID, &f.ToID, &f.ArtifactURL, &f.ArtifactTitle, &f.Question, &f.Answer,
		&f.SentAt, &f.ExpiresAt, &f.AnsweredAt, &f.SavedToBrag, &f.ExternalID)
	f.Status = FeedbackStatus(f.Answer != nil, f.ExpiresAt, s.now())
	return f, err
}

// ListFeedback возвращает запросы, которые пользователь отправил или получил.
func (s *Store) ListFeedback(ctx context.Context, a Actor) ([]FeedbackRequest, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+feedbackColumns+` FROM feedback_requests
 WHERE team_id=$1 AND (requester_id=$2 OR recipient_id=$2) ORDER BY sent_at DESC LIMIT $3`, a.TeamID, a.ID, listMax)
	if err != nil {
		return nil, fmt.Errorf("list feedback: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (FeedbackRequest, error) { return s.scanFeedback(row) })
	if err != nil {
		return nil, fmt.Errorf("read feedback: %w", err)
	}
	return items, nil
}

// CreateFeedback держит не больше MaxOpenPerPerson открытых запросов одному адресату.
// Адресата можно передать UUID пользователя или кодом сотрудника из моков (oleg).
func (s *Store) CreateFeedback(ctx context.Context, a Actor, in FeedbackInput) (FeedbackRequest, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FeedbackRequest{}, fmt.Errorf("begin feedback: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	toID, err := resolveRecipient(ctx, tx, a.TeamID, in.ToID)
	if err != nil {
		return FeedbackRequest{}, err
	}
	in.ToID = toID
	if in.ToID == a.ID {
		return FeedbackRequest{}, ErrInvalid
	}
	var recipient string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND team_id=$2 AND active FOR SHARE`, in.ToID, a.TeamID).Scan(&recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedbackRequest{}, ErrNotFound
	}
	if err != nil {
		return FeedbackRequest{}, fmt.Errorf("check feedback recipient: %w", err)
	}
	// Блокировка пары отправитель-адресат сериализует проверку лимита.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1||':'||$2))`, a.ID, in.ToID); err != nil {
		return FeedbackRequest{}, fmt.Errorf("lock feedback: %w", err)
	}
	now := s.now()
	var open int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM feedback_requests
 WHERE requester_id=$1 AND recipient_id=$2 AND answer IS NULL AND expires_at>$3`, a.ID, in.ToID, now).Scan(&open); err != nil {
		return FeedbackRequest{}, fmt.Errorf("count open feedback: %w", err)
	}
	if open >= MaxOpenPerPerson {
		return FeedbackRequest{}, ErrLimit
	}
	created, err := s.scanFeedback(tx.QueryRow(ctx, `INSERT INTO feedback_requests
 (team_id,requester_id,recipient_id,artifact_url,artifact_title,question,sent_at,expires_at,external_id)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+feedbackColumns,
		a.TeamID, a.ID, in.ToID, in.ArtifactURL, in.ArtifactTitle, in.Question, now, now.Add(FeedbackLifetime), in.ExternalID))
	if err != nil {
		return FeedbackRequest{}, fmt.Errorf("create feedback: %w", mapConstraint(err))
	}
	if err := tx.Commit(ctx); err != nil {
		return FeedbackRequest{}, fmt.Errorf("commit feedback: %w", err)
	}
	return created, nil
}

// AnswerFeedback доступен только адресату и только пока запрос открыт.
func (s *Store) AnswerFeedback(ctx context.Context, a Actor, id, answer string) (FeedbackRequest, error) {
	f, err := s.scanFeedback(s.pool.QueryRow(ctx, `UPDATE feedback_requests SET answer=$4,answered_at=$5
 WHERE id=$1 AND recipient_id=$2 AND team_id=$3 AND answer IS NULL AND expires_at>$5 RETURNING `+feedbackColumns,
		id, a.ID, a.TeamID, answer, s.now()))
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedbackRequest{}, s.feedbackMiss(ctx, a, id)
	}
	if err != nil {
		return FeedbackRequest{}, fmt.Errorf("answer feedback: %w", mapConstraint(err))
	}
	return f, nil
}

// MarkFeedbackSaved отмечает, что отправитель перенёс ответ в brag document.
func (s *Store) MarkFeedbackSaved(ctx context.Context, a Actor, id string) (FeedbackRequest, error) {
	f, err := s.scanFeedback(s.pool.QueryRow(ctx, `UPDATE feedback_requests SET saved_to_brag=true
 WHERE id=$1 AND requester_id=$2 AND team_id=$3 AND answer IS NOT NULL RETURNING `+feedbackColumns, id, a.ID, a.TeamID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedbackRequest{}, s.feedbackMiss(ctx, a, id)
	}
	if err != nil {
		return FeedbackRequest{}, fmt.Errorf("mark feedback saved: %w", err)
	}
	return f, nil
}

// feedbackMiss отличает чужой или несуществующий запрос (404) от неподходящего состояния (409).
func (s *Store) feedbackMiss(ctx context.Context, a Actor, id string) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM feedback_requests
 WHERE id=$1 AND team_id=$2 AND (requester_id=$3 OR recipient_id=$3))`, id, a.TeamID, a.ID).Scan(&exists); err != nil {
		return fmt.Errorf("check feedback: %w", err)
	}
	if exists {
		return ErrConflict
	}
	return ErrNotFound
}

/* ---------- events ---------- */

func (s *Store) ListEvents(ctx context.Context, a Actor) ([]Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT e.id::text,e.kind,e.title,e.description,e.starts_at,e.minutes,e.place_id,e.place_name,
 e.host_id::text,e.tags,e.capacity,e.materials,
 COALESCE((SELECT array_agg(ea.user_id::text ORDER BY ea.joined_at) FROM event_attendees ea WHERE ea.event_id=e.id),'{}')
 FROM community_events e WHERE e.team_id=$1 AND e.starts_at > now() - interval '30 days'
 ORDER BY e.starts_at,e.id LIMIT $2`, a.TeamID, listMax)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	events, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Event, error) {
		var e Event
		err := row.Scan(&e.ID, &e.Kind, &e.Title, &e.Description, &e.Start, &e.Minutes, &e.PlaceID, &e.PlaceName,
			&e.HostID, &e.Tags, &e.Capacity, &e.Materials, &e.Attendees)
		return e, err
	})
	if err != nil {
		return nil, fmt.Errorf("read events: %w", err)
	}
	return events, nil
}

// JoinEvent идемпотентна: повторная запись не занимает второе место.
func (s *Store) JoinEvent(ctx context.Context, a Actor, eventID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin join: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var capacity *int
	var startsAt time.Time
	err = tx.QueryRow(ctx, `SELECT capacity,starts_at FROM community_events WHERE id=$1 AND team_id=$2 FOR UPDATE`, eventID, a.TeamID).Scan(&capacity, &startsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock event: %w", err)
	}
	if !startsAt.After(s.now()) {
		return ErrConflict
	}
	var joined bool
	var taken int
	if err := tx.QueryRow(ctx, `SELECT bool_or(user_id=$2) IS TRUE,count(*) FROM event_attendees WHERE event_id=$1`, eventID, a.ID).Scan(&joined, &taken); err != nil {
		return fmt.Errorf("count attendees: %w", err)
	}
	if joined {
		return nil
	}
	if capacity != nil && taken >= *capacity {
		return ErrLimit
	}
	if _, err := tx.Exec(ctx, `INSERT INTO event_attendees(event_id,team_id,user_id) VALUES ($1,$2,$3)`, eventID, a.TeamID, a.ID); err != nil {
		return fmt.Errorf("join event: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit join: %w", err)
	}
	return nil
}

func (s *Store) LeaveEvent(ctx context.Context, a Actor, eventID string) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_events WHERE id=$1 AND team_id=$2)`, eventID, a.TeamID).Scan(&exists); err != nil {
		return fmt.Errorf("check event: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM event_attendees WHERE event_id=$1 AND user_id=$2`, eventID, a.ID); err != nil {
		return fmt.Errorf("leave event: %w", err)
	}
	return nil
}

/* ---------- interests ---------- */

func (s *Store) Interests(ctx context.Context, a Actor) (Interests, error) {
	result := Interests{Tags: []string{}, Groups: []InterestGroup{}}
	rows, err := s.pool.Query(ctx, `SELECT tag FROM user_interests WHERE user_id=$1 ORDER BY created_at,tag`, a.ID)
	if err != nil {
		return result, fmt.Errorf("list interests: %w", err)
	}
	if result.Tags, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return result, fmt.Errorf("read interests: %w", err)
	}
	// Группа - тег, который разделяют хотя бы двое в команде, включая самого пользователя.
	rows, err = s.pool.Query(ctx, `SELECT ui.tag,array_agg(ui.user_id::text ORDER BY ui.user_id) FROM user_interests ui
 JOIN users u ON u.id=ui.user_id AND u.active
 WHERE ui.team_id=$1 AND ui.tag IN (SELECT tag FROM user_interests WHERE user_id=$2)
 GROUP BY ui.tag HAVING count(*)>1 ORDER BY count(*) DESC,ui.tag`, a.TeamID, a.ID)
	if err != nil {
		return result, fmt.Errorf("list interest groups: %w", err)
	}
	groups, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (InterestGroup, error) {
		var g InterestGroup
		err := row.Scan(&g.Tag, &g.Members)
		return g, err
	})
	if err != nil {
		return result, fmt.Errorf("read interest groups: %w", err)
	}
	result.Groups = groups
	return result, nil
}

// SaveInterests заменяет набор тегов целиком; теги уже нормализованы NormalizeTags.
func (s *Store) SaveInterests(ctx context.Context, a Actor, tags []string) (Interests, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Interests{}, fmt.Errorf("begin interests: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `DELETE FROM user_interests WHERE user_id=$1 AND NOT (tag = ANY($2))`, a.ID, tags); err != nil {
		return Interests{}, fmt.Errorf("drop interests: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO user_interests(user_id,team_id,tag)
 SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`, a.ID, a.TeamID, tags); err != nil {
		return Interests{}, fmt.Errorf("save interests: %w", mapConstraint(err))
	}
	if err := tx.Commit(ctx); err != nil {
		return Interests{}, fmt.Errorf("commit interests: %w", err)
	}
	return s.Interests(ctx, a)
}

/* ---------- tracks ---------- */

func (s *Store) Tracks(ctx context.Context, a Actor) (Tracks, bool, error) {
	var selected, modules []byte
	err := s.pool.QueryRow(ctx, `SELECT selected,modules FROM user_tracks WHERE user_id=$1 AND team_id=$2`, a.ID, a.TeamID).Scan(&selected, &modules)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tracks{Selected: []string{}, Modules: map[string]json.RawMessage{}}, false, nil
	}
	if err != nil {
		return Tracks{}, false, fmt.Errorf("read tracks: %w", err)
	}
	var t Tracks
	if json.Unmarshal(selected, &t.Selected) != nil || json.Unmarshal(modules, &t.Modules) != nil {
		return Tracks{}, false, errors.New("decode tracks")
	}
	return t, true, nil
}

func (s *Store) SaveTracks(ctx context.Context, a Actor, t Tracks) (Tracks, error) {
	selected, err := json.Marshal(t.Selected)
	if err != nil {
		return Tracks{}, fmt.Errorf("encode tracks: %w", err)
	}
	modules, err := json.Marshal(t.Modules)
	if err != nil {
		return Tracks{}, fmt.Errorf("encode modules: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO user_tracks(user_id,team_id,selected,modules,updated_at) VALUES ($1,$2,$3,$4,now())
 ON CONFLICT (user_id) DO UPDATE SET selected=EXCLUDED.selected,modules=EXCLUDED.modules,updated_at=now()`,
		a.ID, a.TeamID, selected, modules); err != nil {
		return Tracks{}, fmt.Errorf("save tracks: %w", err)
	}
	return t, nil
}

/* ---------- meetings ---------- */

func (s *Store) Meetings(ctx context.Context, a Actor) (map[string]MeetingRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT meeting_key,summary,agreements,saved_at,task_count FROM meeting_notes
 WHERE user_id=$1 AND team_id=$2 ORDER BY saved_at DESC LIMIT $3`, a.ID, a.TeamID, listMax)
	if err != nil {
		return nil, fmt.Errorf("list meetings: %w", err)
	}
	records, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (MeetingRecord, error) {
		var r MeetingRecord
		var agreements []byte
		if err := row.Scan(&r.MeetingID, &r.Summary, &agreements, &r.SavedAt, &r.TaskCount); err != nil {
			return r, err
		}
		return r, json.Unmarshal(agreements, &r.Agreements)
	})
	if err != nil {
		return nil, fmt.Errorf("read meetings: %w", err)
	}
	result := make(map[string]MeetingRecord, len(records))
	for _, r := range records {
		result[r.MeetingID] = r
	}
	return result, nil
}

// SaveMeeting сохраняет итоги и добавляет договорённости в активный план стажёра
// в текущий этап. Повторное сохранение не дублирует задачи.
func (s *Store) SaveMeeting(ctx context.Context, a Actor, key string, d MeetingDraft) (MeetingRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MeetingRecord{}, fmt.Errorf("begin meeting: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var planID, stage string
	var buddyID *string
	err = tx.QueryRow(ctx, `SELECT p.id::text,p.current_stage,i.buddy_id::text FROM onboarding_plans p
 JOIN users i ON i.id=p.intern_id AND i.team_id=p.team_id
 WHERE p.intern_id=$1 AND p.team_id=$2 AND p.status='active' FOR UPDATE OF p`, a.ID, a.TeamID).Scan(&planID, &stage, &buddyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MeetingRecord{}, ErrNotFound
	}
	if err != nil {
		return MeetingRecord{}, fmt.Errorf("lock plan: %w", err)
	}
	created := 0
	for _, task := range AgreementTasks(key, d.Agreements) {
		assignee := a.ID
		if task.ForMentor && buddyID != nil {
			assignee = *buddyID
		}
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO tasks(team_id,plan_id,assignee_id,seed_key,stage,title,description,position,due_date)
 SELECT $1,$2,$3,$4,$5,$6,$7,COALESCE(max(position)+1,0),$8::date FROM tasks WHERE plan_id=$2 AND stage=$5
 ON CONFLICT (plan_id,seed_key) DO NOTHING RETURNING id::text`,
			a.TeamID, planID, assignee, task.SeedKey, stage, task.Title, task.Description, task.DueDate).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return MeetingRecord{}, fmt.Errorf("add meeting task: %w", mapConstraint(err))
		}
		if _, err := tx.Exec(ctx, `INSERT INTO task_status_history(task_id,version,from_status,to_status,changed_by,reason)
 VALUES ($1,1,NULL,'todo',$2,'meeting')`, id, a.ID); err != nil {
			return MeetingRecord{}, fmt.Errorf("add meeting task history: %w", err)
		}
		created++
	}
	agreements, err := json.Marshal(d.Agreements)
	if err != nil {
		return MeetingRecord{}, fmt.Errorf("encode agreements: %w", err)
	}
	record := MeetingRecord{MeetingID: key, Summary: d.Summary, Agreements: d.Agreements}
	err = tx.QueryRow(ctx, `INSERT INTO meeting_notes(user_id,team_id,meeting_key,summary,agreements,task_count,saved_at)
 VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (user_id,meeting_key) DO UPDATE
 SET summary=EXCLUDED.summary,agreements=EXCLUDED.agreements,task_count=meeting_notes.task_count+EXCLUDED.task_count,saved_at=now()
 RETURNING saved_at,task_count`, a.ID, a.TeamID, key, d.Summary, agreements, created).Scan(&record.SavedAt, &record.TaskCount)
	if err != nil {
		return MeetingRecord{}, fmt.Errorf("save meeting: %w", mapConstraint(err))
	}
	if err := tx.Commit(ctx); err != nil {
		return MeetingRecord{}, fmt.Errorf("commit meeting: %w", err)
	}
	return record, nil
}

/* ---------- coffee ---------- */

func (s *Store) CoffeePairs(ctx context.Context, a Actor) ([]CoffeePair, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,week_start::text,CASE WHEN user_a=$1 THEN user_b ELSE user_a END::text,status
 FROM coffee_pairs WHERE team_id=$2 AND (user_a=$1 OR user_b=$1) ORDER BY week_start DESC LIMIT 12`, a.ID, a.TeamID)
	if err != nil {
		return nil, fmt.Errorf("list coffee pairs: %w", err)
	}
	pairs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CoffeePair, error) {
		var p CoffeePair
		err := row.Scan(&p.ID, &p.WeekStart, &p.PartnerID, &p.Status)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("read coffee pairs: %w", err)
	}
	return pairs, nil
}

// SaveCoffeePairs записывает пары недели. Вызывает планировщик; повтор не дублирует пары.
func (s *Store) SaveCoffeePairs(ctx context.Context, teamID, weekStart string, pairs []Pair) error {
	batch := &pgx.Batch{}
	for _, p := range pairs {
		p = orderedPair(p.A, p.B)
		batch.Queue(`INSERT INTO coffee_pairs(team_id,week_start,user_a,user_b) VALUES ($1,$2::date,$3,$4) ON CONFLICT DO NOTHING`,
			teamID, weekStart, p.A, p.B)
	}
	if err := s.pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("save coffee pairs: %w", mapConstraint(err))
	}
	return nil
}

// mapConstraint переводит нарушение CHECK/FK в ErrInvalid: это ошибка ввода, а не сбой БД.
func mapConstraint(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23514" || pgErr.Code == "23503" || pgErr.Code == "22007" || pgErr.Code == "22008") {
		return ErrInvalid
	}
	return err
}

// resolveRecipient переводит код сотрудника в UUID пользователя своей команды или общих.
// Сотрудник без учётной записи в AI-buddy не может получить запрос: ErrNotFound.
func resolveRecipient(ctx context.Context, tx pgx.Tx, teamID, to string) (string, error) {
	if identifier.ValidUUID(to) {
		return to, nil
	}
	var userID string
	err := tx.QueryRow(ctx, `SELECT user_id::text FROM corp_employees
 WHERE code=$1 AND (team_id=$2 OR team_id IS NULL) AND user_id IS NOT NULL`, to, teamID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve feedback recipient: %w", err)
	}
	return userID, nil
}
