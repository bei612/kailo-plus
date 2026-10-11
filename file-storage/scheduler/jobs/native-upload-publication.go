package jobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const NativeUploadPublication = "kailo.native_upload.publication"

// This is an output of the original claimed Task, not another execution or
// ledger. Persist the exact native cleanup set before StoreVersion can delete
// its metadata; a lost response must not erase the only names of those blobs.
type NativeUploadPublicationRecord struct {
	Node          *tree.Node              `json:"node"`
	Draft         *tree.ContentRevision   `json:"draft"`
	Version       *tree.ContentRevision   `json:"version"`
	PruneVersions []*tree.ContentRevision `json:"pruneVersions"`
}

func NativeUploadVersionID(task *jobproto.Task) (string, error) {
	intent, err := NativeUploadTaskIntent(task)
	if err != nil {
		return "", err
	}
	relation, _ := json.Marshal([]string{task.ID, NativeVersionActionID, claimString(intent.Input, "nativeNodeId")})
	digest := sha256.Sum256(relation)
	return hex.EncodeToString(digest[:]), nil
}

func ValidateNativeUploadPublication(task *jobproto.Task, record *NativeUploadPublicationRecord) error {
	refused := errors.WithStack(errors.StatusConflict)
	intent, err := NativeUploadTaskIntent(task)
	if err != nil || record == nil {
		return refused
	}
	versionID, err := NativeUploadVersionID(task)
	if err != nil {
		return err
	}
	step := "put"
	if intent.Input["multipart"] == true {
		step = "complete"
	}
	claimed, err := NativeUploadRecordedStep(task, step)
	if err != nil || claimed == nil || record.Node.GetUuid() != intent.Input["nativeNodeId"] ||
		record.Node.GetPath() != claimed.NativePath || path.Base(record.Node.GetPath()) == "." ||
		record.Node.GetStringMeta(common.MetaNamespaceMime) == "" {
		return refused
	}
	draft, published := record.Draft, record.Version
	if draft.GetVersionId() != intent.Input["nativeIntentId"] || !draft.GetDraft() ||
		draft.GetOwnerUuid() != intent.NativeUserID || draft.GetLocation() == nil || draft.GetETag() == "" ||
		draft.GetSize() != int64(intent.Input["contentLength"].(float64)) ||
		published.GetVersionId() != versionID || published.GetDraft() || published.GetOwnerUuid() != intent.NativeUserID ||
		published.GetLocation() == nil || published.GetSize() != draft.Size || published.GetETag() != draft.ETag {
		return refused
	}
	seen := map[string]bool{}
	for _, revision := range record.PruneVersions {
		if revision.GetVersionId() == "" || revision.VersionId == draft.VersionId || revision.VersionId == published.VersionId ||
			revision.Draft || revision.Location == nil || seen[revision.VersionId] {
			return refused
		}
		seen[revision.VersionId] = true
	}
	return nil
}

func NativeUploadPublicationFromTask(task *jobproto.Task) (*NativeUploadPublicationRecord, error) {
	var record *NativeUploadPublicationRecord
	for _, entry := range task.GetActionsLogs() {
		for _, output := range entry.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeUploadPublication] != "true" {
				continue
			}
			if record != nil || entry.GetAction().GetID() != NativeVersionActionID || output.Success || len(output.Vars) != 1 {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			record = new(NativeUploadPublicationRecord)
			if err := json.Unmarshal(output.JsonBody, record); err != nil {
				return nil, err
			}
			if err := ValidateNativeUploadPublication(task, record); err != nil {
				return nil, err
			}
		}
	}
	return record, nil
}

func AppendNativeUploadPublication(task *jobproto.Task, record *NativeUploadPublicationRecord) error {
	if task.GetStatus() != jobproto.TaskStatus_Running || task.GetEndTime() != 0 {
		return errors.WithStack(errors.StatusConflict)
	}
	if err := ValidateNativeUploadPublication(task, record); err != nil {
		return err
	}
	prior, err := NativeUploadPublicationFromTask(task)
	if err != nil {
		return err
	}
	if prior != nil {
		return errors.WithStack(errors.StatusConflict)
	}
	body, err := json.Marshal(record)
	if err != nil {
		return err
	}
	task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: NativeVersionActionID},
		OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: body, Vars: map[string]string{NativeUploadPublication: "true"}}}}})
	return nil
}

// Call only after the original native version and every frozen cleanup target
// have been independently acknowledged/read back. This only records evidence.
func CompleteNativeUploadPublication(task *jobproto.Task, record *NativeUploadPublicationRecord, now time.Time) error {
	if err := ValidateNativeUploadPublication(task, record); err != nil {
		return err
	}
	stored, err := NativeUploadPublicationFromTask(task)
	if err != nil || stored == nil {
		return errors.WithStack(errors.StatusConflict)
	}
	want, _ := json.Marshal(record)
	actual, _ := json.Marshal(stored)
	if string(want) != string(actual) {
		return errors.WithStack(errors.StatusConflict)
	}
	if task.Status == jobproto.TaskStatus_Finished {
		_, _, err := NativeUploadRevision(task)
		return err
	}
	if task.Status != jobproto.TaskStatus_Running || task.EndTime != 0 {
		return errors.WithStack(errors.StatusConflict)
	}
	intent, _ := NativeUploadTaskIntent(task)
	body, err := protojson.Marshal(record.Version)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]interface{}{"resourceId": intent.Input["resourceId"], "nativeObjectRef": record.Node.Uuid,
		"nativeRevision": record.Version.VersionId, "displayName": path.Base(record.Node.Path), "mediaType": record.Node.GetStringMeta(common.MetaNamespaceMime)})
	if err != nil {
		return err
	}
	// Reject earlier partial/contradictory result records instead of appending a
	// second purported terminal. DAO writes preserve every previous receipt.
	for _, entry := range task.ActionsLogs {
		for _, output := range entry.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeVersionResult] == "true" || output.GetVars()[NativeUploadContent] == "true" {
				return errors.WithStack(errors.StatusConflict)
			}
		}
	}
	task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: NativeVersionActionID},
		OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{
			{Success: true, JsonBody: body, Vars: map[string]string{NativeVersionResult: "true"}},
			{Success: true, JsonBody: content, Vars: map[string]string{NativeUploadContent: "true"}},
		}}})
	task.Status, task.EndTime = jobproto.TaskStatus_Finished, int32(now.Unix())
	task.StatusMessage = ""
	_, _, err = NativeUploadRevision(task)
	return err
}

// HeadVersion adds the current IsHead flag; it is not immutable evidence.
func NativeUploadPublishedVersionMatches(actual, expected *tree.ContentRevision) bool {
	if actual == nil || expected == nil {
		return false
	}
	copy := proto.Clone(actual).(*tree.ContentRevision)
	copy.IsHead = expected.IsHead
	return proto.Equal(copy, expected)
}
