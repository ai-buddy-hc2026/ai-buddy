package onboarding

import "testing"

func TestProgressAndNextTask(t *testing.T) {
	var plan Plan
	plan.FillTasks(nil)
	if len(plan.Stages) != 3 || plan.Progress.Total != 0 || plan.Progress.Percent != 0 || plan.NextTaskID != nil {
		t.Fatal("invalid empty plan")
	}
	for _, stage := range plan.Stages {
		if stage.Tasks == nil {
			t.Fatal("tasks must be an array")
		}
	}
	plan.FillTasks([]Task{
		{ID: "first", Stage: "week_1", Status: "done"},
		{ID: "blocked-buddy", Stage: "week_1", Status: "blocked"},
		{ID: "later", Stage: "week_2", Status: "todo"},
	})
	if plan.Progress.Done != 1 || plan.Progress.Total != 3 || *plan.NextTaskID != "blocked-buddy" || plan.Progress.Percent < 33 || plan.Progress.Percent > 34 {
		t.Fatal("progress or next task mismatch")
	}
	plan.FillTasks([]Task{{ID: "done", Stage: "weeks_3_4", Status: "done"}})
	if plan.NextTaskID != nil || plan.Progress.Percent != 100 {
		t.Fatal("completed tasks left a next step")
	}
}
