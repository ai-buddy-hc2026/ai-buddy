package database

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type officeHoursSeed struct {
	EmployeeID string `json:"employee_id"`
	Weekdays   []int  `json:"weekdays"`
	StartLocal string `json:"start_local"`
	Minutes    int    `json:"minutes"`
}

func parseCalendarSeed(data []byte) ([]officeHoursSeed, error) {
	if len(data) > 128<<10 {
		return nil, fmt.Errorf("calendar seed exceeds 128 KiB")
	}
	var seed struct {
		OfficeHours []officeHoursSeed `json:"office_hours"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&seed); err != nil {
		return nil, fmt.Errorf("decode calendar seed: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF || seed.OfficeHours == nil || len(seed.OfficeHours) > 100 {
		return nil, fmt.Errorf("invalid calendar seed")
	}
	for _, rule := range seed.OfficeHours {
		if !identifier.ValidUUID(rule.EmployeeID) || len(rule.Weekdays) == 0 || len(rule.Weekdays) > 7 || rule.Minutes < 5 || rule.Minutes > 240 {
			return nil, fmt.Errorf("invalid office-hours rule")
		}
		if _, err := time.Parse("15:04", rule.StartLocal); err != nil {
			return nil, fmt.Errorf("invalid local office-hours time")
		}
		seen := map[int]bool{}
		for _, day := range rule.Weekdays {
			if day < 1 || day > 7 || seen[day] {
				return nil, fmt.Errorf("invalid office-hours weekday")
			}
			seen[day] = true
		}
	}
	return seed.OfficeHours, nil
}

func seedCalendar(ctx context.Context, tx pgx.Tx, files fs.FS, now time.Time) error {
	data, err := fs.ReadFile(files, "seeds/calendar.json")
	if err != nil {
		return fmt.Errorf("read calendar seed: %w", err)
	}
	rules, err := parseCalendarSeed(data)
	if err != nil {
		return err
	}
	for _, rule := range rules {
		var teamID, timezone string
		var active bool
		err = tx.QueryRow(ctx, `SELECT e.team_id::text,COALESCE(u.timezone,t.timezone),e.active AND t.active AND (e.user_id IS NULL OR u.active)
 FROM employees e JOIN teams t ON t.id=e.team_id LEFT JOIN users u ON u.id=e.user_id AND u.team_id=e.team_id WHERE e.id=$1`, rule.EmployeeID).Scan(&teamID, &timezone, &active)
		if err != nil {
			return fmt.Errorf("calendar host %s: %w", rule.EmployeeID, err)
		}
		if !active {
			continue
		}
		loc, err := time.LoadLocation(timezone)
		if err != nil {
			return fmt.Errorf("calendar timezone: %w", err)
		}
		clock, _ := time.Parse("15:04", rule.StartLocal)
		local := now.In(loc)
		for day := 0; day < 21; day++ {
			date := local.AddDate(0, 0, day)
			weekday := int(date.Weekday())
			if weekday == 0 {
				weekday = 7
			}
			matches := false
			for _, wanted := range rule.Weekdays {
				if wanted == weekday {
					matches = true
				}
			}
			if !matches {
				continue
			}
			start := time.Date(date.Year(), date.Month(), date.Day(), clock.Hour(), clock.Minute(), 0, 0, loc)
			if start.Hour() != clock.Hour() || start.Minute() != clock.Minute() || !start.After(now) {
				continue
			}
			_, err = tx.Exec(ctx, `INSERT INTO calendar_slots(team_id,employee_id,starts_at,ends_at) VALUES($1,$2,$3,$4)
 ON CONFLICT(employee_id,starts_at) DO NOTHING`, teamID, rule.EmployeeID, start.UTC(), start.Add(time.Duration(rule.Minutes)*time.Minute).UTC())
			if err != nil {
				return fmt.Errorf("seed office-hours slot: %w", err)
			}
		}
	}
	return nil
}
