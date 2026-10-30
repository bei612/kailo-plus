package service

// DD-165, .design/07 §4.8.9: the native source of the Kailo storage snapshot
// (transport and rules: common/auth/native-oidc-usage.go). In Kailo mode,
// with the member directory client delivered, the stored bytes of this
// instance are reported every hour: the sum of the index-aggregated sizes of
// the user content datasources (the tree root listing, the same figure the
// native admin shows per datasource); Cells-internal datasources (versions,
// thumbnails) are not user content and are not counted. A failed hour is
// retried with the same key within that hour and never back-filled later.

import (
	"context"
	"errors"
	"io"
	"time"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/commons/treec"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

const (
	kailoUsageInterval   = time.Hour
	kailoUsageFirstDelay = 2 * time.Minute
	kailoUsageRetry      = 5 * time.Minute
)

// startKailoUsage starts the hourly storage snapshot when Kailo metering is
// delivered (Kailo mode and directory client); otherwise nothing.
func startKailoUsage(ctx context.Context) error {
	reporter, err := auth.StartNativeOIDCUsageReporter()
	if err != nil || reporter == nil {
		// A partial directory delivery is refused and logged by the directory sync.
		return nil
	}
	go kailoUsageLoop(ctx, reporter)
	return nil
}

func kailoUsageLoop(ctx context.Context, reporter *auth.NativeOIDCUsageReporter) {
	timer := time.NewTimer(kailoUsageFirstDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		timer.Reset(kailoUsageSnapshot(ctx, reporter, time.Now()))
	}
}

// kailoUsageSnapshot reports one snapshot and returns the wait before the next
// attempt: a retriable failure retries within the same hour, anything else
// waits for the next hour.
func kailoUsageSnapshot(ctx context.Context, reporter *auth.NativeOIDCUsageReporter, now time.Time) time.Duration {
	logger := log.Logger(ctx)
	internal := map[string]bool{}
	for name, ds := range config.ListSourcesFromConfig(ctx) {
		if ds != nil && ds.IsInternal() {
			internal[name] = true
		}
	}
	size, err := kailoStoredBytes(ctx, treec.NodeProviderClient(ctx), internal)
	if err != nil {
		logger.Warn("Kailo storage snapshot unavailable", zap.String("binding", reporter.BindingID()))
		return kailoUsageRetryWithinHour(now)
	}
	report, err := auth.NativeOIDCStorageSnapshot(size, now)
	if err != nil {
		return kailoUsageInterval
	}
	result := reporter.Report(ctx, report)
	switch {
	case result.Done:
		logger.Info("Kailo storage snapshot reported", zap.String("binding", reporter.BindingID()), zap.Int("status", result.Status))
		return kailoUsageInterval
	case result.Retry:
		logger.Info("Kailo storage snapshot deferred", zap.String("binding", reporter.BindingID()), zap.Int("status", result.Status))
		return kailoUsageRetryWithinHour(now)
	case result.Status == 404:
		logger.Warn("Kailo storage snapshot not accepted: Kailo Core has no component usage contract yet (deploy Core with DD-165 first)",
			zap.String("binding", reporter.BindingID()))
		return kailoUsageInterval
	default:
		logger.Warn("Kailo storage snapshot refused", zap.String("binding", reporter.BindingID()), zap.Int("status", result.Status))
		return kailoUsageInterval
	}
}

// kailoUsageRetryWithinHour retries a few minutes later while the hour (the
// snapshot key) lasts, then moves on to the next hour.
func kailoUsageRetryWithinHour(now time.Time) time.Duration {
	next := now.Add(kailoUsageRetry)
	if next.Truncate(time.Hour).Equal(now.Truncate(time.Hour)) {
		return kailoUsageRetry
	}
	return next.Truncate(time.Hour).Sub(now) + kailoUsageRetry
}

// kailoStoredBytes sums the sizes the tree root reports per datasource,
// skipping the Cells-internal ones. A listing error is no snapshot (never a
// partial sum).
func kailoStoredBytes(ctx context.Context, provider tree.NodeProviderClient, internal map[string]bool) (int64, error) {
	stream, err := provider.ListNodes(ctx, &tree.ListNodesRequest{Node: &tree.Node{Path: "/"}})
	if err != nil {
		return 0, err
	}
	var total int64
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return total, nil
		}
		if err != nil {
			return 0, err
		}
		node := resp.GetNode()
		if node == nil || internal[node.GetPath()] {
			continue
		}
		if node.GetSize() < 0 {
			return 0, errors.New("negative datasource size")
		}
		total += node.GetSize()
	}
}
