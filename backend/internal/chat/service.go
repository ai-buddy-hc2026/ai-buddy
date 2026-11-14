package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type Store interface {
	Create(context.Context, string, string, Input) (Record, Payload, error)
	Dispatch(context.Context, Payload, time.Time) error
	Get(context.Context, string, string) (Record, error)
	Finish(context.Context, string, Event) error
	History(context.Context, string, string, string, int) (History, error)
	Recover(context.Context, bool, []string) error
}
type Options struct {
	Timeout, Retention, RecoveryInterval time.Duration
	BufferLimit                          int
	ProcessEvent                         func(context.Context, string, Event) (Event, error)
}

type Service struct {
	store   Store
	broker  Broker
	sender  Sender
	options Options
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	states  map[string]*Feed
	closed  bool
	wg      sync.WaitGroup
}
type Feed struct {
	mu         sync.Mutex
	events     []Event
	notify     chan struct{}
	done       bool
	finishedAt time.Time
	pending    bool
}

func (f *Feed) Snapshot(after int) ([]Event, bool, <-chan struct{}) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var events []Event
	for _, event := range f.events {
		if event.Seq > after {
			events = append(events, event)
		}
	}
	return events, f.done, f.notify
}
func (f *Feed) append(event Event, terminal, pending bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, event)
	f.done, f.pending = terminal, pending
	if terminal {
		f.finishedAt = time.Now()
	}
	close(f.notify)
	f.notify = make(chan struct{})
}

func NewService(ctx context.Context, store Store, broker Broker, sender Sender, options Options) (*Service, error) {
	if options.Timeout <= 0 {
		options.Timeout = 60 * time.Second
	}
	if options.Retention <= 0 {
		options.Retention = 10 * time.Minute
	}
	if options.RecoveryInterval <= 0 {
		options.RecoveryInterval = 10 * time.Second
	}
	if options.BufferLimit <= 0 {
		options.BufferLimit = MaxBuffer
	}
	recoverCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := store.Recover(recoverCtx, true, nil)
	cancel()
	if err != nil {
		return nil, ErrUnavailable
	}
	root, stop := context.WithCancel(ctx)
	s := &Service{store: store, broker: broker, sender: sender, options: options, ctx: root, cancel: stop, states: make(map[string]*Feed)}
	s.wg.Go(s.reap)
	return s, nil
}

func (s *Service) Close() { s.mu.Lock(); s.closed = true; s.cancel(); s.mu.Unlock(); s.wg.Wait() }

func (s *Service) Start(_ context.Context, actorID string, input Input) (Accepted, error) {
	var result Accepted
	if !identifier.ValidUUID(actorID) || !ValidateInput(&input) {
		return result, ErrInvalid
	}
	id, err := identifier.NewUUID()
	if err != nil {
		return result, ErrUnavailable
	}
	feed := &Feed{notify: make(chan struct{})}
	s.mu.Lock()
	if s.closed || s.ctx.Err() != nil {
		s.mu.Unlock()
		return result, ErrUnavailable
	}
	s.states[id] = feed
	s.wg.Add(1)
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	record, payload, err := s.store.Create(ctx, actorID, id, input)
	cancel()
	if err != nil {
		s.mu.Lock()
		delete(s.states, id)
		s.mu.Unlock()
		s.wg.Done()
		return result, err
	}
	go func() { defer s.wg.Done(); s.run(feed, payload) }()
	return Accepted{RequestID: id, ConversationID: record.ConversationID, Status: record.Status, StreamURL: StreamURL(id)}, nil
}

