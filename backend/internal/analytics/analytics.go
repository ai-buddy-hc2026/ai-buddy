// Package analytics описывает сводку метрик пилота (SA-6).
package analytics

import "errors"

var ErrDenied = errors.New("analytics access denied")

// MinutesPerQuestion - допущение из docs/metrics.md: столько минут наставник
// тратил бы на один вопрос без ассистента. Это не измеренное значение.
const MinutesPerQuestion = 10

type Day struct {
	Date      string `json:"date"`
	Questions int    `json:"questions"`
	Unknown   int    `json:"unknown"`
}

// Summary считается по стажёрам в области видимости: lead - вся команда, buddy - назначенные.
type Summary struct {
	Scope              string  `json:"scope"`
	Interns            int     `json:"interns"`
	Questions          int     `json:"questions"`
	Answered           int     `json:"answered"`
	Unknown            int     `json:"unknown"`
	WithSources        int     `json:"with_sources"`
	Escalations        int     `json:"escalations"`
	DeflectionRate     float64 `json:"deflection_rate"`
	ActionsProposed    int     `json:"actions_proposed"`
	ActionsSucceeded   int     `json:"actions_succeeded"`
	AvgActionSeconds   float64 `json:"avg_action_seconds"`
	PolicyDenied       int     `json:"policy_denied"`
	TasksTotal         int     `json:"tasks_total"`
	TasksDone          int     `json:"tasks_done"`
	ChecklistRate      float64 `json:"checklist_rate"`
	MentorMinutesSaved int     `json:"mentor_minutes_saved"`
	MinutesPerQuestion int     `json:"minutes_per_question"`
	Days               []Day   `json:"days"`
}

// Complete вычисляет производные метрики по формулам docs/metrics.md.
func (s Summary) Complete() Summary {
	resolved := max(s.Questions-s.Escalations, 0)
	s.DeflectionRate = percent(resolved, s.Questions)
	s.ChecklistRate = percent(s.TasksDone, s.TasksTotal)
	s.MinutesPerQuestion = MinutesPerQuestion
	s.MentorMinutesSaved = resolved * MinutesPerQuestion
	if s.Days == nil {
		s.Days = []Day{}
	}
	return s
}

func percent(part, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(int(float64(part)/float64(total)*1000+0.5)) / 10
}
