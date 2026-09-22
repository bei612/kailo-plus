# ADR-08：Core 连接 Temporal 的客户端与传输

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

`.design/06` §3.1 要求 Core 在调用 Temporal Start 之前持久化唯一 `WorkflowRef`，
并以三项固定策略（`WorkflowIdReusePolicy=REJECT_DUPLICATE`、
`WorkflowIdConflictPolicy=FAIL`、`WorkflowExecutionErrorWhenAlreadyStarted`）
至多一次启动。`.design/06` §3 又规定 Temporal 凭据只发给 Core 与 Worker。

Core 是 Rust，Worker 是 Go。Worker 侧用官方 `temporal-sdk-go`（`SF-TMP-04` 已固定
版本）。Core 侧没有现成结论：Temporal 长期没有官方 Rust SDK，`sdk-core` 虽是
Rust，但它面向各语言 SDK 的桥接层，不是应用侧客户端。

## 候选方案

**官方 `temporalio-client`（`temporalio/sdk-rust`）**：v1.0.0 已发布到 crates.io，
仓库属 temporalio 组织。提供完整 gRPC 面，包含按类型名启动的
`WorkflowService::start_workflow_execution`。

**Temporal 的 HTTP API**：固定 commit 上存在
`temporal/service/frontend/http_api_server.go`，是同一套 API 的 grpc-gateway 投影。
用 `reqwest` 直接调，不新增 gRPC 依赖链，且源码在 `.references` 内可引为源码事实。
代价是要在部署里额外开一个 HTTP 端口，并自己维护请求体与枚举取值的对应。

**自行用 tonic 生成客户端**：Temporal 的 proto 不在 `.references` 内，生成物没有
可固定的证据来源；等于把上游 API 的定义抄一份进本仓库。

## 决策

**用官方 `temporalio-client` 1.0.0，走 gRPC。**

- **不走类型化包装**：`Client::start_workflow` 要求 `W: HasWorkflowDefinition`，
  而 Workflow 的实现在 Go Worker 里，Rust 侧没有也不应该有对应的类型定义——
  那会是同一个 Workflow 的第二份声明。改用
  `Connection::workflow_service()` 取原始 gRPC 面，按类型名启动。
- **payload 编码固定 `json/plain`**：Go SDK 的默认 DataConverter 按该 metadata
  认 JSON。两侧编码不一致时 Workflow 收到的是零值而不是错误，因此这是必须显式
  写死的协议约定，不是可调参数。
- **`vendored-protox` feature**：默认构建需要系统 `protoc`，会把一个版本不受控的
  外部工具塞进发布镜像。该 feature 用纯 Rust 的 protox 编译，构建镜像不再需要
  `protoc`。已实测在 `PROTOC` 指向不存在路径时仍然构建成功。
- **令牌按需取**：连接期持一张静态令牌只是把失败推迟到第一次续期之后（本部署
  签发 900 秒）。每次 Start 前从 `TokenSource` 取，后者缓存到期前的值。
- **`AlreadyExists` 视为成功**：它恰好证明同一 ID 的 execution 已存在。此时不换
  ID 重试——换 ID 就是分配了第二个业务 workflow ID（`DD-48`）。

## 后果

正面：与 Go Worker 使用同一套 gRPC 语义与同一组枚举，策略取值不需要在两种表示
之间翻译；官方仓库随 Temporal 版本演进。

负面：引入 tonic/prost 依赖链，Core 的构建时间与二进制体积上升；`sdk-rust` v1.0.0
较新，遇到缺陷时可选的旁路比 Go SDK 少。

锁定：Core 侧以 gRPC 与 Temporal 交互。放弃：HTTP API 带来的「零 gRPC 依赖」。

## 替换边界

`temporalio-client` 出现无法绕过的缺陷、或其维护停滞到跟不上 Server 版本时，
重新评估 HTTP API 方案——届时 `temporal/service/frontend/http_api_server.go`
仍在固定 commit 上，且本 ADR 的其余决定（按类型名启动、`json/plain` 编码、
令牌按需取、`AlreadyExists` 视为成功）都与传输无关，可原样保留。

## 不改变的事

本 ADR 不改变 `.design/06` 的任何 Workflow 语义，也不改变 workflow ID 的构成
规则与三项启动策略——它只固定 Core 用什么去发那次调用。
