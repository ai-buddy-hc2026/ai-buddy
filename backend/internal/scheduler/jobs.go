package scheduler

import (
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/companion"
)

const (
	dayLayout  = "2006-01-02"
	stuckAfter = 48 * time.Hour
)

// Task - незакрытая задача активного плана.
type Task struct {
	ID         string
	TeamID     string
	AssigneeID string
	SeedKey    string
	Title      string
	Status     string
	DueDate    string // YYYY-MM-DD или пусто
	UpdatedAt  time.Time
}

type Birthday struct {
	UserID string
	TeamID string
	Name   string
	Month  int
	Day    int
}

// Snapshot - всё, что нужно задачам за один тик.
type Snapshot struct {
	Recipients []companion.Recipient
	Tasks      []Task
	Birthdays  []Birthday
}

// Candidate - уведомление до проверки тумблеров и рабочих часов.
type Candidate struct {
	UserID   string
	Feature  string
	DedupKey string
	Title    string
	Body     string
}

// Job строит кандидатов из снимка. Повтор с тем же now даёт те же DedupKey.
type Job func(now time.Time, snap Snapshot) []Candidate

func DefaultJobs() []Job {
	return []Job{Briefing, Hints, Stuck, Reminders, RandomCoffee, Birthdays}
}

func localDay(r companion.Recipient, now time.Time, offset int) string {
	local := now.In(r.Settings.WorkHours.Location())
	return time.Date(local.Year(), local.Month(), local.Day()+offset, 0, 0, 0, 0, local.Location()).Format(dayLayout)
}

func tasksByUser(tasks []Task) map[string][]Task {
	grouped := map[string][]Task{}
	for _, t := range tasks {
		grouped[t.AssigneeID] = append(grouped[t.AssigneeID], t)
	}
	return grouped
}

// Briefing - утренняя сводка стажёру раз в рабочий день (идея 23).
func Briefing(now time.Time, snap Snapshot) []Candidate {
	grouped := tasksByUser(snap.Tasks)
	var out []Candidate
	for _, r := range snap.Recipients {
		if r.Role != "intern" || !r.Settings.WorkHours.IsWorkday(now) {
			continue
		}
		today := localDay(r, now, 0)
		var dueToday, overdue, inProgress int
		for _, t := range grouped[r.UserID] {
			switch {
			case t.DueDate == today:
				dueToday++
			case t.DueDate != "" && t.DueDate < today:
				overdue++
			}
			if t.Status == "in_progress" {
				inProgress++
			}
		}
		body := fmt.Sprintf("Сегодня по плану: %d, в работе: %d, просрочено: %d", dueToday, inProgress, overdue)
		out = append(out, Candidate{UserID: r.UserID, Feature: companion.FeatureBriefing, DedupKey: "briefing:" + today, Title: "Доброе утро! План на день", Body: body})
	}
	return out
}

// Hints - подсказка накануне срока задачи (идея 24).
func Hints(now time.Time, snap Snapshot) []Candidate {
	return perTask(now, snap, func(r companion.Recipient, t Task) *Candidate {
		if t.DueDate != localDay(r, now, 1) {
			return nil
		}
		return &Candidate{Feature: companion.FeatureHints, DedupKey: "hint:" + t.ID + ":" + t.DueDate, Title: "Завтра срок: " + t.Title, Body: "Если что-то непонятно, спроси меня в чате"}
	})
}

// Stuck - мягкий вопрос, если задача долго не двигается (идея 25).
func Stuck(now time.Time, snap Snapshot) []Candidate {
	return perTask(now, snap, func(_ companion.Recipient, t Task) *Candidate {
		if (t.Status != "in_progress" && t.Status != "blocked") || now.Sub(t.UpdatedAt) < stuckAfter {
			return nil
		}
		key := "stuck:" + t.ID + ":" + t.UpdatedAt.UTC().Format(time.RFC3339)
		return &Candidate{Feature: companion.FeatureStuck, DedupKey: key, Title: "Как идёт задача «" + t.Title + "»?", Body: "Если застрял, могу подсказать или позвать наставника"}
	})
}

// Reminders - напоминание о просроченных задачах и курсах (идея 10).
func Reminders(now time.Time, snap Snapshot) []Candidate {
	return perTask(now, snap, func(r companion.Recipient, t Task) *Candidate {
		if t.DueDate == "" || t.DueDate >= localDay(r, now, 0) {
			return nil
		}
		title := "Срок прошёл: " + t.Title
		if strings.Contains(t.SeedKey, "course") {
			title = "Не забудь курс: " + t.Title
		}
		return &Candidate{Feature: companion.FeatureReminders, DedupKey: "overdue:" + t.ID + ":" + t.DueDate, Title: title, Body: "Можно перенести срок или попросить помощи"}
	})
}

func perTask(now time.Time, snap Snapshot, build func(companion.Recipient, Task) *Candidate) []Candidate {
	grouped := tasksByUser(snap.Tasks)
	var out []Candidate
	for _, r := range snap.Recipients {
		for _, t := range grouped[r.UserID] {
			if c := build(r, t); c != nil {
				c.UserID = r.UserID
				out = append(out, *c)
			}
		}
	}
	return out
}

// RandomCoffee - по понедельникам делит согласившихся внутри команды на пары (идея 20).
func RandomCoffee(now time.Time, snap Snapshot) []Candidate {
	year, week := now.UTC().ISOWeek()
	weekKey := fmt.Sprintf("coffee:%d-W%02d", year, week)
	teams := map[string][]companion.Recipient{}
	for _, r := range snap.Recipients {
		local := now.In(r.Settings.WorkHours.Location())
		if local.Weekday() != time.Monday || !r.Settings.Toggles.RandomCoffee || !r.BuddyEnabled {
			continue
		}
		teams[r.TeamID] = append(teams[r.TeamID], r)
	}
	var out []Candidate
	for _, members := range teams {
		sort.Slice(members, func(i, j int) bool {
			return weekHash(weekKey, members[i].UserID) < weekHash(weekKey, members[j].UserID)
		})
		for i := 0; i+1 < len(members); i += 2 {
			a, b := members[i], members[i+1]
			out = append(out,
				Candidate{UserID: a.UserID, Feature: companion.FeatureCoffee, DedupKey: weekKey, Title: "Random coffee: " + b.Name, Body: "Договоритесь о 15 минутах на этой неделе"},
				Candidate{UserID: b.UserID, Feature: companion.FeatureCoffee, DedupKey: weekKey, Title: "Random coffee: " + a.Name, Body: "Договоритесь о 15 минутах на этой неделе"},
			)
		}
	}
	return out
}

func weekHash(week, userID string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(week + "|" + userID))
	return h.Sum64()
}

// Birthdays - накануне дня рождения коллеги из своей команды (идея 15).
func Birthdays(now time.Time, snap Snapshot) []Candidate {
	var out []Candidate
	for _, r := range snap.Recipients {
		tomorrow, _ := time.Parse(dayLayout, localDay(r, now, 1))
		for _, b := range snap.Birthdays {
			if b.UserID == r.UserID || b.TeamID != r.TeamID || int(tomorrow.Month()) != b.Month || tomorrow.Day() != b.Day {
				continue
			}
			key := fmt.Sprintf("birthday:%s:%d", b.UserID, tomorrow.Year())
			out = append(out, Candidate{UserID: r.UserID, Feature: companion.FeatureBirthday, DedupKey: key, Title: "Завтра день рождения у " + b.Name, Body: "Можно поздравить в общем чате"})
		}
	}
	return out
}
