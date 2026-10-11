package jobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const NativeUploadStep = "nativeUploadStep"
const NativeUploadContent = "nativeUploadContent"
const NativeUploadJobMarker = "nativeUploadJob"

// The original Jobs store retains one triggerless upload Job per frozen
// binding generation. Its ID is native coordination, not a platform registry.
func NativeUploadJob(base, binding string, generation int64) *jobproto.Job {
	job := NativeWriteJob(auth.NativeUploadJobID(base, binding, generation))
	job.Metadata = map[string]string{NativeUploadJobMarker: "true", "bindingId": binding, "generation": strconv.FormatInt(generation, 10), "baseJobId": base}
	return job
}

func NativeUploadJobOrigin(job *jobproto.Job) (string, int64, error) {
	refused := errors.WithStack(errors.StatusConflict)
	if job == nil {
		return "", 0, refused
	}
	base, binding := job.GetMetadata()["baseJobId"], job.GetMetadata()["bindingId"]
	generation, err := strconv.ParseInt(job.GetMetadata()["generation"], 10, 64)
	if err != nil || base == "" || !auth.NativeActorUUID(binding) || generation <= 0 {
		return "", 0, refused
	}
	expected := NativeUploadJob(base, binding, generation)
	expected.Inactive = job.Inactive
	actual := proto.Clone(job).(*jobproto.Job)
	actual.Tasks = nil
	if !nativeActionJobMatches(actual, expected) {
		return "", 0, refused
	}
	return binding, generation, nil
}

func IsNativeBindingJob(job *jobproto.Job) bool {
	_, cell := job.GetMetadata()[NativeCellShareJob]
	_, upload := job.GetMetadata()[NativeUploadJobMarker]
	_, share := job.GetMetadata()[NativeShareJobMarker]
	return cell || upload || share
}

func NativeBindingJobOrigin(job *jobproto.Job) (string, int64, error) {
	if _, share := job.GetMetadata()[NativeShareJobMarker]; share {
		return NativeShareJobOrigin(job)
	}
	if _, upload := job.GetMetadata()[NativeUploadJobMarker]; upload {
		return NativeUploadJobOrigin(job)
	}
	return NativeCellJobOrigin(job)
}

func NativeBindingJobKind(job *jobproto.Job) string {
	if _, share := job.GetMetadata()[NativeShareJobMarker]; share {
		return NativeShareJobMarker
	}
	if _, upload := job.GetMetadata()[NativeUploadJobMarker]; upload {
		return NativeUploadJobMarker
	}
	return NativeCellShareJob
}

type NativeUploadStepRecord struct {
	Nonce            string `json:"nonce"`
	NativePath       string `json:"nativePath"`
	UploadID         string `json:"uploadId"`
	Length           int64  `json:"length"`
	ETag             string `json:"eTag,omitempty"`
	CompletionDigest string `json:"completionDigest,omitempty"`
}

func NativeUploadPartsDigest(parts map[string]string) string {
	encoded, _ := json.Marshal(parts)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func NativeUploadRecordedStep(task *jobproto.Task, step string) (*NativeUploadStepRecord, error) {
	var found *NativeUploadStepRecord
	for _, log := range task.GetActionsLogs() {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeUploadStep] != step {
				continue
			}
			var value NativeUploadStepRecord
			if found != nil || log.GetAction().GetID() != NativeVersionActionID || json.Unmarshal(output.JsonBody, &value) != nil ||
				!auth.NativeActorUUID(value.Nonce) || value.NativePath == "" || value.Length < 0 {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			found = &value
		}
	}
	return found, nil
}

// Original native Task metadata: no file bytes, bearer, or duplicate execution
// ledger. The first dispatch freezes the exact Core-confirmed generation.
type NativeUploadIntent struct {
	BindingID    string                 `json:"bindingId"`
	Generation   int64                  `json:"generation"`
	NativeUserID string                 `json:"nativeUserId"`
	Scope        map[string]interface{} `json:"scope"`
	Input        map[string]interface{} `json:"input"`
}

