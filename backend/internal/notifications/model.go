// Package notifications описывает личные уведомления и настройки напоминаний.
package notifications

import (
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
)

var (
	ErrInvalid  = errors.New("invalid notification request")
	ErrConflict = errors.New("notification settings version conflict")
	ErrNotFound = errors.New("notification or resource unavailable")
	ErrDenied   = errors.New("notification access denied")
)

type Preferences struct {
	MeetingReminders bool `json:"meeting_reminders"`
}
type Settings struct {
	Preferences Preferences `json:"preferences"`
	WorkDays    []int       `json:"work_days"`
	WorkStart   string      `json:"work_start"`
	WorkEnd     string      `json:"work_end"`
	Timezone    string      `json:"timezone"`
	Version     int         `json:"version"`
}

type PreferencesInput struct {
	MeetingReminders *bool `json:"meeting_reminders"`
}
type SettingsInput struct {
	Preferences *PreferencesInput `json:"preferences"`
	WorkDays    []int             `json:"work_days"`
	WorkStart   string            `json:"work_start"`
	WorkEnd     string            `json:"work_end"`
	Version     *int              `json:"version"`
}

func (s SettingsInput) Valid() bool {
	if s.Version == nil || *s.Version < 0 || s.Preferences == nil || s.Preferences.MeetingReminders == nil || len(s.WorkDays) == 0 || len(s.WorkDays) > 7 {
		return false
	}
	seen := map[int]bool{}
	for _, day := range s.WorkDays {
		if day < 1 || day > 7 || seen[day] {
			return false
		}
		seen[day] = true
	}
	if len(s.WorkStart) != 5 || len(s.WorkEnd) != 5 {
		return false
	}
	start, e1 := time.Parse("15:04", s.WorkStart)
	end, e2 := time.Parse("15:04", s.WorkEnd)
	return e1 == nil && e2 == nil && end.After(start)
}

// NextAllowed возвращает ближайшее разрешённое время по часовому поясу получателя.
func NextAllowed(now time.Time, s Settings) (time.Time, error) {
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		return time.Time{}, err
	}
	start, err := time.Parse("15:04", s.WorkStart)
	if err != nil {
		return time.Time{}, err
	}
	end, err := time.Parse("15:04", s.WorkEnd)
	if err != nil {
		return time.Time{}, err
	}
	local := now.In(loc)
	for offset := 0; offset <= 7; offset++ {
		date := local.AddDate(0, 0, offset)
		day := int(date.Weekday())
		if day == 0 {
			day = 7
		}
		allowed := false
		for _, wanted := range s.WorkDays {
			if wanted == day {
				allowed = true
			}
		}
		if !allowed {
			continue
		}
		from := time.Date(date.Year(), date.Month(), date.Day(), start.Hour(), start.Minute(), 0, 0, loc)
		to := time.Date(date.Year(), date.Month(), date.Day(), end.Hour(), end.Minute(), 0, 0, loc)
		if from.Hour() != start.Hour() || from.Minute() != start.Minute() || to.Hour() != end.Hour() || to.Minute() != end.Minute() || !to.After(from) {
			continue
		}
		if !local.Before(from) && local.Before(to) {
			return now.UTC(), nil
		}
		if local.Before(from) {
			return from.UTC(), nil
		}
	}
	return time.Time{}, ErrInvalid
}

type Query struct {
	Limit  int
	Cursor string
}
type Notification struct {
	ID              string     `json:"id"`
	Kind            string     `json:"kind"`
	BookingID       *string    `json:"booking_id"`
	EscalationID    *string    `json:"escalation_id"`
	CreatedAt       time.Time  `json:"created_at"`
	ReadAt          *time.Time `json:"read_at"`
	StartsAt        *time.Time `json:"starts_at"`
	Timezone        *string    `json:"timezone"`
	PersonName      *string    `json:"person_name"`
	QuestionPreview *string    `json:"question_preview"`
}
type Page struct {
	Items       []Notification `json:"items"`
	NextCursor  *string        `json:"next_cursor"`
	UnreadCount int            `json:"unread_count"`
}
type MentorAnswer struct {
	ID         string    `json:"id"`
	Question   string    `json:"question"`
	AnswerText string    `json:"answer_text"`
	AnsweredAt time.Time `json:"answered_at"`
}
type Resource struct {
	Type    string            `json:"type"`
	Booking *calendar.Booking `json:"booking,omitempty"`
	Answer  *MentorAnswer     `json:"answer,omitempty"`
}
