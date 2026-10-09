package datasource

import (
	"context"
	"fmt"
	"sync"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/tracing/langfuse"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/robfig/cron/v3"
)

// Scheduler manages cron-based periodic sync for data sources.
//
// robfig/cron fires at absolute wall-clock times (e.g. "0 0 * * * *" always fires
// at the top of every hour regardless of when the process started). So multiple
// instances will fire at the same moment. Source-row admission serializes
// manual and scheduled runs; the durable run ID also deduplicates queue delivery.
type Scheduler struct {
	cron         *cron.Cron
	dsRepo       interfaces.DataSourceRepository
	syncLogRepo  interfaces.SyncLogRepository
	taskEnqueuer interfaces.TaskEnqueuer

	mu      sync.Mutex
	entries map[string]cron.EntryID // dataSourceID → cron entry ID
}

// NewScheduler creates a new Scheduler.
func NewScheduler(
	dsRepo interfaces.DataSourceRepository,
	syncLogRepo interfaces.SyncLogRepository,
	taskEnqueuer interfaces.TaskEnqueuer,
) *Scheduler {
	return &Scheduler{
		cron: cron.New(cron.WithSeconds(), cron.WithChain(
			cron.Recover(cron.DefaultLogger),
		)),
		dsRepo:       dsRepo,
		syncLogRepo:  syncLogRepo,
		taskEnqueuer: taskEnqueuer,
		entries:      make(map[string]cron.EntryID),
	}
}

// Start loads all active data sources from the database and registers their
// cron schedules. Then starts the cron runner in the background.
func (s *Scheduler) Start(ctx context.Context) error {
	dataSources, err := s.dsRepo.FindActive(ctx)
	if err != nil {
		return fmt.Errorf("load active data sources: %w", err)
	}

	for _, ds := range dataSources {
		if ds.SyncSchedule == "" {
			continue
		}
		if err := s.addEntry(ds); err != nil {
			logger.Warnf(ctx, "[Scheduler] failed to register cron for ds=%s schedule=%q: %v",
				ds.ID, ds.SyncSchedule, err)
		}
	}

	s.cron.Start()
	logger.Infof(ctx, "[Scheduler] started with %d cron entries", len(s.entries))
	return nil
}

// Stop gracefully stops the cron runner and waits for running jobs to finish.
func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

// AddOrUpdate registers (or re-registers) a cron entry for the given data source.
func (s *Scheduler) AddOrUpdate(ds *types.DataSource) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, ok := s.entries[ds.ID]; ok {
		s.cron.Remove(entryID)
		delete(s.entries, ds.ID)
	}

	if ds.Status != types.DataSourceStatusActive || ds.SyncSchedule == "" {
		return nil
	}

	return s.addEntryLocked(ds)
}

// Remove removes the cron entry for a data source.
func (s *Scheduler) Remove(dataSourceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, ok := s.entries[dataSourceID]; ok {
		s.cron.Remove(entryID)
		delete(s.entries, dataSourceID)
	}
}

func (s *Scheduler) addEntry(ds *types.DataSource) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.addEntryLocked(ds)
}

func (s *Scheduler) addEntryLocked(ds *types.DataSource) error {
	dsID := ds.ID
	tenantID := ds.TenantID

	entryID, err := s.cron.AddFunc(ds.SyncSchedule, func() {
		s.triggerSync(dsID, tenantID)
	})
	if err != nil {
		return fmt.Errorf("invalid cron expression %q: %w", ds.SyncSchedule, err)
	}

	s.entries[dsID] = entryID
	return nil
}

// triggerSync is called by the cron runner on each tick.
//
// Layer 1 — DB: if a previous sync is still running, skip. This prevents
// overlap when a sync takes longer than the cron interval.
//
// Layer 2 — native transactional admission and durable queue handoff. The
// optimistic running check is only a fast path; CreatePending serializes races.
func (s *Scheduler) triggerSync(dataSourceID string, tenantID uint64) {
	ctx := context.Background()

	ds, err := s.dsRepo.FindByID(ctx, dataSourceID)
	if err != nil || ds == nil || ds.Status != types.DataSourceStatusActive ||
		ds.ID != dataSourceID || tenantID == 0 || ds.TenantID != tenantID {
		logger.Infof(ctx, "[Scheduler] skipping sync for ds=%s (original active source unavailable)", dataSourceID)
		return
	}

	// Layer 1: prevent overlap with a still-running sync
	running, err := s.syncLogRepo.HasRunningSync(ctx, dataSourceID)
	if err != nil {
		logger.Errorf(ctx, "[Scheduler] cannot confirm original sync state for ds=%s: %v", dataSourceID, err)
		return
	}
	if running {
		logger.Infof(ctx, "[Scheduler] skipping sync for ds=%s (previous sync still running)", dataSourceID)
		return
	}

	payload := &types.DataSourceSyncPayload{
		DataSourceID: dataSourceID,
		TenantID:     tenantID,
		ForceFull:    false,
		Trigger:      "schedule",
	}
	langfuse.InjectTracing(ctx, payload)
	syncLog, err := s.syncLogRepo.CreatePending(ctx, ds, payload)
	if err != nil {
		logger.Infof(ctx, "[Scheduler] sync not admitted for ds=%s: %v", dataSourceID, err)
		return
	}
	if err := DispatchSync(ctx, s.syncLogRepo, s.taskEnqueuer, syncLog.ID); err != nil {
		logger.Warnf(ctx, "[Scheduler] sync handoff remains pending for ds=%s syncLog=%s: %v", dataSourceID, syncLog.ID, err)
	}
}

// EntryCount returns the number of active cron entries (for testing/monitoring).
func (s *Scheduler) EntryCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}
