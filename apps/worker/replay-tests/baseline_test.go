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

// TestComponentTaskReplay 对录制的真实 history 回归 ComponentTaskWorkflow。
//
// .design/06 §2 把这件事定成发布前提：行为变更以 GetVersion changeID 门控，
// 发布前对录制 history 用 WorkflowReplayer 回归，重放失败即阻断发布。
//
// 两个 kind 各录一份，不是凑数：它们走的是同一条链的两个方向（Present/Absent、
// ACTIVE/REVOKED），只录一份会让另一个方向的确定性破坏漏过去。
//
// history 取自本地拓扑上真实跑通的执行（core/verify/membership-lifecycle.md
// 记录的那条链），不是手工构造的事件序列——手工构造的 history 只能证明代码
// 能重放我们以为会发生的事。
//
// 实测出的覆盖边界，不要高估它：
//   - 调换两步投影的顺序 → 报 nondeterministic，两份 history 都失败
//   - 多发一次 ProjectTaskState → 报 nondeterministic，指名分歧的 Activity
//   - **改 Activity 的 StartToCloseTimeout（30s→45s）→ 仍然通过**
//
// WorkflowReplayer 比对的是命令序列与类型，不比对 Activity 选项。因此
// 超时与重试策略的变更由代码评审与 06 §5.1 的纪律守，replay 守不住。
func TestComponentTaskReplay(t *testing.T) {
	for _, f := range []string{
		"testdata/component_task_projection_history.json",
		"testdata/component_task_revocation_history.json",
	} {
		r := worker.NewWorkflowReplayer()
		r.RegisterWorkflowWithOptions(workflows.ComponentTask,
			workflowRegisterOptions(workflows.ComponentTaskKind))
		if err := r.ReplayWorkflowHistoryFromJSONFile(nil, f); err != nil {
			t.Fatalf("%s replay 失败: %v", f, err)
		}
	}
}
