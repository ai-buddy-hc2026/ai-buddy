package database

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
)

func TestCalendarSeedValidation(t *testing.T) {
	data, err := scripts.ReadFile("seeds/calendar.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseCalendarSeed(data); err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{`null`, `{}`, `{"office_hours":[]}{}`, `{"office_hours":[{"employee_id":"bad"}]}`, `{"office_hours":[{"employee_id":"4a59a828-3b1a-55e4-bf9b-81db5ad6183a","weekdays":[2,2],"start_local":"15:00","minutes":30}]}`, `{"office_hours":[{"employee_id":"4a59a828-3b1a-55e4-bf9b-81db5ad6183a","weekdays":[2],"start_local":"25:00","minutes":30}]}`} {
		if _, err := parseCalendarSeed([]byte(data)); err == nil {
			t.Fatalf("invalid seed accepted: %s", data)
		}
	}
}

func TestCalendarBookingConcurrencyAndRights(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := prepare(ctx, pool, employeeFixtureFS{scripts}, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	s := NewCalendar(pool)
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	anya := "a24a3478-cf42-51b1-b05b-9833260247a5"
	maria := "10000000-0000-0000-0000-000000000003"
	ilya := "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"
	petr := "2db7cc77-4114-52d8-a833-f670ab60e4e0"
	oleg := "20000000-0000-4000-8000-000000000001"
	olga := "0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a"
	team := "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2"
	start := now.Add(24 * time.Hour)
	slotIDs := []string{"30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000003", "30000000-0000-4000-8000-000000000004", "30000000-0000-4000-8000-000000000005"}
	for i, id := range slotIDs {
		host := ilya
		at := start
		switch i {
		case 1:
			at = start.Add(15 * time.Minute)
		case 2:
			host = oleg
		case 3:
			at = start.Add(24 * time.Hour)
		case 4:
			at = now.Add(-time.Hour)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO calendar_slots(id,team_id,employee_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)`, id, team, host, at, at.Add(30*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	w := calendar.Window{From: now, To: now.Add(7 * 24 * time.Hour)}
	for _, actor := range []string{anya, maria, ilya} {
		slots, err := s.Slots(ctx, actor, ilya, w)
		if err != nil || len(slots) != 3 {
			t.Fatalf("slots=%v err=%v", slots, err)
		}
	}
	if _, err := s.Slots(ctx, anya, olga, w); !errors.Is(err, calendar.ErrNotFound) {
		t.Fatalf("foreign host: %v", err)
	}
	input := calendar.Input{SlotID: slotIDs[0], Topic: "Первая задача", Confirmed: true}
	key1 := "40000000-0000-4000-8000-000000000001"
	key2 := "40000000-0000-4000-8000-000000000002"
	if _, err := s.Book(ctx, petr, key1, input); !errors.Is(err, calendar.ErrNotFound) {
		t.Fatalf("foreign booking: %v", err)
	}
	if _, err := s.Book(ctx, anya, key1, calendar.Input{SlotID: input.SlotID, Topic: input.Topic}); !errors.Is(err, calendar.ErrInvalid) {
		t.Fatalf("missing confirmation: %v", err)
	}
	type outcome struct {
		b   calendar.Booking
		key string
		err error
	}
	results := make(chan outcome, 2)
	gate := make(chan struct{})
	var wg sync.WaitGroup
	for i, actor := range []string{anya, maria} {
		wg.Add(1)
		go func(actor, key string) {
			defer wg.Done()
			<-gate
			b, err := s.Book(ctx, actor, key, input)
			results <- outcome{b, key, err}
		}(actor, []string{key1, key2}[i])
	}
	close(gate)
	wg.Wait()
	close(results)
	var winner outcome
	successes, conflicts := 0, 0
	for r := range results {
		if r.err == nil {
			winner = r
			successes++
		} else if errors.Is(r.err, calendar.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(r.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", successes, conflicts)
	}
	replayed, err := s.Book(ctx, winner.b.AttendeeID, winner.key, input)
	if err != nil || replayed.ID != winner.b.ID {
		t.Fatalf("replay: %v", err)
	}
	changed := input
	changed.Topic = "Другая тема"
	if _, err := s.Book(ctx, winner.b.AttendeeID, winner.key, changed); !errors.Is(err, calendar.ErrIdempotency) {
		t.Fatalf("key reuse: %v", err)
	}
	for _, id := range []string{slotIDs[1], slotIDs[2], slotIDs[4]} {
		if _, err := s.Book(ctx, winner.b.AttendeeID, "40000000-0000-4000-8000-000000000003", calendar.Input{SlotID: id, Topic: "Пересечение", Confirmed: true}); !errors.Is(err, calendar.ErrConflict) {
			t.Fatalf("busy/past slot %s: %v", id, err)
		}
	}
	for _, actor := range []string{winner.b.AttendeeID, ilya} {
		items, err := s.Bookings(ctx, actor, w)
		if err != nil || len(items) != 1 || items[0].ID != winner.b.ID {
			t.Fatalf("participant history=%+v err=%v", items, err)
		}
	}
	items, err := s.Bookings(ctx, petr, w)
	if err != nil || len(items) != 0 {
		t.Fatalf("foreign history=%+v err=%v", items, err)
	}
	slots, err := s.Slots(ctx, winner.b.AttendeeID, ilya, w)
	if err != nil || len(slots) != 1 || slots[0].ID != slotIDs[3] {
		t.Fatalf("busy availability=%+v err=%v", slots, err)
	}
	// Один и тот же новый запрос одновременно создаёт только одну бронь.
	newInput := calendar.Input{SlotID: slotIDs[3], Topic: "Следующая встреча", Confirmed: true}
	key3 := "40000000-0000-4000-8000-000000000004"
	results = make(chan outcome, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b, err := s.Book(ctx, winner.b.AttendeeID, key3, newInput)
			results <- outcome{b, key3, err}
		}()
	}
	wg.Wait()
	close(results)
	newID := ""
	for r := range results {
		if r.err != nil {
			t.Fatal(r.err)
		}
		if newID != "" && r.b.ID != newID {
			t.Fatal("duplicate booking")
		}
		newID = r.b.ID
	}
	now = start.Add(48 * time.Hour)
	if b, err := s.Book(ctx, winner.b.AttendeeID, winner.key, input); err != nil || b.ID != winner.b.ID {
		t.Fatalf("replay after start: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE employees SET active=false WHERE id=$1`, ilya); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Slots(ctx, anya, ilya, w); !errors.Is(err, calendar.ErrNotFound) {
		t.Fatalf("inactive host: %v", err)
	}
	if b, err := s.Book(ctx, winner.b.AttendeeID, winner.key, input); err != nil || b.ID != winner.b.ID {
		t.Fatalf("saved result lost: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET active=false WHERE id=$1`, winner.b.AttendeeID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bookings(ctx, winner.b.AttendeeID, w); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("inactive actor: %v", err)
	}
}

func TestCalendarSeedRepeatAndTimezone(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := prepare(ctx, pool, employeeFixtureFS{scripts}, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET timezone='Asia/Yakutsk' WHERE login='buddy_ilya'`); err != nil {
		t.Fatal(err)
	}
	data, err := scripts.ReadFile("seeds/calendar.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseCalendarSeed(data); err != nil {
		t.Fatal(err)
	}
	reference := time.Date(2040, 1, 1, 0, 0, 0, 0, time.UTC)
	counts := []int{}
	for range 2 {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := seedCalendar(ctx, tx, scripts, reference); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM calendar_slots WHERE starts_at>=$1`, reference).Scan(&count); err != nil {
			t.Fatal(err)
		}
		counts = append(counts, count)
	}
	if counts[0] == 0 || counts[0] != counts[1] {
		t.Fatalf("seed counts=%v", counts)
	}
	var localHour int
	if err := pool.QueryRow(ctx, `SELECT EXTRACT(HOUR FROM starts_at AT TIME ZONE 'Asia/Yakutsk')::integer FROM calendar_slots WHERE employee_id='4a59a828-3b1a-55e4-bf9b-81db5ad6183a' AND starts_at>=$1 LIMIT 1`, reference).Scan(&localHour); err != nil || localHour != 15 {
		t.Fatalf("hour=%d err=%v", localHour, err)
	}
}
