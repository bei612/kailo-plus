package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
)

func NativeUploadJobID(base, binding string, generation int64) string {
	identity, _ := json.Marshal([]interface{}{base, binding, generation})
	digest := sha256.Sum256(identity)
	return hex.EncodeToString(digest[:])
}

// NativeUploadInput consumes the registered FILE_STORAGE write input. These
// references describe a reserved native intent, never an existing revision.
func NativeUploadInput(value interface{}) (map[string]interface{}, bool) {
	input, ok := value.(map[string]interface{})
	if !ok || len(input) != 6 {
		return nil, false
	}
	for _, key := range []string{"resourceId", "nativeIntentId", "nativeNodeId"} {
		if !NativeActorUUID(text(input, key)) {
			return nil, false
		}
	}
	for _, key := range []string{"nativeDeadline", "contentLength"} {
		n, valid := input[key].(float64)
		if !valid || n < 0 || n > 1<<53-1 || math.Trunc(n) != n {
			return nil, false
		}
	}
	_, multipart := input["multipart"].(bool)
	return input, multipart && input["nativeDeadline"].(float64) > 0
}

// A request-local writer owns this transient credential. The caller persists
// only the original native task/intent references, not this object or its token.
type NativeUploadExecution struct {
	Delivery                                                    NativeWriteDelivery
	ActionExecutionID, ExternalExecutionID, NativeIntentID, Key string
	NativeUserID                                                string
	Generation                                                  int64
	Input, Claims, Target                                       map[string]interface{}
	HumanToken                                                  string
	Token, Arguments                                            string
	Step, UploadID                                              string
	PartNumber                                                  int
}

type nativeUploadContextKey struct{}

func NativeUploadFromContext(ctx context.Context) *NativeUploadExecution {
	u, _ := ctx.Value(nativeUploadContextKey{}).(*NativeUploadExecution)
	return u
}

// The S3 signature and native HUMAN session have already been verified. Browser
// references select an existing execution; they never carry a platform token
// or choose actor/scope/generation. Every byte-bearing request obtains its own
// fresh same-execution ticket before reaching the original object router.
func PrepareNativeHumanUpload(request *http.Request) error {
	refused := errors.WithStack(errors.StatusForbidden)
	var d NativeWriteDelivery
	if config.Get(request.Context(), "services", common.ServiceRestNamespace_+"n", "platform").Scan(&d) != nil ||
		d.DraftUploads == nil || d.Write.NativeJobID == "" || d.MaxResponseBytes <= 0 {
		return refused
	}
	refs := make([]string, 4)
	for i, header := range []string{"X-Kailo-Action-Execution", "X-Kailo-External-Execution", "X-Kailo-Native-Upload", "Idempotency-Key"} {
		values := request.Header.Values(header)
		if len(values) != 1 || !NativeActorUUID(values[0]) {
			return refused
		}
		refs[i] = values[0]
	}
	if request.Header.Get("X-Amz-Copy-Source") != "" {
		return refused
	}
	query := request.URL.Query()
	for key, values := range query {
		if strings.HasPrefix(strings.ToLower(key), "x-amz-") {
			continue
		}
		if len(values) != 1 || (key != "uploads" && key != "uploadId" && key != "partNumber") {
			return refused
		}
	}
	step, uploadID, part := "", query.Get("uploadId"), 0
	_, create := query["uploads"]
	_, hasUpload := query["uploadId"]
	_, hasPart := query["partNumber"]
	switch {
	case request.Method == http.MethodPut && !create && !hasUpload && !hasPart:
		step = "put"
	case request.Method == http.MethodPost && create && !hasUpload && !hasPart && query.Get("uploads") == "":
		step = "create"
	case request.Method == http.MethodPut && !create && hasUpload && hasPart && uploadID != "":
		var err error
		part, err = strconv.Atoi(query.Get("partNumber"))
		if err != nil || part <= 0 || strconv.Itoa(part) != query.Get("partNumber") {
			return refused
		}
		step = "part/" + strconv.Itoa(part)
	case request.Method == http.MethodPost && !create && hasUpload && !hasPart && uploadID != "":
		step = "complete"
	default:
		return refused
	}
	human, err := NativeHumanToken(request)
	if err != nil {
		return refused
	}
	current, ok := claim.FromContext(request.Context())
	if !ok {
		return refused
	}
	u := &NativeUploadExecution{Delivery: d, ActionExecutionID: refs[0], ExternalExecutionID: refs[1],
		NativeIntentID: refs[2], Key: refs[3], NativeUserID: current.Subject, HumanToken: human,
		Step: step, UploadID: uploadID, PartNumber: part}
	if err := u.Fresh(request.Context()); err != nil {
		return err
	}
	if u.Input["multipart"] != (step != "put") {
		return refused
	}
	*request = *request.WithContext(context.WithValue(request.Context(), nativeUploadContextKey{}, u))
	return nil
}

