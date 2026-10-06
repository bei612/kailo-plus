# SS-BUZ-GOVERNANCE 接缝证据

对应 `SF-BUZ-37`、`SF-BUZ-38`、`SF-BUZ-45`、`DD-80`、`DD-106`。补丁：`patches/0001-owner-governed-communities.patch`
与 `patches/0002-governed-relay-workflows-off.patch`，基于 `779af8886caae1317b4de962082429867ab61503`，由
`tools/build-upstream.sh buzz` 构建。

## 为什么必须改上游

原生端本机持钥直连 Relay（`DD-75`），Core 不在它的发布路径上。上游的 NIP-29 权限比
Kailo 宽，且 `RelayConfig` 没有收紧它的开关（`SF-BUZ-37`）。对一个已在 relay roster 上的
成员，上游允许：

- 自建 Channel，并成为其 owner；
- 把自己加进 open Channel，或申请加入；
- 读写任何非 private Channel；
- 开 DM，定义由 Relay 执行的 workflow，建 huddle、git 仓库、forum、canvas。

另外有两条旁路：一是 kind 9007 缺 `visibility` 时 Channel 按 `open` 建立（`SF-BUZ-38`）；
二是 huddle 音频 WebSocket 不经过事件 ingest，最后一人离开时会归档所在 Channel。

补丁前实测：新的核验用例在上游镜像上第一项就失败，一个 roster 成员自建 Channel 得到
`accepted: true`。

## 补丁做了什么

一个运行期开关 `BUZZ_MEMBER_EVENT_KINDS`：成员可发布的 kind 列表。设定之后：

| 面 | 行为 |
|---|---|
| 事件 ingest（WebSocket EVENT 与 HTTP `/events` 共用） | 列表外的 kind 只接受 Community owner 签发；owner 按**已认证的调用方**判定，不按事件签名者——gift wrap 由一次性密钥签名 |
| WebSocket 的 ephemeral 与 observer 分支 | 同一道检查。这两类事件不进 ingest，不在这里拦就是旁路 |
| Channel 准入 | 只看 roster；`open` 不再放行非成员 |
| kind 9007 / 9002 | Channel 必须 private：创建缺 `visibility` 或非 `private` 被拒，改元数据改成 `open` 被拒，owner 也一样 |
| huddle 音频 WebSocket | 不提供（404） |

未设定时补丁不改变任何行为。空值合法，表示成员什么都不能发。

### 同一开关关闭 Buzz 自带 workflow（0002，DD-106）

上游的 workflow 引擎在每次启动时无条件装配（`SF-BUZ-45`）：只挡成员发布命令 kind 不够，Community
owner 仍可定义与触发，cron 循环、成员 kind:9 触发 `message_posted` 与只凭 secret 的 `POST /hooks/{id}`
都可达。开关设定时：

| 面 | 行为 | 实现 |
|---|---|---|
| 引擎 | 不构造 `WorkflowEngine`，因而没有 `RelayActionSink`、cron 循环，持久化事件不调用 `on_event` | `AppState.workflow_engine` 改为 `Option`；`main.rs` 只在未治理时构造、挂 sink、起 cron；`event.rs::dispatch_persistent_event_inner` 无引擎即返回；命令执行器与 webhook 处理器无引擎即拒绝 |
| ingest | 30620、46020、46030、46031 与 `a` 标签指向 30620 的 kind:5 一律拒绝：`relay workflows are disabled in this community`，owner 也一样 | `governance::check_workflow_event`，在 `ingest_event_inner` 验签之后、owner 判定之前，因此早于命令分支与 `handle_a_tag_deletion` |
| HTTP | `/workflows/{id}/runs`、`/workflows/{id}/runs/{run_id}/approvals`、`/hooks/{id}` 不注册 | `router.rs::build_router` 只在未治理时挂这三条 |
| 启动自检 | 三项逐项确认，任一不成立 Relay 退出、不监听 | `governance::verify_workflows_disabled`，`main.rs` 在 `build_router` 之后、绑定端口之前调用 |

启动自检对要上线的那个 router 发探针：用路由不接受的方法（`GET /hooks/…`、`POST /workflows/…`），已注册
答 405、未注册答 404，结果不依赖处理器或数据库。探针以 loopback 来源发出：未匹配的请求会经过内部 git
policy 路由的 localhost-only 层，非 loopback 来源一律得到 403——这是上游对所有未注册路径的行为，因此从
容器外探 `/hooks/{id}` 看到的是 403，与探任一不存在的路径相同，从容器内（loopback）看到的是 404。

Kailo 的取值是已交付能力所需的 kind。历史消息交付批只投递 `9`：Channel 消息，
附件以 `imeta` 随消息发出；这不是设计禁止本人资料 `kind 0` 的依据。
列表每多一个 kind，就多开放一种成员可发布的协作能力，因此它随 `apps/05` §7 的能力分配一起变更。

### 本人资料的配置与原生边界核对（2026-10-06）

