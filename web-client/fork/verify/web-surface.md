# Web 面：patch 0001 的成立证据

对应 `SS-WEB-RELAY`、`SS-WEB-01` 与 Stage 1 退出门禁中的「登录、logout、断线恢复端到端通过」
「Browser 直连全部被拒绝」「每次消息动作可关联 actor、scope、operation、Buzz event 与 AuditEvent」。

## patch 0001 做了什么

在 `a6766c482533d028582d0efcfd3740769f86217c` 上：

- **移除**浏览器直连 Relay 与本地 signer：`relay-client`、`media-client`、`nostr-signer`、
  `nip98`、`identity-vault` 及其调用方，连同只服务于它们的功能目录、依赖、运行时配置
  （`public/config.json` 曾向每个浏览器下发一个 Relay 地址）与 2007 行上游 e2e（它们测的是
  现在被禁止的本地身份、NIP-07 登录与 Relay 直连）。
- **换成**经 BFF 的传输 `src/platform/bff-client.ts`：query/stream/publish/media/user-state
  全部同源、凭网关 cookie，没有可配置的 API 地址。
- **加入**平台页（`SS-WEB-01`）：登录状态、Workspace 选择（收藏置顶）、频道、成员、本人审计。
- **复用**上游的消息渲染 `features/chat/ui/MessageContent.tsx`（markdown、提及），只把媒体
  读取从「NIP-98 签名直取 Relay」改成「按 NIP-92 `imeta` 的 `x` 经 BFF 读取」；没有 `imeta`
  背书的媒体地址只作普通链接，不加载。
- 收紧 Caddy 响应头：`connect-src`/`img-src`/`media-src` 只剩同源；`Referrer-Policy` 为
  `same-origin`；除带 hash 的静态资源外一律 `Cache-Control: no-store`。

构建后的产物里 `wss://`、`ws://`、`new WebSocket`、`nsec1`、`signNostrEvent`、`relayUrl`
出现次数均为 0。

## 拓扑

`buzz-web` 只进 `app` 网络，对外唯一入口是 AgentGateway。网关的 `browser` listener 上
OIDC、`proxy-authorization` 与 `x-kailo-*` 清洗、issuer/subject 投影全部挂在 **listener**
级，`/app` 前缀路由到 Web、其余到 BFF（`SF-AGW-22`）；本地 logout 端点显式开启
（`SF-AGW-23`）。`tools/check.sh` 的 security 步骤对每条 route 计算其实际生效的清洗与投影，
并要求 listener 级 OIDC 与 logout 存在。

## 真实浏览器走查

`core/verify/web-walkthrough.sh <输出目录>`：以真实 lifecycle Workflow 开通 Workspace，
用 IdP 里的核验用户经网关登录，Chromium 逐步操作并断言；结束时拆除 Workspace。

2026-09-25 的一次完整运行，17 步全部通过（`walkthrough/summary.json`；任务、审批与兑换页的截图 `11a`、`11b`、`11d`，签发链接的截图含凭据，不入库）：

| 步骤 | 结果 |
|---|---|
| 未登录访问 `/app/` | 被带到 IdP，登录后回到 `/app/` |
| 频道 | 流进入「已同步」，头部显示显示名 |
| 发送 | 经 BFF 代签，由流回显后才出现；作者显示为成员名 |
| 发送失败（注入 503） | 草稿保留、`role=alert` 报错，消息不出现在列表里 |
| 停掉再启动 core-bff | 期间状态为 `Connection interrupted, reconnecting`，恢复后续流并能继续收发，断线前的消息仍在 |
| 图片附件 | 经 BFF 上传、随消息发出（`imeta` 与原生端同形，`SF-BUZ-36`）、`<img>` 经 BFF 同源加载完成 |
| 收藏与静音 | 写入 Core `CollaborationUserState`，刷新后仍在，收藏项排在最前；`updatedAt` 由库时钟写入 |
| 已读 | 同步且页面可见时推进到最新消息，存为 UTC RFC 3339 |
| 成员页 / 角色管理 / 审计页 | 本人 ACTIVE；独立的可管理 Workspace 列表与 Tenant 角色候选页实际载入，显示已有 Tenant admin 与可授予入口；`workspace.message.publish` 有记录，页面不含消息正文 |
| 设备页 | 列出本人登记的原生设备，可在浏览器里撤销丢失的设备；未登记时如实说明 |
| 任务页（补丁 0005） | 本人待审批的任务显示「Waiting for approval」、reason code 与 operation；撤回先确认、经 Temporal Update；结论确定后不再给撤回（此刻投影可能仍未决）；按「刷新」重读到门禁 `REVOKED`/`APPROVAL_WITHDRAWN` |
| 审批页（补丁 0005） | 待我审批可见（低延迟一致性下按刷新重读）；批准先确认、经 Update 记录；同值重发 200 拿回原决定，冲突值 409 `DUPLICATE_DECISION` |
| 审批的库内终态 | 走查结束后以 Core 库为准：撤回的审批 `CANCELLED`，批准的审批在收敛上界内 `CONSUMED` |
| 邀请（补丁 0006） | admin 在成员页签发：链接只显示一次、落在 `/app/invite`、fragment 是 64 位凭据，列表不含凭据；撤回先确认；以已是成员的核验用户打开已撤回的链接：地址栏的 fragment 被清掉、凭据不出现在任何请求 URL 里，兑换以 409 与用户能懂的原因加 reason code 拒绝 |
| 自称原生端 | 页面带着伪造的 `x-kailo-client-surface: native` 提交设备登记，网关移除该 header，BFF 回 `NATIVE_SURFACE_REQUIRED`（`DD-78`） |
| 注销 | 注销前的 PlatformSession 在库中为 `REVOKED`，网关 cookie 被清除，再次进入得到新会话 |

全程请求来源只有网关与 IdP 两个 origin，CSP 违规 0。失败响应都由走查自己造成：注入的 503、BFF 重启与 Relay 停机期间的 503、有意提交冲突决定得到的 409 `DUPLICATE_DECISION`、兑换已撤回邀请得到的 409、伪造入口标识得到的 403。

一个人可以同时持有 Web 与多台原生设备的公钥（`DD-77`）。频道按成员的全部公钥归属作者，原生设备直连 Relay 发出的消息在 Web 上同样显示为本人；「未读」与「新消息」分隔线也按全部公钥排除本人的消息。

注销后能否不输口令直接回来取决于 IdP 自身的会话：Kailo 一侧的 PlatformSession 与网关
cookie 都已失效，再次进入是一次新的 OIDC 登录；IdP 会话仍在时这一程不要求口令
（`.design/09`、`SF-AGW-23`）。

## 走查找出并已修复的问题

每一条都在修复前复现、修复后由走查或门禁覆盖：

1. **网关不剥 `Proxy-Authorization`**（违反 DD-73）：抓包确认调用方的代理凭据原样到达
   BFF；清洗移到 listener 级后到达的只剩两条已验证的 header。门禁已补该项。
2. **频道永远停在「连接中」**：`live` 帧没有 `data:` 行，按 SSE 规范浏览器不派发这种事件。
   集成测试的 SSE 解析比浏览器宽松，因此一直通过；现已改为按规范解析，并在修复前确认失败。
3. **断线时仍显示「已同步」**：EventSource 静默重连而无人处理 `error`。续流改用 SSE 自带的
   `id:`/`Last-Event-ID`/`retry:`，间隔由 `BFF_STREAM_RETRY_MILLIS` 下发，客户端不再有写死的
   时长与第二套重连循环。
4. **「退出」不退出**，依次叠了四层：网关未开启 logout 端点（请求落到 BFF 404）；
   `Referrer-Policy: no-referrer` 使 POST 的 `Origin` 为 `null`，被网关判 CSRF；表单提交后的
   重定向链落到 IdP 源，被 CSP `form-action 'self'` 拦下；`index.html` 被启发式缓存，注销后
   的导航到不了网关，页面对每个 API 都拿到「会话已结束」而反复重载。
5. **失败被渲染成「没有」**：取 Workspace/成员/审计失败时显示成空列表。现在失败与空分开显示。
6. **用户状态三端不一致**：偏好的 `updated_at` 注释写着「由库给」而实际写入 `null`；已读时间
   不校验格式，一端写入的任意串在另一端无法解析。现由库时钟写入 `updatedAt`，已读时间只接受
   RFC 3339 并统一存成 UTC，集成测试在修复前确认失败。

## patch 0003：BFF 类型取自 contracts

`bff-client.ts` 与平台页原先手写了 `PlatformSession`、`WorkspaceRow`、`MemberRow`、
`ClientKey`、`AuditRow` 以及偏好/已读的请求与回应形状，与 Core 的回应各写一份（违反
ADR-02）。0003 删掉这些手写类型，改为 `import` `src/platform/contracts.gen.ts`；状态比较
改用生成的枚举（`BuzzIdentityState`、`WorkspaceMembershipState`）。

该文件是 `contracts/` 的 TypeScript 生成物，由 manifest 的 `vendor_files` 在打完补丁后
放进源树（06 §2），补丁里不带副本，`.gitignore` 与 biome 均排除它。contracts 重新生成
而未重建镜像时，`check.sh seam` 因 `patch_series_digest` 不符而失败；源树里没有它时
`npm run typecheck` 失败——两者都已实测。

可选字段按 contracts 子集缺省而非 `null`：`currentWorkspaceId` 在未选定时由 Core 省略，
平台页以 `?? null` 读取。

## patch 0004：平台页与 BFF 客户端改用 Kailo 共用包

Web 与 Desktop 要写的 Kailo 自有 TypeScript 是同一件事，只写一份（ADR-09）。0004 删掉补丁里的
成员、审计、设备三页与 BFF 客户端的共用部分，改为引用 `vendor_files` 放入的
`src/kailo-platform/`（源在本仓库 `web/packages/platform`），以 `@kailo/platform/*` 引用。
只有 Web 才有的调用——SSE 流、带 `Idempotency-Key` 的发布、二进制媒体上传、已读与偏好、
网关退出——留在 `src/platform/bff-client.ts`，经共用包的同源 fetch 传输发出，错误体与
「结果不明」按同一套规则解读：发布没有得到回应也显示为待确认，不再说成发送失败。文案
key 只在共用包定义，Web 的消息表并入它。

实测：删掉放入的 `src/kailo-platform/` 后 `tsc --noEmit` 报 19 个错误；恢复后 typecheck、
`npm run check`、vitest 12/12 通过；`core/verify/web-walkthrough.sh` 14/14，成员、审计、
设备三步渲染的是共用包的组件。

## patch 0005、0006：任务、审批与邀请

0005 在平台页头部加 Tasks、Approvals 两个标签，页面是共用包 `react/governance.tsx`；0006 在成员
标签里加邀请一节、注册 `/app/invite` 兑换页（读 fragment 后立即 `replaceState` 清掉），并在会话
以 `TENANT_MEMBERSHIP_NOT_ACTIVE`/`IDENTITY_UNKNOWN` 拒绝时改为显示本人的兑换进度。两者的页面
都在共用包里，Web 与 Desktop 同一份；补丁只做导航与宿主外壳。

邀请链接的基址（`TENANT_INVITATION_LINK_BASE`）必须是 `<网关浏览器入口>/app/invite`：网关只把
`/app` 前缀交给 Web。本地部署此前配成 `/invite`，链接会落到 BFF 的 404；走查对链接路径做了断言。

## patch 0007：角色管理入口

0007 只把共用包的 `RoleManagement` 挂到成员页。管理面从 BFF 分别读取本 Tenant 的
ACTIVE HUMAN 候选人与持有 Workspace `manage` 的工作区；不以频道成员列表冒充角色候选人。
按钮由 BFF 当前角色事实与 ACTIVE ActionDefinition 决定，提交仍走 Governed Action，
最终权限、审批与最后一位 admin 判定仍在 Core。Web 镜像由本补丁与共用包重新构建，
Digest 记在 `upstream/buzz-web/kailo/upstream.yaml`；2026-09-25 浏览器走查的成员页
确实加载了角色区、既有 admin 标记与授予入口。

2026-09-27 当前固定镜像
`sha256:96b423034be8a238fcd244d2a54f7ca5325e273e5c7571164294eb866582c109`
上的完整浏览器走查退出 0，20 个计时场景、30 条记录、意外来源与
CSP 违规均为 0。归位能力仍为 `exposure: none`：成员页实际请求收到
404，`LegacySecretRefManagement` 不渲染。证据与本地测试 namespace
的离线清理见[归位核验](../../../core/verify/secret-ref-rehome.md)。

## 复现

### 2026-09-25：原生聊天时间接入共用目录

- 权威与状态：`REQ-08`、`SS-WEB-PRESENTATION` 和 `apps/AGENTS.md` 规则 12
  要求协作面与管理面共用 locale、message key、阈值和复数语义；这是 Web
  宿主的适配，不改变 Buzz Relay 的时间戳事实。
- 影响与兼容：GitNexus `kailo-plus@8643dc7` 对共享
  `apps/web/packages/platform/src/format.ts::relativeTime` 报 `CRITICAL`，
  5 个直接调用者、8 条页面流程；本次没有改该函数。上游开发树的
  `web/src/shared/lib/relative-time.ts::relativeTime` 在索引中为 `UNKNOWN`，
  全文检索确认仅被 `ChannelPane` 调用。新增补丁只让这一个入口消费共用函数；
  无 API、数据库、Workflow 或四语言契约变化。Desktop/Mobile 的聊天时间仍
  由各自的原生格式器渲染，本增量不声称三端整体同源。
- 副作用与异常：Unix 秒转换后使用同一浏览器 locale；无效或超出 JS Date
  可表示范围的值显示共用目录中的“时间不可用”，不抛错中断频道。
  该显示转换不提交动作、不改变授权、审计或消息正文。未来时间由共用目录
  的 `future` 文案表达，不冒充过去时间。
- 交付验证：`0008-chat-relative-time.patch` 在固定
  `a6766c482533d028582d0efcfd3740769f86217c` 基线和 0001–0007 后重放成功；
  对 `.references/buzz-web` 上该 commit 的 `git grep` 确认
  `web/src/shared/i18n/index.ts::getLocale/t` 仍在，`git ls-tree` 确认
  `ThemeProvider.tsx`、`globals.css` 与 i18n 文件仍在；
  重建源树的聊天格式器、定时钟测试与角色页同开发树逐字节相同。
  源树 `npm run check` 与 `npm run typecheck` 均退出 0，定向 Vitest 4 文件/14 测试通过。
  故意把英文昨天改成“1 day ago”时该测试以实际值不符失败，恢复后通过。
  16 GiB、5 CPU 的独立 BuildKit builder 构建镜像
  `sha256:01b2397fde9e680c00e44072565d11f7fe8410049442a5ea2a40bda29b846c8a`；
  本地容器健康。2026-09-26 该镜像上的真实浏览器走查退出码 0，
  `summary.json` 记录 24 个步骤、无 CSP 违规，含登录、消息、附件、
  BFF 重启后续流、任务、审批、邀请与注销；证据在
  `/tmp/kailo-web-chat-time-walk-final-20260926`。走查验证聊天渲染路径，
  中英文时间边界由定时钟测试验证，未把走查说成逐语言边界验收。

2026-09-25 共享文案增量：固定基线与既有补丁、更新后的 `i18n.ts` 重新构建并推入本地 registry，镜像 digest 为 `sha256:c64a5d818eec7c517d987ef84cb9394c4e60abf7625d117121873376c65d4426`；manifest、部署 compose 与追溯记录均已同步。此次未重跑浏览器走查，前述走查仍是上一增量的证据。

2026-09-25 Mobile 登录与连接文案增量：再次以固定 Web 基线、既有补丁及更新后的共享 `i18n.ts` 构建并推入本地 registry，镜像 digest 为 `sha256:728181887ab9000b07edb6548d7a9b2ceaf6729a598b02674594d3a889eb6db5`；manifest、部署 compose 与追溯记录已同步。此次变更没有改 Web 页面调用逻辑，也未重跑浏览器走查；前述浏览器结果仍属历史增量。

2026-09-25 成员、设备、审计文案增量：共享 TS 包的枚举视图与同源双语表一起进入固定 Web 基线的 `vendor_files`，镜像 digest 为 `sha256:15f85be2f57300817a58d236fe141e712ff934f1f01afb72a0abd76228090973`；manifest、部署 compose 与追溯记录已同步。共享包测试 50/50 通过。真实浏览器走查在当前镜像上 17/17 通过（证据目录 `/tmp/kailo-web-walkthrough-i18n-rerun2`）；成员页断言已从原始 `ACTIVE` 调整为精确匹配本地化的 `Member`。首次复跑因当前终端未继承 Docker 组而在 BFF 重启步骤中止，第二次以 `sg docker` 启动后通过。夹具清理先尝试删除被额外成员引用的 IdentityProvider，日志有一次外键错误；后续清理结束后，核验用户对应 Provider 与两次走查的 Workspace 数据库计数均为 0。清理顺序的日志问题不作为已修复项。

2026-09-25 Mobile 设置页文案增量：共享 `i18n.ts` 新增设置页 key，固定 Web 基线与既有补丁重新构建并推入本地 registry，镜像 digest 为 `sha256:38cfb3a36b4b1e4d87266b4db6435c10e2ad57a021f9da4b39d4d1bf3879b41d`；manifest、compose 与追溯记录已同步，本地 `buzz-web` 容器使用该 digest 且健康。`check.sh --full` 十项通过。本增量没有改 Web 页面的调用逻辑，未重跑浏览器走查；上一段的 17/17 仅是历史镜像证据。

2026-09-25 Mobile 主题选择器文案增量：共享目录新增主题与强调色的 en/zh-CN key；固定 Web 基线及既有补丁重新构建，最终镜像 digest 为 `sha256:c2f66fe3b5d7ec43a45077c8f0a2580f12a86574868fbbb041b8c7a9ed206888`，已同步 manifest、compose 与追溯记录。本地 `buzz-web` 容器以该 digest 重建并达到 healthy，`check.sh --full` 十项通过。Web 页面调用逻辑未改；本增量尚未重跑浏览器走查，先前的 17/17 是历史镜像证据。

2026-09-25 平台时间文案增量：相对时间的单位阈值、昨天/明天等例外与 en/zh-CN 复数选择集中在共享 `i18n.ts`，Web/Desktop 共用的 `relativeTime` 改读同一目录。固定 Web 基线及既有补丁重建镜像 `sha256:fa44081a56a7962cc1e8caf93eb344ab60492e51144f48dfe8933a46579fedfd`，manifest、compose 与追溯记录已同步，本地容器达到 healthy。共享包测试 53/53 通过；当前镜像上的真实浏览器走查 17/17 通过，证据目录 `/tmp/kailo-web-walkthrough-time.B7EzSb`。走查覆盖消息、附件、成员、审计、任务、审批、邀请、断线恢复与注销；相对时间的中英文边界由共享包定时钟测试证明，走查没有逐个切换语言和时间边界。

2026-09-26 任务取消入口增量：固定基线、既有补丁与本次共享契约和平台包重建后，镜像推入本地 registry，摘要为 `sha256:7f9e8b2a528d579b3db873a728223d5d67e1e61b30af5bfda8d5c48db992ea47`；`baseline.yaml` 已记录补丁集合与产物摘要。共享 TypeScript 测试及 `check.sh --full` 的类型、契约、追溯和供应链步骤通过；本增量尚未在该镜像上重跑浏览器走查，前述走查不充作新镜像证据。

2026-09-26 取消终态展示修正与浏览器复验：共享任务详情在原任务进入确定终态后撤掉“取消请求已提交、原任务尚未确认取消”的暂态提示。固定基线重建的 Web 镜像为 `sha256:ec6d609d8c58652850468346cb2039c322d08cb0c00a967b39e7a7193faea770`，补丁集合摘要为 `sha256:f18f84fb059e1b78f82c7689224eb9a214dd7e1c8d62f1123d61d4aee3714cb6`；manifest、compose、追溯清单已同步。本镜像在真实浏览器走查退出 0，17 个主场景、26 条结果记录、CSP 违规 0，证据 `/volumes/data/kailo-web-cancel-zzolQL/summary.json` 与 `11c-cancel-request-accepted.png`、`11d-task-canceled.png`。取消场景在 Worker 停止时核验控制接受不等于原任务终态，恢复后核验 `CANCELED` 与暂态提示消失。此结果不替代 Desktop/Mobile 原生端验收。

```bash
cd apps
./tools/build-upstream.sh web-client                    # 完整源码树与 client-kit 输入；先按 apps/07 核对受限 builder 与部署参数
./tools/check.sh seam                                   # 核对固定基线、删除清单、当前源码与产物摘要
core/verify/web-walkthrough.sh <证据输出目录>              # 需要 Docker 权限与已启动的本地拓扑；证据输出到数据盘
```

## 完整源码树上的接手浏览器复验（2026-09-30）

ADR-15/16 之后，不再应用补丁或在构建时复制共用代码。
上文 `patch_series`、`vendor_files`、旧路径与旧镜像仅保留为历史证据，
当前来源记录是 `web-client/fork/upstream.yaml`。

当前 Web 镜像 `sha256:3159cff1e8e40f2b12c11749c8756abf52e24d0779d0975936b20afb5eca3668`
已由本地 `buzz-web` 容器运行，来源记录的源码摘要经现有 seam 门禁核对一致。
Core 使用 `0ec5e552` 之后的未提交源码，本次走查不认作一个已发布版本。

复用已有 `core/verify/web-walkthrough.sh`，在内存 8 GiB、CPU 400% 的 cgroup
中执行，证据目录为 `/volumes/data/kailo/tmp/codex-web-review-20260930.QZSitH/`。
退出码 **0**，`summary.json` 有 20 个计时场景、30 条记录，意外 origin 与 CSP
违规均为 0。覆盖登录、频道与消息、发送失败时保留草稿、BFF 重启与续流、Relay
中断时的结果不明、图片附件、收藏/静音/已读、成员/审计/设备页、审批撤回与批准、
取消、独立审批后重跑、邀请和注销。

故障与拒绝证据没有被消除：`failedResponses` 中有 37 次 503（主动停止
Core/Relay 的恢复过程）、两次 409（审批冲突与邀请重复兑换）、一次 422
（新审批投影尚未生成）、一次 403（浏览器伪装原生登记被拒）。控制台还记录
了 SSE 断流；不宣称零控制台错误或生产容量达标。

退出核对：原会话 `REVOKED`、撤回审批 `CANCELLED`、批准审批 `CONSUMED`；
本轮测试 Tenant `888fef97-1f6d-4e5d-a16b-9c000aa68abc` 的数据与 OpenBao
子 namespace 清理完成，本地 Core/Relay/Worker 恢复。独立探测 BFF 的
`/healthz` 为 HTTP 200；服务端 listener 不提供该健康路径，不能用它的 404
判断 BFF 不健康。

本次仅复验 Web，不证明 Desktop/Mobile 安装包、跨语言主题整体同源或生产容量。
13 份能力追溯记录的 Web 摘要已同步当前构建记录；同步摘要没有变更能力状态，
也没有把未提交 Core 镜像写成发布 provenance。

## CAS 与订阅修复后的当前镜像复验（2026-09-30）

Web 来源记录现为镜像
`sha256:9f5e4b48f45dbabc735c9ea961e38542f30ddd53456901f15a940da307bcbe28`，
源码摘要为
`sha256:b48ed4722da6a48b601f0f896650cc905a98c519200c31fc2e7314ceeeb569a7`。
既有 `tools/build-upstream.sh web-client` 已构建、推入本地 registry 并自动回写来源记录，
最终退出 0、16.691 秒。之前两次失败保留：root transient unit 的 Git 信任前提
缺失退出 2；下一次在镜像构建完成后因缺少 `REGISTRY` 退出 1、11 分 21.613 秒。
最终只从现有 `.env` 的 `REGISTRY_HOST` 局部投递该工具所需配置，没有修改构建工具、
Git 全局配置或 Docker 配置。成功日志为
`/volumes/data/kailo/tmp/codex-web-denied-artifact-registry-20260930.log`。

Compose 的 `buzz-web` 已按此 digest 重建并达到 healthy；13 份追溯记录的 Web
digest 同步，能力状态未提高。Core 为当前未提交工作树的本地构建，不能据此登记为
已发布的源提交。当前修复是首次用户状态原子 CAS、Tenant/Workspace 生命周期版本
进入订阅 generation，以及明确撤权后 Web 停止重连并清空当前聊天；不增加 API、
领域状态、Workflow、配置上限或另一套文案。

复用已有 `core/verify/web-walkthrough.sh`，在 8 GiB、CPUWeight=50 的 cgroup
内运行；20 个计时场景、30 条记录通过，退出 0、1 分 46.072 秒。证据目录为
`/volumes/data/kailo/tmp/codex-web-cas-stream-live-20260930/`，完整输出在同名 `.log`。
覆盖现有登录、聊天、媒体、状态保存、任务、审批、邀请、BFF 重启、Relay 中断与注销。
意外 origin 与 CSP 违规均为 0；8 条失败响应和 9 条控制台错误如实保留，来自走查的
服务中断、冲突或拒绝场景，不声明零控制台错误。

会话查证为 `REVOKED`，撤回审批为 `CANCELLED`，批准审批为 `CONSUMED`。
本次 Tenant `d59e79e7-24f2-4885-9c1f-ef8463e1a0c2` 的数据库引用与 OpenBao
子 namespace 已由现有退出清理查证并清理；Core/Relay/Worker 恢复，独立 BFF
健康探测 HTTP 200。

本走查没有专门覆盖非零版本的首次写入、并发首写、manage-only 撤权再授权、
Tenant/Workspace 暂停恢复的旧 generation 或终端撤权帧后的重连次数。
这些边界不借本节正向结果判定通过；消息/线程级用户状态权限查证也未闭合。
没有新建测试或夹具代码，不替代 Desktop/Mobile 安装包验收、生产容量或发布门禁。

## 模板检查与当前 Web 产物登记（2026-09-30）

本批只修已有检查错误：Biome 开启 HTML interpolation，精确排除原始 Go-template
`public/manifest.webmanifest` 的纯 JSON 解析，并格式化 `t` 的长行。
未扩大 HTML/JSON 排除范围、关闭 lint 或改动 Caddy 的 `html`/`toJson` 编码、
显示名来源与模板语义。

现有 `npm run typecheck`、`npm run check` 均退出 0；`npm test` 为 4 文件、14/14。
输出保存在 `/volumes/data/kailo/tmp/codex-web-template-i18n-checks-20260930.log`。
可恢复判别验证只还原本批 `t` 长行，现有 check 以单一格式错误退出 1；恢复后
check 退出 0，分别见 `codex-web-format-destructive-20260930.log` 与
`codex-web-template-final-20260930.log`（同一数据盘目录）。这些检查在后述
ReadMark 描述生成之前执行，没有把它们写成生成后的再次运行。

复用既有 `tools/build-upstream.sh web-client` 完成首次构建、登记和仅 Web 部署后，
四语言生成更新了 ReadMark 说明注释；字段未变，但共享 TS 是 Web 构建输入，
因此又执行了一次现有目标的增量构建、登记及仅 Web 部署，均退出 0。
该次构建前、构建后与自动登记的源码摘要一致：
`sha256:7c6b2d3a898ea8a7683ec2801c03fd566c8af6a994da98e34eac5ae604129f96`。
实际镜像摘要仍为
`sha256:a21d15ffb179cab292ddab76825254ea5aa1438823626541d7ae049cc4f8358c`，
没有为生成注释变化人为改写产物摘要。两次构建均使用现有 data BuildKit 的
16 GiB、4 CPU 限额；最终构建与部署日志为
`/volumes/data/kailo/tmp/codex-web-readmark-artifact-20260930-180450.log` 和
`/volumes/data/kailo/tmp/codex-web-readmark-deploy-20260930-180450.log`。

现有 Compose `up -d --no-deps --no-build --wait buzz-web` 退出 0，未初始化或重启
Core；Compose 引用、容器实际镜像与登记摘要一致，容器 running/healthy，内部
健康回应为 `ok`。真实 Caddy HTML 的 title/meta 与 manifest 的 name/short_name
均等于同一部署显示名；渲染后的 manifest 可作为 JSON 解析，二者无未替换的模板。
13 份追溯记录仅同步实际 Web artifact；其中已有 Desktop artifact 行另按真实
Desktop 构建登记同步，没有改动能力状态、旧 Core/Worker 摘要或历史门禁结果。

前节 20 场景、30 条浏览器记录仍属于 `9f5e4b48…` 历史镜像，不充作本节
`a21d15ff…` 的浏览器全链证据。本节只证明既有检查、真实构建登记、部署健康和
Caddy 渲染，不证明 Desktop 验收、SBOM/provenance 发布链或生产容量；源码仍为
未提交工作树，尚未提交或 push，也不据此登记为已发布版本。

## 共享主题模式后的当前 Web（2026-09-30）

ThemeProvider 改读共享 kit 的三种模式，保留设备偏好存储、系统配色订阅与开发预览。
现有 typecheck、格式与 14 项测试退出 0，详见
`core/verify/functional-layout-regression.md`「共享主题与协作界面呈现增量」。
既有入口实际构建、登记退出 0，source 为
`sha256:446595d00f25c90bff044ae2b806a70189806960e57c167478847ce6e2710745`，
artifact 为 `sha256:a830bba58ce86f8a0129348c32b816cf2eaf168688f18dac9e6188226b9bd9af`。
仅 Compose `buzz-web` 重建并达到 healthy，Core 与数据库没有重启。

用现有核验用户登录同一镜像的真实浏览器走查退出 0，5/5：系统深色、无刷新切换
系统浅色、设备浅色覆盖系统深色、设备深色覆盖系统浅色、非法偏好回退系统。
日志为 `/volumes/data/kailo/tmp/codex-ui-theme-runtime-20260930.log`。
没有新增夹具、业务测试对象或保存浏览器凭据；浏览器执行后关闭。
本节不复用历史 20 场景证明当前完整业务链，不证明三端整体呈现或 Stage 关闭。
镜像来自完整当前工作树，不是本批选定源码提交的发布证明。

## Web 依赖漏洞定向修正（2026-10-01）

