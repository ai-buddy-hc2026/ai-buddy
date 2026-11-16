package mocks

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier - общая часть pgxpool.Pool и pgx.Tx: запросы работают в любой транзакции.
type Querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type Slot struct {
	ID       string    `json:"id"`
	HostCode string    `json:"host_code"`
	StartsAt time.Time `json:"starts_at"`
	Minutes  int       `json:"minutes"`
	BookedBy *string   `json:"booked_by"`
	Topic    string    `json:"topic"`
}

type Booking struct {
	ID         string    `json:"id"`
	SlotID     string    `json:"slot_id"`
	HostCode   string    `json:"host_code"`
	AttendeeID string    `json:"attendee_id"`
	StartsAt   time.Time `json:"starts_at"`
	Topic      string    `json:"topic"`
}

type Course struct {
	Code        string     `json:"code"`
	Title       string     `json:"title"`
	Required    bool       `json:"required"`
	DueDays     int        `json:"due_days"`
	Minutes     int        `json:"minutes"`
	CompletedAt *time.Time `json:"completed_at"`
}

type Access struct {
	System       string     `json:"system"`
	Title        string     `json:"title"`
	About        string     `json:"about"`
	ApproverCode *string    `json:"approver_code"`
	Status       string     `json:"status"`
	RequestID    *string    `json:"request_id"`
	ReadyAt      *time.Time `json:"ready_at"`
}

const employeeColumns = `code,team_id::text,user_id::text,name,title,kind,tags,ask_about,birthday,desk_id`

func scanEmployee(row pgx.Row) (Employee, error) {
	var e Employee
	err := row.Scan(&e.Code, &e.TeamID, &e.UserID, &e.Name, &e.Title, &e.Kind, &e.Tags, &e.AskAbout, &e.Birthday, &e.DeskID)
	return e, err
}

// TeamEmployees возвращает сотрудников команды и общих (HR) без чужих команд.
func TeamEmployees(ctx context.Context, db Querier, teamID string) ([]Employee, error) {
	rows, err := db.Query(ctx, `SELECT `+employeeColumns+` FROM corp_employees WHERE team_id=$1 OR team_id IS NULL ORDER BY team_id NULLS LAST,code`, teamID)
	if err != nil {
		return nil, fmt.Errorf("query employees: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Employee, error) { return scanEmployee(row) })
}

// MentorCode - карточка наставника пользователя, иначе руководителя.
func MentorCode(ctx context.Context, db Querier, userID string) (string, error) {
	var code string
	err := db.QueryRow(ctx, `SELECT e.code FROM users u JOIN corp_employees e ON e.user_id IN (u.buddy_id,u.manager_id)
 WHERE u.id=$1 ORDER BY (e.user_id=u.buddy_id) DESC NULLS LAST LIMIT 1`, userID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("query mentor: %w", err)
	}
	return code, nil
}

// FirstDay - данные пребординга пользователя или nil.
func FirstDay(ctx context.Context, db Querier, userID string) ([]byte, error) {
	var raw []byte
	err := db.QueryRow(ctx, `SELECT first_day FROM corp_employees WHERE user_id=$1`, userID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query first day: %w", err)
	}
	return raw, nil
}

func visibleHost(ctx context.Context, db Querier, teamID, hostCode string) (Employee, error) {
	e, err := scanEmployee(db.QueryRow(ctx, `SELECT `+employeeColumns+` FROM corp_employees WHERE code=$1 AND (team_id=$2 OR team_id IS NULL)`, hostCode, teamID))
	if errors.Is(err, pgx.ErrNoRows) {
		return e, tools.ErrNotFound
	}
	return e, err
}

// FreeSlots - будущие свободные слоты сотрудника, видимого команде.
func FreeSlots(ctx context.Context, db Querier, teamID, hostCode string, now time.Time) (Employee, []Slot, error) {
	host, err := visibleHost(ctx, db, teamID, hostCode)
	if err != nil {
		return host, nil, err
	}
	rows, err := db.Query(ctx, `SELECT s.id::text,s.host_code,s.starts_at,s.minutes FROM calendar_slots s
 LEFT JOIN calendar_bookings b ON b.slot_id=s.id WHERE s.host_code=$1 AND s.starts_at>$2 AND b.id IS NULL ORDER BY s.starts_at LIMIT 50`, hostCode, now)
	if err != nil {
		return host, nil, fmt.Errorf("query slots: %w", err)
	}
	slots, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Slot, error) {
		var s Slot
		err := row.Scan(&s.ID, &s.HostCode, &s.StartsAt, &s.Minutes)
		s.StartsAt = s.StartsAt.UTC()
		return s, err
	})
	return host, slots, err
}

