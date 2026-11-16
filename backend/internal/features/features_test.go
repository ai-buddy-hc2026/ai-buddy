package features

import "testing"

func TestParse(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		disabled []string
		wantErr  bool
	}{
		{"empty enables all", "", nil, false},
		{"spaces and empty items", " absences , ,kb_publish", []string{Absences, KBPublish}, false},
		{"unknown key fails", "chat,absense", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			flags, err := Parse(tt.raw)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v", err)
			}
			if tt.wantErr {
				return
			}
			off := map[string]bool{}
			for _, key := range tt.disabled {
				off[key] = true
			}
			for key, enabled := range flags.Map() {
				if enabled == off[key] {
					t.Fatalf("%s enabled=%v", key, enabled)
				}
			}
		})
	}
}

func TestZeroFlagsEnableAll(t *testing.T) {
	var flags Flags
	for _, key := range Keys {
		if !flags.Enabled(key) {
			t.Fatal(key)
		}
	}
}

func TestForAction(t *testing.T) {
	cases := map[string]string{
		"absences.create_request": Absences,
		"escalation.create":       Escalations,
		"checklist.update_status": "",
		"":                        "",
	}
	for action, want := range cases {
		if got := ForAction(action); got != want {
			t.Fatalf("%q: %q", action, got)
		}
	}
}
