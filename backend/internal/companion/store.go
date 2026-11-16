package companion

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	notificationLimit = 50
	telegramCodeBytes = 4
)

// Store - хранилище компаньона поверх Postgres.
type Store struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewStore(pool *pgxpool.Pool, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{pool: pool, now: now}
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadSettings(ctx context.Context, q rowQuerier, u auth.User) (Settings, error) {
	zone := u.Timezone
	if zone == "" {
		zone = u.Team.Timezone
	}
	settings := Defaults(zone)
	var raw []byte
	err := q.QueryRow(ctx, "SELECT settings FROM user_settings WHERE user_id = $1 AND team_id = $2", u.ID, u.Team.ID).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return settings, fmt.Errorf("load settings: %w", err)
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &settings); err != nil {
			return Defaults(zone), fmt.Errorf("decode settings: %w", err)
		}
	}
	if settings.WorkHours.Validate() != nil {
		settings.WorkHours = Defaults(zone).WorkHours
	}
	return settings, nil
}

func (s *Store) View(ctx context.Context, u auth.User) (View, error) {
	settings, err := loadSettings(ctx, s.pool, u)
	if err != nil {
		return View{}, err
	}
	view := View{Settings: settings}
	today := settings.WorkHours.LocalDay(s.now())
	err = s.pool.QueryRow(ctx, `SELECT
		(SELECT day::text FROM user_day_status WHERE user_id = $1 AND team_id = $2 AND day = $3::date),
		EXISTS (SELECT 1 FROM telegram_links WHERE user_id = $1),
		COALESCE((SELECT buddy_enabled FROM pilot_assignments WHERE user_id = $1), true)`,
		u.ID, u.Team.ID, today).Scan(&view.NotMyDayDate, &view.TelegramLinked, &view.BuddyEnabled)
	if err != nil {
		return View{}, fmt.Errorf("load settings view: %w", err)
	}
	return view, nil
}

