package companion

import "time"

const (
	FeatureBriefing  = "briefing"
	FeatureHints     = "hints"
	FeatureStuck     = "stuck"
	FeatureReminders = "reminders"
	FeatureCoffee    = "coffee"
	FeatureBirthday  = "birthday"
	FeatureSystem    = "system"
)

// Notification - запись очереди. DedupKey уникален в пределах пользователя,
// поэтому повторный тик планировщика не создаёт дублей.
type Notification struct {
	ID        string     `json:"id"`
	UserID    string     `json:"-"`
	TeamID    string     `json:"-"`
	Feature   string     `json:"feature"`
	DedupKey  string     `json:"-"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	DeliverAt time.Time  `json:"deliver_at"`
	ReadAt    *time.Time `json:"read_at"`
	CreatedAt time.Time  `json:"created_at"`
}

type NotificationPage struct {
	Items       []Notification `json:"items"`
	UnreadCount int            `json:"unread_count"`
}

type PilotGroup struct {
	Interns       int     `json:"interns"`
	TasksDone     int     `json:"tasks_done"`
	TasksTotal    int     `json:"tasks_total"`
	CompletionPct float64 `json:"completion_pct"`
}

type PilotReport struct {
	WithBuddy    PilotGroup `json:"with_buddy"`
	Control      PilotGroup `json:"control"`
	NotMyDayDays int        `json:"not_my_day_presses"`
}

type CategoryCount struct {
	Category string `json:"category"`
	Count    int    `json:"count"`
}

type UnansweredReport struct {
	Days  int             `json:"days"`
	Total int             `json:"total"`
	Items []CategoryCount `json:"items"`
}

type TelegramLink struct {
	Linked   bool    `json:"linked"`
	Code     *string `json:"code"`
	DeepLink *string `json:"deep_link"`
}
