# ONLYOFFICE 文档协作集成设计

本文只定义 Cells 文件在承载 WebView 运行时的两端（Buzz Web、Buzz Desktop）中通过 ONLYOFFICE 查看、编辑和协作的协议边界。Buzz Mobile 不承载 editor surface，按 REQ-07/21 只提供受权只读视图，本文的 launch/iframe/postMessage 约束对它不适用。实体以 `03` 为准，组件合同以 `07` 为准，八维治理以 `05` 为准。

## 1. 固定结论

`DERIVED_DESIGN DD-30/31/32`：ONLYOFFICE 是作用于 `cells_drive_space` 的 Capability Component，不是文件仓库、ResourceType 或第二资产目录。文件字节、node UUID 和版本仍由 Cells 权威；DocumentServer 只运行 WOPI client 与协同编辑会话。

一期编辑协议唯一采用原生 WOPI：DocumentServer 通过 Cells 的 CheckFileInfo、GetFile、PutFile 直接读写文件。平台不再建立普通 Docs API `document.url + callbackUrl`、session-read、callback result 下载和二次 Cells PutFile 桥。

这一结论来自两端现有源码：Cells 已注册三条最小 WOPI file route 并提供 document PAT；DocumentServer 已提供 discovery、WOPI editor POST route、官方 editor page 和 WOPI PutFile（SF-CEL-05/07、SF-OFF-03）。Cells 当前命名的 `EditorProvider` 仍只有 Collabora，故不能声称上游已有名为 ONLYOFFICE 的 provider；本设计复用的是其通用 WOPI host（SF-CEL-04）。

## 2. 权威边界

| 事实 | 权威 | 平台保留的引用 |
|---|---|---|
| 文件目录、字节、node、版本链、mtime | Cells | FileReference、base/result revision |
| WOPI 协同会话与编辑缓存 | DocumentServer | DocumentSession、WOPI session/correlation evidence |
| Tenant、Workspace、owner、业务授权、审批 | Platform Core + SpiceDB + Temporal | ActionDecision、Approval/Workflow ref |
| Quota、usage、cost、billing | OpenMeter | reservation/usage refs |
| 主题、语言和页面壳 | 承载端（Web/Desktop） | FrontendPresentationContext、session launch 快照 |

DocumentServer 不保存平台 owner、Tenant 或 Workspace。DocumentSession 不是 Resource/Asset，不建立 owner；它始终引用一个 Cells Resource 或已提升的 File Asset（DD-32）。

## 3. 组件边界

```text
承载端 OfficeDocumentSurface
  └─ WOPI launch form + fixed-origin iframe

Platform Core/BFF
  ├─ FileReference resolution
  ├─ Action admission / DocumentSession
  └─ WOPI discovery action selection + launch descriptor

Cells（文件权威 + WOPI host）
  ├─ /auth/token/document
  └─ /wopi/files/{uuid}
       ├─ CheckFileInfo
       ├─ GetFile
       └─ PutFile

ONLYOFFICE DocumentServer（WOPI client）
  ├─ /hosting/discovery
  └─ POST /hosting/wopi/{documentType}/{view|edit}
       └─ official editor-wopi page → DocsAPI.DocEditor
```

Core/BFF 不转发文件字节，不接收保存 callback，不组装普通 Docs API config。Cells WOPI host 不建立第二份平台授权数据库；其窄治理适配只把当前平台 admission 投影到已有 token、auth、FileInfo builder 和 PutFile 接缝（SS-CEL-WOPI）。DocumentServer 只在 WOPI page 与服务端 `authRestore` 的两个现有镜像 permissions 对象补齐 copy/download 投影（SS-OFF-WOPI），不形成新的后端服务。

## 4. WOPI launch 合同

```text
WopiLaunchDescriptor(
  document_session_id,
  action_url,
  method[POST],
  target_origin,
  form_fields[access_token, access_token_ttl],
  wopi_source,
  mode[VIEW|EDIT],
  launch_theme[LIGHT|DARK],
  launch_locale[EN|ZH_CN],
  expires_at
)
```