设计 `09` §3 的 Browser/BFF 边界明确覆盖 profile；`SS-BUZ-GOVERNANCE` 要求限制管理类
事件，并未将本人资料声明为 CONTROL 管理动作。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-relay/src/handlers/ingest.rs::ingest_event_inner` 与
`crates/buzz-relay/src/handlers/event.rs::handle_event` 均校验普通 event 的 pubkey
与已认证调用方一致，kind 0 不适用 gift-wrap 的署名例外。资料正文继续归 Relay 的原生
kind 0 replaceable event，不为其新增 Core 资料正文库。

当前 `collaboration/crates/buzz-relay/src/config.rs::Config::from_env` 的成员 kind
列表解析已支持 `0`；`deploy/local/compose.yaml` 从唯一运行配置透传该字段，
`tools/check.sh security` 要求显式赋值而不硬编码只能为 `9`。因此支持本人资料不需要
新开关、新解析器或放宽上述检查。`0` 不授予 NIP-29 管理权限，不替代 NIP-42/NIP-98
认证、Relay 成员校验、暂停/撤权收敛或事件验签。未设置变量会恢复上游行为，不能把
删掉变量当作启用资料功能；显式空值仍拒绝全部成员 kind。

本次仅核对这些原有配置与源码事实，未改变线上运行配置，也没有重启 Relay。
kind 0 的当前客户端保存、读回及越权拒绝，必须由资料链的实际验证证明；本段不把
解析器支持写成已部署或用户资料功能验收通过。

## 实测

`core/crates/kailo-buzz/tests/bridge.rs::members_cannot_govern_the_community`：先让一个成员
进入 relay roster 与其中一个 Channel 的 roster，再逐项尝试。每项都必须被拒，而且理由必须
指向治理规则——被别的原因拒掉证明不了治理生效。

| 尝试 | 结果 |
|---|---|
| 在自己的 Channel 发消息（kind 9） | 接受 |
| 自建 Channel（9007，private） | 拒绝：`reserved to the community owner` |
| 把自己加进别的 Channel（9000） | 拒绝：同上 |
| 申请加入别的 Channel（9021） | 拒绝：同上 |
| 改自己 Channel 的元数据（9002） | 拒绝：同上 |
| 加 relay 成员（9030） | 拒绝：同上 |
| 发全局事件（kind 1） | 拒绝：同上 |
| 向不在其 roster 上的 Channel 发消息 | 拒绝：`not a channel member` |
| 读自己的 Channel | 读到 |
| 读别的 Channel | 空 |
| owner 建 `visibility=open` 的 Channel | 拒绝：`channels in this community are private` |
| owner 建不带 `visibility` 的 Channel | 拒绝：同上 |

`core/crates/kailo-core/tests/native_client.rs` 在真实拓扑上补一项：已登记的原生设备能直连
Relay 发消息，但自建 Channel 被拒。

`crates/buzz-relay/src/handlers/governance.rs` 的单元测试（在补丁源树里跑，Postgres 与 Redis 不可达也成立）：

| 测试 | 断言 |
|---|---|
| `governed_relay_refuses_every_workflow_event` | 四个命令 kind 与删除 30620 的 kind:5 被拒；删除 30023 的 kind:5 与 kind:9 放行到后续检查 |
| `governed_relay_serves_no_workflow_route` | 三条路由都 404 |
| `governed_relay_without_engine_refuses_workflow_commands` | 无引擎时命令执行器拒绝 |
| `ungoverned_relay_keeps_upstream_workflows` | 未设定开关时上游行为不变；探针在已注册时得到 405，证明它能区分 |
| `self_check_passes_only_when_all_three_are_off` | 全部关闭时通过；构造了引擎、或 router 带 workflow 路由，自检各自失败并指出哪一项 |

## Core 侧的配合

- Channel 以 private 建立，id 取 Workspace id（kind 9007 带 `h`）。Channel 在 Community 内
  按 id 唯一，重试时重发同一个 id 由 Relay 判为「已存在」而不另建；Core 再回读该 Channel
  的 roster，确认 CONTROL 在上面才绑定。此前的做法是比对创建前后 CONTROL 的所属列表，
  「事件被接受、回应丢失」之后的重试会造出第二个 Channel。那个列表还被分页上限截断，
  Workspace 一多就会漏掉。
- 测试夹具退役时经 operator 面归档自己建的 Community。operator 面只能按 owner 列举，
  CONTROL 身份一删那个 Community 就再也找不回来，此前本地 Relay 因此攒下 269 个
  测试 Community、200 个 open Channel。本地 Relay 状态在换补丁镜像时重建；那些
  Community 都没有被 Core 的任何 binding 引用。

## 门禁

`tools/check.sh security` 要求两件事：Relay 显式给 `BUZZ_MEMBER_EVENT_KINDS` 赋值（只写键不给值等于从宿主透传，
宿主没有时容器里就没有，不算设定；`environment` 用列表写法时同样检查）；每个跑 Buzz
二进制的服务都用 `upstream-buzz@` 的补丁构建，包括以 `buzz-admin` 建 schema 的一次性服务。
分别破坏了三处——删掉开关、Relay 换回上游镜像、buzz-schema 换回上游镜像——每次都报出
对应服务，还原后逐字节一致。DD-106 之后又破坏了三处：删掉开关、只写键不给值、把 Relay 的 `environment`
改成列表写法并删掉开关，每次都报出 `buzz-relay`；列表写法且带开关时通过；旧规则在列表写法下放过了缺开关的
配置。还原后 compose 逐字节一致。

## 仍按 Tenant 而不是 Workspace 隔离的

以下读面在 Community 内对所有 relay 成员可见。Community 与 Tenant 一一对应（`DD-01`），
因此它们的隔离边界是 Tenant：

- 不属于任何 Channel 的事件，包括 kind 13534 relay 成员列表。列表仍只由 Relay 与
  owner 写入；若运行配置允许 kind 0，本人资料同样属于 Community/Tenant 读面，
  不具备 Workspace 私密性，也不表示普通成员能发布任意全局事件；
- 媒体按内容 hash 读取，不校验 Channel。拿得到 hash 就等于看过引用它的消息。

## 2026-10-06 原头像宿主策略边界

设计提交 `7fcd19e0c430edbbbc828041040fc185c9fa6328` 已推送并从远端
`design-authority` 回读一致；相对 `1b235beedb8cf41a612129504b45c73151b27a18`
仅 `09` 一文件 +8/-0。它落实用户要求的原版功能复用，不改变 DD-60 的组件来源边界。

- 权威与状态：REQ-08、SF-DSK-03 和 `.design/09` §3，原控件属于宿主；
  `openAvatarCamera`、`stopAvatarCamera`、`createSegmenter` 已在 Buzz
  `779af8886caae1317b4de962082429867ab61503` 的
  `.references/buzz/desktop/src/features/profile/lib/animatedAvatarCapture.ts` 核对，
  同提交 `.references/buzz/desktop/src-tauri/tauri.conf.json::app.security.csp`
  已含 `wasm-unsafe-eval`。上游支持控件，不等于当前 Web 已交付。
- 影响面：原共享头像控件、同源静态资源、Web 安全头与 `07` 运维行；
  本次策略澄清不新增实体、契约字段、迁移、工作流或密钥权威。
  Web 仍经 BFF，Desktop 仍本机持钥，Mobile 不增加组件宿主。
- 副作用：仅宿主 WASM 与用户主动摄像头许可；不添加外域脚本、JavaScript
  `unsafe-eval`、麦克风或跨源 frame 摄像头委派。`camera=(self)` 是同源级权限，
  不能当作同源模块之间的隔离。组件 release 与 binding 均不能改写这些策略。
- 异常边界：拒绝授权、无设备、非安全上下文、资源失败须明确显示，不声称成功；
  退出采集与切换身份释放媒体轨道。资料写入仍由本批自己的签名、准入和终态链决定，
  不由静态头像控件推断保存结果；此澄清没有启用线上 kind 0 或更改线上权限。

原 `tools/check-docs.sh` 在固定 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
的 2 CPU / 2 GiB 容器内执行：首次部分源码快照缺少被链接的验证文档而退出 1；
改用完整工程上下文并只覆盖本批 `07` 后实际退出 0。两个检查均未改动检查器。
最终日志 SHA-256 为 `1ca07009db993cc1efae6e847eb605292971018613aa3e2ec0840aa06468acde`，
初次失败日志为 `c6c5a50704a3b84cfa6c137201f7b7105ea9f1850c0eae29b01e6223c808b5d9`。
设计首次 push 被外层遗留 pre-push 钩子误调用不存在的实现路径拒绝；
已通过文档检查后，仅该次设计 push 用命令级 `core.hooksPath=/dev/null`，
未修改钩子文件或触发另一轮产品 full。上述结果不代替头像功能、CSP 实现、
契约生成或浏览器业务验收；实现批仍由原完整检查与实际功能验证收口。

## 2026-10-06 原版 Profile 保存与头像复用（独立候选）

本批基准是 `7251a6b0656a0170301ad05b6e21a4124dc0f5aa`，不是正式工作树的历史脏增量。
改前按原权威、调用方、影响面及失败副作用核对后的实现如下；尚未部署，不以静态界面
或原包安装成功代替本人 kind 0 的实际发布/读回验收。

- 权威：DD-39/75/80/81、09 §3；Profile 正文及 replaceable 事件归 Buzz。
  Browser 走已有 SERVER 身份 BFF，Desktop 仍用本机 CLIENT 身份；Core 只记录原
  `admission.publish_attempt` 与 audit 的事件 ID、参数摘要和范围，不保存资料正文，
  不使用 CONTROL 代替本人签署 kind 0，不开放 NIP-29 管理事件。
- 原版来源固定为 Buzz `779af8886caae1317b4de962082429867ab61503`：
  `desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`、
  `desktop/src/features/profile/hooks.ts::useUpdateProfileMutation`、
  `desktop/src-tauri/src/commands/profile.rs::update_profile`、
  `desktop/src/features/profile/ui/ProfileAvatarEditor.tsx::ProfileAvatarEditor`、
  `desktop/src/features/profile/ui/AnimatedAvatarCapture.tsx::AnimatedAvatarCapture`。
  复用资料编辑、npub/NIP-05 展示/复制、图片上传、emoji、自定义颜色和动态头像原控件；
  不将这些原样或适配迁入行数计算成全新产品实现。Web 不恢复本机密钥备份。
- 实际调用方：共享 `ProfileSettingsCard` 由 Web `SettingsPane` 与 Desktop 原
  `SettingsPanels` 调用。Web 本人资料 GET/PUT 及媒体路由复用原 BFF 身份解析、
  Tenant/Buzz binding、Relay 限额与 Blossom；Desktop 原 hook 调用本人 native writer。
  保存期间冻结同一幂等键/署名者/内容；受理或 ACK 不等于保存成功，必须精确事件读回。
  丢回应后只观察原事件，不换键重发；身份改变或迟到旧 scope 回应不写新 scope 的缓存。
- 副作用与恢复：BFF 在原事务中一并写意图与 DISPATCH，审计失败不能留下独立意图。
  replaceable 历史缺失不能推断未发送；原 reconcile 循环采用键集游标，未决旧行不会
  永久占满首批。OUTCOME 落盘失败返回 UNKNOWN。Desktop 原未确认事件容器保留同请求，
  仅真实 typed native 拒绝可与 IPC 丢回应区分；该内存容器不是崩溃持久恢复证明。

头像依赖仍是原 `emoji-mart@5.6.0` 与本地 MediaPipe。`@emoji-mart/react@1.1.1`
声明的 React peer 只到 18，原安装真实 ERESOLVE；未使用 force/legacy-peer-deps。
共享 `profile/buzz/shared/ui/emoji-picker.tsx` 复用该版本源映射中的原 wrapper，
仅补类型及 React 19 effect 卸载清理；原 custom element 负责 UI 和行为，MIT 完整许可
随源保留。包 integrity 为
`sha512-NMlFNeWgv1//uPsvLxvGQoIerPuVdXwK/EUek8OOkJ6wVOWPUizRBJU0hDqWZCOROVpfBgCemaC3m6jDOXi03g==`，
源映射 SHA-256 为 `76c117bb7a182cb276871ce213c13f9f0e631e6afeb1681627b87d540c47a57d`。
emoji 数据与 en/zh 文案使用已锁包，不从 CDN 获取。

