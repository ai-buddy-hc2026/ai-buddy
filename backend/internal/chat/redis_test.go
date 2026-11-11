package chat

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/redis/go-redis/v9"
)

func TestRedisSubscriptionAckAndLoss(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL is not set")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal("invalid TEST_REDIS_URL")
	}
	id, _ := identifier.NewUUID()
	options.ClientName = "chat-test-" + id
	options.Protocol = 2
	options.MaxRetries = -1
	options.ContextTimeoutEnabled = true
	options.DialTimeout = time.Second
	client := redis.NewClient(options)
	defer func() { _ = client.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sub, err := (RedisBroker{Client: client}).Subscribe(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sub.Close() }()
	if count, err := client.Publish(ctx, "chat:"+id, "synthetic-event").Result(); err != nil || count != 1 {
		t.Fatalf("not subscribed: %d %v", count, err)
	}
	message, err := sub.Receive(ctx)
	if err != nil || string(message) != "synthetic-event" {
		t.Fatal("Redis message mismatch", err)
	}
	list, err := client.ClientList(ctx).Result()
	if err != nil {
		t.Fatal(err)
	}
	connectionID := ""
	for _, line := range strings.Split(list, "\n") {
		fields := make(map[string]string)
		for _, field := range strings.Fields(line) {
			parts := strings.SplitN(field, "=", 2)
			if len(parts) == 2 {
				fields[parts[0]] = parts[1]
			}
		}
		if fields["name"] == options.ClientName && strings.Contains(fields["flags"], "P") {
			connectionID = fields["id"]
			break
		}
	}
	if connectionID == "" {
		t.Fatal("test Pub/Sub connection not found")
	}
	if err := client.Do(ctx, "CLIENT", "KILL", "ID", connectionID).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := sub.Receive(ctx); err == nil {
		t.Fatal("lost subscription was silently resumed")
	}
}
