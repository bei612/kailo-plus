package kafkaingest

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/cloudevents/sdk-go/v2/event"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/openmeterio/openmeter/openmeter/ingest/kafkaingest/serializer"
	"github.com/openmeterio/openmeter/openmeter/ingest/kafkaingest/topicresolver"
	pkgkafka "github.com/openmeterio/openmeter/pkg/kafka"
)

// Uses librdkafka's own in-process broker, not a substitute Collector. The
// failed case leaves Produce's local queue usable but denies broker delivery.
func TestCollectorRequiresBrokerDelivery(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	topic := "delivery-receipt"
	require.NoError(t, cluster.CreateTopic(topic, 1, 1))
	producer, err := kafka.NewProducer(&kafka.ConfigMap{
		"bootstrap.servers":  cluster.BootstrapServers(),
		"message.timeout.ms": 1000,
	})
	require.NoError(t, err)
	defer producer.Close()
	// Production KafkaProducerGroup continuously drains client-level events;
	// a test must also drain them during the deliberate broker outage.
	go func() {
		for range producer.Events() {
		}
	}()
	resolver, err := topicresolver.NewNamespacedTopicResolver("%s")
	require.NoError(t, err)
	collector, err := NewCollector(producer, serializer.NewJSONSerializer(), resolver,
		&pkgkafka.TopicProvisionerNoop{}, 1, slog.New(slog.NewTextHandler(io.Discard, nil)),
		noop.NewTracerProvider().Tracer(t.Name()))
	require.NoError(t, err)
	ev := event.New()
	ev.SetID(t.Name())
	ev.SetSource("delivery-receipt-test")
	ev.SetType("usage")
	ev.SetTime(time.Now())
	require.NoError(t, ev.SetData("application/json", map[string]int{"quantity": 1}))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, collector.Ingest(ctx, topic, ev))

	require.NoError(t, cluster.SetBrokerDown(1))
	err = collector.Ingest(ctx, topic, ev)
	require.ErrorContains(t, err, "delivering kafka message")

	canceled, stop := context.WithCancel(context.Background())
	stop()
	err = collector.Ingest(canceled, topic, ev)
	require.ErrorIs(t, err, context.Canceled)
	require.NoError(t, cluster.SetBrokerUp(1))
}
