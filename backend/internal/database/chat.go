package database

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	_ "time/tzdata"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Chat struct{ pool *pgxpool.Pool }

func NewChat(pool *pgxpool.Pool) *Chat { return &Chat{pool: pool} }

func payloadHash(payload chat.Payload) string {
	raw, _ := json.Marshal(payload)
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	raw, _ = json.Marshal(fields)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}
func snapshot(payload chat.Payload) []byte {
	raw, _ := json.Marshal(map[string]any{"role": payload.Role, "stage": payload.Stage, "timezone": payload.Timezone, "timestamp": payload.Timestamp})
	return raw
}

func (s *Chat) Create(ctx context.Context, actorID, id string, input chat.Input) (chat.Record, chat.Payload, error) {
	var record chat.Record
	payload := chat.Payload{RequestID: id, Message: input.Message, History: []chat.HistoryMessage{}, Timestamp: time.Now().UTC()}
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(id) || !chat.ValidateInput(&input) {
		return record, payload, chat.ErrInvalid
	}
	payload.Message = input.Message
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return record, payload, err
	}
	defer rollbackOnboarding(tx)
	err = tx.QueryRow(ctx, `SELECT u.id::text,u.team_id::text,u.role,COALESCE(u.timezone,t.timezone),
		COALESCE((SELECT current_stage FROM onboarding_plans WHERE intern_id=u.id AND status='active'),'not_applicable')
		FROM users u JOIN teams t ON t.id=u.team_id WHERE u.id=$1 AND u.active AND t.active FOR UPDATE OF u`, actorID).
		Scan(&payload.UserID, &payload.TeamID, &payload.Role, &payload.Timezone, &payload.Stage)
	if errors.Is(err, pgx.ErrNoRows) {
		return record, payload, auth.ErrUnauthorized
	}
	if err != nil {
		return record, payload, err
	}
	actor := planActor{id: payload.UserID, teamID: payload.TeamID, role: payload.Role}
	if reason := policy.Check(actor.policyActor(), policy.CreateChat, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}); reason != "" {
		return record, payload, denyPolicy(ctx, s.pool, tx, actor, policy.CreateChat, reason, chat.ErrNotFound)
	}
	if _, err := time.LoadLocation(payload.Timezone); err != nil {
		return record, payload, chat.ErrUnavailable
	}
	if input.ConversationID != "" {
		err = tx.QueryRow(ctx, `SELECT id::text FROM conversations WHERE id=$1 AND owner_id=$2 AND team_id=$3 AND status='active' FOR UPDATE`, input.ConversationID, actorID, payload.TeamID).Scan(&payload.ConversationID)
	} else {
		err = tx.QueryRow(ctx, `SELECT id::text FROM conversations WHERE owner_id=$1 AND team_id=$2 AND status='active' FOR UPDATE`, actorID, payload.TeamID).Scan(&payload.ConversationID)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `INSERT INTO conversations (team_id,owner_id) VALUES ($1,$2) RETURNING id::text`, payload.TeamID, actorID).Scan(&payload.ConversationID)
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return record, payload, denyPolicy(ctx, s.pool, tx, actor, policy.CreateChat, "resource_unavailable", chat.ErrNotFound)
	}
	if err != nil {
		return record, payload, err
	}
	var running bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM chat_requests WHERE conversation_id=$1 AND status='running')", payload.ConversationID).Scan(&running); err != nil {
		return record, payload, err
	}
	if running {
		return record, payload, chat.ErrRunning
	}
	rows, err := tx.Query(ctx, `SELECT u.content,a.content FROM chat_requests r JOIN chat_messages u ON u.request_id=r.id AND u.role='user'
		JOIN chat_messages a ON a.request_id=r.id AND a.role='assistant' WHERE r.conversation_id=$1 AND r.status='done'
		ORDER BY r.created_at DESC,r.id DESC LIMIT 5`, payload.ConversationID)
	if err != nil {
		return record, payload, err
	}
	pairs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) ([2]string, error) {
		var pair [2]string
		err := row.Scan(&pair[0], &pair[1])
		return pair, err
	})
	if err != nil {
		return record, payload, err
	}
	chars := 0
	var retained [][2]string
	for _, pair := range pairs {
		n := utf8.RuneCountInString(pair[0]) + utf8.RuneCountInString(pair[1])
		if chars+n > 20000 {
			break
		}
		chars += n
		retained = append(retained, pair)
	}
	for i := len(retained) - 1; i >= 0; i-- {
		payload.History = append(payload.History, chat.HistoryMessage{Role: "user", Content: retained[i][0]}, chat.HistoryMessage{Role: "assistant", Content: retained[i][1]})
	}
	_, err = tx.Exec(ctx, `INSERT INTO chat_requests (id,team_id,conversation_id,user_id,context_snapshot,input_hash,deadline_at,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, id, payload.TeamID, payload.ConversationID, actorID, snapshot(payload), payloadHash(payload), payload.Timestamp.Add(65*time.Second), payload.Timestamp)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return record, payload, chat.ErrRunning
		}
		return record, payload, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO chat_messages (request_id,role,content) VALUES ($1,'user',$2)", id, input.Message); err != nil {
		return record, payload, err
	}
	if _, err := tx.Exec(ctx, "UPDATE conversations SET updated_at=now() WHERE id=$1", payload.ConversationID); err != nil {
		return record, payload, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO events (team_id,actor_id,request_id,event_type,dedup_key) VALUES ($1,$2,$3,'chat_question',$4)`, payload.TeamID, actorID, id, "request:"+id+":chat_question"); err != nil {
		return record, payload, err
	}
	if err := tx.Commit(ctx); err != nil {
		return record, payload, err
	}
	record = chat.Record{Request: chat.Request{RequestID: id, Status: "running", CreatedAt: payload.Timestamp, StreamURL: chat.StreamURL(id)}, ConversationID: payload.ConversationID, UserID: actorID, TeamID: payload.TeamID}
	return record, payload, nil
}

