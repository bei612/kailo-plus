package datasource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/hibiken/asynq"
)

// ──────────────────────────────────────────────────────────────────────
// Fake implementations for testing
// ──────────────────────────────────────────────────────────────────────

// fakeDataSourceRepo is an in-memory DataSourceRepository.
type fakeDataSourceRepo struct {
	mu          sync.Mutex
	dataSources map[string]*types.DataSource
}

func newFakeDataSourceRepo() *fakeDataSourceRepo {
	return &fakeDataSourceRepo{dataSources: make(map[string]*types.DataSource)}
}

func (r *fakeDataSourceRepo) Create(_ context.Context, ds *types.DataSource) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dataSources[ds.ID] = ds
	return nil
}

func (r *fakeDataSourceRepo) FindByID(_ context.Context, id string) (*types.DataSource, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ds, ok := r.dataSources[id]
	if !ok {
		return nil, ErrDataSourceNotFound
	}
	return ds, nil
}

func (r *fakeDataSourceRepo) FindByKnowledgeBase(_ context.Context, kbID string) ([]*types.DataSource, error) {
	return nil, nil
}

func (r *fakeDataSourceRepo) Update(_ context.Context, ds *types.DataSource) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dataSources[ds.ID] = ds
	return nil
}

func (r *fakeDataSourceRepo) UpdateSyncState(ctx context.Context, ds *types.DataSource) error {
	return r.Update(ctx, ds)
}

func (r *fakeDataSourceRepo) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.dataSources, id)
	return nil
}

func (r *fakeDataSourceRepo) FindActive(_ context.Context) ([]*types.DataSource, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []*types.DataSource
	for _, ds := range r.dataSources {
		if ds.Status == types.DataSourceStatusActive && ds.SyncSchedule != "" {
			result = append(result, ds)
		}
	}
	return result, nil
}

// fakeSyncLogRepo is an in-memory SyncLogRepository.
type fakeSyncLogRepo struct {
	interfaces.SyncLogRepository
	mu         sync.Mutex
	logs       map[string]*types.SyncLog
	pending    map[string]*types.DataSourceSyncPayload
	runningErr error
}

func newFakeSyncLogRepo() *fakeSyncLogRepo {
	return &fakeSyncLogRepo{logs: make(map[string]*types.SyncLog), pending: make(map[string]*types.DataSourceSyncPayload)}
}

func (r *fakeSyncLogRepo) CreatePending(ctx context.Context, source *types.DataSource, payload *types.DataSourceSyncPayload) (*types.SyncLog, error) {
	log := &types.SyncLog{DataSourceID: source.ID, TenantID: source.TenantID, Status: types.SyncLogStatusRunning, StartedAt: time.Now().UTC()}
	if err := r.Create(ctx, log); err != nil {
		return nil, err
	}
	original := *payload
	original.SyncLogID = log.ID
	r.mu.Lock()
	r.pending[log.ID] = &original
	r.mu.Unlock()
	return log, nil
}

func (r *fakeSyncLogRepo) DispatchPending(_ context.Context, logID string, dispatch func(*types.DataSourceSyncPayload) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return dispatch(r.pending[logID])
}

func (r *fakeSyncLogRepo) Create(_ context.Context, log *types.SyncLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if log.ID == "" {
		log.ID = "log-" + time.Now().Format("150405.000")
	}
	r.logs[log.ID] = log
	return nil
}

func (r *fakeSyncLogRepo) FindByID(_ context.Context, id string) (*types.SyncLog, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.logs[id]
	if !ok {
		return nil, ErrSyncLogNotFound
	}
	return l, nil
}

func (r *fakeSyncLogRepo) FindByDataSource(_ context.Context, dsID string, limit, offset int) ([]*types.SyncLog, error) {
	return nil, nil
}

func (r *fakeSyncLogRepo) FindLatest(_ context.Context, dsID string) (*types.SyncLog, error) {
	return nil, nil
}

func (r *fakeSyncLogRepo) Update(_ context.Context, log *types.SyncLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logs[log.ID] = log
	return nil
}

func (r *fakeSyncLogRepo) UpdateResult(ctx context.Context, log *types.SyncLog) error {
	return r.Update(ctx, log)
}

func (r *fakeSyncLogRepo) CancelPendingByDataSource(_ context.Context, dsID string) error {
	return nil
}

func (r *fakeSyncLogRepo) CleanupOldLogs(_ context.Context, retentionDays int) error {
	return nil
}

func (r *fakeSyncLogRepo) HasRunningSync(_ context.Context, dsID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.runningErr != nil {
		return false, r.runningErr
	}
	for _, log := range r.logs {
		if log.DataSourceID == dsID && log.Status == types.SyncLogStatusRunning {
			return true, nil
		}
	}
	return false, nil
}

// fakeTaskEnqueuer counts how many tasks are enqueued.
type fakeTaskEnqueuer struct {
	count     atomic.Int64
	lastQueue atomic.Value
}