原 `SELFIE_SEGMENTER_MODEL_URL` 的已取得模型字节与来源摘要保存在共享
`profile/assets/source.json`；原 Vite 宿主发布本地模型及同一已安装 SDK 的 JS/WASM，
不在构建时解析可变的 `latest` URL。Web 外站头像 URL 不借任意 BFF 代理绕过 CSP；
已上传的本 Community 哈希沿已有媒体读取面呈现。摄像头、实际设备和真实 Relay 保存
仍需后续运行验收，HTTP LAN 非安全上下文明确拒绝，不启用浏览器不安全开关。

### 实现后定向回执

原件目录为 `/volumes/data/kailo/tmp/codex-profile-settings-20261006.ortsoo/`。
执行副本为已有 SDK 的 `/evidence/profile-settings-ortsoo.DRR20F/apps`；
固定 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 cgroup 4 CPU / 8 GiB / swap 0，Cargo jobs 16，沿原 Data 缓存。
Core 数据库是独占隔离库 `profile_settings_ortsoo`，不是线上库；夹具事务回滚。

- 原 `tools/gen.sh` 四侧及平台 i18n 生成、同入口 `--check` 阶段均为 0。
  `gen-final.log` 整条命令仍为 1：后续 registry 阶段缺快照设计输入；
  补齐固定设计原文后，原 `gen-registry.py` 及 `--check` 单独为 0。
  首两次生成 255 是 SDK 缺 HOME、Dart 无权写 `/.dart-tool`，原件保留。