func (s *Chat) Dispatch(ctx context.Context, payload chat.Payload, deadline time.Time) error {
	result, err := s.pool.Exec(ctx, "UPDATE chat_requests SET context_snapshot=$2,input_hash=$3,deadline_at=$4,updated_at=now() WHERE id=$1 AND status='running'", payload.RequestID, snapshot(payload), payloadHash(payload), deadline)
	if err == nil && result.RowsAffected() != 1 {
		return chat.ErrNotFound
	}
	return err
}

const requestColumns = `r.id::text,r.status,r.created_at,r.finished_at,r.error_code,r.error_message,r.conversation_id::text,r.user_id::text,r.team_id::text,r.last_seq`

func scanRequest(row pgx.Row, record *chat.Record) error {
	var code, message *string
	err := row.Scan(&record.RequestID, &record.Status, &record.CreatedAt, &record.FinishedAt, &code, &message, &record.ConversationID, &record.UserID, &record.TeamID, &record.LastSeq)
	if code != nil && message != nil {
		record.Error = &chat.Error{Code: *code, Message: *message}
	}
	record.CreatedAt = record.CreatedAt.UTC()
	if record.FinishedAt != nil {
		finished := record.FinishedAt.UTC()
		record.FinishedAt = &finished
	}
	record.StreamURL = chat.StreamURL(record.RequestID)
	return err
}