固定交互为：

```text
FileReference
→ Core 解析 Tenant/Workspace/Cells binding/Resource 或 Asset
→ fresh read/update Check + quota/capacity/admission
→ DocumentSession
→ Core 以 Cells INSTANCE_SERVICE 调 /auth/token/document(Path, ClientID=DocumentSession.id)
→ 从 active Tenant DocumentServer discovery 选择 file extension + mode action
→ action query 固定 wopisrc + usid + thm + ui/lang + dchat
→ 承载端以 POST form 在固定 origin iframe 打开 action_url
   （前置：Web 边缘 CSP 的 frame-src/form-action 已包含该 origin，SF-WEB-06、DD-30）
→ DocumentServer CheckFileInfo → GetFile → editor → PutFile
→ Cells save evidence + NodeVersions → DocumentSession result_revision
```

约束：

- `wopi_source` 只允许 active Cells binding 的 `/wopi/files/{node_uuid}`，不能由浏览器提供任意 URL。
- `usid=DocumentSession.id`。DocumentServer 将它设为 user session，并在 WOPI 请求中发送 `X-WOPI-SessionId`；每次请求另带 `X-WOPI-CorrelationId`（SF-OFF-07）。
- action URL 从 fixed-origin discovery 的 extension/mode action 解析，不以用户字符串选择 DocumentServer host（SF-OFF-03）。
- standard WOPI POST 决定浏览器必须携带 node-scoped `access_token`。设计不虚构“token 从不进入浏览器”；它只能存在于当次 form POST，禁止进入 Buzz event、URL query、Audit 正文或持久前端状态。
- VIEW 检查 `read`，EDIT 检查 `update`。requested EDIT 在 admission 或 Cells CheckFileInfo 任一层不满足时只能收窄为 VIEW，不能扩大。
- FileReference revision 不可忽略：历史 revision 只允许 VIEW；EDIT admission 要求该 revision 在 fresh NodeVersions 中仍为 head。任何入口都不能把固定审批/citation revision 静默换成 latest。

## 5. Cells 的窄 WOPI 治理适配

`SS-CEL-WOPI` 只承载以下四项协议增强；没有文件桥服务。

### 5.1 Session token 与撤权

Cells 当前 `DocumentAccessTokenRequest.ClientID` 未被 handler 使用；PAT user 取当前 Cells request claims，`r/rw` 仅按 node readonly 决定，而内部 PAT 已有 `RevocationKey`、expiry 与按 revocation key 撤销能力（SF-CEL-07/11）。因此直接以 Core service credential 调用会错误地把服务身份投影成 editor user，也不能表达平台 `update` 决策。合同固定为：

- `/auth/token/document` 只接受已认证 Core INSTANCE_SERVICE；`ClientID` 必须解析到同 Tenant/binding/node 的 active DocumentSession。Cells 从该 session 的 fresh Core PEP 结果取得 Platform Human ID/display name 与 admitted mode，不信任 Browser 字段，也不沿用 Core service claims 作为 editor user。
- Cells 把 `ClientID` 写入 PAT `RevocationKey`，把已解析 Platform Human 投影为 PAT user；VIEW 只生成 `r`，只有 fresh `update` 允许且 node 可写的 EDIT 才生成 `rw`。
- session 已确认正常结束、到期或撤权时按 `DocumentSession.id` 撤销；iframe `UI_Close` 本身不证明服务端保存/会话终结，dirty 或 save outcome 未明时保留至受控 expiry/reconcile，避免截断 DocumentServer 的最终 PutFile。新 Check/Get/Put 由现有 JWT verifier 与 WOPI PEP 共同拒绝。
- token 生命周期不超过 DocumentSession；不使用默认滑动刷新把 session 延长到平台 expiry 之后。

### 5.2 每请求授权

