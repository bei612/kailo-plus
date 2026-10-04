# Catalog ComponentRelease 批准的实现证据

2026-10-04，本批承接登记及丢 ACK 恢复，不改变原登记套件门禁。当前范围是已支持的外部 `APPLICATION / REMOTE_ADAPTER / protocol 1 / frontend NONE / model NONE`。批准不代表 binding 激活；撤销、binding 治理、具体第三方 Adapter 的运行验收均不在本批完成声明内。

## 权威、影响与边界

- 权威为 `.design/03` §7 的 ComponentRelease、PlatformBuildInfo 与 `.design/05` §2.8 的 `component_release.approve`：Catalog Tenant HUMAN/manage、TENANT_ONLY、原 ApprovalWorkflow、TENANT_ADMIN 一人、登记人与申请人职责分离、原 COMPONENT_RELEASE 任务。没有第二 registry、审批或审计权威。
- 共享管理页通过原 ActionCommand 的可选 `componentReleaseId` 发起，WAITING 只表示审批等待；Web/Desktop 使用同一 TS 模块。既有登记输入和旧页回应仍可读，Mobile 不新增组件宿主。原 AE 新增不可变兼容观察、release 新增批准 AE 引用；18000 是向前扩展，遇任一批准 AE 或兼容观察的 down 明确拒绝丢证据。
- 批准前重读 ACTIVE 能力契约并比对原登记 plan 的确切合同摘要；原 Worker 以编译来源覆盖输入中的 build 声明，Core 读取自己的编译来源和当前 Web 原产物文件，三主体兼容后才在同一事务写原 AE 观察、APPROVED 与审计。没有用户 pass、管理员兼容勾选或生产凭据回退。
- 并发批准只允许 REGISTERED→APPROVED 一次。提交 ACK 丢失按原 AE 返回已落库回执，不重写兼容观察。失败、撤权、缺配置、未知协议不批准；观察不可用返回原 UNKNOWN/DEPENDENCY_UNAVAILABLE，继续原任务的对账/ContinueAsNew，修复主体为平台部署管理者。原 compile-time 来源缺失不能用运行期环境伪造，须按原发布工具重建；零业务 binding 平台不因此停止启动。

## 已运行的定向证据

全部工具链运行于既有镜像化 SDK，4 CPU/8 GiB，Cargo 并行 16；源码与缓存位于 Data。没有生产数据库写入、模型请求、产品构建或部署。

```text
go test ./workflows ./activities -run TestComponentRelease -count=1
ok apps/worker/workflows
ok apps/worker/activities [no tests to run]

cargo test --offline -p platform-core --bin platform-core component_release:: -- --nocapture
test result: ok. 7 passed; 0 failed; 2 ignored

cargo test --offline -p platform-core --bin platform-core original_registration_approval_evidence_and_audit_are_atomic -- --ignored --nocapture
test result: ok. 1 passed; 0 failed

cargo test --offline -p platform-core --bin platform-core platform_build_info:: -- --nocapture
test result: ok. 1 passed; 0 failed

cargo clippy --offline -p platform-core --all-targets -- -D warnings
Finished dev profile
```

存储证据使用独立数据库与上一登记批实际 Go HTTP wire 观察，先调用原 `persist_registration`，再调用生产批准持久化消费者。原审批投影缺失时整笔回滚、状态保持 REGISTERED；原审批投影存在后批准、审计与受作用域目录读一致；登记人和申请人不可成为审批人；兼容报告不可改写；占用证据时 down 失败。该证据不冒充实际 OIDC、SpiceDB、Temporal、OpenBao 或三主体部署联调。隔离库上的 18000 up/down/up 已成功。

主动破坏生产判断：关闭 Core 协议兼容判断，Rust 目标失败退出 101；删除 Worker 的 APPROVED 回执判断，原任务目标失败退出 1；删除共享页面 `canApprove` 条件，页面目标失败退出 1。三处已原样恢复，Core/Go 恢复目标及 Clippy 均退出 0。在独立库把原 release trigger 临时改为直接放行，实际存储消费者的「无审批不可批准」断言失败退出 101；以原 down/up 恢复 trigger 后，同一已编译目标实际 1 passed、退出 0，没有编译或修改生产数据库。首次 Core 编译中的 import/借用错误已修；Clippy 首次遭遇共享缓存旧 contracts 类型，定向清理该包派生缓存后重新编译，又修正重复职责分离分支，最终退出 0；这些失败不算通过。

