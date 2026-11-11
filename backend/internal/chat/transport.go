package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type Subscription interface {
	Receive(context.Context) ([]byte, error)
	Close() error
}
type Broker interface {
	Subscribe(context.Context, string) (Subscription, error)
}
type Sender interface {
	Send(context.Context, Payload) error
}
type DispatchError struct{ Definite bool }

func (e *DispatchError) Error() string { return "AI dispatch failed" }

type RedisBroker struct{ Client *redis.Client }
type redisSubscription struct{ subscription *redis.PubSub }

func (b RedisBroker) Subscribe(ctx context.Context, id string) (Subscription, error) {
	channel := "chat:" + id
	sub := b.Client.Subscribe(ctx, channel)
	stop := context.AfterFunc(ctx, func() { _ = sub.Close() })
	ack, err := sub.Receive(ctx)
	stop()
	if err != nil {
		_ = sub.Close()
		return nil, ErrUnavailable
	}
	confirmation, ok := ack.(*redis.Subscription)
	if !ok || confirmation.Kind != "subscribe" || confirmation.Channel != channel {
		_ = sub.Close()
		return nil, ErrUnavailable
	}
	return &redisSubscription{subscription: sub}, nil
}
func (s *redisSubscription) Receive(ctx context.Context) ([]byte, error) {
	message, err := s.subscription.ReceiveMessage(ctx)
	if err != nil {
		return nil, ErrUnavailable
	}
	return []byte(message.Payload), nil
}
func (s *redisSubscription) Close() error { return s.subscription.Close() }

type PythonClient struct {
	URL    string
	Token  string
	Client *http.Client
}

func (p *PythonClient) Send(ctx context.Context, payload Payload) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return &DispatchError{Definite: true}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.URL+"/chat", bytes.NewReader(raw))
	if err != nil {
		return &DispatchError{Definite: true}
	}
	req.Header.Set("Authorization", "Bearer "+p.Token)
	req.Header.Set("Content-Type", "application/json")
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := client.Do(req)
	if err != nil {
		return &DispatchError{}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusAccepted {
		return &DispatchError{Definite: true}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		return &DispatchError{}
	}
	var result struct {
		RequestID string `json:"request_id"`
		Accepted  *bool  `json:"accepted"`
		Duplicate *bool  `json:"duplicate"`
	}
	if json.Unmarshal(body, &result) != nil || result.RequestID != payload.RequestID || result.Accepted == nil || !*result.Accepted || result.Duplicate == nil {
		return &DispatchError{}
	}
	return nil
}

func definiteDispatch(err error) bool {
	var failure *DispatchError
	return errors.As(err, &failure) && failure.Definite
}