func (s *Chat) Get(ctx context.Context, actorID, id string) (chat.Record, error) {
	var record chat.Record
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(id) {
		return record, chat.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return record, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return record, err
	}
	err = scanRequest(tx.QueryRow(ctx, "SELECT "+requestColumns+" FROM chat_requests r WHERE r.id=$1 AND r.user_id=$2 AND r.team_id=$3", id, actor.id, actor.teamID), &record)
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.Record{}, denyPolicy(ctx, s.pool, tx, actor, policy.ReadChat, "resource_unavailable", chat.ErrNotFound)
	}
	if err != nil {
		return record, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ReadChat, policy.Resource{TeamID: record.TeamID, OwnerID: record.UserID}); reason != "" {
		return chat.Record{}, denyPolicy(ctx, s.pool, tx, actor, policy.ReadChat, reason, chat.ErrNotFound)
	}
	if record.Status == "done" {
		if err := tx.QueryRow(ctx, "SELECT content FROM chat_messages WHERE request_id=$1 AND role='assistant'", id).Scan(&record.FullText); err != nil {
			return record, err
		}
	}
	return record, tx.Commit(ctx)
}

func (s *Chat) Finish(ctx context.Context, id string, event chat.Event) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackOnboarding(tx)
	var record chat.Record
	if err := scanRequest(tx.QueryRow(ctx, "SELECT "+requestColumns+" FROM chat_requests r WHERE r.id=$1 FOR UPDATE", id), &record); err != nil {
		return err
	}
	var failure *chat.Error
	var text string
	switch event.Type {
	case "done":
		var done chat.Done
		if err := json.Unmarshal(event.Data, &done); err != nil || done.FullText == nil || done.Sources == nil || len(done.Sources) != 0 {
			return chat.ErrInvalid
		}
		text = *done.FullText
	case "error":
		failure = &chat.Error{}
		if err := json.Unmarshal(event.Data, failure); err != nil {
			return err
		}
	default:
		return chat.ErrInvalid
	}
	if record.Status != "running" {
		if record.LastSeq != event.Seq {
			return chat.ErrInvalid
		}
		if record.Status == "error" && failure != nil && record.Error != nil && *record.Error == *failure {
			return nil
		}
		if record.Status == "done" && event.Type == "done" {
			var saved string
			if err := tx.QueryRow(ctx, "SELECT content FROM chat_messages WHERE request_id=$1 AND role='assistant'", id).Scan(&saved); err != nil {
				return err
			}
			if saved == text {
				return nil
			}
		}
		return chat.ErrInvalid
	}
	if event.Type == "done" {
		if utf8.RuneCountInString(text) > 20000 {
			return chat.ErrInvalid
		}
		if text == "" {
			var proposed bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM actions_log WHERE request_id=$1)`, id).Scan(&proposed); err != nil {
				return err
			}
			if !proposed {
				return chat.ErrInvalid
			}
		}
		if _, err := tx.Exec(ctx, "INSERT INTO chat_messages (request_id,role,content) VALUES ($1,'assistant',$2)", id, text); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE chat_requests SET status='done',last_seq=$2,terminal_seq=$2,finished_at=now(),updated_at=now() WHERE id=$1", id, event.Seq); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO events (team_id,actor_id,request_id,event_type,dedup_key) VALUES ($1,$2,$3,'answer_completed',$4)`, record.TeamID, record.UserID, id, "request:"+id+":answer_completed"); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, "UPDATE chat_requests SET status='error',error_code=$2,error_message=$3,last_seq=$4,terminal_seq=$4,finished_at=now(),updated_at=now() WHERE id=$1", id, failure.Code, failure.Message, event.Seq); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Chat) Recover(ctx context.Context, startup bool, active []string) error {
	if active == nil {
		active = []string{}
	}
	_, err := s.pool.Exec(ctx, `UPDATE chat_requests SET status='error',error_code='STREAM_INTERRUPTED',
		error_message='Поток ответа прерван. Повторите запрос.',terminal_seq=last_seq+1,last_seq=last_seq+1,finished_at=now(),updated_at=now()
		WHERE status='running' AND NOT(id=ANY($1::uuid[])) AND ($2 OR deadline_at<=now())`, active, startup)
	return err
}

