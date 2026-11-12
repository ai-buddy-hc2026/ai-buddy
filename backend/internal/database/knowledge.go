package database

import (
	"context"
	"strings"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/knowledge"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Knowledge struct{ pool *pgxpool.Pool }

func NewKnowledge(pool *pgxpool.Pool) *Knowledge { return &Knowledge{pool: pool} }

func (s *Knowledge) Search(ctx context.Context, actorID, query string) (knowledge.SearchResult, error) {
	result := knowledge.SearchResult{Items: []knowledge.Result{}}
	if strings.TrimSpace(query) == "" || len(query) > 1000 {
		return result, knowledge.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return result, err
	}
	if reason := policy.Check(actor.policyActor(), policy.SearchKnowledge, policy.Resource{TeamID: actor.teamID}); reason != "" {
		return result, denyPolicy(ctx, s.pool, tx, actor, policy.SearchKnowledge, reason, knowledge.ErrDenied)
	}
	rows, err := tx.Query(ctx, `SELECT id::text,revision,title,content,slug FROM kb_documents
	WHERE team_id=$1 AND status='published' AND index_status='ready'
	AND search_vector @@ websearch_to_tsquery('simple',$2)
	ORDER BY ts_rank_cd(search_vector,websearch_to_tsquery('simple',$2)) DESC,updated_at DESC,id
	LIMIT 10`, actor.teamID, query)
	if err != nil {
		return result, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (knowledge.Result, error) {
		var item knowledge.Result
		var slug string
		err := row.Scan(&item.Source.DocumentID, &item.Source.Revision, &item.Source.Title, &item.Content, &slug)
		item.Source.URL = "kb/" + slug
		return item, err
	})
	if err != nil {
		return result, err
	}
	result.Items = items
	if err := tx.Commit(ctx); err != nil {
		return knowledge.SearchResult{}, err
	}
	return result, nil
}
