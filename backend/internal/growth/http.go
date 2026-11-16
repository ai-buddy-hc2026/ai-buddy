package growth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"regexp"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

// Backend - операции, которые нужны HTTP-слою. *Store его реализует.
type Backend interface {
	ListBrag(context.Context, Actor) ([]BragItem, error)
	AddBrag(context.Context, Actor, BragInput) (BragItem, error)
	DeleteBrag(context.Context, Actor, string) error
	ListFeedback(context.Context, Actor) ([]FeedbackRequest, error)
	CreateFeedback(context.Context, Actor, FeedbackInput) (FeedbackRequest, error)
	AnswerFeedback(context.Context, Actor, string, string) (FeedbackRequest, error)
	MarkFeedbackSaved(context.Context, Actor, string) (FeedbackRequest, error)
	ListEvents(context.Context, Actor) ([]Event, error)
	JoinEvent(context.Context, Actor, string) error
	LeaveEvent(context.Context, Actor, string) error
	Interests(context.Context, Actor) (Interests, error)
	SaveInterests(context.Context, Actor, []string) (Interests, error)
	Tracks(context.Context, Actor) (Tracks, bool, error)
	SaveTracks(context.Context, Actor, Tracks) (Tracks, error)
	Meetings(context.Context, Actor) (map[string]MeetingRecord, error)
	SaveMeeting(context.Context, Actor, string, MeetingDraft) (MeetingRecord, error)
	CoffeePairs(context.Context, Actor) ([]CoffeePair, error)
	CompetencyMatrix(context.Context, Actor) (CompetencyMatrix, error)
	SetCompetencyLevel(context.Context, Actor, string, int) (CompetencyMatrix, error)
}

const (
	requestTimeout = 5 * time.Second
	bodyMax        = 32 << 10
)

type route struct {
	pattern string
	handle  func(w http.ResponseWriter, r *http.Request, a Actor) (any, error)
}

// Register добавляет маршруты /growth/* поверх base. Все маршруты требуют токен
// и работают только с данными текущего пользователя в его команде.
func Register(base http.Handler, authService *auth.Service, backend Backend) http.Handler {
	return newMux(base, backend, actorFromContext, func(next http.Handler) http.Handler {
		return httpapi.RequireAuth(authService, next)
	})
}

type actorResolver func(*http.Request) (Actor, bool)

func actorFromContext(r *http.Request) (Actor, bool) {
	user, ok := httpapi.CurrentUser(r.Context())
	return Actor{ID: user.ID, TeamID: user.Team.ID, BuddyID: user.BuddyID}, ok
}

func newMux(base http.Handler, backend Backend, actorOf actorResolver, guard func(http.Handler) http.Handler) http.Handler {
	h := handlers{backend: backend}
	mux := http.NewServeMux()
	for _, rt := range h.routes() {
		mux.Handle(rt.pattern, guard(serve(rt.handle, actorOf)))
	}
	mux.Handle("/", base)
	return mux
}

type handlers struct{ backend Backend }

