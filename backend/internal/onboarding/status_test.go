package onboarding

import "testing"

func TestValidStatus(t *testing.T) {
	for _, status := range []string{"todo", "in_progress", "blocked", "done"} {
		if !ValidStatus(status) {
			t.Errorf("ValidStatus(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"", "unknown", "DONE"} {
		if ValidStatus(status) {
			t.Errorf("ValidStatus(%q) = true, want false", status)
		}
	}
}
