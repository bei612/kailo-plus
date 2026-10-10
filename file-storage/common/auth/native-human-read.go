package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
)

// Delivered action/release metadata uses the existing binding's read producer.
// It is not a new action registry and cannot authorize an undeclared Core action.
type NativeHumanReadDelivery struct {
	WorkspaceID         string `json:"workspaceId"`
	ReceiptPollInterval string `json:"receiptPollInterval"`
	Actions             map[string]struct {
		ActionVersion               int64  `json:"actionVersion"`
		NativeType                  string `json:"nativeType"`
		ResultExposurePolicyID      string `json:"resultExposurePolicyId"`
		ResultExposurePolicyVersion int64  `json:"resultExposurePolicyVersion"`
	} `json:"actions"`
}

type nativeHumanReadIntent struct {
	delivery                     NativeActorDelivery
	token, key, action, revision string
}
type nativeHumanReadContextKey struct{}
type nativeHumanReadRequiredKey struct{}

// Checked at the actual body consumer, not at S3 bucket/metadata operations.
func NativeHumanReadRequired(ctx context.Context) bool {
	return ctx.Value(nativeHumanReadRequiredKey{}) == true
}

func HasNativeHumanRead(ctx context.Context) bool {
	_, ok := ctx.Value(nativeHumanReadContextKey{}).(*nativeHumanReadIntent)
	return ok
}

// Runs after native authentication, before the original S3 handler. Platform
// requests must supply their one original request key and fixed version; the
// independent native installation retains its original transport unchanged.
func PrepareNativeHumanRead(request *http.Request) error {
	if request.Method != http.MethodGet {
		return nil
	}
	value := config.Get(request.Context(), "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return nil
	}
	*request = *request.WithContext(context.WithValue(request.Context(), nativeHumanReadRequiredKey{}, true))
	if len(request.Header.Values("X-Kailo-Native-Read")) == 0 {
		return nil
	}
	refused := errors.WithStack(errors.StatusForbidden)
	var d NativeActorDelivery
	keys, actions, versions := request.Header.Values("Idempotency-Key"), request.Header.Values("X-Kailo-Native-Read"), request.URL.Query()["versionId"]
	if value.Scan(&d) != nil || d.Read == nil || d.Read.Human == nil || d.MaxResponseBytes <= 0 ||
		len(keys) != 1 || !NativeActorUUID(keys[0]) || len(actions) != 1 || len(versions) != 1 || versions[0] == "" ||
		request.Header.Get("Range") != "" || (actions[0] != "file_storage.read@v1" && actions[0] != "file_storage.export@v1") {
		return refused
	}
	a, ok := d.Read.Human.Actions[actions[0]]
	interval, intervalErr := time.ParseDuration(d.Read.Human.ReceiptPollInterval)
	timeout, timeoutErr := time.ParseDuration(d.RequestTimeout)
	if !ok || a.ActionVersion <= 0 || a.NativeType == "" || !NativeActorUUID(a.ResultExposurePolicyID) ||
		intervalErr != nil || timeoutErr != nil || interval <= 0 || interval >= timeout ||
		a.ResultExposurePolicyVersion <= 0 || d.Read.UsageMeasurements == nil ||
		(d.Read.Human.WorkspaceID != "" && !NativeActorUUID(d.Read.Human.WorkspaceID)) {
		return refused
	}
	meters := map[string]bool{}
	for _, m := range d.Read.UsageMeasurements {
		if m.MeterKey == "" || meters[m.MeterKey] || (m.QuantitySource != "COUNT" && m.QuantitySource != "CONTENT_BYTES") {
			return refused
		}
		meters[m.MeterKey] = true
	}
	token, err := NativeHumanToken(request)
	if err != nil {
		return refused
	}
	intent := &nativeHumanReadIntent{delivery: d, token: token, key: keys[0], action: actions[0], revision: versions[0]}
	*request = *request.WithContext(context.WithValue(request.Context(), nativeHumanReadContextKey{}, intent))
	return nil
}

