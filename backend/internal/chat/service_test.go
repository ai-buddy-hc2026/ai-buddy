package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

const testActor = "10000000-0000-0000-0000-000000000001"

type memoryStore struct {
	mu         sync.Mutex
	records    map[string]Record
	failSave   bool
	dispatched []Payload
}

func newMemoryStore() *memoryStore        { return &memoryStore{records: make(map[string]Record)} }
func metadataString(value string) *string { return &value }
func (m *memoryStore) Create(_ context.Context, actor, id string, in Input) (Record, Payload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.records {
		if r.UserID == actor && r.Status == "running" {
			return Record{}, Payload{}, ErrRunning
		}
	}
	r := Record{Request: Request{RequestID: id, Status: "running", CreatedAt: time.Now(), StreamURL: StreamURL(id)}, UserID: actor, ConversationID: "30000000-0000-0000-0000-000000000001"}
	m.records[id] = r
	return r, Payload{RequestID: id, ConversationID: r.ConversationID, UserID: actor, Message: in.Message, History: []HistoryMessage{}}, nil
}
func (m *memoryStore) Dispatch(_ context.Context, p Payload, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dispatched = append(m.dispatched, p)
	return nil
}
func (m *memoryStore) Get(_ context.Context, actor, id string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || r.UserID != actor {
		return Record{}, ErrNotFound
	}
	return r, nil
}
func (m *memoryStore) Finish(_ context.Context, id string, e Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failSave {
		return errors.New("private storage error")
	}
	r := m.records[id]
	r.Status = e.Type
	r.LastSeq = e.Seq
	if e.Type == "done" {
		var done Done
		_ = json.Unmarshal(e.Data, &done)
		r.FullText = *done.FullText
		r.AnswerStatus = done.AnswerStatus
		r.QuestionCategory = done.QuestionCategory
	} else {
		r.Error = &Error{}
		_ = json.Unmarshal(e.Data, r.Error)
	}
	m.records[id] = r
	return nil
}
func (m *memoryStore) History(context.Context, string, string, string, int) (History, error) {
	return History{Items: []Turn{}}, nil
}
func (m *memoryStore) Recover(_ context.Context, startup bool, active []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !startup {
		return nil
	}
	for id, r := range m.records {
		if r.Status == "running" {
			r.Status = "error"
			r.LastSeq++
			r.Error = &Error{Code: "STREAM_INTERRUPTED", Message: "Поток ответа прерван. Повторите запрос."}
			m.records[id] = r
		}
	}
	return nil
}

type fakeBroker struct {
	mu           sync.Mutex
	subs         map[string]*fakeSub
	subscribeErr bool
}
type fakeSub struct {
	messages chan []byte
	closed   chan struct{}
	once     sync.Once
}

func newFakeBroker() *fakeBroker { return &fakeBroker{subs: make(map[string]*fakeSub)} }
func (b *fakeBroker) Subscribe(_ context.Context, id string) (Subscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribeErr {
		return nil, ErrUnavailable
	}
	sub := &fakeSub{messages: make(chan []byte, 16), closed: make(chan struct{})}
	b.subs[id] = sub
	return sub, nil
}
func (s *fakeSub) Receive(ctx context.Context) ([]byte, error) {
	select {
	case data := <-s.messages:
		if data == nil {
			return nil, ErrUnavailable
		}
		return data, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, ErrUnavailable
	}
}
func (s *fakeSub) Close() error { s.once.Do(func() { close(s.closed) }); return nil }
func (b *fakeBroker) emit(id string, event Event) {
	b.mu.Lock()
	sub := b.subs[id]
	b.mu.Unlock()
	if sub == nil {
		panic("publication before subscription")
	}
	raw, _ := json.Marshal(event)
	sub.messages <- raw
}

type senderFunc func(context.Context, Payload) error

func (f senderFunc) Send(ctx context.Context, p Payload) error { return f(ctx, p) }

