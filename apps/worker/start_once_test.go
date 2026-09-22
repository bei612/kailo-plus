package main

// 至多一次启动的真实验证（.design/06、Stage 1 退出门禁）。
//
// 验证两件事：同一实体同一版本算出的 workflow ID 恒定；重复 Start 不产生
// 第二个 execution，而是收敛到同一个 run。

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/kailo/apps/worker/internal/contracts/generated"
	"github.com/kailo/apps/worker/internal/oidc"
	"github.com/kailo/apps/worker/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func TestStartOnceConvergesToSameRun(t *testing.T) {
	if os.Getenv("TEMPORAL_ADDRESS") == "" {
		t.Skip("未提供 TEMPORAL_ADDRESS，跳过连通性验证")
	}
	tokens, err := oidc.FromEnv()
	if err != nil {
		t.Skip(err.Error())
	}
	opts, err := clientOptionsFromEnv(tokens)
	if err != nil {
		t.Skip(err.Error())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	c, err := client.DialContext(ctx, opts)
	if err != nil {
		t.Fatalf("连接 Temporal 失败: %v", err)
	}
	defer c.Close()

	const queue = "kailo-start-once"
	w := worker.New(c, queue, worker.Options{})
	w.RegisterWorkflowWithOptions(workflows.Baseline,
		workflow.RegisterOptions{Name: workflows.BaselineKind})
	if err := w.Start(); err != nil {
		t.Fatalf("启动 Worker 失败: %v", err)
	}
	defer w.Stop()

	// 固定实体与版本，因此 ID 固定；用时间戳做实体 ID 以免跨次运行相互干扰
	tenant := "00000000-0000-0000-0000-0000000000aa"
	entity := time.Now().UTC().Format("20060102150405.000000")
	start := workflows.StartOptions(generated.WorkflowKind(generated.MembershipProjection),
		queue, tenant, entity, 1)

	want := "kailo:MEMBERSHIP_PROJECTION:" + tenant + ":" + entity + ":1"
	if start.ID != want {
		t.Fatalf("workflow ID 为 %q，期望 %q", start.ID, want)
	}

	first, err := workflows.StartOnce(ctx, c, start, workflows.BaselineKind)
	if err != nil {
		t.Fatalf("首次启动失败: %v", err)
	}
	// 等首次执行终结，确保第二次撞上的是同一 ID 的已存在 execution
	var out string
	if err := first.Get(ctx, &out); err != nil {
		t.Fatalf("等待首次结果失败: %v", err)
	}

	second, err := workflows.StartOnce(ctx, c, start, workflows.BaselineKind)
	if err != nil {
		t.Fatalf("重复启动应收敛为成功，却失败: %v", err)
	}
	if second.GetRunID() != first.GetRunID() {
		t.Fatalf("重复启动产生了第二个 run：%s 与 %s", first.GetRunID(), second.GetRunID())
	}
	t.Logf("同一 workflow ID 收敛到同一 run %s", first.GetRunID())
}
