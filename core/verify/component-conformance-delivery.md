# 一致性候选集合、无人值守隔离运行与 adapter 声明式部署（DD-136(2)(5)(6)）

设计依据：design-authority `6bf0f563`（`.design/02` DD-136(2)(5)(6)、`07` §8A、`13` §3、`16` V-SCN-220）。
能力记录：`tools/traceability/component.release_registration.yaml`。本文件取代
`core/verify/component-release-registration.md` 中“在原 `.env` 提供 `COMPONENT_CONFORMANCE_*_FILE` 后沿
`start-core.sh --no-build`”的旧用法（单一候选，组件登记须替换 Core 给 `PROTOCOL_PEER` 的那份投递并重建 Core）。

## 1. 候选集合（DD-136(2)）

- 运行目录 `data/conformance/<artifactDigest>/`：`PROTOCOL_PEER` 候选只有 `environment.json`；`REMOTE_ADAPTER`
  候选有 `environment.json`、`fixture.json`、`identity.json` 与 identity 指向的同目录 `jwks.json`。
- Core（`component_conformance_delivery.rs`）在 `protocol_fixture`、`component_release_peer::environment`、
  `component_conformance_identity::load` 只按被登记 release 的 `adapter_digest` 选取候选；没有该候选为
  `CAPABILITY_BLOCKED`，identity 的 `jwksFile` 不在候选目录内为 `INVALID_PARAMETERS`。向导的 `conformanceReady`
  按 peer 自己的 digest 判断。Worker（`conformanceCandidateFile`）按冻结 plan 的 `artifactDigest` 选取 environment。
- `start-core.sh`：交付目录所在文件夹与候选集合目录只读挂载给 Core；候选集合另挂载给 Worker，receiver 凭据目录
  `COMPONENT_CONFORMANCE_WORKER_DIR`（owner-only）只挂载给 Worker。目录不得组/其他可写；挂载形态变化（Worker
  标签）才重建 Worker。
- 发布入口（`tools/release/model.py`、`node.py`、`release.yaml`）：`env.set` 声明两个目录键，`env.unset` 删除旧三个
  文件键；peer 一致性环境写成其候选，删除不再声明的 peer 候选与旧 `conformance-environment.json`，不动
  `REMOTE_ADAPTER` 候选；只有挂载形态摘要变化才把 core-bff 列为部署目标。

## 2. 无人值守隔离运行（DD-136(5)）

`component-deploy.sh <file-storage|knowledge|data-query> <commit> --conformance` → `tools/component-release/conformance-auto.py run`：

- 运行目录 `/volumes/data/kailo/conformance/runs/<component>-<UTC>-<id>/`（0700）；隔离 Compose 项目、
  `kailo-conformance-*` 专用 internal 网络、空闲子网与回环端口由运行器选取，不与生产或其他运行共用。
- 云盘：运行器生成 Cells 安装管理员、数据库、datasource 密钥、OAuth 与未使用的 OIDC client 凭据（只写 0600 文件），
  第 1 阶段后以隔离实例的原生 CLI（`cells admin user token`）取管理员令牌，经原生 REST `PUT /a/user/{Login}` 建
  binding 服务账号与 actor 用户（口令只在请求体），再以原生 CLI 为三者签发个人令牌（只写 0600 文件），然后依次执行
  `conformance-run.sh` 第 2–6 阶段：原生种子、`isolated-plan.py` 的全新模拟身份、`adapter-delivery.py config`
  （adapter 与原生动作投递，PEP/令牌端点指向 suite provider、隔离受众）、隔离 OpenBao 与组件 Agent（`cells_bearer`
  = 隔离服务账号令牌，`oidc_client_secret` = 运行器生成的 provider 绑定凭据）、观察、输入组装、suite provider。
- 成功后安装候选（同目录临时目录 + 原子替换），把生产 Worker 接入该次运行网络（登记窗口）；`--conformance-close=<运行目录>`
  撤下候选、断开 Worker、拆除隔离项目、隔离 OpenBao/Agent、provider 与网络。
- 输出只有步骤、计数与状态；Python 异常的调用栈只写入 owner-only 运行日志。

## 3. adapter 声明式部署（DD-136(6)）

`component-deploy.sh file-storage <commit> --adapter` → `deploy/components/adapter-converge.py`（声明：
`deploy/components/adapters.json` 的 `adapter`）：`plan`（render.mjs + `component-bind.mjs --plan-only --tenant-id`，
与治理 create 同一确定性 binding 标识，不登录）、`deliver`（adapter 配置、Tenant namespace 只读 policy/AppRole 与
一次性 wrapped secret-id、Agent HCL、交付目录条目原子替换）、Agent 与 adapter 启动、`client`（binding 存在且 Agent
渲染凭据后声明 binding 的 adapter IdP client，否则 PENDING）。`secrets` 以生产 Cells 原生 CLI 为 binding 服务账号签发
令牌并与生成的 adapter client 凭据写入一个 0600 文件，供 Tenant 管理员的 `application_binding.create` 一次性提交。

## 4. 发布与清单

- `file-storage/fork/release/manifest.json`、`data-query/fork/release/manifest.json`：`incrementalContracts` 补为
  `NATIVE_INTERNAL/NATIVE`，键 `<type_key>@v<N>`（`13` §3），满足 `catalog.resource_type_definition` 的非空约束。
- `file-storage/deploy/reconcile.py`：原生管理员令牌在部署期限内重试（首装后容器已 healthy 而原生迁移未完成）；
  `conformance-run.sh` 第 1 阶段对首装后原生配置被拒的情形重启一次原生服务再收敛。

## 5. 验证记录

见本批汇报（CI 节点 `~/scratch/adapters/*.log`、运行目录 `run.log`）：`tools/check.sh lint`、`verify`、`security`
（本节 DD-136(2) 投递断言）在分支上执行的原始结果，以及隔离运行各阶段结果。生产登记、批准、binding 与业务验收须在
本分支合并、Core/Worker 发布之后执行，不由本文件证明。