// MyBookings - слоты, занятые пользователем, начиная с now.
func MyBookings(ctx context.Context, db Querier, userID string, now time.Time) ([]Slot, error) {
	rows, err := db.Query(ctx, `SELECT s.id::text,s.host_code,s.starts_at,s.minutes,b.attendee_id::text,b.topic FROM calendar_bookings b
 JOIN calendar_slots s ON s.id=b.slot_id WHERE b.attendee_id=$1 AND s.starts_at>$2 ORDER BY s.starts_at LIMIT 100`, userID, now)
	if err != nil {
		return nil, fmt.Errorf("query bookings: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Slot, error) {
		var s Slot
		err := row.Scan(&s.ID, &s.HostCode, &s.StartsAt, &s.Minutes, &s.BookedBy, &s.Topic)
		s.StartsAt = s.StartsAt.UTC()
		return s, err
	})
}

// CheckSlot блокирует слот и проверяет, что он видим, в будущем и свободен.
func CheckSlot(ctx context.Context, db Querier, teamID, slotID string, now time.Time) (Slot, error) {
	var s Slot
	var booked bool
	err := db.QueryRow(ctx, `SELECT s.id::text,s.host_code,s.starts_at,s.minutes,EXISTS(SELECT 1 FROM calendar_bookings b WHERE b.slot_id=s.id)
 FROM calendar_slots s JOIN corp_employees e ON e.code=s.host_code WHERE s.id=$1 AND (e.team_id=$2 OR e.team_id IS NULL) FOR UPDATE OF s`, slotID, teamID).Scan(&s.ID, &s.HostCode, &s.StartsAt, &s.Minutes, &booked)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, tools.ErrNotFound
	}
	if err != nil {
		return s, fmt.Errorf("check slot: %w", err)
	}
	s.StartsAt = s.StartsAt.UTC()
	if booked || !s.StartsAt.After(now) {
		return s, tools.ErrBusinessConflict
	}
	return s, nil
}

// Book занимает слот. Занятый слот - tools.ErrBusinessConflict (HTTP 409).
func Book(ctx context.Context, db Querier, teamID, slotID, attendeeID, topic string, actionID *string, now time.Time) (Booking, error) {
	slot, err := CheckSlot(ctx, db, teamID, slotID, now)
	if err != nil {
		return Booking{}, err
	}
	var id int64
	err = db.QueryRow(ctx, `INSERT INTO calendar_bookings(slot_id,attendee_id,topic,action_id) VALUES($1,$2,$3,$4) RETURNING id`, slotID, attendeeID, topic, actionID).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Booking{}, tools.ErrBusinessConflict
	}
	if err != nil {
		return Booking{}, fmt.Errorf("insert booking: %w", err)
	}
	return Booking{ID: fmt.Sprintf("BOOK-%04d", id), SlotID: slotID, HostCode: slot.HostCode, AttendeeID: attendeeID, StartsAt: slot.StartsAt, Topic: topic}, nil
}

// Courses - каталог курсов с отметкой прохождения пользователем.
func Courses(ctx context.Context, db Querier, userID string) ([]Course, error) {
	rows, err := db.Query(ctx, `SELECT c.code,c.title,c.required,c.due_days,c.minutes,p.completed_at FROM learning_courses c
 LEFT JOIN learning_progress p ON p.course_code=c.code AND p.user_id=$1 ORDER BY c.required DESC,c.due_days,c.code`, userID)
	if err != nil {
		return nil, fmt.Errorf("query courses: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Course, error) {
		var c Course
		err := row.Scan(&c.Code, &c.Title, &c.Required, &c.DueDays, &c.Minutes, &c.CompletedAt)
		return c, err
	})
}

