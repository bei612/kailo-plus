// Command worker 是 Application Worker 进程入口。
//
// 它是独立 Go 进程，与 Core 同仓、同 release train、共享 versioned contracts
// （01-工程结构与模块边界.md §4）。Temporal Server 不执行应用逻辑（SF-TMP-02）。
package main

import (
	"log"
	"os"

	"github.com/kailo/apps/worker/activities"
	"github.com/kailo/apps/worker/internal/oidc"
	"github.com/kailo/apps/worker/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func main() {
	tokens, err := oidc.FromEnv()
	if err != nil {
		log.Fatalf("构造 service identity 失败: %v", err)
	}
	opts, err := clientOptionsFromEnv(tokens)
	if err != nil {
		log.Fatalf("构造 Temporal 连接选项失败: %v", err)
	}
	c, err := client.Dial(opts)
	if err != nil {
		log.Fatalf("连接 Temporal 失败: %v", err)
	}
	defer c.Close()

	// task queue 是部署事实，不是常量：同一份产物可以服务不同队列。
	taskQueue := os.Getenv("TEMPORAL_TASK_QUEUE")
	if taskQueue == "" {
		log.Fatal("缺少 TEMPORAL_TASK_QUEUE")
	}

	// Activity 的依赖在启动时构造并整体失败：SpiceDB 与 Core 缺任一个，
	// 成员投影链都不完整，此时起一个「能接任务但做不完」的 Worker 更糟。
	spicedb, err := activities.NewSpiceDBFromEnv()
	if err != nil {
		log.Fatalf("构造 SpiceDB 客户端失败: %v", err)
	}
	core, err := activities.NewCoreAPIFromEnv()
	if err != nil {
		log.Fatalf("构造 Core service 客户端失败: %v", err)
	}

	w := worker.New(c, taskQueue, worker.Options{})
	w.RegisterWorkflowWithOptions(workflows.Baseline,
		workflow.RegisterOptions{Name: workflows.BaselineKind})
	w.RegisterWorkflowWithOptions(workflows.ComponentTask,
		workflow.RegisterOptions{Name: workflows.ComponentTaskKind})
	// 以方法值注册：Workflow 侧按 (*T).Method 引用同一个函数，两边必须一致。
	w.RegisterActivity(spicedb.Converge)
	w.RegisterActivity(core.ProjectTaskState)
	w.RegisterActivity(core.ProjectBuzzRoster)
	w.RegisterActivity(core.TransitionMembership)

	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker 退出: %v", err)
	}
}
