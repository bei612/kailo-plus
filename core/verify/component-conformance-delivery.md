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

## 7. 知识库原生实例编排（2026-10-26，尚未端到端验收）

`33037a92cb0b6b23bb55b7e015d3543e619355a4` 与
`42ec58e2deb961919df8654939b9bea6cedc1322` 补入下列真实入口的编排：

- 原版 `provision.py native` 为本次隔离实例声明独立 OIDC client、OpenBao namespace、固定 KV 版本与一次性 Agent 投递；
  原版 Compose 入口使用独立数据库、网络、回环地址以及源码声明的固定镜像，首次先启动依赖，再应用平台模型覆盖。
- 隔离 Catalog 的原版 register → 不同管理员 approve → Tenant bind 创建原生页面 binding；成员目录 client 使用该隔离平台的投递。
  原版 native-model-delivery export/prepare/Agent/materialize 交付模型 key，私网容器实际调用 embedding，并核对声明维数。
- `receiver-knowledge-native.mjs` 经原版 OIDC 登录取得目录投影的 Admin 会话，再由原生 API 创建 KB 和仅覆盖该 KB、明确五个工具的 MCP endpoint。
  续跑固定观测到的用户、Tenant、KB、endpoint；只使用原生 token rotation 恢复丢失的 endpoint bearer。会话刷新与对象创建共享排他锁，失败释放。
- 种子入口支持这个实际 OIDC Bearer。DD-133 的 Admin 不能创建 Owner-only API key；运行器没有把管理员升为 Owner。
  实际 Core 会话与原生会话沿同一刷新入口更新。

这仍不是已跑通的接收方：源 Cells 的真实 Core adapter/native-action 投递、接收方 adapter 与 forward adapter、
bootstrap 资源/授权、seed 输入、observe/inputs、driver 输入仍待自动生成。运行器在已实现阶段之后明确拒绝并记录
`blockedAfterNative`，没有用模拟 provider 或手签 token 代替真实接收链。

定向检查源码均由 CI 直接 GitHub fetch，再从固定对象在 CI 本地解包。最终被测提交为 `42ec58e2d`，
检查镜像 `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`；
限制 1 CPU、512 MiB 内存及 swap 上限、128 PIDs、无网络、只读根文件系统、无 capabilities。
Node/Python/Bash 语法、生产部署路径拒绝、并发锁排他与失败释放均通过；已有 seed/provider 单元测试 10/10。
这些单元测试使用的测试替身不构成接收方业务证据。最终回执退出 0：

`/volumes/data/kailo/conformance/checks/github-42ec58e2deb961919df8654939b9bea6cedc1322/receipt.json`

同目录保存完整 `checks.log` 和 `check-command.sh`。此前 `33037a92c` 的两次检查脚本错误
（错误要求拒绝 stdout 为空、导出源码时遗漏 `client-kit/adapter`）及第三次通过的回执全部保留；
对应目录为 `checks/github-33037a92cb0b6b23bb55b7e015d3543e619355a4`、其 `-2`、`-3` 后缀目录。
本轮检查容器均已移除，旧 receiver 栈未重启或清理，也未启动新的原生实例。
本分支仍声明旧知识库镜像，等待匹配源码的新镜像与资源窗口后，才能给出真实 OIDC/目录/模型及 receiver E2E 结论。

后续 `cc9bcee85` 为 bootstrap 声明本次项目限定的 SpiceDB Docker 地址，并把模型探测放在声明模型主机别名的 edge 网络。
`6813eb7eb8919e75078222f81192eab3762665d8` 继续复用 Cells 原生安装、CLI PAT、REST 用户和 reconcile 入口，
为 receiver 准备独立源实例及冻结向量要求的三个源目录。目录 UUID 仅作为 Create API 提案；只有后续原生回读确认
UUID、COLLECTION 类型和所属 workspace 后才记录为事实。重试先读取原生对象；已确认过的对象缺失时拒绝重新造对象。
这次没有调用 Cells 的模拟 provider，也没有预先给出 Core Resource ID；后者仍须由 bootstrap 的真实 resource.create 返回。
该入口已接到 native 阶段之后，源 adapter/native-action 的 Core 投递及后续步骤仍明确拒绝。

