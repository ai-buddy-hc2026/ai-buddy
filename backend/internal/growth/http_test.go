package growth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testUUID = "a24a3478-cf42-51b1-b05b-9833260247a5"

// fakeBackend отвечает успехом и запоминает последний вызов; err подменяет результат.
type fakeBackend struct {
	err   error
	calls []string
	tags  []string
}

func (f *fakeBackend) rec(name string) error { f.calls = append(f.calls, name); return f.err }

func (f *fakeBackend) ListBrag(context.Context, Actor) ([]BragItem, error) {
	return nil, f.rec("ListBrag")
}
func (f *fakeBackend) AddBrag(_ context.Context, _ Actor, in BragInput) (BragItem, error) {
	return BragItem{ID: "b1", Kind: in.Kind, Title: in.Title, Date: in.Date}, f.rec("AddBrag")
}
func (f *fakeBackend) DeleteBrag(context.Context, Actor, string) error { return f.rec("DeleteBrag") }
func (f *fakeBackend) ListFeedback(context.Context, Actor) ([]FeedbackRequest, error) {
	return nil, f.rec("ListFeedback")
}
func (f *fakeBackend) CreateFeedback(context.Context, Actor, FeedbackInput) (FeedbackRequest, error) {
	return FeedbackRequest{ID: "f1"}, f.rec("CreateFeedback")
}
func (f *fakeBackend) AnswerFeedback(context.Context, Actor, string, string) (FeedbackRequest, error) {
	return FeedbackRequest{ID: "f1"}, f.rec("AnswerFeedback")
}
func (f *fakeBackend) MarkFeedbackSaved(context.Context, Actor, string) (FeedbackRequest, error) {
	return FeedbackRequest{ID: "f1"}, f.rec("MarkFeedbackSaved")
}
func (f *fakeBackend) ListEvents(context.Context, Actor) ([]Event, error) {
	return nil, f.rec("ListEvents")
}
func (f *fakeBackend) JoinEvent(context.Context, Actor, string) error  { return f.rec("JoinEvent") }
func (f *fakeBackend) LeaveEvent(context.Context, Actor, string) error { return f.rec("LeaveEvent") }
func (f *fakeBackend) Interests(context.Context, Actor) (Interests, error) {
	return Interests{Tags: []string{}, Groups: []InterestGroup{}}, f.rec("Interests")
}
func (f *fakeBackend) SaveInterests(_ context.Context, _ Actor, tags []string) (Interests, error) {
	f.tags = tags
	return Interests{Tags: tags, Groups: []InterestGroup{}}, f.rec("SaveInterests")
}
func (f *fakeBackend) Tracks(context.Context, Actor) (Tracks, bool, error) {
	return Tracks{Selected: []string{}}, false, f.rec("Tracks")
}
func (f *fakeBackend) SaveTracks(_ context.Context, _ Actor, t Tracks) (Tracks, error) {
	return t, f.rec("SaveTracks")
}
func (f *fakeBackend) Meetings(context.Context, Actor) (map[string]MeetingRecord, error) {
	return map[string]MeetingRecord{}, f.rec("Meetings")
}
func (f *fakeBackend) SaveMeeting(_ context.Context, _ Actor, key string, d MeetingDraft) (MeetingRecord, error) {
	return MeetingRecord{MeetingID: key, Summary: d.Summary}, f.rec("SaveMeeting")
}
func (f *fakeBackend) CoffeePairs(context.Context, Actor) ([]CoffeePair, error) {
	return nil, f.rec("CoffeePairs")
}

func (f *fakeBackend) CompetencyMatrix(context.Context, Actor) (CompetencyMatrix, error) {
	return CompetencyMatrix{Track: "backend", Items: []Competency{}}, f.rec("CompetencyMatrix")
}
func (f *fakeBackend) SetCompetencyLevel(context.Context, Actor, string, int) (CompetencyMatrix, error) {
	return CompetencyMatrix{Track: "backend", Items: []Competency{}}, f.rec("SetCompetencyLevel")
}

func testMux(backend Backend, authed bool) http.Handler {
	base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	actorOf := func(*http.Request) (Actor, bool) { return Actor{ID: testUUID, TeamID: "t"}, authed }
	return newMux(base, backend, actorOf, func(next http.Handler) http.Handler { return next })
}

