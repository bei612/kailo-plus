# ADR-10：Core 做 fresh Check 的 SpiceDB 客户端与传输

- 状态：已接受
- 日期：2026-09-24
- 决策者：Kailo 实施工程负责人

## 背景

Stage 2 的准入把 SpiceDB 的判定带进 Core：`.design/05` §1 的唯一准入顺序第 4 步是
「SpiceDB permission with required consistency」，`.design/10` §1 固定准入、审批后
与撤权后的 Check 使用 `FullyConsistent`，`.design/06` §4 的 `FreshApprovalAdmission`
要在 Core 判定 approver 的选择器 permission。Stage 1 只有 Worker 写关系，Core 从未
直接问过 SpiceDB。

约束：SpiceDB 是访问允许/拒绝的唯一权威（`.design/03` §1）；平台组件 API 只接受
Core/Worker 的 service identity，SpiceDB 用 bearer preshared key（`DD-37`、
`SF-SPZ-03`）；key 不上命令行（`SF-SPZ-04`）。

Core 是 Rust，SpiceDB 官方没有 Rust 客户端。

## 候选方案

**SpiceDB 自带的 HTTP gateway**：固定 commit 上
`spicedb/internal/gateway/gateway.go::NewHandler` 把 `PermissionsService`、
`SchemaService`、`WatchService` 以 grpc-gateway 投影成 HTTP/JSON，`Authorization`
头原样作为 gRPC metadata 上送，经同一套 preshared key 校验。Core 用已有的 `reqwest`
调 `POST /v1/permissions/check`，不新增依赖。代价：部署要打开 `--http-enabled`，
多一个只在内网可达的端口；请求与回应的 JSON 形状由 Core 维护（Check 一个方法，
字段 7 个）。

**tonic + authzed proto 生成 gRPC 客户端**：proto 不在 `.references` 内（Worker 用的
`authzed-go` 只带生成的 `.pb.go`），生成物没有可固定的证据来源；等于把上游 API 的
定义抄一份进本仓库。

**把 Check 委托给 Worker**：准入是同步的 BFF 请求路径，经 Temporal 绕一圈再回来既
慢又把「Core 是准入点」变成「Worker 是准入点」，与 `01` §4「Worker 不复制 Core
authorization」相反。

## 决策

**Core 经 SpiceDB 的 HTTP gateway 调 `CheckPermission`**（`core/crates/kailo-core/src/spicedb.rs`）。

- 只用 Check 一个方法。一致性取值按 `.design/10` §1：准入、重新准入、审批者资格用
  `fullyConsistent`；「待我审批」列表用 `minimizeLatency`，点击动作仍 fresh Check。
- 结论只有两种确定值：`PERMISSIONSHIP_HAS_PERMISSION` 为有，其余（含
  `CONDITIONAL_PERMISSION`）为没有；任何非 2xx、传输失败、回应不可解析都按结果
  不明上报，调用方不判定、不放行。
- 凭据与 Worker 同一枚 preshared key，经 `secrets/core-spicedb.env` 以环境变量投递；
  地址 `SPICEDB_HTTP_URL` 不接受默认值。
- gateway 端口只在 SpiceDB 已加入的 `component`/`app` 网络内可达，不发布到宿主。

## 后果

正面：不新增依赖链；Check 的请求与回应在一个文件里可读可评审；ZedToken
（`checkedAt.token`）进 ActionDecision 作为证据。

负面：多开一个内网端口；gateway 与 gRPC 面共用服务端，但多一跳 JSON 编解码；
`WriteRelationships` 与 `LookupResources` 若将来也要从 Core 调，同样走这条面并各自
维护形状。

锁定：Core 以 HTTP/JSON 与 SpiceDB 交互。放弃：gRPC 流式 API（`LookupResources`、
`Watch`）的原生客户端体验。

## 替换边界

出现以下任一即重新评估：Core 需要 `LookupResources`/`Watch` 等流式接口；gateway 在
升级的 SpiceDB 版本中被移除或改变认证透传；authzed 发布可固定来源的 proto 或官方
Rust 客户端。替换只动 `spicedb.rs` 与部署的端口/开关，调用方的 `check()` 签名与一致性
取值不变。

## 不改变的事

本 ADR 不改变 SpiceDB 的权威地位、固定 schema（`.design/03` §5）或一致性规则
（`.design/10` §1）；它只选择 Core 用什么发那次 Check。
