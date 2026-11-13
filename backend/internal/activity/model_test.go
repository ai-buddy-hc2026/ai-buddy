package activity

import "testing"

func TestValidStatus(t *testing.T) {
	for _, status := range []string{"proposed", "confirmed", "executing", "succeeded", "failed", "cancelled"} {
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
