package activities

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"apps/worker/internal/contracts/generated"
	"apps/worker/internal/oidc"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestProjectAgentTaskStateUsesNativeActivityAndExactAcknowledgement(t *testing.T) {
	for _, scenario := range []string{"success", "wrong-run", "later-ack", "missing-ack"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			var expectedActivity string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
					return
				}
				calls++
				if r.URL.Path != "/service/v1/task-projections" {
					t.Errorf("unexpected projection route: %s", r.URL.Path)
				}
				var report generated.TaskStateReport
				if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
					t.Error(err)
				}
				if report.ActivityID == nil || *report.ActivityID != expectedActivity || *report.ActivityID == "caller-invented" {
					t.Error("projection did not use native ActivityInfo")
				}
				if scenario == "missing-ack" {
					_, _ = io.WriteString(w, `{}`)
					return
				}
				event := report.EventID
				if scenario == "later-ack" {
					event++
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"applied": false, "lastEventId": event})
			}))
			defer server.Close()
			t.Setenv("OIDC_TOKEN_URL", server.URL+"/token")
			t.Setenv("OIDC_WORKER_CLIENT_ID", "isolated-worker")
			t.Setenv("OIDC_WORKER_CLIENT_SECRET", "isolated-fixture")
			tokens, err := oidc.FromEnv()
			if err != nil {
				t.Fatal(err)
			}
			api := &CoreAPI{base: server.URL, tokens: tokens, http: server.Client()}
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestActivityEnvironment()
			actual := func(ctx context.Context) error {
				info := activity.GetInfo(ctx)
				expectedActivity = info.ActivityID
				forged := "caller-invented"
				report := generated.TaskStateReport{WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
					ActivityID: &forged, EventID: 8, Status: generated.TaskStatusRUNNING}
				if scenario == "wrong-run" {
					report.RunID = "unrelated-run"
				}
				return api.ProjectAgentTaskState(ctx, report)
			}
			env.RegisterActivity(actual)
			_, err = env.ExecuteActivity(actual)
			if (err == nil) != (scenario == "success") {
				t.Fatalf("scenario %s: %v", scenario, err)
			}
			want := 1
			if scenario == "wrong-run" {
				want = 0
			}
			if calls != want {
				t.Fatalf("projection requests=%d want=%d", calls, want)
			}
		})
	}
}
