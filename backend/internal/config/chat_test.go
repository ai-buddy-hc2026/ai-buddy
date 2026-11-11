package config

import "testing"

func TestChatConfiguration(t *testing.T) {
	t.Setenv("AI_SERVICE_URL", "")
	t.Setenv("AI_SERVICE_TOKEN", "")
	if cfg, err := LoadChat(""); err != nil || cfg.Enabled {
		t.Fatal("chat should be optional without settings")
	}
	for _, tc := range []struct {
		url, token, redis string
		valid             bool
	}{
		{"http://ai-service:8000/", "synthetic", "redis://redis:6379/0", true},
		{"https://ai-service", "synthetic", "redis://redis:6379/0", true},
		{"file:///private", "synthetic", "redis://redis:6379/0", false},
		{"http://secret@ai-service", "synthetic", "redis://redis:6379/0", false},
		{"http://ai-service?token=secret", "synthetic", "redis://redis:6379/0", false},
		{"http://ai-service", "", "redis://redis:6379/0", false},
		{"http://ai-service", "synthetic\r\nheader", "redis://redis:6379/0", false},
		{"http://ai-service", "synthetic", "", false},
	} {
		t.Setenv("AI_SERVICE_URL", tc.url)
		t.Setenv("AI_SERVICE_TOKEN", tc.token)
		cfg, err := LoadChat(tc.redis)
		if (err == nil) != tc.valid || cfg.Enabled != tc.valid {
			t.Fatalf("unexpected configuration result: %v", err)
		}
	}
}
