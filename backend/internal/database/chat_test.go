package database

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

const chatAnya = "a24a3478-cf42-51b1-b05b-9833260247a5"

func metadataString(value string) *string { return &value }

func chatStore(t *testing.T) *Chat {
	t.Helper()
	pool := testPool(t)
	if err := Prepare(context.Background(), pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	return NewChat(pool)
}
func createChat(t *testing.T, store *Chat, input chat.Input) (chat.Record, chat.Payload) {
	t.Helper()
	id, err := identifier.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	record, payload, err := store.Create(context.Background(), chatAnya, id, input)
	if err != nil {
		t.Fatal(err)
	}
	return record, payload
}
func finishChat(t *testing.T, store *Chat, id, text string) {
	t.Helper()
	event := chat.NewEvent(id, 3, "done", chat.Done{FullText: &text, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")})
	if err := store.Finish(context.Background(), id, event); err != nil {
		t.Fatal(err)
	}
}

func TestChatStorageHistoryAndPermissions(t *testing.T) {
	store := chatStore(t)
	ctx := context.Background()
	history, err := store.History(ctx, chatAnya, "", "", 50)
	if err != nil || history.ConversationID != nil || len(history.Items) != 0 {
		t.Fatal("empty history mismatch", err)
	}
	record, payload := createChat(t, store, chat.Input{Message: " Вопрос "})
	if payload.UserID != chatAnya || payload.Role != "intern" || payload.Stage != "week_1" || payload.Timezone != "Europe/Moscow" || payload.Message != "Вопрос" || payload.History == nil {
		t.Fatal("untrusted context or message", payload)
	}
	var questionPayload map[string]string
	if err := store.pool.QueryRow(ctx, "SELECT payload FROM events WHERE request_id=$1 AND event_type='chat_question'", record.RequestID).Scan(&questionPayload); err != nil || questionPayload["conversation_id"] != record.ConversationID {
		t.Fatal("chat_question payload mismatch", err, questionPayload)
	}
	id, _ := identifier.NewUUID()
	if _, _, err := store.Create(ctx, chatAnya, id, chat.Input{Message: "Еще"}); !errors.Is(err, chat.ErrRunning) {
		t.Fatal("parallel generation accepted", err)
	}
	for _, actor := range []string{"4a59a828-3b1a-55e4-bf9b-81db5ad6183a", "2db7cc77-4114-52d8-a833-f670ab60e4e0"} {
		if _, err := store.Get(ctx, actor, record.RequestID); !errors.Is(err, chat.ErrNotFound) {
			t.Fatal("foreign stream accepted", err)
		}
		if _, err := store.History(ctx, actor, record.ConversationID, "", 50); !errors.Is(err, chat.ErrNotFound) {
			t.Fatal("foreign conversation accepted", err)
		}
	}
	payload.Timestamp = time.Now().UTC()
	deadline := payload.Timestamp.Add(time.Minute)
	if err := store.Dispatch(ctx, payload, deadline); err != nil {
		t.Fatal(err)
	}
	var savedDeadline time.Time
	if err := store.pool.QueryRow(ctx, "SELECT deadline_at FROM chat_requests WHERE id=$1", record.RequestID).Scan(&savedDeadline); err != nil || savedDeadline.Sub(deadline) > time.Microsecond || deadline.Sub(savedDeadline) > time.Microsecond {
		t.Fatal("deadline mismatch", err)
	}
	finishChat(t, store, record.RequestID, "Первый ответ")
	finishChat(t, store, record.RequestID, "Первый ответ")
	var answerPayload map[string]string
	if err := store.pool.QueryRow(ctx, "SELECT payload FROM events WHERE request_id=$1 AND event_type='answer_completed'", record.RequestID).Scan(&answerPayload); err != nil || answerPayload["answer_status"] != "answered" || answerPayload["question_category"] != "other" {
		t.Fatal("answer_completed payload mismatch", err, answerPayload)
	}
	saved, err := store.Get(ctx, chatAnya, record.RequestID)
	if err != nil || saved.Status != "done" || saved.FullText != "Первый ответ" || saved.LastSeq != 3 {
		t.Fatal("final state mismatch", err)
	}
	second, secondPayload := createChat(t, store, chat.Input{ConversationID: record.ConversationID, Message: "Следующий"})
	if len(secondPayload.History) != 2 || secondPayload.History[0].Content != "Вопрос" || secondPayload.History[1].Content != "Первый ответ" {
		t.Fatal("LLM history mismatch", secondPayload.History)
	}
	history, err = store.History(ctx, chatAnya, "", "", 1)
	if err != nil || len(history.Items) != 1 || len(history.Items[0].Messages) != 2 || history.NextCursor == nil || history.ActiveRequest == nil || history.ActiveRequest.RequestID != second.RequestID {
		t.Fatal("history pagination mismatch", err)
	}
	page, err := store.History(ctx, chatAnya, record.ConversationID, *history.NextCursor, 1)
	if err != nil || len(page.Items) != 1 || page.Items[0].Request.RequestID != second.RequestID || page.NextCursor != nil || len(page.Items[0].Messages) != 1 {
		t.Fatal("next page mismatch", err)
	}
	if _, err := store.History(ctx, chatAnya, record.ConversationID, "invalid!", 1); !errors.Is(err, chat.ErrCursor) {
		t.Fatal("invalid cursor accepted", err)
	}
	if err := store.Finish(ctx, second.RequestID, chat.Failure(second.RequestID, 1, "LLM_UNAVAILABLE")); err != nil {
		t.Fatal(err)
	}
	third, payload := createChat(t, store, chat.Input{Message: "После ошибки"})
	if len(payload.History) != 2 {
		t.Fatal("failed pair entered LLM history")
	}
	if err := store.Recover(ctx, true, nil); err != nil {
		t.Fatal(err)
	}
	saved, err = store.Get(ctx, chatAnya, third.RequestID)
	if err != nil || saved.Status != "error" || saved.Error.Code != "STREAM_INTERRUPTED" {
		t.Fatal("orphan not recovered", err)
	}
	if _, err := store.pool.Exec(ctx, "UPDATE users SET active=false WHERE id=$1", chatAnya); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, chatAnya, record.RequestID); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("revoked access accepted", err)
	}
}

func TestChatFinishPersistsOnlyTeamSourcesAndPreservesMetadata(t *testing.T) {
	store := chatStore(t)
	ctx := context.Background()
	record, _ := createChat(t, store, chat.Input{Message: "Ответь с источником"})
	var sourceID string
	if err := store.pool.QueryRow(ctx, `INSERT INTO kb_documents
		(team_id,slug,title,content,source_type,status,index_status,indexed_revision)
		VALUES ($1,'synthetic-guide','Synthetic guide','Synthetic content','seed','published','ready',1)
		RETURNING id::text`, record.TeamID).Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	fullText, answerStatus, category := "Grounded answer", "answered", "process"
	source, err := json.Marshal(map[string]any{
		"document_id": sourceID,
		"revision":    1,
		"title":       "Synthetic guide",
		"section":     "Setup",
		"url":         "kb/synthetic-guide",
	})
	if err != nil {
		t.Fatal(err)
	}
	event := chat.NewEvent(record.RequestID, 1, "done", chat.Done{
		FullText:         &fullText,
		Sources:          []json.RawMessage{source},
		AnswerStatus:     &answerStatus,
		QuestionCategory: &category,
	})
	if err := store.Finish(ctx, record.RequestID, event); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(ctx, record.RequestID, event); err != nil {
		t.Fatal("source replay rejected", err)
	}
	var sourceEventCount int
	var sourcePayload map[string]any
	if err := store.pool.QueryRow(ctx, `SELECT payload FROM events WHERE request_id=$1 AND event_type='answer_with_source'`, record.RequestID).Scan(&sourcePayload); err != nil {
		t.Fatal(err)
	}
	if sourcePayload["source_count"] != float64(1) {
		t.Fatal("source event mismatch", sourcePayload)
	}
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM events WHERE request_id=$1 AND event_type='answer_with_source'`, record.RequestID).Scan(&sourceEventCount); err != nil || sourceEventCount != 1 {
		t.Fatal("source event duplicated", sourceEventCount, err)
	}

	saved, err := store.Get(ctx, chatAnya, record.RequestID)
	if err != nil || saved.FullText != fullText || len(saved.Sources) != 1 || saved.AnswerStatus == nil || *saved.AnswerStatus != answerStatus || saved.QuestionCategory == nil || *saved.QuestionCategory != category {
		t.Fatal("answer metadata was not persisted", err)
	}
	history, err := store.History(ctx, chatAnya, record.ConversationID, "", 50)
	if err != nil || len(history.Items) != 1 || len(history.Items[0].Messages) != 2 || len(history.Items[0].Messages[1].Sources) != 1 {
		t.Fatal("source snapshot was not restored from history", err)
	}
	if history.Items[0].Messages[1].AnswerStatus == nil || *history.Items[0].Messages[1].AnswerStatus != answerStatus || history.Items[0].Messages[1].QuestionCategory == nil || *history.Items[0].Messages[1].QuestionCategory != category {
		t.Fatal("answer metadata was not restored from history")
	}

	foreign, _ := createChat(t, store, chat.Input{Message: "Не показывай чужие источники"})
	var foreignTeam string
	if err := store.pool.QueryRow(ctx, "SELECT team_id::text FROM users WHERE login='intern_petr'").Scan(&foreignTeam); err != nil {
		t.Fatal(err)
	}
	var foreignSourceID string
	if err := store.pool.QueryRow(ctx, `INSERT INTO kb_documents
		(team_id,slug,title,content,source_type,status,index_status,indexed_revision)
		VALUES ($1,'foreign-guide','Foreign guide','Foreign content','seed','published','ready',1)
		RETURNING id::text`, foreignTeam).Scan(&foreignSourceID); err != nil {
		t.Fatal(err)
	}
	foreignSource, _ := json.Marshal(map[string]any{
		"document_id": foreignSourceID,
		"revision":    1,
		"title":       "Foreign guide",
		"section":     "Private",
		"url":         "kb/foreign-guide",
	})
	if err := store.Finish(ctx, foreign.RequestID, chat.NewEvent(foreign.RequestID, 1, "done", chat.Done{
		FullText: &fullText,
		Sources:  []json.RawMessage{foreignSource},
	})); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("foreign source accepted", err)
	}
}

func TestChatConcurrentCreateAndAtomicFinish(t *testing.T) {
	store := chatStore(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			id, _ := identifier.NewUUID()
			_, _, err := store.Create(ctx, chatAnya, id, chat.Input{Message: "Вопрос"})
			results <- err
		})
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, chat.ErrRunning) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("concurrent starts: %d/%d", ok, conflict)
	}
	var id string
	if err := store.pool.QueryRow(ctx, "SELECT id::text FROM chat_requests WHERE status='running'").Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, "ALTER TABLE events ADD CONSTRAINT reject_chat_success CHECK (event_type<>'answer_completed') NOT VALID"); err != nil {
		t.Fatal(err)
	}
	text := "Ответ"
	if err := store.Finish(ctx, id, chat.NewEvent(id, 2, "done", chat.Done{FullText: &text, Sources: []json.RawMessage{}, AnswerStatus: metadataString("answered"), QuestionCategory: metadataString("other")})); err == nil {
		t.Fatal("expected persistence failure")
	}
	record, err := store.Get(ctx, chatAnya, id)
	if err != nil || record.Status != "running" {
		t.Fatal("partial success persisted", err)
	}
	var messages int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM chat_messages WHERE request_id=$1", id).Scan(&messages); err != nil || messages != 1 {
		t.Fatal("partial assistant persisted", err)
	}
	if err := store.Finish(ctx, id, chat.Failure(id, 2, "PERSISTENCE_ERROR")); err != nil {
		t.Fatal(err)
	}
}

func TestLLMHistoryKeepsWholePairs(t *testing.T) {
	store := chatStore(t)
	for i := 0; i < 7; i++ {
		record, _ := createChat(t, store, chat.Input{Message: strings.Repeat("я", 1000)})
		finishChat(t, store, record.RequestID, strings.Repeat("а", 1000))
	}
	record, payload := createChat(t, store, chat.Input{Message: "Еще"})
	if len(payload.History) != 10 {
		t.Fatalf("history length=%d", len(payload.History))
	}
	finishChat(t, store, record.RequestID, strings.Repeat("б", 20000))
	_, payload = createChat(t, store, chat.Input{Message: "После длинного ответа"})
	if len(payload.History) != 0 {
		t.Fatal("oversized newest pair should yield empty history")
	}
}

func TestChatCompletionMetadataAndReplay(t *testing.T) {
	store := chatStore(t)
	ctx := context.Background()
	text := "Ответ"
	for _, classified := range []bool{false, true} {
		record, _ := createChat(t, store, chat.Input{Message: "Вопрос"})
		done := chat.Done{FullText: &text, Sources: []json.RawMessage{}}
		if classified {
			done.AnswerStatus, done.QuestionCategory = metadataString("unknown"), metadataString("technical")
		}
		event := chat.NewEvent(record.RequestID, 1, "done", done)
		if err := store.Finish(ctx, record.RequestID, event); err != nil {
			t.Fatal(err)
		}
		if err := store.Finish(ctx, record.RequestID, event); err != nil {
			t.Fatal("identical replay rejected", err)
		}
		saved, err := store.Get(ctx, chatAnya, record.RequestID)
		if err != nil || !reflect.DeepEqual(saved.AnswerStatus, done.AnswerStatus) || !reflect.DeepEqual(saved.QuestionCategory, done.QuestionCategory) {
			t.Fatal("completion metadata changed", saved, err)
		}
		done.AnswerStatus, done.QuestionCategory = metadataString("answered"), metadataString("other")
		if err := store.Finish(ctx, record.RequestID, chat.NewEvent(record.RequestID, 1, "done", done)); !errors.Is(err, chat.ErrInvalid) {
			t.Fatal("conflicting replay accepted", err)
		}
		var count int
		if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE request_id=$1 AND event_type='answer_completed'", record.RequestID).Scan(&count); err != nil || count != 1 {
			t.Fatal("completion duplicated", count, err)
		}
	}
}
