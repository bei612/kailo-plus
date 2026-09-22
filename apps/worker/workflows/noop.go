// Package workflows 保存 Application Worker 执行的 Workflow 定义。
//
// 边界见 01-工程结构与模块边界.md §4：Worker 不直写 Core 数据库、不复制 Core
// authorization、不把 Search Attribute 当隔离边界。Workflow 只保存冻结 ID、
// 版本、hash、状态与受限 reference。
package workflows

import "go.temporal.io/sdk/workflow"

// BaselineKind 是 Stage 0 的基线 Workflow 类型名。
// 它不承载业务语义，只用于证明 Worker 注册、执行与 history replay 链路成立。
// 正式 kind 见 .design/06 的封闭 ComponentTaskWorkflow kind 列表。
const BaselineKind = "KAILO_BASELINE"

// Baseline 立即返回。改变它的行为必须按 06-工程基线规范.md §5 以 GetVersion
// changeID 门控，并通过录制 history 的 replay 回归。
func Baseline(ctx workflow.Context) (string, error) {
	workflow.GetLogger(ctx).Info("baseline workflow started")
	return "ok", nil
}