现有 `gateway/wopi/handler.go::auth` 是所有三条 route 的共同入口（SF-CEL-05、SS-CEL-WOPI）。适配后它在既有 JWT 校验之外增加两件事：按 URL 中的 node UUID 校验 PAT 的 node scope（固定源码从不做此校验，SF-CEL-12），以及按 `X-WOPI-SessionId` 解析 DocumentSession 并以受认证的 Cells→Core PEP 调用对同一 Tenant、Workspace、binding、node、actor 做 fresh Check。

Cells→Core 是 `09` ServicePrincipal 表中的一条独立边，方向与 Core→Cells 相反，必须单独登记：调用方身份为该 Tenant binding 的 Cells INSTANCE_SERVICE（凭据按 DD-70/71 托管），audience 固定为 Core 的 WOPI PEP 受众；请求体固定 `{document_session_id, node_uuid, wopi_operation, binding_id}`，响应固定 `{decision, platform_human_id, display_name, admitted_mode, min_zed_token}`。该调用继承父 operation，不新建 Action/Workflow/Quota（`01` 的既有动作内 RPC 规则）。PEP 不可达或超时一律拒绝，不回退到 token-only 判定：

| WOPI operation | 平台 permission |
|---|---|
| CheckFileInfo | `read`；请求 edit 时同时检查 `update` |
| GetFile | `read` |
| PutFile | `update` |

Cells 当前 WOPI auth 只校验 query access token 的 JWT 签名与非空 `claims.Name`（SF-CEL-05/12）；PAT 中的 `node:<uuid>:r|rw` scope 在固定源码中**从不被任何 handler 读取**，为节点 A 签发的 PAT 能通过节点 B 的 WOPI 路径。因此"按 node 收窄"本身就是 SS-CEL-WOPI 必须新增的内容，不是既有行为；在该适配闭合前，document PAT 只能视为"证明调用方是某个已认证会话"，既不代替 SpiceDB permission，也不代替 node 绑定。Core→Cells 与 Cells→Core service credential 按 DD-70/71 托管于 OpenBao 并经 Agent template 投递；credential 投影未对账前 Office surface 不得 active。session、token scope、node 或 binding 任一不一致即拒绝，不能回退默认 Tenant/Workspace。

上述 PEP、PAT node scope 与 `update` 检查必须在 `uploadStream` 读取请求体或调用 Cells writer 之前全部完成。固定源码的 `uploadStream` 自身没有授权检查且会产生部分写入；任何把 PEP 放到写流之后的实现都不满足 SS-CEL-WOPI（SF-CEL-15）。

### 5.3 FileInfo 权限与宿主投影

`SetFileInfoResponseBuilder` 是现成映射接缝，`FileInfo` 已有 `PostMessageOrigin`/`DisablePrint`/`DisableExport`/`DisableCopy`/`UserCanWrite` 等权限与 origin 字段；但**不含** `EditNotificationPostMessage`、`ClosePostMessage`/`CloseUrl`、`CopyPasteRestrictions`、`SupportsLocks`（SF-CEL-08/13）。dirty 与 close 的 postMessage 只有在 Cells 侧新增前两个字段后才会由 editor page 发出，copy 限制用标准 `CopyPasteRestrictions` 字段比 fork DocumentServer 两处更小——这三项都落在 SS-CEL-WOPI 已有的改动面内。固定映射为：

| 平台结果 | Cells FileInfo |
|---|---|
| 有 `update` 且 node 可写 | `UserCanWrite=true` |
| 无 `update` 或 node readonly | `UserCanWrite=false` |
| 无 `export` | `DisablePrint=true`、`DisableExport=true`、`DisableCopy=true` |
| 承载端 fixed origin | `PostMessageOrigin=<Buzz origin>` |
| 一期关闭 OO chat | launch `dchat=1` |

默认 builder 的 `Version` 当前是 mtime Unix 值，不是 Cells VersionId（SF-CEL-08）。本适配按下述规则把 session 固定 VersionId 投影为 FileInfo Version，供 DocumentServer cache validation；平台 FileReference/result revision 仍只认 NodeVersions 的 VersionId（SF-CEL-06），不从 FileInfo Version 或 LastModifiedTime反推平台 revision。

