package config

import "testing"

func TestMCPConfig(t *testing.T) {
	t.Setenv("AI_SERVICE_TOKEN", "different-ai-service-token")
	t.Setenv("JWT_SIGNING_KEY", "different-jwt-signing-key")
	for _, tc := range []struct {
		token, rate string
		valid       bool
	}{
		{"", "0", true},
		{"synthetic-mcp-service-token-32-characters", "1", true},
		{"short", "0", false},
		{"synthetic-mcp-service-token-32-characters\n", "0", false},
		{"synthetic-mcp-service-token-32-characters", "NaN", false},
		{"synthetic-mcp-service-token-32-characters", "Inf", false},
		{"synthetic-mcp-service-token-32-characters", "-0.1", false},
		{"synthetic-mcp-service-token-32-characters", "1.1", false},
	} {
		t.Setenv("MCP_SERVICE_TOKEN", tc.token)
		t.Setenv("ABSENCES_FAIL_RATE", tc.rate)
		_, err := LoadMCP()
		if (err == nil) != tc.valid {
			t.Fatalf("rate=%q valid=%v err=%v", tc.rate, tc.valid, err)
		}
	}
	t.Setenv("MCP_SERVICE_TOKEN", "synthetic-mcp-service-token-32-characters")
	t.Setenv("AI_SERVICE_TOKEN", "synthetic-mcp-service-token-32-characters")
	t.Setenv("ABSENCES_FAIL_RATE", "0")
	if _, err := LoadMCP(); err == nil {
		t.Fatal("shared service token accepted")
	}
}
