// Package companion хранит личные настройки стажёра, режим «Не мой день»,
// очередь проактивных уведомлений и флаг пилота.
package companion

import (
	"errors"
	"slices"
	"time"
	_ "time/tzdata"
)

const (
	DefaultTimezone = "Europe/Moscow"
	clockLayout     = "15:04"
	dayLayout       = "2006-01-02"
	maxLookahead    = 8
)

var (
	ErrInvalid  = errors.New("invalid companion request")
	ErrDenied   = errors.New("companion access denied")
	ErrNotFound = errors.New("companion record not found")
)

type WorkHours struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	Days     []int  `json:"days"`
	Timezone string `json:"timezone"`
}

type Toggles struct {
	Briefing          bool `json:"briefing"`
	Hints             bool `json:"hints"`
	BirthdayReminders bool `json:"birthdayReminders"`
	RandomCoffee      bool `json:"randomCoffee"`
	ShowInterests     bool `json:"showInterests"`
}

// Settings - то, что пользователь меняет сам. Вычисляемые поля приходят в View.
type Settings struct {
	Theme     string    `json:"theme"`
	Lang      string    `json:"lang"`
	Tone      string    `json:"tone"`
	WorkHours WorkHours `json:"workHours"`
	Toggles   Toggles   `json:"toggles"`
}

type View struct {
	Settings
	NotMyDayDate   *string `json:"notMyDayDate"`
	TelegramLinked bool    `json:"telegramLinked"`
	BuddyEnabled   bool    `json:"buddyEnabled"`
}

func Defaults(zone string) Settings {
	if _, err := time.LoadLocation(zone); zone == "" || err != nil {
		zone = DefaultTimezone
	}
	return Settings{
		Theme:     "system",
		Lang:      "ru",
		Tone:      "short",
		WorkHours: WorkHours{Start: "08:00", End: "19:00", Days: []int{1, 2, 3, 4, 5}, Timezone: zone},
		Toggles:   Toggles{Briefing: true, Hints: true},
	}
}

func (s Settings) Validate() error {
	if !slices.Contains([]string{"system", "light", "dark"}, s.Theme) ||
		!slices.Contains([]string{"ru", "en"}, s.Lang) ||
		!slices.Contains([]string{"short", "detailed"}, s.Tone) {
		return ErrInvalid
	}
	return s.WorkHours.Validate()
}

func (h WorkHours) Validate() error {
	start, errStart := time.Parse(clockLayout, h.Start)
	end, errEnd := time.Parse(clockLayout, h.End)
	if errStart != nil || errEnd != nil || !end.After(start) || len(h.Days) == 0 || len(h.Days) > 7 {
		return ErrInvalid
	}
	seen := map[int]bool{}
	for _, day := range h.Days {
		if day < 1 || day > 7 || seen[day] {
			return ErrInvalid
		}
		seen[day] = true
	}
	if _, err := time.LoadLocation(h.Timezone); h.Timezone == "" || err != nil {
		return ErrInvalid
	}
	return nil
}

// IsWorkday - рабочий ли для пользователя локальный день, в который попадает now.
func (h WorkHours) IsWorkday(now time.Time) bool {
	return slices.Contains(h.Days, isoWeekday(now.In(h.Location())))
}

// Location - часовой пояс рабочих часов, UTC при ошибке.
func (h WorkHours) Location() *time.Location {
	loc, err := time.LoadLocation(h.Timezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

// LocalDay - календарная дата пользователя в формате YYYY-MM-DD.
func (h WorkHours) LocalDay(now time.Time) string {
	return now.In(h.Location()).Format(dayLayout)
}

func isoWeekday(t time.Time) int {
	if wd := int(t.Weekday()); wd != 0 {
		return wd
	}
	return 7
}

// NextWindow возвращает now, если сейчас рабочее время, иначе начало следующего окна.
// Дни перебираются по календарю пояса, поэтому переход на летнее время не ломает расчёт.
func (h WorkHours) NextWindow(now time.Time) time.Time {
	if h.Validate() != nil {
		return now
	}
	loc := h.Location()
	local := now.In(loc)
	start, _ := time.Parse(clockLayout, h.Start)
	end, _ := time.Parse(clockLayout, h.End)
	for offset := 0; offset < maxLookahead; offset++ {
		day := local.AddDate(0, 0, offset)
		if !slices.Contains(h.Days, isoWeekday(day)) {
			continue
		}
		from := time.Date(day.Year(), day.Month(), day.Day(), start.Hour(), start.Minute(), 0, 0, loc)
		until := time.Date(day.Year(), day.Month(), day.Day(), end.Hour(), end.Minute(), 0, 0, loc)
		if offset == 0 && !local.Before(from) && local.Before(until) {
			return now
		}
		if local.Before(from) {
			return from
		}
	}
	return now
}

// IsWorkingNow - рабочее ли сейчас время пользователя.
func (h WorkHours) IsWorkingNow(now time.Time) bool {
	return h.NextWindow(now).Equal(now) && h.Validate() == nil
}

// Enabled сопоставляет фичу планировщика с тумблером пользователя.
func (t Toggles) Enabled(feature string) bool {
	switch feature {
	case FeatureBriefing:
		return t.Briefing
	case FeatureHints, FeatureStuck, FeatureReminders:
		return t.Hints
	case FeatureBirthday:
		return t.BirthdayReminders
	case FeatureCoffee:
		return t.RandomCoffee
	default:
		return true
	}
}

// Recipient - получатель проактива со своими настройками и днём «Не мой день».
type Recipient struct {
	UserID       string
	TeamID       string
	Role         string
	Name         string
	Settings     Settings
	NotMyDayDate string
	BuddyEnabled bool
}

// Gate решает судьбу уведомления: отбросить (ok=false) или доставить в deliverAt.
// Выключенный тумблер и контрольная группа пилота - отбросить.
// «Не мой день» и нерабочее время - отложить до следующего рабочего окна.
func Gate(r Recipient, feature string, now time.Time) (deliverAt time.Time, ok bool) {
	if !r.Settings.Toggles.Enabled(feature) || (!r.BuddyEnabled && feature != FeatureSystem) {
		return time.Time{}, false
	}
	hours := r.Settings.WorkHours
	at := hours.NextWindow(now)
	if r.NotMyDayDate != "" && hours.LocalDay(at) == r.NotMyDayDate {
		local := at.In(hours.Location())
		nextDay := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, local.Location())
		at = hours.NextWindow(nextDay)
	}
	return at, true
}