func (s *Chat) History(ctx context.Context, actorID, conversationID, cursor string, limit int) (chat.History, error) {
	result := chat.History{Items: []chat.Turn{}}
	if !identifier.ValidUUID(actorID) || (conversationID != "" && !identifier.ValidUUID(conversationID)) || limit < 1 || limit > 100 {
		return result, chat.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return result, err
	}
	var conv string
	if conversationID == "" {
		err = tx.QueryRow(ctx, "SELECT id::text FROM conversations WHERE owner_id=$1 AND team_id=$2 AND status='active'", actor.id, actor.teamID).Scan(&conv)
	} else {
		err = tx.QueryRow(ctx, "SELECT id::text FROM conversations WHERE id=$1 AND owner_id=$2 AND team_id=$3", conversationID, actor.id, actor.teamID).Scan(&conv)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if conversationID != "" {
			return result, denyPolicy(ctx, s.pool, tx, actor, policy.ReadChat, "resource_unavailable", chat.ErrNotFound)
		}
		if cursor != "" {
			return result, chat.ErrCursor
		}
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ReadChat, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}); reason != "" {
		return result, denyPolicy(ctx, s.pool, tx, actor, policy.ReadChat, reason, chat.ErrNotFound)
	}
	result.ConversationID = &conv
	var afterTime time.Time
	afterID := "00000000-0000-0000-0000-000000000000"
	if cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || !identifier.ValidUUID(string(decoded)) {
			return result, chat.ErrCursor
		}
		afterID = string(decoded)
		if err := tx.QueryRow(ctx, "SELECT created_at FROM chat_requests WHERE id=$1 AND conversation_id=$2", afterID, conv).Scan(&afterTime); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return result, chat.ErrCursor
			}
			return result, err
		}
	}
	rows, err := tx.Query(ctx, "SELECT "+requestColumns+" FROM chat_requests r WHERE conversation_id=$1 AND (created_at,id)>($2,$3::uuid) ORDER BY created_at,id LIMIT $4", conv, afterTime, afterID, limit+1)
	if err != nil {
		return result, err
	}
	records, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (chat.Record, error) {
		var record chat.Record
		err := scanRequest(row, &record)
		return record, err
	})
	if err != nil {
		return result, err
	}
	if len(records) > limit {
		next := base64.RawURLEncoding.EncodeToString([]byte(records[limit-1].RequestID))
		result.NextCursor = &next
		records = records[:limit]
	}
	for _, record := range records {
		turn := chat.Turn{Request: record.Request, Messages: []chat.Message{}, Actions: []json.RawMessage{}}
		rows, err := tx.Query(ctx, "SELECT id::text,role,content,sources,created_at FROM chat_messages WHERE request_id=$1 ORDER BY CASE role WHEN 'user' THEN 1 ELSE 2 END", record.RequestID)
		if err != nil {
			return result, err
		}
		messages, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (chat.Message, error) {
			var message chat.Message
			err := row.Scan(&message.ID, &message.Role, &message.Content, &message.Sources, &message.CreatedAt)
			message.CreatedAt = message.CreatedAt.UTC()
			return message, err
		})
		if err != nil {
			return result, err
		}
		turn.Messages = messages
		actionRows, err := tx.Query(ctx, `SELECT `+publicActionColumns+` FROM actions_log WHERE request_id=$1 AND actor_id=$2 AND team_id=$3 ORDER BY proposal_seq,id`, record.RequestID, actor.id, actor.teamID)
		if err != nil {
			return result, err
		}
		actions, err := pgx.CollectRows(actionRows, func(row pgx.CollectableRow) (json.RawMessage, error) {
			action, err := readPublicAction(row)
			if err != nil {
				return nil, err
			}
			return json.Marshal(action)
		})
		if err != nil {
			return result, err
		}
		if actions != nil {
			turn.Actions = actions
		}
		result.Items = append(result.Items, turn)
	}
	var activeRecord chat.Record
	err = scanRequest(tx.QueryRow(ctx, "SELECT "+requestColumns+" FROM chat_requests r WHERE conversation_id=$1 AND status='running'", conv), &activeRecord)
	if err == nil {
		result.ActiveRequest = &activeRecord.Request
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	return result, tx.Commit(ctx)
}