// CompleteCourse отмечает курс пройденным; повтор не меняет дату.
func CompleteCourse(ctx context.Context, db Querier, userID, code string) error {
	tag, err := db.Exec(ctx, `INSERT INTO learning_progress(user_id,course_code) SELECT $1,code FROM learning_courses WHERE code=$2 ON CONFLICT DO NOTHING`, userID, code)
	if err != nil {
		return fmt.Errorf("complete course: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM learning_courses WHERE code=$1)`, code).Scan(&exists); err != nil {
			return fmt.Errorf("check course: %w", err)
		}
		if !exists {
			return tools.ErrNotFound
		}
	}
	return nil
}

// AccessPackage - пакет доступов роли со статусами заявок пользователя.
func AccessPackage(ctx context.Context, db Querier, userID, role string, now time.Time) ([]Access, error) {
	rows, err := db.Query(ctx, `SELECT s.code,s.title,s.about,s.approver_code,s.grant_after_sec,r.id,r.requested_at FROM role_access_templates t
 JOIN access_systems s ON s.code=t.system_code LEFT JOIN access_requests r ON r.system_code=s.code AND r.user_id=$1
 WHERE t.role=$2 ORDER BY s.code`, userID, role)
	if err != nil {
		return nil, fmt.Errorf("query access: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Access, error) {
		var a Access
		var after *int
		var id *int64
		var requested *time.Time
		if err := row.Scan(&a.System, &a.Title, &a.About, &a.ApproverCode, &after, &id, &requested); err != nil {
			return a, err
		}
		a.Status, a.ReadyAt = AccessStatus(requested, after, now)
		if id != nil {
			ref := accessRef(*id)
			a.RequestID = &ref
		}
		return a, nil
	})
}

// CheckAccess проверяет, что система входит в пакет роли и еще не запрошена.
func CheckAccess(ctx context.Context, db Querier, userID, role, system string) error {
	var inTemplate, requested bool
	err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM role_access_templates WHERE role=$1 AND system_code=$2),
 EXISTS(SELECT 1 FROM access_requests WHERE user_id=$3 AND system_code=$2)`, role, system, userID).Scan(&inTemplate, &requested)
	if err != nil {
		return fmt.Errorf("check access: %w", err)
	}
	if !inTemplate {
		return tools.ErrNotFound
	}
	if requested {
		return tools.ErrBusinessConflict
	}
	return nil
}

// RequestAccess создает заявку и возвращает ее состояние по таймеру мока.
func RequestAccess(ctx context.Context, db Querier, userID, role, system string, actionID *string, now time.Time) (Access, error) {
	if err := CheckAccess(ctx, db, userID, role, system); err != nil {
		return Access{}, err
	}
	var id int64
	err := db.QueryRow(ctx, `INSERT INTO access_requests(user_id,system_code,action_id,requested_at) VALUES($1,$2,$3,$4) RETURNING id`, userID, system, actionID, now).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Access{}, tools.ErrBusinessConflict
	}
	if err != nil {
		return Access{}, fmt.Errorf("insert access request: %w", err)
	}
	items, err := AccessPackage(ctx, db, userID, role, now)
	if err != nil {
		return Access{}, err
	}
	for _, item := range items {
		if item.System == system {
			return item, nil
		}
	}
	return Access{}, tools.ErrNotFound
}

func accessRef(id int64) string { return fmt.Sprintf("ACC-%04d", id) }

// Places - все точки карты офиса.
func Places(ctx context.Context, db Querier) ([]Place, error) {
	rows, err := db.Query(ctx, `SELECT id,floor,kind,name,aliases,x::float8,y::float8,w::float8,d::float8,employee_code,node_id FROM map_places ORDER BY kind<>'desk' DESC,id`)
	if err != nil {
		return nil, fmt.Errorf("query places: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Place, error) {
		var p Place
		err := row.Scan(&p.ID, &p.Floor, &p.Kind, &p.Name, &p.Aliases, &p.X, &p.Y, &p.W, &p.D, &p.EmployeeCode, &p.NodeID)
		return p, err
	})
}