当前 WOPI Check/Get 默认只读 head，而 Cells 底层 `GetObject` 已支持 `GetRequestData.VersionId` 与版本存储（SF-CEL-10）。同一 Cells WOPI 接缝固定执行：

- 从已校验的 DocumentSession 取得 `base_revision`，不从 query/body 接受 revision；
- CheckFileInfo 以对应 Version 的 `VersionId/Size/MTime` 形成 session-stable `Version/Size/LastModifiedTime`，VIEW 历史版本固定 `UserCanWrite=false`；
- GetFile 调 Cells 自身 `GetObject(..., VersionId=base_revision)`，不经 Platform 转发，也不使用 latest；
- EDIT launch 前 fresh 确认 `base_revision` 是 head，若已变化则不打开可写 surface并进入 `CONFLICT`；
- PutFile 仅存在于 admitted EDIT session，保存后以 NodeVersions 得到新的 `result_revision`。

### 5.4 PutFile 兼容与 evidence

DocumentServer 发送 `X-LOOL-WOPI-Timestamp`，Cells 当前只读 `X-COOL-WOPI-Timestamp`（SF-CEL-09）。因此直接组合的 timestamp conflict protection不成立。Cells WOPI 接缝固定同时接受这两个 header；比较对象是 PutFile 当时的活动 head mtime，不是 session `base_revision`。FileInfo 与 PutFile 响应都以 UTC RFC3339 秒粒度往返，不把更高精度静默带入比较。

DocumentServer 只在恢复出的 `wopiParams.LastModifiedTime` 非空时发送 header，该值靠 PutFile 响应生成的 modified marker 刷新（SF-OFF-09）。Office surface 只有在这条 marker→callback→next PutFile 链已对账时才启用 timestamp header；否则第一次保存后的后续自动保存会持续用旧值并进入 409。该 check+write 仍不是原子 CAS。

PutFile 接缝同时记录 `X-WOPI-SessionId`、`X-WOPI-CorrelationId`、`X-WOPI-Editors`、node UUID、base mtime、write result 和 bytes。PutFile 200 只返回 LastModifiedTime，故 `SAVED` 还要由 Cells NodeVersions 观察新 head VersionId。500 且已写入字节大于零固定进入 `UNKNOWN` 并强制以 NodeVersions 对账，不当作干净失败；零字节拒绝、timestamp 409 与其它结果分别按明确 evidence 收敛（SF-CEL-06/07/15）。

### 5.5 DocumentServer export 权限投影

固定源码直接组合只能正确消费 Cells 的 print 限制，不能闭合 copy/download：DocumentServer WOPI page 与服务端 token 恢复路径都读取 `CopyPasteRestrictions` 而 Cells 输出 `DisableCopy`，且两处均未设置默认 true 的 `permissions.download`（SF-OFF-08）。`SS-OFF-WOPI` 的唯一合同是：

| Cells FileInfo | Docs API permissions |
|---|---|
| `DisableCopy=true` | `copy=false` |
| `DisableExport=true` 或 `HideExportOption=true` | `download=false` |
| `DisablePrint=true` 或 `HidePrintOption=true` | `print=false`（保留现有映射） |

这一步只在官方 WOPI page 与服务端 `authRestore` 已有的镜像 permissions 对象中以同一规则完成，不增加 endpoint、token、callback 或文件流。未经此映射，缺少 `export` 的 FileReference 不允许激活 Office surface，不能只靠隐藏 Buzz 外层按钮假装授权成立。

## 6. 承载端 surface 与前端一致性

`OfficeDocumentSurface` 是承载端随构建内置的 source-bound surface，Buzz Web 与 Buzz Desktop 共用同一实现（SF-MOB-02 所述的 TypeScript 代码库）。它只消费 WopiLaunchDescriptor，以固定 target iframe 提交 form；真正的 `DocsAPI.DocEditor` 由 DocumentServer 官方 WOPI page 创建（SF-OFF-03），Buzz 不加载普通 Docs API config。

### 6.1 主题

Buzz `ThemeProvider` 是唯一主题权威。每次 launch 使用 `isDark` 解析值：