func NewNativeUploadTask(binding string, generation int64, job, key, owner, nativeUser string,
	claims, input map[string]interface{}) (*jobproto.Task, error) {
	if _, valid := auth.NativeUploadInput(input); !valid || !auth.NativeActorUUID(binding) || generation <= 0 ||
		!auth.NativeActorUUID(nativeUser) || !auth.NativeActorUUID(key) || claims["idempotency_key"] != key ||
		!auth.NativeActorUUID(claimString(claims, "external_execution_id")) || claims["actor_principal_id"] != claims["initiating_human_principal_id"] ||
		claims["agent_principal_id"] != nil || job == "" || owner == "" {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	scope := nativeWriteScope(claims)
	scope["external_execution_id"], scope["idempotency_key"] = claims["external_execution_id"], claims["idempotency_key"]
	intent := NativeUploadIntent{BindingID: binding, Generation: generation, NativeUserID: nativeUser, Scope: scope, Input: input}
	encoded, err := json.Marshal(intent)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	marker, err := json.Marshal(map[string]interface{}{"requestDigest": hex.EncodeToString(digest[:]), "uploadIntent": intent})
	if err != nil {
		return nil, err
	}
	return &jobproto.Task{ID: key, JobID: job, TriggerOwner: owner, Status: jobproto.TaskStatus_Queued,
		ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{
			{JsonBody: marker, Vars: map[string]string{TaskCreateOnly: "true"}}}}}}}, nil
}

func claimString(value map[string]interface{}, key string) string {
	text, _ := value[key].(string)
	return text
}

func NativeUploadTaskIntent(task *jobproto.Task) (*NativeUploadIntent, error) {
	refused := errors.WithStack(errors.StatusConflict)
	if !TaskHasClaim(task) {
		return nil, refused
	}
	var marker struct {
		RequestDigest string             `json:"requestDigest"`
		Intent        NativeUploadIntent `json:"uploadIntent"`
	}
	if json.Unmarshal(task.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody, &marker) != nil {
		return nil, refused
	}
	if _, valid := auth.NativeUploadInput(marker.Intent.Input); !valid || marker.Intent.Generation <= 0 ||
		!auth.NativeActorUUID(marker.Intent.BindingID) || !auth.NativeActorUUID(marker.Intent.NativeUserID) ||
		marker.Intent.Scope["idempotency_key"] != task.ID || !auth.NativeActorUUID(claimString(marker.Intent.Scope, "external_execution_id")) {
		return nil, refused
	}
	encoded, err := json.Marshal(marker.Intent)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	if marker.RequestDigest != hex.EncodeToString(digest[:]) {
		return nil, refused
	}
	return &marker.Intent, nil
}

func NativeUploadTaskMatches(task *jobproto.Task, binding, nativeUser, external, key string, claims map[string]interface{}) bool {
	intent, err := NativeUploadTaskIntent(task)
	if err != nil || intent.BindingID != binding || intent.NativeUserID != nativeUser {
		return false
	}
	expected := nativeWriteScope(claims)
	expected["external_execution_id"], expected["idempotency_key"] = external, key
	left, le := json.Marshal(expected)
	right, re := json.Marshal(intent.Scope)
	return le == nil && re == nil && string(left) == string(right)
}

// Only a never-started, unexpired task has a live first-byte waiter. Started or
// timed-out tasks do not imply a worker still exists after the HTTP request.
func NativeUploadWaiting(task *jobproto.Task) bool {
	intent, err := NativeUploadTaskIntent(task)
	return err == nil && task.Status == jobproto.TaskStatus_Queued && task.StartTime == 0 &&
		task.EndTime == 0 && len(task.ActionsLogs) == 1 && intent.Input["nativeDeadline"].(float64) > float64(time.Now().Unix())
}

