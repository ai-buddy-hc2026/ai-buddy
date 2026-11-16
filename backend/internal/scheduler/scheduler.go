// Package scheduler периодически строит проактивные уведомления и кладёт их
// в очередь компаньона. Тумблеры, рабочие часы и «Не мой день» проверяет companion.Gate.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/companion"
)

const (
	DefaultInterval = 5 * time.Minute
	tickTimeout     = 30 * time.Second
)

type Source interface {
	Snapshot(context.Context) (Snapshot, error)
}

type Sink interface {
	Enqueue(context.Context, []companion.Notification) (int, error)
}

type Scheduler struct {
	source Source
	sink   Sink
	now    func() time.Time
	jobs   []Job
	logger *slog.Logger
}

func New(source Source, sink Sink, now func() time.Time, logger *slog.Logger, jobs ...Job) *Scheduler {
	if now == nil {
		now = time.Now
	}
	if logger == nil {
		logger = slog.Default()
	}
	if len(jobs) == 0 {
		jobs = DefaultJobs()
	}
	return &Scheduler{source: source, sink: sink, now: now, jobs: jobs, logger: logger}
}

// Tick выполняет один проход и возвращает число новых записей в очереди.
func (s *Scheduler) Tick(ctx context.Context) (int, error) {
	now := s.now()
	snap, err := s.source.Snapshot(ctx)
	if err != nil {
		return 0, fmt.Errorf("scheduler snapshot: %w", err)
	}
	return s.sink.Enqueue(ctx, Plan(now, snap, s.jobs))
}

// Plan прогоняет задачи и пропускает кандидатов через companion.Gate.
func Plan(now time.Time, snap Snapshot, jobs []Job) []companion.Notification {
	recipients := make(map[string]companion.Recipient, len(snap.Recipients))
	for _, r := range snap.Recipients {
		recipients[r.UserID] = r
	}
	var out []companion.Notification
	for _, job := range jobs {
		for _, c := range job(now, snap) {
			r, ok := recipients[c.UserID]
			if !ok {
				continue
			}
			deliverAt, ok := companion.Gate(r, c.Feature, now)
			if !ok {
				continue
			}
			out = append(out, companion.Notification{
				UserID: r.UserID, TeamID: r.TeamID, Feature: c.Feature, DedupKey: c.DedupKey,
				Title: c.Title, Body: c.Body, DeliverAt: deliverAt,
			})
		}
	}
	return out
}

// Run тикает до отмены ctx. Ошибка тика логируется, цикл продолжается.
func (s *Scheduler) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.runOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Scheduler) runOnce(ctx context.Context) {
	tickCtx, cancel := context.WithTimeout(ctx, tickTimeout)
	defer cancel()
	inserted, err := s.Tick(tickCtx)
	if err != nil {
		s.logger.ErrorContext(ctx, "scheduler tick failed", "error", err)
		return
	}
	if inserted > 0 {
		s.logger.InfoContext(ctx, "scheduler enqueued notifications", "count", inserted)
	}
}
