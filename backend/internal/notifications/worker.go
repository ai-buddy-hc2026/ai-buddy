package notifications

import (
	"context"
	"log/slog"
	"time"
)

type Processor interface {
	Backfill(context.Context, time.Time) error
	ProcessDue(context.Context, time.Time) error
}

// StartWorker не блокирует HTTP и завершает обработку вместе с приложением.
func StartWorker(parent context.Context, processor Processor, logger *slog.Logger, interval time.Duration) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		backfilled := false
		for {
			if ctx.Err() != nil {
				return
			}
			now := time.Now().UTC()
			step, cancelStep := context.WithTimeout(ctx, 5*time.Second)
			var err error
			if !backfilled {
				err = processor.Backfill(step, now)
				backfilled = err == nil
			}
			if err == nil {
				err = processor.ProcessDue(step, now)
			}
			cancelStep()
			if err != nil && ctx.Err() == nil {
				logger.Warn("Не удалось обработать уведомления", "operation", "notifications_tick")
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