// The exact native Version and native metadata ACK must coexist in the
// original finished task. Neither an S3 status nor a draft alone is terminal.
func NativeUploadRevision(task *jobproto.Task) (*tree.ContentRevision, map[string]interface{}, error) {
	refused := errors.WithStack(errors.StatusConflict)
	intent, err := NativeUploadTaskIntent(task)
	if err != nil || task.Status != jobproto.TaskStatus_Finished || task.EndTime <= 0 {
		return nil, nil, refused
	}
	publication, err := NativeUploadPublicationFromTask(task)
	if err != nil || publication == nil {
		return nil, nil, refused
	}
	var revision *tree.ContentRevision
	var content map[string]interface{}
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeUploadContent] == "true" {
				var value map[string]interface{}
				if content != nil || !output.Success || json.Unmarshal(output.JsonBody, &value) != nil || len(value) != 5 ||
					value["resourceId"] != intent.Input["resourceId"] || value["nativeObjectRef"] != intent.Input["nativeNodeId"] ||
					claimString(value, "displayName") == "" || path.Base(claimString(value, "displayName")) != value["displayName"] ||
					strings.TrimSpace(claimString(value, "mediaType")) == "" {
					return nil, nil, refused
				}
				content = value
			}
			if output.GetVars()[NativeVersionResult] != "true" {
				continue
			}
			relation, _ := json.Marshal([]string{task.ID, NativeVersionActionID, claimString(intent.Input, "nativeNodeId")})
			digest := sha256.Sum256(relation)
			value := new(tree.ContentRevision)
			if log.GetAction().GetID() != NativeVersionActionID || !output.Success || protojson.Unmarshal(output.JsonBody, value) != nil ||
				value.VersionId != hex.EncodeToString(digest[:]) || value.Draft || value.OwnerUuid != intent.NativeUserID ||
				value.Size != int64(intent.Input["contentLength"].(float64)) || value.Location == nil || value.ETag == "" ||
				(revision != nil && !proto.Equal(revision, value)) {
				return nil, nil, refused
			}
			revision = value
		}
	}
	if revision == nil || content == nil || content["nativeRevision"] != revision.VersionId ||
		content["displayName"] != path.Base(publication.Node.Path) || content["mediaType"] != publication.Node.GetStringMeta(common.MetaNamespaceMime) ||
		!NativeUploadPublishedVersionMatches(revision, publication.Version) {
		return nil, nil, refused
	}
	return revision, content, nil
}

