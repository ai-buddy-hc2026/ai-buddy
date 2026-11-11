package onboarding

import (
	"errors"
	"time"
)

var (
	ErrNotFound        = errors.New("onboarding object not found")
	ErrForbidden       = errors.New("task belongs to another assignee")
	ErrVersionConflict = errors.New("task version changed")
	ErrPlanInactive    = errors.New("plan is not active")
	ErrInvalidArgument = errors.New("invalid onboarding argument")
)

type Material struct {
	DocumentID        string `json:"document_id"`
	Title             string `json:"title"`
	URL               string `json:"url"`
	IsTestInstruction bool   `json:"is_test_instruction"`
}

type Task struct {
	ID          string     `json:"id"`
	PlanID      string     `json:"plan_id"`
	AssigneeID  string     `json:"assignee_id"`
	Stage       string     `json:"stage"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Position    int        `json:"position"`
	DueDate     *string    `json:"due_date"`
	Status      string     `json:"status"`
	Version     int        `json:"version"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Materials   []Material `json:"materials"`
}

type Stage struct {
	Code  string `json:"code"`
	Title string `json:"title"`
	Tasks []Task `json:"tasks"`
}

type Progress struct {
	Done    int     `json:"done"`
	Total   int     `json:"total"`
	Percent float64 `json:"percent"`
}

type Plan struct {
	ID           string   `json:"id"`
	InternID     string   `json:"intern_id"`
	Title        string   `json:"title"`
	StartDate    string   `json:"start_date"`
	CurrentStage string   `json:"current_stage"`
	Status       string   `json:"status"`
	Stages       []Stage  `json:"stages"`
	Progress     Progress `json:"progress"`
	NextTaskID   *string  `json:"next_task_id"`
}

type StatusChange struct {
	Status  string `json:"status"`
	Version int    `json:"version"`
}

func ValidStatus(status string) bool {
	return status == "todo" || status == "in_progress" || status == "blocked" || status == "done"
}

// FillTasks принимает задачи в порядке этапа, позиции и ID.
func (p *Plan) FillTasks(tasks []Task) {
	p.Stages = []Stage{
		{Code: "week_1", Title: "Неделя 1", Tasks: []Task{}},
		{Code: "week_2", Title: "Неделя 2", Tasks: []Task{}},
		{Code: "weeks_3_4", Title: "Недели 3-4", Tasks: []Task{}},
	}
	p.Progress = Progress{}
	p.NextTaskID = nil
	for _, task := range tasks {
		for i := range p.Stages {
			if p.Stages[i].Code == task.Stage {
				p.Stages[i].Tasks = append(p.Stages[i].Tasks, task)
				break
			}
		}
		p.Progress.Total++
		if task.Status == "done" {
			p.Progress.Done++
		} else if p.NextTaskID == nil {
			id := task.ID
			p.NextTaskID = &id
		}
	}
	if p.Progress.Total > 0 {
		p.Progress.Percent = 100 * float64(p.Progress.Done) / float64(p.Progress.Total)
	}
}
