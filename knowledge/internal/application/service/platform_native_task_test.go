package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// SS-WEK-MATERIALIZATION: the durable task step is consumed only under a fresh
// ticket for exactly the retained original execution, checked by Core's PEP.
func TestPlatformNativeTaskAdmissionUsesOnlyTheOriginalExecution(t *testing.T) {
	deadline := time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	arguments := `{"input":{"nativeObjectRef":"doc"},"target":{"resourceId":"receiver"}}`
	digest, err := types.PlatformArgumentsDigest(arguments)
	require.NoError(t, err)
	task := &types.PlatformNativeTask{BindingID: uuid.NewString(), ActionExecutionID: uuid.NewString(), ExternalExecutionID: uuid.NewString(), IdempotencyKey: uuid.NewString(), ActionKey: "knowledge.ingest@v3", NativeType: types.PlatformNativeTaskAddDocument, NativeID: uuid.NewString(), Generation: 4, Deadline: deadline, ArgumentsDigest: digest}
	claims, err := json.Marshal(map[string]string{"action_execution_id": task.ActionExecutionID, "external_execution_id": task.ExternalExecutionID, "idempotency_key": task.IdempotencyKey, "action_key": task.ActionKey})
	require.NoError(t, err)
	token := "header." + base64.RawURLEncoding.EncodeToString(claims) + ".signature"
	pending, mode, admissions, checks := 1, "", 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "service", "token_type": "Bearer"})
		case "/service/v1/adapter/request_native_task_execution_admission":
			admissions++
			var request map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			require.Equal(t, task.ActionExecutionID, request["actionExecutionId"])
			execution := map[string]any{"externalExecutionId": task.ExternalExecutionID, "idempotencyKey": task.IdempotencyKey, "nativeType": task.NativeType, "nativeId": task.NativeID}
			require.Equal(t, execution, request["execution"])
			if pending > 0 {
				pending--
				_ = json.NewEncoder(w).Encode(map[string]string{"state": "PENDING_REFERENCE", "nativeTaskDeadline": deadline})
				return
			}
			answered := arguments
			if mode == "changed-arguments" {
				answered = `{"input":{"nativeObjectRef":"other"},"target":{"resourceId":"receiver"}}`
			}
			expires := time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
			_ = json.NewEncoder(w).Encode(map[string]string{"state": "ADMITTED", "actionToken": token, "argumentsJson": answered, "expiresAt": expires, "nativeTaskDeadline": deadline})
		case "/service/v1/adapter/pep_check":
			checks++
			generation := task.Generation
			if mode == "upgraded" {
				generation++
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"actionExecutionId": task.ActionExecutionID, "operationId": uuid.NewString(), "authorizationMinZedToken": "fresh", "bindingGeneration": generation, "nativeTaskDeadline": deadline, "targetResource": map[string]string{"resourceId": "receiver"}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer core.Close()
	dir := t.TempDir()
	secret := filepath.Join(dir, "service")
	require.NoError(t, os.WriteFile(secret, []byte("secret"), 0600))
	delivery, err := json.Marshal(map[string]any{"bindingId": task.BindingID, "corePepUrl": core.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": core.URL + "/token", "oidcClientId": "native", "oidcClientSecretFile": secret, "timeoutMs": 3000, "maxBodyBytes": 65536})
	require.NoError(t, err)
	file := filepath.Join(dir, "adapter.json")
	require.NoError(t, os.WriteFile(file, delivery, 0600))
	svc := &knowledgeService{config: &config.Config{MCPAdapterConfigs: []string{file}}}

	require.ErrorIs(t, svc.admitPlatformNativeTask(context.Background(), task, false), errPlatformNativeTaskPending)
	require.NoError(t, svc.admitPlatformNativeTask(context.Background(), task, true))
	require.Equal(t, 2, admissions)
	require.Equal(t, 1, checks)
	for _, change := range []string{"changed-arguments", "upgraded"} {
		mode = change
		require.ErrorIs(t, svc.admitPlatformNativeTask(context.Background(), task, true), errPlatformNativeTaskRefused, change)
	}
	expired := *task
	expired.Deadline = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	require.ErrorIs(t, svc.admitPlatformNativeTask(context.Background(), &expired, true), errPlatformNativeTaskRefused)

	// The retained reference must belong to the native task being consumed,
	// and caller metadata can never supply one.
	encoded, err := json.Marshal(task)
	require.NoError(t, err)
	metadata, err := json.Marshal(map[string]string{platformNativeTaskMetadataKey: string(encoded)})
	require.NoError(t, err)
	found, bound, err := platformNativeTaskOf(types.JSON(metadata), types.PlatformNativeTaskAddDocument, task.NativeID)
	require.NoError(t, err)
	require.True(t, bound)
	require.Equal(t, task, found)
	_, bound, err = platformNativeTaskOf(types.JSON(metadata), types.PlatformNativeTaskAddDocument, uuid.NewString())
	require.True(t, bound)
	require.Error(t, err)
	_, bound, err = platformNativeTaskOf(nil, types.PlatformNativeTaskAddDocument, task.NativeID)
	require.False(t, bound)
	require.NoError(t, err)
	require.Error(t, validateFileStorageOwnershipInput(map[string]string{platformNativeTaskMetadataKey: string(encoded)}))
}
