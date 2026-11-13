package database

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/redis/go-redis/v9"
)

type syntheticSender func(context.Context, chat.Payload) error

func (f syntheticSender) Send(ctx context.Context, p chat.Payload) error { return f(ctx, p) }

func TestChatHTTPRedisStreamingAndReconnect(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL is not set")
	}
	store := chatStore(t)
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal("invalid TEST_REDIS_URL")
	}
	options.Protocol = 2
	options.MaxRetries = -1
	options.ContextTimeoutEnabled = true
	client := redis.NewClient(options)
	defer func() { _ = client.Close() }()
	ctx := context.Background()
	release := make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	sender := syntheticSender(func(ctx context.Context, p chat.Payload) error {
		emit := func(event chat.Event) error {
			raw, _ := json.Marshal(event)
			return client.Publish(ctx, "chat:"+p.RequestID, string(raw)).Err()
		}
		first := "Привет "
		if err := emit(chat.NewEvent(p.RequestID, 1, "token", chat.Token{Text: &first})); err != nil {
			return err
		}
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		second, full := "мир!", "Привет мир!"
		if err := emit(chat.NewEvent(p.RequestID, 2, "token", chat.Token{Text: &second})); err != nil {
			return err
		}
		return emit(chat.NewEvent(p.RequestID, 3, "done", chat.Done{FullText: &full, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")}))
	})
	streams, err := chat.NewService(ctx, store, chat.RedisBroker{Client: client}, sender, chat.Options{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer streams.Close()
	identity, err := auth.New(NewUsers(store.pool), []byte("synthetic-test-signing-key-with-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := identity.Login(ctx, "intern_anya")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := identity.Login(ctx, "intern_petr")
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	server := httptest.NewServer(httpapi.NewHandler(logger, identity, NewOnboarding(store.pool), streams))
	defer server.Close()
	httpClient := &http.Client{Timeout: 10 * time.Second}
	request := func(method, path, token, body, last string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Content-Type", "application/json")
		if last != "" {
			req.Header.Set("Last-Event-ID", last)
		}
		res, err := httpClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := request("POST", "/chat/messages", login.AccessToken, `{"message":"Вопрос","role":"lead"}`, "")
	if res.StatusCode != 400 {
		t.Fatal("forged role accepted")
	}
	_ = res.Body.Close()
	res = request("POST", "/chat/messages", login.AccessToken, `{"message":"Вопрос"}`, "")
	var accepted chat.Accepted
	if err := json.NewDecoder(res.Body).Decode(&accepted); err != nil || res.StatusCode != 202 {
		t.Fatalf("start %d: %v", res.StatusCode, err)
	}
	_ = res.Body.Close()
	res = request("GET", accepted.StreamURL, login.AccessToken, "", "")
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal("not SSE")
	}
	scanner := bufio.NewScanner(res.Body)
	var first chat.Event
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data: ") {
			if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &first); err != nil {
				t.Fatal(err)
			}
			break
		}
	}
	if first.Type != "token" || first.Seq != 1 {
		t.Fatalf("first event not streamed: %+v", first)
	}
	_ = res.Body.Close() // Браузер отключен, генерация должна продолжаться.
	res = request("POST", "/chat/messages", login.AccessToken, `{"message":"Еще"}`, "")
	if res.StatusCode != 409 {
		t.Fatal("disconnect canceled generation or concurrent generation accepted")
	}
	_ = res.Body.Close()
	for _, tc := range []struct {
		token, last string
		want        int
	}{
		{"", "", 401}, {foreign.AccessToken, "", 404},
		{login.AccessToken, "invalid", 400}, {login.AccessToken, accepted.RequestID + ":999", 400},
	} {
		res = request("GET", accepted.StreamURL, tc.token, "", tc.last)
		if res.StatusCode != tc.want {
			t.Fatalf("stream access status %d, want %d", res.StatusCode, tc.want)
		}
		_ = res.Body.Close()
	}
	once.Do(func() { close(release) })
	res = request("GET", accepted.StreamURL, login.AccessToken, "", accepted.RequestID+":1")
	raw, err := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if err != nil || !strings.Contains(string(raw), "event: done") || strings.Contains(string(raw), "id: "+accepted.RequestID+":1\n") {
		t.Fatalf("replay mismatch: %s %v", raw, err)
	}
	record, err := store.Get(ctx, chatAnya, accepted.RequestID)
	if err != nil || record.Status != "done" || record.FullText != "Привет мир!" {
		t.Fatal("result not saved", err)
	}
	res = request("GET", "/chat/messages", login.AccessToken, "", "")
	var history chat.History
	if err := json.NewDecoder(res.Body).Decode(&history); err != nil || res.StatusCode != 200 || len(history.Items) != 1 || len(history.Items[0].Messages) != 2 {
		t.Fatal("history did not restore result", err)
	}
	_ = res.Body.Close()
	streams.Close()
	restarted, err := chat.NewService(ctx, store, chat.RedisBroker{Client: client}, sender, chat.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	feed, err := restarted.Open(ctx, chatAnya, accepted.RequestID, 1)
	if err != nil {
		t.Fatal(err)
	}
	events, done, _ := feed.Snapshot(1)
	if !done || len(events) != 1 || events[0].Type != "done" || events[0].Seq != 3 {
		t.Fatal("terminal result did not replay after restart")
	}
}