| Buzz resolved theme | WOPI query |
|---|---|
| LIGHT | `thm=1` |
| DARK | `thm=2` |

DocumentServer WOPI page 已把二者映射为 `default-light/default-dark`（SF-WEB-03、SF-OFF-07）。`SYSTEM` 只由 Buzz 实时解析，绝不下发第三种 editor theme。

DocumentServer 源码只证明 launch query 映射，没有证明活跃 WOPI editor 的无损实时换肤。因此当前 editor 保持 DocumentSession 的 launch theme；宿主 chrome 立即跟随 Buzz，并显示本地化的“编辑器主题将在安全重开后同步”状态。READ_ONLY 或已有确定 SAVED 且之后无 dirty evidence 的 session 可经 fresh admission 重开；DIRTY/UNKNOWN 时只允许用户先保存/关闭，不静默 reload。下一次 launch 必须采用新的 resolved theme。

### 6.2 i18n

Buzz `AppLocale` 是唯一语言集合。一期固定映射：

| Buzz locale | WOPI `ui/lang` | HTML `lang` |
|---|---|---|
| EN | `en-US` | `en` |
| ZH_CN | `zh-CN` | `zh-CN` |

DocumentServer WOPI page以 `lang || ui || en-US` 设置 editor locale（SF-OFF-07）。Buzz 文件卡片、loading、错误、只读提示、冲突和重开提示全部使用 Buzz `MessageKey/t`，不使用 DocumentServer 文案替代平台状态。editor 内部文案由 DocumentServer 对应 locale 负责。

### 6.3 消息与 origin

WOPI page 能以 `PostMessageOrigin` 限制父窗消息，缺失时退回 `*`（SF-OFF-07）；Cells FileInfo 必须投影固定 Buzz origin，Platform 不接受 wildcard。页面只把 loading、dirty、close 等消息当 UI evidence，不能把它们当 permission、usage 或保存终态。

## 7. 业务入口复用

| 入口 | FileReference 规则 | 打开规则 |
|---|---|---|
| Cells 云盘 | 当前选择的确定 revision | VIEW/EDIT 依 fresh permission |
| Channel/Thread 文件卡片 | event 只存稳定 FileReference | 点击时重新解析与检查 |
| 审批附件 | 参数固定 revision | 默认 VIEW，不静默换 latest |
| 任务产物 | 产物记录固定 revision | 依产物 Resource/Asset permission |
| WeKnora citation | 从受权 Knowledge.Metadata 重建 source FileReference | 默认 VIEW |
| Audit/操作时间线 | evidence 中的固定 revision | 只对具备 `read` 的用户开放 |

所有入口复用同一个 OfficeDocumentSurface。Buzz event、审批、任务和 citation 不存 access token、action URL、iframe config 或 DocumentServer cache key。

## 8. 八维贯穿

| 维度 | ONLYOFFICE/Cells WOPI 合同 |
|---|---|
| Tenant | FileReference、DocumentSession、dedicated DocumentServer binding 与 Cells binding 同 Tenant；WOPI body/query 不自报 scope |
| Workspace | 从 FileReference Resource/home Workspace 与当前 session解析；Channel tag 不授予文件权限 |
| Authorization | launch 先 admission；Check/Get/Put 再由 Cells WOPI PEP fresh Check；PAT 只作协议认证 |
| Approval | 普通 view/edit 为 `NONE`；share/export、冲突处置、owner 变更按目标 Cells ActionDefinition；批准固定 revision/parameter hash |
| Workflow | 正常 WOPI open/save 为 `PROTOCOL`；审批、跨请求转换和 UNKNOWN reconcile 进入 Temporal |
| Capacity/Quota/Billing | DocumentServer memory guard 是 `NATIVE` capacity；Cells read/write/export bytes/op 与登记的转换 usage 进入 OpenMeter；UI message 不计费 |
| Operation Audit | 记录 operation/session、actor、FileReference、permission、WOPI operation/correlation、Cells base/result revision、bytes 与 outcome；不记录 token、正文、光标流 |
| Business Observability | operation→DocumentSession→WOPI request evidence→Cells revision→OpenMeter；显示 opening/read-only/dirty/saved/conflict/revoked/unknown/failed，不从 iframe close 猜终态 |

