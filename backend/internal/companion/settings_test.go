package companion

import (
	"testing"
	"time"
)

func moscow(t *testing.T, value string) time.Time {
	t.Helper()
	loc, err := time.LoadLocation(DefaultTimezone)
	if err != nil {
		t.Fatal(err)
	}
	at, err := time.ParseInLocation("2006-01-02 15:04", value, loc)
	if err != nil {
		t.Fatal(err)
	}
	return at
}

func TestSettingsValidate(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Settings)
		valid  bool
	}{
		{"defaults", func(*Settings) {}, true},
		{"bad theme", func(s *Settings) { s.Theme = "neon" }, false},
		{"bad lang", func(s *Settings) { s.Lang = "de" }, false},
		{"bad tone", func(s *Settings) { s.Tone = "loud" }, false},
		{"end before start", func(s *Settings) { s.WorkHours.End = "09:00" }, false},
		{"bad clock", func(s *Settings) { s.WorkHours.Start = "25:00" }, false},
		{"no days", func(s *Settings) { s.WorkHours.Days = nil }, false},
		{"duplicate day", func(s *Settings) { s.WorkHours.Days = []int{1, 1} }, false},
		{"day out of range", func(s *Settings) { s.WorkHours.Days = []int{8} }, false},
		{"unknown zone", func(s *Settings) { s.WorkHours.Timezone = "Mars/Base" }, false},
		{"empty zone", func(s *Settings) { s.WorkHours.Timezone = "" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := Defaults(DefaultTimezone)
			tc.mutate(&settings)
			if got := settings.Validate() == nil; got != tc.valid {
				t.Fatalf("valid = %v, want %v", got, tc.valid)
			}
		})
	}
}

func TestDefaultsFallbackZone(t *testing.T) {
	if got := Defaults("nope").WorkHours.Timezone; got != DefaultTimezone {
		t.Fatalf("zone = %q", got)
	}
	if got := Defaults("Asia/Yekaterinburg").WorkHours.Timezone; got != "Asia/Yekaterinburg" {
		t.Fatalf("zone = %q", got)
	}
}

func TestNextWindow(t *testing.T) {
	hours := Defaults(DefaultTimezone).WorkHours
	// 2026-11-13 - пятница, 2026-11-16 - понедельник.
	for _, tc := range []struct {
		name, now, want string
	}{
		{"inside window", "2026-11-12 12:00", "2026-11-12 12:00"},
		{"before start", "2026-11-12 08:30", "2026-11-12 10:00"},
		{"after end", "2026-11-12 19:00", "2026-11-13 10:00"},
		{"friday evening", "2026-11-13 21:00", "2026-11-16 10:00"},
		{"saturday", "2026-11-14 12:00", "2026-11-16 10:00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := hours.NextWindow(moscow(t, tc.now))
			if want := moscow(t, tc.want); !got.Equal(want) {
				t.Fatalf("got %v, want %v", got, want)
			}
		})
	}
}

func TestGate(t *testing.T) {
	base := Recipient{UserID: "u", TeamID: "t", Role: "intern", Settings: Defaults(DefaultTimezone), BuddyEnabled: true}
	for _, tc := range []struct {
		name    string
		mutate  func(*Recipient)
		feature string
		now     string
		ok      bool
		want    string
	}{
		{"working hours", func(*Recipient) {}, FeatureBriefing, "2026-11-12 11:00", true, "2026-11-12 11:00"},
		{"night deferred", func(*Recipient) {}, FeatureHints, "2026-11-12 23:00", true, "2026-11-13 10:00"},
		{"toggle off", func(r *Recipient) { r.Settings.Toggles.Briefing = false }, FeatureBriefing, "2026-11-12 11:00", false, ""},
		{"coffee off by default", func(*Recipient) {}, FeatureCoffee, "2026-11-12 11:00", false, ""},
		{"birthday on", func(r *Recipient) { r.Settings.Toggles.BirthdayReminders = true }, FeatureBirthday, "2026-11-12 11:00", true, "2026-11-12 11:00"},
		{"stuck follows hints", func(r *Recipient) { r.Settings.Toggles.Hints = false }, FeatureStuck, "2026-11-12 11:00", false, ""},
		{"not my day deferred", func(r *Recipient) { r.NotMyDayDate = "2026-11-12" }, FeatureHints, "2026-11-12 11:00", true, "2026-11-13 10:00"},
		{"not my day yesterday", func(r *Recipient) { r.NotMyDayDate = "2026-11-11" }, FeatureHints, "2026-11-12 11:00", true, "2026-11-12 11:00"},
		{"control group silent", func(r *Recipient) { r.BuddyEnabled = false }, FeatureBriefing, "2026-11-12 11:00", false, ""},
		{"control group gets system", func(r *Recipient) { r.BuddyEnabled = false }, FeatureSystem, "2026-11-12 11:00", true, "2026-11-12 11:00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			r.Settings.WorkHours.Days = append([]int(nil), base.Settings.WorkHours.Days...)
			tc.mutate(&r)
			at, ok := Gate(r, tc.feature, moscow(t, tc.now))
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if ok && !at.Equal(moscow(t, tc.want)) {
				t.Fatalf("deliverAt = %v, want %v", at, tc.want)
			}
		})
	}
}
