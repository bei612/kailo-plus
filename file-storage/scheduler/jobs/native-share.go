package jobs

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"strconv"
	"time"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"google.golang.org/protobuf/proto"
)

const NativeShareJobMarker = "nativeShareJob"
const NativeShareResult = "nativeShareResult"

// One original triggerless Job per frozen binding generation. It shares the
// existing Jobs transaction fence, not another scheduler or execution ledger.
func NativeShareJob(base, binding string, generation int64) *jobproto.Job {
	job := NativeReadJob(auth.NativeUploadJobID(base, binding, generation))
	job.Metadata = map[string]string{NativeShareJobMarker: "true", "bindingId": binding,
		"generation": strconv.FormatInt(generation, 10), "baseJobId": base}
	return job
}

func NativeShareJobOrigin(job *jobproto.Job) (string, int64, error) {
	refused := errors.WithStack(errors.StatusConflict)
	base, binding := job.GetMetadata()["baseJobId"], job.GetMetadata()["bindingId"]
	generation, err := strconv.ParseInt(job.GetMetadata()["generation"], 10, 64)
	if base == "" || !auth.NativeActorUUID(binding) || err != nil || generation <= 0 {
		return "", 0, refused
	}
	expected := NativeShareJob(base, binding, generation)
	expected.Inactive = job.GetInactive()
	actual := proto.Clone(job).(*jobproto.Job)
	actual.Tasks = nil
	if !nativeActionJobMatches(actual, expected) {
		return "", 0, refused
	}
	return binding, generation, nil
}

// Frozen access references only. Neither the public URL/password nor a platform
// or native bearer belongs in the Task. Roots were checked by the original
// actor's native router before the first-dispatch claim.
type NativeShareIntent struct {
	BindingID       string                 `json:"bindingId"`
	Generation      int64                  `json:"generation"`
	NativeUserID    string                 `json:"nativeUserId"`
	Scope           map[string]interface{} `json:"scope"`
	ShareID         string                 `json:"shareId"`
	HiddenUserID    string                 `json:"hiddenUserId"`
	HiddenUserLogin string                 `json:"hiddenUserLogin"`
	DocumentID      string                 `json:"documentId"`
	Roots           []string               `json:"roots"`
}

func NewNativeShareTask(job, key, owner string, intent NativeShareIntent, claims map[string]interface{}) (*jobproto.Task, error) {
	intent.Scope = nativeWriteScope(claims)
	intent.Scope["external_execution_id"] = claims["external_execution_id"]
	intent.Scope["idempotency_key"] = claims["idempotency_key"]
	if !auth.NativeActorUUID(key) || claims["idempotency_key"] != key || !auth.NativeActorUUID(claimString(claims, "external_execution_id")) {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	body, err := json.Marshal(intent)
	if err != nil {
		return nil, err
	}
	task, err := NewNativeCellTask(job, key, owner, body)
	if err != nil {
		return nil, err
	}
	if _, err := NativeShareTaskIntent(task); err != nil {
		return nil, err
	}
	return task, nil
}

func NativeShareTaskIntent(task *jobproto.Task) (*NativeShareIntent, error) {
	body, err := NativeCellTaskIntent(task)
	var value NativeShareIntent
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&value) != nil || decoder.Decode(new(interface{})) != io.EOF || !auth.NativeActorUUID(value.BindingID) || value.Generation <= 0 ||
		!auth.NativeActorUUID(value.NativeUserID) || !auth.NativeActorUUID(value.ShareID) || !auth.NativeActorUUID(value.HiddenUserID) ||
		value.HiddenUserLogin == "" || value.DocumentID == "" || len(value.Roots) == 0 || value.Scope["action_key"] != "file_storage.share@v2" ||
		value.Scope["idempotency_key"] != task.GetID() || !auth.NativeActorUUID(claimString(value.Scope, "external_execution_id")) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	for _, field := range []string{"tenant_id", "actor_principal_id", "initiating_human_principal_id", "operation_id", "action_execution_id", "target_id", "result_exposure_policy_id"} {
		if !auth.NativeActorUUID(claimString(value.Scope, field)) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
	}
	if value.Scope["target_type"] != "RESOURCE" {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	for _, field := range []string{"action_definition_version", "result_exposure_policy_version"} {
		version, ok := value.Scope[field].(float64)
		if !ok || version < 1 || version > 1<<53-1 || math.Trunc(version) != version {
			return nil, errors.WithStack(errors.StatusConflict)
		}
	}
	if agent, exists := value.Scope["agent_principal_id"]; exists {
		if agent != value.Scope["actor_principal_id"] || !auth.NativeActorUUID(claimString(value.Scope, "delegation_id")) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
	} else if value.Scope["actor_principal_id"] != value.Scope["initiating_human_principal_id"] {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	seen := map[string]bool{}
	for _, id := range value.Roots {
		if !auth.NativeActorUUID(id) || seen[id] {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		seen[id] = true
	}
	return &value, nil
}

func NativeShareTaskMatches(task *jobproto.Task, binding string, generation int64, nativeUser string, claims map[string]interface{}) bool {
	intent, err := NativeShareTaskIntent(task)
	if err != nil || intent.BindingID != binding || intent.Generation != generation || intent.NativeUserID != nativeUser {
		return false
	}
	expected, _ := json.Marshal(nativeWriteScope(claims))
	actual := make(map[string]interface{}, len(intent.Scope))
	for key, value := range intent.Scope {
		if key != "external_execution_id" && key != "idempotency_key" {
			actual[key] = value
		}
	}
	encoded, _ := json.Marshal(actual)
	return string(expected) == string(encoded)
}

func NativeShareTerminal(task *jobproto.Task) (string, error) {
	if _, err := NativeShareTaskIntent(task); err != nil {
		return "", err
	}
	if task.GetStatus() != jobproto.TaskStatus_Finished || task.GetStartTime() <= 0 || task.GetEndTime() < task.GetStartTime() || time.Unix(int64(task.EndTime), 0).After(time.Now()) {
		return "", errors.WithStack(errors.StatusConflict)
	}
	body, _ := NativeCellTaskIntent(task)
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeShareResult] == "true" && output.Success && string(output.JsonBody) == string(body) {
				return time.Unix(int64(task.EndTime), 0).UTC().Format(time.RFC3339), nil
			}
		}
	}
	return "", errors.WithStack(errors.StatusConflict)
}
