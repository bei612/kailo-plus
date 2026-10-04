# ADR-12：Adapter Protocol v1 的传输编码与两个方向的认证

- 状态：已接受
- 日期：2026-09-28
- 决策者：Kailo 实施工程负责人

## 背景

`.design/07` §5.2 固定了 Adapter Protocol 的逻辑操作：出站十项（Core/Worker 发起、adapter
应答）与入站三项（`pep_check`、`report_rekey`、`request_read_grant`，业务能力实现以其 binding
的 ServicePrincipal 发起、Core 应答），并写明「传输编码由 release 的协议版本固定」。设计没有
规定 v1 的编码、schema 位置与两个方向的认证载体，这属于实施选择。EXT-BASE 要交付一致性套件、
Component SDK 与示例组件（`DD-76`、`DD-101`），三者必须对同一条线协议取证。

约束：

- 协议对 adapter 语言无关，首方不承诺多语言 SDK（`.design/07` §8A）；
- Core→adapter 的请求只凭 Core 签发的短期 ActionToken 授权，adapter 以 OpenBao Agent 投递的
  JWKS 验签，不另设分发通道（`.design/03` §6、`DD-94`）；
- 入站方向使用该 binding 的 INSTANCE_SERVICE 凭据，受众固定为 Core PEP（`.design/09` 的
  ServicePrincipal 表）；
- 对象 schema 只用 `contracts/README.md` §1 的 JSON Schema 子集，四侧生成（ADR-02、ADR-03）；
- 平台必须能对接任意满足 OIDC 的 IdP，不能依赖某个 IdP 的管理 API（`.design/05` §3）。

## 候选方案

- **HTTP/JSON**：Core 与 Worker 已有 `reqwest`/`net/http` 与 JSON 生成物；schema 直接落在
  `contracts/`，四侧生成与 round-trip 沿用现有门禁；任意语言的 adapter 都能实现；一致性套件以
  HTTP 客户端与桩服务端即可在线协议层取证。
- **gRPC/Protobuf**：需要第二套 IDL 与生成链，与「`contracts/` 是四侧唯一权威」冲突；Dart 与
  部分外部实现的接入成本更高。
- **沿用 MCP 作为 Adapter Protocol**：MCP 是 Agent 工具面，经 AgentGateway 与 ExtMcp PEP；把
  binding 生命周期、`resolve_native_scope`、`report_rekey` 塞进工具调用会混淆两条治理链。

## 决策

1. **编码与路径。** v1 为 HTTP/1.1 上的 JSON：每个逻辑操作一个 `POST /platform-adapter/v1/<operation>`，
   `<operation>` 取 `.design/07` §5.2 的操作名。请求与回应对象的 schema 放在
   `contracts/adapter/protocol.v1/`，按 `contracts/README.md` 的子集编写，由四侧生成；能力契约
   schema 仍在 `contracts/adapter/<category>.v1/`，由 `execute` 的参数与结果引用。
   `handshake` 回报的协议范围与 `PlatformBuildInfo.adapter_protocol_versions` 取值为 `1`。
2. **出站认证（Core/Worker → adapter）。** 每个出站请求携带其所属 operation 的 ActionToken，
   放在 `Authorization: Bearer`，audience 为该 binding 的 ServicePrincipal audience。binding 生命
   周期中的 `handshake`、`validate_binding` 与 `resolve_native_scope` 同样属于一个 Governed Action
   （`COMPONENT_BINDING` 或 `RESOURCE_PROVISION`），用该 operation 的 ActionToken，不设无 token
   的调用；`resolve_native_scope` 按 `.design/07` §5.2 带 `mode=CREATE|LOOKUP`，mode 进入请求体，
   `RESOURCE_PROVISION` 的对账只发 `LOOKUP`。ExternalExecution 的幂等键放在 `Idempotency-Key` 头，并由 schema 在请求体中重复固定；
   两者不一致时 adapter 拒绝。
3. **入站认证（adapter → Core）。** 三个入站操作挂在 Core 的 service 监听端口（与 Worker→Core
   service API 同一端口，不经 AgentGateway），路径为 `/service/v1/adapter/<operation>`。每个
   binding 使用 IdP 中一个独立的 OIDC client，以 client_credentials 取令牌：client 由部署运维
   在 IdP 中预先登记，`client_id` 写入 binding 的规范化配置，client secret 作为 `SecretRef`
   经 OpenBao Agent 投递给该 adapter。Core 沿用 `service_auth` 的规则逐条核对 issuer、audience
   （Core PEP 受众）、签名与有效期，并把 `azp` 精确映射到已登记且 binding 为 `ACTIVE` 的
   ServicePrincipal；未登记、binding 非 `ACTIVE` 或映射不唯一时拒绝，不做通配。
4. **结果语义。** HTTP 状态只表示传输结果；业务结果、native status 与错误分类都在回应体内，
   按 `06-工程基线规范.md` §4 的错误六分类映射。请求超时、连接中断或回应体无法按 schema 解析
   一律按「结果不明」处理，进入 ExternalExecution `UNKNOWN`，只按登记的幂等键对账，不自动重放
   （`.design/06` §5.1）。
5. **网络位置。** adapter 运行体在平台运维域内（`DD-94`）；出站与入站流量只走该 binding 的
   私有数据网络，不经公开入口与 AgentGateway 的 Browser 路由。
6. **内容引用编码。** `contracts/domain/content_reference.schema.json` 固定 `.design/03` 的六个
   原字段；可空 Asset 以字段缺省表示。执行响应以唯一 `contentReference` typed 槽传递引用，
   `resultJson` 不作为引用的第二来源，平台不猜测其中的路径或用原生 API 重建引用。后续 execute
   将该完整引用作为规范化 args 的一部分，并进入 request digest 与 ActionToken 参数 hash。
   隔离一致性向量只用同 case 的前序 `stepKey` 引用此槽，同时固定 Resource/Asset 授权目标；
   Core/Worker 校验实际返回的 target、native ref 与 revision，缺少引用、串 scope 或往返漂移均拒绝。
   此编码没有新增 Adapter 逻辑操作、内容权威或表达式语言。静态测试 token 不证明动态参数的授权
   绑定；生产签发仍服从第 2 条与 `.design/03` §6，隔离模拟身份不构成生产 binding 验收。

## 后果

- 一致性套件、SDK 的服务端骨架与示例组件共享 `contracts/adapter/protocol.v1/` 这一份 schema；
  改动按 `contracts/` 的兼容规则发布，不兼容变更只能以 `protocol.v2` 发布并重发 Core/adapter
  （`.design/07` §9）。
- 每个 binding 需要部署运维在 IdP 登记一个 client；这是 binding 建立的前置配置，缺失时
  `validate_binding` 不通过、binding 停在 `PROVISIONING`，不以共享 client 代替。
- Core 的 service 认证从「单一 Worker client」扩展为「Worker client 加已登记 binding 的
  client 集合」，集合随 binding 状态收缩：binding 离开 `ACTIVE` 即不再接受其入站令牌。

## 重新评估条件

- 出现必须以流式双向或服务端推送承载的 Adapter Protocol 操作（HTTP 请求/响应无法表达其终态
  语义）时，重新评估传输编码，并以新的协议版本发布，不改变 v1；
- 外部实现普遍无法以每 binding 独立的 client-credentials 认证入站调用时，重新评估入站认证方式；
- JSON 体积或序列化开销成为已登记容量边界的瓶颈（`apps/07` 的容量记录）时，重新评估编码。