func (s *Store) Save(ctx context.Context, u auth.User, settings Settings) (View, error) {
	if err := settings.Validate(); err != nil {
		return View{}, err
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return View{}, fmt.Errorf("encode settings: %w", err)
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO user_settings (user_id, team_id, settings) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`, u.ID, u.Team.ID, raw)
	if err != nil {
		return View{}, fmt.Errorf("save settings: %w", err)
	}
	return s.View(ctx, u)
}

// SetDayMode включает или снимает «Не мой день» на локальную дату пользователя.
// Счётчик day_mode_totals растёт только при первом включении за день.
func (s *Store) SetDayMode(ctx context.Context, u auth.User, enabled bool) (View, error) {
	if u.Role != "intern" {
		return View{}, ErrDenied
	}
	settings, err := loadSettings(ctx, s.pool, u)
	if err != nil {
		return View{}, err
	}
	today := settings.WorkHours.LocalDay(s.now())
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return View{}, fmt.Errorf("begin day mode: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if enabled {
		tag, err := tx.Exec(ctx, `INSERT INTO user_day_status (user_id, team_id, day, mode)
			VALUES ($1, $2, $3::date, 'not_my_day') ON CONFLICT DO NOTHING`, u.ID, u.Team.ID, today)
		if err != nil {
			return View{}, fmt.Errorf("enable day mode: %w", err)
		}
		if tag.RowsAffected() == 1 {
			if _, err := tx.Exec(ctx, `INSERT INTO day_mode_totals (day, presses) VALUES ($1::date, 1)
				ON CONFLICT (day) DO UPDATE SET presses = day_mode_totals.presses + 1`, today); err != nil {
				return View{}, fmt.Errorf("count day mode: %w", err)
			}
		}
	} else if _, err := tx.Exec(ctx, "DELETE FROM user_day_status WHERE user_id = $1 AND team_id = $2 AND day = $3::date", u.ID, u.Team.ID, today); err != nil {
		return View{}, fmt.Errorf("disable day mode: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return View{}, fmt.Errorf("commit day mode: %w", err)
	}
	return s.View(ctx, u)
}

// Notifications отдаёт только уже доставленные (deliver_at <= now) записи.
func (s *Store) Notifications(ctx context.Context, userID string, unreadOnly bool) (NotificationPage, error) {
	now := s.now()
	rows, err := s.pool.Query(ctx, `SELECT id, feature, title, body, deliver_at, read_at, created_at
		FROM notifications WHERE user_id = $1 AND deliver_at <= $2 AND (NOT $3 OR read_at IS NULL)
		ORDER BY deliver_at DESC, id LIMIT $4`, userID, now, unreadOnly, notificationLimit)
	if err != nil {
		return NotificationPage{}, fmt.Errorf("list notifications: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Notification, error) {
		var n Notification
		err := row.Scan(&n.ID, &n.Feature, &n.Title, &n.Body, &n.DeliverAt, &n.ReadAt, &n.CreatedAt)
		return n, err
	})
	if err != nil {
		return NotificationPage{}, fmt.Errorf("scan notifications: %w", err)
	}
	page := NotificationPage{Items: items}
	err = s.pool.QueryRow(ctx, "SELECT count(*) FROM notifications WHERE user_id = $1 AND deliver_at <= $2 AND read_at IS NULL", userID, now).Scan(&page.UnreadCount)
	if err != nil {
		return NotificationPage{}, fmt.Errorf("count notifications: %w", err)
	}
	return page, nil
}

func (s *Store) MarkRead(ctx context.Context, userID, id string) (Notification, error) {
	var n Notification
	err := s.pool.QueryRow(ctx, `UPDATE notifications SET read_at = COALESCE(read_at, now())
		WHERE id = $1 AND user_id = $2 AND deliver_at <= $3
		RETURNING id, feature, title, body, deliver_at, read_at, created_at`, id, userID, s.now()).
		Scan(&n.ID, &n.Feature, &n.Title, &n.Body, &n.DeliverAt, &n.ReadAt, &n.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotFound
	}
	if err != nil {
		return Notification{}, fmt.Errorf("mark notification read: %w", err)
	}
	return n, nil
}

// Pilot сравнивает стажёров с buddy и контрольную группу одной команды. Доступно лиду.
func (s *Store) Pilot(ctx context.Context, u auth.User) (PilotReport, error) {
	if u.Role != "lead" {
		return PilotReport{}, ErrDenied
	}
	rows, err := s.pool.Query(ctx, `SELECT COALESCE(p.buddy_enabled, true), count(DISTINCT u.id),
			count(t.id) FILTER (WHERE t.status = 'done'), count(t.id)
		FROM users u
		LEFT JOIN pilot_assignments p ON p.user_id = u.id
		LEFT JOIN tasks t ON t.assignee_id = u.id
		WHERE u.team_id = $1 AND u.role = 'intern' AND u.active
		GROUP BY 1`, u.Team.ID)
	if err != nil {
		return PilotReport{}, fmt.Errorf("pilot report: %w", err)
	}
	defer rows.Close()
	var report PilotReport
	for rows.Next() {
		var enabled bool
		var group PilotGroup
		if err := rows.Scan(&enabled, &group.Interns, &group.TasksDone, &group.TasksTotal); err != nil {
			return PilotReport{}, fmt.Errorf("scan pilot report: %w", err)
		}
		if group.TasksTotal > 0 {
			group.CompletionPct = float64(group.TasksDone) * 100 / float64(group.TasksTotal)
		}
		if enabled {
			report.WithBuddy = group
		} else {
			report.Control = group
		}
	}
	if err := rows.Err(); err != nil {
		return PilotReport{}, fmt.Errorf("read pilot report: %w", err)
	}
	err = s.pool.QueryRow(ctx, "SELECT COALESCE(sum(presses), 0) FROM day_mode_totals").Scan(&report.NotMyDayDays)
	if err != nil {
		return PilotReport{}, fmt.Errorf("day mode totals: %w", err)
	}
	return report, nil
}

// Unanswered считает вопросы без ответа по категориям, без автора и текста.
func (s *Store) Unanswered(ctx context.Context, u auth.User, days int) (UnansweredReport, error) {
	if u.Role != "lead" && u.Role != "buddy" {
		return UnansweredReport{}, ErrDenied
	}
	since := s.now().AddDate(0, 0, -days)
	rows, err := s.pool.Query(ctx, `SELECT COALESCE(m.question_category, 'other'), count(*)
		FROM chat_messages m JOIN chat_requests r ON r.id = m.request_id
		WHERE r.team_id = $1 AND m.role = 'assistant' AND m.answer_status = 'unknown' AND m.created_at >= $2
		GROUP BY 1 ORDER BY 2 DESC, 1`, u.Team.ID, since)
	if err != nil {
		return UnansweredReport{}, fmt.Errorf("unanswered report: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (CategoryCount, error) {
		var item CategoryCount
		err := row.Scan(&item.Category, &item.Count)
		return item, err
	})
	if err != nil {
		return UnansweredReport{}, fmt.Errorf("scan unanswered report: %w", err)
	}
	report := UnansweredReport{Days: days, Items: items}
	for _, item := range items {
		report.Total += item.Count
	}
	return report, nil
}

// LinkTelegram - заглушка: бота нет, привязка считается выполненной сразу.
func (s *Store) LinkTelegram(ctx context.Context, u auth.User) (TelegramLink, error) {
	buf := make([]byte, telegramCodeBytes)
	if _, err := rand.Read(buf); err != nil {
		return TelegramLink{}, fmt.Errorf("telegram code: %w", err)
	}
	code := hex.EncodeToString(buf)
	_, err := s.pool.Exec(ctx, `INSERT INTO telegram_links (user_id, code) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, linked_at = now()`, u.ID, code)
	if err != nil {
		return TelegramLink{}, fmt.Errorf("link telegram: %w", err)
	}
	return TelegramLink{Linked: true, Code: &code}, nil
}

func (s *Store) UnlinkTelegram(ctx context.Context, u auth.User) (TelegramLink, error) {
	if _, err := s.pool.Exec(ctx, "DELETE FROM telegram_links WHERE user_id = $1", u.ID); err != nil {
		return TelegramLink{}, fmt.Errorf("unlink telegram: %w", err)
	}
	return TelegramLink{Linked: false}, nil
}

// Recipients - активные пользователи с настройками для планировщика.
func (s *Store) Recipients(ctx context.Context) ([]Recipient, error) {
	rows, err := s.pool.Query(ctx, `SELECT u.id, u.team_id, u.role, u.display_name, COALESCE(u.timezone, t.timezone),
			s.settings, COALESCE((SELECT max(d.day)::text FROM user_day_status d WHERE d.user_id = u.id AND d.day >= current_date - 1), ''),
			COALESCE(p.buddy_enabled, true)
		FROM users u JOIN teams t ON t.id = u.team_id
		LEFT JOIN user_settings s ON s.user_id = u.id
		LEFT JOIN pilot_assignments p ON p.user_id = u.id
		WHERE u.active AND t.active ORDER BY u.id`)
	if err != nil {
		return nil, fmt.Errorf("list recipients: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Recipient, error) {
		var r Recipient
		var zone string
		var raw []byte
		if err := row.Scan(&r.UserID, &r.TeamID, &r.Role, &r.Name, &zone, &raw, &r.NotMyDayDate, &r.BuddyEnabled); err != nil {
			return r, err
		}
		r.Settings = Defaults(zone)
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &r.Settings); err != nil {
				r.Settings = Defaults(zone)
			}
		}
		if r.Settings.WorkHours.Validate() != nil {
			r.Settings.WorkHours = Defaults(zone).WorkHours
		}
		return r, nil
	})
}

// Enqueue добавляет уведомления; дубли по (user_id, dedup_key) пропускаются.
func (s *Store) Enqueue(ctx context.Context, items []Notification) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	batch := &pgx.Batch{}
	for _, n := range items {
		batch.Queue(`INSERT INTO notifications (user_id, team_id, feature, dedup_key, title, body, deliver_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, dedup_key) DO NOTHING`,
			n.UserID, n.TeamID, n.Feature, n.DedupKey, n.Title, n.Body, n.DeliverAt)
	}
	results := s.pool.SendBatch(ctx, batch)
	defer func() { _ = results.Close() }()
	inserted := 0
	for range items {
		tag, err := results.Exec()
		if err != nil {
			return inserted, fmt.Errorf("enqueue notification: %w", err)
		}
		inserted += int(tag.RowsAffected())
	}
	return inserted, nil
}
