//go:build storage || kv

/*
 * Copyright (c) 2018. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package dao

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/uuid"
	jo "github.com/pydio/cells/v5/scheduler/jobs"
	"github.com/pydio/cells/v5/scheduler/jobs/dao/bolt"
	"github.com/pydio/cells/v5/scheduler/jobs/dao/mongo"

	. "github.com/smartystreets/goconvey/convey"
)

var (
	testCases = []test.StorageTestCase{
		{DSN: []string{"boltdb://" + filepath.Join(os.TempDir(), "jobs_bolt_"+uuid.New()+".db")}, Condition: true, DAO: bolt.NewBoltDAO},
		test.TemplateMongoEnvWithPrefix(mongo.NewMongoDAO, "jobs_"+uuid.New()[:6]+"_"),
	}
)

//func TestNewBoltStore(t *testing.T) {
//
//	Convey("Test open bolt db", t, func() {
//		dbFile := os.TempDir() + "/bolt-test.db"
//		ctx := context.Background()
//		dao, _ := boltdb.NewDAO(ctx, "boltdb", dbFile, "test-jobs")
//		defer os.Remove(dbFile)
//		db, err := newBoltStore(dao.(boltdb.DAO))
//		defer dao.CloseConn(ctx)
//		So(err, ShouldBeNil)
//		So(db, ShouldNotBeNil)
//	})
//
//}
//
//func initDAO(name string) (DAO, func()) {
//
//	name = "jobs-" + name
//	d, c, e := test.OnFileTestDAO("boltdb", filepath.Join(os.TempDir(), name+".db"), "", "jobs-tests", false, NewDAO)
//	if e != nil {
//		log.Fatal(e)
//	}
//	return d.(DAO), c
//
//}

func TestDAO_ExactTask(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		job := jo.NativeReadJob("exact-native-task")
		if err := store.ClaimJob(ctx, job); err != nil {
			t.Fatal(err)
		}
		if task, err := store.GetTask(ctx, job.ID, "missing"); err != nil || task != nil {
			t.Fatal("missing original task is not a successful lookup", task, err)
		}
		task := &jobs.Task{ID: "same-native-key", JobID: job.ID, TriggerOwner: "original-user", Status: jobs.TaskStatus_Queued}
		if err := store.PutTask(task); err != nil {
			t.Fatal(err)
		}
		if found, err := store.GetTask(ctx, job.ID, task.ID); err != nil || !proto.Equal(found, task) {
			t.Fatal("exact original task changed", found, err)
		}
		if found, err := store.GetTask(ctx, "another-job", task.ID); err != nil || found != nil {
			t.Fatal("task lookup crossed its Job", found, err)
		}
		for _, pair := range [][2]string{{"", task.ID}, {job.ID, ""}} {
			if found, err := store.GetTask(ctx, pair[0], pair[1]); err == nil || found != nil {
				t.Fatal("unscoped native task lookup was accepted", found, err)
			}
		}
		canceled, cancel := context.WithCancel(ctx)
		cancel()
		if found, err := store.GetTask(canceled, job.ID, task.ID); !errors.Is(err, context.Canceled) || found != nil {
			t.Fatal("canceled original task lookup became usable evidence", found, err)
		}
	})
}

func TestDAO_NativeUploadFencesFirstByteAndLegacyClaim(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		binding, base, key, user := uuid.New(), uuid.New(), uuid.New(), uuid.New()
		cell, upload := jo.NativeCellJob(uuid.New(), binding, 1), jo.NativeUploadJob(base, binding, 1)
		for _, job := range []*jobs.Job{jo.NativeWriteJob(base), cell, upload} {
			if err := store.ClaimJob(ctx, job); err != nil {
				t.Fatal(err)
			}
		}
		input := map[string]interface{}{"resourceId": uuid.New(), "nativeIntentId": uuid.New(), "nativeNodeId": uuid.New(),
			"nativeDeadline": float64(time.Now().Add(time.Hour).Unix()), "contentLength": float64(3), "multipart": false}
		claims := map[string]interface{}{"action_execution_id": uuid.New(), "external_execution_id": uuid.New(), "idempotency_key": key}
		original, err := jo.NewNativeUploadTask(binding, 1, upload.ID, key, "original-user", user, claims, input)
		if err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(original); err != nil {
			t.Fatal(err)
		}
		left, right := proto.Clone(original).(*jobs.Task), proto.Clone(original).(*jobs.Task)
		for _, task := range []*jobs.Task{left, right} {
			if _, err = jo.ClaimNativeUploadStep(task, "put", uuid.New(), "workspace/file", "", 3); err != nil {
				t.Fatal(err)
			}
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		for _, task := range []*jobs.Task{left, right} {
			go func(task *jobs.Task) {
				<-start
				_, err := store.StoreNativeUploadStep(ctx, task, "put")
				results <- err
			}(task)
		}
		close(start)
		first, second := <-results, <-results
		if (first == nil) == (second == nil) {
			t.Fatal("two concurrent byte writers must have one winner", first, second)
		}
		snapshot, err := store.SnapshotNativeCells(ctx, binding, 1, cell.ID, true, 1<<20, base)
		if err != nil || len(snapshot) != 2 {
			t.Fatal("complete original jobs snapshot", snapshot, err)
		}
		if _, err = store.StoreNativeUploadStep(ctx, right, "put"); err == nil {
			t.Fatal("writer crossed persisted cutoff")
		}
		legacy, err := jo.NewNativeWriteTask(binding, base, uuid.New(), "original-user", user, claims, map[string]interface{}{"original": "reference"})
		if err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(legacy); err == nil {
			t.Fatal("late unversioned promotion crossed binding cutoff")
		}
		other := uuid.New()
		legacy, err = jo.NewNativeWriteTask(other, base, uuid.New(), "original-user", user, claims, map[string]interface{}{"original": "reference"})
		if err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(legacy); err != nil {
			t.Fatal("different binding was stopped", err)
		}
		if _, err = store.SnapshotNativeCells(ctx, binding, 1, cell.ID, true, 1<<20, base); err != nil {
			t.Fatal("foreign binding history blocked the original cutoff", err)
		}
		if _, err = store.SnapshotNativeCells(ctx, other, 1, uuid.New(), true, 1<<20, base); err == nil {
			t.Fatal("legacy task with no frozen generation vanished from snapshot")
		}
	})
}

func TestDAO_NativeShareUsesOriginalBindingFence(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		binding, user, key := uuid.New(), uuid.New(), uuid.New()
		cell := jo.NativeCellJob(uuid.New(), binding, 1)
		share := jo.NativeShareJob("native-share", binding, 1)
		for _, job := range []*jobs.Job{cell, share} {
			if err := store.ClaimJob(ctx, job); err != nil {
				t.Fatal(err)
			}
		}
		intent := jo.NativeShareIntent{BindingID: binding, Generation: 1, NativeUserID: user, ShareID: uuid.New(), HiddenUserID: uuid.New(), HiddenUserLogin: "original-hidden", DocumentID: "original-hash", Roots: []string{uuid.New()}}
		claims := map[string]interface{}{"action_key": "file_storage.share@v2", "external_execution_id": uuid.New(), "idempotency_key": key,
			"tenant_id": uuid.New(), "actor_principal_id": user, "initiating_human_principal_id": user, "operation_id": uuid.New(), "action_execution_id": uuid.New(),
			"target_type": "RESOURCE", "target_id": uuid.New(), "result_exposure_policy_id": uuid.New(), "result_exposure_policy_version": 1, "action_definition_version": 1}
		task, err := jo.NewNativeShareTask(share.ID, key, "native-user", intent, claims)
		if err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(task); err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(task); err == nil {
			t.Fatal("same revoke was dispatched twice")
		}
		snapshot, err := store.SnapshotNativeCells(ctx, binding, 1, cell.ID, true, 1<<20, "", "native-share")
		if err != nil || len(snapshot) != 2 {
			t.Fatalf("share omitted from original fence: %v %v", snapshot, err)
		}
		for _, job := range snapshot {
			if !job.Inactive {
				t.Fatal("unfenced job returned")
			}
		}
		late := proto.Clone(task).(*jobs.Task)
		late.ID = uuid.New()
		if err = store.ClaimTask(late); err == nil {
			t.Fatal("late revoke crossed persisted cutoff")
		}
		other := uuid.New()
		otherJob := jo.NativeShareJob("native-share", other, 1)
		if err = store.ClaimJob(ctx, otherJob); err != nil {
			t.Fatal("other binding blocked", err)
		}
		absent := uuid.New()
		absentCell := uuid.New()
		if _, err = store.SnapshotNativeCells(ctx, absent, 1, absentCell, true, 1<<20, "", "native-share"); err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimJob(ctx, jo.NativeShareJob("native-share", absent, 1)); err == nil {
			t.Fatal("late create overwrote cancel-before-create fence")
		}
	})
}

func TestDAO_NativeCellFenceAndClaim(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		binding := uuid.New()
		old, current := jo.NativeCellJob(uuid.New(), binding, 1), jo.NativeCellJob(uuid.New(), binding, 2)
		for _, job := range []*jobs.Job{old, current} {
			if err := store.ClaimJob(ctx, job); err != nil {
				t.Fatal(err)
			}
		}
		if err := store.ClaimJob(ctx, jo.NativeCellJob(uuid.New(), binding, 2)); err == nil {
			t.Fatal("second Job for frozen generation accepted")
		}
		oldTask, _ := jo.NewNativeCellTask(old.ID, uuid.New(), "native-human", []byte(`{"original":"claim"}`))
		if err := store.ClaimTask(oldTask); err != nil {
			t.Fatal(err)
		}
		observed, err := store.SnapshotNativeCells(ctx, binding, 2, current.ID, false, 1<<20)
		if err != nil || len(observed) != 2 {
			t.Fatal("history was not fully enumerated", observed, err)
		}
		for _, job := range observed {
			if job.Inactive {
				t.Fatal("create observation stopped native job")
			}
		}
		// Race a late coordinator claim with the real DAO fence: it either
		// commits before and appears in the snapshot, or cannot create a task.
		late, _ := jo.NewNativeCellTask(current.ID, uuid.New(), "native-human", []byte(`{"original":"late"}`))
		start := make(chan struct{})
		done := make(chan error, 1)
		go func() { <-start; done <- store.ClaimTask(late) }()
		close(start)
		snapshot, err := store.SnapshotNativeCells(ctx, binding, 2, current.ID, true, 1<<20)
		claimErr := <-done
		if err != nil {
			t.Fatal(err)
		}
		found := false
		oldFound := false
		for _, job := range snapshot {
			if !job.Inactive {
				t.Fatal("fence not persisted")
			}
			for _, task := range job.Tasks {
				found = found || task.ID == late.ID
				oldFound = oldFound || task.ID == oldTask.ID
			}
		}
		if !oldFound || (claimErr == nil) != found {
			t.Fatal("fence lost concurrent/historical native claim", claimErr, found, oldFound)
		}
		for _, job := range []*jobs.Job{old, current} {
			late, _ := jo.NewNativeCellTask(job.ID, uuid.New(), "native-human", []byte(`{}`))
			if err := store.ClaimTask(late); err == nil {
				t.Fatal("post-fence claim accepted")
			}
			if task, err := store.GetTask(ctx, job.ID, late.ID); err != nil || task != nil {
				t.Fatal("rejected claim left a task", task, err)
			}
		}
		oldTask.Status = jobs.TaskStatus_Running
		if err := store.PutTask(oldTask); err != nil {
			t.Fatal("fence blocked existing task reconciliation", err)
		}
		next := jo.NativeCellJob(uuid.New(), binding, 3)
		if err := store.ClaimJob(ctx, next); err != nil {
			t.Fatal(err)
		}
		nextTask, _ := jo.NewNativeCellTask(next.ID, uuid.New(), "native-human", []byte(`{}`))
		if err := store.ClaimTask(nextTask); err != nil {
			t.Fatal("new generation inherited retired Job fence", err)
		}
	})
}

func TestDAO_NativeCellCancelBeforeCreate(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		binding, jobID := uuid.New(), uuid.New()
		if snapshot, err := store.SnapshotNativeCells(ctx, binding, 1, jobID, false, 1<<20); err == nil || snapshot != nil {
			t.Fatal("observation invented an absent Job", snapshot, err)
		}
		for attempt := 0; attempt < 2; attempt++ {
			snapshot, err := store.SnapshotNativeCells(ctx, binding, 1, jobID, true, 1<<20)
			if err != nil || len(snapshot) != 1 || !jo.NativeCellJobMatches(snapshot[0], jobID, binding, 1) || !snapshot[0].Inactive || len(snapshot[0].Tasks) != 0 {
				t.Fatal("empty cancellation was not durably fenced", snapshot, err)
			}
		}
		for _, job := range []*jobs.Job{jo.NativeCellJob(jobID, binding, 1), jo.NativeCellJob(uuid.New(), binding, 1)} {
			if err := store.ClaimJob(ctx, job); err == nil {
				t.Fatal("late create replaced canceled generation")
			}
		}
		for _, job := range []*jobs.Job{jo.NativeCellJob(jobID, binding, 1), {ID: jobID}} {
			if err := store.PutJob(job); err == nil {
				t.Fatal("ordinary Job update replaced cancellation fence")
			}
		}
		if err := store.DeleteJob(jobID); err == nil {
			t.Fatal("deleting fence reopened delayed create")
		}
		late, _ := jo.NewNativeCellTask(jobID, uuid.New(), "native-human", []byte(`{}`))
		if err := store.ClaimTask(late); err == nil {
			t.Fatal("late task crossed pre-create fence")
		}
		if job, err := store.GetJob(jobID, 0); err != nil || !job.Inactive || len(job.Tasks) != 0 {
			t.Fatal("cancellation evidence changed", job, err)
		}
		// An absent current generation must retain earlier cancellation fences.
		old, err := store.SnapshotNativeCells(ctx, binding, 2, uuid.New(), true, 1<<20)
		if err != nil || len(old) != 2 {
			t.Fatal("cancellation omitted predecessor", old, err)
		}
	})
}

func TestDAO_NativeCellAbsentFenceRetainsInFlight(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		binding := uuid.New()
		prior := jo.NativeCellJob(uuid.New(), binding, 1)
		if err := store.ClaimJob(ctx, prior); err != nil {
			t.Fatal(err)
		}
		pending, _ := jo.NewNativeCellTask(prior.ID, uuid.New(), "native-human", []byte(`{}`))
		if err := store.ClaimTask(pending); err != nil {
			t.Fatal(err)
		}
		snapshot, err := store.SnapshotNativeCells(ctx, binding, 2, uuid.New(), true, 1<<20)
		if err != nil || len(snapshot) != 2 {
			t.Fatal("absent-current cancellation lost predecessor", snapshot, err)
		}
		found := false
		for _, job := range snapshot {
			if !job.Inactive {
				t.Fatal("predecessor can still accept work", job)
			}
			for _, task := range job.Tasks {
				found = found || proto.Equal(task, pending)
			}
		}
		if !found {
			t.Fatal("unresolved original task was lost or rewritten")
		}
	})
}

func TestDAO_NativeCellAbsentFenceRejectsConflict(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, scenario := range []string{"orphan-task", "ordinary-job", "generation-owner", "size-limit", "canceled-context"} {
			t.Run(scenario, func(t *testing.T) {
				binding, jobID := uuid.New(), uuid.New()
				requestCtx, maxBytes := ctx, int64(1<<20)
				switch scenario {
				case "orphan-task":
					err = store.PutTask(&jobs.Task{ID: uuid.New(), JobID: jobID, Status: jobs.TaskStatus_Running})
				case "ordinary-job":
					err = store.PutJob(&jobs.Job{ID: jobID})
				case "generation-owner":
					err = store.ClaimJob(ctx, jo.NativeCellJob(uuid.New(), binding, 1))
				case "size-limit":
					maxBytes = 1
				case "canceled-context":
					var cancel context.CancelFunc
					requestCtx, cancel = context.WithCancel(ctx)
					cancel()
				}
				if err != nil {
					t.Fatal(err)
				}
				if snapshot, err := store.SnapshotNativeCells(requestCtx, binding, 1, jobID, true, maxBytes); err == nil || snapshot != nil {
					t.Fatal("incomplete cancellation was acknowledged", snapshot, err)
				}
				job, err := store.GetJob(jobID, 0)
				if scenario == "ordinary-job" {
					if err != nil || job.Inactive || jo.IsFrozenNativeJob(job) {
						t.Fatal("conflicting ordinary Job was overwritten", job, err)
					}
				} else if err == nil || job != nil {
					t.Fatal("rejected cancellation left a Job", job, err)
				}
			})
		}
	})
}

func TestDAO_NativeCellCreateRacesCancellation(t *testing.T) {
	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		store, err := manager.Resolve[jo.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, crossGeneration := range []bool{false, true} {
			t.Run(fmt.Sprintf("cross-generation=%t", crossGeneration), func(t *testing.T) {
				binding, jobID := uuid.New(), uuid.New()
				fenceID, generation := jobID, int64(1)
				if crossGeneration {
					fenceID, generation = uuid.New(), 2
				}
				late, _ := jo.NewNativeCellTask(jobID, uuid.New(), "native-human", []byte(`{}`))
				start, done := make(chan struct{}), make(chan error, 1)
				go func() {
					<-start
					if err := store.ClaimJob(ctx, jo.NativeCellJob(jobID, binding, 1)); err != nil {
						done <- err
						return
					}
					done <- store.ClaimTask(late)
				}()
				close(start)
				snapshot, err := store.SnapshotNativeCells(ctx, binding, generation, fenceID, true, 1<<20)
				claimErr := <-done
				if errors.Is(err, errors.StatusConflict) {
					// A conflicting first-claim anchor aborts the whole transaction;
					// re-observe the SAME fence identity, never accept an empty result.
					snapshot, err = store.SnapshotNativeCells(ctx, binding, generation, fenceID, true, 1<<20)
				}
				if err != nil || len(snapshot) == 0 {
					t.Fatal("racing initial create escaped cancellation", snapshot, err)
				}
				found, fenced := false, false
				for _, job := range snapshot {
					if !job.Inactive {
						t.Fatal("cancellation left a generation open", job)
					}
					fenced = fenced || job.ID == fenceID
					for _, task := range job.Tasks {
						found = found || proto.Equal(task, late)
					}
				}
				if !fenced || (claimErr == nil) != found {
					t.Fatal("cancellation lost accepted native work", claimErr, snapshot)
				}
				if err := store.ClaimJob(ctx, jo.NativeCellJob(jobID, binding, 1)); err == nil {
					t.Fatal("older first generation appeared after acknowledged fence")
				}
			})
		}
	})
}

func TestDAO_CRUD(t *testing.T) {

	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		Convey("Test Put / Get / Delete", t, func() {
			db, err := manager.Resolve[jo.DAO](ctx)
			So(err, ShouldBeNil)

			searchQuery, _ := anypb.New(&tree.Query{
				Extension: "jpg",
			})

			e := db.PutJob(&jobs.Job{
				ID:             "unique-job-id",
				Owner:          "userId",
				Label:          "My Test Job",
				Inactive:       false,
				MaxConcurrency: 20,
				EventNames:     []string{"NODE_CREATE", "NODE_UPDATE"},
				Actions: []*jobs.Action{
					{
						ID:         "CreateThumbnail",
						Parameters: map[string]string{"Quality": "10"},
						NodesSelector: &jobs.NodesSelector{
							Query: &service.Query{
								SubQueries: []*anypb.Any{searchQuery},
							},
						},
					},
				},
			})

			So(e, ShouldBeNil)

			saved, e2 := db.GetJob("unique-job-id", 0)
			So(e2, ShouldBeNil)
			So(saved, ShouldNotBeNil)

			reparsedQuery := saved.Actions[0].NodesSelector.Query.SubQueries[0]
			subQ := &tree.Query{}
			e3 := anypb.UnmarshalTo(reparsedQuery, subQ, proto.UnmarshalOptions{})
			So(e3, ShouldBeNil)
			So(subQ.Extension, ShouldEqual, "jpg")

			e4 := db.DeleteJob("unique-job-id")
			So(e4, ShouldBeNil)
			deleted, e5 := db.GetJob("unique-job-id", 0)
			So(deleted, ShouldBeNil)
			So(errors.Is(e5, errors.StatusNotFound), ShouldBeTrue)
		})
	})
}

func TestDAO_ListJobs(t *testing.T) {

	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		Convey("Test List Jobs", t, func() {

			db, err := manager.Resolve[jo.DAO](ctx)
			So(err, ShouldBeNil)

			db.PutJob(&jobs.Job{
				ID:             "unique-job-id",
				Owner:          "userId",
				Label:          "My Test Job",
				Inactive:       false,
				MaxConcurrency: 20,
				EventNames:     []string{"NODE_CREATE", "NODE_UPDATE"},
				Actions: []*jobs.Action{
					{ID: "CreateThumbnail", Parameters: map[string]string{"Quality": "10"}},
				},
			})

			db.PutJob(&jobs.Job{
				ID:             "unique-id2",
				Owner:          "admin",
				Label:          "My Other Job",
				Inactive:       false,
				MaxConcurrency: 20,
				Schedule: &jobs.Schedule{
					Iso8601Schedule: "R2/2015-06-04T19:25:16.828696-07:00/PT5M", // Every 5 minutes
					Iso8601MinDelta: "PT1M",                                     // Minimum 1 minute
				},
				Actions: []*jobs.Action{
					{ID: "Resync", Parameters: map[string]string{"Service": "pydio.api.mindiods1.sync"}},
				},
			})

			{
				_, resCount, err := listAndCount(db, "", false, false, 0)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 2)
			}

			{
				_, resCount, err := listAndCount(db, "userId", false, false, 0)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 1)
			}

			{
				_, resCount, err := listAndCount(db, "", true, false, 0)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 1)
			}

			{
				_, resCount, err := listAndCount(db, "", false, true, 0)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 1)
			}

			{
				_, resCount, err := listAndCount(db, "userId", false, true, 0)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 0)
			}

			db.PutTask(&jobs.Task{
				ID:        "unique-task-id",
				JobID:     "unique-id2",
				StartTime: int32(time.Now().Add(-10 * time.Second).Unix()),
				EndTime:   int32(time.Now().Add(-10 * time.Second).Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})
			recent := int32(time.Now().Add(-5 * time.Second).Unix())
			db.PutTask(&jobs.Task{
				ID:        "unique-task-id-2",
				JobID:     "unique-id2",
				StartTime: recent,
				EndTime:   recent,
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})
			db.PutTask(&jobs.Task{
				ID:        "unique-task-id-3",
				JobID:     "unique-id2",
				StartTime: int32(time.Now().Add(-15 * time.Second).Unix()),
				EndTime:   int32(time.Now().Add(-15 * time.Second).Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})

			{
				_, resCount, err := listAndCount(db, "", false, false, jobs.TaskStatus_Running)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 1)
			}

			{
				_, resCount, err := listAndCount(db, "", false, false, jobs.TaskStatus_Any)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 2)
			}

			{
				_, resCount, err := listAndCount(db, "", false, false, jobs.TaskStatus_Finished)
				So(err, ShouldBeNil)
				So(resCount, ShouldEqual, 0)
			}
			{
				jobList, _, e := listAndCount(db, "", false, false, jobs.TaskStatus_Any, 0, 1)
				So(e, ShouldBeNil)
				So(jobList, ShouldNotBeEmpty)
				loaded, ok := jobList["unique-id2"]
				So(ok, ShouldBeTrue)
				So(loaded.Tasks, ShouldHaveLength, 1)
				So(loaded.Tasks[0].StartTime, ShouldEqual, recent)
				So(loaded.Tasks[0].ID, ShouldEqual, "unique-task-id-2")
			}
			{
				jobList, _, e := listAndCount(db, "", false, false, jobs.TaskStatus_Any, 1, 0)
				So(e, ShouldBeNil)
				So(jobList, ShouldNotBeEmpty)
				loaded, ok := jobList["unique-id2"]
				So(ok, ShouldBeTrue)
				fmt.Println(loaded)
				So(loaded.Tasks, ShouldHaveLength, 2)
			}
			{
				jobList, _, e := listAndCount(db, "", false, false, jobs.TaskStatus_Any, 1, 1)
				So(e, ShouldBeNil)
				So(jobList, ShouldNotBeEmpty)
				loaded, ok := jobList["unique-id2"]
				So(ok, ShouldBeTrue)
				So(loaded.Tasks, ShouldHaveLength, 1)
			}

		})

	})

}

func listAndCount(db jo.DAO, owner string, eventsOnly bool, timersOnly bool, withTasks jobs.TaskStatus, taskCursor ...int32) (map[string]*jobs.Job, int, error) {

	resCount := 0
	res, err := db.ListJobs(owner, eventsOnly, timersOnly, withTasks, []string{}, taskCursor...)
	So(err, ShouldBeNil)
	wg := &sync.WaitGroup{}
	wg.Add(1)
	list := make(map[string]*jobs.Job)
	for job := range res {
		if job != nil {
			log.Println(job)
			list[job.ID] = job
			resCount++
		}
	}
	/*
		go func() {
			defer wg.Done()
			for {
				select {
				case job := <-res:
					if job != nil {
						log.Println(job)
						list[job.ID] = job
						resCount++
					}
				case <-done:
					close(res)
					return
				}
			}
		}()
		wg.Wait()
	*/

	return list, resCount, err
}