- 原 root pnpm 10、Web npm、Desktop pnpm 11 依赖安装终态均为 0，
  保留首次 React peer ERESOLVE。三个锁保留另一已验收批的 `source-map-js@1.2.2`，
  Web/Desktop 保留 `seroval@1.6.8`，未以旧锁覆盖安全修复。
- 原 `cargo test --offline --manifest-path core/Cargo.toml -p platform-core
  --bin platform-core web_profile::tests -- --include-ignored` 为 4/4，
  包括实际 SQL writer 的审计失败回滚、同键再次准入、重复意图与键集分页。
  原 `cargo clippy --offline --manifest-path core/Cargo.toml -p platform-core
  --all-targets -- -D warnings` 为 0；不是全量 Core 测试。
  首次错误 Cargo HOME 的下载进程经明确停止为 143；继后编译 101 的未声明 `url`
  路径已改用工程现有 `reqwest::Url`/Nostr 表单编码，无新增 Rust 依赖。
- 仅执行副本将真实 `pending` SQL 游标谓词改为恒真，原实库消费者断言失败，
  3 通过 / 1 失败、退出 101。逐字还原并与候选 `cmp` 为 0 后，同 4 项退出 0。
- 共享生产与测试类型均为 0；原 Vitest Profile、上传、emoji、资产、settings
  共 24/24。真实 emoji custom element 的挂载、卸载、StrictMode 清理被消费，
  不用替代 picker。早先 worker 启动超时与 fixture/API 适配失败仍保留。
- 真实资产插件冷读曾为 6.095 秒、12.83 秒而超过 Vitest 默认 5 秒；
  读取发生在生产插件构造器，不是另外读取的测试 fixture。本轮仅验证命令增加
  `--testTimeout=60000`，不改产品或测试默认值、不挪走被测行为，不声明性能达标。
  实际已安装 SDK 的 JS/WASM 文件、固定模型字节/摘要和原 `generateBundle` 输出
  断言均保留。该 24 项通过后，串接命令因误写 Web 用例路径退出 1，不冒记整体 0。
- 仅执行副本去除原 UNKNOWN 保留条件，并将原 `generateBundle` 输出名改错，
  同 9 项实际 2 个断言失败、7 通过、退出 1；两源逐字还原 `cmp` 为 0 后 9/9。
  该恢复命令后串接的新 Web fixture 不完整而退出 1，恢复 9 项本身确实通过。
