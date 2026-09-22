package replaytests

import (
	"testing"

	"github.com/kailo/apps/worker/workflows"
	"go.temporal.io/sdk/worker"
)

// TestBaselineReplay 对应 00-实施总纲.md Stage 0 退出条件「空 Workflow history 可 replay」。
// history 为最小完整事件序列，随代码入库；Workflow 行为变化必须先让本测试通过。
func TestBaselineReplay(t *testing.T) {
	r := worker.NewWorkflowReplayer()
	r.RegisterWorkflowWithOptions(workflows.Baseline,
		workflowRegisterOptions(workflows.BaselineKind))
	if err := r.ReplayWorkflowHistoryFromJSONFile(nil, "testdata/baseline_history.json"); err != nil {
		t.Fatalf("replay 失败: %v", err)
	}
}