func waitTerminal(t *testing.T, service *Service, accepted Accepted) *Feed {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	feed, err := service.Open(ctx, testActor, accepted.RequestID, 0)
	if err != nil {
		t.Fatal(err)
	}
	for {
		_, done, changed := feed.Snapshot(0)
		if done {
			return feed
		}
		select {
		case <-changed:
		case <-ctx.Done():
			t.Fatal("generation did not finish")
		}
	}
}
func TestReceiveBeforeAcceptedAndReplay(t *testing.T) {
	store, broker := newMemoryStore(), newFakeBroker()
	first, last := "Привет ", "мир"
	service, err := NewService(context.Background(), store, broker, senderFunc(func(ctx context.Context, p Payload) error {
		broker.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &first}))
		broker.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &first}))
		broker.emit(p.RequestID, NewEvent(p.RequestID, 2, "token", Token{Text: &last}))
		full := "Окончательный текст заменяет токены"
		broker.emit(p.RequestID, NewEvent(p.RequestID, 3, "done", Done{FullText: &full, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")}))
		<-ctx.Done()
		return ctx.Err() // done поступает раньше ответа на HTTP POST.
	}), Options{Retention: time.Hour, RecoveryInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	accepted, err := service.Start(context.Background(), testActor, Input{Message: "Вопрос"})
	if err != nil {
		t.Fatal(err)
	}
	feed := waitTerminal(t, service, accepted)
	events, done, _ := feed.Snapshot(1)
	if !done || len(events) != 2 || events[0].Seq != 2 || events[1].Type != "done" {
		t.Fatalf("invalid replay: %+v", events)
	}
	if _, err := service.Open(context.Background(), "10000000-0000-0000-0000-000000000004", accepted.RequestID, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign request accepted")
	}
	if _, err := service.Open(context.Background(), testActor, accepted.RequestID, 4); !errors.Is(err, ErrCursor) {
		t.Fatal("future cursor accepted")
	}
	feed.mu.Lock()
	feed.finishedAt = time.Now().Add(-2 * time.Hour)
	feed.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for {
		service.mu.Lock()
		_, exists := service.states[accepted.RequestID]
		service.mu.Unlock()
		if !exists {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("buffer not evicted")
		}
		time.Sleep(5 * time.Millisecond)
	}
	replay, err := service.Open(context.Background(), testActor, accepted.RequestID, 1)
	if err != nil {
		t.Fatal(err)
	}
	events, done, _ = replay.Snapshot(1)
	if !done || len(events) != 1 || events[0].Seq != 3 {
		t.Fatal("durable terminal replay failed")
	}
}

func TestGenerationFailures(t *testing.T) {
	for _, tc := range []struct {
		name, code             string
		emit                   func(*fakeBroker, Payload)
		definite, subscription bool
		limit                  int
	}{
		{name: "timeout", code: "GENERATION_TIMEOUT"},
		{name: "rejected", code: "AI_UNAVAILABLE", definite: true},
		{name: "subscribe", code: "STREAM_INTERRUPTED", subscription: true},
		{name: "gap", code: "INVALID_AI_EVENT", emit: func(b *fakeBroker, p Payload) {
			text := "a"
			b.emit(p.RequestID, NewEvent(p.RequestID, 2, "token", Token{Text: &text}))
		}},
		{name: "contradiction", code: "INVALID_AI_EVENT", emit: func(b *fakeBroker, p Payload) {
			a, z := "a", "z"
			b.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &a}))
			b.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &z}))
		}},
		{name: "unsupported", code: "INVALID_AI_EVENT", emit: func(b *fakeBroker, p Payload) {
			b.emit(p.RequestID, NewEvent(p.RequestID, 1, "action_proposal", map[string]string{"action_type": "absences.create_request"}))
		}},
		{name: "buffer", code: "BUFFER_LIMIT", limit: 1000, emit: func(b *fakeBroker, p Payload) {
			text := strings.Repeat("x", 1500)
			b.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &text}))
		}},
		{name: "characters", code: "INVALID_AI_EVENT", emit: func(b *fakeBroker, p Payload) {
			text := strings.Repeat("я", 20001)
			b.emit(p.RequestID, NewEvent(p.RequestID, 1, "token", Token{Text: &text}))
		}},
		{name: "redis lost", code: "STREAM_INTERRUPTED", emit: func(b *fakeBroker, p Payload) { b.mu.Lock(); b.subs[p.RequestID].messages <- nil; b.mu.Unlock() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, broker := newMemoryStore(), newFakeBroker()
			broker.subscribeErr = tc.subscription
			service, err := NewService(context.Background(), store, broker, senderFunc(func(_ context.Context, p Payload) error {
				if tc.emit != nil {
					tc.emit(broker, p)
				}
				if tc.definite {
					return &DispatchError{Definite: true}
				}
				return nil
			}), Options{Timeout: 80 * time.Millisecond, BufferLimit: tc.limit})
			if err != nil {
				t.Fatal(err)
			}
			defer service.Close()
			accepted, err := service.Start(context.Background(), testActor, Input{Message: "Вопрос"})
			if err != nil {
				t.Fatal(err)
			}
			feed := waitTerminal(t, service, accepted)
			events, _, _ := feed.Snapshot(0)
			var failure Error
			_ = json.Unmarshal(events[len(events)-1].Data, &failure)
			if failure.Code != tc.code {
				t.Fatalf("got %s, want %s", failure.Code, tc.code)
			}
		})
	}
}