- Web 原 `npm test` 曾为 12 文件 / 53 项通过；最新真实 settings 5/5、Web 类型为 0。
  后置增加真实 `SettingsPane` 进入 Profile、调用 BFF PUT 再精确读回的 4 项为 0：
  不同事件、不同 signer、读回失败均不报保存成功，后续观察保持原幂等意图。
  首轮主题 fixture 与 jsdom 缺 ResizeObserver/matchMedia 失败保留；仅补浏览器 API
  fixture，未替换原 Profile/头像组件。jsdom 无 Canvas 的提示保留，不能据此声称
  图像绘制、实际视频采集或设备已验收。
- Desktop 原 `pnpm run typecheck` 为 0；原
  `node --import ./test-loader.mjs --experimental-strip-types --test
  src/shared/api/tauriProfiles.test.mjs` 实际 IPC 消费 1/1，为 0。
  本轮没有单独编译/打包 Desktop native；Rust 格式检查不等于 native 编译验收。

主要原件 SHA-256：

- `core-consumer-restored.log`：`31ac9ed5ea13118cd64b26b71dc861c768da97d394e809aeb057cdd5175d9716`。
- `core-mutation.log`：`e98bcc3549e4b483734d3d8989df8848015333c119f06b6a36722ccc7750c5fa`。
- `core-mutation-restored.log`：`f5d2c67b96b14268450f07074c9933ff5bed27e9343b7a560617f0c4b711947d`。
- `client-bounded-final.log`：`62d1882e9e87966522c0f7be4dd1cafcad2315760d0cf44a63730bad4519ecad`。
- `hosts-final.log`：`87b3e50d0a6f1489543dbd29cdf3ac10e0986535754f8f185f16f9f1bdc757d5`。
- `ui-mutation.log`：`f3bae63c5a4fe94b3f4598efcee1ca4c6167f76f1f7d9ba6538020dee786818c`。
- `ui-mutation-restored.log`：`c8c4bd91fcd7fd107ccccac41f946829fe5669bbeec7feca3d318f4cbd4f32c3`。
- `web-profile-restored.log`：`c02fe9090ab75c31ea6a397b10830ecd48dc1ea944cc6f1b0e3ac8fb8db74d3b`。

本批未运行 full、产品镜像构建、发布、部署；未修改线上 kind 白名单、权限或额度。
不把本人 kind 0/Blossom 的代码与定向结果写成真实 Relay 保存验收，不把 HTTP LAN
摄像头拒绝写成设备可用。Web 不持本机私钥；NIP-05 仍复用原版展示/复制，
并非新增验证或编辑能力。正式历史脏工作树不在本批输入中。

原 `./tools/check-docs.sh` 最终退出 0，日志 `profile-docs-restored.log` SHA-256
为 `1ca07009db993cc1efae6e847eb605292971018613aa3e2ec0840aa06468acde`。
首次 `profile-docs.log` 退出 1，是执行镜像未包含基线顶层文档、被链接的验证原文及
原 markdownlint 配置；从同一基线机械补齐后通过，未改检查器或删验收项。
此文档门禁不覆盖运行期设备、Relay 保存或原生二进制。

### 2026-10-06 正式工作树 Profile 接回

按 REQ-24、DD-74/75，把上节候选的原版 Profile 控件、两个宿主接线和本人
kind 0/BFF/Blossom 消费合入正式工作树，没有另写精简资料页。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/settings/ui/SettingsPanels.tsx::DEFAULT_SETTINGS_SECTION`
仍为 `profile`；本次两宿主恢复同一初始栏目。原候选 native writer 的新增
`expect` 改为显式错误传播，不改变已冻结写意图或读取成功判据。

影响仍为上节的原资料、媒体、发布意图及宿主缓存；没有新增数据库迁移、
权限或执行权威。只有 canonical readback 才显示保存，UNKNOWN 仍冻结原键，
旧身份迟到回应不得写入新身份；资料公开范围仍是 Community，不是私密 Workspace。
本次没有修改线上 kind 列表。不能把未部署接口算作用户已经能保存。

正式输入复制到原 SDK 执行副本
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/apps`，
选定生产文件逐字 `cmp` 通过；SDK 固定为上节 `10ad51a2…`，实际
`kailo-agent-receipt-xvkujx` 为 4 CPU、8 GiB、memory+swap 8 GiB、UID/GID 1000。
检查前已核对构建进程、CPU/内存压力与 Data 缓存，不构建产品或下载依赖。

- 共享原 Profile/settings 五目标：24/24，退出 0。
- Web 原 `SettingsPane.test.tsx` 与 `ProfileSettings.test.tsx`：9/9，退出 0。
  新断言实际进入默认 Profile，再点击原 Appearance 检查旧控件仍可达；
  jsdom Canvas 未实现的提示保留，不据此称真实图像或相机通过。
- 仅在执行副本把生产初始栏目改回 `appearance`，原五项检查为
  4 通过、1 断言失败，退出 1；逐字还原并与正式文件 `cmp` 后，5/5 退出 0。
- Desktop 原 `tauriProfiles.test.mjs`：1/1，退出 0；native Profile 单文件
  `rustfmt --edition 2021 --check` 退出 0，不等于 native 编译或设备验收。
- 首次共享类型检查退出 2，捕获同批 Channel 对话框尚未合入的依赖与文案；
  未删用例、排除文件或据 Profile 窄通过改记整包类型通过，交由合批统一核验。

