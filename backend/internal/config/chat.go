package config

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Chat struct {
	Enabled                  bool
	ServiceURL, ServiceToken string
}

func LoadChat(redisURL string) (Chat, error) {
	base, token := strings.TrimRight(os.Getenv("AI_SERVICE_URL"), "/"), os.Getenv("AI_SERVICE_TOKEN")
	if base == "" && token == "" {
		return Chat{}, nil
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.TrimSpace(token) == "" || strings.ContainsAny(token, "\r\n") || redisURL == "" {
		return Chat{}, errors.New("chat requires valid AI_SERVICE_URL, AI_SERVICE_TOKEN and REDIS_URL")
	}
	return Chat{Enabled: true, ServiceURL: base, ServiceToken: token}, nil
}
