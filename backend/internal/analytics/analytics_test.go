package analytics

import "testing"

func TestCompleteDerivesRates(t *testing.T) {
	tests := []struct {
		name       string
		in         Summary
		deflection float64
		checklist  float64
		saved      int
	}{
		{"empty", Summary{}, 0, 0, 0},
		{"partial", Summary{Questions: 3, Escalations: 1, TasksTotal: 3, TasksDone: 1}, 66.7, 33.3, 2 * MinutesPerQuestion},
		{"more escalations than answers", Summary{Questions: 1, Escalations: 2}, 0, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.in.Complete()
			if got.DeflectionRate != tt.deflection || got.ChecklistRate != tt.checklist || got.MentorMinutesSaved != tt.saved || got.Days == nil {
				t.Fatalf("got %+v", got)
			}
			if tt.in.Days != nil {
				t.Fatal("input mutated")
			}
		})
	}
}