func (s *Service) Open(ctx context.Context, actorID, id string, after int) (*Feed, error) {
	if !identifier.ValidUUID(id) || after < 0 {
		return nil, ErrInvalid
	}
	record, err := s.store.Get(ctx, actorID, id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	feed := s.states[id]
	s.mu.Unlock()
	if feed != nil {
		feed.mu.Lock()
		last := 0
		if len(feed.events) > 0 {
			last = feed.events[len(feed.events)-1].Seq
		}
		feed.mu.Unlock()
		if after > last {
			return nil, ErrCursor
		}
		return feed, nil
	}
	if record.Status == "running" {
		return nil, ErrUnavailable
	} // Восстановление осиротевших running выполняет Recover.
	if after > record.LastSeq {
		return nil, ErrCursor
	}
	feed = &Feed{notify: make(chan struct{})}
	var event Event
	if record.Status == "done" {
		text := record.FullText
		sources := record.Sources
		if sources == nil {
			sources = []json.RawMessage{}
		}
		event = NewEvent(id, record.LastSeq, "done", Done{
			FullText:         &text,
			Sources:          sources,
			AnswerStatus:     record.AnswerStatus,
			QuestionCategory: record.QuestionCategory,
		})
	} else {
		event = NewEvent(id, record.LastSeq, "error", record.Error)
	}
	feed.append(event, true, false)
	return feed, nil
}

func (s *Service) History(ctx context.Context, actorID, conversationID, cursor string, limit int) (History, error) {
	return s.store.History(ctx, actorID, conversationID, cursor, limit)
}

func (s *Service) finish(feed *Feed, event Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err := s.store.Finish(ctx, event.RequestID, event)
	cancel()
	if err == nil {
		feed.append(event, true, false)
		return
	}
	event = Failure(event.RequestID, event.Seq, "PERSISTENCE_ERROR")
	ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
	err = s.store.Finish(ctx, event.RequestID, event)
	cancel()
	feed.append(event, true, err != nil)
}

func (s *Service) run(feed *Feed, payload Payload) {
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	last := 0
	fail := func(code string) { s.finish(feed, Failure(payload.RequestID, last+1, code)) }
	setup, stop := context.WithTimeout(ctx, 5*time.Second)
	sub, err := s.broker.Subscribe(setup, payload.RequestID)
	stop()
	if err != nil {
		fail("STREAM_INTERRUPTED")
		return
	}
	defer func() { _ = sub.Close() }()
	closeOnCancel := context.AfterFunc(ctx, func() { _ = sub.Close() })
	defer closeOnCancel()
	payload.Timestamp = time.Now().UTC()
	deadline := payload.Timestamp.Add(s.options.Timeout)
	setup, stop = context.WithTimeout(ctx, 5*time.Second)
	err = s.store.Dispatch(setup, payload, deadline)
	stop()
	if err != nil {
		fail("PERSISTENCE_ERROR")
		return
	}
	timer := time.NewTimer(time.Until(deadline))
	defer timer.Stop()
	type received struct {
		raw []byte
		err error
	}
	stream := make(chan received, 1)
	var reader sync.WaitGroup
	reader.Go(func() {
		for {
			raw, err := sub.Receive(ctx)
			select {
			case stream <- received{raw, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	})
	defer func() { cancel(); _ = sub.Close(); reader.Wait() }()
	dispatch := make(chan error, 1)
	var sending sync.WaitGroup
	send := func() {
		sending.Go(func() {
			sendCtx, done := context.WithTimeout(ctx, 5*time.Second)
			defer done()
			err := s.sender.Send(sendCtx, payload)
			select {
			case dispatch <- err:
			case <-ctx.Done():
			}
		})
	}
	defer func() { cancel(); sending.Wait() }()
	send()
	retried := false
	seen := make(map[int][32]byte)
	size, characters := 0, 0
	for {
		select {
		case <-ctx.Done():
			fail("STREAM_INTERRUPTED")
			return
		case <-timer.C:
			fail("GENERATION_TIMEOUT")
			return
		case err := <-dispatch:
			if err == nil || last > 0 {
				continue
			}
			if definiteDispatch(err) {
				fail("AI_UNAVAILABLE")
				return
			}
			if !retried {
				retried = true
				send()
			}
		case message := <-stream:
			if message.err != nil {
				fail("STREAM_INTERRUPTED")
				return
			}
			if time.Now().After(deadline) {
				fail("GENERATION_TIMEOUT")
				return
			}
			if len(message.raw) > s.options.BufferLimit {
				fail("BUFFER_LIMIT")
				return
			}
			event, err := ParseEvent(message.raw, payload.RequestID)
			if err != nil {
				fail("INVALID_AI_EVENT")
				return
			}
			canonical, _ := json.Marshal(event)
			hash := sha256.Sum256(canonical)
			if event.Seq <= last {
				if previous, ok := seen[event.Seq]; ok && bytes.Equal(previous[:], hash[:]) {
					continue
				}
				fail("INVALID_AI_EVENT")
				return
			}
			if event.Seq != last+1 {
				fail("INVALID_AI_EVENT")
				return
			}
			reserve := 0
			if event.Type == "token" {
				reserve = 512
			} // Оставляем место терминальной ошибке BUFFER_LIMIT.
			if size+len(canonical)+reserve > s.options.BufferLimit {
				fail("BUFFER_LIMIT")
				return
			}
			if event.Type == "token" {
				var token Token
				_ = json.Unmarshal(event.Data, &token)
				characters += utf8.RuneCountInString(*token.Text)
				if characters > 20000 {
					fail("INVALID_AI_EVENT")
					return
				}
			}
			seen[event.Seq] = hash
			size += len(canonical)
			if event.Type == "tool_call" || event.Type == "action_proposal" {
				if s.options.ProcessEvent == nil {
					fail("INVALID_AI_EVENT")
					return
				}
				processed, err := s.options.ProcessEvent(ctx, payload.RequestID, event)
				if err != nil {
					fail("INVALID_AI_EVENT")
					return
				}
				encoded, _ := json.Marshal(processed)
				if size+len(encoded)-len(canonical) > s.options.BufferLimit {
					fail("BUFFER_LIMIT")
					return
				}
				size += len(encoded) - len(canonical)
				last = event.Seq
				feed.append(processed, false, false)
				continue
			}
			if event.Type != "token" {
				s.finish(feed, event)
				return
			}
			last = event.Seq
			feed.append(event, false, false)
		}
	}
}

func (s *Service) reap() {
	ticker := time.NewTicker(s.options.RecoveryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			var active []string
			pending := make(map[string]Event)
			for id, feed := range s.states {
				feed.mu.Lock()
				if !feed.done {
					active = append(active, id)
				}
				if feed.pending {
					pending[id] = feed.events[len(feed.events)-1]
				}
				expired := feed.done && !feed.pending && time.Since(feed.finishedAt) >= s.options.Retention
				feed.mu.Unlock()
				if expired {
					delete(s.states, id)
				}
			}
			s.mu.Unlock()
			for id, event := range pending {
				ctx, cancel := context.WithTimeout(s.ctx, 2*time.Second)
				err := s.store.Finish(ctx, id, event)
				cancel()
				if err == nil {
					s.mu.Lock()
					feed := s.states[id]
					s.mu.Unlock()
					if feed != nil {
						feed.mu.Lock()
						feed.pending = false
						feed.mu.Unlock()
					}
				}
				active = append(active, id) // Не затираем ожидающий сохранения исходный PERSISTENCE_ERROR.
			}
			ctx, cancel := context.WithTimeout(s.ctx, 2*time.Second)
			_ = s.store.Recover(ctx, false, active)
			cancel()
		}
	}
}