func TestPersistenceFailureAndRetrySamePayload(t *testing.T) {
	store, broker := newMemoryStore(), newFakeBroker()
	var mu sync.Mutex
	var calls []Payload
	service, err := NewService(context.Background(), store, broker, senderFunc(func(_ context.Context, p Payload) error {
		mu.Lock()
		calls = append(calls, p)
		n := len(calls)
		mu.Unlock()
		if n == 1 {
			return &DispatchError{}
		}
		store.mu.Lock()
		store.failSave = true
		store.mu.Unlock()
		text := "Ответ"
		broker.emit(p.RequestID, NewEvent(p.RequestID, 1, "done", Done{FullText: &text, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")}))
		return nil
	}), Options{RecoveryInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	accepted, err := service.Start(context.Background(), testActor, Input{Message: "Вопрос"})
	if err != nil {
		t.Fatal(err)
	}
	feed := waitTerminal(t, service, accepted)
	events, _, _ := feed.Snapshot(0)
	var failure Error
	_ = json.Unmarshal(events[len(events)-1].Data, &failure)
	if failure.Code != "PERSISTENCE_ERROR" {
		t.Fatal("unconfirmed success published")
	}
	mu.Lock()
	if len(calls) != 2 || calls[0].RequestID != calls[1].RequestID || calls[0].Timestamp != calls[1].Timestamp {
		t.Fatal("retry changed payload")
	}
	mu.Unlock()
	store.mu.Lock()
	store.failSave = false
	store.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for {
		record, _ := store.Get(context.Background(), testActor, accepted.RequestID)
		if record.Status == "error" && record.Error.Code == "PERSISTENCE_ERROR" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("failed persistence not recovered")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRestartAndShutdown(t *testing.T) {
	store, broker := newMemoryStore(), newFakeBroker()
	id, _ := identifier.NewUUID()
	store.records[id] = Record{Request: Request{RequestID: id, Status: "running"}, UserID: testActor}
	service, err := NewService(context.Background(), store, broker, senderFunc(func(ctx context.Context, _ Payload) error { <-ctx.Done(); return ctx.Err() }), Options{})
	if err != nil {
		t.Fatal(err)
	}
	feed, err := service.Open(context.Background(), testActor, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	events, done, _ := feed.Snapshot(0)
	if !done || len(events) != 1 || events[0].Type != "error" {
		t.Fatal("orphan not interrupted")
	}
	accepted, err := service.Start(context.Background(), testActor, Input{Message: "Вопрос"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(context.Background(), testActor, Input{Message: "Еще"}); !errors.Is(err, ErrRunning) {
		t.Fatal("parallel generation accepted")
	}
	service.Close()
	record, _ := store.Get(context.Background(), testActor, accepted.RequestID)
	if record.Status != "error" {
		t.Fatal("shutdown left generation running")
	}
	if _, err := service.Start(context.Background(), testActor, Input{Message: "Еще"}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("closed service accepted request")
	}
}

func TestProposalProcessedBeforeSSEAndReplay(t *testing.T) {
	store, broker := newMemoryStore(), newFakeBroker()
	calls := 0
	service, err := NewService(context.Background(), store, broker, senderFunc(func(ctx context.Context, p Payload) error {
		proposal := NewEvent(p.RequestID, 1, "action_proposal", map[string]any{"action_type": "absences.create_request", "details": map[string]any{"date": "2030-01-01", "type": "day_off"}})
		broker.emit(p.RequestID, proposal)
		broker.emit(p.RequestID, proposal)
		full := ""
		broker.emit(p.RequestID, NewEvent(p.RequestID, 2, "done", Done{FullText: &full, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")}))
		<-ctx.Done()
		return ctx.Err()
	}), Options{ProcessEvent: func(_ context.Context, id string, e Event) (Event, error) {
		calls++
		return NewEvent(id, e.Seq, e.Type, map[string]any{"action_type": "absences.create_request", "action_id": "50000000-0000-0000-0000-000000000001", "status": "proposed", "details": map[string]any{}}), nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	accepted, err := service.Start(context.Background(), testActor, Input{Message: "Создать заявку"})
	if err != nil {
		t.Fatal(err)
	}
	feed := waitTerminal(t, service, accepted)
	events, done, _ := feed.Snapshot(0)
	if !done || len(events) != 2 || events[0].Type != "action_proposal" || events[1].Type != "done" || calls != 1 {
		t.Fatalf("events=%+v processed=%d", events, calls)
	}
	var data map[string]any
	if json.Unmarshal(events[0].Data, &data) != nil || data["action_id"] == nil {
		t.Fatal("unprocessed proposal reached SSE")
	}
	replay, err := service.Open(context.Background(), testActor, accepted.RequestID, 0)
	if err != nil {
		t.Fatal(err)
	}
	copied, _, _ := replay.Snapshot(0)
	if string(copied[0].Data) != string(events[0].Data) {
		t.Fatal("replay changed proposal")
	}
}