对当前 `web-client/web/package-lock.json` 向官方 npm registry 执行完整
`npm audit --json`，实际退出 1，复现既有构建的 3 项报告：Vitest 与
`@vitest/mocker` 4.1.10 各一项 moderate，Nano ID 3.3.17 一项 high。
[Vitest 维护者公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
给出的修复版本为 4.1.11；Nano ID 的官方 registry 公告标记 3.3.18 为
已修复版本，其[上游发布](https://github.com/ai/nanoid/releases/tag/3.3.18)已核对。

仅修改 Web 的依赖声明与锁文件：Vitest 最低版本改为 `^4.1.11`，其已锁定
的 8 个包由 4.1.10 更新为 4.1.11；Nano ID 按 PostCSS 已有的 `^3.3.16`
传递依赖范围解析为 3.3.19。使用现有 npm 的定向 lock-only 更新，没有
`audit fix --force`、主版本升级、新增直接依赖或 override。npm 同时补全同版本
WASI optional bundled 依赖与 license 元数据；已有 `file:` 复制安装语义保留，
没有恢复符号链接或覆盖原锁文件的共用包接入改动。业务 UI、测试与夹具均未修改。

执行者为已有检查镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
Node 24.21.0、npm 11.19.0。启动前核对无项目构建进程、memory PSI 为 0；
`docker create` 后回读实际 2 CPU、4 GiB memory、4 GiB memory+swap。
源码副本、依赖安装、缓存、静态构建与日志均在
`/volumes/data/kailo/tmp/codex-web-dependency-audit.0eiRW0/`，没有宿主 npm
操作或工作树 `node_modules` 写入。校验后 89 个真实源码输入逐文件比较一致。

复用当前 package scripts，实际输出为：

```text
npm ci --registry=https://registry.npmjs.org       exit 0
npm run typecheck                               exit 0
npm run check                                   exit 0
npm test                                        exit 0; 4 files, 14/14
npm run build                                   exit 0; Vite 8.2.0
npm audit --json --registry=https://registry.npmjs.org
                                                exit 0; vulnerabilities = 0
```

原始 registry 版本与 integrity、修正前后 audit JSON、定向更新和验证输出分别为
上述目录的 `registry-*.json`、`before.json`、`after.json`、`installed-audit.json`、
`targeted-update.log`、`verify.log` 与 `source-match.log`。首次容器启动命令的
引号错误退出 2，尚未执行 npm audit，保留在 `before.log`；后续真实审计的
退出 1 是修正前漏洞结果，保留在 `before-actual.log`，没有改写为通过。

GitNexus 三个 File 目标实际返回 `UNKNOWN`（锁文件不被索引），由现有 Web
Dockerfile 的 `npm ci` 与 `npm run build` 消费链补证。查询时索引 commit 与
runner 对齐，但公共接入等五个文件已有 drift，不宣称全图 fresh 或提交门禁通过。
本节只证明当前依赖输入的扫描与既有检查；未构建、登记或部署新 Web 镜像，
在线 `970e1743…` 产物不借本节判为已修复。未执行新浏览器走查、全平台门禁、
提交或 push，Stage 2 与生产发布不据此关闭。

## Desktop 导航、内容面与主题共源提取（2026-10-01）

本批直接复用 Desktop 的既有呈现源：五项平台导航进入
`client-kit/ts/platform/src/react/navigation.tsx`，渐变层与内容面进入
`react/surfaces.tsx`，完整主题加载器、颜色推导与 CSS 进入 `theme/` 和
`theme.css`。Desktop 改用包导入，旧重复主题文件删除；Web 左侧导航、
渐变层、内容面与全局主题消费同一份源，不再分别维护视觉实现。

`theme/theme-loader.ts` 的 SHA256 为
`c74032dce35b0f443badda8979668dbbe4ee7cd5ff8f8178e7225cd0d936b5d9`，
与移动前 Desktop 完整文件相同。颜色推导仅为共用包的严格索引检查补充
必匹配捕获的类型证明与同一 RGB 三通道的显式亮度计算，原常量、公式与
默认动态 Buzz/GitHub Light、Buzz Dark/GitHub Dark 配色保留。Web 保留
浅色、深色、跟随系统三态偏好、设备存储和系统订阅，并防止过时异步主题
覆盖新选择；没有开启 Desktop 的玻璃效果或增加主题设置。

共享仅覆盖本节列出的已有视觉能力与下述纯正文呈现。聊天解析、缓存、编辑器和
宿主特有处理仍为两端各自实现，没有整个 UI 共用比例的统计或验收依据。Web 仍经 cookie/BFF，Desktop
仍本机持钥直连 Relay；管理面仍经 BFF。共享导航与主题不导入 Tauri、
原生身份、窗口或 Relay 连接，也不改变授权 Workspace 列表、无 Workspace
时的 Tenant 管理入口、偏好 CAS 或会话处理。

### 同批纯正文呈现与 typography

`client-kit/ts/platform/src/react/message-body.tsx` 提取 Desktop 原有正文外层
类名与 15 个纯块级组件：blockquote、br、h1–h6、hr、li、ol、strong、td、th、ul。
Desktop 的 `shared/ui/markdown.tsx` 与 Web 的 `features/chat/ui/MessageContent.tsx`
直接导入同一 `MessageBody`、外层类名与组件表。Desktop 仍使用既有缓存与
运行时上下文，保留原生链接、深链、提及、预览、代码和媒体组件；Web 仍使用
既有 ReactMarkdown 与 remark 插件、BFF/hash 媒体核验、默认 URL 清洗和提及。
没有共享传输、解析器、缓存或编辑器，也没有放宽 Browser 的身份边界。

原 Desktop `globals/typography.css` 完整迁入共用 `src/typography.css`，
旧文件删除，两端全局样式直接包导入。新文件 SHA256 为
`aef2bdf3423f3b263a1e0028aa10d5c4d4e088f70b9eb42d31abf83fc301bf53`，
与提取前索引记录的原 Desktop 文件摘要相同。正文字号、行高与段落、列表间距
只由此 CSS 定义默认值；两端 Tailwind 将 `text-message`、段落和列表 token
映射到这些变量。Web 原先单独的正文默认样式已移除；本次不增加 Desktop 的
字号、密度或窗口缩放设置。

本段记录已写入与亲读的调用链。下述 SDK 结果属于更早的导航与主题快照，
不是新增正文块、typography 或当前整批源码的验证；当前产物、部署与完整业务
验收不据本段宣称通过。

### 导航与主题快照的 SDK 结果

真实 SDK 检查复用已有不可变检查镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
Node 24.21.0、npm 11.19.0；容器实际限额为 2 CPU、4 GiB memory、
4 GiB memory+swap，没有额外 swap。源码副本、安装、缓存、构建与原始日志
位于 `/volumes/data/kailo/tmp/codex-web-shared-ui.0UHtjW/`，未使用宿主
项目 SDK 或改写工作树 `node_modules`。

首轮 `verify.log` 中 typecheck 退出 0；随后 check 因 Web ThemeProvider
长 import 的一个格式错误退出 1，未据此声称后续步骤通过。仅格式化该行后，
`verify-fixed.log` 的真实结果为：

```text
npm run typecheck                               exit 0
npm run check                                   exit 0
npm test                                        exit 0; 4 files, 14/14
npm run build                                   exit 0; Vite 8.2.0
npm audit --json --registry=https://registry.npmjs.org
                                                exit 0; vulnerabilities = 0
```

此前依赖漏洞修正的 0 漏洞证据保留；本轮没有新增测试、夹具或降低旧断言。
14 项既有测试覆盖消息渲染、提及、相对时间与文案，不直接证明左栏导航、
主题异步竞态或授权行为。此 SDK 快照也不含随后对 sidebar 标识、频道行
选中属性与共享按钮 `aria-pressed` 的纠偏；不能以该输出判定最新源码、
正式镜像或业务验收通过。

本节不登记新 Web 镜像已构建、已部署或已 push。正式产物与最新纠偏的
复验结果尚未列入本记录，历史镜像上的主题与业务走查不代替本批验收。
源码与本地检查通过不等于 Git 提交、生产发布门禁或 Stage 2 关闭。

文档写入前使用同一 native43 图谱的 File context/impact：ADR-09 为 LOW，
五个上游文档节点；本记录为 UNKNOWN，零已解析调用者。后者以来源记录
`web-client/fork/upstream.yaml` 的 `compatibility_evidence` 引用补证。
当时 UI 源码已修改，索引为 stale，不宣称完整图谱 current 或提交门禁通过；
实际输出为 `/volumes/data/kailo/tmp/codex-theme-postfact-impact-20261001.log`。

后续统一增量刷新退出 0。正文写入前的严格回执为
`/volumes/data/kailo/tmp/codex-common-ui-strict-receipt-20261001.4G14lm.log`：
实际根为 `apps`，HEAD 与索引均为 `14fa7833d6bfd6d089c805899002b869fadebe86`，
schema4、runner 三处完整一致、`incomplete=[]`，16674 个覆盖文件内容当前。
同一官方 backend 的 24 个目标、48 次 context/impact 结果保存在
`/volumes/data/kailo/tmp/codex-common-ui-batch-impact-20261001.DxCAHn.log`。
既有目标无 partial/truncated，最高 LOW；MarkdownInner、组件表与 CSS 的
UNKNOWN 以真实 memo、参数、导入和构建消费补证，未把零入边当成未使用。
新增正文文件当时尚不存在，查询明确返回 not-found/UNKNOWN，由既有父包导出
和两端真实调用限定提取边界。后续源码与本记录写入不冒充已再次对齐的索引，
全局 detect 的官方 1000 条列表上限也不冒充完整全仓审查。

### 当前整批源码与线上呈现复验（2026-10-01）

在实际提取完成后，用同一不可变 SDK 镜像和已有依赖快照检查当前源码。
4 CPU、6 GiB memory 与 memory+swap 的独立容器退出 0：共享包
typecheck 与既有 88 项检查通过，Web typecheck、check、既有 14 项检查、
build 与 npm audit 均通过，audit 为 0 项漏洞。
原始日志为
`/volumes/data/kailo/tmp/codex-shared-navigation-verify.QblxcN/verify-final-current.log`。
已有 bootstrap 检查仍输出 React act 警告，不称为零警告。

现有语义颜色检查补足了真实 sidebar 色、正文 token 与内容面阴影的宿主映射，
没有放开任意颜色。实现之后，仅在隔离源码副本给导航加入 `bg-red-500`：
同一个既有检查实际退出 1，明确检出 `red-500`；恢复后退出 0，副本与正式源
逐字节一致。日志为同目录的 `semantic-colour-mutation.log` 与
`semantic-colour-restored.log`，没有新增检查脚本或业务夹具。

事后需求复核发现共用 `ol`、`th`、`td` 只读 children，丢失 Web 原默认
Markdown 的列表起始编号和 GFM 列对齐。共享组件现剥离解析器 AST node，
保留标准 DOM 属性；不分叉 Web 实现。在镜像中直接执行既有 ReactMarkdown
和 MessageContent 的 SSR，起始编号 3、表头及单元格左右对齐均通过；共享
88 项和 Web 14 项检查再次通过，退出 0，日志为
`message-semantics-final.log`。修复前 Desktop 打包被精确取消，退出 130，
未登记为修复后产物。

既有 `tools/build-upstream.sh web-client` 构建、registry push 和来源登记
实际退出 0。最终源码摘要为
`sha256:6b3ea7ac08cf5cf264e323de106074a08e449644a6d3a2240630ca26912e980f`，
镜像为
`sha256:e1938f3c03eb60f1b8b68d06a9651e4d758afba81272620ce89a914ed63dff6c`，
日志为 `/volumes/data/kailo/tmp/codex-shared-web-semantics-release-20261001.log`。
Compose pin 已同步，运行命令仅重建 buzz-web，不重启 Core、Worker、IdP 或网关。

真实现有用户登录后，最终镜像上的侧栏 x=0、五项菜单切换及选中属性、
Enter 键操作均通过。最终镜像的跟随系统偏好也实际从
`buzz-dark` / `rgb(36, 41, 46)` 切到 `buzz` 浅色，
结果保存在下述证据目录的 `final-presentation.log`。
另一轮最终菜单复验期间 pageerror 与失败响应均为 0，
不等于整个会话零错误：首次使用过时登录事务得到 callback 400，
重新进入公开入口生成新事务后登录成功。两次检查命令分别误用旧选择器和
展示主题名，超时不记为产品功能通过，纠正后才取得上述结果。
证据与截图位于 `/volumes/data/kailo/tmp/codex-shared-web-browser.KQdTu0/`。
13 份既有能力记录的 Web 摘要已同步最终镜像，未提高能力状态或发布 gate。

本次没有新建用户、业务数据或端到端夹具，没有重跑历史业务走查；菜单切换
不证明审批、额度、消息发送或各 Stage 总门禁。源码、构建、部署与 Git 提交
分别登记，不宣称整体 UI 共享比例、原生安装包端到端或生产就绪。

### 同源 Desktop 正式产物与整批门禁

修正后的同一共享实现经既有 `tools/build-upstream.sh desktop-client`
正式构建，前端 typecheck、Vite 构建、Rust release 与 Tauri deb 打包均退出 0。
构建前后与官方来源登记的源码摘要相等：
`sha256:6ec8bcf615931245ecbd950eb068125b8b92e8507a607000c5fd7718349f9b6c`。
产物为 `dist/desktop-client/Kailo_0.5.23_amd64.deb`，20,901,758 字节，
SHA256 为 `426a2a295b1d2ccf64f64d25ae3296e1efe31a8a15a50ede5b46c92a4f99eb55`。
独立回读 deb 的 Package、Version、Architecture 分别为 kailo、0.5.23、amd64。
日志为
`/volumes/data/kailo/tmp/codex-desktop-shared-body-fixed-release-20261001.8V4tLN.log`
与 `/volumes/data/kailo/tmp/build-desktop-client.RUZU74.log`。
未安装运行，不据此登记原生 E2E、截图一致性或整端验收通过。

当前工作树实际执行 `./tools/check.sh --full`，退出 1，原始日志为
`/volumes/data/kailo/tmp/codex-shared-ui-full-gate-20261001.log`。
格式和静态检查、四侧契约生成与兼容、Go/TypeScript/Dart 检查、Workflow replay、
文档门禁、能力注册表、18 个产物来源、24 个服务的安全边界与 runbook 均通过。
Core `cargo test` 失败；四份追溯记录的 Desktop 或网关摘要不匹配；
metering 上游扫描和 seam diff 因检查缓存的 alternates 文件权限失败。
没有提供 DATABASE_URL，实际迁移演练跳过，不将其改记为通过。
该结果不否定本节已实证的 Web 呈现与 Desktop 构建，也不满足源码发布门禁。

随后只修正检查缓存中 OpenMeter 对象库的错误文件归属，未修改上游、固定版本、
Git 信任配置或源码。原 `diff metering --check` 修前退出 1、修后退出 0；
六份固定上游基准在同一镜像的现有 helper 中均可解析。
正确完整源码导出上的 Core 现有 `cargo test` 退出 0，报告 106 passed、
0 failed、3 ignored；未启用真实集成环境的早返用例不作为业务验收。
原全量错误因重定向被丢弃，无法唯一追溯，不登记臆测的产品修复。
Desktop 与网关的四处摘要指针也已同步，能力状态和发布 gate 未改变。

再执行整批 `./tools/check.sh --full`，日志为
`/volumes/data/kailo/tmp/codex-shared-ui-full-gate-final-20261001.log`，仍退出 1。
Core 检查、16 份追溯记录、供应链与原缓存失败项均恢复通过；唯一 FAIL 为
Relay 的当前源码摘要与既有产物登记不一致，需要由既有构建入口重建真实产物，
不得直接改写 source_digest 假称匹配。实际迁移演练仍跳过，Mobile release
签名仍缺失，两者不因上述恢复改为已验收。

### Relay 来源校准与限定部署（2026-10-01）

最终全量门禁的 Relay 摘要差异来自 `collaboration/pnpm-lock.yaml`。
Desktop 的本地共用依赖由 `link:` 转为 `file:` 后，该 workspace 锁文件仍是
Relay 登记输入的一部分；未删除构建输入、修改排除范围或手改 source_digest。
现有 `tools/build-upstream.sh collaboration-relay` 在原受限 BuildKit 中完成
冻结锁依赖安装、前端构建、三个原生 binary 的 release、镜像导出、registry
push 与官方 record，退出 0。实际 CPU 与内存 cgroup 分别为 8 CPU、16 GiB；
该次宿主 SwapTotal 为 0、`/proc/swaps` 为空，但实际 cgroup
`memory.swap.max` 为 `max`，不把 Docker HostConfig 相等误记为内核 swap 限额。

构建前后、官方来源记录与部署前重算的源码摘要相等：
`sha256:f63619626081bc3dd1c655922163299e5816e90f502ac5a0ae052a3f1f0e1368`。
正式镜像为
`sha256:3700b743b341d05ae2ddaae388954634c2381a5b10877c565021f3e6a7ca0bea`。
构建原始日志为
`/volumes/data/kailo/tmp/codex-relay-shared-lock-final-release-20261001.sfroOr.log`，
BuildKit 日志为 `/volumes/data/kailo/tmp/build-collaboration-relay.vRLSEG.log`。
两处 Compose 与两份既有追溯记录只同步该镜像指针，未提高能力状态或 gate。

部署前现有 `bootstrap.sh --validate-config` 与 Compose config 均退出 0；
数据库、对象存储和重放守卫 healthy，已有建表、建桶作业退出 0。
首次部署前校验从 `deploy/local` 调用要求 `apps` 工作目录的摘要 helper，
退出 1，尚未执行 Compose up；纠正该次启动命令的工作目录后，1118 个
真实输入的摘要与官方记录一致，未修改项目工具、源码或凭据。
失败日志为
`/volumes/data/kailo/tmp/codex-relay-shared-lock-deploy-20261001.WsxzJ2.log`。

2026-10-01 18:23 UTC，仅运行原 Compose 的
`up -d --no-deps --no-build --wait buzz-relay`，退出 0。
新 Relay 使用上述固定 digest、running 且 healthy；其余 21 个现有 Compose
容器的 ID、镜像与启动时间前后相同，包括 Core、Worker、Web、IdP 及旧建表
作业。未重新初始化数据库、重新运行建表或触碰旧 K8S。
完整部署前后回读与摘要验证为
`/volumes/data/kailo/tmp/codex-relay-shared-lock-deploy-20261001.nWgmIY.log`。

写入前同一 `apps-source` 增量图谱退出 0，18:03:08.745Z 的完整 typed 与
status 回执均为 schema4、current、`incomplete=[]`；五个 metadata File
impact 中本记录为 LOW，其余 UNKNOWN，以既有 Compose、追溯与摘要校验
消费者补证。完整回执和查询为
`/volumes/data/kailo/tmp/codex-relay-ui-final-receipt-impact-20261001.lpFpel.log`。
该回执不消除大型文件跳过、调用边与流程上限的覆盖限制；随后源码和文档
写入也不冒充索引仍然 current。此节未重跑全量门禁、迁移或业务 E2E，
不将健康启动、registry push 或源码登记当成 Git 提交与生产就绪。

### 图片尺寸解析共源收口（2026-10-02）

把 Desktop 已有 `dimensionsFromDim` 实现直接收进
`client-kit/ts/platform/src/react/message-body.tsx`；Desktop
`src/shared/ui/markdown/utils.ts` 导入并具名再导出，保留现有三个调用方。
Web `src/features/chat/ui/MessageContent.tsx` 删除重复实现、直接使用共享函数。
既有 NIP-92 正则、有限正尺寸规则不变，不改媒体 URL、BFF、原生传输或宿主布局。
编辑前原生 impact 分别为 LOW（Desktop 8、Web 3、共享 File 14 个关联项）；
完整原始输出与三文件独立增量 diff 保留在
`/volumes/data/kailo/tmp/codex-ui-dim-pre-impact.5KGSuh/`。

在不可变检查 SDK、4 CPU/6 GiB 容器中执行既有检查，无新增夹具或测试：
共享包 typecheck 与 88 项检查通过；Desktop typecheck、markdown 与行高的
两份既有检查 78/78 通过；Web typecheck 与实际脚本执行的全部 14 项检查通过。
原始输出在 `/volumes/data/kailo/tmp/codex-ui-dim-verify-20261002.qTTD9x/`：
`verify.log` 保存共享包结果及首次未安装 Desktop workspace 导致 tsc 不可得的
退出1；`desktop-web-verify.log` 保存错误假定 pnpm 版本的退出127；按实际
`collaboration/package.json` 固定 pnpm@11.4.0 安装后，
`desktop-web-final.log` 保存两端的最终退出0。只纠正检查调用，没有修改产品
逻辑或依赖版本来通过检查。

本增量尚未构建新 Web/Win11 安装包或部署；历史 Web/Relay 镜像及 Desktop deb
不是这三文件当前源码的产物。不声称两端99%相同或新浏览器业务场景已验收。

### 表格容器共源增量（2026-10-02）

沿用 DD-74、SS-WEB-PRESENTATION、REQ-01/REQ-21 与
[ADR-09](../../../docs/adr/ADR-09-shared-client-typescript.md)、
[ADR-18](../../../docs/adr/ADR-18-client-kit-peer-resolution.md)，仅把 Desktop
已有表格 DOM 收进 `client-kit/ts/platform/src/react/message-body.tsx` 的
`MessageTable`。Desktop `src/shared/ui/markdown/MarkdownTable.tsx` 保留原
`useSmoothCorners` 与 ref，直接调用共享 DOM；Web `MessageContent.tsx` 的既有
`MESSAGE_BODY_COMPONENTS` spread 实际获得同一表格容器。未改两端 parser、
td/th align、媒体传输、样式表、宿主布局或工程解析规则。

独立窗口原件保存在
`/volumes/data/kailo/tmp/codex-ui-table-pre-impact-20261002.vgC2ZA/`：
`shared-before.tsx`、`desktop-before.tsx` 与各自 `*-window.diff` 只覆盖本次
两文件增量，不把继承变更当作本次实现。写入前同窗口原生 context/impact
完整返回：Desktop `MarkdownTable` 为 LOW、一个直接消费者；共享组件常量
为 UNKNOWN、零条图谱调用边。后者不是未使用的证明，已用 Web 与 Desktop
真实 spread、Desktop table override 补证跨 React 传播。新增 `MessageTable`
尚无本次写入后的 fresh 图谱/PDG 回执，不将旧图宣称为当前索引。

窄验证复用已有隔离源码与依赖，仅同步这两文件，不新增测试或夹具。
不可变检查 SDK 为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
两次容器均限制 4 CPU、6 GiB 内存、memory=swap，缓存位于 Data。
首次实际内核回读为 `cpu.max=400000 100000`、
`memory.max=6442450944`、`memory.swap.max=0`；续跑保留容器配置与退出状态，
未成功取得结束后的第二份内核回读，不补写为成功。

共享包、Desktop、Web 的三项既有 typecheck 均通过；Desktop 既有 markdown
检查 66/66、Web 既有 `MessageContent.test.tsx` 检查 5/5 通过。
`sdk-verify.log` 与 `sdk-first-exit.log` 保留首次实际退出 1：通过前两项
typecheck 与 66 项检查后，隔离树缺少既有根 README，表格 SSR 读取失败。
仅把原 README 只读投递后续跑剩余检查，`sdk-remaining.log` 与
`sdk-remaining-state.json` 保留实际退出 0。Desktop 真实
`createMarkdownComponents`/`renderCachedMarkdown` 与 Web 真实
`MessageContent` 均对该既有 README 表格执行 SSR，输出同一表格容器 DOM；
没有用另造组件或新夹具替代真实消费者。

`source-sha256.log` 与 SDK 日志保留输入来源：Desktop 的已安装 file 包是
硬链接，Web 的已安装 file 包是独立旧副本，因此仅在验证容器内将新共享
文件只读挂到 Web 的真实包路径，没有改 resolver、锁文件或依赖。
两端实际消费者的共享文件 SHA 均为
`0ed0f104daa4a029e654267debe4acfeee26abef3e915217cb2242964a4ce783`，
Desktop wrapper SHA 为
`c27ab7c3ed751e3383eaabdf699d07dc92f1f147f2f434255b7851b98812d798`。
SSR 只证明这次真实 DOM 路径，不证明浏览器 hook effect、像素一致或 bundle
单 React；未构建新 Web/Win11 产物、部署或进行 Win11 验收，也不声称两端
99%总体一致或 Stage4 已交付。文档门禁与全量门禁由根代理集中执行。

### CodeBlock 主体与行样式共源增量（2026-10-02）

沿用 DD-74、SS-WEB-PRESENTATION、REQ-01/REQ-21、ADR-09 与 ADR-18，
本次把 Desktop 已有 Shiki 加载/缓存、token/diff 渲染、纯文本逐行 fallback
及代码块 DOM 迁入共享 `message-body.tsx`。原有 100 项 token 缓存、
30 个语言、150 换行高亮上限与取消 guard 未改，不新增限制或第二套 parser。
Desktop `CodeBlock.tsx` 只保留真实宿主 theme、native clipboard、
Tooltip、`useSmoothCorners` 与原 pre ref；原公开 export 保持兼容。
Desktop `markdown.tsx` 的无语言分支直接消费共享 fallback，原
`!interactive && !blockCode` guard 和 inline chip 保持不变。
Web `MessageContent.tsx` 的既有 spread 实际消费共享 pre 容器，
code adapter 消费同一高亮/fallback；主题只读取既有 Web ThemeProvider
解析后的 isDark，不增加系统偏好解析、浏览器剪贴板或 native transport。

既有 `.code-block-lines` 行号与 diff 样式逐字迁入共享 `typography.css`，
删除 Desktop `globals/markdown.css` 原副本和 Web `globals.css` 冲突 pre
规则；两端既有 globals import 实际取得同一 CSS。未改 inline CSS、媒体 BFF、
mentions、宿主布局、主题语义、package/lock 或生成器。

独立窗口原件位于
`/volumes/data/kailo/tmp/codex-ui-codeblock-window-20261002.Od1WGQ/`：
八文件 `*-before.*`、`*-after.*` 与 `*-window.diff` 只归属本次增量；
前几批共源正文、表格与继承配置不混算。写前统一 fresh 回执绑定
`apps-source`、apps 本地索引与 HEAD
`e4c544fdb63d5e54fe775d58e684249166c89543`。
`preimpact.raw.jsonl` 保留完整查询后脚本 cleanup 名称错误的实际退出 1；
使用正确 dispose 的完整 `preimpact-corrected.raw.jsonl` 与 stderr 实际退出 0。
Desktop 容器/高亮及原 helper 为 LOW（1/1/3/2/2/2 个上游），
共享正文 File 为 LOW、27 个上游（四个直接 import）。
对象 spread、两个 React code/pre 回调、CODE 常量与 CSS 为 UNKNOWN/零边，
已用真实 code/pre 调用、Web spread 与两端 globals import 补证；
不把零边或全域流程/CDG 覆盖警告宣称为完整安全证明。新共享符号仍待
批末统一 fresh/detect，不自行重建索引。

窄验证复用已安装隔离树，七份新源只读投递到实际宿主路径，并把共享
正文/CSS 同时只读投递到两端真实已安装 file 包；未改 resolver 或依赖。
Desktop 旧包为硬链接、Web 为独立旧副本，故不以旧包类型检查假证当前输入。
`source-after.sha256`、七份 after 与 SDK 输入 SHA 精确匹配；
两端真实消费者正文均为
`b323d286d81461fa56407fdd10d7e03425dac6418cb46ce64d5a225d0b6a0232`，
CSS 均为
`a70c922ca8ea648f818bff79fe0c05d65004a1a3d72eab6303d85d49275b24ad`。

不可变 SDK 镜像沿用
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 UID:GID=1000:1000 与 launcher 相同，4 CPU、6 GiB、memory=swap；
前两次内核回读为 `cpu.max=400000 100000`、
`memory.max=6442450944`、`memory.swap.max=0`，第三次同限额配置与挂载
另存 `sdk-final-container.json`。HOME/npm/Vite 缓存和 tmp 独立位于本 Data
窗口，pnpm 只读复用已安装 11.4.0，不重复 install 或全量 build。

共享包、Desktop、Web 的三个既有 typecheck 通过；Desktop 原 markdown
检查 66/66、Web 原 `MessageContent.test.tsx` 检查 5/5 通过。
`sdk-verify.log`/`sdk-first-state.json` 保留首次实际退出 1：前两项
typecheck 与 66 项检查通过后，SSR harness 缺 Desktop 既有 TooltipProvider。
`sdk-remaining.log`/`sdk-remaining-state.json` 保留第二次实际退出 1：
补真实 Provider 与 Web typecheck 后，Vitest CLI 不支持 --cacheDir，
Web 测试尚未执行。只改 Data 验证脚本，使用同一既有 Vitest API 投递独立
cacheDir；`sdk-final.log`/`sdk-final-state.json` 实际退出 0。
最终两端真实 `createMarkdownComponents/renderCachedMarkdown` 与
`MessageContent` 对既有 collaboration README Architecture 无语言 fence
执行 SSR，均输出共享 pre、code-block-lines、data-line；Desktop 原复制按钮
仍在，Web 未添加宿主动作。没有新增持久测试或夹具。

该 SSR 不执行 Shiki useEffect、浏览器圆角 effect 或复制操作，不证明像素
一致、bundle 单 React、浏览器高亮、Win11 或业务 E2E 验收。
上述窄验证结束时尚未构建新产物或部署；后续实际构建结果见下一节。
不声称两端 99%总体一致或 Stage4 已交付。

### 同源呈现候选与真实构建收口（2026-10-02）

基准为 `e4c544fdb63d5e54fe775d58e684249166c89543`。只选择既有呈现
闭合路径、根锁文件与实际产物指针；不把工作区继承的 Session、Quota、
AgentDefinition、TenantDelete 或 PlatformApp 三个治理增量混入 UI 交付。
完整 diff、排除的治理 diff、真实构建日志与原 manifest 字节保存在
`/volumes/data/kailo/tmp/codex-ui-presentation-candidate-20261002.NXiRj2/provenance/`。
候选只是同一工程的源码导出与私有 index，不是第二个 Git 仓库或开发项目。

原 `tools/build-upstream.sh` 对两端均实际退出 0。受限 BuildKit 使用不可变
镜像 `sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`，
实际 8 CPU、16 GiB、swap=0，状态与缓存位于 Data；未调用宿主 SDK。
Web 的 96 个真实输入按原 helper 得到源码摘要
`sha256:92b552e037c8d6c90e160ea3f420f4083f822166a9dd468dbfe6fad096c59b65`，
registry 原 manifest 字节摘要为
`sha256:ad82d6e69049b2d7bccbc4f4a0c6e2079fcdc06fff1c58c39beb9f49e845bcf7`。
Desktop 源码摘要为
`sha256:378834b3a8fedaafb2a8f8739bc6f3cecc408678d7e12ef65be5d33358091bce`，
原 recipe 产出 `Kailo_0.5.23_amd64.deb`，实际文件字节摘要为
`sha256:d28520f7949f4422f0b542025ff62b914229671ff11f91a11d3d80e426cac054`。
两份 source/artifact 记录由原 helper 写回，没有手调源码摘要。
Linux amd64 包不替代用户所需的 Windows 11 安装包、登录和协作验收。

共用 workspace 锁文件仍是 Relay 的真实输入。原有正式构建日志
`codex-relay-shared-lock-final-release-20261001.sfroOr.log` 与
`build-collaboration-relay.vRLSEG.log` 的源码摘要 `f6361962…` 与本候选
1118 个筛选后输入逐项相同；原产物 `3700b743…` 的 registry manifest
字节也已核对相同，因此复用该真实同源产物，不重复构建、不删减 inputs。
该原 recipe 没有导出 dist SBOM/provenance；现有上游产物门禁核验
source/artifact 关联，dist 的这两项规则只适用 Core/Worker，不补造原件。

事后主动破坏验证仅发生在 Data 私有候选：先运行原有两消费者 SSR 与 Web
检查退出 0；断开 Web 的共享 pre 消费后，既有 `data-code-block` 断言确实
失败、退出 1；按原字节摘要还原，再运行同一检查退出 0。
原件位于该目录 `discriminator/`。这不是缺 Provider 的 launcher 失败，
没有新增持久测试或夹具，也没有破坏工作区产品源码。

本节记录构建和检查的实际结果；记录时未部署上述 Web 产物，尚未取得
本批提交树的全量门禁与批末 fresh/detect 回执。SSR 仍不证明异步高亮、
原生剪贴板、浏览器端到端、整体共享比例或三端 Stage 退出验收。

## 2026-10-02：同一产品候选与最终合同的 Web/Windows 原入口重建

本节是 `REQ-21`、`DD-74`、`DD-111` 与 `SS-WEB-PRESENTATION` 的实际构建增量，
沿用 ADR-06/09/18 的两宿主边界与直接共源，不新增业务功能或提高能力状态。
前节 `ad82d6e6…` 与旧 Windows `83e612e8…` 不替代这次新合同产物。
唯一输入候选为 `/volumes/data/kailo/tmp/codex-delete-commit-candidate-20261002.KBSv5P`：
共享 UI 与最终四侧合同在业务源 tree `575163abf772e380125ab1682881ad344371a810` 冻结，
文档同步 tree 为 `06e6c45100959bcdeac1ef11cae8933af57efd72`；后来 Core-only 修正的
tree `e1717576d4d97892d60abadea86978b9d0410173` 不改变 Web/Windows 输入。
这些是 tree，不冒称 commit；实际产品提交由批次负责人另行登记。

原 `tools/build-upstream.sh web-client` session `49846` 实际退出 0，包含真实类型/Vite
构建、registry push 与原 helper 来源登记。固定 Node/Caddy 配方未改：原算法与实际
stage/tar 均核得 96 个输入，source 为
`sha256:d08638e53edb14745d4c235ba2e5e7cef15755ba11f7ef884fe05c8e16f45539`；
新 Web 镜像为
`sha256:bfc118ab03bd0c430d3027a30c2407e62dce46de44d5cce8b384d2b8549c3109`。
registry 原 manifest HTTP 200、响应 digest 与 1816 字节的 SHA-256 三者一致。
没有复用旧 source digest，也未用改摘要或删输入方式通过门禁。

同一候选的原 Desktop Windows helper session `82920` 实际退出 0，最终 source 为
`sha256:ae470872bfc63b972249045f75c5579765c1fb840e1dd545ff8703efceccc0ec`，
真实 NSIS 安装包 digest 为
`sha256:9aef4725e49e87daa4b52decc2ed69de14eb293aeaf2540d4a854e97f868970b`。
完整 Windows 字节、工具链与 unsigned 边界见
[Desktop 核验](../../../collaboration/fork/verify/desktop-client.md) 本日同合同增量。
13 份已有 Web trace 的 artifact 引用与两处 Desktop 引用仅同步本次真实 digest，
不改其他产物、status 或 gate；没有覆盖 Core/Worker/Relay 的记录。

原日志、实际输入归档、锁与共享正文 SHA、registry 原件及前后原算法核对均保存在
`/volumes/data/kailo/tmp/codex-unified-web-win-build-20261002.0VQIcC`：
`web-build.log`、`tmp/build-web-client.rMP1fE.log`、`web-build-exit-receipt.txt`、
`web-original-build-context.tar`、`web-actual-stage-source-proof.json`、
`web-registry-manifest.headers`、`web-registry-manifest.json`、
`final-candidate-build-inputs-before.json`、`final-source-record-proof.json` 与
`frozen-lock-contract-ui-recipe-sha-complete.log`。末次核对的输入路径、source digest 与
原 helper 写回值均一致；前一可选 SHA 探针错用不存在的 `src/enums.ts` 退出 1，
按真实 `src/generated/contracts.ts` 修正后退出 0，两个原结果保留，不是构建失败。
大 chunk 等原警告未隐藏。复用已有 8 CPU/16 GiB builder 与 Data 缓存；
未新增 SDK、测试、夹具或重新运行全量检查。记录时新 Web 未部署，
新 Windows 未安装运行，不宣称浏览器业务、Win11 或三端 Stage 验收。

## 2026-10-02 13:30 UTC AgentVersion 合同变更后的 Web 原入口重建

本次只因四侧共享合同已变更，重建其实际消费者；没有另写 Web UI，仍
复用 client-kit 与 Desktop 的同一份 TypeScript 呈现。
实际输入为本批选定快照
`/volumes/data/kailo/tmp/codex-agent-version-selected-20261002.7p1PX8`，
原算法核得 96 个输入，source 为
`sha256:e01a495ef6445f8c8b54d9951881d0f338fbcdee8ae21b3fbcf9d9854b09d9e3`。
原 `tools/build-upstream.sh web-client` 实际退出 0，完成真实 tsc/Vite、
OCI export/load、registry push 与原 record；artifact 为
`sha256:0f5039d60badaf461fec0ef6041093762ab1d92caad9463bbd08d174baea7ef7`。
原构建输出报告 npm audit 0；这不抹去前文旧镜像的漏洞记录。

registry 原 manifest GET 为 HTTP 200，响应 digest、原字节 SHA-256 与
构建 digest 相同。原件目录为
`/volumes/data/kailo/tmp/codex-agent-version-client-artifacts-20261002.ZqqCat`，
`web-helper.log` SHA-256 为
`92c61ecab2f46f32acc07f82243efe1aac8f3ad019a17e45cda5db18b2968474`。
沿用已有受限 BuildKit、镜像内 Node 与 Data 缓存，没有宿主 SDK 或新检查。
upstream 两字段由原 helper 写回，Compose 与 13 份 trace 只同步真实
artifact；不改其他服务、能力状态或 gate，历史正文摘要保留。

这是构建与来源关联事实，不是新 Web 部署或登录业务通过；本批最终
full/detect、提交与部署尚未完成，Win11 新包结果另由 Desktop 核验记录。

## 2026-10-02 18:48 UTC：Agent 共享管理页的确定读取拒绝与未知结果

本增量沿用 DD-24/25、设计 17 §8 与 apps/06 §4，只修正已有
`client-kit/ts/platform/src/react/agents.tsx` 的读取状态呈现。
Web `web/src/platform/ui/PlatformApp.tsx` 与 Desktop
`src/app/routes/platform.$section.tsx` 仍通过原 `react/pages` 导出消费
同一个 `AgentDefinitionsPage`，没有第二份管理前端。

实际 Core `agent_definition::get` 与 `agent_version::get` 分别 fresh 检查
Resource/Asset 的 read 权限；未获准返回裸 403，当前范围内不可取得返回
404。Definition 的 discover 或 read 不授予 Version 的 Asset read。
原列表、详情和已发布 Version 的三处读取失败现在共用 `AgentReadFailure`：
确定 403 显示既有“未获准”文案，404 显示既有“此处不可用”文案；
已知、非 UNKNOWN 的实际分类可呈现确定拒绝，有真实已知 reason 时复用
原本地化说明和稳定 code，不从状态码制造 reason。
显式 UNKNOWN 或未知分类优先保持未知，网络错误、其他无分类错误和
畸形 2xx 数据也仍显示“结果不明”，不把它们当空列表、对象删除或成功。
不显示原始服务错误正文；重试仅调用原三个 GET，不重放写动作。
`DefinitionAction` 的冻结意图、原幂等键和未知结果处理未改，未新增
Installation、Session、运行或执行入口，也未推导客户端权限。

精确 before 与 `source-window.diff` 保存在
`/volumes/data/kailo/tmp/codex-agent-read-state-before-20261002.P44fQh`。
源 SHA-256 从
`7a9e530e62ed9bc0b149c94dc37ac3717da4d00c36e7fa4843a92ab910a4a15e`
变为 `84f26975241f74f76d20c275c962398e4e2c62acb9a56ccf781c5d668d9922aa`；
窗口 diff SHA-256 为
`c8f710bc59b1e1651d95977a8ff9695e5a9df03af78880eefabaf78cd0e1327c`。
本刀源码窄 `git diff --check` 实际退出 0；未运行 SDK 类型/测试、SSR、
浏览器或破坏验证，没有新增测试、夹具或工具。此增量不在同时验证的
backend 冻结快照内，既有 Web/Desktop 构建与部署记录不覆盖这些新字节；
尚未构建、发布或部署，不计业务 PASS、Win11 或 Stage 验收。

随后本批已按 HEAD `91a5eb2e…` 的私有选定源码集中核验，未混入继承 theme
检查或下一批 Installation 视图。实际共享包 89 项通过；在独立 SDK 副本
分别删除裸 403/404 识别、UNKNOWN 优先级和未知分类保护，实际 5/2/1 项
呈现断言失败，各变异退出 1。每次反向还原并核对源码 SHA 后，同 12 项
检查通过，最终原包检查再次 89 项通过，SDK 退出 0、无 OOM。
原始日志是 `/volumes/data/kailo/tmp/codex-agent-batch-20261002.UGTzYB/ui-sdk-isolated.log`。
还原源 SHA 保持上述 `84f26975…`；仅本刀新增检查的 HEAD 私有文件 SHA 为
`6ba749c0883be519e71d8fc7e520650b111d55bae91eb109a3c80ed38662b923`。
先前因工具 PATH 和继承 live 子 mount 的两次失败也保留，不冒充产品反例。

同批原 `tools/build-upstream.sh web-client` 与镜像仓库 push 实际退出 0，
产物为 `sha256:d0bf2e646bf8b1954a32d18ffe2dfbaf7556e7ddfebeed7094ce35289d850aae`，
来源为 `sha256:2326ff60e9610425307b864dca7b2ec83de15de7060969486a787ad694cf7c0c`，
均由原 helper 写回，日志为同目录 `web-build.log`。没有部署此镜像，
没有新增浏览器登录、Win11、Mobile 或 Agent 执行业务验收。

## 2026-10-02 22:15 UTC：Automation 共用管理消费者的正式 Web 工件

本批私有集成输入为
`/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/apps`。
Web 与 Desktop 直接消费同一 TypeScript 管理页与客户端；查询沿既有
Automation 列表、详情 GET，五个写命令为 `automation.create`、
`automation.publish`、`automation.enable`、`automation.pause`、
`automation.disable`，仍提交原 governed ActionCommand，不在 Web 另立
权限、状态或执行入口。此前四侧生成和 `--check`、shared/Web/Desktop
类型检查及共用包 98 项检查实际退出 0；Thread 枚举反向破坏由原类型检查
报 TS2339，按 SHA 还原后通过。这些是类型与呈现证据，不是新增管理动作、
真实 Automation 执行或三端业务验收。

源码冻结后仅运行一次原 `tools/build-upstream.sh web-client`，session
`79029` 实际退出 0；镜像内 npm ci、tsc/Vite、export/load、registry push
及官方 record 均完成，原 npm audit 为 0。原 source 算法读取 97 个输入，
构建前、构建后与官方登记均为
`sha256:8dbb98b595a7510b584fa1c50e4d0aec37be553bc998263dfbafd7b0401c58eb`；
实际 stage 的路径、正文 SHA 与文件模式逐项相等，额外/缺失/不匹配均为零。
artifact 为
`sha256:6f54ce3744408aa3adfa898ec639b9fad1ef4438774a0869f21b33e722d298ce`。
registry digest GET 与 tag HEAD 都为 HTTP 200；manifest 原字节 SHA、
响应 digest、RepoDigest 与官方登记相等，最终读回退出 0。

完整原件目录为
`/volumes/data/kailo/tmp/codex-automation-web-release-20261002.t6SQjw`：
`helper.log` SHA-256 为
`0c4077c6159ccaafa2a0fa7f062c3e9d5392d300446ea9ddb35df9236fa05302`，
原 native 日志 `tmp/build-web-client.d7tLbB.log` SHA-256 为
`2fe192e77e54851e135c0a4b8888ccc9f746e775d699e4f8fcf3f3e7ae1cd901`，
`final-receipt.json` SHA-256 为
`9383170d3f213aecca1fd91fe93ee064a8bbe7293a5efe9fe72c8a30ca6f1c91`，
`registry.manifest.json` 原字节 SHA 为上述 artifact，`source.stage.tar`
SHA-256 为
`70d87c25ef7041dc28714e83475dc34ecfea55685522111efeee653ae1375e06`。
`source-before.json`、`source-after.json`、`stage-comparison.json`、
registry headers/tag headers 与 `image-inspect.json` 保留原始核对事实；
`upstream.record-only.diff` 只含该 Web source/artifact 两字段，SHA-256 为
`bf86b4d92a6d87109cee8011a743cd66d333d3a88422161f7350108e18531369`。

首次派生回执错误地将 Docker `.Id` 当作 OCI config digest，断言退出 1；
`receipt-initial-failure.log` 保留原失败。实际 containerd image store 的
`.Id` 是 manifest digest，OCI config 为另一个已登记字段；按真实原生值
纠正派生断言后回执退出 0，没有修改 helper、镜像或来源摘要，也没有
重复重建。原大 chunk 警告保留。

复用既有 BuildKit 与 Data 缓存：Docker 配置为合计 8 CPU、16 GiB，
HostConfig memory+swap 为 16 GiB；实际父 cgroup `memory.swap.max=max`、
主机没有交换设备，不将其写成内核 swap0。构建后 builder 仅剩 daemon，
OOM/kill 未增加。没有宿主 SDK、部署、浏览器业务、Win11 安装验收或
完整 Agent 执行验收；当前产物不解除这些门禁，也不覆盖历史失败。

## 同源 Memory 页面功能批（2026-10-03）

实际入口仍是 client-kit 的同一 TypeScript 主体，Web 与 Desktop 不另建表单。
HUMAN owner 四写消费原 ActionCommand、原生 valueHash 与真实 head；
UNKNOWN 保留同幂等 key 并冻结再次提交，确认的原生冲突才允许重新读 head。
Core 是准入权威；浏览器不持 AGENT 密钥、不自行实现 Memory 加密或补丁算法。

本批原共享 pages 检查 63/63、共享包/Web/Desktop 类型检查均退出 0，
原件在 `codex-memory-ui-selected-verify-20261003.pxMZ6I/`。
22 输入路径中 21 项未变，唯一有意变化是原 i18n 生成器补齐 13 条 Dart 同源文案；
这次未重跑全平台套件、浏览器/Win11/Mobile E2E，不借旧日志声称通过。

原 `tools/build-upstream.sh web-client` 唯一构建、上传、登记与 registry 读回均 0。
固定上游 `a6766c482533d028582d0efcfd3740769f86217c`，98 个原算法输入 source
`sha256:998c3c64308aef52bdf29eb3a2f0e05d954bface856468f6927e05a5b5535bba`，
artifact `sha256:97bc23790559a9019feaba5bb9e514d19730410b20beb9cc8dca2924823fb69e`。
前后原 source/plan 比较 0，registry HTTP200、1816 字节原 manifest 摘要与
Docker-Content-Digest 相同。原 npm ci 280 包、audit 0，tsc/Vite build 0，
大 chunk 警告保留。原记录两 digest 字段之外未更改。

原件在 `codex-memory-web-build-20261003.1zMbBL/`：
`helper.log` SHA `d275e0277ba9ad7cd16f89789e4ba3a0d50ad792e7b1b947d5fc0b4822958a43`，
`readback.log` SHA `770e12a4a1f00456abfb5753d66aef73f8bdb385ab5b682341438265b87b8f83`。
首次 wrapper 因实际 .env 没有 REGISTRY 被拒 1，未启动 helper；随后只将原
REGISTRY_HOST 映射给 helper 的 REGISTRY，不新造地址或改部署配置，失败日志保留。
Node/npm/Vite 只在既有受限 BuildKit 中执行，8CPU/16Gi、Data 缓存、OOM/kill 无新增。
本产物未部署，不把 registry push、编译或局部页面检查称为真实 Memory 业务验收。

### 同批 Relay 实际来源收口

共享 Buzz Memory 源码改变了 Relay 的原输入，不能继续用旧产物摘要。
固定私有 commit `55a248e0872055fbb03bcafd083710028c4efef8`、tree
`68a74f7592fabdfbe5fc8a7503a71d7006a6d873` 的原
`tools/build-upstream.sh collaboration-relay` build/load/push/record 均退出 0。
1118 个真实输入的 source 为
`sha256:e68add606d98c362e49f9a9fbf33cc4deb24936d065e1ac4f5ef456e79ec30fe`，
artifact 为 `sha256:d42f83fa0dadcd78c4ad721047433a9a7c8e522767edd96cb326d641c5dd0056`。
前后原 digest 与输入数逐字相等，独立 registry GET 为 HTTP200，
Docker-Content-Digest 与 2008 字节原 manifest 的 SHA 相同。

原件在 `codex-memory-relay-win-artifacts-20261003.SosEFm/`：
`relay-helper.log` SHA-256
`6df64651b08cfd58dc9cb26e656cfde5c27f8ef2e0bcd6ccd3c88b37fc990d20`；
`relay-tmp/build-collaboration-relay.X6psGv.log` SHA-256
`c9f57f3669c268443b4cbbf35bd0fe121f310db9f3c89ebab44ef4c14c015a1a`；
两份 source 日志同为 `3ec5b4d027c86bfcf01d6468d5d877c37c1e6fd070aec570b2942a6aa0f58a8b`。
首份派生 after 回执漏输入数，cmp 退出 1；原 digest 已相同，保留该回执后
按同一 digest+count 格式核对为 0，没有重建或修改源码。

原 helper stage tar、逐文件 SHA、manifest 原字节与终态资源回读均保留。
只更新现有两份 Relay trace 与两个 Compose pin，不改变发布状态、scope、
认证或运行服务；本节不覆盖上方原 Web97 产物，不重复构建 Web，也没有部署 Relay。
Win11 新 unsigned 包独立见 Desktop 记录，真实 Memory/Agent/计量 E2E 未验收。

指针修正树 `433be885faead1e95072e10ca447d36b660a1fa7` 的原 full 实际退出 0；
日志 SHA `b6557aced681ee364ede8f722761a1e7a4c76835267f09d29962b95efa738210`，
原 full1 保留。数据库/.env SKIP、三项演练 ignored，Web97 与运行服务均未改变。

## 2026-10-03：共享管理 UNKNOWN 保留修正与真实 Web 产物

本增量沿 DD-74/75、原 Governed Action 与 UNKNOWN 不盲目重放边界，
修正同一共享 `agents.tsx` 的 Installation、Delegation 和 Version 提交消费者：
一次结果不明后，后续 403/409 或传输失败不证明原请求失败，仍保留原完整命令、
幂等键、已知 AE/Operation、锁与未知呈现。首次明确拒绝仍可解除；
Version 编辑表单关闭后才恢复目录交互，不引入新状态、权限或接口。

实现之后追加原 pages 的 12 项证据。固定 10ad SDK、UID1000:1000、
4CPU/8GiB/memory=swap、实际 swap.max=0、Data 缓存下，原三消费者类型检查
与平台完整 148/148 最终退出 0。私有副本破坏三处生产 UNKNOWN catch guard，
六个真实重查用例全部失败、原 vitest 退出 1；按 SHA 精确还原后完整目标再为 0。
两轮新断言错误的原失败保留，未改变生产语义或旧 Memory/主题检查使其通过。
原件在 `/volumes/data/kailo/tmp/codex-shared-management-unknown-fix-20261003.Ew1h5v/`，
`sdk-restored-final.log` SHA-256 为
`e534e8550feea30701f8a59f6d58754ff58afb59611f93ae149c8c484604f277`。

只对 8e3 私有选定输入执行原 `tools/build-upstream.sh web-client`，
helper 83193 实际退出 0，包含构建、load、registry push 和原来源写回。
98 个输入的原算法 source 为
`sha256:3415b3ce07defdd966051a00d7009cc1811d28a7d8a5bbe35752ea7ca92e0391`；
artifact 为
`sha256:66646d2a6bcf46a19852ca182af8a51bf31aa33563fdcecce94e6527ec5e9f3e`。
registry 独立 HTTP200、响应正文 SHA、digest header 与原 record 逐字一致；
首次读回漏 OCI manifest Accept 类型的 HTTP404 保留，补齐实际类型后读回成功，
没有因此重建产物。npm audit 为 0，原 Vite 大 chunk 警告保留。

原件目录为 `/volumes/data/kailo/tmp/codex-agent-management-web-win-20261003.yUA7u9/`；
`web-unknown-fix-helper.log` SHA-256 为
`58f61c88f04d542f7c2b3fef764a5c680eb51fe92b6bb8acf7badbdcf86d77cc`。
实际 builder 为既有 kailo-core-data、8CPU/16GiB/swap0、Data 持久缓存，
没有宿主 SDK、新 builder 或 NEXT 合同输入。四步结论：权威沿用既定动作，
影响仅真实共享管理消费者及其两端产物，外发仍经原 BFF，异常保留同请求 UNKNOWN。
本节是私有候选的交互和产物证据，不是 full、Git、部署、浏览器或 Agent 业务验收；
未将旧 Web/Win 产物冒充修正后来源。

### 2026-10-03 共享管理刷新批的实际 Web 交付

干净 `c0707d8fda400f4fcfd1eae9c57e494a633398d9` 经原 Web helper 实际退出 0；
98 项输入的路径、字节与原算法摘要前后一致。source 为
`sha256:c201703085f23e45c5733deaac1f4d9d915587ba384e6d43113b6492171caa84`，
artifact 为
`sha256:b366d565242d9efd9e1812110bbd400c936d8f53b5fcd8ca87b687d4d707d85b`。
registry 独立 GET 200、1816 字节、digest header 和正文 SHA 与登记逐字一致。
沿用原 builder、8 CPU/16 GiB/swap 0 和 Data 缓存；不复制第二份 Web UI。

同步原来源、Compose pin 与 14 条 Web 追溯引用后，原 Compose 仅
`up -d --no-deps --force-recreate --no-build buzz-web`，退出 0；新容器
`2444722ebd1028596526699f831940655efdfeba36d6cfd30d60bfc4ee737814`
运行上述产物且 healthy。与本次 Gateway 部署前基线逐项比较，只有 Gateway
和 Web 两服务变化，其余 26 个容器 ID、镜像和启动时间不变。
本回执不替代新页面浏览器交互、Win11 设备、安装初始化或全量门禁验收。

构建原件 `/volumes/data/kailo/tmp/codex-client-management-delivery-20261003.3RI9lm/`，
`web-helper.log` SHA-256
`2f46b60e5f536736e0deeea3ff17033def22cd017cac90212b511522de138ef3`；
部署比对原件在 `codex-gateway-reactor-delivery-20261003.DtznEx/` 的
`deploy-after-web-containers.log`，SHA-256
`ace4ae4dc8faaffcbd79282d27c4054612f2f4453dc4cfaab01b0c833c3ce90e`。

随后该产物经真实 HUMAN OIDC 登录与共享导航打开 Agent 管理页，原 Definition
详情、Version 历史/配置、安装列表与候选请求均返回 200。页面实际显示首版
`cc099e7c-74d6-48a8-86c2-63bb878551ea` 为 Published，安装
`8f240978-34bb-437d-97ee-498a30e67e86` 为 Being installed；没有将其呈现为
ACTIVE 或回答成功，浏览器 pageerror 为 0。只点击原只读详情，未提交新业务动作。
首次探针的显示名少一个空格导致定位超时，退出 1；改用已核实 stableSlug 后
等待实际版本 hash 和安装行呈现，最终脚本退出 0，不把探针错误归为产品缺陷。
上述 Gateway/Web 引用与前段记录已提交并普通 push 为
`66c48e80994437685c1eaa713b93a4bac43b8207`，相对 `c0707d8f` 为 21 文件、
+156/-22。该选定树文档检查退出 0；不替代最新仍失败的完整检查。
浏览器原件仍在 `codex-gateway-reactor-delivery-20261003.DtznEx/`：
`read-management.log` SHA-256
`df03570f88c2c633c3de4f964c503d47fc3635d57d42171a7d50e31593029723`；
最终 `read-management-complete.log` SHA-256
`a1819b666282061b73054f17591a46a776cde37d1acf466f9ed74ee31d5cdc36`。

本批共源 Desktop 也沿原 `tools/build-upstream.sh desktop-client` 退出 0。
source `e8a4dc259f440233f3851598bb1a5a980865dbc4c28c0ee2a87a7d118a7cd3c7`，
2258 项输入 path/bytes/link 与 Cargo.lock 前后未变；原 helper 登记 artifact
`f7f8c8aa9a61543fdae84ff779030bf59c812bab7c8690cb1a38a7886308951e`。
`codex-client-management-delivery-20261003.3RI9lm/apps/dist/desktop-client/` 下
`Kailo_0.5.23_x64-setup.exe` 实际 15,111,005 字节，文件 SHA 与 artifact 相等。
没有另外编写 Desktop 或 Web 主体；此 unsigned 包尚未在 Win11 安装或业务验收。
同目录外层 `win-helper.log` SHA-256
`adbfe711f41619a39dc8aa964dcdf1390dde278dbdfee68d123250015980f834`，
`final-source-readback-corrected.log` SHA-256
`0ae2a52491b91badf5b2fbbaaea83162219e1730ef3167c4c989a65521183897`。
初次参数路径错误 127、后置符号链接解析错误 1 的原件保留；两者不是 helper
构建失败，纠正后的两端 helper 和来源回读均退出 0。原 builder 的实际父 cgroup
为 8 CPU/16 GiB/swap 0，OOM 0；未改变 Cargo 并行度，也未新增第三套构建入口。

## Inbox 共用主体合入（2026-10-04）

冻结候选基于 `581d64bb2fd8e0f523bc4a668ab4c3a23cd046bc`，树
`107d16ab4645864e2e5897a651003cb50f0a07fb`，15 文件 +1360/-371。
窄补丁对正式 `a535179baea0fc92f8515d32102288262e4161a6` 的实际脏树
`git apply --check` 退出 0，按原 hunk 合入并保留其余修改，合入后 diff 检查退出 0。

四步影响结论：

1. 权威为设计 `09` 的协作 user-state、DD-40、SS-WEB-RELAY 与 V-SCN-28。
   Buzz 固定版本 `779af8886caae1317b4de962082429867ab61503` 的
   `buzz/desktop/src/features/home/ui/HomeView.tsx::HomeView` 与
   `buzz/desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane` 已按 commit
   重新定位；Web 复用该主体提取的聚合与行呈现，不另造 Inbox 语义。
2. 两端实际调用共享 `aggregateInbox`、`InboxRow`、`useInboxState`；Desktop
   保留原 Relay/profile/Markdown/detail 适配，Web 复用原 workspaces、members、
   messages 与 ChannelPane。读写仍经原 Core user-state 与生成的 CAS 合同，
   不继续消费本地 Inbox 已读覆盖，不新增实体、API、迁移或四侧契约字段。
3. Browser 不获得签名密钥或直连 Relay 能力；Web 每个事件核验唯一且相等的
   h scope，读取后再核对 Workspace。两个 Workspace 的相同 thread 不合并，
   页面交集不替代服务端 fresh admission，不复制消息正文到 Core。
4. 加载或 scope 失败清除呈现，generation 丢弃旧请求；CAS 未知结果保留冻结
   intent，同版本读回不冒充成功，读到更高版本仅关闭旧 CAS 写窗口，不冒充原
   请求成功。未知 shape/时间戳拒绝，显式刷新与 focus 重读仍保留错误/未知状态。

原件目录 `/volumes/data/kailo/tmp/codex-web-inbox-20261004.l5kw1b/`；补丁
`canonical-owned.patch` SHA-256
`2679292a313d98bde05032ec7f5e9dfeb82d623eb97b45fe6d7c96929187529d`，
完整路径摘要及命令回执见该目录 `source.sha256`、`evidence.sha256`、`handoff.md`。
使用既有受限 SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 UID 1000、4 CPU、8 GiB memory、swap 0，复用 Data 缓存，不新装工具链。

- Shared `npm run typecheck` 与原 Inbox 检查 10/10；Web 类型与 Inbox 检查 18/18；
  Desktop 类型与原 inbox/inboxViewHelpers/inboxSelection 检查 30/30，均退出 0。
- 原 `tools/gen-platform-i18n.py` 生成与 `--check` 退出 0；四侧契约生成物未变。
- 隔离副本删除 h 相等保护：Web 原检查退出 1；删除未决 intent 保护：Shared
  原检查退出 1。两处逐字恢复、各自原检查再次退出 0；不是编译失败代替变异证据。
- 初次严格类型、依赖副本及 Desktop loader 路径失败原件保留，纠正后通过，
  不将这些环境失败算作保护逻辑有效的证明。

上述是隔离候选证据。尚无此合并批次 full、产品镜像/安装包、部署或 Win11 验收。
Web 仍读取每 Workspace 原有界消息页并显示范围，不宣称全历史；没有新增 Inbox
SSE fan-out，也没有实时撤权或真实跨端 CAS/Relay 联合验收结论。

合入复核定位到共享 `useInboxState` 的读写竞态：手动刷新递增读 generation，
在途 PUT 的迟到回执被正确丢弃，但原清理分支也被同一 generation 拦住，导致
`pending` 永久为 true；同时原刷新未把尚未决出的 intent 标为未知。
现由同一串行写队列结束时释放 pending，刷新显式保留未决意图的 UNKNOWN；
仍不接受旧回执、不清空 intent、不重新发送 PUT。两端实际调用者一起继承修复，
无新状态、契约、超时或副作用路径；高版本读回沿原 CAS 规则关闭旧写窗口。
新增的实际 hook 消费场景覆盖在途刷新、迟到回执、同版本禁止重发和高版本恢复；
该场景现已实际通过，共享 Inbox 目标为 11 项；随下述组合共享检查一起验证，
删除刷新时 UNKNOWN 保留的生产逻辑时两项断言失败，逐字还原后通过。

## 独立 Workflows 共用页面（2026-10-04）

设计提交 `e0900662dea78a48c65cbfdd54508314947b8512` 的 REQ-23、DD-106/107
与 `06` §9.1 是本次依据。Web/Desktop 通过同一个 `WorkflowsPage` 消费原
AutomationManagement；Agents 的旧内嵌入口删除，不另建执行引擎、运行台账、
审批或审计。Mobile 仅同步生成文案，不新增编辑或控制入口。

两个实际宿主的导航及路由均接线至共享页面。运行历史使用生成的 AutomationRunPage，
调用精确 Automation 的 BFF 查询，不读取全局 Tasks 后在浏览器过滤；当前用户权限
边界保持原后端 Task 查询规则，因此标题明确为“我的运行历史”。状态与详情分别
复用 TaskStatusBadge、TaskDetail；usage 仅展示既有事件引用，不假定已经结算。
不新增 Action、Workflow kind 或权限；四侧新增只读返回契约证据见 Core Agent 记录。

Workspace、目标、未知枚举、重复游标与不明关联均拒绝呈现；换 scope 丢弃迟到读。
Automation 写请求曾进入 UNKNOWN 后，再次查询遇到 403/409 仍保留原意图及幂等键，
不得据后一次拒绝宣称原副作用未发生或允许重新创建请求。空结果仅在成功读取后呈现。
无新增业务状态、迁移、超时或对账权威，终态仍由原 Action/Workflow/Projection 决定。

冻结增量为 13 文件 +474/-20，基于 Inbox 树 `107d16ab4645864e2e5897a651003cb50f0a07fb`；
补丁 SHA-256 `8a424444bf76f47022e5a2121d7eef3f766b6cec5d32834174b8aff0d6b27407`。
正式工作树 PlatformApp 含另一批生命周期修改，合入保留该修改；选定候选只取上述
13 路径的 Workflows 增量，不将未验证的其他修改混入产品构建。

同一既有受限 SDK 内，原共享类型检查及 9 文件 286 项检查退出 0；Web 类型与
5 文件 18 项检查退出 0；Desktop 类型退出 0；同源 i18n 生成/比对退出 0。
四处生产变异（历史 scope、UNKNOWN 意图、Inbox 刷新、原生主题变量）触发
六个真实断言失败、退出 1；四源逐字还原后，共享类型及 286 项再次退出 0。
原主题检查原先误拒 Buzz 固定版本 InboxListPane 的两条 color-mix 表达式，
现仅在精确核对这两式、唯一 style 与四处变量引用后排除该原生片段；未放开任意
内联样式或颜色。初次游标夹具、主题扫描与格式入口失败均保留，不当作最终通过。

原件同上目录，`workflows-handoff.md` 与 `workflows-evidence.sha256` 登记命令和摘要。
变异日志 SHA-256 `bb72fc2d09076fffec4e6cecfd4e2b3f597bde9e50962004ee2ac295d4a54b9a`；
最终恢复日志 SHA-256 `3699e43ddb7b8394e4dd801af8c2146013620c67c52adb733ab3fac074ee1976`。
上述不替代整批 full、实际产品构建、部署、真实 Workflow 运行或 Win11 设备验收。

同批 Web 原 `tools/build-upstream.sh web-client` 已实际退出 0，输入为选定树
`35afeb574bfa46a5e74cf2b0cfda62503055b1fc`，不含正式工作树其余生命周期修改。
13 个 Workflows 路径与上述已验证副本逐字一致。原 helper 生成 source
`sha256:40237be8868af091d01c20c8375f3a7f41c871ebc3af71b3c6333402969d2c2b`，
镜像 artifact `sha256:924abf4b367e1521102b2eb1d31df11bd725fb1ebe145401728cb455775e8ccf`；
registry 原 manifest 独立读取成功且字节摘要一致。来源、Compose 与既有追溯引用
已同步这个真实产物，不改业务源码或借旧产物摘要通过检查。
本次执行复用既有 BuildKit，实际 8 CPU、16 GiB memory、swap 0，Data 缓存；
原日志 `/volumes/data/kailo/tmp/codex-workflows-delivery-20261004.IVUu4U/web-build.log`
SHA-256 `10200b6bdaafdf12513bd5c2a911314287a44b05d7a972fe6af654aa3040108d`。
镜像构建与 registry push 不等于 Git push 或部署；整批 full 与新 Win11 包尚未完成。

## 2026-10-04 共用设置与管理面板接线（实现后证据，未部署）

本组对应 DD-53、SS-WEB-PRESENTATION、V-REQ-17 与 ADR-09。原实现补丁基于
`4a13b24e79d84cb04f7573e0c9668c08be319567`，14 文件 +931/-108（含六个新增源／
检查文件及原生成器产出的 Dart 文案）；随后原样应用到干净
`d247288b40ca443c653fee8d928f1adb0da010d5`。以下是这一组的事后事实，
不把原有发布摘要当作新设置已构建、已部署或已通过实机验收。

- 权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/settings/ui/SettingsPanels.tsx::ThemeSettingsCard`、
  `desktop/src/features/settings/ui/SettingsView.tsx::SettingsView`、
  `desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx::KeyboardShortcutsCard`
  与 `desktop/src/shared/lib/keyboard-shortcuts.ts::KEYBOARD_SHORTCUTS`；
  固定 buzz-web
  `a6766c482533d028582d0efcfd3740769f86217c` 的
  `web/src/shared/theme/ThemeProvider.tsx::ThemeProvider`／`useTheme`。
  只读核验原调用，不执行 references。
- 影响：Web 与 Desktop 消费同源 ThemeModeControl／ShortcutSettings，宿主保留原
  theme／followSystem／本机偏好与真实键盘处理器；不新增配置权威、语言切换、
  provider、私钥或配对入口。Desktop 当前 20 个已登记快捷键 ID 全部有同源映射，
  Win32 与 MacIntel 原列表逐项呈现；未知 ID 不据名称猜功能，本次未扩展登记表。
- 副作用：Web 仅接原 Workspace 静音 user-state CAS，保留当前 version 与 starred，
  必须成功读取可访问 Workspace／偏好后才写；失去响应只重新读原权威，不乐观宣告
  成功、不自动重发。原生 Desktop 的其他外观／通知控制保留，不虚称 Web 有系统推送。
- 异常与兼容：失败读不变成默认未静音，不回显 native error。Web members 原先只挂
  部分面板，使已部署组件目录不可达（主线浏览器原件在 gEnXVl）；现提取同源
  WorkspaceManagementPanels，由两宿主共用。Web 保留唯一侧栏 Workspace 选择、
  MembersPane 与 TenantInvitations，未引入共享页的第二个 Workspace 选择状态；
  各面板与 BFF 原权限重验不变。

复用固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU／8 GiB／swap 0、Data 缓存；执行前压力与限额记录在私有 preflight 原件。
原 `tools/gen-platform-i18n.py` 及 `--check` 退出 0；共享平台
`typecheck`、`tsc --noEmit -p tsconfig.test.json`、
`vitest run test/settings.test.tsx test/pages.test.tsx` 退出 0（195 项）；
Web 原 `npm run typecheck`／`npm test` 退出 0（23 项）；
Desktop 原 `npm run typecheck` 及
`node --import ./test-loader.mjs --experimental-strip-types --test src/features/settings/ui/KeyboardShortcutsCard.test.mjs`
退出 0（2 项）。初次 PATH、主题语义色、SSR 夹具、pnpm 自动安装与格式入口失败
均保留原文，不计入通过；只纠正本组代码／执行输入，未安装工具链。

私有一次生产破坏批分别把主题回调改为固定 system、移除 Workspace 归属 guard、
移除管理面板挂载，实际造成共享 1 项／Web 2 项失败（各原入口退出 1）；
三源 apply_patch 逐字还原、cmp 0 后，195 + 23 + 2 项再次退出 0。
原件目录 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/shared-settings-GLhczI`：
`baseline-final.log` SHA-256 `48efb227839811b668f7585eafcd4fb38b9730fa89cf9a694bd6ab4183a297e3`；
`mutations.log` `7ceee31f1bb93c3cc23002a58627fa94afcb1e280e558c325e88b995bef4a7b0`；
`restored.log` `5646e5f0dbf3e40e134fd9e609a4fef76cdbd122da5ebe96b63d529e85111e74`。

单轮 Standards 只读复核未发现新增硬边界问题，不能代替执行证据。
本组没有运行 full、产品构建／部署、浏览器或 Windows 设备验收，也没有执行真实
偏好写入。三个设置分组不等于原 Buzz 16 项全部恢复；Web 只展示实际存在的主题、
Workspace 静音和 Enter 发送说明，其他原生设置未全部本地化。后续随主线合批验收。

## 2026-10-04 同条频道消息多 Agent 提及（实现后证据）

本组基于 `9273f48cb042ad866d2c173e77b8d11b80423e6d`，实现与检查均在独立
`/volumes/data/kailo/tmp/codex-multi-mention-20261004.qlM03z/apps`，未修改正式树。

- 权威：design/09 §3、DD-75／DD-81 与 design/03 ChannelAgentBinding；固定 Buzz
  `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/messages/ui/MentionAutocomplete.tsx::MentionAutocomplete`、
  `desktop/src/features/messages/lib/useMentionSelection.ts::useMentionSelection`、
  `desktop/src/features/messages/lib/useMentions.ts::useMentions` 和
  `desktop/src/shared/ui/popoverSurface.ts::POPOVER_SHADOW_STYLE` 均只读核验。
  `python3 tools/upstream_manifest.py status collaboration` 退出 0，引用 HEAD 与 pin 一致。
- 影响：将原列表／焦点／外部点击行为、选择下标 hook 与原弹层样式移入 client-kit，
  Desktop 与 Web 有实际消费者；删除原 hook／样式旧路径。Desktop 原 pubkey、头像与
  身份 renderer 保留。Web 消费现有 AgentInstallationView，展示真实 resourceId，
  不将 UUID 伪装成 pubkey。原 WebPublishMessageRequest 已定义数组，不改数据契约。
- 副作用：仍走原 BFF publishMessage 与 Core web_transport.rs::resolve_mentions，
  后端对每个目标重验 scope、安装／频道投影与权限，不将无权目标静默删去后发送。
  Web 不持签名密钥、不直连 Relay；Mobile 未变更。多选集合去重、排序后参与原
  幂等意图，结果不明保留草稿、附件、完整目标集合和原 key，不乐观插入消息。
- 异常：重叠分页去重；同 ID 任一已加载记录撤权即阻止发送，旧 ACTIVE 行不能掩盖。
  空选沿原普通消息路径；重复选择不重复目标；UNKNOWN 后移除再加入同一集合仍复用
  原 key，真正改变集合才产生新意图。途中撤权仍由服务端拒绝。选择／Escape／
  外部点击／卸载结束本地弹层状态，无新业务状态、工作流、数据库或第二权限权威。

复用固定 10ad SDK（完整镜像摘要同上），实际 4 CPU／8 GiB、Data 缓存，先确认
其他工具链窗口已结束与实际 CPU／内存压力。原共享 `tsc --noEmit -p tsconfig.test.json`、
`vitest run test/pages.test.tsx -t "platform pages render only through the host theme"`
退出 0（2 项，其余 190 项未选择）；真实 Composer 的
`vitest run src/platform/ui/Composer.test.tsx --environment jsdom` 退出 0（4 项），
Web／Desktop `tsc --noEmit` 均退出 0。主题检查精确核验固定上游阴影常量及唯一
style 引用后才按 AST 排除这些表达式，其余源与两宿主语义色仍逐项核验，不整文件豁免。

实现后的生产变异将多选退回单选、全体有效 guard 改成任一有效，实际 3 项 Composer
失败；单独保留任一有效缺陷时实际 1 项失败。向原阴影对象注入 color 与破坏 Web
popover-foreground 映射，实际两项主题检查失败。三个生产源逐字还原、cmp 退出 0；
上述 4 项 Composer、2 项主题及三处 TS 检查再次退出 0。
原件目录 `/volumes/data/kailo/tmp/codex-multi-mention-20261004.qlM03z`：
`mutation.log` SHA-256 `78d04522fd9d1017596aefea7f3204dbdddfa9293627cc615efd67b40b8bb4d5`；
`mutation-authorization.log` `5a1dd4b959c0ea853e1ef3310e3f42d6e09ebf998824971541ebf411a49ce847`；
`restored.log` `d76fb9d86b4f44b57f2e7e68d7f229195e49715cd1d402e748f222e1aebe2264`。

初次命令相对路径错误退出 127；初次跨包共享 React renderer 造成 4 项 hook 失败，
改为 Web 自己的 ReactDOM renderer 后通过。最初主题扫描的两项失败如实保留，未以
新视觉值迁就扫描。离线依赖解析 ENOTCACHED、一次隔离网络解析超时 124 及最后离线
安装缺 xmlchars tarball 退出 1 均不计通过；jsdom 使用共享平台相同版本并由原 npm
机械生成 Web 锁，未手写 lock。这里未执行 full、产品构建／部署、真实消息发布、
模型调用、权限写入或 Windows 实机验收；本地 ReactDOM／BFF 夹具不等于上线验收。

随后授权的同镜像受限依赖窗口通过原 `npm ci --ignore-scripts`、
`npm run typecheck` 与 `npm test`，退出 0：Web 8 个文件、27 项全部通过；
不借共享包 Vitest binary 作为标准 Web 入口完成证据。
同目录 `web-standard-online.log` SHA-256
`27abb61d163e15f99d418b5c1141ab895dbe3044ceafc355e601f6dccaf75875`。

## 2026-10-04 Web 撤权与受限会话的提交缺口收口

基准 `9273f48cb042ad866d2c173e77b8d11b80423e6d`。正式工作树保留的撤权停流与
受限会话接线此前未进入该提交；本候选只选择这两项既定功能，未携带其他历史改动。
实现后补齐永久关闭源的迟到回调隔离，以及确定撤权后移除发送与附件入口。

四步影响结论：

1. 权威为 DD-39/41/45/46/96、设计 `03` §2 与 `10` §4–5。Core 的
   `stream.rs` 已分别发出 session/scope/identity revoked，`session()` 已封闭校验
   FULL/LIFECYCLE_RESTRICTED；本批修的是 Web 对既有事实的消费，不增加授权权威。
2. 源码检索确认唯一 Web `openStream` 消费者为 ChannelPane，父页以 Workspace ID
   为 key；受限页面复用 Desktop 的 `LifecycleRestrictedView`。服务端、契约、持久
   数据、Workflow history 和原生两端 Relay 连接均不变，无数据迁移或兼容双读。
3. 明确撤权先停止连接和 timer，再通知 UI 清除消息并卸载 Composer；永久关闭源不再
   接受迟到帧，重连仍使用服务端下发间隔。没有补造默认 scope、伪造写入成功或自动重发消息。
4. 空 snapshot、重复 event 沿原逻辑；三种撤权为 DENIED，依赖不可用仍是结果不明，
   不伪装为撤权。无 retry 帧就结束，不自定重试上限。cleanup 取消待重开，Workspace
   换页销毁旧消费者；这只有连接生命周期状态，无新增需持久对账的业务状态。其它
   PRECONDITION/LIMIT/CONFLICT/BLOCKED 与写入 UNKNOWN 沿原 BFF 消费路径。

原 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
以 UID 1000、4 CPU、8 GiB、memory+swap 同限额执行，依赖复用 Data 离线缓存，锁文件
未修改。`npm run typecheck && npm test` 退出 0，9 文件 34 项通过。主动破坏三个
生产守卫（不识别 scope-revoked、保留 Composer、颠倒受限会话分支），原检查实际
6 项失败、退出 1；三源逐字还原 SHA 一致，同命令恢复 34 项通过、退出 0。

原件目录 `/volumes/data/kailo/tmp/codex-client-admission-20261004.JdnEH9`：
`client-check.log` SHA-256 `096f9f5902320b62f499a7392e304b9e254462f1a01331c8cfa16251f08c5cc0`；
`client-mutation.log` `7e5ede36aba2cb1fed5a7828bd304e828b4ccbbec824cd68baf77a69973f151c`；
`client-restored.log` `c14681f8b91c57e6d81bab1c65279d4c785daad1d6ef778902c0829e379bbeb7`。
组件检查使用模拟流与 React hook 状态的真实渲染，不冒充真实撤权、浏览器或设备验收。
源码交叉复核未发现确定阻断。集中 full、产物和 Git 交付按最终合批记录分别判定。

## 2026-10-04 原 Buzz 字号与会话密度同源复用（实现后，未发布）

基准 `9273f48cb042ad866d2c173e77b8d11b80423e6d`。本组只恢复已有
设备呈现偏好，不增加模型、身份、权限、业务配置或 Mobile 宿主能力。

1. 权威：REQ-08/21、DD-53/74；固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::ConversationDisplaySettings`、
   `desktop/src/shared/lib/fontSizePreference.ts::initializeFontSizePreference`、
   `desktop/src/shared/lib/conversationDensityPreference.ts::initializeConversationDensityPreference`、
   `desktop/src/shared/ui/segmented-control.tsx::SegmentedControl` 只读逐符号核验。
2. 影响：原两个 preference 模块与 SegmentedControl 移到
   `client-kit/ts/platform`，删除 Desktop 旧路径；字号/密度控件也由共享包提供。
   Desktop 原设置、Web SettingsPane 和两宿主启动恢复均真实消费同一实现；
   原 localStorage key、默认值、封闭枚举、预览与根属性及共享 typography CSS 不变。
   原文案纳入已有 i18n 生成链，无契约字段、DB 或兼容迁移。
3. 副作用：只有设备偏好写入；不调用 BFF，不复制业务权威，不改变准入。
   localStorage 不可用沿原实现保持当次内存呈现，不声称业务动作成功。
4. 边界：空值/未知枚举沿原默认；跨窗口 storage 与 clear 事件同步；
   预览不持久化，指针取消沿原控件恢复。没有新业务状态或外部副作用；
   六类业务错误分类无适用对象，原管理面错误处理未变。Mobile 无新增入口。

原受限 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID 1000、4 CPU、8 GiB、memory+swap 同限额；先核实际进程与压力，复用 Data
离线依赖。原 `python3 tools/gen-platform-i18n.py` 与 `--check` 均退出 0；
共享 `tsc --noEmit -p tsconfig.test.json` 与设置 6 项退出 0；
Web `tsc --noEmit` 与 SettingsPane 5 项退出 0；
Desktop `tsc --noEmit` 与原两个 preference Node 检查 15 项退出 0。
主动删除真实 setter 的根属性应用：字号组及单独密度组各 2 项失败、退出 1；
逐字恢复与原源 cmp 退出 0，恢复后共享 6 项再次通过、退出 0。

原件目录 `/volumes/data/kailo/tmp/codex-settings-reading-20261004.taLrhP`：
`targeted.log` SHA-256 `ef79b9e0d7da6c6db3b689526033b449c568ba437147f4a13d7cf218614f4c1f`；
`hosts.log` `96b46ee7b05912511ae137451617969b68bed33dc986a16a194f297ff6ee57ba`；
`mutation-production.log` `2786ee048d7cddefa821000f6ff9e86d9a9f37bc9cc442eebe1fd2a38a43d983`；
`mutation-density.log` `46b0e45d8a8362c07f946655bfefd96a72b31586da8546d1d8beffffb0e5813a`；
`restored-final.log` `550b766488e271c5d0d6374e3b0e8583452146bd4b72922468641abb0529897d`。
首个变异命令误用 Web Vitest，缺 jsdom、退出 1，没有执行检查，不计作捕获：
`mutation.log` `4e1a448f8886e76e7312c52bf2365307b545ef3f67142160ee9f3a4b8d7857ae`；
改用共享包本身 Vitest 后获得上述真实断言失败。一次未提权 Docker inspect
权限拒绝未修改环境，随后按既有 sudo 容器入口执行。
本组未独立运行 docs/full、产品构建或部署，按主线要求留给联合候选一次收口；
未做浏览器/Windows 设备验收，不能据 Node/SSR 声称已发布或原 Buzz 全部恢复。

同批交叉复核纠正 SegmentedControl 抽取后的一个真实差异：去掉桌面 cn 时，
原 tailwind-merge 对 duration-200/duration-0 的覆盖语义丢失。现有共享控件
改成两类互斥，未引入依赖或更改设置语义。后置原 settings 检查通过实际
pointerdown/move/cancel 验证瞬时字号、未持久化、指示器位移及取消恢复；
DOM 环境只模拟边界几何与 pointer capture API，执行真实 React 指针处理函数。
同一原 SDK 内共享 typecheck 与 7 项退出 0；生产变异恢复两个 duration 同时存在，
恰有该指针检查失败、退出 1；原源逐字还原 cmp 0，7 项再次通过、退出 0。
原件仍在上述 taLrhP 目录：
`pointer.log` SHA-256 `c656e73f9c49cdc534b54781d49872bb09983b4a2a166a4c752a6a482bee94f2`；
`pointer-mutation.log` `469f08efe646d1d6b454a159856fb651e046e03e2118541d327e5aeb3cc5a197`；
`pointer-restored.log` `cab4a69a756443bb7929670c5a7e8a2c9899617d7a52fcb8d7b9f8c6d56ec765`。

联合检查暴露了 Web 宿主遗漏的原生排版映射：共享设置使用的 timestamp、author、
body、row 与 2xs 类在 Desktop 有定义，Web 未全部接线。现直接复用固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/tailwind.config.js::theme.extend` 对应项，仍消费既有共享 CSS variables；
不新增主题、偏好状态或业务配置，也不改变原生两端。原主题检查精确核对
SegmentedControl 的 transform/width 几何表达式而不豁免文件，同时区分字号类与
颜色类，并核对两宿主的实际映射。没有以删除检查掩盖缺失的 Web 呈现。
原 `pnpm -r test` 诊断为 305 通过、2 失败；修正后同命令 307 项通过、退出 0。
原件位于 `codex-client-admission-20261004.JdnEH9/full-ts-diagnostic.log`；
完整检查首次退出 1 的记录保留，先前构建产物不再代表修正后的源码。

随后实际破坏两处生产对象：在 Segment 控件的几何 style 中加入独立颜色，并把
Web timestamp 映射改成消息字号；原主题两项均失败、退出 1。两源逐字还原 cmp 0，
原 `pnpm -r test` 再次 307/307、退出 0。原件同目录：
`theme-production-mutant.log` SHA-256 `2ca1b467f39454bc8dde8d23691d338bc03a29a7c58aa3ecd89ff15a4345f79c`；
`theme-final-restored.log` `013171c37b31d05262a744ac6f31b33679c234656bc0e294b14191ce26e366f4`。
首次 `full.log` 为 `ecb5d397267afbb553d551938805abc1ee6aeada1cd3c07bb11ed69b62cf64d3`，
含原 TypeScript、文档追溯及修改后来源不匹配失败，不作为最终合批的通过证据。

## 原 Buzz 高对比选中导航共享复用（2026-10-04）

基线为 `a714684260d261ce520f6f3a625a197c83b07e9c`；仅恢复现有外观能力，
不是多人协作、Agent 回复或组件接入完成证据。四步影响结论如下。

1. 权威：DD-53 的设备本地主题偏好与 Host 主题边界不变。只读复核 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::ProminentActiveTabSetting`、
   `desktop/src/shared/theme/ThemeProvider.tsx::ThemeProvider` 与
   `desktop/src/shared/ui/switch.tsx::Switch`，直接抽取原控件、偏好和 Radix Switch。
2. 影响：共享 `prominent-active-tab-setting.tsx`、`prominent-active-tab.ts`、
   `switch.tsx` 同时由 Web/Desktop 原宿主消费。删除桌面旧控件/偏好逻辑及旧 Switch
   文件，三个旧 Switch 调用点只迁移导入；Inbox 与通知行为不变。原存储键
   `buzz-prominent-active-tab`、布尔字符串格式、默认 false 无迁移，旧版仍可读取。
   Web 仍只有原 Buzz 的 light/dark/system；Mobile 仅同步原生成翻译，无新增入口。
3. 副作用：只改当前设备的原 localStorage 和 root attribute；无 BFF 写入、
   身份/权限/额度/审计/模型调用，也无第二套偏好权威。原共享 theme.css 已提供
   两宿主的高对比导航规则，不自建主题。Switch 保留原样式及 tailwind-merge 语义。
4. 边界：空/非法存储值与初始读取异常仍取原 false；写入先于 state 更新，
   写入抛错不伪装持久化成功。非 Buzz 主题移除呈现 attribute 但保留原偏好，
   切回恢复；没有新业务状态、终态或六类业务错误分类。原主题扫描区分 ring-offset
   数值宽度与宿主语义色，后缀仍必须通过两宿主 CSS 映射，不作文件豁免。

实现后在固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
内定向验证；实际 4 CPU / 8 GiB / swap 0、UID 1000，执行前检查宿主压力与现存进程。
根 pnpm 10.33.4、Desktop pnpm 11.4.0、Web npm 原 lockfile-only/ignore-scripts
生成锁，未手写锁或升级整库依赖。Desktop peer 检查唯一告警为原锁已有的
typography 0.5.20 / tailwindcss 4.3.0，不是本次 Switch peer；未改其版本。

原命令 `pnpm --filter @client-kit/platform typecheck`、同包
`exec tsc --noEmit -p tsconfig.test.json`、
`exec vitest run test/settings.test.tsx test/pages.test.tsx`：204 项通过。
Web `npm run typecheck && npm test`：39 项通过；Desktop `pnpm typecheck`：退出 0。
这组串行命令末尾 i18n 检查因短容器缺 Dart PATH 退出 1，不能将整组声称退出 0。
单补 PATH 后 Dart analytics 写入短容器不可写的默认目录，退出 255；未安装工具，
改用原 e4agxd SDK 已配置环境与 `/usr/lib/dart/bin` 执行
`python3 tools/gen-platform-i18n.py --check`：退出 0。其 TS 输入与生成 Dart 文件
同候选逐字 cmp 0，未重复前三组。原件目录为
`/volumes/data/kailo/tmp/codex-prominent-setting-20261004.QIXoZe`。

实际生产变异：移除 Buzz 主题门禁、将 Switch 的 ring-offset-background 改为
foreign-color、删除 Web 共享入口；分别触发 settings、主题检查、Web 宿主各一项
真实断言失败，组合退出 1。三个源 apply_patch 还原、cmp 均 0，随后上述 204/39
与 Desktop 类型检查再次通过。首次共享检查的两项失败也保留：注释误命中
ThemeProvider、原 ring-offset 被扫描器误判颜色；没有改变原控件样式迎合检查。

原件 SHA-256：`production-mutation.log`
`8618812bed182363b9e52d6aa7dc8a012150a171f192a013231f1613b8d90765`；
`restored-final.log`
`ae63c71ad96ff3bd107ec8cd5d7d1f564fb959e17032d125c94c84de34ec6ac5`。
`i18n-final-existing-sdk.log`
`740ff5452b680e6c0b9419bf56d4b4787754c67a74c6cd0f00822dbfc3411b30`。
离线锁生成缺 Radix metadata 的失败在 `dependency-locks.log`；Desktop 首次误用
pnpm 10 自动切换权限失败在 `desktop-lock-online.log`，随后直接使用缓存固定 11
成功，未创建新工具链。没有独立 docs/full、镜像构建、发布或真实设备验收；
旧 Web/Desktop 产物不代表本候选源码，不清除来源记录绕过 full 门禁。

### 2026-10-05 频道已读失败重试收敛

基线 `a714684260d261ce520f6f3a625a197c83b07e9c`。真实三浏览器观察
`codex-three-humans-20261005.wYPEYv/plain-channel.log` 在首秒出现 88 次已读 PUT；
同目录 `plain-channel-inline.txt` 只中止这些 PUT，没有主动调用已读或刷新循环。
根因是 ChannelPane 的失败 invalidate 与 pending 复位，让 effect 用同一 CAS
version 再次写入。此日志是故障证据，不是修复后的浏览器验收。

改前四步影响结论：权威仍为设计 03 DD-40 的 Core HUMAN 用户状态，原
`user_state.rs::update` 的 version CAS 不变；影响仅 Web ChannelPane 的真实
自动标记与现有错误重试按钮；失败不推进 lastRead，同版本自动请求只发一次，
明确重新读取更高 version 才重新比较；显式重试先 GET，同版本仅重发冻结原请求，
读取或写入中禁重复操作，撤权、关闭或跨频道的迟到结果不写入。没有新增定时器、
重试上限、状态字段或配置权威，也不把 UNKNOWN 当作已读。

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 原证据：
`desktop/src/features/channels/ui/useChannelOpenReadState.ts::useChannelOpenReadState`
与 `desktop/src/features/channels/useUnreadChannels.ts::markChannelRead`。
Web 继续使用 Core CAS，不复制桌面本机已读权威。

实现后在既有固定 SDK（4 CPU、8 GiB、UID 1000）运行原 Web 入口：
`npm run typecheck && npm test && npm run check:i18n && npm run check:file-sizes`
实际退出 0，11 文件 44 项全部通过。新增 5 项执行真实 React/Query 消费者，
覆盖网络未知、明确拒绝、CAS 冲突、冻结重试、重复点击及撤权期间迟到读取。
首次夹具缺少 getLocale 导致 5 项失败，补齐既有接口后 5 项通过；原件保留。
私有生产变异删除 attemptedRead 的同版本守卫，4 项失败、退出 1；逐字还原
cmp 0 后上述 44 项重新通过。未修改鉴权、服务端状态、正式脏树或运行数据。

原件目录 `codex-channel-read-recovery-20261005.tLs1fL`：
`final-targeted.log` SHA-256
`62bf79b31deec1ef3e64fad74500fcb0d691c0173ed8d43f0b50f52eb67300be`；
`mutation.log` SHA-256
`eb455b7dee14c177bd634170b1fb71b29f8c30c3641161f42b3e06fc12c166cf`。
此定向阶段未运行 full、产品构建、部署或新的真实消息/模型调用；联合交付另记。

### 2026-10-05 Agent 执行撤权后的提及候选

基线 `6090de81a13322f85dcc77b1a862cb203dbb7422`。真实开发安装撤销 execute 后，
Installation 仍 ACTIVE，而 Web Composer 原候选仅检查安装、主体、资源和频道绑定
状态，导致撤权对象仍可选。修正直接消费原 BFF `executionPermission.effective`，
不是新增授权或另一份 Agent 目录；服务端每次准入的 fresh 授权保持不变。

改前四步结论：权威为设计 17 的 Installation execute 与 ChannelAgentBinding、
DD-75 的客户端传输边界；实际影响为 `ChannelPane.tsx::Composer` 的候选和已选集合
核验，读取原生成的 AgentInstallationView，不改契约、数据库或迁移。只有明确 true
才可选，false/缺字段都从候选移除；分页重叠时任一撤权观察优先于旧 ACTIVE 记录。
已选对象撤权则原发送按钮禁用、不产生 publish；空集合、请求错误和 UNKNOWN 原
意图保护沿用现有实现，分别保留空态、既有错误与结果不明状态，不制造成功。
没有新增配置、后台任务、持久状态、重试或外部副作用；授权拒绝仍属于原 DENIED。

Web/Desktop 的提及控件仍共用 TypeScript 呈现；本次只修 Web 的 BFF 安装目录
消费者，Desktop/Mobile 原生 Relay 成员消费与本机持钥路径未改，不能把这组
Web 检查外推为原生端撤权或设备验收。

先实现再补原 Composer 用例；在既有 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
中执行，实际 4 CPU / 8 GiB / swap 0、UID 1000，执行前核对现存进程与宿主余量。
私有候选从基线导出，只选两文件 +41/-0，不带入主工作区已有格式改动。
原 `npm run typecheck && npm test && npm run check:i18n && npm run check:file-sizes`
退出 0，11 文件 47 项通过。删除私有候选中的 effective 守卫后，原 Composer
检查恰有 3 项失败、退出 1；apply_patch 恢复后上述完整 Web 命令再次退出 0。
原 npm 的 store-dir 配置告警保留，没有改变工具版本或业务实现来消除告警。

原件位于 `codex-channel-read-recovery-20261005.tLs1fL/full-tmp/mention-execute-20261005.dvl7K0`：
`mutation.log` SHA-256 `7116d66b48966d83a0e7bc36c05b79036edeb9f98406380a280ee3936285a248`；
`restored.log` SHA-256 `afa2e4b8752fa7089748a8871605493b128e4cc85106af13121dda0b1a715e7e`。
本阶段没有产品构建、部署或 full，源码提交与联合交付分别收口。

## 原 Buzz 完整外观设置共用（2026-10-05）

基线 `6112fdb6dfbdee9897a34e374988e6d79f37406c`。设计修正已独立提交并推送
`06c10a0f560c1ee2e5439e4127e0d1d865bd601a`；本节仅是实现后窄验证，
不表示新客户端已构建、部署或整组设置全部交付。

1. 权威：DD-53、SF-DSK-04。只读复核 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `buzz/desktop/src/features/settings/ui/SettingsPanels.tsx::ThemeSettingsCard/useThemeCategories`、
   `buzz/desktop/src/shared/theme/ThemeProvider.tsx::ThemeProvider/readStoredTheme/applyTheme/resolveEffectiveAccent`
   与 `buzz/desktop/src/shared/theme/theme-loader.ts::loadThemeData/getThemePair/resolveSystemTheme`。
   直接抽取原样式选项、预览、强调色和偏好状态，复用原 loader，不造第二主题引擎。
2. 影响：原 Desktop SettingsPanels 和 Web SettingsPane 均消费共享
   ThemeSettingsControls/useAppearance；桌面原非原生实现删除，旧导入点仅重导出。
   原 native glass/window 事件仍限 Desktop。Web 代码块高亮跟随真实主题名。
   原 `buzz-theme/buzz-accent-color/buzz-follow-system` 是唯一偏好键；
   Web 旧 `buzz-web-theme` 在不存在原生偏好时一次迁移，成功写入后删除。
   原有桌面偏好不覆盖；Mobile 无新入口，仅同步原 i18n 生成输出。
3. 副作用：仅设备 localStorage、DOM 样式/属性和原 Desktop window glass；
   无服务器写入、权限/密钥/额度/工作流改变。跨组件 Host 仍只公开 light/dark 与
   locale，不将样式名变成组件协议。原 motion/lucide 依赖按现有版本范围复用。
4. 异常：非法旧模式不迁移；存储写入失败撤销本次部分写入、保留旧键供重试；
   系统颜色改变只解析原主题 pair，不改所选样式；Buzz 强制原中性强调色但保留
   非 Buzz 偏好；过时异步加载不能覆盖后选主题。原语义色检查仅精确核验原预览
   四个 style 表达式，非文件豁免；JSX key/testid 不作为 CSS 颜色类。
   无新增业务状态，六类业务错误合同不变。

实际使用既有固定 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU / 8 GiB / swap 0、UID 1000、Data 缓存；检查前核对运行进程与资源压力。
原 root pnpm、Desktop pnpm 与 Web npm 的 lockfile-only/ignore-scripts 生成锁，
无手写锁或整库升级。原 i18n 生成器同步 Dart；没有新增契约。

实现后原命令：

- 共享 `pnpm --filter @client-kit/platform typecheck`、测试 tsconfig 的
  `tsc --noEmit`：退出 0；原 Vitest settings/pages/theme-appearance 三文件
  211 项通过。测试真实共享控件、原 loader、DOM CSS 和存储，不以假主题代替。
- `python3 tools/gen-platform-i18n.py --check`：退出 0。
- Web `npm ci --ignore-scripts --no-audit --no-fund && npm run typecheck && npm test`：
  退出 0，11 文件 47 项通过。
- Desktop 原 `pnpm install --frozen-lockfile --ignore-scripts --store-dir /cache/pnpm-memory-read`
  及 `pnpm exec tsc --noEmit`：退出 0。

真实变异仅在隔离执行副本：破坏 Buzz 中性强调色、系统变化、旧键删除、
原生偏好保护和过期加载五处生产逻辑，并向原预览注入固定颜色及 foreign-color 类。
原两文件检查实际 9 项失败、190 项通过，退出 1；逐字 apply_patch 还原，
两源 cmp 0 后原三文件 211 项重新通过、退出 0。颜色门禁没有因抽取控件而放宽。

原件根目录：
`/volumes/data/kailo/tmp/codex-buzz-appearance-20261005.zLvGRy`。
`hosts-target.log` SHA-256
`db02b7caf744ea0f734341c63edcc018be41996fe6172b8d1b81fe2063ead1b9`；
`mutation.log`
`f047ac8e9d43c5611e3096394db271bc60b14a5f979b5c652285a8f9e4ecc45a`；
`restored.log`
`a78766d32af6f9717ce0b1602a6a19d1a4e56ab8c009ba84d17c550de38f6f81`。

失败原件保留：首次执行副本缺 Desktop 原 patch 导致安装退出 254；
补全已审计 workspace 输入后成功。一次 sparse-checkout 命令退出 139，
未改正式树或修 Git 元数据，改以只读 archive 提供执行副本。
首次共享严格 TS 检查捕捉原 Desktop 数组/正则推断差异，按已验证固定下标收束；
随后旧扫描器误将控件 testid 当颜色及拒绝原 style，两项失败后精确修正。
`combined-target.log` 的共享 211 项已通过，但串行脚本错误 cwd 导致末项退出 2；
纠正后只运行未完成宿主项，不将前次整组算成功。npm 配置/peer 告警、
Motion reduced-motion 与 React act 告警保留。未执行本批 full、产品构建、
部署或真实设备验收；旧产物摘要不代表本候选，后续由联合批集中收口。

## Web 原生文件选择与协议承载（2026-10-05）

基准为联合输入树 `58299f2bfc08e1951a5652cd187bd03194a99a04`。
本节只登记实现后的消费者证据，不代表 Cells/DocumentServer 真实服务已激活或部署。

1. 输入与权威：依 `.design/18` §6/7、`.design/07` §4.5，复用原
   `ContentReference`、`POST /api/v1/actions`、ProtocolSession 及本人状态读取。
   原生文件菜单从 Cells 已认证节点/版本接口经同源 typed producer 给出确定引用；
   Web 不反查原生数据来拼引用，不增加文件目录或手填 JSON 入口。
   `application_page.rs::entry` 仅补 SOURCE_BOUND_PROTOCOL/v1 的原生来源 URL
   读取，保留原 binding/generation、投影、权限和来源集合校验。
2. 实际调用方：Cells 原文件菜单打开正常 Web `/app/?protocolBinding=…`；
   PlatformApp 仍先读取正常平台会话，受限会话不挂承载入口，Web 使用原 Buzz
   ThemeProvider 的已解析 LIGHT/DARK 和原 locale。共享 ProtocolDocumentBridge
   校验原 opener、精确 native origin、一次性 nonce、binding 与 generation；
   nonce 只隔离迟到消息，不授予权限。用户明确确认后，ProtocolDocumentAction
   将原引用、Resource version、Workspace、来源 binding/generation 冻结进原 Action。
   未注册 Desktop 或 Mobile 编辑入口。
3. 副作用与呈现：ProtocolDocumentSurface 先读同一 Session/AE/binding/revision；
   首次真实回应的 launch 仅一次提交到独立 editor iframe，POST 隐藏表单提交后
   立即移除，GET 不允许凭据 formFields，也不把票拼进 URL。
   EDITOR_ORIGINS 经唯一部署配置派生 WEB_EDITOR_ORIGINS；Core 投递与 Web
   frame-src/form-action 消费相同集合，预检拒绝通配、非纯 origin 与越界集合。
   此处没有给现网写入 origin，也没有自动生成或恢复已丢失 PAT。
4. 失败边界：读失败、来源撤销或 Session 终止即关闭承载，不假报保存成功。
   UNKNOWN 只显式查询原冻结幂等请求，不能用另一 operation/AE 的回应解锁。
   主题/语言变化只改变宿主并提示下一次安全打开，不静默 reload 编辑器。
   editor 消息仅作 loading/dirty/close UI evidence，不作为权限、计费或保存终态。

只读上游证据：DocumentServer commit
`f580eb58439432310943ece02c9730c6a21365e7`，完整路径
`/volumes/kailo/.references/DocumentServer/web-apps/apps/api/wopi/editor-wopi.ejs`，
符号 `onAppReady`、`sendEditNotification`、`onRequestClose`；对应真实
`App_LoadingStatus`、`Edit_Notification`、`UI_Close`，不发明 SAVED 消息权威。

私有验证原件目录：
`/volumes/data/kailo/tmp/codex-web-protocol-surface-20261005.Sv3Qhy`。
固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU / 8 GiB / swap 0、UID 1000，执行前读取进程与 CPU/内存压力。
原 `tools/gen.sh` 和 `tools/gen-platform-i18n.py` 最终退出 0；完整 Cells
合同由所属切片与本批在联合树统一生成，不能用本次 UI 的部分 schema 验证集合
覆盖 Cells 完整 Core/Worker 生成产物。

`consumer-targeted.log` 实际退出 0：共享原测试 TS 编译与 Vitest 两文件
24 项通过；Web `npm run typecheck && npm test` 退出 0、11 文件 49 项通过。
此前 `shared-targeted.log` 退出 2 是物理依赖副本缺少锁内 yaml@2.9.1，
补现有同版本缓存后恢复，未改锁。`shared-restored.log` 退出 1：101 项通过，
另三测试文件的 Vitest fork 启动超时；未改变超时、并行度或将其算作全包通过。
生成首次失败（numeric const 与文案 key）、Dart HOME 权限失败均保留原件，
修正 schema 等价编码/合法文案键与原受控工具 HOME 后 `gen-final.exit=0`。
Docker/IO 等待没有通过重启宿主、daemon 或另建重复任务规避。

生产守卫变异在这两份私有新源进行：去掉 launch 一次性消费、editor 消息的
contentWindow 检查、原生来源消息的 opener 检查。原消费者实际恰有 3 项失败、
13 项通过，`mutation.exit=1`；失败分别是第二次表单提交、错误窗口伪造 dirty、
错误窗口提前接受文件选择。两源用 apply_patch 逐字还原，cmp 均为 0，
恢复 SHA-256 分别为
`987c84e0515852876763106ce50402a1c824b7964af7f88115a5b1dfef63311f`、
`f4c62a7ff590007427b1c9dd3a5c4d2c3132a6b34ba4415c130d88c92a5f68e3`。

还原后 `final-targeted.log` 的 24 项再次通过，但附加 pages 源扫描因稀疏副本
缺原 Desktop 输入退出 1；从同一基准机械补齐三个原文件后，
`final-restored.log` 为 233 项通过、原主题守卫一项 5000ms 超时，退出 1。
未改变该守卫或超时；只复跑此原主题 describe 的两项均通过，其余 208 项为
目标选择跳过。`final-host.exit=0` 同时包含格式后的 Web 类型检查、原
PlatformApp 四项、原 i18n/file-size 检查与跨侧文案生成检查。
这些结果不能合称一次共享全包通过；失败原件完整保留，联合 full 另行验证。

仍未验收：真实 Cells 菜单→正常 OIDC→WOPI editor 的浏览器闭环、编辑保存与
撤权后的真实 PAT/原生服务响应；本切片不声称真实 E2E 或设备兼容完成。
Core 单一原生来源读取增量留联合 Core 检查；本批没有 full、产品构建、部署、
模型请求或业务配置写入，Desktop GAP-DSK-EDITOR-01 保持关闭。

## 原版设置快捷键共用消费（2026-10-05）

关联 DD-53、REQ-08、ADR-09；比较基准为前一 Surface 冻结树
`699312ba35345bf10f05e1dd16fb112e70196a10`，不是重交其 17 路径。
固定 Buzz commit `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/app/useSettingsShortcuts.ts::useSettingsShortcuts` 与
`desktop/src/shared/lib/platform.ts::hasPrimaryShortcutModifier/isMacPlatform`
提供原 Cmd/Ctrl+, 行为；`desktop/src/app/AppShell.tsx::AppShell`
是其真实宿主调用方。源码只读，未执行上游内容。

四步影响：输入仍为原平台修饰键及逗号（保留物理 Comma 和额外修饰键排除）；
将原 React 监听与平台判别提取到共享 TS，Desktop 原导入重导出；
Web 仅在普通已登录 SignedIn 挂载原 hook，打开现有 SettingsPane 后返回原 tab，
快捷键列表复用同源既有英文/中文键；未登录、受限会话及文档专用宿主不注册。
没有新偏好、后端请求、授权或存储，原 Workspace 选择仍由宿主拥有。
这是一项实际快捷键补齐，不声称原 16 项设置已全部恢复。

原受限 SDK `kailo-web-document-sv3qhy`（固定 10ad 镜像、UID 1000、
4 CPU、8 GiB、无额外 swap）执行。开跑时无其他 Node/Cargo/rustc，
可用内存约 38 GiB、memory PSI avg10 为 0。原 manifest status 返回 0，
并如实提示该稀疏副本未挂载 buzz-web 上游，未声称已完成上游更新。
`settings-targeted.log` 与 `settings-restored.log` 实际退出 0：
共享原 tsc 两目标及设置 22 项通过，Web 原 typecheck 与 npm test 的
12 文件/53 项通过，末次 i18n/file-size 原检查通过。
将生产 SignedIn 的 hook 注册改为 disabled 后，真实页面消费测试两项失败，
`settings-mutation.exit=1`；apply_patch 逐字恢复且 cmp 为 0 后再得到上述通过。
恢复日志 SHA-256：
`247e8d022702ff0db73338d051d59932a99500328962fb7d39d05915ad2b8e20`。
格式器首次从工程根跨嵌套配置执行被拒绝，未改配置；
使用原 Web 工作目录格式化新增 Web 测试成功。

没有 full、产品构建、部署或真实设备快捷键验收；Desktop 全工程类型/打包
留联合批执行，本刀仅重导出原调用点且保留原 ModifierKeyboardEvent 类型形状。
独立补丁不包含 Cells schema/生成物或上一 Surface 实现。

## 原侧栏主体跨端共用（2026-10-06）

本批以 REQ-24、DD-53 和 ADR-09 为权威，恢复现有 Desktop 的原侧栏呈现，
不新增业务实体，不把 Web 身份改为 Relay 直连。固定上游
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/sidebar.tsx::SidebarProvider/Sidebar/SidebarRail`、
`desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar`、
`desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPrimaryMenu`、
`desktop/src/features/sidebar/ui/SidebarProfileCard.tsx::SidebarProfileCard` 和
`desktop/src/features/profile/ui/ProfilePopover.tsx::ProfilePopover` 已重新只读解析。

影响面：原 Sidebar 的折叠、快捷键、宽度磁吸与拖拽、响应式 Sheet、菜单样式，
以及 AppSidebar 的滚动容器、固定头尾、头像弹层集中进入共享 TS。
Desktop 原 Sidebar 仅保留本机触觉注入；Desktop AppSidebar 和 Web SignedIn
都实际消费同一 AppSidebarFrame、PrimaryMenu、ProfileCard。Web 删除独立
固定宽 aside 和自行排布的设置/退出按钮。Web 头像只读既有本人 profile
BFF 与 avatarMediaPaths；设置关闭后恢复查询。原 Native 搜索、未读溢出按钮、
Relay 状态卡和本机资料缓存通过原宿主插槽保留，未删除对应功能。

副作用与异常：目录、收藏静音 CAS、DM hide/reopen、会话与授权仍为既有调用。
新增共享层不读 Relay、不持钥、不存业务数据；只保留上游原 UI 宽度和折叠偏好。
切换会话按真实 platformSessionId/principalId 隔离头像查询，查询失败不使用
旧成功响应冒充当前资料。未提供的未读计数不伪造为已知 0。Web 没有当前社区名称
投影，卡片次行使用真实 tenantId，不能编造社区名称或读取管理员租户目录。

范围说明：这批不是全功能完成声明。Web 原 TopbarSearch 所需消息/用户搜索 BFF
尚未接通；不制造目录过滤冒充全文搜索。当前 Desktop 已有的社区浏览、频道分组
拖拽、Pulse/Projects 等与固定上游的差异仍需真实接线，不能以本批共享壳验收抵销。
本批未改 Forum 正文、Composer、频道创建契约或任何权限规则。

执行证据：`python3 tools/upstream_manifest.py status` 退出 0，Buzz HEAD 等于
固定基准，Temporal SDK 仍如实报告领先 75 个提交；未更新版本。
本批限定路径 `git diff --check` 退出 0。实现后补共享侧栏交互 3 用例，
交集中前端 SDK 验证；此条记录不声称这些用例、三端编译、full、打包或部署已通过。
没有独立启动编译，也没有提交或 push；后续真实输出由联合批补记。

### 2026-10-06 原消息行共享与 Forum 契约后置验证

权威与影响：沿 REQ-24 保留原页面而非精简替代。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/MessageRow.tsx::MessageRow`、
`desktop/src/features/messages/ui/MessageActionBar.tsx::MessageActionBar`、
`desktop/src/features/messages/ui/MessageHeader.tsx::MessageHeaderRow`、
`desktop/src/features/messages/ui/MessageTimestamp.tsx::MessageTimestamp`、
`desktop/src/features/messages/ui/DayDivider.tsx::DayDivider`、
`desktop/src/features/messages/ui/UnreadDivider.tsx::UnreadDivider`、
`desktop/src/shared/ui/UserAvatar.tsx::UserAvatar` 与
`desktop/src/features/messages/lib/messageGrouping.ts::hasSameMessageAuthor`
均已按完整 commit/path/symbol 重新核验。当前 fork 已有的治理/i18n 适配保留。

原消息行布局、头像回退/动画、作者/时间、连续消息时间槽、悬浮动作轨道、
线程连线与折叠布局迁到 `client-kit/ts/platform/src/react/messages/`；
Desktop 原 `MessageRow` 继续提供实际资料弹窗、Markdown、原生剪贴板和
线程动作适配，原工具函数只重导出共享实现。Web `ChannelPane` 删除
简版作者/时间/正文组合，实际使用同一行、日期与未读分隔。复制消息保留
原 mention HTML，复制链接使用原链接协议；浏览器拒绝剪贴板时不显示成功。

副作用与边界：不改 Relay 正文权威、目录身份、BFF 准入、发布幂等、已读
CAS 或 UNKNOWN 语义；共享呈现不新增状态权威。缺作者资料用原头像回退，
不编造他人资料；pending 保留作者与发送中状态，不合并为已送达连续行，
不出现已送达复制动作；撤权仍清空消息和写入口。Web 他人完整资料弹窗、
线程摘要/跟随等消费者仍有缺口，本批不能证明原全功能恢复或部署完成。

实际联合 SDK：固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
`kailo-agent-receipt-xvkujx` 实际 cgroup 4 CPU / 8 GiB，源码与缓存均在 Data
盘。三侧 `tsc --noEmit` 及 shared test 配置检查退出 0；共享消息行 3/3、
Forum 3/3、侧栏 3/3，Web `ChannelRead` 7/7、`ChannelPane` 4/4，原生日期/
分组/窗口/时间契约 25/25。SDK 将 pending 不可合并条件移除，消息行检查
真实出现 1 failed / 2 passed；原字节还原后共享三组 9/9。
Web 原 SSR fixture 全局编号模拟所有子组件 useState，新增真实消息子树后
发生槽位碰撞；检查已改真实 DOM/act 挂载与稳定 mock 依赖，保留原四项
撤权/迟到事件断言，不以屏蔽原消息行的方式让检查通过。

联合原始日志目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`。
文件为 `forum-shared-tsc.log`、`forum-web-tsc.log`、`forum-desktop-tsc.log`、
`forum-sidebar-message-restored.log`、`message-row-mutation.log`、
`forum-web-channel-restored.log`、`forum-web-tests.log`、`forum-native-tests.log`。
`forum-web-tests.log` 保留了早期旧 fixture 失败；最终四项恢复结果以
`forum-web-channel-restored.log` 为准，不能只截取前一次失败或后一次成功。

已实现 Forum 契约的后置证据：新增六个 `contracts/samples/web-forum-*` /
`web-message-{cursor,query-legacy}.sample.json`，现有四侧 roundtrip 消费原
发帖/回复类型、父消息、完整复合游标、原论坛描述、附件 filename/spoiler。
旧 content-only 请求、缺省 query 与新增可选字段同时回读。成对游标拒绝
由原 Core `message_query_cursor` / `forum_cursor_requires_the_complete_canonical_key`
承担，不在四侧另建校验权威。

SDK 中实际执行：

- `cd worker && go test ./internal/contracts -count=1`：
  `ok apps/worker/internal/contracts 0.004s`，退出 0。
- `cd client-kit/ts/contracts && ./node_modules/.bin/tsc --noEmit -p tsconfig.test.json && node --test --experimental-strip-types test/roundtrip.test.ts`：
  `tests 20, pass 20, fail 0`，退出 0。
- `cd client-kit/dart && dart test test/roundtrip_test.dart`：
  `+17: All tests passed!`，退出 0；首例逐项往返六个新样例。
- 在同一固定镜像、4 CPU / 8 GiB、只读挂载正式 apps 下运行既有
  `tools/check.sh` 的 `LAST_TAG` 兼容比较段：
  `PASS 相对 contracts-v0.1.0 无破坏性变更（242 个 schema，匹配 3 个历史 schema）`。
  此处未重复四侧生成，不等同于 `gen.sh --check` 或 full。

SDK-only 变异：Go 把生成 JSON tag `beforeId` / `filename` 改名，新增
Forum query/post 两样例真实失败，退出 1；Dart 把序列化 filename 改名，
新附件样例报告缺 filename，退出 1；TS 删除生成 WebMessageQuery.beforeId，
现有 roundtrip 类型检查报 TS2561/TS2551 三项、退出 2。三侧均从正式生成物
原字节还原、`cmp` 退出 0，再运行上述各侧命令通过。正式生成物未手改。
Rust `core/crates/contracts/tests/roundtrip.rs` 已追加对应样例并交主线同一次
Cargo 验证；本条记录未执行或声明 Rust roundtrip 通过。full、打包、截图、
部署、提交与 push 不在本子批执行，不能用类型检查替代端上视觉验收。

迁移追加证据：指定隔离 PostgreSQL `kailo-buzz-full-pg-uOp8YM` 的
`scope_verify` 初始为 89 条迁移、最新 `20261006180000`，
`admission.publish_attempt` 与 `identity.principal` 均 0 行。在上述
受限 SDK 内，对同一迁移目录实际执行 `sqlx migrate run --source core/migrations`、
`sqlx migrate revert --source core/migrations`、再次 `run`，原输出为：

```text
Applied 20261006190000/migrate publish message ancestry (1.327999473s)
Applied 20261006190000/revert publish message ancestry (69.061438ms)
Applied 20261006190000/migrate publish message ancestry (25.99064ms)
scope_verify|90|20261006190000|0
```

退出 0，最终两新字段存在，发布记录与身份记录仍为 0；没有触碰正式业务库。
密码只经受控 stdin/environment 投递，未打印。首轮发现指定 PG 在默认
bridge、SDK 位于另一隔离网络，连接未进入迁移；终止该连接进程退出 143，
临时将此隔离 PG 接入 SDK 既有网络后执行成功，结束后已断开临时连接，
PG 恢复只有原 bridge。原始成功日志为上述日志目录的
`forum-migration-roundtrip.log`。有新语义记录时的 down 保护未实测：
隔离库没有可引用的 Principal，本批不为此创建业务身份或绕过外键；
不能把空表往返声称为该保护路径已验收。

## 原 Inbox 分栏与条目交互共享恢复（2026-10-06）

实现后的四步结论：

1. **权威**：REQ-24、DD-74/DD-75/DD-80 要求恢复 Buzz 原页面并由 Web/Desktop
   共用呈现；DD-40 的 Core CollaborationUserState 继续唯一负责跨端已读。
   固定上游 `779af8886caae1317b4de962082429867ab61503` 的
   `buzz/desktop/src/features/home/ui/HomeView.tsx::HomeView`、
   `buzz/desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane`、
   `buzz/desktop/src/features/home/ui/InboxFilterMenu.tsx::InboxFilterMenu`、
   `buzz/desktop/src/features/home/ui/InboxDetailPane.tsx::InboxDetailPane` 与
   `buzz/desktop/src/features/home/useResizableInboxListWidth.ts::useResizableInboxListWidth`
   已重新读取，提取分栏、透明顶栏、拖动/重置宽度、筛选/选项菜单、条目按钮与详情空态。
2. **影响面**：两个宿主实际消费 `inbox-surface` 与同一宽度 hook；Desktop
   保留原详情线程树、资料弹窗、草稿和原生回复。Web 保留原聚合与 Core 已读 writer，
   新详情只适配现有 `workspaceMessages`、SSE、`publishMessage`；线程复合游标使用
   已生成契约。事件校验从 InboxPane 原样提取，原导出保留供已有调用者与检查使用。
   无契约/迁移/后台实体变化；Mobile 不因本次共享提取增加组件宿主。
3. **副作用**：列表点击改为打开详情；已读、未读、全部已读仍调用原 CAS writer。
   宽度仅为原 sessionStorage 展示偏好，不是第二份消息/已读权威。Web 发回复使用
   已有 Composer 意图与确认回执；缺 eventId/operationId 不清草稿并不显示成功。
4. **异常**：原读取失败与 UNKNOWN 保持拒绝；撤权 SSE 清除详情缓存并停止回复。
   重复点击不创建新消息状态，分页沿已有服务端游标；选中事件的默认回复 parent
   按原版锁定为其 parentId 或本身，不随实时消息改变。空列表显示原空态；窄屏在列表
   与详情间切换并可返回，移除 scope 后条目不保留。身份改变卸载旧详情查询。

此批不等于完整 Inbox 等效：固定原版还包含 Project/Needs action/Agent activity/
Reminder 分类，当前尚无已接通的对应 feed；Web 草稿目录、资料弹窗、完整线程折叠与
逐消息回复目标/视频批注交互也未因本次分栏提取而恢复。已有 Desktop 能力没有删除。
这些是明确剩余产品缺口，不以空入口、假数据或“非核心”解释为已交付。

本批集中窄验由同一受限 SDK `kailo-agent-receipt-xvkujx` 执行（4 CPU / 8 GiB）：
共享源/检查 TypeScript、Desktop TypeScript、Web TypeScript 均退出 0；共享
`test/inbox-surface.test.tsx` 3/3，Web 原 `InboxPane.test.tsx` 4/4 与新增
`InboxThreadPane.test.tsx` 2/2 实际通过。新增检查在实现之后产生。
首次 Web 类型检查暴露提取后遗漏 `hex` 导入，已复用同一原校验表达式修复后通过；
首次新线程检查遇到 Vitest worker 启动超时，该轮退出 1，不算产品验证；只重跑该文件
后 2/2 通过，没有重复全量构建。日志目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`，
文件为 `locale-inbox-final.log`、`locale-inbox-web-final.log`、`locale-inbox-restored.log`。

SDK-only 删除条目操作按钮 `stopPropagation` 后第 3 项真实失败，恢复正式原字节
`cmp` 退出 0，再跑 3/3 通过；对应 `inbox-propagation-mutation.log`。
SDK-only 将线程确认回执判定改为 `if (false)` 后，无 eventId 的回执被错误当作
confirmed，新线程检查真实失败（1 failed / 1 passed），对应
`inbox-receipt-mutation.log`；随后原字节恢复 `cmp` 退出 0，2/2 复跑通过，
日志 `inbox-receipt-restored.log`。正式代码未受变异修改。本子批没有启动 full、镜像
构建或发布；三侧类型与行为检查不等同于新版真实页面截图或已部署验收。

### 2026-10-06：中文默认与共享原版控件双语接线

本批按最新用户要求纠正 DD-53、FrontendPresentationContext 的语言来源：
没有设备选择时使用 `zh-CN`，保留显式 `en`；不再让浏览器英文覆盖默认中文。
原版事实仍是 Buzz Web `a6766c482533d028582d0efcfd3740769f86217c` 的
`web/src/shared/i18n/index.ts::resolveLocale/getLocale/t` 按浏览器首选语言解析，
所以中文默认与设置切换明确记为 `SS-WEB-PRESENTATION` 适配，不冒称上游默认。
控件沿用 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/MessageComposerToolbar.tsx::MessageComposerToolbar`
与 `desktop/src/features/messages/ui/ComposerAttachments.tsx::ComposerAttachments`，
只将原文案接入同一 `platformMessages`，不删菜单、编辑器或附件能力。

四步影响结论：

1. 权威：用户最新中英要求优先于旧“无语言设置”限制；最小设计更改仅涉及
   `.design/02/03/05/15/18` 的 locale 语义，不改工作流、权限和组件独立性。
2. 影响：共用 TS `getLocale/setLocale/subscribeLocale` 与 `useUiLocale/useUiT`
   被 Web/Desktop 实际消费；设置页复用原外观面，新增的语言输入仍只是设备偏好。
   单一 catalog 经原生成器投影 Dart，没有新增后端字段或第二词条表。
   `BROWSER_RESOLVED` 线协议值保留兼容，其宿主最终语言按修订 DD-53 解析。
3. 副作用：切换只更新呈现，不 remount 已认证 scope、不清消息草稿、不触发
   BFF 写动作；用户正文、资源名、URL、公钥与协议错误码保持原文。独立原生
   页面保留自己的呈现；在线编辑仍是下一次 launch 映射，不重载未保存文档。
4. 边界：空/未知设备值为中文；显式英文不被系统覆盖；持久化失败保留原语言
   并显示同 catalog 错误。跨标签 storage 变化与 memo 化原控件均订阅同一来源，
   显式 PlatformProvider locale 优先；Web 邀请页不再用一次性 locale prop
   遮蔽订阅。Web 原 `main.tsx::initializeDocumentLanguage` 负责初始 lang，
   后续选择更新同一属性。这是本地呈现失败，不伪造服务端六类业务错误或审计。

在既有受限 SDK（4 CPU / 8 GiB）合批实际运行，而非本子任务另启构建：

- shared `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.test.json` 均退出 0。
- `vitest run test/settings.test.tsx test/format.test.ts test/new-message.test.tsx
  test/sidebar.test.tsx test/inbox-surface.test.tsx --pool=threads --maxWorkers=1`：
  `Test Files 5 passed; Tests 39 passed`。其中语言设置 15 项含中文默认、英文保存、
  持久化失败、切换不丢草稿，以及 memo 控件和显式宿主 locale 的真实交互。
- SDK-only 将 `defaultPlatformLocale` 改成英文后，原默认语言用例实际失败：
  `AssertionError: expected 'en' to be 'zh-CN'`，退出 1；按原字节还原并 cmp 0，
  上述 39 项恢复通过。正式源码未保留变异。
- 首轮 DM 两项失败是旧夹具隐式依赖默认英文；夹具现明确保存英文后再验证
  原重试/UNKNOWN 行为。Web i18n 原 node 用例改为 jsdom 才能验证真实设备存储，
  没有为让检查通过改回浏览器默认或改写产品行为。

原件目录为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`，
对应 `locale-inbox-final.log` 与 `locale-mutation-shared.log`。该合批命令的后续
Web 类型检查当时因 Inbox 提取遗漏 `hex` 报 TS2304、总退出 2；不能把 shared
通过写成全批退出 0。最后 useUiLocale 接线及显式宿主优先级变异的补充证据、
Web 恢复结果由下文另记。此处未运行 full、打包、部署或 Win11/Mobile 实机验收，
也不据词条接线宣称原版全部页面与业务能力已恢复。

### Native 语言入口与本批最终恢复证据

本段是实现后记录。权威为用户要求的中文默认、英文可选与 REQ-24 原版功能保留；
原控件核对固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/settings/ui/NotificationSettingsCard.tsx::NotificationSettingsCard`、
`desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::GlassBackgroundSetting`、
`desktop/src/features/profile/ui/UserProfilePanelSections.tsx::ProfileSummaryView`。
保留其通知开关、声音试听、链接预览、玻璃效果、线程布局与资料行为，只替换可见
文案来源和语言订阅。`SettingsPanels::settingsSections` 从模块初始化翻译改成
按当前语言求值，原设置外观页接入同一 `LanguageSettings`，不是重写设置页。

影响面为 Desktop 设置/资料/频道标题与启动文本、Mobile 设置/资料/频道日期、
共享 TS 词条及其 Dart 投影。没有增加身份、资源、权限、工作流或计量权威。
Desktop 不以 locale 作组件 key，不重建当前身份、频道或草稿。Mobile 复用
原 `savedPrefsProvider` 存设备语言，`MaterialApp.locale` 订阅此偏好；未保存、
空值、未知或错误类型偏好均默认中文，明确英文保持英文。保存失败显示错误而不
宣布切换成功，写入期间同控件禁止重复提交，离开页面不迟到更新界面。
日期格式化不再模块级锁定语言，每个原消息、日期分隔线、线程摘要和搜索结果
调用传当前 `Localizations` 语言。业务正文、姓名、公钥、声音资源标识均不翻译。

`tools/gen-platform-i18n.py` 保持 TS 为唯一词条来源，把 Dart 缺省系统语言改为
中文规则；`reason_text.dart` 复用生成的 `platformLocale`。实际在既有受限 SDK
（4 CPU / 8 GiB）运行生成、`--check` 与 `dart test test/platform_i18n_test.dart`：
`PASS: Mobile platform and reason catalogs match the shared TypeScript source`，
`+8: All tests passed!`，退出 0，记录 `locale-dart-restored.log`。首轮旧 fr-FR→英文
断言与新默认规则冲突失败，已保留显式英文覆盖并改成中文期望，不回退产品规则。
Dart SDK-only 把中文缺省改成英文，新增默认检查明确期望 zh-CN/实际 en，退出 1；
正式生成物原字节还原并再生成检查、八项回归通过。生成物没有手改。

最后 `locale-inbox-restored.log` 包含实际最新 `context.tsx::useUiLocale` 与
`sidebar/app-sidebar-primary-menu.tsx`：shared 源码及 test tsc、Desktop tsc、Web
tsc 全部退出 0；shared settings 15、format 7、DM 11、sidebar 3、Inbox 3 共
39 项通过。Web 原 i18n 4 与 Inbox 4 在 `locale-inbox-web-final.log` 已通过，
该次新 InboxThread worker 启动超时使总命令退出 1，没有执行其用例；仅重试该
文件后，两项真实回归在最终恢复日志通过，最终合批退出 0。没有因此重建镜像。
Desktop 原快捷键两项与新增原通知控件一项共 3 项通过，记录 `locale-inbox-final.log`。

新增检查的 SDK-only 破坏验证及恢复：默认改英文使原通知控件中文检查退出 1
（`locale-mutation-native.log`）；`useUiLocale` 忽略显式 Provider，使 memo 原控件
检查报期望 `Send message`/实际 `发送消息`、退出 1（`locale-provider-mutation.log`）；
Inbox 行动作去掉 `stopPropagation`，检查发现选择回调意外调用一次、退出 1
（`inbox-propagation-mutation.log`）。上述全部从正式源码原字节还原、`cmp` 退出 0，
39 项恢复通过。Workflow 按旧条件让未编辑 YAML 也显示错误，新增 untouched
用例真失败退出 1（`workflow-mutation.log`），恢复原字节后原 YAML、未编辑草稿及
不支持 YAML 共 9 项通过、215 项按选择器跳过（`locale-inbox-final.log`）。

Mobile 的偏好持久化、错误偏好回落、日期语言切换检查已追加到现有测试路径，
本 SDK 只有 Dart、没有 Flutter：15 个 Mobile 文件实际 `dart format` 解析通过，
Flutter widget/频道测试及 Mobile 实机验证未运行，不能用纯 Dart 词条检查替代。
本子批未执行 full、打包、部署、截图或提交；也不声称尚未逐页核验的原生界面已全译。

### 主线收口：设计检查与 YAML 未编辑草稿

中文默认设计已独立提交并 push 为 `769ebe9b7587ca385a7dd83c7eb91db8e9a64d4a`。
原 `tools/check-docs.sh` 在同一受限 SDK 最终退出 0：276 引用、87 实体、115 DD、
29 接缝、87 场景闭合，实施与设计 markdownlint 均为 0 issues。
此前临时设计导出缺少相邻 apps 链接、未投递 npm 缓存分别失败；仅修正临时
导出布局和使用已有 `/cache/npm`，未改检查规则或产品要求。
原日志位于 Data 的 `codex-agent-receipt-regression-20261005.XvkUjX/locale-docs.LGYhdV/`，
最终为 `check-docs-final.log`，先前失败日志保留。

旧在线截图 17 暴露未填写 Workflow 草稿仅切换 YAML 就报错的问题。
`AutomationAction` 现记住由原表单生成的 YAML；未修改时切回原表单，不把空草稿
误判为转换失败。修改过的 YAML 仍走原结构校验，未知字段保留文本并拒绝转换；
提交准入、执行器、权限与 UNKNOWN 行为不变。影响仅为共用 Web/Desktop 编辑器
状态，无契约、迁移或后端权威变化。上文 9 项检查与真实破坏/还原覆盖该修复。

### 原设置分组、快捷键与真实通知开关恢复（后续独立批）

权威与范围：沿 REQ-24、DD-53 恢复原设置呈现，不把旧开发预览中
“Web 只有 Enter/不生成浏览器通知”的阶段事实解释为永久功能裁剪。
源码证据为只读 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/settings/ui/SettingsView.tsx`（`SettingsSectionButton`、
`SettingsView`）、`desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx`
（`KeyCombo`、`KeyboardShortcutsCard`）和
`desktop/src/features/settings/ui/SettingsSectionHeader.tsx`（`SettingsSectionHeader`）；
完整路径与符号已由该提交 `git show` 核验。

影响面：共享 `settings-surface.tsx` 提取原个人设置分组、图标、稳定宽度标签、
内容卡片与滚动区、章节标题；Desktop `SettingsView` 删除相同重复呈现，保留
原生侧栏容器、窗口顶部、版本读取与关闭事件。Web `SettingsPage` 使用同一组件，
外观选项使用原 `SettingsOptionGroupList`、标题及偏好卡片。快捷键恢复原分类和
逐键 `kbd`；Native 仍读取原完整键盘注册表，Web 只列出实际共享富编辑器与设置
入口支持的八项命令（含换行、粗体、斜体、删除线、行内代码、链接），删除旧单行
输入框描述。四个分类词条进入唯一 TS catalog 并由原工具生成 Dart 输出。

副作用边界：Web 通知行改用原 `SettingsOptionRow` 与 `Switch`，仍只调用原
Workspace preference CAS，不增加通知权威、浏览器后台服务、空回调或新 API。
保留当前 version、starred 值及读取准入；开关点击后不乐观显示已静音。
原 Profile 签名事件 readback 身份/事件核对原样保留，认证和授权没有变化。

异常行为：空 Workspace 显示原空状态；目录或偏好读失败不展示默认未静音的开关；
读取中/已有写入/不在目录内拒绝写入。丢回执仍回读原 CAS，不重放写入。原资料
保存 UNKNOWN 保持同一意图并核对原签名事件，不能渲染为成功。未引入新状态、迁移、
额度或工作流，沿用 `06` §4 的现有错误处理；本批不改变 Mobile 行为。

隔离 SDK `kailo-agent-receipt-xvkujx`（4 CPU / 8 GiB）实际窄验：共享 source/test
TypeScript 检查退出 0，设置 16 项通过；Desktop TypeScript 检查退出 0，原快捷键
与通知 3 项通过；Web TypeScript 检查退出 0，设置 6 项及资料保存回读 4 项通过。
原 `tools/gen-platform-i18n.py` 与 `--check` 退出 0。初次生成因未投递 Dart PATH
失败；修正使用现有 SDK `/usr/lib/dart/bin` 后成功。Web 首轮出现函数闭合括号遗漏
`TS1005`，已修正后重验。共享旧测试按 `textContent` 精确匹配把原隐藏加粗标签计入
两次，改为原导航 testid 定位而保留原双标签呈现。资料测试仍存在 jsdom canvas
未实现提示，不把该提示冒充真实头像画布验收。

破坏检查只改 SDK 副本：将快捷键分类强制改成 Messages，新增分类检查实际失败
（1 failed / 15 skipped）；将原 Switch 回调的 muted 参数强制改为 false，实际
点击开关的 CAS 断言失败（1 failed / 5 skipped）。两处均从正式源按原字节还原，
`cmp` 退出 0，恢复后共享 16 项、Web 10 项通过。

日志目录：Data 下
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`；
`settings-surface-narrow.log`、`settings-surface-restored.log`、
`settings-surface-final.log` 保留初次失败；`settings-profile-restored.log`、
`settings-switch-restored.log` 是最终恢复通过，两个破坏日志分别为
`settings-category-mutation.log`、`settings-switch-mutation.log`。
本批未运行 full/build、未部署或重新发布。浏览器系统通知/声音、Web 链接预览与
线程布局真实消费者、原设置其余栏目仍是恢复缺口，不能宣称全部设置已恢复。

### 原链接预览共用与设置实际消费（独立后续批）

关联 REQ-24、SS-WEB-PRESENTATION、DD-75。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/lib/linkPreview.ts::extractSupportedLinkPreviews`、
`desktop/src/shared/lib/linkPreviewSnapshot.ts::parseLinkPreviewSnapshots`、
`desktop/src/shared/lib/linkPreviewStylePreference.ts::useLinkPreviewStyle`、
`desktop/src/shared/ui/link-preview-attachment.tsx::LinkPreviewAttachmentPresentation`、
`desktop/src/shared/ui/compact-link-preview-attachment.tsx::CompactLinkPreviewAttachment`、
`desktop/src/shared/ui/rich-link-preview-attachment.tsx::RichLinkPreviewAttachment`、
`desktop/src/shared/ui/link-preview-controls.tsx::LinkPreviewControls` 与
`desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::LinkPreviewStyleSetting`
已核对后迁入 `client-kit/ts/platform/src/react/link-preview/`，原 Native 入口改为
薄宿主或重导出，删除无调用方的 Native 控制器副本；Web 的 `MessageContent`
和 `SettingsPane` 实际消费同一原版 compact/rich 卡片与原设置控件。

改前四步结论：

- 权威：沿原签名消息的 `link-preview` snapshot 读取文本，不新增 Core 内容权威，
  不把恢复控件等同于完整链接预览服务已恢复。
- 影响：消息 Markdown/快照解析、compact/rich 偏好、原卡片与设置、Native 原媒体宿主，
  Web/Desktop 共用一个 TS 主体；Mobile 仅更新同源词条生成物，不新增组件宿主。
  原设备存储键 `buzz.appearance.linkPreviewStyle`、默认值与 snapshot 版本均不变，
  无数据库/API/工作流字段变更或数据迁移。
- 副作用：Web 只解析已经过现有消息读取准入的 snapshot 文本，保留 URL 必须出现在
  正文、未知版本拒绝、重复去重与原文本边界；不猜 Relay origin，不外抓图片或 favicon。
  Web 专用文本解析入口绝不返回远端媒体 URL；Native 仍走原可信 origin 与媒体代理。
- 边界：空/未知/无关 snapshot 不生成卡片；原 `link-preview none` 禁止快照显示；
  rich/compact 设置立即影响实际卡片且沿原本机偏好持久化。两宿主共用原设置导航 tooltip，
  Mac 组合快捷键按键帽拆分并保留加号键。此批没有新增异步业务状态、写操作或错误分类。

实现后在既有 SDK（4 CPU / 8 GiB）运行，不另建工具或 full/build：共享 source/test tsc、
Native tsc、Web tsc 均退出 0；共享设置 18 项与原消息头 2 项通过；原生
`linkPreview.test.mjs`、`linkPreviewSnapshot.test.mjs`、`linkPreviewStylePreference.test.mjs`
合计 30 项通过；Web SettingsPane/ProfileSettings/MessageContent 合计 17 项通过。
同批私聊状态回归追加后共享 33 项通过。Dart 用既有生成脚本生成并 `--check` 通过；
此项是词条同步证据，不是 Mobile 整机或 Flutter 验收。

SDK-only 主动破坏：让文本快照泄漏 image URL、把实际样式更新固定为 compact、
把消息头实际 title 改固定文本，产生 3 个真实失败；按正式字节恢复并 `cmp` 退出 0。
既有主题检查同步实际双宿主 primary/sidebar 变量映射，并只校验原 HomeView 的确切
布局宽度/dark 背景与 InboxRowActionButton 的原提醒 tint，未放宽任意字面颜色。
随后将实际设置背景改为 `bg-forbidden`，语义色检查真实失败；恢复后两项主题检查通过。

日志仍在 Data 下 `codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：
`link-preview-narrow.log` 保留首次严格类型失败，`link-preview-restored.log` 保留 Native nullable
host 失败；对应实现修正后 `link-preview-host-final.log` 记录 Native/Web 通过；
`link-preview-header-mutation.log` 是 3 项破坏记录；`link-preview-header-restored.log`、
`link-preview-theme-restored.log`、`link-preview-dm-final.log` 保留旧主题扫描对原 Inbox
颜色/布局误判的失败；`link-preview-theme-final.log` 记录两项恢复通过，
`dm-theme-mutation.log` 同批记录私聊按钮 2 项与颜色 1 项失败，
最终恢复日志为 `dm-theme-restored.log`。

明确剩余：Web 还不生成新的远端链接 metadata snapshot，签名 snapshot 图片/favicon
尚未接通可信 BFF 媒体路径；原 Stream 线程布局没有 Web 完整消费者。它们仍属原版
恢复范围，不能通过隐藏需求或永久关闭入口宣称完成。此批未重新构建、打包或部署。

### 原通知与声音设置的实际 Web 消费（后续独立批）

REQ-24、SS-WEB-PRESENTATION、DD-75。固定 Buzz
`779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/settings/ui/NotificationSettingsCard.tsx::NotificationSettingsCard`、
`desktop/src/features/settings/ui/SoundPicker.tsx::SoundPicker`、
`desktop/src/features/notifications/hooks.ts::useNotificationSettings`、
`desktop/src/features/notifications/lib/sound.ts::playNotificationSound`、
`desktop/src/features/notifications/lib/desktop.ts::sendDesktopNotification` 是本批复用依据。
原设置卡片、声音选择器、声音槽/偏好与文本截断迁入共享 TS，Native 留原系统权限与发送适配。
Web 经同一偏好控制器接浏览器真实 Notification API，不引入第二用户/权限/消息源。

改前四步：

- 权威：消息仍由 BFF 已授权 SSE 交付，本人通知偏好使用原
  `buzz-notification-settings.v2:<pubkey>` 设备键；频道/DM 静音仍来自 Core 原 CAS。
  Web 本人 pubkey 由现有本人资料读取，不用默认租户、公用身份或客户端自选密钥。
- 影响：原通知 hooks、设置卡片、SoundPicker、ForegroundReady、原声音/格式函数及
  Web PlatformApp/SettingsPane/ChannelPane/InboxPane 的真实消费者。未改变契约、
  数据库、Workflow 或业务配额；没有新增依赖与词条目录。
- 副作用：仅用户点击开关才请求浏览器通知权限；未获权限、身份/成员/偏好读取未确定、
  自己发言、历史 snapshot、断线补发、重复帧与撤权后帧不产生新通知。
  constructor 失败不播放提示音、不声称送达；原生发送不迁到 Web。切换身份时
  阻止旧偏好写到新身份命名空间，并丢弃迟到权限结果。
- 边界：保留原 mention 与 thread_reply 两声音槽、总开关恢复细粒度选择、活动页提醒开关；
  Web 只对现有活动频道/私聊实时流作实际消费，不伪装后台全频道订阅。
  原 Inbox 的实际已准入未读行数回传给原 Sidebar badge，读取中、失败、结果不明或卸载
  则撤掉计数；通知无新增业务状态、事务或迁移。音效沿既有 Vite base 投递，
  `web-client/web/public/sounds` 的 24 个原资源与 Native 文件逐一 `cmp` 退出 0。

实现后定向检查由同一 SDK 合批执行；原旧 ChannelPane/ChannelRead 的整模块 mock
漏掉实际共享控件使用的 useUiT，已改为保留真实 hooks 的局部 mock 并显式设置英文 fixture，
没有为了测试修改生产翻译默认值或跳过真实控件。最终共享 source/test、Web、Native tsc
均退出 0；共享通知 2 项与同批草稿 2 项通过；Web ChannelRead 8、ChannelPane 4、
BrowserNotifications 2、Composer 14、草稿 2 合计 30 项通过；Native 原通知 1 与原草稿
58 合计 59 项通过。日志为原 Data SDK 目录下
`drafts-notifications-shared.log`、`drafts-notifications-web-restored.log`、
`drafts-notifications-native.log`；范围合并报告不意味着通知有 59 个专属用例。

SDK-only 依次移除迟到权限 owner 校验、移除活动页默认不提醒条件、让断线帧绕过 live
条件。`notifications-mutation.log` 分别出现共享 1 个失败和 Web 2 个失败，退出 1；
恢复三个正式文件并逐个 `cmp` 退出 0 后，`notifications-restored.log` 共享 2/2、Web
10/10（BrowserNotifications 2 + ChannelRead 8）通过，退出 0。通知构造/权限的这些
证据使用真实 React 消费链和受控浏览器 API 替身，不冒充已在用户电脑弹出系统通知。
本批不等于已完成浏览器全频道后台提醒、未打开线程的全量订阅或系统原生推送；这些仍是
完整恢复缺口，不从 REQ-24 删除。未在本批运行 full、打包或部署。

## 新版真实浏览器回执及私聊状态按钮修复（2026-10-06）

部署 `064cd615a` 的 Web 镜像 `sha256:54928e5a5a16053ae750479c1a8a0ef6ff39d33323d24cff807aec4c8e7e3df2`
经独立 inspect 为 healthy。正常 OIDC、1440×1000、默认中文，真实逐页点击并截图：
Data `kailo-visual-release-20261006.vlPvnU/RESULTS.md` 包含 18 项实际状态与截图编号。
本人创建专用验收频道，`workspace.create` 操作
`6a8ce687-b838-446f-afbe-9d8ea62ec701` 在任务页已完成，刷新可进入并发送/读回测试消息；
Inbox 真线程可读；英文切换后刷新仍保持英文。私聊只提交一次开通请求，任务仍待对账，
没有把准备中渲染成送达。原创建表单完整选项、外部服务入口、原设置全量仍缺失。

四步复核：权威为既定 Core/Temporal `conversation.open` 与原收件人选择，不新增状态权威；
影响面为共享 `useConversationOpen`、原 `NewMessageScreen` 与两端共同消费，未改契约或后台；
原错误是把冻结收件人集合的 `locked` 同时用来禁用只读状态查询，造成 pending 后按钮永远不可点；
状态查询现只读取同一冻结参与人集合的会话目录，不重发 `conversation.open`，不执行隐藏会话 reopen，
不发送草稿、不解锁收件人，不把 UNKNOWN 或 PROVISIONING 当成 ACTIVE。
网络未知、目录读取失败保留通知及原意图；已有明确发送操作仍沿原幂等重试链。

实现后共享 source/test tsc 退出 0，私聊 13 项包含 pending 锁定可查询及 UNKNOWN 查询不重发。
SDK-only 将按钮恢复旧 `isPending || opening.locked` 条件，两个新增用例真实失败；
原字节 cmp 退出 0 后，同批私聊 13 + 设置 18 + 消息头 2 共 33 项通过。
日志 `dm-theme-mutation.log`、`dm-theme-restored.log` 位于上述已有 SDK 的 Data 验证目录。
这是源码修复验证，不能声称该按钮修复已在本轮截图中的镜像部署。

## 原版草稿目录与恢复消费（2026-10-06）

依据 REQ-24、DD-74/DD-75 的完整恢复及共源要求，复用固定 Buzz
`779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/ui/DraftsPanel.tsx::DraftsPanel/SendConfirmDialog`、
`desktop/src/features/messages/ui/DraftDetailPane.tsx::DraftDetailPane` 与
`desktop/src/features/messages/lib/useDrafts.ts::initDraftStore`。本轮 git show/grep
重新确认这些符号和路径存在；只读上游，没有执行其代码。

四步结论：

- 权威：沿原 identity＋relay/origin 命名空间的 useDrafts 设备存储；Core/Relay 仍决定
  实际频道、私聊与发布准入。没有第二份消息或草稿服务，没有 Core 正文存储。
- 影响：列表／详情／确认框提取为两端共同消费的 draft-surfaces；Native 保留原
  目的地解析、原导航与发送；Web Inbox 读真实已有草稿，恢复到现有 ChannelPane、
  InboxThreadPane 或 ForumPane。字段、数据库、Workflow 不变，无迁移对象。
  Web 的 stream/thread/forum-post/forum-comment key 必须与已存 channelId 精确对应，
  不从未知 key 猜 scope，不回退默认频道。
- 副作用：未发送草稿的确认发送只触发原 Composer 一次，恢复原草稿正文／附件和 sendIntent；
  已有 sendIntent 的 UNKNOWN 草稿只恢复并显示未知，绝不自动重派或推导新键。
  原手动重试链保持，不将其全量验收归入本批，不把 accepted 当已送达。有未明发送意图时两端列表与
  详情均不可删除，Web 删除调用方再次核对存储中的意图；无隐藏重发链。
- 边界：身份切换前清空旧目录呈现；目的地不存在、成员／会话目录失败或非 ACTIVE、
  频道归档及类型不符均不挂载可发送编辑器。原线程根读取失败仍由真实线程页关闭发送。
  空正文且无附件不入目录；日期无效不崩溃；附件正文未复制到另一存储。未读 badge
  只回传 Inbox 已有真实行计数，读取中／失败／未知／卸载返回 null。

实现后同一 4 CPU／8 GiB SDK 合批验证：共享源／测试 tsc、Web tsc、Desktop tsc
均退出 0；共享草稿 2＋通知 2 共 4 项、Web 30 项、Native 草稿与通知 59 项通过。
其中新 Web 草稿用例验证四种真实 key、身份隔离、UNKNOWN 删除拒绝；Composer 新
用例验证原草稿恢复。随后交叉复核新增 UNKNOWN 自动派发拒绝：最后 Web tsc 与
Composer 15 项均退出 0，包含未发送草稿确认后仅一次发送、UNKNOWN 草稿不自动重派。
已重新核实 c674 本身即持久并恢复 mentionInstallationIds，不是本批临时添加。
旧 fixture 的语言默认／context mock
已随真实共享控件更新，不改生产逻辑迁就断言。首次 fixture 编译及旧副本错误保留在日志。
SDK-only 移除草稿行的 sendIntent 删除禁用，检查实际 1 fail/1 pass、退出 1；
按正式原字节恢复且 cmp 退出 0 后 2/2、退出 0。
另将新增自动发送的 UNKNOWN guard 在 SDK-only 移除，实际捕获 publish 调用从 1
变为 2，目标用例退出 1；恢复原字节并 cmp 退出 0 后完整 Composer 15 项通过、退出 0。

日志位于 Data `codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：
`drafts-notifications-first.log`、`drafts-notifications-hosts.log`（保留失败），
`drafts-notifications-shared.log`、`drafts-notifications-web-restored.log`、
`drafts-notifications-native.log`、`drafts-delete-mutation.log`、`drafts-delete-restored.log`。
最后 UNKNOWN 路径日志为 `drafts-unknown-final.log`、`drafts-unknown-mutation.log`、
`drafts-unknown-restored.log`。

### 原通知标题与正文回退同源翻译（后续独立增量）

REQ-24 的原通知输出完整保留，修复固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/notifications/lib/notificationFormat.ts::formatMessageNotification`
提取后遗留的英文。重新核对路径与符号存在，直接在既有共享函数中调用当前设备
locale；回复标题复用既有 `buzz.reply`，另六项加入唯一 TypeScript catalog，
Dart 由原生成器同步。没有新通知规则或语言目录。

四步结论：权威仍是既有设备语言；影响仅共享格式函数、Native 原 feed/live consumer
与 catalog 投影，不改变触发、权限、scope、幂等或后端契约；副作用仅通知文案，
保留原发送者优先、未知发送者不泄漏公钥的中性回退；无频道／空正文／trim／截断
沿原分支，逐次调用读取 locale，切语言后无需重载模块。Web 当前发送者标题与消息
正文路径未改，不将本次翻译归成后台通知能力扩展。

同一受限 SDK 实际共享 tsc 退出 0，原 format/feed 九项通过；新增事后用例实际在
同一模块内从 English 切到中文，核对原英文及中文空正文回退。SDK-only 将频道连接
词强制英文，原中文断言真实失败；原字节 cmp 退出 0 后九项再次通过。Dart 生成及
原 `--check` 退出 0。初次缺少 formatter PATH 的失败保留，使用镜像已有
`/usr/lib/dart/bin/dart` 后完成，没有安装工具。
日志为同一 Data 目录下 `notification-copy-{final,tests,catalog,mutation,restored}.log`。
本增量发生在主线 ee9a7 冻结 full 启动之后；该 full 不覆盖本增量，未新跑 full、
打包、部署或系统通知端到端验收。

### 冻结 full 的 Node 失败定位（独立检查修复）

主线 `buzz-runtime-drafts-batch.102bnA/tmp.xi2Rzzyp4d.check.log` 的 Node 失败
并不是缺少产品代码。原 `tools/check.sh` 将 `pnpm -r test` 子输出重定向到
`/dev/null`，无现存子日志；在既有受限 SDK 仅用原 ee9a7 冻结的 contracts/platform
源码重跑原命令，得到 contracts 21 项通过、shared 446 中 441 通过／5 失败。
没有混入后来通知文案六文件增量。

根因与修复范围只在既有三个检查文件：protocol-document 的三项英语断言未明确
locale；sidebar-shell 的英语菜单断言同样沿用了旧默认；pages 的主题扫描把直接复用
的 AlertDialog 遮罩当成自造颜色。英语 fixture 明确 en，同时保留中文默认文档提示和
中文侧栏真实动作断言。遮罩仅精确匹配固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/alert-dialog.tsx::AlertDialogOverlay` 原节点、颜色、透明度及
两项原 motion/blur 常量；没有整体放行 black，也没有改生产 UI 或降保真。

四步结论：REQ-24 原 UI 与唯一中文默认语义不变；影响仅检查消费者，无 schema／
数据／Workflow 变化；不改变授权或发送，不制造成功回执；英文、中文默认、原遮罩
及其他实际色值仍可判定。实际 test tsc 与三个文件 245 项通过。SDK-only 将原遮罩
60 改 50，并把中文不支持提示换成英文，两个对应检查均真实失败、退出 1；还原原字节
cmp 退出 0 后原三个文件 245/245、退出 0。没有新脚本、重跑 full、修改 artifact 或构建。
原失败及修复输出在既有 SDK 的 `ee9a7-node-{reproduce,fixed,mutation,restored}.log`。
原 AlertDialog 依赖按 Desktop 实际锁版本 1.1.23 复用；三锁由原包管理器生成。
缓存缺包导致离线解析失败后仅补取缺失包，不能声称本次零联网。
16 个草稿词条及 Dart 同源输出已生成；未新建验证脚本，未全量构建或部署草稿增量。
Web 草稿页不是已部署浏览器验收，原附件预览完整细节及论坛线上链仍有各自验收缺口。

随后对已部署 c674 Web 真实窄验的 7 张截图与边界见 Data
`kailo-visual-release-20261006.vlPvnU/C674-RESULTS.md`：设置布局与链接预览丰富偏好
刷新保持通过，频道标题仍显示内部频道 slug（不是 workspace ID）、现有私聊 stream403 已报主线；没有为状态按钮
重发 conversation.open，也没有把缺少 pending 意图的页面算成按钮业务验收。

### 原消息 Reply 动作接线（REQ-24、DD-40/75/81）

本批恢复 Web 原消息操作栏的 Reply 真实调用。横幅来自固定 Buzz
`779af8886caae1317b4de962082429867ab61503`、完整路径
`desktop/src/features/messages/ui/ComposerReplyEditBanner.tsx::ComposerReplyEditBanner`
的 reply 分支，原布局／图标／正文预览／取消按钮保留，移入共用 messages 包并由
Desktop 原 `ComposerReplyBanner` 和 Web 原富编辑器共同消费。原编辑分支没有伪接线。

四步结论：权威由 REQ-24 原界面与既有 `web_transport::publish` 定义；影响为共享
reply 横幅、Web ChannelPane 宿主、现有 Inbox 草稿目标解码及线程恢复，没有新 API、
schema 或消息／已读权威。发送仍走原 `publishMessage` 的 STREAM 与 parentEventId，
根／父事件及成员准入由 Core 回读验证，不接受前端自造 Nostr tags；仅回执同时含
eventId 与 operationId 才清空编辑器，结果不明保留原草稿和幂等键。频道撤权、归档、
元数据未确认、断线或当前目标不再可见时不提供新的回复发送。

回复目标的草稿使用既有 identity＋origin 草稿库内的
`thread:<workspace>:<root>:<parent>` 键，避免同一线程不同父消息重用一次 UNKNOWN
意图；原 `thread:<workspace>:<root>` 键继续按原 Inbox 邻接回复语义读取。
新键恢复时分开读取真实 root 线程与实际 parent，parent 未读到时禁止发布，跨 scope
和非法 ID 不回退默认频道。切回频道编辑器恢复其原独立草稿，不混入回复正文。

完整原消息菜单仍未恢复：固定上游 `MessageActionBar.tsx` 的 edit/delete/reaction
确实存在，当前 BFF 尚无对应已闭合调用；本批不生成空操作，也不把现有共享菜单子集
称为固定上游全量。原完整 ThreadPanel、消息子树已读与关注菜单仍须分别闭合，本批
仅是原 Reply 发布动作及其草稿恢复，不把主时间线称为完整原线程面板。

### 原临时频道创建与归档消费（2026-10-06，REQ-24、DD-80/81）

四步结论：

1. 权威仍是原 Relay。固定 Buzz `779af8886caae1317b4de962082429867ab61503`
   的 `desktop/src/features/channels/ui/ChannelTypeSettings.tsx::ChannelTypeSettings`
   创建布局与九个原期限选项迁入共享 `react/channel-type-settings.tsx`，Web/Desktop
   的原创建对话框共用；默认长期频道不携带 TTL。期限经原 `workspace.create`
   冻结参数进入 `IdentityClient::ensure_channel` 的 kind 9007 `ttl` 标签，仍回读
   原签名 kind 39000 核对，重试同 ID 不把不同 TTL 当成原创建成功。
2. 影响是两个可选契约字段集合、四侧生成类型、已有创建参数与频道描述读取，及
   两个 Web 消息宿主的归档禁写；没有新表、迁移、计时器、Workflow 或状态权威。
   `Workspace` 生命周期不变，Relay TTL 归档不伪造为 Workspace 暂停。
3. 归档、元数据回读中或失败时禁止新发送；有旧描述时保留原编辑器实例和 UNKNOWN
   意图，不把查询失败变成清空草稿。仅 CLOSED 触发签名元数据回查，不每条消息重订阅
   SSE；解档后才沿原流生命周期重连。普通频道发送也核对 eventId 与 operationId，
   不再把缺少确认回执当成成功；Reply 仍使用同样证据边界。
4. 缺 TTL 保留永久频道语义；零、负数、超过原 i32 范围、孤立期限、损坏时间、未知
   kind/type/archived、错误作者或签名均拒绝。UNKNOWN 创建锁住原期限与幂等键；
   归档/回读失败期间保留同一次未确认发送，不能创建第二次意图。

原时间格式与结束状态已按上述完整 commit 重新核验：

- `crates/buzz-relay/src/handlers/side_effects.rs::emit_group_discovery_events`
  从 `Option<DateTime<Utc>>` 用 `to_rfc3339()` 写 `ttl_deadline`，不是 Unix 秒。
- `crates/buzz-db/src/store/channel.rs::create_channel`、`create_channel_with_id`
  同一 INSERT 生成 TTL 和 deadline；`update_channel` 同时设置或同时清空。
- 同文件 `reap_expired_ephemeral_channels` 只设置 archived_at，保留 TTL 与 deadline；
  `unarchive_channel` 给仍有 TTL 的频道重新计算 deadline。没有新增 Core 回收器。
- `migrations/0024_event_ttl_refresh_shared_lock.sql::refresh_channel_ttl_after_event_insert`
  是原事件续期触发器；只更新活动临时频道 deadline，保留原 best-effort 报警语义。
  本批没有改变原续期失败行为，真实 Relay 到期、重启与恢复演练仍未运行。

契约兼容边界：新 `ttlSeconds`、`ttlDeadline` 是可选字段，当前四侧读取旧缺省输入不
要求它们；旧创建没有 workspaceChannel 的路径仍按原 legacy intent 执行。
原 `tools/check.sh::step_contract` 比较 contracts-v0.1.0 得到
`PASS 相对 contracts-v0.1.0 无破坏性变更（242 个 schema，匹配 3 个历史 schema）`。
这不等价于旧客户端全面接受新响应：使用旧 `additionalProperties:false` schema
验证新 TTL 字段的客户端会拒绝，需要随本批四侧更新，不存在据此证明的滚动兼容窗口。
Dart 的 DateTime 序列化把 `...00Z` 规范化为 `...00.000Z`；本批样例使用后者完成
四侧等值往返，并未声称所有 RFC3339 文本可逐字往返，也未改写原 Relay 时间字符串。

实际验证使用已有 `kailo-agent-receipt-xvkujx`，4 CPU／8 GiB cgroup，缓存复用；
没有新建环境、安装依赖、运行 full、构建镜像或部署本批。日志均在 Data
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：

- `tools/gen.sh` 四侧生成退出 0，输出已入工作树；原同源 i18n 生成含 TTL 与 Reply
  词条。首轮 TTL 词条数字开头不满足既有生成器规则，已改为合法词条，未放宽生成器。
- shared 源与 test tsc、Web/Native tsc 均退出 0。创建表单 6/6、原消息行 4/4；
  Web ChannelRead 12、ChannelPane 4、InboxThreadPane 3、InboxDrafts 2，共 21/21。
  首轮新按钮 import 错误与英文 fixture 清除 locale 的错误均已修正，原失败日志保留。
- `SQLX_OFFLINE=true cargo test --offline --manifest-path core/Cargo.toml -p platform-core
  --bin platform-core channel_` 为 5/5；`-p contracts --test roundtrip` 为 18/18。
  TS 原 roundtrip 21/21，Go `./internal/contracts` 退出 0，Dart 原 roundtrip 17/17。
  `channel-ttl-core-restored.log`、`channel-ttl-contracts-restored.log`、
  `channel-ttl-dart-restored.log` 为最终结果。真实 Relay bridge 集成用例未运行，不能
  用缺集成变量时的跳过冒充真实 TTL 创建验收。
- SDK-only 删除创建 TTL 载荷，创建检查真实 2 fail；绕过 Core 正数校验，签名描述检查
  真实 1 fail；去除归档/元数据禁写，Web 检查真实 2 fail；去掉 Reply 的 eventId
  核对，UNKNOWN 回复检查真实 1 fail。对应 `channel-ttl-mutation.log`、
  `channel-ttl-core-mutation.log`、`channel-archive-mutation.log`、
  `channel-reply-mutation.log` 均非零退出；还原并逐文件 cmp 退出 0 后，
  `channel-ttl-restored.log` 为 6/6，`channel-archive-restored.log` 与
  `channel-reply-restored.log` 均为 ChannelRead 12/12，Core 同批恢复为 5/5。

公开/私有产品可见性、完整原模板、频道设置 TTL 修改与原倒计时呈现仍是交付缺口，
没有从 REQ-24 删除，也未放上不生效的控件。本批只恢复真实创建 TTL 与已归档状态的
发送边界，不宣称频道全功能或生产就绪。

## 原线程侧栏共享恢复（2026-10-06，REQ-24 / DD-74 / DD-80）

本增量以冻结树 `9d1e38eeff1e83d96321b014a63a16eb82ccfe20` 为比较基准，不以在线旧
Web、已有安装包或该冻结树的 full 检查证明本增量部署完成。

动手前四步与实际落点：

1. 权威：沿 REQ-24 恢复原呈现，消息与父子关系仍由 Relay 签名事件决定；BFF 负责
   浏览器本人身份及准入。原版呈现依据为 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/ui/MessageThreadPanel.tsx::MessageThreadPanel`、
   `desktop/src/features/messages/lib/threadPanel.ts::buildThreadPanelData`、
   `desktop/src/shared/layout/AuxiliaryPanelShell.tsx::AuxiliaryPanel`。不恢复另一个
   Relay signer、线程正文表或工作流执行器。
2. 影响面：原布局、树与摘要、分支折叠、锚定滚动、宽度调整、加载/错误呈现提取到
   `client-kit/ts/platform/src/react/messages/thread/`；Desktop 原文件改为共享消费，
   `MessageThreadPanel` 宿主继续绑定原生发送、视频上下文及已有菜单。Web
   `ChannelThreadPane` 实际消费同一 `ThreadPanelSurface`，频道主草稿保持挂载，
   线程草稿继续按身份、频道、根消息、精确父消息隔离。Inbox 和频道线程共用
   `useWorkspaceThread` 与既有 query key，不增加消息缓存权威。无 schema/API 或
   数据库迁移；共享类型 `isAgent` 只保留原 UI 表达，不生成 Agent 身份。
3. 副作用：发送仍调用原 `publishMessage`，只向 BFF 传真实 `parentEventId`；仅
   `eventId` 与 `operationId` 同时存在才接受终态。UNKNOWN 草稿与幂等意图仍由
   原 Composer 保存，关闭/重开线程不会自动重发；原频道 TTL/归档锁保留。提取
   kinds 时保留 Kailo 已准入的事件集合与 DM 命令，不用新版上游订阅集合覆盖它。
4. 异常：原错误卡不渲染成空线程；分页遍历既有 Relay forward 复合游标，重复或
   倒退游标报错并停止发送；缺根消息、撤权、未完成分页、读取失败、断流、非活动
   成员都不能发送。撤权移除正文投影，连接恢复后沿真实读取刷新；切换目标保留
   各自草稿。UNKNOWN 不转换成失败或成功。空分支仅在读取成功后使用原空态。

其他复用出处（均为上述完整 commit）：

- `desktop/src/features/messages/ui/MessageThreadSummaryRow.tsx::MessageThreadSummaryRow`
  与 `desktop/src/features/messages/ui/MessageThreadReplyState.tsx::ThreadReplyRegion`；
- `desktop/src/features/messages/ui/useAnchoredScroll.ts::useAnchoredScroll`、
  `desktop/src/features/messages/lib/timelineSnapshot.ts::selectThreadRepliesSurface`；
- `desktop/src/shared/hooks/useThreadPanelWidth.ts::useThreadPanelWidth`、
  `desktop/src/shared/hooks/escapeSurfaces.ts` 的原 Escape 所有权；Native 改为同源
  re-export，避免独立 Escape 计数或两份面板状态。

本批恢复的是原线程面板已具备真实宿主链的呈现与操作，不是固定上游的全部新功能。
Web 消息编辑、删除、反应、关注/独立线程已读、原 huddle、DM 内线程，以及主消息
时间线的全部原摘要交互仍须闭合各自真实接缝；没有放上不生效的按钮，也没有从
REQ-24 删除这些功能。源码验收不代表新 Web/Windows 包已投递。

本增量定向证据位于受限既有 SDK 对应 Data 目录
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：

- shared 源与检查源码 TypeScript、Desktop TypeScript、Web TypeScript 均退出 0；
  原线程树/锚定滚动/Escape/错误态 Node 检查 101/101，共享线程与消息行 6/6，
  Web 线程/频道/Inbox 22/22。日志为 `thread-panel-focused.log`、
  `thread-panel-hosts.log`、`thread-panel-channel-read.log`、`thread-panel-restored.log`。
- SDK-only 将错误态强行当无错，真实检查得到「此分支尚无回复」而非「无法加载回复」，
  1 fail；移除回复 eventId 核对，得到 confirmed 而非 unknown，1 fail；均为非零
  退出。`thread-panel-mutation.log` 保留原输出，原字节还原且 cmp 退出 0 后，
  `thread-panel-restored.log` 为共享 6/6 + Web 22/22、退出 0。
- 第一轮 SDK 误同步了并行公开频道源码而未包含其新契约，报 WorkspaceVisibility
  不存在；隔离恢复该非本批文件为冻结树后继续。原 DOM 夹具未提供 matchMedia、
  scrollTo 与正确 realm 的 Event，也已局部补齐；分支单链应验证原 collapse rail
  而非仅在后续兄弟分支出现的 continuation guide。所有原失败日志保留，不修改
  产品来迁就检查，不引用这些失败轮为通过。
- 线程面板的 sending 状态由原 Composer 回调投射，非固定 false；Native 原本
  发送期间允许选择树中其他目标，Web 保持这一行为，但内部发送/取消控件仍使用
  真实 sending，挂载变化不能清除 UNKNOWN 幂等意图。该最后局部修正单独执行
  Web TypeScript 与同一组 22 项，结果记录在 `thread-panel-final-web.log`。

本批没有新依赖安装、独立 SDK、全量检查、镜像构建或部署。16 个 thread.* 英中
词条沿现有 catalog。合批时从 `f4f7094347aa36772218f00df93a104b18947f4f`
单独导出并加入这 16 项，用原 `gen-platform-i18n.py` 生成并 `--check`，实际输出
`PASS Mobile platform and reason catalogs match shared TS`；仅同步 TS catalog
与 Dart platform_text，reason_text 未变，没有混入并行公开频道词条或契约。
隔离产物为 Data 的 `codex-agent-receipt-regression-20261005.XvkUjX/thread-i18n.VJ7dFZ/`。
原 `check-docs.sh` 经既有离线 npm cache 执行退出 0，日志为
`thread-panel-docs-restored.log`；首次默认 npm cache 权限失败保留，不以改权限绕过。
这只证明词条同源和本批源码检查，不是 Mobile 页面、镜像或设备验收。

## 原频道浏览与公开加入接入（2026-10-06，REQ-24 / DD-80）

本批以 `a54c5910144b83fa3bccb6351ac14701e214162c` 的线程交付为比较基准。
实现已写入，但本段不证明真实双用户加入、部署、新安装包或生产就绪。

动手前的四项依据与实际边界：

1. 权威：DD-80 的公开是同 Tenant 内可发现并经 Core 加入，不是把 Relay
   协议频道设成公开。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/channels/ui/ChannelBrowserDialog.tsx::ChannelBrowserDialog`、
   `ChannelCard`、`ChannelCreateView`，以及
   `desktop/src/features/channels/ui/ChannelPermissionsSettings.tsx::ChannelPermissionsSettings`
   已逐符号核验并提取共享；保留原搜索、模糊匹配、分类、排序、键盘选择、成员数、
   创建视图和公开／私有分段控件，不另写简版页面。
2. 影响：`workspace.create` 冻结可选 `workspaceVisibility`，旧请求与旧数据缺省
   private；Core `identity.workspace.visibility` 是产品事实。新增
   `workspace.join` 仍从原 `/api/v1/actions` 进入，只取已认证本人，落原
   WorkspaceMembership，再走现有 MEMBERSHIP_PROJECTION / Temporal / SpiceDB / Buzz
   对账，不增加计时器、成员表或 Workflow 权威。两端同一浏览组件使用新只读目录；
   Native 的签名缓存不改写，只用 Core 已准入目录投射展示可见性，避免把协议 private
   误画成产品私有。加入后刷新原频道与 Core 目录，再导航。
3. 副作用：目录仅给同 Tenant 公开频道或已有成员的私有频道；原 CONTROL 读取签名
   channel metadata，复用既有签名／频道／作者校验，不复制消息正文。外部读取后再核
   Tenant、成员、binding 版本与准入。没有原成员关系才能 self-join，REVOKED 不可
   借公开入口复活；原管理员成员恢复动作仍是其恢复路径。
4. 异常：空目录是真空列表；分页重复 ID、重复 cursor、未知可见性／成员枚举拒绝消费。
   受理、PROVISIONING、读取失败均不算加入成功；只有回读 ACTIVE 且 isMember 才打开。
   UNKNOWN 保留同幂等命令；已受理后的目录暂时失败只重读，不再次写入。身份卸载丢弃
   迟到结果。数据库回退遇到已存在 open Workspace 必须停止，不能静默抹掉可见性。

实际证据仍在既有 4 CPU／8 GiB SDK 的 Data
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：

- `public-channel-generation.log`：原 `tools/gen.sh` 四侧生成及原同源 Dart 生成退出 0。
  输出进入工作树，没有手写生成类型。独立 thread-only 产物已先交付，不以此批混入
  未验的消息编辑契约或审计文案。
- shared 源与 test、Web、Desktop TypeScript 退出 0。原 pages 整文件 228/228；
  后补“已受理后目录失败可恢复”真实回归，最终仅频道／主题 12/12。原生缓存 hooks
  10/10。日志 `public-channel-types-contracts-restored.log`、`public-channel-ui-final.log`、
  `public-channel-ui-restored-final.log`、`public-channel-native-hooks.log`。
  初轮提取代码的可空索引、generated PageItem 类型，以及 Native 安装副本旧契约
  错误已修，原失败日志保留；没有修改产品去迁就旧夹具。
- Core `workspace_channel_tests` 3/3；Rust 原 roundtrip 19/19，TS 22/22，Go
  `./internal/contracts` 退出 0，Dart 17/17。日志 `public-channel-core-restored.log`、
  `public-channel-core-final.log`、`public-channel-go-dart.log`。前批 `.001Z` 样例和
  原 TTL minWidth 精确例外已纳入；Permissions 同一原生布局属性也精确核验，不放宽
  其它主题规则。原兼容检查相对 contracts-v0.1.0 匹配 3 个历史 schema，退出 0
  （`public-channel-compatibility.log`）；这不等于所有旧客户端能读新增返回字段，
  strict additionalProperties 消费者仍须随版本交付，Core 迁移与服务先于新客户端。
- SDK-only 提前确认加入、丢失 visibility、拦死目录失败后的状态重读，各真实 1 fail；
  Core 放开自加入 principalId 也真实 1 fail。对应
  `public-channel-{join,visibility,recovery,core}-mutation.log`；均从正式源码原字节还原，
  cmp 退出 0，随后频道 12/12 与 Core 3/3 通过。
- 原迁移 SQL 在已有隔离 `scope_verify` 库事务内 up / down / up，验证默认 private
  与原 MEMBERSHIP_PROJECTION 后 ROLLBACK，退出 0；构造事务内 open Workspace 后
  down 真实退出 3：`Open workspaces prevent visibility rollback`，连接退出后记录、
  列和 action 均回到原状态，业务库未动。日志 `public-channel-migration-transaction.log`
  和 `public-channel-migration-stop.log`。SDK 的 sqlx 连接该隔离 PG 没有返回回执后已
  取消，不声称 sqlx CLI 三步成功，也没有变更网络来绕通。

完整原模板、已有频道可见性修改、项目主页专有 glyph、真实双端公开加入验收仍是
后续交付缺口，没有从 REQ-24 删除。本批没有构建镜像、部署或改变在线权限。

主代理收口时补验原 `cargo fmt --all --check`，首次退出 1（新增 Rust 代码格式），
同一 SDK 执行原 formatter 后再次退出 0；只更新本批三个 Rust 文件。
最终包含前批 `.001Z` 样例，合计 50 文件，不把格式通过计作新增产品能力。

## 2026-10-06：旧 Web 会话 431 与 SSE 登录事务累积

真实旧浏览器会话的 Cookie 元数据记录到 150 个 `agw_oidc_t_*` 事务 Cookie，
其名称、分隔符和值长度合计约 82 KiB；不记录值。消息流约每两秒发出一次请求，
`Accept: text/event-stream` 存在而 `Sec-Fetch-Mode` 缺失，随后重定向到 IdP；
旧会话访问 IdP 返回 431，新会话可以正常登录。原因是明文 HTTP 环境的浏览器
不发 Fetch Metadata，Gateway 把 SSE 重连当成交互式登录，每次创建新事务 Cookie。
Web 原 `openStream` 在 CONNECTING 时放任原生重试，在 CLOSED 时按服务端间隔
重开，两条分支都没有检查当前登录会话。

实现前四步影响结论：

1. 权威仍为 DD-39、`.design/09` 的 AgentGateway OIDC 与 BFF 会话；没有新增认证
   或 Cookie 存储。上游 `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
   `crates/agentgateway/src/http/oidc/mod.rs::OidcPolicy::apply`、
   `crates/agentgateway/src/http/oidc/callback.rs::start_login`、
   `crates/agentgateway/src/http/oidc/session.rs::default_transaction_ttl`
   均经固定提交检索确认。此修复是原 SS-AGW-OIDC / SS-WEB-RELAY 接缝适配。
2. 写方是 Gateway 的原登录事务，读方是原回调；Web Workspace/Conversation 共用
   `openStream`。字段、数据库、契约、Desktop/Mobile 本机身份链均不变。Gateway
   在无 Fetch Metadata 时也按 SSE Accept 拒绝非导航请求，不创建事务 Cookie。
   Web 断流先关闭原 EventSource，再复用 `bff.session` 的 manual-redirect transport；
   有效会话才按原服务端 retry 间隔重开并取 fresh snapshot。并发会话失效只触发一次
   顶层登录导航。
3. 不放宽认证，不扩大任何 header 上限，不清全部站点 Cookie；JWT、nonce、PKCE、
   callback 与多标签并发事务语义不变。Accept 判断只决定拒绝方式，不授予身份。
   不把断线或探测失败显示成“已同步”，不改变消息发布/UNKNOWN 的幂等或对账。
4. 会话明确失效或 403 停止流；探测网络/503 不开新流，按同一服务端间隔继续探测；
   未取得 retry 时不自定间隔。卸载取消定时器，迟到帧及迟到探测不复活流。普通 HTML
   导航仍走原登录；旧事务只按原 TTL 自然过期，不删除其他账号/IdP Cookie。

实现后窄验在既有 4 CPU / 8 GiB SDK 中运行：
`vitest run src/platform/bff-client.test.ts --pool=threads --maxWorkers=1`，10/10 通过，
退出 0。SDK 私有副本移除 error 回调的 `es.close()`，两个 CONNECTING/会话拒绝
场景实际失败，退出 1；原字节恢复 cmp 0 后通过。日志在 Data
`metering-delivery-release-20261006.hZ7KbB/oidc-stream-{mutation,restored,final}.log`。
Gateway 复用原本地 SDK 镜像 `sha256:17a2ffedc7792a8dc0bfb17f34d6dd928db5efff67d5698d3c449cb6ffb94936`
及原 ci 编译缓存；实际 Rust 1.98.0、4 CPU / 8 GiB、Cargo `-j16`，离线运行
`cargo test --locked --offline --profile ci -j16 -p agentgateway --lib http::oidc::tests -- --test-threads=1`，
18/18 通过，退出 0。新增用例覆盖无 Fetch Metadata 的 SSE 401/无 Set-Cookie、
带 login route 及普通导航。私有快照把 SSE 判断改为不匹配媒体类型，原新用例
实际失败（返回 302 而非拒绝），退出 101；原字节恢复 cmp 0 后同范围 18/18、退出 0。
日志位于 Data `oidc-stream-sdk-20261006.36llvb/oidc-{tests,mutation,restored}.log`。

现场仅把本人旧诊断页导航到空白页停止旧循环，没有删 Cookie；按原五分钟 TTL
自然收敛后，事务 Cookie 从 150 降到 0，再导航 `/app/` 得到正常 IdP 登录页
HTTP 200、一个新事务，原页面无需重置账号即可重新登录。这证明旧数据能自然收敛，
不代表新代码已上线。此批未构建/部署，不宣称线上 431 修复已验收。

### 2026-10-06 原消息编辑恢复（源码窄验，未部署）

四步结论：

1. 权威沿 REQ-24、DD-39、DD-81 的 Buzz 原消息与 Kailo 治理边界。固定上游
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/ui/MessageActionBar.tsx::MessageActionBar`、
   `desktop/src/features/messages/ui/ComposerReplyEditBanner.tsx::ComposerReplyEditBanner`、
   `desktop/src/features/messages/lib/applyEditTagOverlay.mjs::applyEditTagOverlay`、
   `desktop/src/features/messages/lib/imetaMediaMarkdown.ts::restoreImetaMediaDisplayLabels`
   与 `desktop/src-tauri/src/commands/messages.rs::edit_message` 是本批复用来源。
2. 原菜单、编辑横条、富编辑器、附件标签与剧透恢复进入共用 TypeScript；Web 与
   Desktop 的频道真实消费者接线。Web 使用原 messages 发布端点的可选
   `editEventId`，Core 仍只保存目标外部引用与原发布回执，原消息正文仍归 Relay。
   四侧契约增加可选字段，旧消息请求无此字段保持原语义；迁移新增 nullable 引用
   及 kind 40003 约束，回退遇编辑回执明确停止，不删除外部副作用证据。
3. 不接受浏览器提供的 raw event、签名或任意 tags。原消息需验签、当前本人签名、
   相同频道和既有准入；原 h/e 派生关系不能由客户端覆盖。Web 结果不明时保留原
   intent，修改正文不能换幂等键重派；Desktop 复用原 unconfirmed 签名缓存。
   读端按原 kind 40003 覆盖展示，保持原消息 id、作者与时间，不新增消息权威。
4. 未找到原消息、签名／scope／身份不符、空编辑以及结果缺少确认回执均不成功。
   身份或频道切换后的迟到完成不能清除新视图草稿；窗口 aux、SSE、线程根消息的
   编辑均进入相同已验签投影。未知结果不渲染为成功，不把编辑事件当新通知。

既有 4 CPU／8 GiB SDK 的独立 `message-edit.AGX058/apps` 副本实际完成：共享
source/test TypeScript、Web TypeScript、Desktop TypeScript 均退出 0；共享 16
（含并行原生页面 8）、Web Composer/ChannelRead/Thread 32、Native timeline/replay
40 项通过；Core web_transport 20、stream 2、bridge 编辑 1、Rust 契约 19 项通过。
Go contracts、TypeScript 契约 23、Dart 契约 18 项通过，Core/bridge clippy
`-D warnings` 退出 0。旧 fixture 缺有效 receipt、E2E repair kind 集缺 40003 的
首次失败已定位并修复，不改产品中文默认或移除断言。新样例最初显式空附件数组
触发既有 Go `omitempty` 的空数组省略差异，改用合法缺省无附件样例后四侧通过；
本批不声称修复生成器所有可选空集合的线格式等价。

实现后的破坏验证：私有副本分别移除共享编辑作者校验、Web UNKNOWN 重派保护、
bridge 原作者校验，均实际失败；按正式原字节恢复后上述对应检查通过。
日志位于 Data `codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/apps/`
的 `edit-*-final.log`、`edit-author-mutation.log`、`edit-bridge-mutation.log` 与
`web-client/edit-unknown-mutation.log`。专用隔离 PostgreSQL 的新库
`kailo_edit_agx058` 全量 up、新迁移 down/up 退出 0，未连接业务数据库。

边界：本批没有全量检查、镜像构建、真实 Relay 编辑发布或浏览器部署验收；Native
IPC Rust 尚未编译，须在后续 Native 打包编译验证。原 Agent owner 代编辑、空编辑
转删除、反应／huddle、论坛编辑菜单和线程面编辑入口仍未恢复，不能据此称原版全部
消息交互已完成。普通本人频道消息编辑是本批实际接入范围，不删减其余交付需求。

#### 同批交叉复核后的原生与附件边界纠正

原 Native `UNCONFIRMED` 是进程内 holder，不是耐久 outbox。编辑现按
Relay／签名人／原目标先 claim，再派发；同目标结果未明时改正文拒绝，同意图只回读
原签名事件，不重派。确认 ACK／验签回读或首次确定拒绝才释放，迟到回读不清新意图。
因此关闭编辑器／切频道后重开不再绕过 UNKNOWN；应用进程重启后的未决恢复仍未验收，
不能据此发布为完整原生编辑。新增 claim/resolve 用例已写入，但原生 Rust 编译实际
停在 `glib-sys`：缺 `glib-2.0.pc`（要求 >=2.70）；GTK3/WebKitGTK4.1 预检同样缺失。
本轮未安装依赖，未执行这条 Native Rust 用例；日志 `edit-native-rust-check.log`。

Web 编辑恢复不再丢弃原附件的 `displayLabel/dim/thumb/duration/blurhash`：它们保留在
原 pending 与身份隔离草稿中。当前生成的 `WebMessageAttachment` 只接受
`filename/sha256/size/spoiler/type/url`，扩展显示元数据尚无 BFF 发布字段，不能称
编辑后完整保真。没有借此放宽契约或透传任意 tags。Web/Native 类型检查通过，
Composer 17 项通过；私有移除 `nativeMetadata` 后新增元数据用例确实失败，恢复后
同范围通过，见 `web-client/edit-{followup,metadata-mutation,metadata-restored}.log`。

只读检查当前 Relay `BUZZ_MEMBER_EVENT_KINDS=9,41010,41012`，普通成员发布
40003 会被原 `governance::check_event_kind` 拒绝；原生
`ingest::validate_edit_ownership` 的同频道／作者／成员校验与窗口 aux 原协议仍保留。
本次未更改此运行配置；需合批投递已定事件种类并真实验证，不能以源码通过称线上可用。

## Web 编辑附件发布保真（2026-10-06）

本批补齐上一节仅保存 pending 元数据、未进入发布合同的缺口，四步结论：

1. 权威为 REQ-24、DD-74/DD-75 与 SF-BUZ-36。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/lib/imetaMediaMarkdown.ts::imetaMediaFromTags`、
   `buildImetaTags`、`restoreImetaMediaDisplayLabels`、`formatImetaMediaLine`
   决定原编辑器实际字段与正文标签；本批没有另写附件编辑器。
2. 唯一 `WebMessageAttachment` 增加可选 `displayLabel/dim/blurhash/thumb/duration/image`，
   四侧同源生成。共享 `BlobDescriptor` 直接复用该契约，不再手写重复字段。
   Web 从原事件恢复到身份隔离草稿、pending、原 BFF 发布载荷，再由
   `web_transport.rs::RenderAttachment::render` 生成原 imeta 与 Markdown。
   显示标签只进入正文，filename 仍独立保留；原附件缺省 filename 时不把 UI 显示
   用 hash 伪造成文件名，新上传则保留实际 File.name。没有新端点、表、媒体目录或正文副本。
3. 原同社区 authority（含端口）及无凭据/query/fragment 的 URL 边界抽为同一
   `attachment_media_url`，同时用于 blob、缩略图与海报。缩略图必须同 hash；
   海报只接受原 video/mp4 对应的本地独立被动图片，时长须正有限数。实际 blob、
   MIME、大小、缩略图、海报与时长仍由固定上游
   `crates/buzz-relay/src/handlers/imeta.rs::validate_imeta_tags`、
   `verify_imeta_blobs` 校验，不复制 sidecar 权威。
4. 旧字段缺省仍可读写；无扩展字段时保留原幂等签名形状，新字段进入同一个
   sendIntent 摘要。已有 UNKNOWN 编辑不因新元数据而换新 key 或自动重发。
   非法引用在签名前拒绝，Relay 拒绝与未知结果继续原六类错误与对账链。
   无新增状态或迁移；Mobile 仅同步契约，没有新增编辑宿主。
   部署必须先更新 Core，再更新 Web：optional 保证旧载荷可读，不代表旧 Core
   能渲染新增元数据；新 Web 对旧 Core 的组合不在本次保真验收范围。

受限原 SDK `kailo-agent-receipt-xvkujx`（4 CPU/8 GiB）一次集中验证：
共享 source/test、Web、Desktop 类型检查退出 0；Composer 17 项通过；Core 附件
7 项、Rust 契约 20 项、Go 契约、TypeScript 契约 24 项、Dart 契约 19 项通过，
Core clippy（`-D warnings`）退出 0。
原 `tools/gen.sh --check` 四侧及同源词库通过；原 `tools/check.sh` 的兼容比对
对 `contracts-v0.1.0` 通过（262 个 schema，匹配 3 个历史 schema）。
初次 SDK 旧 Git alternates 不可达，随后只导入原发布 tag 的 bundle，在同 SDK
执行原检查代码；未修改检查工具或历史 tag。上述证据属于附件独立输入，不含并发
Workflows name 增量。

实现后的私有破坏验证：发送时删去扩展字段，保真用例实际失败 1 项，原字节
恢复 `cmp` 退出 0 后 Composer 17 项再次通过。另在 SDK 同时删去 dim/blurhash 并
绕开缩略图同域校验，两新增 Core 用例实际失败（5 通过、2 失败，退出 101）；
恢复正式原字节后 7 项全部通过。证据根为 Data 的
`codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`，
生成日志 `attachment-gen{,-check}.log`，其 `apps/` 下
`attachment-{ts,roundtrip,compat,core,mutation,restored}.log` 及
`attachment-core-{mutation,restored}.log`。

缺省文件名的视频实测进一步暴露真实消费者缺口：原缩略图
`<hash>.thumb.jpg` 经过旧 Web URL 解析会抛错（当次 17 通过、1 失败）。
现沿固定上游 `crates/buzz-relay/src/api/media.rs::validate_media_path/get_blob`
补原 BFF 媒体读取的唯一缩略图变体，仍经原准入、本人签名与社区客户端，不接受任意
路径或外域代理。最终 Web 类型检查与 Composer 18 项通过；分别重新引入伪造
filename、把缩略图错误映射为原 blob，两次各真实失败 1 项，原字节恢复后 18 项
全部通过。原失败及修复证据为
`attachment-final-web.log`、`attachment-thumbnail-web.log`、
`attachment-{filename,thumbnail}-mutation.log` 与 `attachment-final-restored.log`。

补齐真实缩略图读取后，Core 附件 8 项与 clippy（`-D warnings`）再次退出 0。
私有副本放宽 `relay_media_path` 白名单，原缩略图读取用例实际拒绝漏检
（`.jpg` 被错误接受，1 项失败、退出 101）；恢复正式原字节 `cmp` 退出 0，
8 项全部再次通过。日志为 `attachment-thumbnail-core.log`、
`attachment-thumbnail-core-mutation.log`、`attachment-thumbnail-core-restored.log`。

本批没有 full、镜像构建或真实媒体发布验收，不宣称线上编辑已完成。原编辑器
自身的投影上限仍存在：`alt/fallback/service` 不在固定版本 BlobDescriptor，
本批不冒称跨客户端任意 imeta 字段无损。原 Native Rust 缺工具链依赖、进程重启
未决编辑耐久性及 Relay 事件种类投递仍沿上一节明确边界，不由本批附件窄验解除。

## Workflows 原运行历史卡片恢复（2026-10-06）

本批四步影响核对与实现结论：

1. 权威为 `.design/01` REQ-23/24、`02` DD-106、`06` §9.1：原 Workflows
   页面保留，Temporal 仍是唯一执行器。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel`
   运行卡片布局、原生 button、Chevron 展开收起及选中样式直接复用到共享
   `client-kit/ts/platform/src/react/workflows.tsx::AutomationRunHistory`。
2. Web `PlatformApp` 与 Desktop `platform.$section` 已消费同一个 `WorkflowsPage`，
   本批只替换其中运行历史的表格呈现。读取仍为生成的 `AutomationRunPage`、
   本人 `TaskView`、步骤审批子任务和用量外部引用；详情继续原 `TaskDetail` 与
   Approvals reader。没有新契约、数据库状态、迁移、执行端点或正文副本。
3. 卡片选择仅是本地呈现状态，不提交任何动作。既有完整 scope/关联/枚举/游标校验
   仍在渲染前执行，`TaskStatusBadge` 的 UNKNOWN 优先级同时用于卡片和原详情。
   原生 `type=button` 保留键盘操作，按钮内不嵌套可交互控件；详情及审批按钮处于
   独立展开区域。中英文全部沿用现有词条，不新增英文常量或第二词库。
4. 空页只在成功读回后展示；拒绝、依赖失败、未知枚举、跨 Workspace 关联与循环
   游标不伪装成空历史。切 Workspace 丢弃迟到结果；展开/收起不触发业务写入，
   审批详情仍独立重新准入。未增加服务端状态，因此没有新的终结/回收链。

在原 `kailo-agent-receipt-xvkujx`（4 CPU、8 GiB）中，现有 shared
`tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json` 均退出 0；
`vitest run test/pages.test.tsx -t "independent shared Workflows page" --pool=threads --maxWorkers=1`
实际 27 项通过，205 项非本范围跳过。实现后在私有副本把选中回调改成始终清空，
已有展开用例实际 1 项失败（`expected 'false' to be 'true'`，退出 1）；正式原字节
恢复 `cmp` 退出 0，原 27 项再次通过。日志在 Data
`oidc-stream-sdk-20261006.36llvb/workflows-history{,-mutation,-restored}.log`。

边界：这只是已有完整后端支持的运行历史呈现纵向，不代表 Workflows 全功能恢复。
定义列表/完整编辑布局仍是现有治理页面，而非原版完整卡片/编辑面；任意多步骤执行
与原步骤轨迹尚不由本批后端合同提供。本批不伪造步骤数量、持续时间或执行轨迹，
不恢复 Relay WorkflowEngine，也不删除这些既有交付需求。未运行 full、镜像构建或
真实部署浏览器验收，本批结果不能称为线上可用。

## Workflows 原定义卡片、名称与编辑弹层恢复（2026-10-06）

本批四步影响核对与实现结论：

1. 权威为 REQ-23/24、DD-106 与设计提交
   `746084844d5dacc65c15e8e9a18bbb23710b3d2a` 的 `03` §7、`06` §9.1。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的完整源码路径及符号为
   `desktop/src/features/workflows/ui/WorkflowsView.tsx::WorkflowsView`、
   `desktop/src/features/workflows/ui/WorkflowCard.tsx::WorkflowCard`、
   `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel`、
   `desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowNameEditor`。
   本批复用其创建卡片、响应式卡片网格、触发/动作图示、详情头部、原 Dialog
   和行内名称编辑；没有恢复 Buzz 执行引擎，也没有给缺失后端的步骤造入口。
2. Web/Desktop 仍消费同一个共享 `WorkflowsPage`/`AutomationManagement`。
   名称存于既有 `catalog.automation_version.name` 可空字段，随版本正文及
   config_hash 冻结；创建/发布写入、启用/发布 SQL 摘要重建、RUN 校验、
   原有 Asset 授权详情 reader 同步读取。原数据库不可变版本 trigger 仍覆盖新列。
   列表按当前 pin 或显式标识的有权读取版本展示真实名称、触发/动作与频道，
   不是把 UUID 伪装成名称；每张卡复用原详情 API，不建立第二名称目录。
   表单、YAML、复制、提交预览共用生成的可选 name 字段；未命名旧版本明确显示
   “未命名工作流”，不猜名称、不回填旧行、不重算历史摘要。
3. 权限、scope、Asset read、创建能力、幂等 key 和 Temporal 路径均保持原链。
   关闭未提交弹层保留本地草稿；UNKNOWN 提交不能通过关闭、Escape 或点击
   遮罩丢失原意图，重试仍使用原 command。名称不是授权依据，没有 secret、
   业务正文复制或新增工作流权威。列表读取失败仍显示失败，不替换为假空列表。
4. 无名称/空名称/非字符串名称、旧数据、版本切换、跨 scope、失败及迟到结果
   沿原六类错误及 fresh 授权行为；不新增运行状态。新迁移仅扩展可空列，
   down 在已有命名版本时拒绝丢弃事实。旧版本不出现 name/null 新键；
   带名称的新版本需 Core/客户端协调投递，旧严格 reader 不承诺接受新字段，
   更不能以兼容为由丢弃名称或重写已有摘要。

实现后在既有 4 CPU/8 GiB SDK 集中验证：

- shared source/test `tsc --noEmit` 均退出 0；原 pages Workflows/Automation
  范围 78 项通过（157 项非本范围跳过）。SDK 故意去掉表单 name 传递，
  新行内编辑用例实际 1 项失败；原字节恢复 `cmp` 退出 0 后原 78 项再次通过。
- Core `automation::management_evidence` 11 项通过、3 项既有数据库集成用例
  忽略；新名称校验实际断言旧摘要形状不变、名称进入新摘要和未知类型拒绝。
  本批没有运行这 3 个被忽略的既有集成场景。Core 原
  `cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings`
  同批退出 0。
- 原 `tools/gen.sh --check` 四侧与同源词库通过；Rust 往返 20、
  TypeScript 往返 24、Dart 往返 19、Go contracts 包全部通过。首次 SDK PATH
  缺 rustfmt/gofmt 导致同步检查失败，补入已有工具路径并按原格式化后恢复通过，
  未修改生成器。私有交付从 `239400fa1106789cf866f8409b1d45a2468b6c2c`
  精选 schema 再经原生成命令产生四侧，不夹带并发附件契约。
- 原 check.sh 兼容段对 `contracts-v0.1.0` 通过（242 个 Git 已跟踪 schema、
  匹配 3 个历史 schema）；这不是对所有历史新业务契约的完整兼容证明。
- 独立 `kailo_workflow_name_36llvb` 库经原 sqlx 工具完成全迁移，再对
  `20261006220000` 实际 down/up，三步退出 0。临时接入的隔离 SDK 网络
  在演练后移除；没有修改业务库、父线程验证库或运行态工作流。

日志保存在 Data `oidc-stream-sdk-20261006.36llvb/` 的
`workflows-{editor,editor-mutation,editor-restored,contracts,core,migration,compat,selected-gen}.log`。
本批未运行 full、镜像构建或部署浏览器验收。原任意多步骤、过滤器及完整原生
步骤轨迹仍未由现有冻结执行合同提供，不能宣称 Workflows 全功能已恢复；
这些仍是交付缺口，不删除原需求，不渲染不可执行的假配置。

## 线上侧栏窗口辅助事件消费纠正（2026-10-06）

实查已投递 Web `sha256:a2ce986c8375b368c43f05c7d9fb687d570219314222afa11db077af559106d8`：
频道消息、用户状态、会话目录及可见性请求均 HTTP 200，但侧栏仍显示加载失败。
原消息窗口包含 kind 9 与 Relay 签名 39005/39006；`ChannelSidebar` 与
`InboxPane` 将全部事件交给仅接受消息行的 `inboxEvents`，使正常窗口必然报错。
这不是私聊权限失败，也不是部署期间缺迁移的旧 503。

四步结论：

1. 权威为 REQ-24、DD-74/75/80；复用固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/lib/channelWindowResponse.ts::parseChannelWindowResponse`
   与 `desktop/src/shared/constants/kinds.ts::KIND_CHANNEL_WINDOW_BOUNDS`。
   沿现有已提取的共享解析器分离消息行、摘要、边界，不另建消息或已读权威。
2. 影响仅 Web Inbox/侧栏窗口消费与既有检查；线程的严格消息行解析保持原义。
   Core `web_transport::verify_message_page` 仍核验签名、scope、Relay signer
   及附属事件两跳 target 闭包。无契约、数据库、配置或身份变化。
3. 摘要、边界、编辑、反应和删除附属事件不计为新消息。未知种类、坏形状、
   显式跨频道或重复 scope 仍失败；原窗口边界缺失、重复或不匹配请求也失败。
   原 NIP-09/NIP-25 可无 h 的 target-scoped 事件仍只来自 Core 已验证窗口，
   客户端不补写 h、不赋予新权限、不接受浏览器直接提交的事件。
4. 空窗口必须含原边界证据才投影为空；原请求取消、读取失败和权限撤销路径不变。
   不发送写入、不重试外部副作用，不改变 UNKNOWN 呈现。

此批未修改频道标题：真实 `/workspaces/:id/channel` 返回的旧 39000 名称就是
内部 slug，侧栏 Workspace 名称与其不同。Header 正确消费 Relay 名称；旧数据
须沿受治理元数据收敛处理，不能用前端覆盖伪装修好。此批未构建或部署，
原完整菜单、频道元数据管理等未闭合能力仍是交付缺口。

定向证据：既有受限 SDK 内 Web `tsc --noEmit` 退出 0；Inbox 8 项与真实
侧栏 queryFn/呈现 5 项共 13/13 通过。将 SDK 窗口分离结果故意改回全部事件，
真实失败 3 项；原字节恢复 `cmp` 退出 0 后 13/13 再次通过。首轮旧 SDK 的
侧栏 fixture 尚未同步已提交的 `isMember` 字段，1 项失败；同步正式 fixture
后恢复，未改产品准入迁就测试。日志位于 Data
`header-sidebar-fix-20261006.q5aiVW/inbox-window-{final,mutation,post-mutation}.log`。

## 2026-10-06 原版 Pulse 共源与本人 Community 调用链

本批源码实现，不是运行验收或生产就绪声明。设计权威为
`81cf51331655c61274f95ebf0204791331fc115e` 的 `09-统一身份与Buzz协议投影.md`
§3「原版 Pulse 的 Community 边界」及 REQ-24。上游固定
`779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/pulse/ui/PulseView.tsx::PulseView`、
`desktop/src/features/pulse/ui/NoteCard.tsx::NoteCard`、
`desktop/src/features/pulse/ui/AgentActivityCard.tsx::AgentActivityCard`、
`desktop/src/features/pulse/ui/PulseTabBar.tsx::PulseTabBar` 原组件移入共源包，
Web `PulsePane` 和 Desktop `PulseScreen` 消费同份主体，不用 Workspace/Task 仿造 Pulse。
原 `desktop/src-tauri/src/commands/social.rs::{get_global_notes,get_liked_notes,get_contact_list}`
查询、`desktop/src-tauri/src/events.rs::build_note` 事件及
`crates/buzz-sdk/src/builders.rs::{build_reaction,build_remove_reaction}` 标签保留。
Community 查询事实来自 `crates/buzz-db/src/store/event.rs::EventQuery::for_community`。

动手前四步与实现影响：

1. 权威：当前 Tenant 的 Community；ACTIVE 成员、绑定、本人密钥与 fresh
   `tenant.discover` 沿现有准入。Web 本人 SERVER 经 BFF，Desktop 本人 CLIENT
   直 Relay；不授予 Workspace、工具或 Agent 执行权限。正文、联系人、反应均在 Relay。
2. 影响：共享原卡片/标签页、原富文本 Composer、头像与媒体呈现、NewMessageScreen
   精确 pubkey→可见 Principal 目录匹配，两宿主导航；Core 原 publish_attempt、审计与
   原对账循环扩展 Pulse target=TENANT、workspace_id=NULL。四语言生成
   Pulse 请求及可选 native `relayQueryLimit`；附件提取为原 WebMessageAttachment
   公共 schema，字段未删减，旧 JSON 保持可读。没有数据库迁移或第二份消息库。
3. 副作用：签名输入只接受 NOTE/LIKE/UNLIKE 语义，不接受任意 kind/tag；点赞/撤销
   读取同 Community 真帖子、撤销仅本人反应。原 NIP-09 删除与反应关联，项目评论
   `a=30617:*` 不混入 Pulse。读写前后重验身份/binding；结果不明保留原幂等键，
   不把未决回执当成功或自动重发新意图。公众资料按真实作者读取，不用本人资料替代。
4. 边界：空返回与失败分离；NIP-11 原 max_limit 控制批量查询。native 新字段可缺省，
   获取失败不破坏旧连接事实，Pulse 无真实限额不发无界查询。跨租户/身份切换用独立
   query key 与 active fence，不展示旧响应。回复只引用可读 kind:1，未知签名或种类拒绝。

窄验证在既有 4 CPU/8 GiB SDK 执行，未构建镜像或 full：Core check、clippy
`-D warnings` 退出 0；Core Pulse 3/3；shared 原页面与 DM 13 项合计 16/16；
shared 源/测试 TS、Web TS、Desktop TS 均退出 0。四语言原 roundtrip：Rust 21、
TS 25、Dart 20 全通过，Go contracts 包通过；原 `tools/gen.sh` 退出 0。
原 registry 生成输出 23 条能力 / 20 个封闭 kind。Core 新 Pulse schema 不通过
`include_str!` 读取；使用现有四侧生成物，不增加发布时缺失的源码输入。

实现后的私有 SDK 破坏：删去反应 content 约束，Core 真实 1 项失败（退出 101）；
去掉 UNKNOWN 幂等键保留，UI 真实 1 项失败（退出 1）。原字节恢复 cmp=0 后
Core 3/3、共享 16/16 再次通过。首轮 UI fixture 缺 TooltipProvider 报错，按真实
宿主 provider 补齐；Dart 首轮缺 PUB_CACHE 报 `/.pub-cache Permission denied`，
改用既有 `/cache/pub` 后成功，没有安装新 SDK 或更改产品权限。
日志在 Data `codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
的 `pulse-{core-check,core-clippy,shared-tests,roundtrip,roundtrip-dart-ts,mutation-ui,mutation-core,restored}.log`。

尚未验收：这批没有 Pulse 产物 digest、没有投递 Relay 1/7/5、没有真实浏览器跨人
帖/回复闭环；故追溯为 in_progress、发布门禁保持未闭合。原 Search 按钮上游本身
没有处理器，不宣称新增搜索。Projects 没有被改成任务页。Web 原 Composer 的人类
提及 picker、资料完整面板及 NIP-OA owner 认证展示还未闭合：当前不拿 kind:0 的
自报 bot 字段伪造 Agent 身份，不编造 owner。核心帖/回复消费者接通不等于原版
全部细节已验收，以上缺口保留，不删除原交付要求。

## 2026-10-06 Pulse 人类提及与公共资料增量

此增量基于已冻结 Pulse 树 `cace573505319b1ddb117936f87f89fecfe15b01`，
不改上一批验证输入，也不包含 Core、契约、运行配置或发布产物变更。

四步影响结论：

1. 权威仍是 REQ-24 与 design `81cf51331655c61274f95ebf0204791331fc115e`
   的 Community 边界。提及目录复用原 conversationParticipants API：当前 Tenant
   的 ACTIVE HUMAN/成员/identity 投影及 tenant.discover，不从显示名猜 Principal。
   资料仍由 Relay 的真实 kind:0 作者记录提供，不把本人资料代替被查看者。
2. Web/Desktop 共用原人类候选行、前缀检测、精确提及范围及同名选择绑定算法；
   两宿主 Pulse 读取同一既有目录分页。Native 原 useMentions 仅增加真实目录输入，
   不赋予 Community 人员虚构频道角色；非 Pulse 原频道 roster 路径保持原样。
   Web 现有 Composer 增加可选人类目录和第五个发布参数，原 AgentInstallation
   picker、工作区准入及旧消息签名保持原行为。实际人类公钥集合纳入发送意图；
   UNKNOWN 保留原键，不清空草稿或所选身份。无持久化正文、迁移或新注册表。
3. 原资料头像、简介展开、可复制公钥/NIP-05、可调整宽度辅助面板和 DM 接线
   共用 TS；切 scope 时整个面板实例卸载。未绑定、目录读取失败时不猜身份；
   所选公钥已不在当前投影时不发。资料读取失败明确报错并可重试，不伪造资料。
4. 同名键不互相覆盖；手工输入的完整名称仅从实际当前目录解析，歧义保持拒绝。
   目录有 nextCursor 才显示加载更多，失败不显示成功。既有受治理 DM 负责再次
   准入；资料面板不开放旧未治理 Agent 执行器或设置。现有错误归类不变。

上游依据为 `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/messages/ui/MentionAutocomplete.tsx::MentionAutocomplete`；
- `desktop/src/features/messages/lib/extractMentionPubkeys.ts::selectedMentionLabel/extractMentionPubkeys`；
- `desktop/src/shared/lib/mentionOccurrences.ts::mentionOccurrences` 与
  `desktop/src/shared/lib/detectPrefixQuery.ts::detectPrefixQuery`；
- `desktop/src/features/profile/ui/UserProfilePanelSections.tsx::ProfileSummaryView`、
  `desktop/src/features/profile/ui/UserProfilePanelFields.tsx::ProfileFieldGroup`、
  `desktop/src/shared/ui/HoverCopyIndicator.tsx::HoverCopyIndicator`。

使用现有已二开副本抽取这些控件，保留此前身份消歧修正；没有新造简化聊天编辑器。
界面技能仅用于保留原控件与布局，不引入另一套视觉方案。

验证在原 `kailo-agent-receipt-xvkujx`（4 CPU/8 GiB）执行，实际查过当前进程、
CPU/内存压力及 Docker 限额。没有构建镜像或执行 full。

- shared `tsc --noEmit`、`tsc -p tsconfig.test.json`、Web/Desktop
  `tsc --noEmit`：均退出 0；最终提及手工输入增量继续通过 Web 实例用例。
- shared `vitest run test/pulse.test.tsx --pool=threads --maxWorkers=1`：5/5。
- Web `vitest run src/platform/ui/Composer.test.tsx --pool=threads --maxWorkers=1`：20/20。
- Native 原 `node --import ./test-loader.mjs --experimental-strip-types --test src/shared/lib/detectPrefixQuery.test.mjs`：
  16/16，日志 `pulse-people-native-helper.log`。纯算法保留独立导出，Node 消费不加载 UI barrel。
- 实现后 SDK 私有变异：资料目标换成本人，资料作者用例失败；发布参数的 mentions
  清空，人类 picker 用例失败。两次退出均 1；恢复原字节 cmp 为 0，恢复后 5/5
  与 19/19 通过；随后加入完整名称键解析用例，Web 最终 20/20。
- 初轮暴露 readonly 头像误用编辑器 host，以及 Native 目录 role 类型错误，已修正；
  jsdom matchMedia/ResizeObserver 与 mousedown 夹具已按原控件补全。最终共享资料
  用例有 React act 异步更新告警但退出 0，不把告警隐去。

日志沿用 Data 中 `profile-settings-ortsoo.DRR20F/pulse-people-{shared,hosts,final,mutation,restored,typed}.log`。

状态：源码写入和上述窄验完成；本增量尚未提交、构建、部署或真实浏览器验收。
人类公共资料不是原完整用户/Agent 面板全部验收：关注/取消关注、Wave/Huddle、
状态/在线投影、关联频道、NIP-OA owner 与 Agent 运行管理仍需各自真实治理接线；
未创建假入口或伪造 owner，不删除这些原交付需求。Pulse 原 feed 一次有界查询的
行为未改成新搜索/分页产品；本批新增分页仅复用已有人员目录的 nextCursor。

### Pulse 同名提及错误文案（2026-10-06，独立于作者资料后续批）

比较基准 `07b48d405d18463de676be0547798f450e47f89e`。原同名识别仍拒绝歧义，异常只携带稳定类型及显示名；Web 与 Desktop 消费同一 `pulse.mentionAmbiguous` 中英键，未恢复英文异常直出、未改变身份选择或发布幂等。

原 4 CPU / 8 GiB SDK 中运行 `tools/gen-platform-i18n.py`，生成既有 Dart 文案；shared、Desktop、Web 的 `tsc --noEmit` 均退出 0，Pulse 5 项通过。Web 现有 Composer 用例新增同名错误映射后 21 项通过。仅在私有验证副本将 catch 改回直接显示 error.message，实际用例失败（退出 1）：`expected 'AMBIGUOUS_MENTION' to be 'pulse.mentionAmbiguous'`；恢复原字节 cmp 0 后再验 21 项通过。验证运行期间 SDK 启动延迟曾无输出，未扩大限额或重启服务；最终原进程退出 0。没有运行 full、构建或部署，不借此证明三人两 Agent 或线上 Pulse 已完成。

### 频道/私聊消息作者公共资料接线（2026-10-06，独立增量）

比较基准 `d0304fed82fdca81e4a3a047dc0eba6244f045d1`。本批只恢复实际频道/私聊消息作者的原 hover/open 资料入口；不以 Pulse Community 目录绕过频道或私聊参与者准入，不恢复另一套 Agent 执行或资料权威。

四步影响结论：

1. 权威：`V-REQ-24`、`DD-39/75/80/81` 与原 `SS-WEB-RELAY`。Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/profile/ui/UserProfilePopover.tsx::UserProfilePopover/UserProfilePopoverBody` 和 `desktop/src/features/profile/ui/UserProfilePanelSections.tsx::ProfileSummaryView` 提供原呈现；`desktop/src/features/profile/ui/UserProfilePanel.tsx::UserProfilePanel` 提供原面板消费。只读 git show 核验该 commit/路径/符号，没有执行上游文件。
2. 影响面：两条新增只读 BFF author-profile 路由由现有 workspace/conversation message capability 登记；请求只能提交消息 event ID，服务器以本人 SERVER 查询并验证原消息签名、kind、精确 channel 和 event ID，随后从该消息公钥读取 kind:0。原 `ReadTarget/ReadScope` 准入及 generation 对比直接共用，仅开放 crate 内可见性；本人 profile 写入仍经原 read(current signer)，语义不变。共享原资料正文改为显式 clipboard/media 输入，Native 原面板实际消费并删除两份重复正文/字段文件。Web 使用原 lazy hover shell、原可调整宽度面板、真实消息作者 query key；没有逐行加载资料。
3. 副作用：没有数据写入、迁移、新队列、身份目录或内容缓存权威。缓存只在客户端当前 principal/scope/event/author 下，后台读取前后重新检查准入和当前 SERVER key；Workspace membership epoch 或 Conversation 两级 binding 版本改变即丢弃结果。头像的原 Community URL 映射到当前 workspace/conversation 媒体路由，不借本人全局 profile 媒体入口。Core 只投影原资料字段，既不复制正文入库，也不构造 owner/验证身份事实。
4. 边界：没有 kind:0 是真实空资料（eventId/name 等为空），不是伪造消息；无消息、错误作者、签名/标签错误、身份或成员撤销不返回资料。依赖不可读沿原错误分类拒绝，不当空资料成功。客户端旧 scope/作者数据不会渲染为新 scope 的资料；查询失败显式错误，重试仍读取同一已准入消息。关闭/切频道/撤权移除面板，当前非 live 时不保留可用操作；原本人身份不显示“发起私聊”。未知写结果、额度和工作流本批无适用对象，未新增限制或迁移。

合同兼容：`WebProfileView` 仅修正描述以涵盖“当前身份或已准入消息作者”。原 `tools/gen.sh` 四侧生成退出 0；逐字 diff 证明 Rust/Go/TS/Dart 仅注释变化，字段及序列化格式不变。旧数据与旧客户端格式不变，无需迁移。两条路由必须先由包含新 registry 的 Core 投递，再投递消费它们的 Web；旧 Core 上不能把 404 当成资料加载成功。没有登记虚假 artifact digest，仍是 in_progress。

实现后窄验（既有 4 CPU / 8 GiB SDK，无 full/build/deploy）：shared 源码与测试 tsc 0、Pulse 5 项通过；Web tsc 0，Composer 21 + ChannelPane 4 + MessageAuthorProfile 4 = 29 项通过；Desktop tsc 0。新作者用例覆盖 lazy trigger、真实 private event 路由、返回作者不符拒绝、scope 切换不能复用旧资料。私有副本删除返回作者比对，实际 1 失败 / 3 跳过，退出 1；原字节 cmp 0 还原后作者 4 项通过。初轮 Web 类型检查因 file: 包副本未同步新增出口而失败，投递真实共享源码后通过，未改产品迁就。少量 React act 警告仍存在，不隐瞒、不冒充浏览器验收。

四侧既有往返：TS 25 通过；Dart 20 通过；Go internal/contracts 通过；Rust contracts 21 通过。Dart 首次缺少已有 PUB_CACHE 投递，报 `Creation failed, path = '/.pub-cache' (Permission denied)`，只补投递原 `/cache/pub` 后通过，未安装新 SDK 或依赖。

Core 集中窄验 `message-author-core-final.log` 原进程退出 0：`cargo test --offline --locked -j16 -p platform-core --bin platform-core` 分别筛选 `web_profile::tests`（4 通过 / 1 忽略）、`user_state::tests`（1 通过）和 `web_transport::tests`（25 通过）。profile 中忽略的是既有需 `PROFILE_TEST_DATABASE_URL` 的数据库发布意图用例，不算本批已验收。`cargo test --offline --locked -j16 -p contracts` 往返 21 通过；`cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -Dwarnings` 退出 0。为避免同 Core 重复编译，本次同源 SDK 同时加入队友冻结 runtime 7 路径并在原隔离数据库复跑原子回执恢复 1 项、holder 恢复 2 项，均通过；没有更改业务库、配额或执行原模型。

Core 新作者证据反向验证：仅在同一 SDK 源码删去 `profile_event` 的作者公钥比对，重新编译后 `admitted_message_author_profile_is_not_the_reading_identity` 实际 0 通过 / 1 失败、退出 101，失败断言为读者不能替代消息作者。恢复原源码、与正式字节 cmp 0，再次编译后原资料 4 通过 / 1 忽略、退出 0。首次负向命令的 login shell 丢失已有 Cargo PATH 而报 127，原日志 `message-author-core-mutation.log` 保留；改用同一容器原 exec PATH，真正编译并执行的负向日志为 `message-author-core-mutation-run.log`，还原日志为 `message-author-core-restored.log`，没有换源码根、安装依赖或拿旧 binary 代替新输入。

交叉复核纠正：资料摘要与悬浮卡不能把通用 `UserAvatar` 当作原 `ProfileAvatar` 的等价替代。两处现恢复既有共享 `ProfileAvatar`，保留 primary/20 fallback、空姓名 UserRound、逐 URL 图片失败/缓存回退和 pending presentation；同一 AvatarHost 仅允许展示消费者只注入 locale/media resolver，原编辑器仍须提供真实 uploader/haptic，不补假函数。头像 alt 复用既有 `platform.profile.avatar` 中英键。共享资料主头像保留原 h-20/w-20 与 h-8/w-8 fallback 图标尺寸，没有重新设计外观。

最终窄验曾在 `message-author-profile-final.log` 明确失败：shared/Web tsc 已退出 0，但两个 Vitest worker 启动超时，0 tests、2 errors、退出 1；后续 Native tsc 因原 `set -e` 未执行。未扩大 timeout/资源限额，也没有把更早通过结果当作这次最终头像输入验收。恢复原头像后的单批 `message-author-profile-avatar-final.log` 退出 0：shared 源码/测试 tsc、Web/Desktop tsc、原头像 3 项（含真实上传成功/拒绝、只读展示的动画样式与空名图标）、Pulse 5 项、作者资料 4 项和 ChannelPane 4 项均通过。私有 SDK 移除原头像透明背景后，新增用例实际 1 失败 / 2 跳过、退出 1；原字节 cmp 0 恢复后头像 3 项通过。同轮 message-row 4 项是旧 SDK 夹具，不代表另批正式新增 8 项；另批最新检查由主线程独立记录。日志为同一宿主 Data 目录下 `message-author-avatar-{mutation,restored}.log`。

仍未声明完成：本批 Web 新作者入口落在频道/私聊主消息行，未新增 Forum 帖子和线程内作者入口；原资料 Follow/Unfollow、Wave/Huddle、在线状态、共同频道、NIP-OA owner 核验、Agent 管理及活动完整页仍须各自原有治理接线。本批没有伪按钮、虚构 owner 或借用 Pulse 权限打开这些功能。没有真实浏览器部署验收，不以源码共享和夹具通过声称全部原版资料能力已恢复。

主线程补充回执：正式最新 `message-row.test.tsx` 8 项通过、退出 0（不是上面的旧 SDK 4 项），日志 `/volumes/data/kailo/tmp/pulse-agent-integration-20261006.yBMzaY/message-row-restored.log`；同目录 `theme-mutation.log` 记录精确原版主题例外被破坏后失败，`theme-restored.log` 记录原字节还原后单项通过。这两项属于主线程独立改动，不混入本批 30 个源码路径。

## 2026-10-06 共享附件交互中英文补全

四步结论：

1. 权威是 DD-53 的平台自有文案双语、设备语言即时应用与业务内容保持原文；复用固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/messages/ui/ComposerAttachments.tsx::ComposerAttachments/MediaAttachmentItem/ComposerSnapshotCard`，只替换英文呈现，不改原布局或媒体处理。
2. 影响面经检索确认：Web `web-client/web/src/platform/ui/ChannelPane.tsx::Composer` 及 Desktop `collaboration/desktop/src/features/messages/ui/MessageComposer.tsx::MessageComposer` 经既有包装共用同一 TypeScript 组件；Inbox/线程使用原 Composer 时同样生效。只新增 catalog 词条及 Dart 投影，无契约、服务端状态、数据库、配置或消息正文迁移。
3. 副作用：上传/移除/还原/取消原回调、URL 解析、附件编辑、剧透及准入不变，不新增消息/草稿/上传权威；无新权限、额度或 secret 路径。提供方 displayLabel 与文件名保持原文，不把平台语言强加给业务内容。
4. 边界：无文件名时仍走原 hash/type 回退，但回退名与上传提示按 locale 翻译；空附件仍返回 null；有名附件、提供方标签、上传占位及已打开的 lightbox 切语言继续使用原状态。未知发布结果、重试与幂等逻辑不变。Mobile 不新增附件编辑入口，仅按既有工具同步 catalog。

实现后在既有 4 CPU / 8 GiB SDK 的独立 `message-edit.AGX058/apps` 快照验证。共享源 tsc 退出 0；测试 tsc 首次指出新夹具缺少既有必填 `uploaded`，补齐夹具后测试 tsc 退出 0、三项 DOM 用例通过。用例验证中英即时切换、原 remove/revert/cancel 回调和文件名/提供方标签保真，没有替换原组件。首次 CLI 路径沿符号链接误解析到不存在的 TypeScript bin，未启动类型检查；改为原 SDK 已安装 bin 的明确路径，没有安装依赖或改工具链。

私有 SDK 把还原按钮改回英文裸文案后，三例中 1 失败 / 2 通过、退出 1，断言明确为 expected `还原` / actual `Revert`。逐字还原生产源码并与正式文件 cmp 0 后，三例再次全部通过、退出 0；原 `gen-platform-i18n.py --check` 同批通过。日志位于 Data `header-sidebar-fix-20261006.q5aiVW/composer-attachment-locale-{baseline,check,fixture-restored,mutation,restored}.log`。本批不运行 full、宿主构建或部署，不以共享 DOM 验证宣称全站双语已穷尽。

## Web 线程与 Inbox 的原作者资料入口（2026-10-06，独立增量）

基线为 `0238a858f87a32b1d90eaafb5a27691321d4b5c4`，合并时保留 `433ec461456f9def7da892b270cdceb9def77fca` 的共享附件双语增量。本批复用刚交付的 `MessageAuthorIdentity` / `MessageAuthorProfile` 与原 `UserProfilePopoverSurface`、`ProfileSummaryView`、`InboxLayout`、`AuxiliaryPanel`，接通频道线程、Inbox 列表、所选线程及实际线程草稿的作者入口。没有复制面板、目录或头像实现。

实现前四步结论：

- 权威：REQ-24、DD-39/75/80；原作者身份来自已准入的实际消息，而不是 Pulse 的 Community 目录。上游 `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane`、`desktop/src/features/home/ui/InboxMessageRow.tsx::InboxMessageRow` 在头像和姓名处使用原 `UserProfilePopover`；`desktop/src/features/home/ui/HomeView.tsx::HomeView` 使用原资料辅助列与窄屏单列行为。本批使用这些已抽取的共源主体，不重新设计页面。
- 影响面：Web 的 `ChannelThreadPane`、`InboxPane`、`InboxThreadPane` 及后者实际草稿调用方；`PlatformApp` 只将已验证公钥交给现有受治理 NewMessage 入口。原 BFF 消息作者 API、身份/scope/签名校验、共享 UI 和 Desktop 调用均不变；无合同字段、迁移、工作流或存储增加。
- 副作用：首次渲染不发逐行资料请求，hover/open 才以当前 Principal、Workspace 和真实 event ID 读取；点击作者不选择 Inbox 项、不写已读。旧身份资料不能跨身份展示；原 SSE 准入拒绝/中断关闭相应线程资料入口，Inbox 资料仍须处于实际可见频道中。本人资料不显示向本人发起 DM。Inbox 窄屏打开资料时保留线程挂载，避免丢失原回复/未决发送状态。
- 边界：消息为空/作者缺失不造资料，查询失败沿原错误与重试表现；撤权/断流不借缓存恢复权限。原加载、返回作者不符和 scope 切换仍由同一资料组件处理。只读资料不因无发送权限而关闭。原页的 Follow/Wave/Agent 资料能力与 Forum 作者入口没有被假实现或宣布完成。

实现后窄验使用既有 `kailo-agent-receipt-xvkujx`（4 CPU / 8 GiB），未安装依赖、未运行 Cargo/full/build/deploy。Web `tsc --noEmit` 退出 0；同一次 Vitest 六文件共 27 项通过：ChannelThreadPane 4、InboxThreadPane 4、InboxPane 9、InboxDrafts 2、MessageAuthorProfile 4、ChannelPane 4。新增用例实际点击原作者触发器，核对 event 作用域、惰性查询、撤权关闭、身份切换清理和不写已读。

反向验证仅在 SDK 将 `MessageAuthorIdentity` 的 `onOpenProfile` 回调断开，三个新增入口用例全部失败（3 失败 / 14 跳过，退出 1）。还原后与正式文件字节 cmp 0，再运行 Web tsc 与上述六文件，27 项通过，退出 0。日志根目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`，文件为 `thread-inbox-author-mutation.log` 与 `thread-inbox-author-restored.log`。

失败记录保留：第一次 SDK 缺少基线已提交的 `inboxWindowEvents` 导出，tsc 退出 2、未执行测试；从基线恢复准确 `inbox-events.ts` 后，26 项通过、Inbox 新夹具缺少 PlatformProvider 而失败。夹具改用真实 Provider 后 9 项通过，未为夹具放宽产品校验。少量 React act 警告仍存在。对应日志 `thread-inbox-author-final.log`、`thread-inbox-author-baseline-restored.log`、`thread-inbox-author-fixture.log`、`thread-inbox-author-provider.log`。本批是源码与窄验交付，不是新部署或浏览器端到端验收；原版全部资料/Inbox 功能完成度不得据此整体标满。

## Web / Desktop 共源独立服务入口（2026-10-06）

基线 `4fe3170c58523d7204131776ccaeb54b52f3e0c2`。新增共享 `NativeApplicationEntries`，由 Web `PlatformApp` 与 Desktop `AppSidebar` 实际消费；现有 `ApplicationBindingsPanel` 仍负责接入管理。没有把 Cells、WeKnora、Wren 写成硬编码分支，也没有把独立服务的原生后台重写为平台页面。

实现前四步结论：

- 权威：`.design/07` §4.6、DD-88/94、SS-WEB-COMPONENT-HOST / SS-DSK-COMPONENT-HOST。现有 `core/crates/platform-core/src/application_binding_read.rs::page` 先核对 scope 和 fresh `discover`，再独立计算 `canCreate` / `canDisable`；因此非管理员可以发现已授权页面，不需要新管理权限或 Core API。
- 影响面：只增加共享读取/原侧栏菜单与原弹层消费者。原 SidebarGroup / SidebarMenuButton 来自 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/shared/ui/sidebar.tsx`，DialogContent 来自同 commit 的 `desktop/src/shared/ui/dialog.tsx`；都使用已经共源的实现。组件名称取实际 `componentTypeKey`，组织级和当前已参与、非 DM 的 Workspace 各自调用现有分页 binding 列表。另按主线程要求把 Forum 的已有 `onStartDm` 接回同一 NewMessage 导航，不改变资料准入。
- 副作用：只有 `ACTIVE` 且 `hasNativePage=true` 的 binding 生成服务入口；列表不读取配置/密钥，也不授予管理权限。选择后仍由原 `NativeApplicationPage` 新鲜解析和校验入口，Web `_blank` / `noopener noreferrer` / `no-referrer`，Desktop 仅向原隔离 host 传 binding ID，绝不传调用者选择的 URL。没有 iframe，没有 Mobile 消费者。
- 边界：切身份/频道即重挂对应读取；焦点返回清除旧选择并重新查询，错误、挂起或撤权时移除旧链接/host 操作。`validBindingPage` 原严格递增 offset 拒绝重复游标；分页不自动发无限请求，当前页无活动服务不伪造服务按钮。scope 切换后的迟到页面响应不能恢复旧入口。撤去 Kailo 入口不等于关闭独立服务会话。

实现后沿既有 4 CPU / 8 GiB SDK 一次最终序列：shared 源码和测试 tsc、Web tsc、Desktop tsc 全部退出 0；原 `application-bindings.test.tsx` 共 13 项通过，包含五个新增真实共源消费者用例：非管理员发现/隔离 Web 链接、Desktop 只收 binding ID、空/非 ACTIVE/非原生绑定无入口、重复 offset 拒绝、切 scope 丢弃旧响应。英文及中文实际按钮均被消费。

仅私有 SDK 移除 ACTIVE 筛选后，无入口用例实际 1 失败 / 12 跳过、退出 1；原字节 cmp 0 恢复后上述 13 项及三侧类型检查通过。日志根目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`，最终 `native-entries-restored.log`（原进程退出 0），负向 `native-entries-mutation.log`。首轮 shared tsc 已通过，但新增 SidebarProvider 夹具缺 jsdom 的 matchMedia，8 通过 / 5 失败；补浏览器夹具后，原 SidebarMenuLabel 的隐藏粗体副本使按 textContent 精确查按钮的夹具失败，改按组件实际可访问名称查询后 13 项通过。`native-entries-final.log`、`native-entries-fixture.log` 与 `native-entries-accessible.log` 保留原事实，未放宽产品准入。

未运行 full、镜像构建、部署或真实服务浏览器验收。本批不证明任一服务已经拥有 ACTIVE binding、SSO 已闭环、二开镜像已投递或完整原生业务可用；只交付已经接到两个实际宿主的同一受治理入口，不将三服务集成状态整体标为完成。

## Forum 作者资料及频道线程状态保留（2026-10-06）

基线 `4fe3170c58523d7204131776ccaeb54b52f3e0c2`，与上述共源服务入口一批收口。实现前四步结论：

- 权威：REQ-24、DD-39/75/80。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/forum/ui/ForumPostCard.tsx::ForumPostCard` 在作者处使用原资料弹层。此次只将 Web 已有 ForumView 的 renderAuthor 接回原共享身份触发器和资料面板；不重写 Forum 卡片、布局或编辑器。
- 影响面：ForumPane 的真实消费者是 PlatformApp 和 InboxDrafts，两处均接入现有 NewMessage 回调；ChannelPane、ChannelThreadPane 的作者资料打开/关闭影响原回复组件生命周期。Core 的现有 event-scoped 作者资料读取、签名与 fresh scope 校验不变；无合同、数据库、配置或持久状态增加，旧客户端格式不变。Desktop 原资料入口不变，Mobile 不增加组件宿主。
- 副作用：点击 Forum 作者不选择帖子、不写已读，仍惰性查询实际帖子或回复 event 的作者。频道资料打开时隐藏而不卸载已有回复组件，保留草稿及未决发送，不重建发送、不盲目重试 UNKNOWN。Forum 同样保留原帖子/回复编辑器挂载；身份、scope、流中断或撤权关闭资料，隐藏的线程仍能通知父级撤下资料。
- 边界：空消息不生成作者入口；错误或流中断停止展示作者资料；本人不生成给本人的私聊入口。资料读取失败、返回作者不符、迟到响应仍交由已有资料组件处理。权限、业务冲突、暂时故障及结果不明沿原六类错误合同处理，不改为成功。无新 secret、quota、工作流、正文存储或独立注册权威。文案全部复用现有中英词条。

实现后使用同一 4 CPU / 8 GiB SDK。首轮 Web tsc 退出 0，其余六文件 28 项通过，但 Forum 夹具错误导入未公开的 VirtualizedList 子路径，Forum 套件未运行；改为仅模拟 jsdom 缺失的虚拟布局后，下一轮明确报缺 ResizeObserver。补齐浏览器夹具后，真实 ForumView 的两项 DOM 检查通过。未扩大产品出口、放宽权限或替换真实 Forum 卡片。少量 React act 警告保留，不宣称浏览器视觉验收。

反向验证只在 SDK 恢复旧的“打开资料即卸载线程”条件，并断开 Forum 作者面板回调，实际 3 项失败 / 4 项通过、退出 1；分别捕获线程 DOM 消失与帖子/回复资料无法打开。两处从正式源码恢复并逐字 cmp 0。日志根目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：`forum-author-thread.log`、`forum-author-fixture.log`、`forum-author-browser-fixture.log`、`forum-thread-mutation.log`。状态保留检查验证组件生命周期，不冒充实际模型或外部副作用端到端证据。

还原后同一批 Web `tsc --noEmit` 及七文件 Vitest 实际退出 0，30 项通过：ForumPane 2、ChannelPane 5、ChannelThreadPane 4、InboxDrafts 2、InboxPane 9、InboxThreadPane 4、MessageAuthorProfile 4。原件为同目录 `forum-thread-restored.log`。

本批未运行 full、未构建部署新 Web/Windows、没有新增实际浏览器截图。不能据此声称全站双语、全部原版资料功能、三组件原生业务或 Web/Desktop 等效已经完成；原完整检查退出 137 的失败边界仍保留。

## 频道补帧时间顺序恢复（2026-10-06）

基线 `95abbc4aed07dc14d99b6d4043c049357e22758d`。实际发布页面截图
`/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/120-cc71-agent-reply.png`
暴露今天的新消息之后出现昨天回复。源码定位为 Web `useChannelStream` 对 snapshot
排序，却将之后收到的历史/实时帧直接 append；它也会使末项不再是最新消息，影响
既有已读推进。不是 Relay 数据丢失或需要重新发送 Agent 消息。

实现前四步结论：权威为 REQ-24、DD-75；复用固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/lib/messageQueryKeys.ts::dedupeMessagesById/sortMessages`，
提取到 shared messages，由原 Desktop query helper 重导出，Web snapshot 与增量
实际调用。影响频道和 DM 共用的 ChannelPane、原桌面 timeline 合并、日期分隔及
已读末项；不改消息字段、thread 关系、API、持久数据或 Mobile 原实现。没有新增
副作用/权限入口、第二消息库或新的运行配置。空数组、重复帧、乱序补帧、同秒事件
沿原版去重与 timestamp/id 稳定排序；撤权清空和 UNKNOWN 发送/已读规则不变，
已有错误仍走原六类分类。该修正不改变原来线程分组语义。

实现后同一限额 SDK：Web tsc 退出 0；ChannelRead 14、ChannelPane 5、
ChannelThreadPane 4，共 23 项通过；桌面原 messageQueryKeys 4 项通过，Desktop
tsc 退出 0。仅 SDK 恢复 append 旧逻辑，新真实 ChannelPane DOM 用例实际报
`expected ['event-20-a', 'event-20-z', 'event-10'] to deeply equal
['event-10', 'event-20-a', 'event-20-z']`，退出 1；原字节 cmp 0 还原后再次 23 项
通过、退出 0。用例同时覆盖快照去重、同秒顺序、live 前后迟到帧和正确最新已读值。

先前 SDK 安装副本未同步新 shared 导出时 tsc 退出 2；同步后原命令通过。直接
Node 命令先报 package export/类型剥离错误，改用仓库既有 `test-loader.mjs` 后
原 4 项通过，没有新建检查脚本或修改生产逻辑适配工具。本批未重新构建发布；
上述线上截图是问题证据，不作为修复后的线上视觉验收。

### Forum 作者删除：原菜单、真实发布与未知对账（2026-10-06）

比较基线 `cc71bf7b10388e450a550bcf01a562b3c7527865`。关联 `REQ-24`、
`DD-75`、`DD-81`，归属原 `collab.channel.message`；不是新工作流或聊天权威。

四步影响结论：

1. 权威与上游：固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
   `desktop/src/features/forum/ui/DeleteActionMenu.tsx::DeleteActionMenu`、
   `desktop/src/features/forum/ui/DeleteConfirmDialog.tsx::DeleteConfirmDialog`、
   `desktop/src-tauri/src/commands/messages.rs::delete_message`、
   `desktop/src-tauri/src/events.rs::build_delete_compat`、
   `crates/buzz-sdk/src/builders.rs::build_delete_compat` 均已重新读取。
   该原流程发作者 `kind:5`、`h=channel/e=target`；
   `crates/buzz-relay/src/handlers/side_effects.rs::validate_standard_deletion_event`
   继续决定 Relay 作者权限，`kind:9005` 是独立管理员路径，本批未开放。
2. 影响面：共享原菜单与 AlertDialog 默认样式由 Web ForumPane、Desktop ForumScreen
   实际消费。Web 新明确 `/workspaces/{workspace_id}/messages/delete` 仍走同一
   publish、本人 SERVER signer、DISPATCH、publish_attempt 与原对账；Native 使用
   本人 CLIENT、原 builder、原签名投递与已有 UNCONFIRMED holder。生成请求增加
   `deleteEventId`，原 attempt 增可空 `delete_event_id`，保存引用而非正文。
   普通 `/messages` 拒绝删除输入。新端误连旧 Core 会得到缺路由拒绝，不会因旧
   serde 忽略新字段而把删除误签成空帖子。旧请求、旧 writer 保持原格式。
3. 副作用：Core 回读当前频道原事件、验签、核对当前签名作者和 kind，并在 I/O 后
   再准入，才签原删除事件。本人其他绑定公钥不等于当前 SERVER/CLIENT；UI 不把
   Principal 的所有公钥都当成当前可签作者。完整目标随幂等记录冻结，不能换目标。
   Web 以目标签名摘要的 UUID 长度前缀作稳定不透明幂等键，碰撞由原完整目标比较
   拒绝；不新增浏览器删除账本。Native 删除首次发出前 claim，同目标并发只观察
   原签名事件；目标已消失也可从原 holder 查证该删除事件，不再签发。
4. 边界与终结：禁止删除同时含编辑、回复父级、正文、附件或提及。确认弹层在
   pending 时不关闭；UNKNOWN 用中性状态、同一意图查证，不显示成功或确定失败。
   只有原肯定 ACK/回读证据才能更新列表，未知记录仍由原对账/保留机制处理。
   归档、非成员、作者不符继续拒绝，签名身份或 scope 改变不开放旧意图。
   Mobile 未增加组件宿主或其他入口。

实现后验证均在原 4 CPU / 8 GiB SDK，未创建新工具链、未执行上游证据树。
`tools/upstream_manifest.py status` 确认 Buzz HEAD 仍为固定基线；Temporal SDK
证据树另有更新，本批未改变已选依赖。

- 原 `tools/gen.sh` 四侧生成退出 0；共享来源的八条菜单/确认文案生成到 Dart。
- 最终 shared 源码与 test tsc、Web/Desktop tsc 均退出 0；shared Forum 7 项、
  Web ForumPane 4 项和原 BFF 11 项合计 15 项通过。
- SDK 故意把 UNKNOWN 改为拒绝，真实 1 项失败/5 项跳过、退出 1；原字节还原
  cmp 0 后通过。没有修改产品行为以迁就断言。
- Core 作者检查删除后真实作者隔离测试失败；同批 peer 租户检查变异也失败，
  两者各退出 101，原字节恢复 cmp 0。最终 Core web_transport 27 项、peer 凭据
  5 项、component_release report 9 项通过/1 项需真实演练库而忽略；clippy
  `-D warnings` 退出 0。peer 用例属于队友同时验证的独立增量，不计本批功能完成。
- 四侧最终往返：Rust 22、TS 27、Dart 22、Go contracts 包通过；包含同批 peer
  样例。删除自己的初次快照已单独验证 Rust 21、TS 26、Dart 21、Go 通过；
  私有删除树保留删除 schema 对应的生成物，不夹带 peer schema。
- 新隔离库 `forum_delete_20261006_rija8a` 完成全部 95 条向前迁移；末条原 SQLx
  down/up 均退出 0。已有删除 attempt 时 down 明确拒绝，不能丢失对账目标。
  不修改部署库或旧未知任务。

保留失败事实：第一轮 Web typecheck 发现漏 package export，已补；第一轮 Core
测试插入作用域错误编译 101，已修；新增 route 初次漏限定 routing::post 导致
编译 101，已修。SQLx revert 首次误加不支持的 `-y` 退出 2，去掉参数后 down/up
通过。Dart 首次未投递 PUB_CACHE 尝试 `/.pub-cache` 而失败，随后只复用已有
`/cache/pub` 通过，没有网络安装。均不改写为首次通过。

原件日志根目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`。
主要文件：`forum-delete-gen.log`、`forum-delete-core-mutation.log`、
`forum-delete-core-route.log`、`forum-delete-final-ui-contracts.log`、
`forum-delete-route-final.log`、`forum-delete-ui-mutation.log`、
`forum-delete-migrations.log`；早期失败分别保留在同名前缀的原日志中。

状态：源码写入、上述定向验证完成；本批未 commit/push、未 full、未构建或部署。
Native Rust IPC 未做完整编译（既有 SDK 缺 GTK/WebKit 开发依赖），仅 rustfmt
解析和 Desktop TypeScript 通过；不得当作 Windows 实测。原三端端到端删除与
断线重连尚未在部署环境验收。发布必须先迁移、再新 Core、投递原运行期 kind5
成员清单，再交付 Web/Desktop；当前线上配置或旧产物不由本批冒充已就绪。

提交复核补充：删除签名分支已把新增 `expect` 改成显式缺目标时返回
`PRECONDITION/INVALID_PARAMETERS`，不引入 panic；此最后守卫调整未重新编译，
以上 Core 计数对应调整前输入。私有候选的追溯输入经原 `tools/gen-registry.py`
重新生成及 `--check` 均退出 0（23 条能力、20 个封闭 kind），生成结果与候选
逐字 cmp 0，仅增加删除路由。共享 SDK 曾被后续批次更新，其原目录直接检查
因输入不一致退出 1；随后检查使用从本候选提取的独立输入，不以混合快照作证。

### Tasks / Audit 技术键的同源中英文呈现（2026-10-06）

本增量相对已交删除候选 `ff3f798087a3a26f713873b94b86809eb73c9e88`；
只改变共享 Task/Audit 呈现及原 TS→Dart 文案，不新增动作或权限。
对应 `.design/06` §8、REQ-08、DD-36、DD-53。

四步影响结论：

1. 已核 `core/crates/platform-core/src/governance.rs::Definition` 与
   `Semantic::from_key`、原 `TaskView` / `OwnAuditEntry` 合同：实际只有动作键，
   没有已投递的本地化名称。译名只加入既有 `platformMessages`；其不登记、
   启用或批准动作，也不成为第二份 ActionDefinition。
2. 实际读者是共享 `react/governance.tsx` 的任务列表/详情及 `react/pages.tsx`
   的本人/范围审计；两端继续同一 BFF 与组件。ActionLabel 保留可见原始键，
   状态/等待原因保留 title 原码，未知扩展动作保留原键并显示未识别。
   Dart 文案由原 `tools/gen-platform-i18n.py` 生成，未改生成器或业务合同。
3. `ALLOWED` 只是准入获准，`CANCEL_REQUEST_ACCEPTED` 只是接收取消请求，
   均不显示为任务完成。任务未来 gate/dispatch/taskStatus 枚举明确中性未知，
   不再落入同步动作“已生效”；没有改变服务端状态或控制动作。
4. 中英均使用既有语言上下文；`constructor` 等未知键不读原型属性，原码仍可
   查证。下划线只编码为合规词条键，往返校验拒绝不同 wire key 别名；
   原审批、BFF 失败、结果不明与刷新行为保留，不新加动作入口。

实际验证在原受限 SDK（4 CPU / 8 GiB）：共享治理 24 项、审计 14 项通过，
其他 226 项明确筛选跳过。私有 SDK 移除未知枚举守卫，并把取消请求接收故意
译成“已完成”，原检查真实 3 项失败、退出 1；两个源码文件原字节恢复 cmp 0
后 38 项再次通过。原同源生成/`--check` 退出 0，Dart 现有文案检查 8 项通过。

失败边界：首次生成因动作键含下划线违反既有 Dart 词条规则退出 1，改合法
词条键后通过，未放宽生成器；首轮 shared tsc 被另一批 messageOrder 的数组
索引类型错误阻断，未据此修改本批行为。恢复验证的串行命令在 38 项通过后，
因相对工具路径写错退出 2；随后只补原生成检查及 Dart 检查，实际退出 0。
类型检查最后状态单独回报，不把前述 38 项当作全量或部署验收。

随后根代理修正其共享 messageOrder 严格索引类型并授权同步这一个最终输入；
本批 shared 源码 `tsc --noEmit` 与 `tsc -p tsconfig.test.json --noEmit` 串行
退出 0，原件 `task-audit-types-final.log`。没有重跑 38 项或另开全量构建。

日志仍位于原 `profile-settings-ortsoo.DRR20F/` Data 验证目录：
`task-audit-localized.log`、`task-audit-localized-restored.log`、
`task-audit-pages.log`、`task-audit-mutation.log`、`task-audit-final.log`、
`task-audit-dart.log`。本增量未 full、未构建/部署、未做新浏览器截图或 Mobile
设备检查；文案生成通过不表示 Mobile 消费页面新增或全站词条已完整覆盖。

根代理最终复核补充：删除签名缺目标的显式守卫已在原受限 SDK 实际重新编译，
web_transport 27 项通过，原运行句柄 24108 退出 0；因此上文交接时的“最后守卫
未重新编译”已由此证据补足，不扩大为 Native IPC 或部署验收。共享排序模块移入
严格 TypeScript 包后新增数组空位守卫；最终共享源码及测试类型检查均退出 0。

### 本批集中完整检查的实际失败（2026-10-06）

`./tools/check.sh --full` 对固定树
`c75e61b84657dacf81159b94aec73d87b5e61396` 实际退出 1；日志为
`/volumes/data/kailo/tmp/tmp.gSnEm0nF3U.check.log`。该输入早于上述 Task/Audit
呈现与最终排序空位守卫，不把之后的窄验倒写为此完整检查通过。

- 原 Rust fmt/clippy、Go vet/test、Dart analyze/test、四侧契约同步与兼容、
  Workflow replay、文档、能力注册表、安全边界和供应链检查通过。
- TypeScript 静态与验证步骤失败；共享排序数组索引已在后续输入修正，
  上述两项共享 tsc 已实际通过，完整 TypeScript 步骤未重新运行。
- 迁移与三个 Core 数据库用例失败，实际错误是
  `database "forum_delete_20261006_rija8a" does not exist`。执行容器加入了
  错误的隔离 PostgreSQL 网络；原演练库实际在 `kailo-channel-agent-pg-h8mshl`，
  已独立只读确认 95 条迁移成功。此次错误不归因为迁移 SQL，也不记演练通过。
  Core 该测试组实际为 267 通过、3 失败、31 忽略。
- 发布追溯与上游 seam 仍失败：新 Web/Desktop 源码没有对应新产物，多个能力
  仍引用旧 Web 摘要，Pulse 缺摘要，私聊历史 Core/Worker 摘要无对应 dist 产物。
  本批不伪填摘要或清空产物声明；后续集中构建后按实际产物更新。
- 部署 `.env` 预检跳过，未安装 gitleaks，Windows/Mobile 发布和三组件绑定
  仍有各自未验收项。未改变真实运行数据、额度、权限或旧 UNKNOWN。

## 2026-10-06 Pulse 缓存重入的原虚拟列表挂载修复

实现前四步结论：

1. 权威：REQ-24、DD-75 与既有 Pulse Community 边界不变。核验固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/shared/ui/VirtualizedList.tsx::VirtualizedList`；
   保留原 TanStack 虚拟化、可变行高、浮动标题、滚动与卡片交互，不替换列表。
2. 影响：仅共享 `forum/VirtualizedList.tsx` 的 DOM 挂载同步；实际调用方包括
   `pulse/ui/PulseView.tsx::PulseView` 两种时间线以及原共享论坛消费者。
   Web/Desktop 的 Pulse 使用同一主体；没有契约、Core、数据迁移或 Mobile 改动。
3. 原因及副作用：缓存已有数据时，子列表的 layout effect 早于祖先滚动容器 ref
   挂载；TanStack 当次读取 null，ref 写入不会触发 render，原无标题路径也没有
   状态变化，因此一直没有可见行。改变窗口宽度引发的 render 才使它重新订阅。
   现在只在整次 commit 后发现真实滚动元素变化时触发一次同步；不伪造尺寸，
   不主动发 resize、不轮询、不重新取数据，也不改变消息/权限/已读权威。
4. 边界：外部容器与列表同次首次挂载、切走再进入、内部自持滚动容器和浮动标题
   均沿真实 DOM 与原订阅清理路径处理。元素未挂载时仍不测量；同元素后续
   commit 不重复更新状态。此 UI 生命周期修复不改变原异常分类或 UNKNOWN。

先实现后在既有受限 SDK 的独立 `message-edit.AGX058/apps` 快照验证。
共享 source/test 两套 `tsc --noEmit` 均退出 0；
`vitest run test/virtualized-list.test.tsx` 使用真实 TanStack hook，仅为
jsdom 提供浏览器尺寸，三项通过：缓存首挂、缓存重入、内部容器与标题。
私有快照删除新增同步调用后，前两项真实失败，分别得到空 article 列表和
`expected length 2 but got 0`，退出 1；内部容器检查仍通过。
恢复正式字节且 cmp 0 后，两套类型检查及三项用例再次退出 0。
日志位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`：
`pulse-virtualized.log`、`pulse-virtualized-mutation.log`、
`pulse-virtualized-restored.log`。
本批未 full、未构建、未部署；线上浏览器复验留待包含此源码的真实投递，
不能将旧页面或 jsdom 结果称为新线上验收。

### Projects 原生公告目录共源增量（2026-10-06）

本批关联 REQ-24、DD-39、SS-BUZ-GOVERNANCE、SS-WEB-RELAY，比较基准为
`89f69014d2682bda65bc5f1ee77c1fa7c9a29080`。只恢复真实 Projects 公告目录，
不把 Workspace/Task 当作项目，也不把该增量记作完整 Projects 已交付。

四步影响结论：

1. 权威：沿 `.design/09` 既定 Community 读取边界，公告正文、替换事件与删除
   仍在 Relay；Core 没有项目表或第二目录。固定上游
   `779af8886caae1317b4de962082429867ab61503` 的
   `crates/buzz-relay/src/handlers/ingest.rs::is_global_only_kind` 与
   `validate_project_envelope` 确认 30621、30617 是 Community-global 公告。
   `crates/buzz-relay/src/api/git/binding.rs::resolve_repo_binding` 和
   `crates/buzz-relay/src/api/git/transport.rs::authorize_git_read` 另行决定 Git
   绑定与内容权限；公告中的仓库坐标不会授予内容、频道、工具或 Agent 权限。
2. 影响：新增封闭的 ProjectsQueryRequest 与 BFF 只读路由，Web 复用当前
   Tenant 的 `tenant.discover`、ACTIVE 身份/binding 和本人 SERVER 签名，
   查询后重新准入并比较 signer；Desktop 仍用本机 CLIENT 直连原 Relay。
   两端实际消费同一 ProjectsView、读模型、分页、卡片与详情元数据。新增可选
   契约字段与四侧生成一并比对；联合生成含并行升级批的可选 `canUpgrade`，
   不能把生成物脱离其 schema 单独交付。本批没有数据库、迁移、写动作或
   Workflow 变更，也没有新编译期 schema 文件引用需追加发布 COPY。
3. 副作用：查询不发公告、不调用 Git、不执行工具。保留原 owner/unlisted、
   仓库归属、删除阈值与未解析坐标语义；未知仓库只显示不可读取引用，不能
   伪造 owner 或零值 Git 统计。查询失败移除旧详情，不渲染为空列表成功。
4. 边界：空目录正常展示；分页上限读取当前 Relay NIP-11，保留原秒级边界
   补查，整秒仍饱和则拒绝截断。删除只按精确 30621/30617 坐标有界批查，
   任一批失败拒绝整个结果。枚举中身份/binding/限额变化、退出 scope、非法
   时间窗口均拒绝；不扩大 scope 或回退默认身份。切 scope 清理缓存，焦点
   返回重新读取。移动端未增加 Projects 宿主入口。

复用证据均对应上述完整上游 commit：
`desktop/src/features/projects/projectModels.ts::buildProjectReadModels`、
`desktop/src/features/projects/projectEnumeration.ts::enumerateProjectEvents`、
`desktop/src/features/projects/lib/projectCollection.ts::absorbStandaloneProjectRepositories`、
`desktop/src/features/projects/ui/ProjectCards.tsx::ProjectGridCard`、
`desktop/src/features/projects/ui/ProjectEntityListRow.tsx::ProjectEntityListRow`、
`desktop/src/features/projects/ui/ProjectDetailMeta.tsx::ProjectDetailMetaList`。
保留公告名称/描述、真实仓库计数、原卡片与列表呈现、搜索、排序、布局切换及
实际详情打开；原 Git 文件/Issues/PR、项目创建编辑删除、终端及关联写动作
仍不在本批完成范围，完整原功能需求没有删减。

验证使用原 `kailo-agent-receipt-xvkujx` SDK，实际 4 CPU/8 GiB 内存与 swap
上限，缓存和日志在 Data 盘；执行前回读资源与并发，未开 full 或镜像构建。
原 `tools/gen.sh` 四侧生成、同源文案及注册表生成最终退出 0；共享源码和
测试 tsc、Web tsc、Desktop tsc 均退出 0。Projects 原实现后检查 8 项通过；
Core Projects 3 项、Rust 契约往返 24 项通过，clippy `-D warnings` 退出 0。
TS 契约 29 项、Dart 往返 24 项与 i18n 8 项、Go contracts 包通过，原文案
`--check` 退出 0。

反向验证：私有 SDK 放宽分页 signer 比较后，原“changed signing identity”
用例真实 1 项失败、退出 1；原字节恢复 cmp 0 后 8 项通过。私有 SDK 将删除
坐标 kind 校验改为任意非空 kind，重新编译后原坐标隔离用例真实 1 项失败、
退出 101；源码原字节恢复 cmp 0 并重新编译，3 项再次通过。正式源码没有
保留变异。日志目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/projects-directory.wiWDv3/`：
`generation-restored.log`、`host-types.log`、`core.log`、
`ui-mutation.log`、`core-mutation.log`、`core-restored.log`、
`roundtrip-restored.log`。

首次生成在四侧完成后因私有快照缺 i18n 输入失败；补齐输入后原入口通过。
首轮共享测试 tsc 缺新增 Projects 图标夹具，补原夹具后通过；首轮 Web tsc
因 SDK 的 file-package 仍为旧共享包而失败，同步同一冻结输入后两端通过。
这些失败保留原日志，不改产品行为迁就工具。本批未 full、未提交/push、
未构建/部署、未做新浏览器或 Windows 安装包验收；投递须先发布具有真实
只读路由的 Core，再发布消费者。旧线上版本没有该入口不等于此源码已上线。

随后原 `./tools/check-docs.sh ../.design` 实际七段全部通过、退出 0，
同目录 `docs.log`；该轻量文档检查不改变上述未 full/未部署边界。

## 2026-10-06 原成员浏览与受治理资料入口

本批实现前四步结论：

1. 权威为 REQ-24、DD-53、DD-75、DD-77：成员按现有 Principal 聚合真实协议公钥，
   资料仍由原 Relay kind:0 管理；Web 本人 SERVER 代签、Desktop 本机 CLIENT 查询。
   没有新成员目录、资料数据库、角色权威或正文副本。
2. 影响为共享 MembersPane/WorkspaceMembersPage、两端既有成员路由、
   原 BFF client/route/web_transport 与 platform.pages 追溯。现有 WebProfileView
   不变，无迁移或四侧合同变化；新增四个中英词条由原入口同步 Dart。
3. 副作用检查：目录某成员的公钥不能成为任意用户查询入口。新增读取先检查当前
   Workspace 协作准入，再核验目标 HUMAN、HumanIdentity、TenantMembership、
   WorkspaceMembership 和 BuzzIdentityBinding 均 ACTIVE，且公钥精确属于该成员；
   读取原 kind:0 后验签，并复核 scope epoch、目标 membership/key version 与本人
   signer。不得用 Pulse discover 或任意消息替代成员证明。
4. 边界为零成员、搜索无匹配、读取失败、切频道、焦点刷新和执行中撤权。
   失败时移除旧行/旧资料；错 scope/Principal/pubkey 与撤权返回拒绝，不伪造空成功。
   各管理分类首次打开才挂载，随后隐藏但不卸载，保留原未决意图和幂等状态；
   不把管理可见 Workspace 当可协作频道。原异常分类及 UNKNOWN 不变。

核验固定 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::RelayMemberRow`
  与 `HoverMemberIdentity`：复用原成员行、搜索、头像/资料交互和原虚拟列表。
- `desktop/src/features/settings/ui/SettingsView.tsx::SettingsView`：
  复用原设置分类布局承接现有邀请、角色、组织、密钥、能力、组件和绑定管理，
  不再进入成员页就堆叠全部表单，也未删除这些治理能力。
- 头像与资料复用已抽取的原 ProfileAvatar、UserProfilePopover、ProfileSummaryView，
  不另做精简资料卡。Desktop 通过原 UserProfilePopover 消费本机 CLIENT 通路；
  Web 仅在 hover/open 后调用该 Workspace 的真实成员资料接口。

实现后在既有 4 CPU/8 GiB SDK 集中窄验：共享源码/测试 tsc、Web/Desktop tsc
退出 0；Members 四项、原 WorkspaceMembersPage 两项通过。JSDOM 只补原组件
需要的 matchMedia/ResizeObserver/尺寸；真实 TanStack 虚拟化仍参与运行。
Core 原 web_transport 范围 28 项（含真实隔离库事务用例）通过，clippy
`-D warnings` 退出 0。原 gen-registry 退出 0，生成物只新增一个成员 profile route。

反向验证：私有 SDK 将访问过的管理分类改为切走即卸载，真实 1 项失败、退出 1；
原字节 cmp 0 恢复后四项通过。私有 SDK 放宽 SQL 精确公钥条件，重新编译后
错公钥用例真实失败、退出 101；原字节 cmp 0 恢复并重新编译后该用例通过。
正式源码无变异。日志位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/projects-directory.wiWDv3/`：
`members-core.log`、`members-core-mutation.log`、`members-core-restored.log`、
`members-ui-mutation.log`、`members-ui-final.log`、`members-final-restored.log`。
首轮 JSDOM 缺 matchMedia 的两项失败及旧页夹具漏导入生命周期的 tsc 失败均保留，
修的是既有检查环境，不放松产品权限或行为。

本批只恢复已接通的频道成员浏览/资料与管理分类，不宣称原 Community 管理全功能：
原 owner/admin 标识、加入日期和踢人/升降权行菜单仍须对应真实治理事实与动作，
不能由 WorkspaceMemberView 缺失字段猜造。目录头像保留原 fallback，完整资料按需
读取；未完成资料批量头像投影。本批未 full、未构建、未部署、未做线上或安装包
验收；投递仍须 Core 新路由先于 Web 消费者。

## 2026-10-06 原 Workflows 卡片动作菜单与选定版本编辑

实现前四步结论：

1. 权威：REQ-24、DD-107、`.design/03` §7 的 AutomationVersion、复制和
   运行语义。只读核验 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/workflows/ui/WorkflowActionsMenu.tsx::WorkflowActionsMenu`
   与 `desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog`。
   复用原 DropdownMenu、图标、启用复选项和可视开关，不重新设计菜单。
2. 影响：共享 `AutomationCard` 接同一个 `AutomationAction`，由 Web/Desktop
   现有 WorkflowsPage 消费；新增原菜单组件，没有宿主第二套实现。
   卡片所选不可变版本明确传入编辑/复制；表单和 YAML 仍读写同一已定义合同。
   不改 Core、数据库、Action schema、Workflow 类型或公开管理 API。
3. 副作用：菜单打开动作前沿原授权读取刷新详情，校验 scope、资源版本、
   canManage/canRun；没有读取证据不打开写表单。编辑只发布新版本，复制只携带
   配置、不复制 source Resource/Asset/pin/Delegation 或历史。菜单启停、删除和
   单次运行仍经过原确认与 `submitAction`，不发原生 Relay 控制事件。
4. 边界：无权限动作不渲染；启用仍显式选择已发布版本与未过期委托。
   切 Workspace、版本、身份或进入已冻结请求后，迟到读取不能打开旧表单。
   读取失败显示原可重试的拒绝/中性未知状态，不当作空结果成功；
   请求 UNKNOWN 继续锁定原 intent，重查同一幂等键，不提前切卡片状态。

原执行接缝仍为
`core/crates/platform-core/src/governance.rs::Semantic::from_key` 的现有
`automation.publish_version/enable/disable/delete` 解析及
`core/crates/platform-core/src/automation.rs::ACTION` 的 `automation.run`；
本批没有重写 Temporal。暂停等既有详情动作原样保留。

使用现有受限 SDK 独立 `message-edit.AGX058/apps`：
共享 source/test 两套 tsc 退出 0；原 Automation/Workflows 78 项加新增菜单
10 项共 88 项通过，其余 165 项按明确 filter 跳过。
新检查实际覆盖中文原菜单、选定旧版本 form/YAML、复制边界、
显式版本/委托启用、单次运行/停用/删除治理消费、UNKNOWN 同键、撤权和迟到读取。
SDK-only 删除 fresh canManage 检查后，撤权用例真实失败，1 failed / 9 passed、
退出 1；按正式字节恢复 cmp 0 后，两套 tsc 与 88 项再次退出 0。
首轮失败是新检查误把原中性 ReadFailure 当 alert，以及英文断言拼写不符；
只修夹具，未改变产品失败语义。唯一词条源新增两条菜单文案，
原 `gen-platform-i18n.py` 生成和 `--check` 均退出 0；
独立候选不夹带并行 Members 词条。

日志位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`：
`workflow-menu.log`、`workflow-menu-final.log`、
`workflow-menu-mutation.log`、`workflow-menu-restored-final.log`。
本批未 full/build/deploy，未做新线上浏览器或 Windows 包验收。
原多步骤可视编排、Webhook、cron 和原完整条件/步骤编辑仍有既定合同与消费者
缺口；没有用空按钮伪造支持，也不把这组已接通交互称为 Workflows 全功能完成。

## 2026-10-06 Workflows 原运行轨迹卡片与真实任务引用

实现前四步结论：

1. 权威：`.design/06` §9、§9.1 要求运行历史复用原 ActionExecution、
   WorkflowRef 和 TaskProjection；`AutomationRunView` 目前只有真实父任务、
   可选步骤审批子任务、进度与用量引用。核验 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的完整路径
   `desktop/src/features/workflows/ui/WorkflowRunTrace.tsx::WorkflowRunTrace`，
   复用其运行轨迹卡片和状态行布局；不把父任务冒称任意原生步骤数组。
2. 影响：共享 WorkflowsPage 的展开运行详情接同一 WorkflowRunTrace，
   两宿主继续消费该页；WaitingReason 仅导出原 Tasks 已有翻译映射复用。
   没有新合同字段、存储、端点、任务类型或词条。原 usage 引用保留，
   不把空引用解释为零消费或结算完成。
3. 副作用：每张卡片仅打开其真实 actionExecutionId，原 TaskDetail 和
   Approvals 继续 fresh 授权读取；本呈现本身没有写请求。
   状态徽标与图标都经既有 taskPhase，不引入第二套执行状态判断。
4. 边界：UNKNOWN 和 PROJECTION_DELAYED 优先于旧 COMPLETED/FAILED。
   缺审批引用不推断无需审批；没有开始/结束时间或输出证据就不生成耗时、
   输出或任意步骤。等待原因沿原中英文映射，未知 code 保留为明确代码，
   不改门禁、执行准入、幂等或迟到读取规则。

定向验证在原受限 SDK 的独立 `message-edit.AGX058/apps` 完成：
共享 source/test 两套 tsc 退出 0；现有 Workflows/Automation 80 项、
原动作菜单 10 项、新轨迹 4 项共 94 项通过，163 项非本范围用例按 filter 跳过。
SDK-only 去掉徽标输入的 observation 后，两项未知/滞后用例真实失败，
输出分别出现错误 Completed 和 Failed，2 failed / 2 passed、退出 1。
按正式字节恢复 cmp 0 后，4 项再次通过、退出 0。

日志同 `message-edit.AGX058/` 下 `workflow-trace.log`、
`workflow-trace-mutation.log`、`workflow-trace-restored.log`。
本批不改前一动作菜单冻结候选，未 full/build/deploy 或新浏览器验收。
任意多步骤配置、完整触发条件与原 executionTrace 仍没有当前合同和
Temporal 消费者；本批恢复的是已有执行与审批引用的原卡片呈现和详情交互，
不是这些缺口已经完成。

### 2026-10-06 原成员行角色／移除菜单与邀请弹窗

依据 REQ-24、DD-82/83，复用固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`.references/buzz/desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::{RelayMemberRow,HoverMemberIdentity}`
原 MoreHorizontal、DropdownMenu、破坏性项分隔与禁用表现，以及
`.references/buzz/desktop/src/features/community-members/ui/CommunityInviteDialog.tsx::CommunityInviteDialog`
原 Dialog 壳与尺寸。两宿主消费同一 MembersPane，不启用原 Relay 管理写旁路。

四步影响结论：

1. 权威仍是 Core 成员事实、SpiceDB 角色及原 ActionDefinition/ApprovalPolicy；
   workspace/tenant admin grant/revoke、member.revoke 与 tenant.member.invite
   继续提交原 /actions。租户移除仍走原审批和 owner 转移，不以菜单点击当作终态。
2. 改动面仅原 role-members 只读投影、共享成员/角色/邀请消费与同源文案。
   RoleMemberPage 增加两个可选布尔字段，四侧重新生成；旧响应缺省时不显示移除，
   真/假/缺省往返验证覆盖。没有迁移、第二用户目录或新管理动作。
3. 移除可用性单独核对当前 manage、对应 ACTIVE 动作、原目标类型/Workflow、
   目标成员与租户 ACTIVE 审批策略；不借用 canGrantRole。本人不显示移除，
   最后有效租户管理员保持原保护；提交时仍重新准入。
4. 角色分页只有完整、无重复成员/游标才展示菜单；读取失败移除动作而保留明确
   读取状态。原共享变更控制器保存命令与幂等键，UNKNOWN 不当成功/失败，
   同意图重试沿原键；邀请弹窗关闭/重开不丢失未决请求或首次返回的链接。
   重入由现有 in-flight 状态拒绝，既有查询焦点重读与 scope 隔离不变。

实际窄验（原受限 SDK，4 CPU／8 GiB，缓存位于 Data；未开 full 或镜像构建）：
shared source/test、Web、Desktop tsc 均退出 0；Members 8/8、Invitations 9/9、
原 RoleMembers/WorkspaceMembersPage 6/6 通过。SDK-only 将邀请重试换成新幂等键，
真实 1 failed、退出 1；按正式字节恢复 cmp 0 后，17/17 再次通过。
四侧 roundtrip Rust/TypeScript/Dart 各 27/27、Go 合同包通过；新旧移除字段与
同批 canUpgrade/conformance 字段均保留。Core 成员 SQL 1/1、合批 identity 3/3、
report_tests 11/11（另 1 项真实 wire/DB 检查显式 ignored）、clippy -D warnings 退出 0。
SDK-only 移除审批 ACTIVE 条件与篡改 conformance 参数摘要分别命中真实断言，
各退出 101；两源文件恢复 cmp 0 并重新编译后，成员 SQL 1/1、identity 3/3、
report_tests 11/11（另 1 ignored）再次通过，整条恢复命令退出 0。

保留失败事实：首轮引用了不存在的 shared Button 路径，改为已经复用的原
profile/buzz/shared/ui/button；新游标断言误将原中性 ReadFailure 当 alert，
只修检查断言。旧 SDK 残留 schema 漏 canUpgrade 被契约用例抓获；
从正式完整 schema 联合生成后通过，未删除升级字段迁就缓存。
隔离 SQL 还发现已有 catalog.guard_version 的 BEFORE UPDATE 比较包含生成列
platform_action_key，导致仅退役 ActionDefinition 也报 23001；已单独反馈，
本批不关闭触发器、不改线上目录。成员投影的审批退役验证在事务内完成并回滚。

日志目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/projects-directory.wiWDv3/`。
主要日志为 member-actions-js-final.log、member-actions-host-types.log、
member-actions-mutation.log、member-actions-mutation-restored.log、
member-actions-roundtrip-final.log、member-actions-core-final.log、
member-actions-core-mutation.log、conformance-core-mutation.log、
member-actions-core-mutation-restored.log。
本批恢复原成员行菜单与受治理邀请链接弹窗，不冒称 Community 管理全功能：
原直接添加公钥及用户自选 Relay 邀请 TTL 不等于 Kailo 组织准入，未用原绕行接口
补齐；原用户全资料批量头像、加入日期仍未作推断。本批未提交、构建、部署或
实机浏览器验收；投递需 Core 两字段先于两端菜单，旧 Core 不显示移除入口。

## Agent Library 原管理弹窗与真实版本引用恢复（2026-10-07）

本批按 REQ-24、DD-53、设计 17 §8 与 03 §7 恢复现有 Agent
管理交互，不新增注册表、权限或执行入口。
固定上游 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/agents/ui/AgentsView.tsx::AgentsView` 使用卡片与独立管理弹窗；
`desktop/src/features/agents/ui/AgentDefinitionDialogShell.tsx::AgentDefinitionDialogShell`
和 `desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent`
提供本批复用的宽度、滚动区域、标题与内容间距。

影响面是两宿主已共同消费的 `AgentDefinitionsPage`，不改 Web/Desktop
路由或再造一份页面。定义、新建/转移、版本、安装/升级、委托、权限和
平台工具仍使用原 BFF 消费者；从一直堆叠在卡片下改成原弹窗。
未提交定义草稿在关闭后保留，打开工具弹窗才读取现有只读目录。
版本详情显示原合同中的 Skill 版本引用、Tool 资源引用及 capability
要求，不能将声明列表当成已授予权限。

副作用检查：状态不明的写请求仍冻结同一幂等命令；定义写入 UNKNOWN
后的查询拒绝不得释放原意图，后续返回必须关联原 actionExecutionId
和 operationId。Memory 原编辑锁向安装详情弹窗和列表传递，未决时
关闭、Escape、切 Workspace 和刷新卸载都不得丢失原消费者。
本批没有复制业务正文到 Core，也没有改变版本不可变性、配额或授权。

边界覆盖保留原 403/503/空目录、权限收紧、过期身份响应、候选刷新、
升级准入、UNKNOWN 重查与原 Memory 写入检查。原夹具改为从实际入口
打开真实 Radix portal，而非依赖旧内联 DOM 或点击模态遮罩后的控件。
首轮失败来自这些旧夹具位置假设；最后一个迟到 Task 用例改为确认整个
页面不残留旧 operation，而不是要求身份切换后仍保留安装弹窗。

实际验证：shared 源码和测试 TypeScript 检查均退出 0；
`vitest run test/pages.test.tsx test/agent-library-dialogs.test.tsx -t 'Agent|Installation'`
定向 116 项通过（另 131 项未运行）。首次负向误改了其它既有写入函数，
未命中新用例并返回 0，已还原；随后精确移除 DefinitionAction 的
UNKNOWN 重查保护，真实出现 1 failed / 3 passed、退出 1，
断言为拒绝重查后 Escape 错误关闭弹窗。正式字节恢复 cmp 0 后，
以精选候选词条和测试重新检查，不将首轮无效负向作为证据。

日志在 `message-edit.AGX058/agent-library-final-restored.log`、
`agent-library-definition-mutation.log`、`agent-library-selected-restored.log`。
精选 Skill 标签经原 `gen-platform-i18n.py` 和 `--check` 同源生成，
没有夹入并行 Members 词条或测试改动。
本批未运行 full、构建、部署或新浏览器验收。
Skill 发布/选择没有现成目录写消费者，仍明确未恢复；本批仅呈现真实引用，
不宣称完整上游 Agent 导入、Team 与所有配置页面已经完成。

### 2026-10-07 成员邀请与管理命令的未知结果保护

关联 DD-83、REQ-24 与原 ActionSubmission 终态语义。交叉复核确认原重查
catch 将后续 403 当作原写入失败，会解除未决意图并允许新键。现邀请签发、
撤回及共用成员角色/移除控制器均保留原 UNKNOWN、命令和幂等键；只有同一
operationId、已知时同一 actionExecutionId 的有效回执才能解除。EVALUATING
及 ALLOWED/NOT_DISPATCHED 不渲染签发完成或无链接成功；未知枚举仍拒绝。
没有新增契约、写接口、权限或工作流。原 Dialog 关闭仅卸载内容，意图 hook
在外层；列表 403 返回空呈现而不清空 hook，不能据读取拒绝推断原副作用失败。

实现后定向 shared 源/测试 tsc 均退出 0；Members 8 项、Invitations 14 项
共 22 项通过，含未知 HTTP 回应、重查 403、异操作回执、最终原回执、弹窗
关闭与原键保留。SDK 单次将签发 catch 的 `!wasUnknown` 改为 `true`，四个
未决签发用例实际失败，退出 1；原字节恢复 cmp 0 后上述 22 项通过，退出 0。
日志位于既有 `projects-directory.wiWDv3` 证据目录：
`member-actions-unknown-mutation.log`、`member-actions-unknown-restored.log`。
未重复四侧生成、full、构建、部署；两端完整类型检查由合批执行，当前窄验
仅证明共享消费逻辑。原测试仍有 React act 提示，不当作新增业务失败。

### Workflows 原 Cron 到既有 Temporal Schedule（2026-10-07）

本批在原 SCHEDULE 消费链增加 Cron，不建立本地时钟或第二执行权威。
Web/Desktop 共同使用原五格 Cron 输入、粘贴与键盘移动交互；原 interval
输入保留。六字段（含秒）与七字段（含年份）仅通过原 YAML 编辑，不能无损
转五格时保留 YAML 并明确拒绝切换，不能截断。当前仍不是 Workflows 全功能。

实现前四步结论：

1. 权威：DD-107、03 §7、05 §2.9 的既有 SCHEDULE、AgentTaskWorkflow 与审批
   链不变。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/workflows/ui/CronExpressionInput.tsx::CronExpressionInput`、
   `cronExpression.ts::validateCronFields` 与
   `crates/buzz-workflow/src/schema.rs::normalize_cron/validate_cron` 为原交互和
   5/6/7 字段依据。后者使用 Cargo.lock 固定的 cron 0.16；其
   `src/time_unit/days_of_week.rs::DaysOfWeek` 为 1=周日、7=周六，不能按
   Temporal 数字星期直接解释。原 UI 的 0–7 提示在这里纠正为真实执行语义。
2. 影响面：只扩既有 AutomationScheduleSpec 的可选 kind/cron，旧三字段
   interval 内容与摘要不变；Core 管理写入、详情读取和原 Schedule 建立/恢复
   统一调用同一个 spec 转换；Worker 原 ScheduleTaskInput、首次准入、审批、
   AgentTask 和运行历史均未另开分支。四侧类型由原生成入口产出。
3. 副作用：复用 Temporal `d94e34a1ebba5410a2e7d07119a76896909591aa` 的
   `service/worker/scheduler/calendar.go::makeRange/parseValue` 字段转换与
   `service/worker/scheduler/spec.go::CleanSpec` 默认值规则，直接投递原生
   StructuredCalendarSpec；星期只从原 1–7 映射至原生 0–6，不实现日期求值。
   原 exact-ID Describe、ScheduleSpec 严格相等、UNKNOWN 同 intent 对账均保留。
4. 边界：Cron 与 interval 字段互斥，未知 kind、空值、非法范围/步长与不可表达
   值均拒绝，不退回 interval。使用 UTC，显式年份按原生 2000–2100 边界；
   本批接原表单的星号/数字/列表/范围/步长及固定 cron 0.16 的
   `MONTH_MAP` / `DAY_OF_WEEK_MAP` 精确别名：三字母、完整月份/星期名、
   `Tues` / `Thurs`；前端校验与 Temporal 字段转换一致，不接受任意截断。
   `?` 或其它特殊语法仍未覆盖。Catch-up 与 SKIP 原策略不改。

验证：受限既有 SDK 独立 message-edit.AGX058 快照，共享 source/test tsc 均 0，
调度消费 54/54 通过，菜单/历史 14/14 通过。SDK-only 放宽 Cron 字段互斥，
新增混合 YAML 用例真实失败 1 项；原字节恢复 cmp 0 后 54/54 再通过。
原 gen.sh --check 四侧和 Dart 同源文案均 PASS；TS 往返 33/33、Dart 往返
28/28 通过。原兼容比较相对 contracts-v0.1.0 无破坏性变更，266 个 schema、
匹配 3 个历史 schema。首次 Vitest forks 启动超时，0 项执行；改用既有 threads
单 worker 后得到上述真实结果。一次 gen --check 调用遗漏 Rust/Go PATH
导致格式差异，补齐既有工具 PATH 后同步检查通过，没有改生成物迁就检查。

日志位于既有 `message-edit.AGX058`：`workflow-cron-ui-restored.log`、
`workflow-cron-ui-mutation.log`、`workflow-cron-ui-retry.log`、
`workflow-cron-contracts-restored.log`、`workflow-cron-dart.log`。
本批没有 full/build/deploy；因 Data 剩余空间不足，Core 与 Go 编译/往返暂未执行。
未获已核验的隔离 Temporal namespace，真实 Create/Describe exact、触发日期、
运行历史端到端尚未验收；不能拿纯转换断言替代。发布必须先 Core 后客户端，
旧 Core 不接受新的 Cron 形状。多步骤及其条件/超时/Delay 仍为后续真实恢复项。

## 2026-10-07：原设置 Communities / Invites 的共享接线

权威为 REQ-24、DD-53 与既有 DD-83 邀请管理。只读上游
`/volumes/kailo/.references/buzz` 固定
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/settings/ui/SettingsPanels.tsx::SettingsSection`、
`renderSettingsSection` 及同目录 `SettingsView.tsx::settingsNavGroups`
证明原 Communities 分组内有 `community-members` / Invites 的 Ticket 入口。
本批复用已恢复的 Sidebar、设置布局和原 `TenantInvitations`，不另造页面、
身份、权限目录或邀请写接口；没有恢复不存在真实消费者的 hosted-communities。

影响面为共享设置导航与邀请页面的同一次读取、Web SettingsPane / PlatformApp、
Desktop SettingsPanels / SettingsView / SettingsScreen / AppShell。入口只在原
`/api/v1/invitations` 成功读取后出现，403 隐藏；读取失败显示原错误与重试，
不伪装为空列表。窗口重新获得焦点复用原 reload，没有新增轮询或第二权限请求。
新增分组名称只加入既有 TS / Dart 同源中英词条；Mobile 无组件宿主改动。

副作用保持原 `/api/v1/actions` 准入、审批、回执及 UNKNOWN 幂等意图。
设置页关闭、切换设置分类或读取 403 不清空邀请 hook。Web / Desktop 均以
真实 tenantId、tenantPrincipalId、platformSessionId 为设置实例 key；换会话
替换实例，退出由既有认证宿主卸载。Desktop 原 NativeBootstrap 配置变化先
回到 loading 并卸载子树，ActiveCommunityProvider 仍按 relayUrl / devicePubkey
隔离；读取故障不能作为旧未决动作已失败的证据。隐藏设置不处理 Escape、不强制
展开应用侧栏，不渲染原响应式侧栏 portal；无初始会话时显示真实读取状态。

实现后窄验：共享源码与测试 TypeScript 检查退出 0，原 Members 8 项与
Invitations 14 项通过；新增设置用例所在 worker 启动超时，整条命令退出 1，
不计为新增设置验收。Web TypeScript 检查退出 0，随后 SettingsPane、
ProfileSettings、PlatformApp 三个测试 worker 均启动超时，0 tests，退出 1。
随后只执行 Desktop TypeScript 检查，退出 0；包含隐藏设置副作用和初始会话
读取状态修正，没有安装依赖或另起项目构建。
没有提高超时、改产品规避错误、安装依赖或重跑 full。两宿主保留各自锁定依赖树，
消费同一份本批共享源码副本，不通过跨树软链接混用 React 类型。

原日志位于 Data 证据目录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/projects-directory.wiWDv3/`：
`settings-invitations-shared.log`、`settings-invitations-hosts.log`、
`settings-invitations-desktop.log`。
新增设置正反行为检查尚未取得实际结果，不能以已有 22 项替代；本批没有构建、
部署或浏览器验收，不声明线上设置入口已恢复。

### 同批资源恢复后的实际行为回执

没有换 SDK、安装依赖或提高超时。原设置文件独立运行实际 20 项通过，退出 0
（`settings-invitations-behavior-restored.log`）。随后 SDK 私有源码同时故意把
导航的成功读取判断改成任意读取状态，并给邀请控制器增加随 active 变化的 key：
新增两项用例分别真实失败，退出 1（`settings-invitations-behavior-mutation.log`）。
两文件从正式输入原字节恢复、cmp 0 后，设置全部 20 项再次通过；后续命令因
工作目录层数误写而未运行 Web，整条命令退出 1，如实保留
`settings-invitations-behavior-final.log`，不称该组合命令全通过。

Web 初轮实际 12 项通过、4 项失败：PlatformApp 旧测试 mock 缺少已恢复的
NativeApplicationEntries，且管理面 mock 未透传真实 children；原邀请已经由
共享 MembersPane 持有，宿主不再另挂第二邀请页。仅修对应原夹具，不改变产品。
另一个外观用例触发原 5 秒超时，没有增加超时。修正后以准确目录运行原三个
Web 文件，SettingsPane 6、PlatformApp 6、ProfileSettings 4，共 16 项通过，
退出 0（`settings-invitations-web-final.log`）。Canvas 的 jsdom 提示仍保留，
未为消除此提示安装包或修改头像产品行为。

本批最终窄验边界为三处 TypeScript 检查、共享设置 20 项、原邀请/成员 22 项、
Web 16 项及上述真实负向/还原；没有 full、产物构建、部署或浏览器验收。

## 2026-10-07：原线程布局设置共源与 Web 实际消费

REQ-24 / DD-53 的原设置恢复继续消费只读 Buzz
`779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::ThreadLayoutSetting`、
`desktop/src/features/channels/lib/threadViewModePreference.ts::useThreadViewMode`
与 `desktop/src/features/channels/ui/FocusThreadDrawer.tsx::FocusThreadDrawer`。
三个实际源码移入共享 TS，Desktop 原路径改为导出或注入实际主题；原设备键
`buzz.channels.threadViewMode`、默认 split、SVG 预览与原面板呈现保持同一实现，
没有新偏好存储、合同、权限或后端写接口。

影响面是两端外观设置、原桌面线程及 Web ChannelPane / ChannelThreadPane。
Web 现有面板此前固定 `isFocusMode: false`，本批真正消费原设备选择，而非
只增加设置按钮。窄屏仍消费原 auxiliary overlay 判据，不引入另一断点。
切换 focus / split 使用相同组件位置和回复子树，不重建原未决回复意图；
打开作者资料隐藏线程时不让隐藏线程处理 Escape 或夺回资料面板焦点。
原成员、scope、流撤权和发布回执判断完全沿既有调用，不借设置获得读取权限。
空或非法设备偏好维持上游 split 行为，持久化拒绝保留原内存选择；这些 UI
偏好不替代业务准入。消息、回复正文与用量权威未改变。

实现后首次 shared tsc 指出提取后的 cn 路径和严格数组索引问题，精确修正后
共享源码/测试 tsc 与 Web tsc 通过，共享 settings 21 项通过。Web 外观用例
触发原 5 秒超时，其余 5 项通过；ChannelThreadPane 的 worker 启动超时，
该串行命令退出 1，不将它计为两端行为全通过。日志为同 Data 目录中的
`thread-layout-shared.log`、`thread-layout-restored.log`。

SDK 私有副本断开原控件 `onValueChange` 后，新实际消费者用例真实失败：
预期 focus、实际 split，退出 1（`thread-layout-mutation.log`）。从正式源
原字节还原并 cmp 0 后，该用例通过（`thread-layout-final.log`）。未改变
测试超时、安装依赖或运行 full / 镜像构建；此阶段不声明已部署。

随后同一串行命令的 Desktop tsc 退出 0，Web ChannelRead 在 worker 启动前
60 秒超时、零用例执行，整体退出 1；不能将它计为 Web UNKNOWN 行为通过。
交叉复核确认 inactive drawer 内层 flex 会影响原分栏宽度，现三层包装均为
contents，保持回复子树而不增加布局盒；focus 消费原 getThreadPanelLayout
的单面板宽度，split 继续原拖拽宽度。频道返回文案来自 PlatformApp 与
InboxDrafts 已有准入查询的 channel.data.name，不新增目录查询或假名称。
对应原 ChannelRead 用例已补实际拖拽、focus/split 宽度、真实频道名和同一
UNKNOWN 输入节点/幂等键断言。该最后增量的验证单独记录，不借前轮通过。

最后精确输入同步到原受限 SDK；两宿主各自的已锁定依赖树消费本批共享源码
副本，没有重装或改变依赖链接。串行 shared `tsc --noEmit`、shared
`tsc --noEmit -p tsconfig.test.json`、Web `tsc --noEmit`、Desktop
`tsc --noEmit` 全部完成，组合命令退出 0（session 49329；成功无诊断，
`thread-layout-reviewed-types.log` 为空）。此时未再次启动 Web worker；
最终宽度/拖拽/UNKNOWN Web 行为用例仍未验收，不用静态检查替代。
日志绝对目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/projects-directory.wiWDv3/`。
源码和上述证据仅供合并，未构建、发布或部署，不代表原设置全功能完成。
