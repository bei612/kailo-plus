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

## 5. 验证记录（2026-10-24，CI 节点，分支 `feat/adapter-conformance-auto`）

| 范围 | commit | 结果 |
|---|---|---|
| `tools/check.sh lint`（cargo fmt/clippy、gofmt/vet、pnpm/web tsc、dart analyze、wren-ui prettier/lint/tsc、buzz web/admin tsc） | `03a1fea9` | 全部 PASS |
| `tools/check.sh verify`（cargo test、go test、pnpm -r test、web vitest、dart test） | `03a1fea9` | 全部 PASS |
| `tools/check.sh security` 中 DD-136(2) 投递断言（目录挂载、可写目录/私钥/软链接拒绝、Worker 私有凭据目录） | `03a1fea9` | PASS；同步骤其余 FAIL 为分支工作区没有外层 GitNexus ignore，与本批无关 |
| `tools/check.sh trace`、`docs` | `03a1fea9` | 追溯一致 PASS、runbook 齐全 PASS；trace 的 FAIL 行均为分支工作区无 `dist/` 发布产物 |
| `tools/release/test_node.py`（87）、`file-storage/deploy/test_reconcile.py`（19）、`deploy/components/test_native_config.py`（28）、`test_native_model_delivery.py`（16） | `03a1fea9` | 全部 OK |
| `seed-cells.test.mjs`（4）、`conformance-provider.test.mjs`（6） | `03a1fea9` | 全部通过 |

隔离运行：

- 云盘：`conformance-auto.py run file-storage --no-window` 在全新运行目录 `file-storage-20261024T024850Z-6d11ce` 一次跑完第 0–6
  阶段（约 12 分钟，中间无人参与），候选写入临时运行目录的候选集合：四个 0644 文件、artifactDigest `79ca81f2…` 一致、identity 的
  `jwksFile` 在候选目录内；fixture 协议 12 步 + 向量 7 步（计划 26 步，含拒绝探针），identity 43 个上下文。对运行目录内全部
  凭据文件与运行日志/标准输出做的出现性检查为 0 次。之后 `close` 撤下候选并拆除隔离项目、OpenBao/Agent、provider 与网络。
- 本批由首次实跑发现并修复：Cells 首装后原生迁移未完成即重启会取消迁移（令牌重试改为按部署期限）；首装后 binding datasource
  需一次重启才被管理树识别（reconcile 退出 76，start.sh 重启一次）；`--platform-adapter` 的 URL 校验对非空元组恒为真而拒绝一切
  配置；Agent socket 0755 被要求恰为 0600；隔离 OpenBao 数据卷属 root；隔离受众未替换 Cells MCP transport 受众。
- 问数：隔离运行第 0–6 阶段跑通（`data-query-20261024T015939Z-a39c5f`），发现并修复 `nativeBindingService.ts` 对 OpenBao
  `request_id` 的 RFC 4122 版本位误判（validate_binding 随机失败）；该修复需重建 `data-query-ui` 后用新 digest 重跑候选。
- 知识库：接收部署的 platform、contracts、隔离 ActionToken 身份已自动化；native 起的阶段见 `auto_knowledge.py` 记录的缺口。
- 生产 adapter 计划：`adapter-converge.py plan file-storage|data-query --state-dir <临时目录>` 以生产只读事实推导出与治理 create
  同一的 binding 计划（云盘 bindingId `b2cde97d…`、问数 `058bd793…`）。

生产登记、批准、binding、adapter 部署与业务验收须在本分支合并 main、经发布入口发布 Core/Worker 与 `.env` 之后执行（RB-11）。

## 6. 接收方身份与阶段恢复修复（2026-10-26）

设计依据为 DD-124(4)、DD-136(5)、07 §8A；修改只影响隔离准入运行器与原生客户端的验收登录，
不改变业务 schema、API、Workflow、生产批准规则或上游源码。`receiver-sessions.mjs` 通过既有
Desktop/Mobile client 的授权码 + PKCE 取得 HUMAN bearer，在隔离原生网关读取 `/api/v1/session`。
三个账号必须分别属于业务 Tenant 管理员、Catalog 登记人和独立 Catalog 批准人；首次观察身份固定，
续期只接受相同身份，token 与 refresh token 原子写入 0600 文件，重入由私有锁串行化。
自动运行器将同一刷新命令交给 bootstrap、seed 与 driver；会话失败不会伪造身份继续执行。

