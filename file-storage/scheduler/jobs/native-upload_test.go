package jobs

import (
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"google.golang.org/protobuf/proto"
)

func uploadTaskFixture(t *testing.T, multipart bool, size int64) *jobproto.Task {
	t.Helper()
	binding, key, user, principal := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	input := map[string]interface{}{"resourceId": uuid.New(), "nativeIntentId": uuid.New(), "nativeNodeId": uuid.New(),
		"nativeDeadline": float64(time.Now().Add(time.Hour).Unix()), "contentLength": float64(size), "multipart": multipart}
	claims := map[string]interface{}{"tenant_id": uuid.New(), "actor_principal_id": principal, "initiating_human_principal_id": principal,
		"external_execution_id": uuid.New(), "idempotency_key": key, "action_execution_id": uuid.New(), "operation_id": uuid.New(),
		"action_key": "file_storage.write@v2", "action_definition_version": float64(1), "target_type": "RESOURCE", "target_id": input["resourceId"],
		"result_exposure_policy_id": uuid.New(), "result_exposure_policy_version": float64(1)}
	task, err := NewNativeUploadTask(binding, 1, NativeUploadJob("write", binding, 1).ID, key, "native-user", user, claims, input)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func TestNativeUploadFirstByteClaimIsNotTerminal(t *testing.T) {
	for _, size := range []int64{0, 3} {
		task := uploadTaskFixture(t, false, size)
		if !NativeUploadWaiting(task) {
			t.Fatal("original queued intent is not waiting")
		}
		if _, err := ClaimNativeUploadStep(task, "put", uuid.New(), "workspace/file", "", size); err != nil {
			t.Fatal(err)
		}
		if NativeUploadWaiting(task) {
			t.Fatal("consumed synchronous claim pretends to have an active waiter")
		}
		if _, _, err := NativeUploadRevision(task); err == nil {
			t.Fatal("first byte claim is not an immutable Version receipt")
		}
		if _, err := ClaimNativeUploadStep(task, "put", uuid.New(), "workspace/file", "", size); err == nil {
			t.Fatal("duplicate writer admitted")
		}
	}
}

func TestNativeUploadConcurrentPartsMergeAndCompletion(t *testing.T) {
	task := uploadTaskFixture(t, true, 6)
	claim := func(target *jobproto.Task, step string, n int64, receipt ...string) {
		t.Helper()
		uploadID := "original-upload"
		if step == "create" {
			uploadID = ""
		}
		if _, err := ClaimNativeUploadStep(target, step, uuid.New(), "workspace/file", uploadID, n, receipt...); err != nil {
			t.Fatal(step, err)
		}
	}
	createRequest := proto.Clone(task).(*jobproto.Task)
	claim(createRequest, "create", 0, "", "", "image/custom")
	var err error
	task, err = MergeNativeUploadStep(task, createRequest, "create")
	if err != nil {
		t.Fatal("create content type was not preserved under task CAS", err)
	}
	claim(task, "created", 0)
	left, right := proto.Clone(task).(*jobproto.Task), proto.Clone(task).(*jobproto.Task)
	claim(left, "part/1", 3)
	claim(right, "part/2", 3)
	merged, err := MergeNativeUploadStep(task, left, "part/1")
	if err != nil {
		t.Fatal(err)
	}
	merged, err = MergeNativeUploadStep(merged, right, "part/2")
	if err != nil {
		t.Fatal("distinct concurrent part lost", err)
	}
	if _, err = MergeNativeUploadStep(merged, left, "part/1"); err == nil {
		t.Fatal("same part replay admitted")
	}
	if _, err = ClaimNativeUploadStep(proto.Clone(merged).(*jobproto.Task), "complete", uuid.New(), "workspace/file", "original-upload", 6, "", NativeUploadPartsDigest(map[string]string{"1": "a", "2": "b"})); err == nil {
		t.Fatal("missing durable part ACK admitted completion")
	}
	claim(merged, "stored/1", 3, "a")
	claim(merged, "stored/2", 3, "b")
	if _, err = ClaimNativeUploadStep(proto.Clone(merged).(*jobproto.Task), "complete", uuid.New(), "workspace/file", "original-upload", 6, "", NativeUploadPartsDigest(map[string]string{"1": "wrong", "2": "b"})); err == nil {
		t.Fatal("changed native parts admitted")
	}
	claim(merged, "complete", 6, "", NativeUploadPartsDigest(map[string]string{"1": "a", "2": "b"}))
	if _, err = ClaimNativeUploadStep(merged, "part/3", uuid.New(), "workspace/file", "original-upload", 0); err == nil {
		t.Fatal("late part after completion admitted")
	}
	origin, err := NativeUploadRecordedStep(merged, "create")
	if err != nil || origin == nil || origin.ContentType == nil || *origin.ContentType != "image/custom" {
		t.Fatal("concurrent part merge lost the original content type", origin, err)
	}
	if _, _, err = NativeUploadRevision(merged); err == nil {
		t.Fatal("multipart ACK claimed immutable Version success")
	}
}

func TestNativeUploadJobFrozenIdentity(t *testing.T) {
	binding := uuid.New()
	job := NativeUploadJob("write", binding, 3)
	if owner, generation, err := NativeUploadJobOrigin(job); err != nil || owner != binding || generation != 3 {
		t.Fatal(owner, generation, err)
	}
	job.Inactive = true
	if _, _, err := NativeUploadJobOrigin(job); err != nil {
		t.Fatal("native inactive fence lost origin", err)
	}
	job.Metadata["generation"] = "4"
	if _, _, err := NativeUploadJobOrigin(job); err == nil {
		t.Fatal("relabelled generation accepted")
	}
}

func TestNativeUploadDurablePublicationPrecedesTerminal(t *testing.T) {
	for _, size := range []int64{0, 3} {
		task := uploadTaskFixture(t, false, size)
		if _, err := ClaimNativeUploadStep(task, "put", uuid.New(), "workspace/file", "", size); err != nil {
			t.Fatal(err)
		}
		intent, err := NativeUploadTaskIntent(task)
		if err != nil {
			t.Fatal(err)
		}
		id, err := NativeUploadVersionID(task)
		if err != nil {
			t.Fatal(err)
		}
		node := &tree.Node{Uuid: intent.Input["nativeNodeId"].(string), Path: "workspace/file"}
		node.MustSetMeta(common.MetaNamespaceMime, "text/plain")
		draft := &tree.ContentRevision{VersionId: intent.Input["nativeIntentId"].(string), Draft: true,
			OwnerUuid: intent.NativeUserID, ETag: "immutable-bytes", Size: size, Location: &tree.Node{Path: "versions/draft"}}
		version := proto.Clone(draft).(*tree.ContentRevision)
		version.Draft, version.VersionId, version.Location = false, id, &tree.Node{Path: "versions/published"}
		record := &NativeUploadPublicationRecord{Node: node, Draft: draft, Version: version,
			PruneVersions: []*tree.ContentRevision{{VersionId: "old-version", Location: &tree.Node{Path: "versions/old"}}}}
		if err := CompleteNativeUploadPublication(task, record, time.Now()); err == nil {
			t.Fatal("terminal accepted without durable cleanup plan")
		}
		if err := AppendNativeUploadPublication(task, record); err != nil {
			t.Fatal(err)
		}
		if _, _, err := NativeUploadRevision(task); err == nil {
			t.Fatal("cleanup plan is not terminal evidence")
		}
		if err := AppendNativeUploadPublication(task, record); err == nil {
			t.Fatal("publication replay accepted")
		}
		stored, err := NativeUploadPublicationFromTask(task)
		if err != nil || stored.PruneVersions[0].VersionId != "old-version" {
			t.Fatal("lost pre-deletion cleanup evidence", err)
		}
		for _, scenario := range []string{"missing-dispatch", "negative-dispatch", "before-dispatch", "future-completion", "overflow-completion"} {
			t.Run(scenario, func(t *testing.T) {
				candidate := proto.Clone(task).(*jobproto.Task)
				completedAt := time.Now()
				switch scenario {
				case "missing-dispatch":
					candidate.StartTime = 0
				case "negative-dispatch":
					candidate.StartTime = -1
				case "before-dispatch":
					completedAt = time.Unix(int64(candidate.StartTime)-1, 0)
				case "future-completion":
					completedAt = completedAt.Add(time.Hour)
				case "overflow-completion":
					completedAt = time.Unix(1<<32+int64(candidate.StartTime), 0)
				}
				before := proto.Clone(candidate)
				if err := CompleteNativeUploadPublication(candidate, stored, completedAt); err == nil {
					t.Fatal("invalid dispatch/completion time became terminal")
				}
				if !proto.Equal(before, candidate) {
					t.Fatal("rejected completion mutated original task evidence")
				}
			})
		}
		if err := CompleteNativeUploadPublication(task, stored, time.Now()); err != nil {
			t.Fatal(err)
		}
		if _, _, err := NativeUploadRevision(task); err != nil {
			t.Fatal(err)
		}
		if err := CompleteNativeUploadPublication(task, stored, time.Now()); err != nil {
			t.Fatal("same native terminal is not stable", err)
		}
		for _, scenario := range []string{"missing-dispatch", "negative-dispatch", "reversed-time", "future-terminal"} {
			t.Run("read-"+scenario, func(t *testing.T) {
				candidate := proto.Clone(task).(*jobproto.Task)
				switch scenario {
				case "missing-dispatch":
					candidate.StartTime = 0
				case "negative-dispatch":
					candidate.StartTime = -1
				case "reversed-time":
					candidate.EndTime = candidate.StartTime - 1
				case "future-terminal":
					candidate.EndTime = int32(time.Now().Add(time.Hour).Unix())
				}
				if _, _, err := NativeUploadRevision(candidate); err == nil {
					t.Fatal("invalid original task time accepted as terminal evidence")
				}
				if err := CompleteNativeUploadPublication(candidate, stored, time.Now()); err == nil {
					t.Fatal("invalid terminal accepted on recovery")
				}
			})
		}
		changed := proto.Clone(version).(*tree.ContentRevision)
		changed.IsHead = true
		if !NativeUploadPublishedVersionMatches(changed, version) {
			t.Fatal("mutable head flag invalidated immutable evidence")
		}
		changed.ETag = "different-bytes"
		if NativeUploadPublishedVersionMatches(changed, version) {
			t.Fatal("changed immutable evidence accepted")
		}
	}
}
