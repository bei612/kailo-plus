package ingest_test

import (
	"context"
	"errors"
	"testing"

	"github.com/cloudevents/sdk-go/v2/event"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/openmeterio/openmeter/openmeter/dedupe"
	"github.com/openmeterio/openmeter/openmeter/dedupe/memorydedupe"
	"github.com/openmeterio/openmeter/openmeter/ingest"
)

func TestDeduplicatingCollector(t *testing.T) {
	collector := ingest.NewInMemoryCollector()
	deduplicator, err := memorydedupe.NewDeduplicator(0)
	require.NoError(t, err)

	dedupeCollector := ingest.DeduplicatingCollector{
		Collector:    collector,
		Deduplicator: deduplicator,
	}

	const namespace = "default"

	ev1 := event.New()
	ev1.SetID("id")
	ev1.SetSource("source")
	ev1.SetType("some-type")

	ev2 := event.New()
	ev2.SetID("id")
	ev2.SetSource("source")
	ev2.SetType("some-other-type")

	err = dedupeCollector.Ingest(context.Background(), namespace, ev1)
	require.NoError(t, err)

	err = dedupeCollector.Ingest(context.Background(), namespace, ev2)
	require.NoError(t, err)

	assert.Equal(t, []event.Event{ev1}, collector.Events(namespace))
}

type deliveryCollector struct {
	ingest.Collector
	err   error
	calls int
}

func (c *deliveryCollector) Ingest(ctx context.Context, namespace string, ev event.Event) error {
	c.calls++
	if c.err != nil {
		return c.err
	}
	return c.Collector.Ingest(ctx, namespace, ev)
}

func TestDeduplicatingCollectorDoesNotClaimUnconfirmedDelivery(t *testing.T) {
	for _, failure := range []error{errors.New("broker rejected delivery"), context.DeadlineExceeded} {
		t.Run(failure.Error(), func(t *testing.T) {
			index, err := memorydedupe.NewDeduplicator(0)
			require.NoError(t, err)
			defer index.Close()
			collector := &deliveryCollector{Collector: ingest.NewInMemoryCollector(), err: failure}
			wrapped := ingest.DeduplicatingCollector{Collector: collector, Deduplicator: index}
			ev := event.New()
			ev.SetID(t.Name())
			ev.SetSource("delivery-receipt-test")
			ev.SetType("usage")
			item := dedupe.Item{Namespace: t.Name(), ID: ev.ID(), Source: ev.Source()}
			require.ErrorIs(t, wrapped.Ingest(context.Background(), item.Namespace, ev), failure)
			unique, err := index.CheckUnique(context.Background(), item)
			require.NoError(t, err)
			require.True(t, unique, "unconfirmed delivery must not poison the ingress index")
			collector.err = nil
			require.NoError(t, wrapped.Ingest(context.Background(), item.Namespace, ev))
			unique, err = index.CheckUnique(context.Background(), item)
			require.NoError(t, err)
			require.False(t, unique)
			require.NoError(t, wrapped.Ingest(context.Background(), item.Namespace, ev))
			require.Equal(t, 2, collector.calls, "confirmed delivery is deduplicated")
		})
	}
}
