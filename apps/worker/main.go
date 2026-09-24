// Command worker 是 Application Worker 进程入口。
//
// 它是独立 Go 进程，与 Core 同仓、同 release train、共享 versioned contracts
// （01-工程结构与模块边界.md §4）。Temporal Server 不执行应用逻辑（SF-TMP-02）。
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

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
	meters, metrics, err := initMetrics(context.Background())
	if err != nil {
		log.Fatalf("构造运维信号导出失败: %v", err)
	}
	// 退出前把缓冲中的指标送出去
	defer func() { _ = meters.Shutdown(context.Background()) }()
	opts.MetricsHandler = metrics
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
	core, err := activities.NewCoreAPIFromEnv(tokens)
	if err != nil {
		log.Fatalf("构造 Core service 客户端失败: %v", err)
	}

	// Activity 的超时与重试间隔是部署事实，缺任一项即拒绝启动：Workflow
	// 里没有默认值可以回退，零值会让每次 Activity 调度当场失败。
	retry, err := retryFromEnv()
	if err != nil {
		log.Fatalf("Activity 重试配置不完整: %v", err)
	}
	workflows.Configure(retry)

	w := worker.New(c, taskQueue, worker.Options{})
	w.RegisterWorkflowWithOptions(workflows.Baseline,
		workflow.RegisterOptions{Name: workflows.BaselineKind})
	w.RegisterWorkflowWithOptions(workflows.ComponentTask,
		workflow.RegisterOptions{Name: workflows.ComponentTaskKind})
	w.RegisterWorkflowWithOptions(workflows.Approval,
		workflow.RegisterOptions{Name: workflows.ApprovalKind})
	// 以方法值注册：Workflow 侧按 (*T).Method 引用同一个函数，两边必须一致。
	w.RegisterActivity(spicedb.Converge)
	w.RegisterActivity(core.ProjectTaskState)
	w.RegisterActivity(core.ProjectBuzzRoster)
	w.RegisterActivity(core.ProjectBuzzIdentity)
	w.RegisterActivity(core.TransitionMembership)
	w.RegisterActivity(core.ProvisionTenantBuzz)
	w.RegisterActivity(core.VerifyTenantBuzz)
	w.RegisterActivity(core.ProvisionWorkspaceBuzz)
	w.RegisterActivity(core.TransitionScope)
	w.RegisterActivity(core.ProjectApprovalState)
	w.RegisterActivity(core.FreshApprovalAdmission)

	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker 退出: %v", err)
	}
}

// retryFromEnv 读取 Activity 的超时、重试上界与两轮收敛之间的等待。时长单位
// 秒，全部必须为正整数；缺任一项即拒绝启动（06 §5.1 要求显式固定）。
func retryFromEnv() (workflows.Retry, error) {
	positive := func(name string) (int, error) {
		n, err := strconv.Atoi(os.Getenv(name))
		if err != nil || n <= 0 {
			return 0, fmt.Errorf("%s 必须是正整数", name)
		}
		return n, nil
	}
	seconds := func(name string) (time.Duration, error) {
		n, err := positive(name)
		return time.Duration(n) * time.Second, err
	}
	var r workflows.Retry
	var err error
	if r.StartToClose, err = seconds("WORKER_ACTIVITY_START_TO_CLOSE_SECONDS"); err != nil {
		return r, err
	}
	if r.ScheduleToClose, err = seconds("WORKER_ACTIVITY_SCHEDULE_TO_CLOSE_SECONDS"); err != nil {
		return r, err
	}
	attempts, err := positive("WORKER_ACTIVITY_MAX_ATTEMPTS")
	if err != nil {
		return r, err
	}
	r.MaxAttempts = int32(attempts)
	if r.InitialInterval, err = seconds("WORKER_ACTIVITY_RETRY_INITIAL_SECONDS"); err != nil {
		return r, err
	}
	if r.MaxInterval, err = seconds("WORKER_ACTIVITY_RETRY_MAX_SECONDS"); err != nil {
		return r, err
	}
	if r.RoundInterval, err = seconds("WORKER_CONVERGE_ROUND_INTERVAL_SECONDS"); err != nil {
		return r, err
	}
	if r.MaxInterval < r.InitialInterval {
		return r, fmt.Errorf("WORKER_ACTIVITY_RETRY_MAX_SECONDS 不得小于 WORKER_ACTIVITY_RETRY_INITIAL_SECONDS")
	}
	if r.ScheduleToClose < r.StartToClose {
		return r, fmt.Errorf("WORKER_ACTIVITY_SCHEDULE_TO_CLOSE_SECONDS 不得小于 WORKER_ACTIVITY_START_TO_CLOSE_SECONDS")
	}
	return r, nil
}
