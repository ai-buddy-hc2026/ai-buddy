package database

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/escalation"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Escalations struct {
	pool     *pgxpool.Pool
	listings *Listings
}

func NewEscalations(pool *pgxpool.Pool, key []byte) (*Escalations, error) {
	listings, err := NewListings(pool, key)
	if err != nil {
		return nil, err
	}
	return &Escalations{pool: pool, listings: listings}, nil
}

func escalationVersion(updatedAt time.Time) string {
	return updatedAt.UTC().Format(time.RFC3339Nano)
}

func (s *Escalations) Answer(ctx context.Context, actorID, escalationID string, request escalation.AnswerRequest) (escalation.Answer, error) {
	var result escalation.Answer
	if !utf8.ValidString(request.AnswerText) || strings.TrimSpace(request.AnswerText) == "" || utf8.RuneCountInString(request.AnswerText) > 20000 || request.Version == "" {
		return result, escalation.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, true)
	if err != nil {
		return result, err
	}
	if actor.role != "buddy" {
		return result, denyPolicy(ctx, s.pool, tx, actor, policy.AnswerEscalation, "role_denied", escalation.ErrDenied)
	}
	var teamID, internID, buddyID, status, answerText, question string
	var answeredBy *string
	var answeredAt *time.Time
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `SELECT team_id::text,intern_id::text,buddy_id::text,status,COALESCE(answer_text,''),question,
	answered_by::text,answered_at,updated_at FROM escalations WHERE id=$1 AND team_id=$2 FOR UPDATE`, escalationID, actor.teamID).
		Scan(&teamID, &internID, &buddyID, &status, &answerText, &question, &answeredBy, &answeredAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, escalation.ErrNotFound
	}
	if err != nil {
		return result, err
	}
	if reason := policy.Check(actor.policyActor(), policy.AnswerEscalation, policy.Resource{TeamID: teamID, BuddyID: buddyID}); reason != "" {
		return result, denyPolicy(ctx, s.pool, tx, actor, policy.AnswerEscalation, reason, escalation.ErrNotFound)
	}
	var currentlyAssigned bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users i JOIN users b ON b.id=i.buddy_id AND b.team_id=i.team_id
	WHERE i.id=$1 AND i.team_id=$2 AND i.active AND i.role='intern' AND b.id=$3 AND b.active AND b.role='buddy')`, internID, teamID, actor.id).Scan(&currentlyAssigned); err != nil {
		return result, err
	}
	if !currentlyAssigned {
		return result, denyPolicy(ctx, s.pool, tx, actor, policy.AnswerEscalation, "assignment_changed", escalation.ErrNotFound)
	}
	if status == "closed" {
		return result, escalation.ErrConflict
	}
	var kbID *string
	var kbStatus string
	err = tx.QueryRow(ctx, `SELECT id::text,index_status FROM kb_documents WHERE source_escalation_id=$1`, escalationID).Scan(&kbID, &kbStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		kbID, kbStatus = nil, "not_added"
	}
	currentVersion := escalationVersion(updatedAt)
	if request.Version != currentVersion {
		if request.AnswerText != answerText || request.AddToKB && kbID == nil {
			return result, escalation.ErrConflict
		}
		result = escalation.Answer{ID: escalationID, Status: status, AnswerText: answerText, AnsweredBy: deref(answeredBy), AnsweredAt: derefTime(answeredAt), AddToKB: kbID != nil, KBDocumentID: kbID, KBStatus: kbStatus, Version: currentVersion}
		if err := tx.Commit(ctx); err != nil {
			return escalation.Answer{}, err
		}
		return result, nil
	}
	if status == "answered" && request.AnswerText == answerText && (!request.AddToKB || kbID != nil) {
		result = escalation.Answer{ID: escalationID, Status: status, AnswerText: answerText, AnsweredBy: deref(answeredBy), AnsweredAt: derefTime(answeredAt), AddToKB: kbID != nil, KBDocumentID: kbID, KBStatus: kbStatus, Version: currentVersion}
		if err := tx.Commit(ctx); err != nil {
			return escalation.Answer{}, err
		}
		return result, nil
	}
	if request.AddToKB {
		content := "Тестовая инструкция, не регламент Авито\n\n" + request.AnswerText
		title := "Ответ наставника: " + strings.TrimSpace(question)
		if utf8.RuneCountInString(title) > 500 {
			runes := []rune(title)
			title = string(runes[:500])
		}
		slug := "buddy-answer-" + escalationID
		var documentID string
		err = tx.QueryRow(ctx, `INSERT INTO kb_documents(team_id,slug,title,content,source_type,source_escalation_id,created_by,revision,status,index_status,indexed_revision)
		VALUES($1,$2,$3,$4,'buddy_answer',$5,$6,1,'published','ready',1)
		ON CONFLICT(source_escalation_id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,
		 revision=kb_documents.revision+CASE WHEN kb_documents.content IS DISTINCT FROM EXCLUDED.content THEN 1 ELSE 0 END,
		 status='published',index_status='ready',indexed_revision=kb_documents.revision+CASE WHEN kb_documents.content IS DISTINCT FROM EXCLUDED.content THEN 1 ELSE 0 END,
		 index_error=NULL,updated_at=clock_timestamp()
		RETURNING id::text,index_status`, teamID, slug, title, content, escalationID, actor.id).Scan(&documentID, &kbStatus)
		if err != nil {
			return result, err
		}
		kbID = &documentID
	}
	err = tx.QueryRow(ctx, `UPDATE escalations SET status='answered',answer_text=$3,answered_by=$2,answered_at=clock_timestamp(),updated_at=clock_timestamp()
	WHERE id=$1 RETURNING answered_at,updated_at`, escalationID, actor.id, request.AnswerText).Scan(&answeredAt, &updatedAt)
	if err != nil {
		return result, err
	}
	if err := tx.Commit(ctx); err != nil {
		return escalation.Answer{}, err
	}
	return escalation.Answer{ID: escalationID, Status: "answered", AnswerText: request.AnswerText, AnsweredBy: actor.id, AnsweredAt: *answeredAt,
		AddToKB: kbID != nil, KBDocumentID: kbID, KBStatus: kbStatus, Version: escalationVersion(updatedAt)}, nil
}

func (s *Escalations) List(ctx context.Context, actorID string, query escalation.ListQuery) (escalation.Page, error) {
	page := escalation.Page{Items: []escalation.Record{}}
	if !identifier.ValidUUID(actorID) || query.Limit < 1 || query.Limit > 100 || len(query.Cursor) > 2048 ||
		(query.Status != "" && query.Status != "open" && query.Status != "answered" && query.Status != "closed") ||
		(query.InternID != "" && !identifier.ValidUUID(query.InternID)) {
		return page, escalation.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return page, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return page, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ListBuddyInterns, policy.Resource{TeamID: actor.teamID, BuddyID: actor.id}); reason != "" {
		return page, denyPolicy(ctx, s.pool, tx, actor, policy.ListBuddyInterns, reason, escalation.ErrDenied)
	}
	scope := listScope{Kind: "escalations", Actor: actor.id, Team: actor.teamID, Status: query.Status, Conversation: query.InternID}
	var beforeID *string
	var beforeTime *time.Time
	if query.Cursor != "" {
		cursor, err := s.listings.decodeCursor(query.Cursor, scope)
		if err != nil {
			return page, escalation.ErrInvalid
		}
		beforeID = &cursor.ID
		beforeTime = &cursor.CreatedAt
	}
	rows, err := tx.Query(ctx, `SELECT e.id::text,e.action_id::text,e.intern_id::text,e.buddy_id::text,e.question,e.context_snapshot,
	e.status,e.answer_text,e.answered_by::text,e.answered_at,e.updated_at,e.created_at,
	d.id::text,d.revision,d.status,d.index_status,d.indexed_revision,d.index_error
	FROM escalations e JOIN users i ON i.id=e.intern_id AND i.team_id=e.team_id
	JOIN teams t ON t.id=e.team_id LEFT JOIN kb_documents d ON d.source_escalation_id=e.id
	WHERE e.team_id=$1 AND e.buddy_id=$2 AND i.active AND i.role='intern' AND i.buddy_id=$2 AND t.active
	AND ($3='' OR e.status=$3) AND ($4::uuid IS NULL OR e.intern_id=$4)
	AND ($5::timestamptz IS NULL OR (e.created_at,e.id)<($5,$6::uuid))
	ORDER BY e.created_at DESC,e.id DESC LIMIT $7`, actor.teamID, actor.id, query.Status, optionalID(query.InternID), beforeTime, beforeID, query.Limit+1)
	if err != nil {
		return page, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (escalation.Record, error) {
		var item escalation.Record
		var answerText, answeredBy, documentID, documentStatus, indexStatus, indexError pgtype.Text
		var answeredAt pgtype.Timestamptz
		var revision, indexedRevision pgtype.Int4
		var snapshot []byte
		err := row.Scan(&item.ID, &item.ActionID, &item.InternID, &item.BuddyID, &item.Question, &snapshot,
			&item.Status, &answerText, &answeredBy, &answeredAt, &item.UpdatedAt, &item.CreatedAt,
			&documentID, &revision, &documentStatus, &indexStatus, &indexedRevision, &indexError)
		if err != nil {
			return item, err
		}
		item.ContextSnapshot = append(item.ContextSnapshot[:0], snapshot...)
		if answerText.Valid {
			item.AnswerText = &answerText.String
		}
		if answeredBy.Valid {
			item.AnsweredBy = &answeredBy.String
		}
		if answeredAt.Valid {
			value := answeredAt.Time
			item.AnsweredAt = &value
		}
		if documentID.Valid {
			publication := &escalation.Publication{DocumentID: documentID.String, Revision: int(revision.Int32), Status: documentStatus.String, IndexStatus: indexStatus.String}
			if indexedRevision.Valid {
				value := int(indexedRevision.Int32)
				publication.IndexedRevision = &value
			}
			if indexError.Valid {
				publication.IndexError = &indexError.String
			}
			item.Publication = publication
		}
		item.UpdatedAt = item.UpdatedAt.UTC()
		item.CreatedAt = item.CreatedAt.UTC()
		item.Version = escalationVersion(item.UpdatedAt)
		return item, nil
	})
	if err != nil {
		return page, err
	}
	if len(items) > query.Limit {
		last := items[query.Limit-1]
		cursor := s.listings.encodeCursor(scope, last.ID, last.CreatedAt)
		page.NextCursor = &cursor
		items = items[:query.Limit]
	}
	page.Items = items
	if err := tx.Commit(ctx); err != nil {
		return escalation.Page{}, err
	}
	return page, nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefTime(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}