func (e *fakeTaskEnqueuer) Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	e.count.Add(1)
	var id string
	for _, opt := range opts {
		if opt.Type() == asynq.TaskIDOpt {
			id, _ = opt.Value().(string)
		}
		if opt.Type() == asynq.QueueOpt {
			if queue, ok := opt.Value().(string); ok {
				e.lastQueue.Store(queue)
			}
		}
	}
	return &asynq.TaskInfo{ID: id}, nil
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

func TestScheduler_StartWithActiveDataSources(t *testing.T) {
	repo := newFakeDataSourceRepo()
	_ = repo.Create(context.Background(), &types.DataSource{
		ID:           "ds-1",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "*/2 * * * * *", // every 2 seconds (6-field cron with seconds)
	})
	_ = repo.Create(context.Background(), &types.DataSource{
		ID:           "ds-2",
		TenantID:     1,
		Status:       types.DataSourceStatusPaused, // should NOT be scheduled
		SyncSchedule: "*/2 * * * * *",
	})

	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(repo, newFakeSyncLogRepo(), enqueuer)

	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer scheduler.Stop()

	// Only ds-1 should be registered (ds-2 is paused, not returned by FindActive)
	if scheduler.EntryCount() != 1 {
		t.Errorf("EntryCount() = %d, want 1", scheduler.EntryCount())
	}
}

func TestScheduler_CronFires(t *testing.T) {
	repo := newFakeDataSourceRepo()
	_ = repo.Create(context.Background(), &types.DataSource{
		ID:           "ds-fire",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "* * * * * *", // every second
	})

	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(repo, newFakeSyncLogRepo(), enqueuer)

	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Wait for at least one tick
	time.Sleep(2500 * time.Millisecond)
	scheduler.Stop()

	if enqueuer.count.Load() == 0 {
		t.Error("expected at least 1 enqueue, got 0")
	}
	if queue, _ := enqueuer.lastQueue.Load().(string); queue != types.QueueSync {
		t.Errorf("scheduled sync queue = %q, want %q", queue, types.QueueSync)
	}
}

func TestScheduler_AddOrUpdate(t *testing.T) {
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(newFakeDataSourceRepo(), newFakeSyncLogRepo(), enqueuer)
	scheduler.cron.Start()
	defer scheduler.Stop()

	ds := &types.DataSource{
		ID:           "ds-new",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "0 0 * * * *", // every hour
	}

	// Add
	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatalf("AddOrUpdate() error: %v", err)
	}
	if scheduler.EntryCount() != 1 {
		t.Errorf("EntryCount() = %d, want 1", scheduler.EntryCount())
	}

	// Update schedule
	ds.SyncSchedule = "0 30 * * * *" // every half hour
	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatalf("AddOrUpdate() (update) error: %v", err)
	}
	if scheduler.EntryCount() != 1 {
		t.Errorf("after update: EntryCount() = %d, want 1 (should replace, not add)", scheduler.EntryCount())
	}
}

func TestScheduler_AddOrUpdate_PausedIsNoop(t *testing.T) {
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(newFakeDataSourceRepo(), newFakeSyncLogRepo(), enqueuer)
	scheduler.cron.Start()
	defer scheduler.Stop()

	ds := &types.DataSource{
		ID:           "ds-paused",
		TenantID:     1,
		Status:       types.DataSourceStatusPaused,
		SyncSchedule: "0 0 * * * *",
	}

	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatalf("AddOrUpdate() error: %v", err)
	}
	if scheduler.EntryCount() != 0 {
		t.Errorf("paused ds should not be scheduled, EntryCount() = %d", scheduler.EntryCount())
	}
}

func TestScheduler_AddOrUpdate_EmptyScheduleIsNoop(t *testing.T) {
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(newFakeDataSourceRepo(), newFakeSyncLogRepo(), enqueuer)
	scheduler.cron.Start()
	defer scheduler.Stop()

	ds := &types.DataSource{
		ID:           "ds-no-sched",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "",
	}

	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatalf("AddOrUpdate() error: %v", err)
	}
	if scheduler.EntryCount() != 0 {
		t.Errorf("empty schedule should not be registered, EntryCount() = %d", scheduler.EntryCount())
	}
}

func TestScheduler_Remove(t *testing.T) {
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(newFakeDataSourceRepo(), newFakeSyncLogRepo(), enqueuer)
	scheduler.cron.Start()
	defer scheduler.Stop()

	ds := &types.DataSource{
		ID:           "ds-rm",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "0 0 * * * *",
	}

	_ = scheduler.AddOrUpdate(ds)
	if scheduler.EntryCount() != 1 {
		t.Fatalf("pre-remove: EntryCount() = %d, want 1", scheduler.EntryCount())
	}

	scheduler.Remove("ds-rm")
	if scheduler.EntryCount() != 0 {
		t.Errorf("post-remove: EntryCount() = %d, want 0", scheduler.EntryCount())
	}

	// Remove non-existent is safe
	scheduler.Remove("does-not-exist")
}