func (h handlers) routes() []route {
	b := h.backend
	return []route{
		{"GET /growth/brag", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return page(b.ListBrag(r.Context(), a))
		}},
		{"POST /growth/brag", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			var in BragInput
			if err := decode(w, r, &in); err != nil || in.Validate() != nil {
				return nil, ErrInvalid
			}
			return b.AddBrag(r.Context(), a, in)
		}},
		{"DELETE /growth/brag/{id}", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			id, err := pathID(r)
			if err != nil {
				return nil, err
			}
			return nil, b.DeleteBrag(r.Context(), a, id)
		}},
		{"GET /growth/feedback", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return page(b.ListFeedback(r.Context(), a))
		}},
		{"POST /growth/feedback", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			var in FeedbackInput
			if err := decode(w, r, &in); err != nil || !validRecipient(in.ToID) || in.Validate() != nil {
				return nil, ErrInvalid
			}
			return b.CreateFeedback(r.Context(), a, in)
		}},
		{"POST /growth/feedback/{id}/answer", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			id, err := pathID(r)
			if err != nil {
				return nil, err
			}
			var in struct {
				Answer string `json:"answer"`
			}
			if err := decode(w, r, &in); err != nil || !validText(in.Answer, AnswerMax) {
				return nil, ErrInvalid
			}
			return b.AnswerFeedback(r.Context(), a, id, in.Answer)
		}},
		{"POST /growth/feedback/{id}/saved", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			id, err := pathID(r)
			if err != nil {
				return nil, err
			}
			return b.MarkFeedbackSaved(r.Context(), a, id)
		}},
		{"GET /growth/events", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return page(b.ListEvents(r.Context(), a))
		}},
		{"POST /growth/events/{id}/attendees", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			id, err := pathID(r)
			if err != nil {
				return nil, err
			}
			return nil, b.JoinEvent(r.Context(), a, id)
		}},
		{"DELETE /growth/events/{id}/attendees", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			id, err := pathID(r)
			if err != nil {
				return nil, err
			}
			return nil, b.LeaveEvent(r.Context(), a, id)
		}},
		{"GET /growth/interests", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return b.Interests(r.Context(), a)
		}},
		{"PUT /growth/interests", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			var in struct {
				Tags []string `json:"tags"`
			}
			if err := decode(w, r, &in); err != nil || in.Tags == nil {
				return nil, ErrInvalid
			}
			tags, err := NormalizeTags(in.Tags)
			if err != nil {
				return nil, err
			}
			return b.SaveInterests(r.Context(), a, tags)
		}},
		{"GET /growth/tracks", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			tracks, _, err := b.Tracks(r.Context(), a)
			return tracks, err
		}},
		{"PUT /growth/tracks", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			var in Tracks
			if err := decode(w, r, &in); err != nil || in.Validate() != nil {
				return nil, ErrInvalid
			}
			return b.SaveTracks(r.Context(), a, in)
		}},
		{"GET /growth/meetings", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return b.Meetings(r.Context(), a)
		}},
		{"PUT /growth/meetings/{key}", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			key := r.PathValue("key")
			var in MeetingDraft
			if !ValidMeetingKey(key) || decode(w, r, &in) != nil || in.Validate() != nil {
				return nil, ErrInvalid
			}
			return b.SaveMeeting(r.Context(), a, key, in)
		}},
		{"GET /growth/coffee", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return page(b.CoffeePairs(r.Context(), a))
		}},
		{"GET /growth/competencies", func(_ http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			return b.CompetencyMatrix(r.Context(), a)
		}},
		{"PUT /growth/competencies/{code}", func(w http.ResponseWriter, r *http.Request, a Actor) (any, error) {
			code := r.PathValue("code")
			var in struct {
				Level int `json:"level"`
			}
			if !ValidCompetencyCode(code) || decode(w, r, &in) != nil || !ValidCompetencyLevel(in.Level) {
				return nil, ErrInvalid
			}
			return b.SetCompetencyLevel(r.Context(), a, code, in.Level)
		}},
	}
}

type itemsPage[T any] struct {
	Items []T `json:"items"`
}

func page[T any](items []T, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []T{}
	}
	return itemsPage[T]{Items: items}, nil
}

func serve(handle func(http.ResponseWriter, *http.Request, Actor) (any, error), actorOf actorResolver) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorOf(r)
		if !ok {
			writeError(w, auth.ErrUnauthorized)
			return
		}
		if r.URL.RawQuery != "" {
			writeError(w, ErrInvalid)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		result, err := handle(w, r.WithContext(ctx), actor)
		if err != nil {
			writeError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if result == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	})
}

func decode(w http.ResponseWriter, r *http.Request, target any) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return ErrInvalid
	}
	r.Body = http.MaxBytesReader(w, r.Body, bodyMax)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return ErrInvalid
	}
	return nil
}

func pathID(r *http.Request) (string, error) {
	id := r.PathValue("id")
	if !identifier.ValidUUID(id) {
		return "", ErrInvalid
	}
	return id, nil
}

type apiError struct {
	status  int
	code    string
	message string
}

func classify(err error) apiError {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		return apiError{http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен."}
	case errors.Is(err, ErrInvalid):
		return apiError{http.StatusBadRequest, "INVALID_REQUEST", "Проверьте поля запроса."}
	case errors.Is(err, ErrDenied):
		return apiError{http.StatusForbidden, "POLICY_DENIED", "Действие недоступно для этой роли."}
	case errors.Is(err, ErrNotFound):
		return apiError{http.StatusNotFound, "NOT_FOUND", "Объект не найден или недоступен."}
	case errors.Is(err, ErrLimit):
		return apiError{http.StatusConflict, "LIMIT_REACHED", "Лимит исчерпан: нет мест или слишком много открытых запросов."}
	case errors.Is(err, ErrConflict):
		return apiError{http.StatusConflict, "STATE_CONFLICT", "Объект изменился или уже закрыт."}
	default:
		return apiError{http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Сервис временно недоступен."}
	}
}

func writeError(w http.ResponseWriter, err error) {
	e := classify(err)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if e.status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	w.WriteHeader(e.status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": e.code, "message": e.message}})
}

var employeeCode = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// validRecipient - UUID пользователя или код сотрудника (как в GET /employees).
func validRecipient(to string) bool {
	return identifier.ValidUUID(to) || employeeCode.MatchString(to)
}
