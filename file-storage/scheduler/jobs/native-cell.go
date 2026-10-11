package jobs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"google.golang.org/protobuf/proto"
	"io"
	"strconv"

	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
)

const NativeCellShareJob = "nativeCellShareJob"
const NativeCellShareResult = "nativeCellShareResult"

// This Job only owns original Task persistence. It has no scheduler action,
// trigger or permission to execute; PutCell is the sole synchronous consumer.
func NativeCellJob(id, binding string, generation int64) *jobproto.Job {
	job := NativeReadJob(id)
	job.Metadata = map[string]string{NativeCellShareJob: "true", "bindingId": binding, "generation": strconv.FormatInt(generation, 10)}
	return job
}

func NativeCellJobMatches(job *jobproto.Job, id, binding string, generation int64) bool {
	expected := NativeCellJob(id, binding, generation)
	expected.Inactive = job.GetInactive()
	return binding != "" && generation > 0 && nativeActionJobMatches(job, expected)
}

func NativeCellJobOrigin(job *jobproto.Job) (string, int64, error) {
	if job == nil {
		return "", 0, errors.WithStack(errors.StatusConflict)
	}
	job = proto.Clone(job).(*jobproto.Job)
	job.Tasks = nil
	binding := job.GetMetadata()["bindingId"]
	generation, err := strconv.ParseInt(job.GetMetadata()["generation"], 10, 64)
	if err != nil || !NativeCellJobMatches(job, job.GetID(), binding, generation) {
		return "", 0, errors.WithStack(errors.StatusConflict)
	}
	return binding, generation, nil
}

func IsFrozenNativeJob(job *jobproto.Job) bool {
	_, cell := job.GetMetadata()[NativeCellShareJob]
	return cell || IsNativeDeleteJob(job) || IsNativeBindingJob(job)
}

// Only references, the original native selection and normalized permission
// commands enter this claim. No bearer credential is ever persisted.
func NewNativeCellTask(job, key, owner string, intent json.RawMessage) (*jobproto.Task, error) {
	if job == "" || key == "" || owner == "" || !json.Valid(intent) {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	hash := sha256.Sum256(intent)
	body, err := json.Marshal(struct {
		Digest string          `json:"digest"`
		Intent json.RawMessage `json:"intent"`
	}{hex.EncodeToString(hash[:]), intent})
	if err != nil {
		return nil, err
	}
	return &jobproto.Task{ID: key, JobID: job, TriggerOwner: owner, Status: jobproto.TaskStatus_Queued,
		ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{
			JsonBody: body, Vars: map[string]string{TaskCreateOnly: "true"},
		}}}}}}, nil
}

func NativeCellTaskIntent(task *jobproto.Task) (json.RawMessage, error) {
	refused := errors.WithStack(errors.StatusConflict)
	if !TaskHasClaim(task) {
		return nil, refused
	}
	var claim struct {
		Digest string          `json:"digest"`
		Intent json.RawMessage `json:"intent"`
	}
	body := task.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&claim) != nil || decoder.Decode(new(interface{})) != io.EOF || !json.Valid(claim.Intent) {
		return nil, refused
	}
	hash := sha256.Sum256(claim.Intent)
	if claim.Digest != hex.EncodeToString(hash[:]) {
		return nil, refused
	}
	return claim.Intent, nil
}
