package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// Serve owns listener and drains active requests when ctx is cancelled.
func Serve(ctx context.Context, listener net.Listener, handler http.Handler, logger *slog.Logger) error {
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
		// No write timeout: future chat endpoints will stream over SSE.
	}
	result := make(chan error, 1)
	go func() { result <- srv.Serve(listener) }()
	logger.Info("http server started", "address", listener.Addr().String())
	select {
	case err := <-result:
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
		logger.Info("http server stopping")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			if closeErr := srv.Close(); closeErr != nil {
				logger.Error("force close HTTP server", "error", closeErr)
			}
			return fmt.Errorf("shutdown HTTP: %w", err)
		}
		if err := <-result; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	}
}