这批只恢复 Profile，不是“完整用户设置已恢复”。原版 SettingsPanels 有
16 个栏目，当前接回后仍只有 Profile、Appearance、Notifications、Shortcuts
四个；其余栏目与各自真实后端接线仍是 REQ-24 交付缺口。完整检查、实际
Relay 保存、多端身份、Windows native 编译/设备及发布部署均未由本节证明。

### 2026-10-06 原生私聊 UI 与双宿主接回

权威为 REQ-24、DD-74/75/77/80、`.design/03` §2 的
ConversationBuzzBinding、`09` 的原生私聊多设备映射及 `06` 的
CONVERSATION_PROJECTION。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/NewMessageScreen.tsx::NewMessageScreen`、
`desktop/src/features/messages/ui/NewMessageResultRow.tsx::NewMessageResultRow`、
`desktop/src/features/profile/ui/SelectedRecipientChip.tsx::SelectedRecipientChip`
及 `desktop/src/shared/ui/PubKey.tsx::PubKey` 是复用来源。
保留原 To 栏、收件人 chip、键盘上下选择/Enter/Backspace、搜索 popover、
公钥核验、原行布局与首条消息后导航；不是另做一个私聊对话框。

影响面是共用 `react/new-message.tsx` 与 `react/conversations/`、已有
BFF client、两端 NewMessagePage、Web 原 ChannelPane/MessageContent、
Desktop 路由与原 Composer 的状态提示。目录和会话形状直接消费四侧生成的
ConversationParticipantPage、ConversationPage、ConversationView；目录用
Principal 选择人与运行时 maxParticipants，实际 pubkeys 只用于核验，
不把 Principal UUID 冒充公钥，不建立另一个身份目录。UI 不新增数据库迁移。
Web 的创建/读取/消息/附件/流经 BFF；Desktop 创建经 BFF，然后按 ACTIVE
Conversation 的 channelId 读取真实原生 Channel，持本机钥匙由原发布器发送。

副作用约束：创建只提交原 `conversation.open` ActionCommand；得到任务受理
引用不表示原 DM 已可用，必须读取同一参与者集合的 ACTIVE 引用才发送。
PROVISIONING/RECONCILING 保留原 command、幂等键、收件人与草稿，重查不另建；
传输 UNKNOWN 保留同一意图。两端 Composer 区分“准备中”中性状态与确定失败，
不把尚未尝试发布解释为成功。Web 继续使用原 ChannelPane、媒体 imeta 校验和
SSE retry/snapshot/event/live/closed 处理，只改变到 Conversation 的受控目标。
消息正文仍只在 Relay；客户端不接触 CONTROL key，也不从 Tenant admin
推导私聊参与资格。

边界：空目录不是创建成功；目录读取失败不伪造候选人；同一个人在多设备上仍
只选一次。人数来自契约投递事实。非 ACTIVE 原生引用不发布，目录/会话与
身份切换由 PlatformProvider 的既有认证作用域重建。并发点击由发送中的
in-flight guard 拒绝；后台或迟到列表回应不覆盖新的读取轮次。会话撤权由
同一 Core/Relay 准入与 SSE 周期重查处理，不放宽现有权限。

执行证据来自资源受限原 SDK `kailo-agent-receipt-xvkujx`，执行副本为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/apps`：

- `client-kit/ts/platform/test/new-message.test.tsx` 四项分别验证原键盘收件人
  操作、真实 governed participant set 与 ACTIVE、受理但未就绪不发布、
  UNKNOWN 后使用完全相同 command。08:20:16 与 08:21:29 UTC 均为
  `4 passed`；同批 sidebar/profile 合计 `13 passed`。
- 仅在 SDK 执行副本把 ACTIVE 判据改为 PROVISIONING，08:20:54 UTC 的
  四项检查实际 `3 failed | 1 passed`，捕获 ACTIVE 未放行、PROVISIONING
  错放行、UNKNOWN 回查未收敛。逐字还原后 08:21:29 UTC 四项重新通过。
- Composer 中性准备状态合批后，共享 TypeScript 与 13 项检查、Web
  TypeScript 与 11 项检查均退出 0。Desktop 类型检查实际捕获
  `visibleSendOutcome` 漏投影 `pending` 字段；补入该字段后 Desktop
  TypeScript 与原排序 15 项退出 0。对应 SDK 日志在执行副本上层的
  `sidebar-shared-final.log`、`sidebar-web-final.log`、
  `sidebar-desktop-restored.log`。本批没有在本子任务中触发 Core 编译、
  产品构建或部署。

最后的双宿主窄修把“发布已确认”与“导航失败”分离：发布器收到确认后，页面
跳转异常只给出“消息已发送”和仅重开会话的按钮，不把异常抛回发送重试路径。
卸载或 Principal 更换使原宿主 scope 失效；准入迟到后不再发布，发布回执迟到
后不跳转新身份，也不把旧会话提示渲染给新身份。
`web-client/web/src/platform/ui/NewMessagePage.test.tsx` 在真实宿主组件上验证
上述四种路径。08:30:03 UTC 四项通过；初次 Web 类型检查另捕获用例的
`Mock<Procedure | Constructable>` 形状过宽，改为真实导航 callback 类型。
08:30:32 UTC 仅在 SDK 将安全导航改回直接 await 旧 callback，实际
`3 failed | 1 passed`，捕获跳转异常污染发送回执、换身份迟到跳转和卸载迟到
跳转；还原并 `cmp` 一致后，08:30:54 UTC `4 passed`，其后 Web 与 Desktop
`tsc --noEmit` 同一命令全部退出 0。Desktop 这里有类型检查与同结构窄修，
不把 Web 四项伪称为 Windows 原生 UI 的实际运行证据。