共享页最终 `typecheck` 与 7 个页面目标退出 0；缺少批准 capability 的负向断言抓住上述 UI 变异。新增批准报文沿原四侧往返入口验证：TypeScript 6 passed、Rust 5 passed、Go 指定批准往返目标通过、Dart 11 passed，均退出 0；原 `tools/gen.sh --check` 四侧与 Mobile i18n 比对通过。Dart 首次因生成 DateTime 将同一 RFC 3339 瞬间由 `00:00:00Z` 序列化为 `00:00:00.000Z` 而失败；按原 ADR-03 语义往返要求规范化该时间字段后恢复通过，其余字段仍逐项完整相等。最终 Core all-target Clippy 再次退出 0。全量检查、提交/push 与部署由主线集中执行，本记录不将其提前声明为完成。

## 承接已发布登记与步骤审批批次

批准源码增量从原登记恢复树 `5007a5e3fa4a9be6d2589ea193a4613fcc0e1923` 移植到正式提交 `dd57f8bbf85fdf0b7b91e6e6aea445a909c0b046` 的独立 Git 候选，不改正式工作树或其 index。此轮只做源码合并，不生成、不编译、不构建；上节结果属于原批准候选，不能作为新组合树已验收的声明。

- 权威不变：仍为本记录首节的既定批准动作、原审批与 COMPONENT_RELEASE 工作流，以及无前端、无模型调用子集；不包含 binding、生产 NONE-policy 修订或第三方适配。
- 影响为原四侧往返入口、Core governance/main 接线与追溯并集；保留正式树已有组件引用/UNKNOWN、POST_MESSAGE、步骤审批样例和 consume 逻辑，只追加批准报文与动作。契约源增加的可选字段和 18000 扩展仍由下一集中批次沿原四侧生成链核验。
- 副作用边界不变：未覆盖登记 lost-ACK、ContinueAsNew、撤权后在途 native 对账修正；未重写登记报告或放宽原 fresh 授权，也未把待批准状态显示为已批准。追溯端范围保留正式树的 Web/Desktop，不把 Mobile 误列为组件宿主。
- 异常与兼容仍由原登记、批准消费者处理，未增加新状态、重试路径或兼容窗口。三方应用后实际五处文本冲突均逐块合并保留双方有效内容；`git diff --cached --check` 退出 0。组合树完整验证与生成由主线统一执行。

集成复核补齐原发布来源断言：`tools/release.sh` 实际向 Core/Worker 编译投递
`PLATFORM_BUILD_ID=$COMMIT`，其 provenance 原先仍只记录 Runtime 镜像参数。
现将同一 commit 写入 `externalParameters.buildArgs.PLATFORM_BUILD_ID`，不新增配置源。
`bash -n tools/release.sh` 退出 0；直接执行脚本中的原 provenance Python 段，截获输出
并分别核对 Core/Worker 参数，输出 `PASS original Core/Worker provenance; missing
build-ID mutation rejected`、退出 0。内存中删除该字段后原断言实际报 KeyError；
文件未写入变异。此项不构建、不生成实际发布来源文件，也不代替产品构建或部署验收。

## 本批共享 Web 产物（未部署）

同一候选只运行一次原 `tools/build-upstream.sh web-client`，实际退出 0。
原入口回读既有 `kailo-core-data` BuildKit 为 8 CPU、16 GiB、swap 0，缓存位于
`/volumes/data/kailo/buildkit-core-state`；未修改资源限制或 Cargo 并行度。
source 为 `sha256:2859cbde1d6101e44e8de1e5a9e6cb59f8edd681fe880572046d1dedebdffec3`，
artifact 为 `sha256:7df928821ac674deebd167b51c9b5326107e4f04ad9715a2bfe01a0bfead6e3d`。
构建原日志 `t86sPU/web-build.log` 的 SHA-256 为
`443628959960b7a23fff88d0fa8c8314bdd8cfe66f0d64967e886793e9812871`；本节的
`t86sPU` 指 `/volumes/data/kailo/tmp/codex-component-approval-rebase-20261004.t86sPU`。

