package database

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/escalation"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5/pgxpool"
)

const notificationAnya = "a24a3478-cf42-51b1-b05b-9833260247a5"
const notificationIlya = "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"
const notificationPetr = "2db7cc77-4114-52d8-a833-f670ab60e4e0"

func notificationUUID(t *testing.T) string {
	t.Helper()
	id, err := identifier.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func notificationSlot(t *testing.T, pool *pgxpool.Pool, start time.Time, minutes int) string {
	t.Helper()
	id := notificationUUID(t)
	_, err := pool.Exec(context.Background(), `INSERT INTO calendar_slots(id,team_id,employee_id,starts_at,ends_at) VALUES($1,'4496e76d-35da-5cf7-a3d5-c9a89d88c5a2',$2,$3,$4)`, id, notificationIlya, start, start.Add(time.Duration(minutes)*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func notificationFixture(t *testing.T) (*pgxpool.Pool, *Notifications) {
	t.Helper()
	pool := testPool(t)
	if err := prepare(context.Background(), pool, employeeFixtureFS{scripts}, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	s, err := NewNotifications(pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	return pool, s
}
func noticeInput(s notifications.Settings, enabled bool) notifications.SettingsInput {
	return notifications.SettingsInput{Version: &s.Version, Preferences: &notifications.PreferencesInput{MeetingReminders: &enabled}, WorkDays: s.WorkDays, WorkStart: s.WorkStart, WorkEnd: s.WorkEnd}
}

func TestNotificationsBookingAtomicityAndVisibility(t *testing.T) {
	pool, s := notificationFixture(t)
	ctx := context.Background()
	base := time.Date(2030, 1, 7, 8, 0, 0, 0, time.UTC)
	now := base.Add(5*time.Hour + 30*time.Minute)
	s.now = func() time.Time { return now }
	calendarStore := NewCalendar(pool)
	calendarStore.now = func() time.Time { return base }
	input := calendar.Input{SlotID: notificationSlot(t, pool, base.Add(6*time.Hour), 30), Topic: "Рабочая задача", Confirmed: true}
	key := notificationUUID(t)
	b, err := calendarStore.Book(ctx, notificationAnya, key, input)
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.List(ctx, notificationAnya, notifications.Query{Limit: 20})
	if err != nil || page.UnreadCount != 1 || len(page.Items) != 1 || page.Items[0].Kind != "booking_confirmed" {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	factID := page.Items[0].ID
	if _, err := calendarStore.Book(ctx, notificationAnya, key, input); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE booking_id=$1`, b.ID).Scan(&count); err != nil || count != 4 {
		t.Fatalf("notifications=%d err=%v", count, err)
	}
	for _, actor := range []string{notificationPetr, "10000000-0000-0000-0000-000000000003"} {
		p, err := s.List(ctx, actor, notifications.Query{Limit: 20})
		if err != nil || p.UnreadCount != 0 || len(p.Items) != 0 {
			t.Fatal("foreign list leaked")
		}
		if _, err := s.Resource(ctx, actor, factID); !errors.Is(err, notifications.ErrNotFound) {
			t.Fatalf("foreign resource: %v", err)
		}
	}
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.ProcessDue(ctx, now); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	page, err = s.List(ctx, notificationAnya, notifications.Query{Limit: 1})
	if err != nil || page.UnreadCount != 2 || page.NextCursor == nil {
		t.Fatalf("worker page=%+v err=%v", page, err)
	}
	for _, q := range []notifications.Query{{Limit: 2, Cursor: *page.NextCursor}, {Limit: 1, Cursor: *page.NextCursor + "x"}} {
		if _, err := s.List(ctx, notificationAnya, q); !errors.Is(err, notifications.ErrInvalid) {
			t.Fatalf("invalid cursor: %v", err)
		}
	}
	if _, err := s.List(ctx, notificationPetr, notifications.Query{Limit: 1, Cursor: *page.NextCursor}); !errors.Is(err, notifications.ErrInvalid) {
		t.Fatalf("foreign cursor: %v", err)
	}
	now = now.Add(123456789 * time.Nanosecond)
	read, err := s.Read(ctx, notificationAnya, factID)
	if err != nil || read.ReadAt == nil {
		t.Fatal(err)
	}
	again, err := s.Read(ctx, notificationAnya, factID)
	if err != nil || !again.ReadAt.Equal(*read.ReadAt) {
		t.Fatal("read is not idempotent")
	}
	resource, err := s.Resource(ctx, notificationAnya, factID)
	if err != nil || resource.Booking == nil || resource.Booking.ID != b.ID {
		t.Fatalf("resource=%+v err=%v", resource, err)
	}
	now = b.StartsAt.Add(time.Minute)
	page, err = s.List(ctx, notificationAnya, notifications.Query{Limit: 20})
	if err != nil || len(page.Items) != 1 || page.UnreadCount != 0 {
		t.Fatalf("expired reminder leaked: %+v %v", page, err)
	}
	if err := s.ProcessDue(ctx, now); err != nil {
		t.Fatal(err)
	}
	// Сбой создания уведомлений откатывает и саму бронь.
	if _, err := pool.Exec(ctx, `ALTER TABLE notifications ADD CONSTRAINT test_no_confirmations CHECK (kind<>'booking_confirmed') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	input.SlotID = notificationSlot(t, pool, base.Add(30*time.Hour), 30)
	newKey := notificationUUID(t)
	if _, err := calendarStore.Book(ctx, notificationAnya, newKey, input); err == nil {
		t.Fatal("expected producer failure")
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM calendar_bookings WHERE slot_id=$1`, input.SlotID).Scan(&count); err != nil || count != 0 {
		t.Fatal("booking survived notification rollback")
	}
	if _, err := pool.Exec(ctx, `ALTER TABLE notifications DROP CONSTRAINT test_no_confirmations`); err != nil {
		t.Fatal(err)
	}
	if _, err := calendarStore.Book(ctx, notificationAnya, newKey, input); err != nil {
		t.Fatal(err)
	}
}

func TestNotificationsSettingsSchedulingAndBackfill(t *testing.T) {
	pool, s := notificationFixture(t)
	ctx := context.Background()
	base := time.Date(2030, 1, 7, 6, 0, 0, 0, time.UTC)
	now := base
	s.now = func() time.Time { return now }
	c := NewCalendar(pool)
	c.now = func() time.Time { return base }
	for i, offset := range []time.Duration{50 * time.Minute, 75 * time.Minute} {
		minutes := 30
		if i == 0 {
			minutes = 10
		}
		_, err := c.Book(ctx, notificationAnya, notificationUUID(t), calendar.Input{SlotID: notificationSlot(t, pool, base.Add(offset), minutes), Topic: "Встреча", Confirmed: true})
		if err != nil {
			t.Fatal(err)
		}
	}
	now = base.Add(20 * time.Minute)
	if err := s.ProcessDue(ctx, now); err != nil {
		t.Fatal(err)
	}
	now = base.Add(45 * time.Minute)
	if err := s.ProcessDue(ctx, now); err != nil {
		t.Fatal(err)
	}
	var pending, expired int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE status='pending'),count(*) FILTER(WHERE status='expired') FROM notifications WHERE kind='meeting_reminder'`).Scan(&pending, &expired); err != nil || pending != 2 || expired != 2 {
		t.Fatalf("pending=%d expired=%d err=%v", pending, expired, err)
	}
	settings, err := s.Settings(ctx, notificationAnya)
	if err != nil || settings.Timezone != "Europe/Moscow" || settings.Version != 1 {
		t.Fatalf("settings=%+v err=%v", settings, err)
	}
	disabled, err := s.UpdateSettings(ctx, notificationAnya, noticeInput(settings, false))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateSettings(ctx, notificationAnya, noticeInput(settings, true)); !errors.Is(err, notifications.ErrConflict) {
		t.Fatalf("stale settings accepted: %v", err)
	}
	enabled, err := s.UpdateSettings(ctx, notificationAnya, noticeInput(disabled, true))
	if err != nil {
		t.Fatal(err)
	}
	now = base.Add(time.Hour)
	if err := s.ProcessDue(ctx, now); err != nil {
		t.Fatal(err)
	}
	page, err := s.List(ctx, notificationAnya, notifications.Query{Limit: 20})
	if err != nil || page.UnreadCount != 2 {
		t.Fatalf("disabled reminder replayed: %+v %v", page, err)
	}
	host, err := s.List(ctx, notificationIlya, notifications.Query{Limit: 20})
	if err != nil || host.UnreadCount != 3 {
		t.Fatalf("deferred host reminder missing: %+v %v", host, err)
	}
	// Имитация старой брони без уведомлений: backfill не создаёт старые подтверждения.
	old, err := c.Book(ctx, notificationAnya, notificationUUID(t), calendar.Input{SlotID: notificationSlot(t, pool, base.Add(3*time.Hour), 30), Topic: "Старая бронь", Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM notifications WHERE booking_id=$1`, old.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.Backfill(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE booking_id=$1`, old.ID).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("backfill rows=%d err=%v", rows, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE calendar_bookings SET confirmed_at=starts_at-interval '20 minutes' WHERE id=$1`, old.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM notifications WHERE booking_id=$1`, old.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Backfill(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE booking_id=$1`, old.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("late booking generated immediate duplicate reminder")
	}
	if err := prepare(ctx, pool, employeeFixtureFS{scripts}, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	preserved, err := s.Settings(ctx, notificationAnya)
	if err != nil || preserved.Version != enabled.Version {
		t.Fatal("seed overwrote settings")
	}
}

func TestNotificationsMentorAnswerTransaction(t *testing.T) {
	tools, requestID := toolFixture(t)
	ctx := context.Background()
	params := escalationParams(t, tools, requestID)
	actionID := toolActionFixture(t, tools, requestID, policy.CreateEscalation, params, true)
	if _, err := callAction(tools, requestID, policy.CreateEscalation, actionID); err != nil {
		t.Fatal(err)
	}
	var id string
	var version time.Time
	if err := tools.pool.QueryRow(ctx, `SELECT id::text,updated_at FROM escalations WHERE action_id=$1`, actionID).Scan(&id, &version); err != nil {
		t.Fatal(err)
	}
	answers, err := NewEscalations(tools.pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewNotifications(tools.pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	input := escalation.AnswerRequest{AnswerText: "Проверь тестовую инструкцию команды", Version: escalationVersion(version)}
	answer, err := answers.Answer(ctx, params.BuddyID, id, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := answers.Answer(ctx, params.BuddyID, id, input); err != nil {
		t.Fatal(err)
	}
	input.Version = answer.Version
	input.AddToKB = true
	answer, err = answers.Answer(ctx, params.BuddyID, id, input)
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.List(ctx, notificationAnya, notifications.Query{Limit: 20})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("duplicate reply notification: %+v %v", page, err)
	}
	resource, err := s.Resource(ctx, notificationAnya, page.Items[0].ID)
	if err != nil || resource.Answer == nil || resource.Answer.AnswerText != input.AnswerText {
		t.Fatalf("answer resource=%+v err=%v", resource, err)
	}
	if _, err := s.Read(ctx, notificationPetr, page.Items[0].ID); !errors.Is(err, notifications.ErrNotFound) {
		t.Fatalf("foreign read=%v", err)
	}
	if _, err := tools.pool.Exec(ctx, `ALTER TABLE notifications ADD CONSTRAINT test_no_answers CHECK(kind<>'mentor_answer') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	input.Version = answer.Version
	input.AnswerText = "Другой ответ"
	input.AddToKB = false
	if _, err := answers.Answer(ctx, params.BuddyID, id, input); err == nil {
		t.Fatal("expected notification failure")
	}
	var persisted string
	if err := tools.pool.QueryRow(ctx, `SELECT answer_text FROM escalations WHERE id=$1`, id).Scan(&persisted); err != nil || persisted == input.AnswerText {
		t.Fatal("reply survived producer rollback")
	}
}
