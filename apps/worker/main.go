// Command worker 是 Application Worker 进程入口。
//
// 它是独立 Go 进程，与 Core 同仓、同 release train、共享 versioned contracts
// （01-工程结构与模块边界.md §4）。Temporal Server 不执行应用逻辑（SF-TMP-02）。
package main

import (
	"log"
	"os"

	"github.com/kailo/apps/worker/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

const taskQueue = "kailo-baseline"

func main() {
	hostPort := os.Getenv("TEMPORAL_ADDRESS")
	if hostPort == "" {
		hostPort = client.DefaultHostPort
	}
	c, err := client.Dial(client.Options{HostPort: hostPort, Namespace: os.Getenv("TEMPORAL_NAMESPACE")})
	if err != nil {
		log.Fatalf("连接 Temporal 失败: %v", err)
	}
	defer c.Close()

	w := worker.New(c, taskQueue, worker.Options{})
	w.RegisterWorkflowWithOptions(workflows.Baseline,
		workflow.RegisterOptions{Name: workflows.BaselineKind})

	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker 退出: %v", err)
	}
}