func TestRoutes(t *testing.T) {
	tests := []struct {
		name, method, path, body string
		backendErr               error
		authed                   bool
		status                   int
		call                     string
		contains                 string
	}{
		{name: "list brag", method: "GET", path: "/growth/brag", authed: true, status: 200, call: "ListBrag", contains: `{"items":[]}`},
		{name: "add brag", method: "POST", path: "/growth/brag", body: `{"type":"manual","title":"Доклад","link":null,"date":"2026-11-10"}`, authed: true, status: 200, call: "AddBrag"},
		{name: "add brag unknown field", method: "POST", path: "/growth/brag", body: `{"type":"manual","title":"x","date":"2026-11-10","x":1}`, authed: true, status: 400},
		{name: "delete brag bad id", method: "DELETE", path: "/growth/brag/nope", authed: true, status: 400},
		{name: "delete brag missing", method: "DELETE", path: "/growth/brag/" + testUUID, backendErr: ErrNotFound, authed: true, status: 404, call: "DeleteBrag"},
		{name: "create feedback", method: "POST", path: "/growth/feedback", body: `{"toId":"` + testUUID + `","artifactUrl":"https://gitlab.test/1","artifactTitle":"MR","question":"Что улучшить?","externalId":null}`, authed: true, status: 200, call: "CreateFeedback"},
		{name: "create feedback by employee code", method: "POST", path: "/growth/feedback", body: `{"toId":"oleg","artifactUrl":"https://gitlab.test/1","artifactTitle":"MR","question":"?"}`, authed: true, status: 200, call: "CreateFeedback"},
		{name: "feedback bad recipient", method: "POST", path: "/growth/feedback", body: `{"toId":"Oleg Deploev","artifactUrl":"https://gitlab.test/1","artifactTitle":"MR","question":"?"}`, authed: true, status: 400},
		{name: "feedback limit", method: "POST", path: "/growth/feedback", body: `{"toId":"` + testUUID + `","artifactUrl":"https://gitlab.test/1","artifactTitle":"MR","question":"?"}`, backendErr: ErrLimit, authed: true, status: 409, call: "CreateFeedback", contains: "LIMIT_REACHED"},
		{name: "answer feedback empty", method: "POST", path: "/growth/feedback/" + testUUID + "/answer", body: `{"answer":" "}`, authed: true, status: 400},
		{name: "answer feedback", method: "POST", path: "/growth/feedback/" + testUUID + "/answer", body: `{"answer":"Хорошо"}`, authed: true, status: 200, call: "AnswerFeedback"},
		{name: "join event", method: "POST", path: "/growth/events/" + testUUID + "/attendees", authed: true, status: 204, call: "JoinEvent"},
		{name: "join full event", method: "POST", path: "/growth/events/" + testUUID + "/attendees", backendErr: ErrLimit, authed: true, status: 409, call: "JoinEvent"},
		{name: "leave event", method: "DELETE", path: "/growth/events/" + testUUID + "/attendees", authed: true, status: 204, call: "LeaveEvent"},
		{name: "save interests", method: "PUT", path: "/growth/interests", body: `{"tags":["#Бег"]}`, authed: true, status: 200, call: "SaveInterests", contains: `"бег"`},
		{name: "save tracks", method: "PUT", path: "/growth/tracks", body: `{"selected":["deploy"],"modules":{"deploy-1":{"status":"done","lastScore":5,"lastAttempt":null}}}`, authed: true, status: 200, call: "SaveTracks"},
		{name: "save meeting", method: "PUT", path: "/growth/meetings/slot-1", body: `{"summary":"Итоги","agreements":[{"id":"a1","owner":"intern","what":"MR","due_date":null}]}`, authed: true, status: 200, call: "SaveMeeting"},
		{name: "save meeting bad key", method: "PUT", path: "/growth/meetings/a%20b", body: `{"summary":"Итоги","agreements":[]}`, authed: true, status: 400},
		{name: "coffee", method: "GET", path: "/growth/coffee", authed: true, status: 200, call: "CoffeePairs"},
		{name: "competency matrix", method: "GET", path: "/growth/competencies", authed: true, status: 200, call: "CompetencyMatrix", contains: `"track":"backend"`},
		{name: "set competency level", method: "PUT", path: "/growth/competencies/tests", body: `{"level":3}`, authed: true, status: 200, call: "SetCompetencyLevel"},
		{name: "competency level out of range", method: "PUT", path: "/growth/competencies/tests", body: `{"level":5}`, authed: true, status: 400},
		{name: "competency bad code", method: "PUT", path: "/growth/competencies/Tests", body: `{"level":2}`, authed: true, status: 400},
		{name: "competency unknown code", method: "PUT", path: "/growth/competencies/nope", body: `{"level":2}`, backendErr: ErrNotFound, authed: true, status: 404, call: "SetCompetencyLevel"},
		{name: "competency other user in body rejected", method: "PUT", path: "/growth/competencies/tests", body: `{"level":2,"userId":"` + testUUID + `"}`, authed: true, status: 400},
		{name: "competency other user in query rejected", method: "GET", path: "/growth/competencies?userId=" + testUUID, authed: true, status: 400},
		{name: "competency other user path not routed", method: "GET", path: "/growth/competencies/" + testUUID, authed: true, status: http.StatusTeapot},
		{name: "query rejected", method: "GET", path: "/growth/events?x=1", authed: true, status: 400},
		{name: "db failure", method: "GET", path: "/growth/events", backendErr: context.DeadlineExceeded, authed: true, status: 503, call: "ListEvents"},
		{name: "no user", method: "GET", path: "/growth/brag", authed: false, status: 401},
		{name: "other routes pass through", method: "GET", path: "/health", authed: true, status: http.StatusTeapot},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			backend := &fakeBackend{err: tt.backendErr}
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			testMux(backend, tt.authed).ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status %d, want %d, body %s", rec.Code, tt.status, rec.Body)
			}
			if tt.call == "" && len(backend.calls) > 0 {
				t.Fatalf("backend called on rejected request: %v", backend.calls)
			}
			if tt.call != "" && (len(backend.calls) != 1 || backend.calls[0] != tt.call) {
				t.Fatalf("calls %v, want %s", backend.calls, tt.call)
			}
			if !strings.Contains(rec.Body.String(), tt.contains) {
				t.Fatalf("body %s does not contain %s", rec.Body, tt.contains)
			}
		})
	}
}