这不是“全部原版 DM 功能恢复”。Web 仍复用已有宿主 Composer，原版富编辑器
完整共享抽取未由本批交付；目录未提供原头像资料，因此行使用原 Avatar
fallback，不伪造图片。原 DM 的头像、隐藏、完整未读细节与 msg/thread 级已读、
真实多设备消息/附件验收仍需对应实现和证据。按冻结领域模型这里只接 HUMAN
私聊，不复制上游本机 Agent 注册表或以假 Agent badge 扩大授权范围。

### 2026-10-06 原富编辑器主体共享与 Web 真实发送

本批对应 REQ-24 原版功能恢复，不新增工作流或消息权威。重新用 `git cat-file`
及 `git grep` 核实 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/MessageComposer.tsx::MessageComposer`、
`desktop/src/features/messages/ui/ComposerDockToolbar.tsx::ComposerDockToolbar`、
`desktop/src/features/messages/lib/useRichTextEditor.ts::useRichTextEditor` 和
`desktop/src/features/messages/lib/useDrafts.ts::initDraftStore`。原富编辑器、格式
工具栏、选区工具、链接编辑、草稿存储和样式移入共享 `react/composer/`；
Desktop 原位置转发同一主体，仅保留系统剪贴板、原生链接跳转与附件队列清理
适配。Web 删除简化输入框，消费同一 `MessageComposerSurface` 与原编辑器。

影响面包括共享包导出与三套既有锁、两端 Composer、Web ChannelPane、正文内
消息链接和 PlatformApp 实际定位、共享 i18n 的 Dart 投影。沿原 Desktop 锁
固定 TipTap 3.22.5，避免直接依赖与传递包混用不同版本。没有改业务契约、
Core 消息存储或 Relay 权威。Web 消息与附件继续经 BFF，Desktop 继续原生
发布器；Mobile 不承载这一编辑器提取，不增加组件宿主入口。

副作用与边界：空消息且无附件不发；上传中与发送中不重入；Agent 集合仍以
实时准入过滤并在发送前核验。传输 UNKNOWN 保存原内容、附件和同一幂等键，
重开原身份/目标草稿仍沿用该键，不能解释成已送达。只有实际发布确认后清理
对应内容与附件。身份或目标失效后，迟到上传/回执不改新编辑器。原草稿存储
的命名空间、容量与损坏恢复机制复用；Web 保存 Markdown 而不是丢失格式的
预览纯文本。正文链接只导航到已准入频道；目标不在当前历史则明确提示，不
伪造定位成功、不越权补读。错误继续沿既有六类投影，UNKNOWN 使用中性提示。

本批实际执行副本仍为上述 `profile-settings-ortsoo.DRR20F/apps`，SDK
`kailo-agent-receipt-xvkujx` 受 4 CPU / 8 GiB cgroup 限制；不运行只读上游。
09:11 UTC 集中执行结果：

- 共享包 `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.test.json` 均退出 0；
  `vitest run test/pages.test.tsx test/new-message.test.tsx test/sidebar.test.tsx
  test/profile-settings.test.tsx` 为 `4 passed / 236 passed`。其中 pages 为
  223 项，包含同批原频道创建 Dialog、Forum/描述和两项主题检查。
- Web `tsc --noEmit` 退出 0；Composer、NewMessagePage、PlatformApp、
  ChannelSidebar 四文件 `20 passed`。Composer 的 9 项包括原工具栏、
  原加粗内容保存后重开并发送 Markdown、UNKNOWN 幂等键恢复和已有 Agent
  选择/撤权/键盘路径。
- Desktop 最终 `tsc --noEmit` 退出 0；此前同批原 plainTextProjection、
  useDrafts、useDraftsReactivity、selectionBlockFormatting、
  mentionHighlightExtension、mentionClipboard 六文件 `177 passed / 0 failed`。
- 既有 `tools/gen-platform-i18n.py` 生成并 `--check` 退出 0，输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。

检查在实现后补充，并主动破坏执行副本确认有效：09:10:18 UTC 把草稿恢复
的 `saved.sendIntent` 丢弃，UNKNOWN 用例实际 `1 failed / 8 skipped`，捕获
重试 UUID 改变；09:11:45 UTC 把发送序列化退回 `editor.getText()`，格式
用例实际 `1 failed / 8 skipped`，捕获 `format me` 不等于 `**format me**`。
两次均只改 SDK，随后从正式源码逐字恢复并 `cmp` 一致；09:12:05 UTC 完整
Composer 再跑 `9 passed`。此证据不替代全量检查、构建或部署。

本批不是全部 Composer 功能恢复：Web 原附件缩略图/图片编辑/剧透细节、
录音、完整 emoji 与人类 mention 体验尚无本批交付证据；创建私聊前的首条
消息尚未接持久草稿身份；旧消息分页定位尚未恢复。Desktop 原有相关功能
保持调用，不因抽取删减。未在本子任务提交、推送或部署，也未声称 Windows
真实 UI 或多人联机验收已通过。

收口复核补充：`Composer` 导出可以不卸载而换身份/目标，不能依赖当前
PlatformApp 的频道 key 保证隔离。恢复 effect 现对旧编辑内容、附件、提及、
幂等意图、上传与发送状态做完整 scope 替换；新 scope 无草稿也必须清空。
旧 scope 的发布 finally 与其他回执一样检查 owner，不能解锁新 scope 正在
发送的消息。实现后追加同实例切身份、切频道、旧发送迟到三项检查，
09:22:37 UTC Composer `12 passed`；共享 test tsc、Web tsc、Desktop tsc
均退出 0。初轮一项失败来自原草稿模块内存缓存跨用例保留，用例改为各自
身份命名空间后验证通过，没有修改原缓存语义。

重新核验发现上游同一固定 commit 的
`desktop/src/features/messages/ui/MessageComposer.tsx::handleCaptureSelection`
本来就是空回调。删除两宿主和共享工具栏的该遗留空接缝，不新增无读者的
selection ref；原 `FormattingToolbar::captureSelection` 和 ProseMirror
`state.selection` 仍负责实际选区。09:22:54 UTC 在 SDK 把 scope 替换退回
“仅有 saved 才更新”并取消 finally 的 owner 判断，新三项实际
`3 failed / 9 skipped`，分别捕获旧私密正文跨身份/频道残留与新发送被解锁。
执行副本已从正式源码还原且 `cmp` 一致，09:23:06 UTC Composer 再跑
`12 passed`。

### 2026-10-06：原附件控件共享与 Web 实际媒体适配

本批沿 REQ-24、DD-74、DD-75 恢复已有功能，不另做精简附件界面。核验
Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/ComposerAttachments.tsx::ComposerAttachments`、
`desktop/src/features/messages/ui/ComposerImageEditor.tsx::ComposerImageEditor`、
`desktop/src/features/messages/lib/useAttachmentEditing.ts::useAttachmentEditing`、
`desktop/src/features/messages/ui/useComposerAttachmentSpoilers.ts::useComposerAttachmentSpoilers`、
`desktop/src/shared/lib/remarkSpoilers.ts::remarkSpoilers` 和
`desktop/src/shared/ui/markdown/SpoilerInline.tsx::SpoilerInline` 后提取到
`client-kit/ts/platform/src/react/composer/`。Desktop 对应路径转为薄适配或
转导出，保留原缩略图、灯箱、画笔编辑、撤销、回退、剧透和样式；没有在
只读上游开发或执行内容。

