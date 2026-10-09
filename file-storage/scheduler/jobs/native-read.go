package jobs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
)

const NativeReadResult = "nativeReadResult"

type NativeReadReceipt struct {
	NativeObjectRef  string                  `json:"nativeObjectRef"`
	ContentBytes     int64                   `json:"contentBytes"`
	ContentSHA256    string                  `json:"contentSha256"`
	CompletedAt      string                  `json:"completedAt"`
	ContentReference map[string]interface{}  `json:"contentReference,omitempty"`
	Measurements     []NativeReadMeasurement `json:"measurements"`
}

type NativeReadMeasurement struct {
	MeterKey string `json:"meterKey"`
	Quantity int64  `json:"quantity"`
}

func nativeReadMeasurements(mapping []auth.NativeReadMeasurement, bytes int64) []NativeReadMeasurement {
	values := make([]NativeReadMeasurement, 0, len(mapping))
	for _, meter := range mapping {
		quantity := int64(1)
		if meter.QuantitySource == "CONTENT_BYTES" {
			quantity = bytes
		}
		values = append(values, NativeReadMeasurement{MeterKey: meter.MeterKey, Quantity: quantity})
	}
	return values
}

func NewNativeReadTask(read *auth.NativeReadExecution, owner, user string) (*jobproto.Task, error) {
	input := make(map[string]interface{}, len(read.Input)+1)
	for key, value := range read.Input {
		input[key] = value
	}
	input["externalExecutionId"] = read.ExternalExecutionID
	input["usageMeasurements"] = read.Delivery.Read.UsageMeasurements
	return NewNativeWriteTask(read.Delivery.BindingID, read.Delivery.Read.NativeJobID, read.Key, owner, user, read.Claims, input)
}

func NativeReadTaskMatches(task *jobproto.Task, read *auth.NativeReadExecution, user string) bool {
	if !NativeWriteTaskMatches(task, read.Delivery.BindingID, user, read.Claims) || task.GetID() != read.Key || task.GetJobID() != read.Delivery.Read.NativeJobID {
		return false
	}
	intent, err := NativeWriteTaskIntent(task)
	inputSize := 7
	if read.Claims["action_key"] == "file_storage.list_revisions@v1" || read.Claims["action_key"] == "file_storage.list@v1" {
		inputSize = 4
	}
	if err != nil || len(intent.InputReference) != inputSize {
		return false
	}
	return intent.InputReference["externalExecutionId"] == read.ExternalExecutionID
}

// Consume the retained original Task, not current node size or another GET.
func NativeReadTaskReceipt(task *jobproto.Task) (*NativeReadReceipt, error) {
	refused := errors.WithStack(errors.StatusConflict)
	intent, err := NativeWriteTaskIntent(task)
	if err != nil {
		return nil, refused
	}
	enumeration := intent.Scope["action_key"] == "file_storage.list_revisions@v1" || intent.Scope["action_key"] == "file_storage.list@v1"
	inputSize := 7
	if enumeration {
		inputSize = 4
	}
	if (!enumeration && intent.Scope["action_key"] != "file_storage.read@v1" && intent.Scope["action_key"] != "file_storage.export@v1") ||
		task.GetStatus() != jobproto.TaskStatus_Finished || task.GetEndTime() <= 0 || len(intent.InputReference) != inputSize {
		return nil, refused
	}
	encoded, encodeErr := json.Marshal(intent.InputReference["usageMeasurements"])
	var mapping []auth.NativeReadMeasurement
	if encodeErr != nil || json.Unmarshal(encoded, &mapping) != nil || mapping == nil {
		return nil, refused
	}
	meters := map[string]bool{}
	for _, meter := range mapping {
		if meter.MeterKey == "" || meters[meter.MeterKey] || (meter.QuantitySource != "COUNT" && meter.QuantitySource != "CONTENT_BYTES") {
			return nil, refused
		}
		meters[meter.MeterKey] = true
	}
	var receipt *NativeReadReceipt
	for _, action := range task.GetActionsLogs() {
		for _, result := range action.GetOutputMessage().GetOutputChain() {
			if result.GetVars()[NativeReadResult] != "true" {
				continue
			}
			var value NativeReadReceipt
			decoder := json.NewDecoder(strings.NewReader(string(result.JsonBody)))
			decoder.DisallowUnknownFields()
			if !result.Success || decoder.Decode(&value) != nil || decoder.Decode(new(interface{})) != io.EOF {
				return nil, refused
			}
			var numeric struct {
				ContentBytes *int64 `json:"contentBytes"`
				Measurements []struct {
					Quantity *int64 `json:"quantity"`
				} `json:"measurements"`
			}
			if json.Unmarshal(result.JsonBody, &numeric) != nil || numeric.ContentBytes == nil {
				return nil, refused
			}
			for _, meter := range numeric.Measurements {
				if meter.Quantity == nil {
					return nil, refused
				}
			}
			when, timeErr := time.Parse(time.RFC3339Nano, value.CompletedAt)
			_, hashErr := hex.DecodeString(value.ContentSHA256)
			if value.NativeObjectRef != intent.InputReference["nativeObjectRef"] || !auth.NativeActorUUID(value.NativeObjectRef) ||
				value.ContentBytes < 0 || (enumeration && value.ContentBytes == 0) || len(value.ContentSHA256) != sha256.Size*2 || hashErr != nil ||
				timeErr != nil || when.Unix() != int64(task.EndTime) || (enumeration && value.ContentReference != nil) || (!enumeration && len(value.ContentReference) != 5) {
				return nil, refused
			}
			if !enumeration {
				for _, key := range []string{"resourceId", "nativeObjectRef", "nativeRevision", "displayName", "mediaType"} {
					actual, actualOK := value.ContentReference[key].(string)
					expected, expectedOK := intent.InputReference[key].(string)
					if !actualOK || !expectedOK || actual == "" || actual != expected {
						return nil, refused
					}
				}
			}
			expected, _ := json.Marshal(nativeReadMeasurements(mapping, value.ContentBytes))
			actual, _ := json.Marshal(value.Measurements)
			if !bytes.Equal(expected, actual) {
				return nil, refused
			}
			if receipt != nil {
				return nil, refused
			}
			receipt = &value
		}
	}
	if receipt == nil {
		return nil, refused
	}
	return receipt, nil
}