// Admit only after the original native path/UUID/version/ACL metadata lookup.
// The signed ticket stays backend-only and is never reusable browser output.
func AdmitNativeHumanRead(ctx context.Context, node, revision, name, media string) (*NativeReadExecution, error) {
	intent, _ := ctx.Value(nativeHumanReadContextKey{}).(*nativeHumanReadIntent)
	if intent == nil {
		return nil, nil
	}
	refused := errors.WithStack(errors.StatusForbidden)
	d := intent.delivery
	if !NativeActorUUID(node) || revision != intent.revision || name == "" || media == "" || strings.TrimSpace(revision) != revision {
		return nil, refused
	}
	a := d.Read.Human.Actions[intent.action]
	selector := map[string]interface{}{"actionKey": intent.action, "actionVersion": a.ActionVersion, "nativeType": a.NativeType, "nativeRef": d.NativeRootRef}
	if d.Read.Human.WorkspaceID != "" {
		selector["workspaceId"] = d.Read.Human.WorkspaceID
	}
	resolved, found, err := d.HumanAction(ctx, intent.token, map[string]interface{}{"resolveResource": selector})
	resource, resourceOK := resolved["resource"].(map[string]interface{})
	if err != nil || !found || !resourceOK || len(resource) != 6 || resource["nativeInstanceRef"] != d.NativeInstanceRef || resource["nativeScopeRef"] != d.NativeScopeRef || resource["nativeRef"] != d.NativeRootRef {
		return nil, refused
	}
	input := map[string]interface{}{"resourceId": resource["resourceId"], "nativeObjectRef": node, "nativeRevision": revision, "displayName": name, "mediaType": media}
	command := map[string]interface{}{"actionKey": intent.action, "idempotencyKey": intent.key, "resourceId": resource["resourceId"], "resourceVersion": resource["resourceVersion"],
		"componentAction": map[string]interface{}{"actionVersion": a.ActionVersion, "inputReference": input, "resultExposurePolicyId": a.ResultExposurePolicyID, "resultExposurePolicyVersion": a.ResultExposurePolicyVersion}}
	if d.Read.Human.WorkspaceID != "" {
		command["workspaceId"] = d.Read.Human.WorkspaceID
	}
	answer, found, err := d.HumanAction(ctx, intent.token, map[string]interface{}{"command": command})
	admission, _ := answer["readAdmission"].(map[string]interface{})
	if err != nil || !found || len(admission) != 3 {
		return nil, refused
	}
	token, args := text(admission, "actionToken"), text(admission, "argumentsJson")
	claims, target, err := d.AuthorizeOperation(ctx, token, args, "execute")
	current, ok := claim.FromContext(ctx)
	user, userErr := d.User(text(claims, "tenant_id"), text(claims, "actor_principal_id"), "HUMAN")
	var parsed map[string]interface{}
	expected, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource["resourceId"]}, "input": input})
	parseErr := json.Unmarshal([]byte(args), &parsed)
	actual, _ := json.Marshal(parsed)
	if err != nil || !ok || userErr != nil || user != current.Subject || parseErr != nil || string(actual) != string(expected) ||
		claims["actor_principal_id"] != claims["initiating_human_principal_id"] || claims["agent_principal_id"] != nil || claims["external_execution_id"] != nil ||
		claims["idempotency_key"] != intent.key || claims["action_key"] != intent.action || claims["target_id"] != resource["resourceId"] ||
		target["nativeRef"] != d.NativeRootRef || target["nativeInstanceRef"] != d.NativeInstanceRef || target["nativeScopeRef"] != d.NativeScopeRef {
		return nil, refused
	}
	return &NativeReadExecution{Delivery: d, Claims: claims, Target: target, Input: input, Key: intent.key, Token: token, Args: args, humanToken: intent.token}, nil
}

func (read *NativeReadExecution) IsHumanSynchronous() bool {
	return read.humanToken != "" && read.ExternalExecutionID == ""
}

// .design/03 §8 and worker/activities/component_conformance.go use the same
// sorted UTF-8 JSON digest as Core limits::canonical_digest. Normalize structs
// through JSON data while retaining integer precision, including usage counts.
func humanReadReceiptDigest(receipt map[string]interface{}) (string, error) {
	body, err := json.Marshal(receipt)
	if err != nil {
		return "", err
	}
	var value interface{}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return "", err
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	// Match the existing Go conformance consumer: consume whole escapes so
	// literal backslash-u text is not mistaken for a Unicode line separator.
	raw := bytes.TrimSuffix(encoded.Bytes(), []byte("\n"))
	canonical := make([]byte, 0, len(raw))
	for index := 0; index < len(raw); index++ {
		if raw[index] == '\\' && index+1 < len(raw) {
			if index+5 < len(raw) && (string(raw[index:index+6]) == `\u2028` || string(raw[index:index+6]) == `\u2029`) {
				if raw[index+5] == '8' {
					canonical = append(canonical, "\u2028"...)
				} else {
					canonical = append(canonical, "\u2029"...)
				}
				index += 5
				continue
			}
			canonical = append(canonical, raw[index], raw[index+1])
			index++
			continue
		}
		canonical = append(canonical, raw[index])
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func (read *NativeReadExecution) CompleteHumanRead(ctx context.Context, receipt map[string]interface{}) error {
	refused := errors.WithStack(errors.StatusForbidden)
	if !read.IsHumanSynchronous() || read.Delivery.Read == nil || read.Delivery.Read.Human == nil {
		return refused
	}
	interval, err := time.ParseDuration(read.Delivery.Read.Human.ReceiptPollInterval)
	if err != nil {
		return refused
	}
	digest, err := humanReadReceiptDigest(receipt)
	if err != nil {
		return refused
	}
	answer, err := read.Delivery.NativeReadReceipt(ctx, receipt, interval)
	if err != nil || len(answer) != 2 || answer["operationId"] != read.Claims["operation_id"] || answer["receiptDigest"] != digest {
		return refused
	}
	// Recheck HUMAN membership/binding/resource after durable usage settlement.
	// This is metadata observation, never a second file read or ticket issuance.
	observed, found, err := read.Delivery.HumanAction(ctx, read.humanToken, map[string]interface{}{"idempotencyKey": read.Key})
	if err != nil || !found || observed["terminalStatus"] != "COMPLETED" || observed["readAdmission"] != nil {
		return refused
	}
	actual, _ := json.Marshal(observed["inputReference"])
	expected, _ := json.Marshal(read.Input)
	if string(actual) != string(expected) {
		return refused
	}
	return nil
}