独立 registry 读回 HTTP 200，`Docker-Content-Digest` 与该产物一致；首次探针未声明
OCI manifest Accept，收到 HTTP 404/curl 22，补齐实际 OCI 媒体类型后读回成功，
没有重构建。直接从该镜像提取 `platform-build-info.json`，BUZZ_WEB、确切 source
buildId、NONE Host API 和空协议/驱动/port 列表均核对通过，reportedAt 为
`2026-10-04T14:43:21.684Z`。只创建未启动的临时提取容器，读完已删除；未改变在线
服务。原来源清单、Compose Web pin 和 16 份既有 trace 同步该实际产物，不代表部署。

## 组合批次检查回执

原 `tools/gen.sh` 四侧及同源文案生成退出 0；193 个 schema、生成同步和三份历史
兼容比对通过，原文档快检查退出 0。首次生成因短检查容器没有原 SDK 的
`HOME=/cache/home` 而退出 255；首次文档检查因设计与源码挂载层级不一致退出 1。
恢复既有执行配置后通过，不修改生成脚本、合同或门禁。原件为上述目录中的
`gen.log`、`contract-final.log`、`docs-final.log`。

固定产品树 `ad632808efca87f5c6599cd51639ec85a07a0b86` 的首次原
`./tools/check.sh --full` 退出 1，唯一失败项为正在同批打包的 Win11 来源摘要尚未
更新；Web 已在本次检查中读到新产物。原始 `full.log` SHA-256 为
`725eebf27cceca70c24d97186188ce4fa84229313708d9af82d6fae607514ce7`。
静态检查、四语言验证、Workflow replay、20 份 trace、供应链和安全检查均通过；
独占空库实际完成 73 条迁移（最高 18000）、回退再前进、SQLx 和 44 项枚举约束。
Core 为 155 passed/8 ignored，另两项显式外部演练 ignored；实际部署 `.env` 预检
SKIP，未安装 gitleaks。测试库在读回零连接后删除，业务数据库未动；原件见
`full-handoff.md` 及 `full-db-readback.log`、`full-db-cleanup.log`。本段不是 full
退出 0、提交、部署或真实批准业务链已验收的声明。

Win11 本批同样只启动一次原打包。TypeScript/Vite、Windows native release、NSIS
及 BuildKit export 完成后，原 helper 因私有 `dist` 目录写权限退出 1；原件
`desktop-build.log`、`desktop-build.exit` 保留该失败。已导出的唯一安装包仍在，
只修复本批产物子目录归属并执行原 install/来源登记尾步骤，退出 0，没有重构建。
安装包为 15,125,122 字节，artifact 为
`sha256:e67d95840dff301043c00c82dc689b1b8ae01e9a7f517ff99abec5f9e561c8c9`，
source 为 `sha256:f325582b23dfd5e5f9e71844e85052857b28f3133dda883fab54cae9ad292889`。
2,269 项实际输入前后逐项一致，两份锁文件核对通过。原 helper 失败不改记为通过；
安装包仍未签名、未设备验收，也未据此改变在线服务或公开下载入口。

最终产品与产物记录冻结为 `0980546205fc1bfa8264e0aca9a0848025933cbd`，
相对 `dd57f8bbf85fdf0b7b91e6e6aea445a909c0b046` 为 64 文件 +1990/-68。
同一受限 SDK、缓存与原 `./tools/check.sh --full` 的最终结果为退出 0、
`全部通过。`，没有重导源码或再构建产品。`full-final.log` 的 SHA-256 为
`d0ef4f4b50d28bad9ea14b3eae6fbe367c4538cc55fdba9a3dd3039f207ce7f9`，
`full-final.exit` 记录 `full_exit=0`。本次同样实际完成 73 条迁移往返、SQLx、
44 项枚举约束、193 个 schema、四语言检查与 replay、20 份 trace、六份来源
和 30 个服务安全检查；前述 ignored、部署预检 SKIP、无 gitleaks 及签名/设备
边界不变。原失败不覆盖为成功；本段及 README 的结果更新仅走原文档快检查。
独占测试库读回零连接后删除，业务库、在线容器与第三方服务均未改变。