// CopyNativeRead is called by the original GetObject, Lookup and NodeVersions
// consumers after their native UUID/path/version/ACL resolution. Claim ACK loss never grants a
// read. A partial stream or failed close leaves its original Task non-terminal.
func CopyNativeRead(ctx context.Context, read *auth.NativeReadExecution, expectedBytes int64, writer io.Writer, open func() (io.ReadCloser, error)) error {
	current, ok := claim.FromContext(ctx)
	enumeration := read.Claims["action_key"] == "file_storage.list_revisions@v1" || read.Claims["action_key"] == "file_storage.list@v1"
	if !ok || (expectedBytes < 0 && (!enumeration || expectedBytes != -1)) || read.Delivery.Read == nil {
		return errors.WithStack(errors.StatusForbidden)
	}
	client := jobproto.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	job, err := client.GetJob(ctx, &jobproto.GetJobRequest{JobID: read.Delivery.Read.NativeJobID})
	if err != nil || job.GetJob().GetID() != read.Delivery.Read.NativeJobID || job.GetJob().GetInactive() {
		return errors.WithStack(errors.StatusForbidden)
	}
	task, err := NewNativeReadTask(read, current.Name, current.Subject)
	if err != nil {
		return err
	}
	claimed, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: task, StatusMeta: map[string]string{TaskCreateOnly: "true"}})
	if err != nil || !proto.Equal(claimed.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	task.Status, task.StartTime = jobproto.TaskStatus_Running, int32(time.Now().Unix())
	persisted, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(persisted.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	if err := read.Fresh(ctx, "execute"); err != nil {
		return err
	}
	reader, err := open()
	if err != nil {
		return err
	}
	digest := sha256.New()
	copied, copyErr := io.Copy(io.MultiWriter(writer, digest), reader)
	closeErr := reader.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if (expectedBytes >= 0 && copied != expectedBytes) || (enumeration && (copied <= 0 || copied > read.Delivery.MaxResponseBytes)) {
		return errors.WithStack(errors.StatusConflict)
	}
	if err := read.Fresh(ctx, "execute"); err != nil {
		return err
	}
	completed := time.Now().UTC()
	var reference map[string]interface{}
	if !enumeration {
		reference = make(map[string]interface{}, len(read.Input))
		for key, value := range read.Input {
			reference[key] = value
		}
	}
	body, err := json.Marshal(NativeReadReceipt{NativeObjectRef: read.Input["nativeObjectRef"].(string), ContentBytes: copied,
		ContentSHA256: hex.EncodeToString(digest.Sum(nil)), CompletedAt: completed.Format(time.RFC3339Nano), ContentReference: reference,
		Measurements: nativeReadMeasurements(read.Delivery.Read.UsageMeasurements, copied)})
	if err != nil {
		return err
	}
	task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{NativeReadResult: "true"}}}}})
	task.Status, task.EndTime = jobproto.TaskStatus_Finished, int32(completed.Unix())
	persisted, err = client.PutTask(ctx, &jobproto.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(persisted.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	return read.Fresh(ctx, "execute")
}
