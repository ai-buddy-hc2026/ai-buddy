package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

// Вопрос «Кто мой наставник?» в cp1251: так его отправляет PowerShell без UTF-8.
var cp1251Question = []byte{0xca, 0xf2, 0xee, 0x20, 0xec, 0xee, 0xe9, 0x20, 0xed, 0xe0, 0xf1, 0xf2, 0xe0, 0xe2, 0xed, 0xe8, 0xea, 0x3f}

func TestPostChatRejectsNonUTF8Body(t *testing.T) {
	users := &authStore{u: auth.User{ID: "a24a3478-cf42-51b1-b05b-9833260247a5", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	service, err := auth.New(users, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), users.u.Login)
	if err != nil {
		t.Fatal(err)
	}
	// Сервис чата nil: отклонение должно случиться до сохранения запроса.
	handler := RequireAuth(service, postChat(nil))
	body := append(append([]byte(`{"message":"`), cp1251Question...), []byte(`"}`)...)
	request := httptest.NewRequest(http.MethodPost, "/chat/messages", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+login.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