func TestScheduler_InvalidCron(t *testing.T) {
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(newFakeDataSourceRepo(), newFakeSyncLogRepo(), enqueuer)
	scheduler.cron.Start()
	defer scheduler.Stop()

	ds := &types.DataSource{
		ID:           "ds-bad",
		TenantID:     1,
		Status:       types.DataSourceStatusActive,
		SyncSchedule: "not a cron",
	}

	err := scheduler.AddOrUpdate(ds)
	if err == nil {
		t.Fatal("expected error for invalid cron expression")
	}
	if scheduler.EntryCount() != 0 {
		t.Errorf("invalid cron should not be registered, EntryCount() = %d", scheduler.EntryCount())
	}

	ds.SyncSchedule = "0 0 * * * *"
	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatal(err)
	}
	original := scheduler.entries[ds.ID]
	ds.SyncSchedule = "not a cron"
	if err := scheduler.AddOrUpdate(ds); err == nil {
		t.Fatal("an invalid replacement must fail")
	}
	if scheduler.EntryCount() != 1 || scheduler.entries[ds.ID] != original || scheduler.cron.Entry(original).ID != original {
		t.Fatal("invalid replacement removed the original working schedule")
	}
	ds.SyncSchedule = "0 30 * * * *"
	if err := scheduler.AddOrUpdate(ds); err != nil {
		t.Fatal(err)
	}
	if scheduler.EntryCount() != 1 || scheduler.entries[ds.ID] == original || scheduler.cron.Entry(original).ID != 0 {
		t.Fatal("valid replacement must retire exactly the old schedule")
	}
}

func TestScheduler_TriggerSync_InactiveSkipped(t *testing.T) {
	repo := newFakeDataSourceRepo()
	// Create a data source that is paused
	_ = repo.Create(context.Background(), &types.DataSource{
		ID:       "ds-inactive",
		TenantID: 1,
		Status:   types.DataSourceStatusPaused,
	})

	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(repo, newFakeSyncLogRepo(), enqueuer)

	// Directly call triggerSync — it should skip because ds is not active
	scheduler.triggerSync("ds-inactive", 1)

	if enqueuer.count.Load() != 0 {
		t.Error("should not enqueue for inactive data source")
	}
}

func TestScheduler_TriggerSync_NotFound(t *testing.T) {
	repo := newFakeDataSourceRepo()
	enqueuer := &fakeTaskEnqueuer{}
	scheduler := NewScheduler(repo, newFakeSyncLogRepo(), enqueuer)

	// Should not panic, just skip
	scheduler.triggerSync("nonexistent", 1)

	if enqueuer.count.Load() != 0 {
		t.Error("should not enqueue for non-existent data source")
	}
}

func TestScheduler_TriggerSyncRequiresConfirmedOriginalState(t *testing.T) {
	for _, scenario := range []string{"lookup-unavailable", "wrong-tenant", "missing-tenant", "wrong-source", "existing-running"} {
		t.Run(scenario, func(t *testing.T) {
			repo, logs := newFakeDataSourceRepo(), newFakeSyncLogRepo()
			source := &types.DataSource{ID: "source-original", TenantID: 1, Status: types.DataSourceStatusActive}
			if err := repo.Create(context.Background(), source); err != nil {
				t.Fatal(err)
			}
			tenant := source.TenantID
			switch scenario {
			case "lookup-unavailable":
				logs.runningErr = errors.New("original sync store unavailable")
			case "wrong-tenant":
				source.TenantID++
			case "missing-tenant":
				tenant = 0
			case "wrong-source":
				source.ID = "source-other"
			case "existing-running":
				logs.logs["log-original"] = &types.SyncLog{ID: "log-original", DataSourceID: source.ID, TenantID: source.TenantID, Status: types.SyncLogStatusRunning}
			}
			before := len(logs.logs)
			enqueuer := &fakeTaskEnqueuer{}
			scheduler := NewScheduler(repo, logs, enqueuer)
			scheduler.triggerSync("source-original", tenant)
			if enqueuer.count.Load() != 0 || len(logs.logs) != before {
				t.Fatal("unconfirmed original state must not create a run or enqueue another task")
			}
			// The next original cron tick can proceed after the same source/store
			// recovers; no alternate queue or retry authority is introduced.
			source.ID, source.TenantID, tenant = "source-original", 1, 1
			logs.runningErr = nil
			if previous := logs.logs["log-original"]; previous != nil {
				previous.Status = types.SyncLogStatusSuccess
			}
			scheduler.triggerSync(source.ID, tenant)
			if enqueuer.count.Load() != 1 || len(logs.logs) != before+1 {
				t.Fatal("a confirmed available original source must retain native scheduling")
			}
		})
	}
}
