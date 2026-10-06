package ingest

import (
	"context"
	"fmt"

	"github.com/cloudevents/sdk-go/v2/event"

	"github.com/openmeterio/openmeter/openmeter/dedupe"
)

// DeduplicatingCollector implements event deduplication at event ingestion.
type DeduplicatingCollector struct {
	Collector

	Deduplicator dedupe.Deduplicator
}

// Ingest implements the {Collector} interface wrapping an existing {Collector} and deduplicating events.
func (d DeduplicatingCollector) Ingest(ctx context.Context, namespace string, ev event.Event) error {
	item := dedupe.Item{Namespace: namespace, ID: ev.ID(), Source: ev.Source()}
	isUnique, err := d.Deduplicator.CheckUnique(ctx, item)
	if err != nil {
		return fmt.Errorf("checking event uniqueness: %w", err)
	}

	if !isUnique {
		return nil
	}

	// An ingress key certifies acknowledged delivery, not a producer enqueue.
	// A failed or indeterminate delivery must remain retryable with the same
	// CloudEvent identity. Concurrent first deliveries may both reach Kafka;
	// the existing sink deduplicator remains the storage-side authority.
	if err := d.Collector.Ingest(ctx, namespace, ev); err != nil {
		return err
	}
	if _, err := d.Deduplicator.Set(ctx, item); err != nil {
		return fmt.Errorf("recording delivered event: %w", err)
	}
	return nil
}
