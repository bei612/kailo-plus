package jobs

import (
	"bytes"
	"testing"

	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"google.golang.org/protobuf/proto"
)

func TestNativeCellTaskRetainsOriginalClaimAndReceipt(t *testing.T) {
	intent := []byte(`{"bindingId":"binding","nativeUserId":"native-human","changes":[]}`)
	claimed, err := NewNativeCellTask("native-cell", "request", "owner", intent)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := NativeCellTaskIntent(claimed)
	if err != nil || !bytes.Equal(actual, intent) || !TaskHasClaim(claimed) {
		t.Fatal("native original claim missing", err)
	}
	for _, scenario := range []string{"owner", "intent", "receipt", "job", "valid"} {
		t.Run(scenario, func(t *testing.T) {
			stored := proto.Clone(claimed).(*jobproto.Task)
			stored.ActionsLogs = append(stored.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: []byte("native-ACK"), Vars: map[string]string{NativeCellShareResult: "true"}}}}})
			next := proto.Clone(stored).(*jobproto.Task)
			switch scenario {
			case "owner":
				next.TriggerOwner = "another-owner"
			case "intent":
				next.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody = []byte(`{}`)
			case "receipt":
				next.ActionsLogs = next.ActionsLogs[:1]
			case "job":
				next.JobID = "another-job"
			case "valid":
				next.Status = jobproto.TaskStatus_Finished
				next.EndTime = 1
			}
			if err := ValidateTaskUpdate(stored, next); (err == nil) != (scenario == "valid") {
				t.Fatalf("native claim/evidence rewrite accepted: %s %v", scenario, err)
			}
		})
	}
	job := NativeCellJob("native-cell", "binding", 1)
	legacy := NativeReadJob(job.ID)
	legacy.Metadata = map[string]string{NativeCellShareJob: "true"}
	if _, _, err := NativeCellJobOrigin(legacy); err == nil {
		t.Fatal("legacy unowned Job accepted")
	}
	if !NativeCellJobMatches(job, job.ID, "binding", 1) || !IsFrozenNativeJob(job) || len(job.Actions) != 0 || len(job.EventNames) != 0 || job.Schedule != nil {
		t.Fatal("native Cell persistence Job became an execution route")
	}
	job.Actions = []*jobproto.Action{{ID: "unadmitted"}}
	if NativeCellJobMatches(job, job.ID, "binding", 1) {
		t.Fatal("overwritten native Job accepted")
	}
}