固定提交 `6813eb7eb` 的同规格 CI GitHub 来源检查退出 0：语法、路径/锁边界、Cells REST v1/v2 路径和
404/401 拒绝语义、实际冻结向量分类（三个源 Resource 前置条件）及已有 10 个单元测试通过。
回执 `/volumes/data/kailo/conformance/checks/github-6813eb7eb8919e75078222f81192eab3762665d8/receipt.json`，
同目录含命令与日志。未启动 source Cells、WeKnora 或新 receiver；以上仍不是原生运行或端到端证据。

接线交叉核对还发现 Gateway 机器身份尚无自动交付：隔离 `.env` 会清空生产 `GATEWAY_SERVICE_*`，
而两个 adapter 的 MCP 模板要求独立 Gateway issuer/caller/JWKS。原 `start-core.sh` 只消费、校验并派生该组配置，
私钥必须留在 Gateway 独占 provider-secret 目录，Core 只取得 public-only JWKS；服务身份与 Tool Session 必须完整交付。
后续需要在本次隔离 OpenBao 托管该独立身份、沿原 Agent 交付到本次 Gateway 私有卷，并沿原启动入口生效。
不复用生产签名材料，不以测试 provider/手签 token 代替，也不把签名私钥伪装成某个模型 route 的 provider credential。
这与源/接收 adapter 的 SecretRef/IdP client、native-action、bootstrap/seed/inputs/driver 编排一起仍未交付。

## 8. 隔离机器身份与接收方凭据编排（2026-10-26，定向检查）

本节更新第 7 节末尾的“尚无自动交付”：代码已补齐以下部分，真实运行仍待匹配镜像和受限资源窗口。

- `8514021ab` 修复恢复语义：已确认 KB/MCP endpoint 缺失时在 POST 前拒绝，身份与每个原生对象确认后立即原子持久化。
  artifact digest 改用原 `tools/upstream_manifest.py` 解析后的精确条目，拒绝缺失/重复名称，不能跨条目借用摘要。
- `f1399ad15`、`435dc1688` 在隔离 OpenBao 中 CAS0 保存独立 Gateway EC 机器密钥。
  原 OpenBao Agent 将私钥以 Gateway 实际 uid 的 0600 文件投递到本项目独占卷；Core 只接收公开 JWKS。
  完整 Gateway 服务身份与 Tool Session 配置通过原 `start-core.sh` 生效，重建后恢复 receiver 网络别名。
  运行器不签 token、不复用生产身份、不把私钥交给 Core。
- `d180b94a0`、`1dd9a5689` 修复接收模型归属：原模型交付要求 `is_builtin=false`，不能把原生页面 binding 的内置模型
  当成 receiver binding 的原生模型。运行器经原生 API 创建两个无密钥租户模型，逐项确认并保存原生返回的 UUID，
  KB 只关联这两个模型；后续模型密钥仍须通过真实 binding 投递及原生 proof 回执，当前未执行。
- `4ec9583eb`、`48bb217a1` 复用原 `component-bind --plan-only` 固定两个 binding 的提案，
  把本次原生 PAT/MCP bearer 以及独立 OIDC client secret 写入隔离租户原 KV 路径，固定 version=1，CAS0，拒绝漂移和跨租户路径。
  这些提案不是已创建的 binding/Principal。adapter 配置、AppRole reader、Agent HCL 和 IdP service client 继续使用原
  `adapter-delivery.py`；Cells 使用原通用 Agent Compose，WeKnora 使用自身原 Agent 服务，不竞争同一 socket。
  新增源 Agent 在启动前记录所有权，关闭本次运行时可回收；续跑保留已接入的原生配置覆盖层，确认对象缺失不重建。

有效 CI 定向回执（所有源码均为 CI 直接 GitHub fetch，随后 CI 本地从固定对象展开）：

| 固定提交 | CI `/volumes/data/kailo/conformance/checks/` 下回执 | 结果及范围 |
| --- | --- | --- |
| `8514021ab0e843bce63861957390444b6059bb0a` | `github-8514021ab0e843bce63861957390444b6059bb0a/receipt.json` | 原检查、5 项 native 恢复与 4 项 artifact 解析通过 |
| `435dc168834806d2252608a398ecf60328d2cd6b` | `github-435dc168834806d2252608a398ecf60328d2cd6b/receipt.json` | 另 3 项 Gateway 单元检查通过；原 OpenBao Agent 内部 test-only 配置解析退出 0，未认证、未运行真实投递 |
| `1dd9a5689e2cb690867fd6a6527ea8321b2cd2f2` | `github-1dd9a5689e2cb690867fd6a6527ea8321b2cd2f2/receipt.json` | 7 项 native 恢复/模型检查、原 10 项 seed/provider、4 项解析等通过 |
| `48bb217a131fe782ba99c3395e0e948c1af1ed10` | `github-48bb217a131fe782ba99c3395e0e948c1af1ed10/receipt.json` | 前项检查及 3 项固定 SecretRef 单元检查、3 项 Gateway 单元检查通过；编排仅语法检查 |