func loadTasks(db jo.DAO, jobId string, jobStatus jobs.TaskStatus, offset ...int32) ([]*jobs.Task, error) {

	tasksChan, doneChan, err := db.ListTasks(context.Background(), jobId, jobStatus, offset...)
	var allTasks []*jobs.Task
	if err != nil {
		return allTasks, err
	}
	for task := range tasksChan {
		allTasks = append(allTasks, task)
	}
	return allTasks, <-doneChan
}

func TestDAO_PutTask(t *testing.T) {

	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		Convey("Test Put Task", t, func() {
			db, err := manager.Resolve[jo.DAO](ctx)
			So(err, ShouldBeNil)

			e := db.PutTask(&jobs.Task{
				ID:        "unique-task-id",
				JobID:     "corresponding-job-id",
				StartTime: int32(time.Now().Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})

			So(e, ShouldBeNil)
			allTasks, err := loadTasks(db, "corresponding-job-id", jobs.TaskStatus_Any)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 1)

		})
	})
}

func TestDAO_listTask(t *testing.T) {

	test.RunStorageTests(testCases, t, func(ctx context.Context) {
		Convey("Test Put Task", t, func() {

			db, err := manager.Resolve[jo.DAO](ctx)
			So(err, ShouldBeNil)

			e := db.PutTask(&jobs.Task{
				ID:        "unique-task-id",
				JobID:     "job-id-1",
				StartTime: int32(time.Now().Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})

			e = db.PutTask(&jobs.Task{
				ID:        "unique-task-id2",
				JobID:     "job-id-1",
				StartTime: int32(time.Now().Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Finished,
			})

			e = db.PutTask(&jobs.Task{
				ID:        "unique-task-id3",
				JobID:     "job-id-2",
				StartTime: int32(time.Now().Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Running,
			})

			e = db.PutTask(&jobs.Task{
				ID:        "unique-task-id4",
				JobID:     "job-id-3",
				StartTime: int32(time.Now().Unix()),
				Progress:  0.65,
				Status:    jobs.TaskStatus_Idle,
			})

			So(e, ShouldBeNil)

			allTasks, err := loadTasks(db, "job-id-1", jobs.TaskStatus_Any)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 2)

			allTasks, err = loadTasks(db, "job-id-1", jobs.TaskStatus_Any, 1)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 1)

			allTasks, err = loadTasks(db, "job-id-1", jobs.TaskStatus_Any, 50)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 0)

			allTasks, err = loadTasks(db, "job-id-1", jobs.TaskStatus_Running)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 1)

			allTasks, err = loadTasks(db, "", jobs.TaskStatus_Running)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 2)

			allTasks, err = loadTasks(db, "", jobs.TaskStatus_Any)
			So(err, ShouldBeNil)
			So(allTasks, ShouldHaveLength, 4)

		})
	})
}