主题与 i18n 不是新的后端治理门禁，而是贯穿所有 Web surface 的 FrontendPresentationContract：ONLYOFFICE 固定 `LAUNCH_MAPPED + theme/locale NEXT_LAUNCH`，其他业务/管理页面固定 `BUZZ_NATIVE + theme LIVE + locale BROWSER_RESOLVED`。主题偏好是设备本地，locale 由浏览器解析；editor 内文案由 DocumentServer 的 launch locale 负责，文件名/正文保持原文（DD-36/53）。

## 9. 撤权、失败与容量边界

- 撤销 `read/update` 后停止新 launch，按 DocumentSession revocation key 撤销 PAT，后续 Check/Get/Put fresh reject；已经渲染的像素、截图和人的记忆无法追回。
- DocumentServer 不可用时，Cells 下载和版本管理仍可用；Office surface 显示不可用，不切换到未登记外部编辑器。
- 当前开源运行路径没有固定 20 用户 gate；不二开删除不存在的限制。memory guard 是 native 安全保护，不删除、不冒充平台商业 Quota（SF-OFF-04、DD-34）。
- DocumentServer 缺少 `SupportsLocks` 时会跳过 LOCK/UNLOCK 而继续 PutFile（SF-OFF-03）；设计不虚构 WOPI lock，也不把 timestamp check 描述为原子并发控制。
- Buzz 是聊天权威，launch 固定关闭 ONLYOFFICE chat；AgentGateway 是标准 LLM 权威，ONLYOFFICE AI、宏和任意插件不进入一期（DD-35）。

## 10. 可行性与上游差异边界

源码结论拆分为确定的两层：DocumentServer↔Cells WOPI discovery/Check/Get/Put 主链是 `UPSTREAM_SUPPORTED`；默认 Cells document PAT 不读取 ClientID、user 取 Cells request claims、`r/rw` 只看 node readonly（SF-CEL-11）。因此 Buzz surface、Platform Human/DocumentSession/PAT/fresh PEP、FileInfo/fixed revision/PutFile header/evidence 与 DocumentServer WOPI page/`authRestore` copy/download 映射是 `ADAPTER_REQUIRED`，精确接缝为 SS-CEL-WOPI/SS-OFF-WOPI，没有自制文件桥。生产 credential 按 DD-70/71 托管与投递；Approval、UNKNOWN reconcile 或持久转换由 DD-69 的 Application Worker 承接（`DESIGN_DEFINED`）。

DocumentServer 的固定部署不变式是：WOPI 目标 Cells host 必须被 `services.CoAuthoring.ipfilter.rules` 精确允许，不使用默认 `*` allow-all；`useforrequest`、`externalRequest.directIfIn.jwtToken`、`externalRequest.action.blockPrivateIP` 与 `request-filtering-agent.allowPrivateIPAddress` 的实际组合必须登记进 binding config digest。原因是 JWT 内 URL 会走 direct path，默认私网过滤 agent 不构成 WOPI SSRF 边界（SF-OFF-10）。不满足该不变式时 Office binding 不得 `ACTIVE`。

`.references` 中以下源码发生差异时，重验本设计引用的事实与决策：

- Cells `GenerateDocumentAccessToken`、PAT revoke、WOPI auth/FileInfo/PutFile、NodeVersions；
- DocumentServer discovery、WOPI editor route、standard headers、PutFile、modified marker、editor-wopi permissions/theme/locale/postMessage；
- DocumentServer `services.CoAuthoring.ipfilter`、`externalRequest.directIfIn`、`externalRequest.action.blockPrivateIP` 与 `request-filtering-agent`；
- 承载端 ThemeProvider、globals.css、AppLocale/messages/t、route/navigation/FileReference rendering。

普通 Docs API callback 源码事实 SF-OFF-01/02/05/06 继续保留作对比证据，但不进入一期运行链。