影响面是两宿主 Composer、原附件编辑 hook、媒体读取、草稿和正文消费。
Desktop 继续原 Tauri 媒体读取及上传；Web 只把经过 BFF 上传的描述符映射到
当前 workspace/conversation 的 BFF 媒体路径，编辑取回真实 bytes 后经原
上传入口提交 PNG，不把 Relay 原地址直接交给浏览器请求。Core 仍只管准入
与引用，不存副本正文。`filename`/`spoiler` 使用同批生成契约，原 imeta 与
Markdown 序列化由 Core 保留；Web 正文复用原 spoiler parser/遮挡控件。

编辑途中撤走附件或切换身份/频道，迟到上传不得替换新草稿；原图与剧透
集合随编辑/回退迁移。确认发送仅清理该次捕获的附件，保留在途新增或编辑
内容；UNKNOWN 保留草稿和同一幂等意图。草稿记录原附件描述符与剧透集合，
不记录媒体 bytes。重载后的撤回编辑能力没有被夸大为已恢复。

当前窄验：共享 source/test tsc、Web tsc 退出 0；原正文消费 6 项及新私聊
页面 4 项通过。Desktop 首轮发现音频宿主 filename 必填类型与适配器可选类型
不一致，已按原实际调用的必填参数修正。独立 SSR 流撤权夹具首轮因原 Tiptap
禁止 SSR 实例化失败，夹具仅隔离其 editor 初始化，真实 DOM Composer 仍
不替换；另补真实频道 DOM 挂载和撤权移除断言。

验证容器维持 4 CPU/8 GiB。共享 Vitest forks 与单 threads 两次均在 worker
启动前超时、`no tests`；宿主同期 I/O full avg10 为 60%–72%，不能把这些
检查写成通过。后续实际执行结果见下段。本批未部署、未自行提交或推送。
Web 录音与原音频波形播放控件
不在本批完成范围，不以通用文件卡片宣称这些能力已恢复。

09:57:12 UTC 最终 Web 单线程窄验退出 0：Composer 13、ChannelRead 6、
ChannelPane 4、MessageContent 6、NewMessagePage 4，合计 `33 passed`。
其中使用真实原附件组件完成预览、剧透、画笔 PNG 上传、回退和发送；真实
DOM 挂载原富编辑器后撤权移除通过。SSR 夹具补实际 TooltipProvider，并将
旧 textarea 标签断言换成原 Composer form，原撤权/迟到消息清理断言保留。
09:56:36 UTC 执行副本把 spoiler 输出故意改 false，实际
`1 failed / 12 skipped`，差异为 expected true / received false；已精确
反向还原后得到上述 33 项通过，没有改正式对象规避失败。

Desktop 修正后 tsc 退出 0；随后误用不存在的 Desktop Vitest 路径退出 127，
未执行其原 helper 用例，不记为通过。共享 source/test tsc 与 Web tsc 已通过，
本批没有重新全量编译。原始日志位于 Data 的
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
下 `attachments-{shared,web,desktop-final,mutation,web-restored}.log`；共享 DM
与 pages 的启动超时后续由同批负责人沿同一 SDK 收口，不能复用旧批通过。
