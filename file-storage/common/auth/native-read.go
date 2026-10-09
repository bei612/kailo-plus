package auth

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
)

// Read receipts belong to the original Job/Task store. No job is created from
// a browser request, and a missing controlled job never means zero usage.
type NativeReadDelivery struct {
	NativeJobID       string                  `json:"nativeJobId"`
	UsageMeasurements []NativeReadMeasurement `json:"usageMeasurements"`
}

type NativeReadMeasurement struct {
	MeterKey       string `json:"meterKey"`
	QuantitySource string `json:"quantitySource"`
}

type NativeReadExecution struct {
	Delivery            NativeActorDelivery
	Claims              map[string]interface{}
	Target              map[string]interface{}
	Input               map[string]interface{}
	Key                 string
	ExternalExecutionID string
	Token               string
	Args                string
}

type nativeReadContextKey struct{}

func NativeReadFromContext(ctx context.Context) *NativeReadExecution {
	read, _ := ctx.Value(nativeReadContextKey{}).(*NativeReadExecution)
	return read
}

// NativeReadAuthority runs only after the original native JWT authentication.
// REST observation uses the instance's service identity. The presigned GET
// instead carries the original mapped user's JWT; the two are not interchangeable.
func NativeReadAuthority(request *http.Request, raw, operation string, service bool) (*NativeReadExecution, error) {
	refused := errors.WithStack(errors.StatusForbidden)
	var delivery NativeActorDelivery
	ctx := request.Context()
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil ||
		delivery.Read == nil || delivery.Read.NativeJobID == "" || strings.TrimSpace(delivery.Read.NativeJobID) != delivery.Read.NativeJobID ||
		delivery.MaxResponseBytes <= 0 || int64(len(raw)) > delivery.MaxResponseBytes {
		return nil, refused
	}
	meters := map[string]bool{}
	if delivery.Read.UsageMeasurements == nil {
		return nil, refused
	}
	for _, meter := range delivery.Read.UsageMeasurements {
		if meter.MeterKey == "" || meters[meter.MeterKey] || (meter.QuantitySource != "COUNT" && meter.QuantitySource != "CONTENT_BYTES") {
			return nil, refused
		}
		meters[meter.MeterKey] = true
	}
	transport, ok := claim.FromContext(ctx)
	if !ok {
		return nil, refused
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	var proof struct {
		ActionToken   string `json:"actionToken"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&proof) != nil || decoder.Decode(new(interface{})) != io.EOF {
		return nil, refused
	}
	claims, target, err := delivery.AuthorizeOperation(ctx, proof.ActionToken, proof.ArgumentsJSON, operation)
	revisions := claims["action_key"] == "file_storage.list_revisions@v1"
	if err != nil || (!revisions && claims["action_key"] != "file_storage.read@v1" && claims["action_key"] != "file_storage.export@v1") ||
		claims["tenant_id"] != delivery.TenantID || claims["target_type"] != "RESOURCE" {
		return nil, refused
	}
	for _, key := range []string{"actor_principal_id", "initiating_human_principal_id", "operation_id", "action_execution_id", "target_id", "result_exposure_policy_id"} {
		if !NativeActorUUID(text(claims, key)) {
			return nil, refused
		}
	}
	kind := "HUMAN"
	if agent, present := claims["agent_principal_id"]; present {
		kind = "AGENT"
		version, valid := claims["delegation_version"].(float64)
		if agent != claims["actor_principal_id"] || !NativeActorUUID(text(claims, "delegation_id")) || !valid || version <= 0 {
			return nil, refused
		}
	} else if claims["actor_principal_id"] != claims["initiating_human_principal_id"] || claims["delegation_id"] != nil || claims["delegation_version"] != nil {
		return nil, refused
	}
	userID, err := delivery.User(text(claims, "tenant_id"), text(claims, "actor_principal_id"), kind)
	if err != nil || (service && transport.Subject != delivery.InstanceServiceUUID) || (!service && transport.Subject != userID) {
		return nil, refused
	}
	user, err := ResolveNativeUser(ctx, userID)
	if err != nil {
		return nil, refused
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(proof.ArgumentsJSON), &args) != nil {
		return nil, refused
	}
	result := &NativeReadExecution{Delivery: delivery, Claims: claims, Target: target, Token: proof.ActionToken, Args: proof.ArgumentsJSON}
	if operation == "execute" {
		input, inputOK := args["input"].(map[string]interface{})
		argumentTarget, targetOK := args["target"].(map[string]interface{})
		inputSize := 5
		if revisions {
			inputSize = 2
		}
		if len(args) != 2 || !inputOK || len(input) != inputSize || !targetOK || len(argumentTarget) != 1 ||
			argumentTarget["resourceId"] != claims["target_id"] || input["resourceId"] != claims["target_id"] ||
			target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef ||
			!NativeActorUUID(text(input, "nativeObjectRef")) || !NativeActorUUID(text(claims, "external_execution_id")) || !NativeActorUUID(text(claims, "idempotency_key")) {
			return nil, refused
		}
		if !revisions {
			for _, key := range []string{"nativeRevision", "displayName", "mediaType"} {
				if text(input, key) == "" {
					return nil, refused
				}
			}
		}
		keys := request.Header.Values("Idempotency-Key")
		if len(keys) != 1 || keys[0] != claims["idempotency_key"] || (revisions && (!service || request.Method != http.MethodPost)) || (!service && (request.Method != http.MethodGet || request.Header.Get("Range") != "")) {
			return nil, refused
		}
		if !service {
			versions := request.URL.Query()["versionId"]
			if len(versions) != 1 || versions[0] != input["nativeRevision"] {
				return nil, refused
			}
		}
		result.Input, result.Key, result.ExternalExecutionID = input, keys[0], text(claims, "external_execution_id")
	} else {
		if !service || (operation != "observe" && operation != "extract_usage") || (len(args) != 3 && len(args) != 4) ||
			args["nativeType"] != "node" || !NativeActorUUID(text(args, "externalExecutionId")) || !NativeActorUUID(text(args, "idempotencyKey")) {
			return nil, refused
		}
		for key := range args {
			if key != "externalExecutionId" && key != "idempotencyKey" && key != "nativeType" && key != "nativeId" {
				return nil, refused
			}
		}
		if _, present := args["nativeId"]; present && !NativeActorUUID(text(args, "nativeId")) {
			return nil, refused
		}
		result.Input, result.Key, result.ExternalExecutionID = args, text(args, "idempotencyKey"), text(args, "externalExecutionId")
	}
	ctx = WithImpersonate(ctx, user)
	if operation == "execute" && (!service || revisions) {
		ctx = context.WithValue(ctx, nativeReadContextKey{}, result)
	}
	*request = *request.WithContext(ctx)
	return result, nil
}

func (read *NativeReadExecution) Fresh(ctx context.Context, operation string) error {
	claims, target, err := read.Delivery.AuthorizeOperation(ctx, read.Token, read.Args, operation)
	if err != nil || claims["action_execution_id"] != read.Claims["action_execution_id"] || claims["operation_id"] != read.Claims["operation_id"] {
		return errors.WithStack(errors.StatusForbidden)
	}
	if operation == "execute" {
		before, _ := json.Marshal(read.Target)
		after, _ := json.Marshal(target)
		if !bytes.Equal(before, after) {
			return errors.WithStack(errors.StatusForbidden)
		}
	}
	return nil
}
