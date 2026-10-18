package restv2

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestPromoteResultRequiresTerminalReceipt(t *testing.T) {
	const node = "00000000-0000-4000-8000-000000000001"
	input := map[string]interface{}{"resourceId": "resource", "nativeObjectRef": node, "nativeRevision": "original-draft", "displayName": "file.txt", "mediaType": "text/plain"}
	task, err := jobstore.NewNativeWriteTask("binding", "native-write-job", "operation-key", "native-user", "native-user-uuid", map[string]interface{}{}, input)
	if err != nil {
		t.Fatal(err)
	}
	relation, _ := json.Marshal([]string{task.ID, jobstore.NativeVersionActionID, node})
	digest := sha256.Sum256(relation)
	revision := &tree.ContentRevision{VersionId: hex.EncodeToString(digest[:]), OwnerUuid: "native-user-uuid", ETag: "native-etag", Size: 0, Location: &tree.Node{Uuid: "version-location"}}
	body, _ := protojson.Marshal(revision)
	task.StartTime, task.EndTime, task.Status = 1, 2, jobs.TaskStatus_Finished
	task.ActionsLogs = append(task.ActionsLogs, &jobs.ActionLog{Action: &jobs.Action{ID: jobstore.NativeVersionActionID}, OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}})
	for _, scenario := range []string{"complete", "partial-copy", "fresh-refused", "crash-residue", "local-error", "missing-receipt", "wrong-version-cause"} {
		t.Run(scenario, func(t *testing.T) {
			current := proto.Clone(task).(*jobs.Task)
			switch scenario {
			case "partial-copy", "fresh-refused", "crash-residue":
				// These are the exact retained fields passed by executeNativePromote's
				// synchronous copy/fresh failure exits, and by same-key re-entry.
				current.Status, current.EndTime = jobs.TaskStatus_Running, 0
				current.ActionsLogs = current.ActionsLogs[:1]
			case "local-error":
				current.Status = jobs.TaskStatus_Error
			case "missing-receipt":
				current.ActionsLogs = current.ActionsLogs[:1]
			case "wrong-version-cause":
				current.ActionsLogs[1].Action.ID = "different-action"
			}
			before := proto.Clone(current)
			recorder := httptest.NewRecorder()
			if err := writeNativeTaskResult(restful.NewResponse(recorder), current); err != nil {
				t.Fatal(err)
			}
			var answer map[string]interface{}
			if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &answer) != nil {
				t.Fatal("original response was not encoded")
			}
			observation := answer["execution"].(map[string]interface{})
			want := "UNKNOWN"
			if scenario == "complete" {
				want = "SUCCEEDED"
			}
			if observation["platformStatus"] != want {
				t.Fatalf("unproved synchronous execution status: %v", observation["platformStatus"])
			}
			// DD-124(5): only the terminal carries the raw native Task status.
			if (scenario == "complete" && observation["nativeStatus"] != jobs.TaskStatus_Finished.String()) || (scenario != "complete" && observation["nativeStatus"] != nil) {
				t.Fatalf("terminal native status not taken from the persisted Task: %v", observation["nativeStatus"])
			}
			if scenario == "complete" {
				if answer["contentBytes"] != float64(0) || answer["contentReference"].(map[string]interface{})["nativeRevision"] != revision.VersionId {
					t.Fatal("original zero-byte revision was lost")
				}
			} else if answer["contentReference"] != nil || answer["contentBytes"] != nil || observation["terminalAt"] != nil {
				t.Fatal("unproved result disclosed terminal evidence")
			}
			if !proto.Equal(current, before) {
				t.Fatal("result observation mutated its retained native task")
			}
		})
	}
}