阶段修复：空的 `*.done` 是完成标记，不再被非空文件判断永久拒绝；bootstrap 显式投递原测试入口所需
`APPLICATION_RECEIVER_BOOTSTRAP_FILE`；恢复执行保留 native 后续参数；拆除使用该次运行的 Compose 与
环境文件。`platform.done` 只在完整启动并连接隔离网络后写入，启动前生成的 `core-build.json` 只证明来源。
部分启动失败保留原现场并拒绝当作就绪重用；不盲删或重放未明副作用。高频临时文件改用 CI NVMe。

只读现场核验：遗留 `knowledge-20261024T040931Z-1ed31c` 固定来源 `f15dd7802ca684c22ef84dcd8c7aebc084d1bc6b`，
仅有 `core-build.json`，没有后续阶段完成标记。其 Core 使用旧 digest `a6c37cbf2ea58b4c983f9bd2bb7a5dca5c94fcb674c5a35ee6d4b901794f1a17`，
启动日志为 OpenBao AppRole login 不可达，进程退出 1，非 OOM；其他隔离基础服务仍运行。
该现场不是当前生产同版本的接收方，未被复用或清理。第 5 节的“已自动化”描述代码覆盖，不能据此声明这次
知识库运行已完成 platform/contracts；native、bootstrap、seed、inputs、driver 仍无端到端成功证据。

固定提交 `2c36300689060f0794248ffd4fcb3ecf06bf8995` 的定向检查（CI 节点，2026-10-26）退出 0：
`bash -n receiver-run.sh`、`node --check receiver-sessions.mjs`、conformance Python AST 解析；
会话入口对缺失参数与生产目录均退出 2 且不创建输出；既有 `seed-cells.test.mjs` 与
`conformance-provider.test.mjs` 10 项全部通过。镜像为既有 `tools/check.Dockerfile` 对应的
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`；回读 HostConfig 为
1 CPU、512 MiB、memory-swap 同限、128 PIDs、只读根文件系统与 `network=none`。
回执和日志在 CI `/volumes/data/kailo/conformance/checks/2c36300689060f0794248ffd4fcb3ecf06bf8995/`。
源码取自该已推送 commit 的所需路径 `git archive`，不是完整工程检查或真实 PKCE/接收方业务验收。
队列 fetch `1e6913c3c7184e2e83c94b6ff243831d` 因只获取 main 而不认识分支 commit 失败（git 128），
未开始检查；未修改 main、队列规则或生产部署来消除这一边界。

来源纠偏（同日）：上段第一次检查实际由开发机 `git archive` 经 SSH 传送源码，违反“远端源码只经 GitHub”
的交付要求。该目录的旧日志、回执保持原样，但其结果不作为有效交付证据。后续在 CI 独立 bare 库
直接从 GitHub 获取 `codex/knowledge-conformance-completion`，FETCH_HEAD 为
`8e95706c39c5f5ec5f0d8581bd560d467e0698c2`，核实被测固定提交 `2c36300689060f0794248ffd4fcb3ecf06bf8995`
是其祖先；只读复用 CI 已有对象并指定 negotiation-tip，未改共享源码库、main 或队列规则。
源码归档和展开均在 CI 执行，未从开发机传输源码。

第一次 GitHub 来源重跑误写 `conformance/receiver-run.sh` 路径，退出 127，未开始测试；失败回执在
`/volumes/data/kailo/conformance/checks/github-2c36300689060f0794248ffd4fcb3ecf06bf8995/`，保留原样。
纠正为 `tools/component-release/receiver-run.sh` 后，在另一个新目录重复上述检查，全部退出 0，
既有测试 10/10 通过；容器实际限制和镜像与上段一致。有效定向回执在 CI
`/volumes/data/kailo/conformance/checks/github-2c36300689060f0794248ffd4fcb3ecf06bf8995-2/receipt.json`，
同目录 `checks.log` 保存完整输出。两次临时检查容器均已移除，旧隔离服务未改动。
这只证明所列定向检查；真实 PKCE、platform 完成后的 contracts/action-token 及知识库接收方
native → bootstrap → seed → inputs → driver 仍未获得本轮成功证据。
