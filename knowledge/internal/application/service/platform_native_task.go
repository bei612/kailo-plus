package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

// SS-WEK-MATERIALIZATION, .design/07 §5 request_native_task_execution_admission:
// a bound HUMAN APPLICATION execute (knowledge.ingest / knowledge.delete)
// creates a durable native task (the parse of the created Knowledge, the
// conditional deletion task) and retains only the original execution
// reference with it. Before the worker consumes that task, the binding SERVICE
// obtains a fresh request-local ticket from Core for exactly that original
// execution and has Core's PEP verify it; the ticket is never persisted, a
// pending reference is observed again until the frozen deadline, and a refusal
// stops the step without fabricating a native result.

const platformNativeTaskMetadataKey = "platform_native_task"

const platformNativeTaskPoll = 2 * time.Second

var errPlatformNativeTaskRefused = errors.New("retained native task execution refused or unavailable")
var errPlatformNativeTaskPending = errors.New("retained native task reference is not yet observed by Core")

type platformNativeDelivery struct {
	bindingID string
	pep       *url.URL
	identity  clientcredentials.Config
	http      *http.Client
	limit     int64
}

func refuseRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

func privatePlatformInput(path string) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, errPlatformNativeTaskRefused
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0007 != 0 {
		return nil, errPlatformNativeTaskRefused
	}
	return os.ReadFile(path)
}

func platformOrigin(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
		u.RawQuery != "" || u.Fragment != "" {
		return nil, errPlatformNativeTaskRefused
	}
	return u, nil
}

// The binding's own controlled adapter delivery, the same one the native MCP
// server uses for pep_check; never a caller-supplied endpoint or credential.
func (s *knowledgeService) platformNativeDelivery(binding string) (*platformNativeDelivery, error) {
	if s.config == nil {
		return nil, errPlatformNativeTaskRefused
	}
	var found *platformNativeDelivery
	for _, path := range s.config.MCPAdapterConfigs {
		raw, err := privatePlatformInput(path)
		var value map[string]json.RawMessage
		if err != nil || json.Unmarshal(raw, &value) != nil || value == nil {
			return nil, errPlatformNativeTaskRefused
		}
		if fileStorageText(value, "bindingId") != binding {
			continue
		}
		pep, pepErr := platformOrigin(fileStorageText(value, "corePepUrl"))
		idp, idpErr := platformOrigin(fileStorageText(value, "oidcTokenUrl"))
		secret, secretErr := privatePlatformInput(fileStorageText(value, "oidcClientSecretFile"))
		credential := strings.TrimSpace(string(secret))
		timeout, limit := fileStorageNumber(value, "timeoutMs"), fileStorageNumber(value, "maxBodyBytes")
		if found != nil || pepErr != nil || idpErr != nil || secretErr != nil || pep.Path != "/service/v1/adapter/pep_check" ||
			credential == "" || strings.ContainsAny(credential, "\r\n") || fileStorageText(value, "oidcClientId") == "" ||
			timeout <= 0 || limit <= 0 {
			return nil, errPlatformNativeTaskRefused
		}
		identity := clientcredentials.Config{ClientID: fileStorageText(value, "oidcClientId"), ClientSecret: credential, TokenURL: idp.String(), AuthStyle: oauth2.AuthStyleInHeader}
		client := &http.Client{Timeout: time.Duration(timeout) * time.Millisecond, CheckRedirect: refuseRedirect}
		found = &platformNativeDelivery{bindingID: binding, pep: pep, identity: identity, http: client, limit: limit}
	}
	if found == nil {
		return nil, errPlatformNativeTaskRefused
	}
	return found, nil
}

func (d *platformNativeDelivery) call(ctx context.Context, route string, value any) (map[string]json.RawMessage, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, errPlatformNativeTaskRefused
	}
	bearer, err := d.identity.Token(context.WithValue(ctx, oauth2.HTTPClient, d.http))
	if err != nil || bearer == nil || !bearer.Valid() {
		return nil, errPlatformNativeTaskRefused
	}
	endpoint := d.pep.ResolveReference(&url.URL{Path: route})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return nil, errPlatformNativeTaskRefused
	}
	request.Header.Set("Authorization", "Bearer "+bearer.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := d.http.Do(request)
	if err != nil {
		return nil, errPlatformNativeTaskRefused
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, d.limit+1))
	var result map[string]json.RawMessage
	if err != nil || int64(len(raw)) > d.limit || response.StatusCode != http.StatusOK ||
		!strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") ||
		json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, errPlatformNativeTaskRefused
	}
	return result, nil
}

