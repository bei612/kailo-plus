package main

// 真实连通性验证：SDK v1.48.0 对 Server v1.32.0。
//
// 它为 SF-TMP-04 的结论背书——Worker 的 SDK 版本与 Server 内部依赖的版本无关，
// 该独立性以实际跑通一个 Workflow 为据，不以版本号相等为据。
//
// 未提供 TEMPORAL_ADDRESS 时跳过：这是连通性验证，不是单元测试，
// 没有可达的 Server 时它没有适用对象。

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/kailo/apps/worker/internal/oidc"
	"github.com/kailo/apps/worker/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func TestBaselineRunsAgainstRealServer(t *testing.T) {
	if os.Getenv("KAILO_INTEGRATION") != "1" {
		t.Skip("未开启 KAILO_INTEGRATION，跳过连通性验证")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Temporal 公开 frontend 开启了 authorizer: default，无 claims 的非 health
	// API 一律被拒（SF-TMP-06）。令牌由 OIDC 提供方以 client_credentials 签发，
	// permissions 声明携带 "<namespace>:<role>"。SDK 用它填 authorization 头。
	// 与 main.go 共用同一份选项构造，避免连接语义出现第二份实现
	tokens, err := oidc.FromEnv()
	if err != nil {
		t.Skip(err.Error())
	}
	opts, err := clientOptionsFromEnv(tokens)
	if err != nil {
		t.Skip(err.Error())
	}
	c, err := client.DialContext(ctx, opts)
	if err != nil {
		t.Fatalf("连接 Temporal 失败: %v", err)
	}
	defer c.Close()

	const queue = "kailo-verify"
	w := worker.New(c, queue, worker.Options{})
	w.RegisterWorkflowWithOptions(workflows.Baseline,
		workflow.RegisterOptions{Name: workflows.BaselineKind})
	if err := w.Start(); err != nil {
		t.Fatalf("启动 Worker 失败: %v", err)
	}
	defer w.Stop()

	run, err := c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        "kailo-verify-baseline",
		TaskQueue: queue,
	}, workflows.BaselineKind)
	if err != nil {
		t.Fatalf("启动 Workflow 失败: %v", err)
	}

	var got string
	if err := run.Get(ctx, &got); err != nil {
		t.Fatalf("等待 Workflow 结果失败: %v", err)
	}
	if got != "ok" {
		t.Fatalf("Workflow 返回 %q，期望 \"ok\"", got)
	}
	t.Logf("SDK 与 Server 连通，Workflow 终态 %q（run %s）", got, run.GetRunID())
}