以上检查镜像均为 `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，
1 CPU、512 MiB（swap 同限）、128 PIDs、只读根文件系统、无 capabilities、`network=none`。
OpenBao SDK 配置解析另用原固定镜像 `openbao/openbao@sha256:7d26314820a535ef346f1e63911809e4d356b48068fef00a9dcb3400bb9e11b6`，
0.5 CPU、128 MiB、64 PIDs、无网络，只执行原源码声明的内部测试配置解析参数，不把该参数加入运行时自动化。
`d180b94a0` 首次检查将正常 auth/refresh POST 误算业务对象重建而失败；其原回执保留，后续仅修正断言并重跑。
测试 HTTP fixture 只验证实现边界，不能当成真实 OpenBao、IdP、Gateway 或接收方业务成功。

仍未闭合：源 Cells native-action 与 driver 需要真实 `ResultExposurePolicy` ID/version；本分支目前找到的业务创建路径
是 `delegation.rs` 的真实 grant scope，bootstrap SQL 不创建该业务对象，`isolated-plan.py` 的模拟 UUID 不能替代。
还需 adapter directory/nativeResources、真实 receiver model-delivery proof 与 binding 激活的协调、bootstrap/seed/inputs/driver 全链编排。
`blockedAfterNative` 保留明确拒绝；未启动新 receiver/Cells/WeKnora 栈，未改动生产，未重启或删除遗留栈。

已确认的策略依赖环（本分支 `48bb217a1`，不是操作员遗漏配置）：
`core/crates/platform-core/src/delegation.rs:743` 的 `validate_application_scope` 在 791–812 行要求
真实 ACTIVE AgentInstallation、ToolBinding、APPLICATION Tool，以及 ACTIVE application_binding 与
application_runtime/gateway_state；策略到 1011 行才随真实 grant scope 写入。
与此同时 `file-storage/deploy/start.sh:160` 起校验原生动作投递，204 行起要求 write 的真实 policy ID/version，
delete/share 有相同要求；312–368 行又要求 adapter 的各动作与该原生投递一致。
`tools/component-release/receiver-run.sh:279` 的 native 阶段先执行这些启动检查，bootstrap 才创建并等待 binding ACTIVE。
因此“先 delegation 生成 policy”也无法使第一套源 binding 启动。主会话已从原源码复核，负责沿 HUMAN
componentAction 准入链处理生产者缺口；本自动准入入口保持门禁，不复用 delegation 策略，不用 SQL 或模拟 UUID 补齐。

`e68efa7bf11cc984b81602df049e849ac457efbc` 继续实现目录与 bootstrap 输入生成：首次原生 KB/目录观测固定留存；
按本次隔离 CoreDB 的项目标签和会话 Catalog Tenant 执行只读查询，取得已 ACTIVE 的原始契约内部 ID
（公开列表不投递此字段）；bootstrap 会再次核对完整 registration。原生对象只作为 evidence/nativeRef，
Resource ID 仍由后续真实 `resource.create` 返回。目录沿原 renderer 生成到独立 `receiver/public/`，
与 Agent 私密输出分开；bootstrap 输入与创建/授权 idempotency 提案在执行前固定，恢复时不允许改写。
该阶段只准备输入，不启动 adapter、不激活 binding、不执行 bootstrap。
同规格 GitHub 来源 CI 回执 `checks/github-e68efa7bf11cc984b81602df049e849ac457efbc/receipt.json` 退出 0，
延续前述 27 项单元检查及语法/路径检查；bootstrap 生成器本身仅完成 Python AST 检查，未在新隔离数据库执行。


2026-10-26 Core 生产者后续：按主会话分工，适配器专用分支已沿原 binding 准入事务实现
HUMAN 最大暴露边界物化和精确归属消费，见 [Core 实施与验证边界](application-human-exposure.md)。
该改动解除的是源码中的生产者缺口；自动化尚需读真实 HUMAN 管理元数据并在 binding 准入与
adapter/native-action 启动之间协调。未跑真实新 receiver，`blockedAfterNative` 仍不能移除。