// The ticket is checked by Core's own PEP for the original execution, then
// dropped: the arguments, generation and deadline must be the frozen ones.
func (d *platformNativeDelivery) verify(ctx context.Context, task *types.PlatformNativeTask, answer map[string]json.RawMessage) error {
	token, arguments := fileStorageText(answer, "actionToken"), fileStorageText(answer, "argumentsJson")
	expires, err := time.Parse(time.RFC3339Nano, fileStorageText(answer, "expiresAt"))
	deadline, deadlineErr := time.Parse(time.RFC3339Nano, task.Deadline)
	digest, digestErr := types.PlatformArgumentsDigest(arguments)
	if token == "" || err != nil || deadlineErr != nil || digestErr != nil || !expires.After(time.Now()) ||
		expires.After(deadline) || digest != task.ArgumentsDigest {
		return errPlatformNativeTaskRefused
	}
	check := map[string]string{"bindingId": d.bindingID, "actionToken": token, "argumentsJson": arguments, "operation": "execute"}
	result, err := d.call(ctx, "/service/v1/adapter/pep_check", check)
	if err != nil || fileStorageText(result, "actionExecutionId") != task.ActionExecutionID ||
		fileStorageNumber(result, "bindingGeneration") != task.Generation ||
		fileStorageText(result, "nativeTaskDeadline") != task.Deadline || len(result["targetResource"]) == 0 {
		return errPlatformNativeTaskRefused
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return errPlatformNativeTaskRefused
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]json.RawMessage
	if err != nil || json.Unmarshal(payload, &claims) != nil ||
		fileStorageText(claims, "action_execution_id") != task.ActionExecutionID ||
		fileStorageText(claims, "external_execution_id") != task.ExternalExecutionID ||
		fileStorageText(claims, "idempotency_key") != task.IdempotencyKey ||
		fileStorageText(claims, "action_key") != task.ActionKey {
		return errPlatformNativeTaskRefused
	}
	return nil
}

// admitPlatformNativeTask authorizes the next unconsumed step of the retained
// native task. With wait, a reference Core has not yet observed is asked again
// until the frozen deadline; it is never re-dispatched or extended.
func (s *knowledgeService) admitPlatformNativeTask(ctx context.Context, task *types.PlatformNativeTask, wait bool) error {
	if !task.Valid() {
		return errPlatformNativeTaskRefused
	}
	delivery, err := s.platformNativeDelivery(task.BindingID)
	if err != nil {
		return err
	}
	deadline, err := time.Parse(time.RFC3339Nano, task.Deadline)
	if err != nil {
		return errPlatformNativeTaskRefused
	}
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	execution := map[string]string{"externalExecutionId": task.ExternalExecutionID, "idempotencyKey": task.IdempotencyKey, "nativeType": task.NativeType, "nativeId": task.NativeID}
	request := map[string]any{"bindingId": task.BindingID, "actionExecutionId": task.ActionExecutionID, "execution": execution, "nativeTaskDeadline": task.Deadline}
	for {
		answer, err := delivery.call(ctx, "/service/v1/adapter/request_native_task_execution_admission", request)
		if err != nil || fileStorageText(answer, "nativeTaskDeadline") != task.Deadline {
			return errPlatformNativeTaskRefused
		}
		switch fileStorageText(answer, "state") {
		case "ADMITTED":
			if len(answer) != 5 {
				return errPlatformNativeTaskRefused
			}
			return delivery.verify(ctx, task, answer)
		case "PENDING_REFERENCE":
			if len(answer) != 2 {
				return errPlatformNativeTaskRefused
			}
			if !wait {
				return errPlatformNativeTaskPending
			}
		default:
			return errPlatformNativeTaskRefused
		}
		timer := time.NewTimer(platformNativeTaskPoll)
		select {
		case <-ctx.Done():
			timer.Stop()
			return errPlatformNativeTaskPending
		case <-timer.C:
		}
	}
}

// platformNativeTaskOf reads the retained reference of a durable native task
// created by a bound execution; a malformed or foreign reference is refused.
func platformNativeTaskOf(metadata types.JSON, nativeType, nativeID string) (*types.PlatformNativeTask, bool, error) {
	if len(metadata) == 0 {
		return nil, false, nil
	}
	fields, err := metadata.Map()
	if err != nil {
		return nil, true, fmt.Errorf("native task metadata is unreadable")
	}
	value, present := fields[platformNativeTaskMetadataKey]
	if !present {
		return nil, false, nil
	}
	encoded, ok := value.(string)
	var task types.PlatformNativeTask
	if !ok || json.Unmarshal([]byte(encoded), &task) != nil || task.NativeType != nativeType || task.NativeID != nativeID {
		return nil, true, fmt.Errorf("retained platform execution reference does not belong to this native task")
	}
	return &task, true, nil
}

// boundPlatformNativeTask completes the admitted execute's reference with the
// native task it creates, or reports that the request is not bound.
func boundPlatformNativeTask(ctx context.Context, nativeType, nativeID string) (*types.PlatformNativeTask, error) {
	task, bound := types.PlatformNativeTaskFrom(ctx)
	if !bound {
		return nil, nil
	}
	task.NativeType, task.NativeID = nativeType, nativeID
	if !task.Valid() {
		return nil, fmt.Errorf("bound native task has no complete execution reference")
	}
	return &task, nil
}