// An append-only original Task output claims one byte step. Every attempted
// writer supplies a new nonce; a lost PutTask ACK never authorizes replay. Both
// native stores enforce preservation of this exact output under their write
// transaction/CAS, so concurrent identical steps cannot both acquire ownership.
func ClaimNativeUploadStep(task *jobproto.Task, step, nonce, nativePath, uploadID string, length int64, etag ...string) (*jobproto.ActionOutput, error) {
	intent, err := NativeUploadTaskIntent(task)
	if err != nil {
		return nil, err
	}
	validStep := step == "put" || step == "create" || step == "created" || step == "complete"
	for _, prefix := range []string{"part/", "stored/"} {
		if strings.HasPrefix(step, prefix) {
			part, err := strconv.Atoi(strings.TrimPrefix(step, prefix))
			validStep = err == nil && part > 0 && strconv.Itoa(part) == strings.TrimPrefix(step, prefix)
		}
	}
	if !auth.NativeActorUUID(nonce) || nativePath == "" || length < 0 || !validStep ||
		intent.Input["nativeDeadline"].(float64) <= float64(time.Now().Unix()) ||
		(task.Status != jobproto.TaskStatus_Queued && task.Status != jobproto.TaskStatus_Running) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	refused := errors.WithStack(errors.StatusConflict)
	if len(etag) > 2 {
		return nil, refused
	}
	tag, completionDigest := "", ""
	if len(etag) > 0 {
		tag = etag[0]
	}
	if len(etag) > 1 {
		completionDigest = etag[1]
	}
	if strings.HasPrefix(step, "stored/") != (tag != "") {
		return nil, refused
	}
	if (step == "complete") != (completionDigest != "") {
		return nil, refused
	}
	if step == "put" || step == "create" {
		if len(task.ActionsLogs) != 1 || uploadID != "" || intent.Input["multipart"] != (step == "create") ||
			(step == "put" && length != int64(intent.Input["contentLength"].(float64))) {
			return nil, refused
		}
	} else {
		created, er := NativeUploadRecordedStep(task, "create")
		if er != nil || created == nil || created.NativePath != nativePath || intent.Input["multipart"] != true {
			return nil, refused
		}
		if step == "created" {
			if uploadID == "" || length != 0 {
				return nil, refused
			}
		} else {
			ack, er := NativeUploadRecordedStep(task, "created")
			if er != nil || ack == nil || ack.UploadID != uploadID || ack.NativePath != nativePath {
				return nil, refused
			}
			completed, er := NativeUploadRecordedStep(task, "complete")
			if er != nil || completed != nil {
				return nil, refused
			}
			if strings.HasPrefix(step, "stored/") {
				prior, er := NativeUploadRecordedStep(task, "part/"+strings.TrimPrefix(step, "stored/"))
				if er != nil || prior == nil || prior.UploadID != uploadID || prior.NativePath != nativePath || prior.Length != length {
					return nil, refused
				}
			}
			var total int64
			parts := map[string]string{}
			for _, entry := range task.ActionsLogs {
				for _, prior := range entry.GetOutputMessage().GetOutputChain() {
					partStep := prior.GetVars()[NativeUploadStep]
					if !strings.HasPrefix(partStep, "part/") {
						continue
					}
					part, er := NativeUploadRecordedStep(task, partStep)
					if er != nil || part == nil || part.UploadID != uploadID || part.NativePath != nativePath {
						return nil, refused
					}
					if part.Length > int64(intent.Input["contentLength"].(float64))-total {
						return nil, refused
					}
					total += part.Length
					if step == "complete" {
						stored, er := NativeUploadRecordedStep(task, "stored/"+strings.TrimPrefix(partStep, "part/"))
						if er != nil || stored == nil || stored.ETag == "" || stored.Length != part.Length {
							return nil, refused
						}
						parts[strings.TrimPrefix(partStep, "part/")] = stored.ETag
					}
				}
			}
			if strings.HasPrefix(step, "part/") && length > int64(intent.Input["contentLength"].(float64))-total {
				return nil, refused
			}
			if step == "complete" && (total != int64(intent.Input["contentLength"].(float64)) || length != total ||
				completionDigest != NativeUploadPartsDigest(parts)) {
				return nil, refused
			}
		}
	}
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeUploadStep] == step {
				return nil, errors.WithStack(errors.StatusConflict)
			}
		}
	}
	body, err := json.Marshal(NativeUploadStepRecord{Nonce: nonce, NativePath: nativePath, UploadID: uploadID, Length: length, ETag: tag, CompletionDigest: completionDigest})
	if err != nil {
		return nil, err
	}
	output := &jobproto.ActionOutput{JsonBody: body, Vars: map[string]string{NativeUploadStep: step}}
	task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: NativeVersionActionID},
		OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{output}}})
	task.Status = jobproto.TaskStatus_Running
	if task.StartTime == 0 {
		task.StartTime = int32(time.Now().Unix())
	}
	return output, nil
}

// Merge exactly one fresh step under the original DAO writer transaction.
// Unrelated concurrently completed parts are retained; a repeated step is
// refused even when its caller did not receive the original ACK.
func MergeNativeUploadStep(stored, request *jobproto.Task, step string) (*jobproto.Task, error) {
	refused := errors.WithStack(errors.StatusConflict)
	if stored == nil || request == nil || stored.ID != request.ID || stored.JobID != request.JobID ||
		stored.TriggerOwner != request.TriggerOwner || len(stored.ActionsLogs) == 0 || len(request.ActionsLogs) < 2 ||
		!proto.Equal(stored.ActionsLogs[0], request.ActionsLogs[0]) {
		return nil, refused
	}
	entry := request.ActionsLogs[len(request.ActionsLogs)-1]
	if entry.GetAction().GetID() != NativeVersionActionID || len(entry.GetOutputMessage().GetOutputChain()) != 1 {
		return nil, refused
	}
	output := entry.OutputMessage.OutputChain[0]
	if output.GetVars()[NativeUploadStep] != step || len(output.Vars) != 1 || output.Success {
		return nil, refused
	}
	var body NativeUploadStepRecord
	if json.Unmarshal(output.JsonBody, &body) != nil {
		return nil, refused
	}
	merged := proto.Clone(stored).(*jobproto.Task)
	actual, err := ClaimNativeUploadStep(merged, step, body.Nonce, body.NativePath, body.UploadID, body.Length, body.ETag, body.CompletionDigest)
	if err != nil {
		return nil, err
	}
	if !proto.Equal(actual, output) {
		return nil, refused
	}
	return merged, nil
}