func (u *NativeUploadExecution) Fresh(ctx context.Context) error {
	refused := errors.WithStack(errors.StatusForbidden)
	if u == nil || !NativeActorUUID(u.ActionExecutionID) || !NativeActorUUID(u.ExternalExecutionID) ||
		!NativeActorUUID(u.NativeIntentID) || !NativeActorUUID(u.Key) || u.HumanToken == "" {
		return refused
	}
	answer, found, err := u.Delivery.HumanAction(ctx, u.HumanToken, map[string]interface{}{"nativeExecutionAdmission": map[string]interface{}{
		"actionExecutionId": u.ActionExecutionID, "externalExecutionId": u.ExternalExecutionID, "nativeIntentId": u.NativeIntentID}})
	admission, ok := answer["nativeExecutionAdmission"].(map[string]interface{})
	if err != nil || !found || !ok || len(admission) != 3 {
		return refused
	}
	token, arguments := text(admission, "actionToken"), text(admission, "argumentsJson")
	expires, expiryError := time.Parse(time.RFC3339Nano, text(admission, "expiresAt"))
	if expiryError != nil || !expires.After(time.Now()) {
		return refused
	}
	claims, target, generation, err := u.Delivery.AuthorizeNativeWriter(ctx, token, arguments)
	current, hasUser := claim.FromContext(ctx)
	nativeUser, userErr := u.Delivery.User(text(claims, "tenant_id"), text(claims, "actor_principal_id"), "HUMAN")
	var args map[string]interface{}
	if err != nil || !hasUser || userErr != nil || nativeUser != current.Subject || nativeUser != u.NativeUserID ||
		json.Unmarshal([]byte(arguments), &args) != nil || len(args) != 2 {
		return refused
	}
	input, valid := NativeUploadInput(args["input"])
	if !valid || input["nativeIntentId"] != u.NativeIntentID || input["nativeDeadline"].(float64) <= float64(time.Now().Unix()) ||
		expires.After(time.Unix(int64(input["nativeDeadline"].(float64)), 0)) ||
		claims["action_execution_id"] != u.ActionExecutionID || claims["external_execution_id"] != u.ExternalExecutionID || claims["idempotency_key"] != u.Key ||
		claims["actor_principal_id"] != claims["initiating_human_principal_id"] || claims["agent_principal_id"] != nil ||
		claims["action_key"] != "file_storage.write@v2" || claims["target_id"] != input["resourceId"] ||
		claims["action_definition_version"] != float64(u.Delivery.Write.ActionVersion) ||
		claims["result_exposure_policy_id"] != u.Delivery.Write.ResultExposurePolicyID ||
		claims["result_exposure_policy_version"] != float64(u.Delivery.Write.ResultExposurePolicyVersion) ||
		target["nativeRef"] != u.Delivery.NativeRootRef || target["nativeInstanceRef"] != u.Delivery.NativeInstanceRef || target["nativeScopeRef"] != u.Delivery.NativeScopeRef ||
		(u.Generation != 0 && u.Generation != generation) {
		return refused
	}
	if u.Input != nil {
		before, _ := json.Marshal(u.Input)
		after, _ := json.Marshal(input)
		if string(before) != string(after) {
			return refused
		}
	}
	if u.Target != nil {
		before, _ := json.Marshal(u.Target)
		after, _ := json.Marshal(target)
		if string(before) != string(after) {
			return refused
		}
	}
	u.Input, u.Claims, u.Target, u.Generation = input, claims, target, generation
	u.Token, u.Arguments = token, arguments
	return nil
}
