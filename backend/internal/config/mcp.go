package config

import (
	"errors"
	"math"
	"os"
	"strconv"
	"strings"
)

type MCP struct {
	Token            string
	AbsencesFailRate float64
}

func LoadMCP() (MCP, error) {
	token := os.Getenv("MCP_SERVICE_TOKEN")
	if token != "" && (len(token) < 32 || strings.ContainsAny(token, " \t\r\n") || token == os.Getenv("AI_SERVICE_TOKEN") || token == os.Getenv("JWT_SIGNING_KEY")) {
		return MCP{}, errors.New("MCP_SERVICE_TOKEN must be a separate token of at least 32 bytes without whitespace")
	}
	rate, err := strconv.ParseFloat(env("ABSENCES_FAIL_RATE", "0"), 64)
	if err != nil || math.IsNaN(rate) || rate < 0 || rate > 1 {
		return MCP{}, errors.New("ABSENCES_FAIL_RATE must be between 0 and 1")
	}
	return MCP{Token: token, AbsencesFailRate: rate}, nil
}
