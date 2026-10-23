# Cells 原生页内的 ONLYOFFICE 编辑（DD-132 A 期）

本记录覆盖 DD-132(2)(3)(4)，对应场景 V-SCN-186 至 V-SCN-189。这里只有源码与测试证据，部署实例上的验收另行记录。

## 1. 链路与授权

1. 原生插件 `frontend/assets/editor.onlyoffice` 打开文件时，先以本人原生 JWT 请求 `GET /a/n/node/{uuid}?Flags=WithEditorURLs`。
2. 服务端 provider（`gateway/restv2/editor-onlyoffice.go`，即 SF-CEL-04 的 `EditorProvider`、SS-CEL-EDITOR）从 DocumentServer discovery 中，按扩展名和 node 是否可写选出唯一的 `/hosting/wopi/{type}/{view|edit}` action。
   - discovery 只从配置的 DocumentServer 公网 origin 读取，不跟随重定向，结果缓存 5 分钟，失败 30 秒后重试。
   - urlsrc 只接受 DocumentServer 自己写入的占位符集合，规则与受治理 adapter 的 `document-launch.mjs` 相同。
   - action 的 origin 与路径都固定，query 只允许 `ui`、`lang`、`thm`、`dchat`、`wopisrc`、`usid`。
   - 返回的 URL 不含任何令牌，provider 也从不签发 PAT。
3. 页面用原生 `/a/auth/token/document` 取得 document PAT。`r`/`rw` 由用户 ACL 与 node readonly 决定（SF-CEL-07/11）。
4. 页面以标准 WOPI form POST 把 action 提交到本页 iframe。form 中有 `access_token`、`access_token_ttl=0`，以及固定的 `docs_api_config={"editorConfig":{"customization":{"macros":false,"plugins":false}}}`（SF-OFF-11）。PAT 只出现在这个请求体里，提交后即从组件状态中删除。
5. DocumentServer 回调 Cells WOPI 时，`auth` 先校验 PAT 只有一个节点范围、与 URL 中的节点一致，且只有 `rw` 允许 POST（SS-CEL-WOPI 已有）。之后原 handler 再按 Cells router ACL 读写。
6. 原生 CheckFileInfo（`gateway/wopi/native-editor.go`）有两条约束：
   - `UserCanWrite` 必须同时满足 node 可写与 PAT 为 `rw`；
   - `PostMessageOrigin` 固定为 Cells 站点 origin（`routing.GetDefaultSiteURL`）。取不到合法 origin 就以 403 拒绝，因为留空会让 DocumentServer 页面退回 `*`（SF-OFF-07）。
7. 插件配置了 `KAILO_DOCUMENT_BINDING` 时：
   - provider 不再提供原生 action，页面也不签发原生 PAT；
   - 页面改为显示与 `editor.libreoffice` 相同的“在 Kailo 中查看/编辑”入口（DD-132(4)）。

本期 Kailo 侧没有 ProtocolSession、平台 Action、Audit 或 usage，Kailo 不经手文件字节或令牌。

## 2. 声明式配置

`deploy/reconcile.py` 在每次部署时执行以下步骤，并逐项回读：

- 关闭 `editor.libreoffice`（Collabora），其余参数保留。
- 配置了 `CELLS_ONLYOFFICE_PUBLIC_ORIGIN` 时：
  1. 先读取该 DocumentServer 的 discovery，要求所有 action 都在其 origin 上，且列出的每个扩展名都有 view 或 edit action；
  2. 满足后再启用 `editor.onlyoffice`，写入 `ONLYOFFICE_PUBLIC_ORIGIN`、`ONLYOFFICE_WOPI_SOURCE_ORIGIN`（即 `CELLS_EXTERNAL`）和 `ONLYOFFICE_EXTENSIONS`。
- 未配置该 origin 时，声明 `editor.onlyoffice` 为关闭。
- 不写入 `KAILO_DOCUMENT_BINDING`。
- 结果写进 binding facts 的 `documentEditor` 字段。

## 3. 测试（CI 节点，固定 GitHub 提交）

Go 测试在 `golang:1.26.8-alpine@sha256:8ac98ca5…` 中运行，设置 `CGO_ENABLED=0`、`GOFLAGS=-mod=readonly`、`TZ=Europe/Paris`。原有的 `TestFileInfo` 断言本地时区为 +01:00，所以需要这个时区。

- `gofmt -l` 无输出，`go vet ./gateway/restv2/ ./gateway/wopi/ ./frontend/rest/` 通过。
- `go test` 三个包全部 ok。新增用例：
  - `TestOnlyofficeSettingsFromConfig`：禁用、受治理 binding、非显式 origin、扩展名不合法或重复时都拒绝；
  - `TestOnlyofficeProviderSelectsDiscoveryAction`：可写节点得到 edit action，只读节点与只能查看的扩展名得到 view，URL 不含令牌；
  - `TestOnlyofficeProviderRefusesForeignTemplates`：外部 origin、未知占位符、额外参数、其他路径都拒绝；
  - `TestParseOnlyofficeDiscoveryForms`、`TestOnlyofficeDiscoveryCache`、`TestOnlyofficeUILocale`；
  - `TestApplyNativeEditorFacts`：`r` PAT 或只读 node 时不可写，origin 规范化，缺 origin 或范围异常时拒绝。
- 前端在 `node:22-alpine@sha256:0a7108bf…` 中运行：`pnpm install --frozen-lockfile` 通过（新增的 importer 与 lock 一致），webpack 产出 `PydioOnlyOffice.min.js`，`vitest run editor.onlyoffice` 4 项通过（宏与插件关闭、locale 映射、action 校验）。
- `deploy/test_reconcile.py` 13 项全部通过。新增 `test_onlyoffice_is_enabled_after_its_discovery_is_read_back`、`test_onlyoffice_is_not_enabled_when_its_discovery_does_not_serve_it`，并扩展了设置校验与首装回读。

## 4. 一体化呈现（DD-132(7)、DD-133）

- 插件把 `window.KailoEmbed`（Cells 页装载的 DD-133 运行时）作为 launch 的来源：收到 Kailo 宿主值后，`thm=1/2` 与 `ui`/`lang`（`zh-CN`/`en-US`）取 Kailo 的明暗与语言；没有宿主时语言取 Cells 用户偏好，主题取编辑器默认。
- 编辑器打开后，Kailo 切换明暗时，插件向编辑器页发送 WOPI 宿主消息 `Kailo_Presentation`（`targetOrigin` 为编辑器 origin）。编辑器页只接受 `PostMessageOrigin` 来的消息，写入同源的主题选择，编辑器框架即时换成 `theme-kailo-light` 或 `theme-kailo-dark`。语言在下一次打开时生效。
- 插件在编辑器下方常驻“开源许可与法律声明”入口，打开实例的 `/kailo-legal/`。
- 插件的名称与设置标签不含上游名称：中文为“文档编辑器”，英文为 “Document editor”。
- 编辑器页把 CheckFileInfo `UserFriendlyName` 作为显示名，把 `UserExtraInfo.avatar` 作为头像。合并 main（2b054bbf）后，Cells 的 FileInfo 按 DD-133 §4.7.3 填入二者（`gateway/wopi/fileinfo-builder.go`）：显示名取 Kailo 资料的 `name`，`UserExtraInfo.avatar` 取 OIDC `picture` 地址（只接受原生 OIDC 头像地址，不传二进制）；没有资料时显示名退回 Cells 账号显示名，编辑器显示首字母头像。`TestFileInfoKailoIdentity` 覆盖这一行为。
- vitest 8 项通过，新增 4 项：宿主值决定主题和语言、`thm` 映射、宿主消息格式、法律声明链接。

## 5. 生产验收（2026-10-23，Web 侧栏云盘原生页）

部署：Cells `file-storage-service@sha256:b3cedac7…`（binding `2dfc7e41…`），DocumentServer
`document-editor@sha256:ccd6d812…`（`http://192.168.0.193:58096`，回执
`/volumes/data/kailo/components/document-editor/receipts/deploy-20261023T0312Z-a854ab98.json`）。
脚本与原始输出在 CI 节点 `~/kailo-acceptance/dd132-oo/`：`scripts/oo-acc.mjs`、`oo-187.mjs`、
`listener.py`；输出 `out/r1/{qa1-light-zh,qa2-dark-en,qa3-light-zh,v187b}/`，崩溃证据
`out/prod-crash/`。PAT 只在内存中使用，输出只有是否存在、状态码与日志命中数。

**生产原样**：在 Cells 中打开 docx 时整页崩溃（“Oops, something went wrong”），控制台
`getInstance(...).getMessages is not a function`（`PydioOnlyOffice.min.js` render）。因此 V-SCN-186
在生产上**失败**。修复见 `fix/onlyoffice-cells-messages` `aa13105b`（`Pydio.getMessages()`，
`editor.libreoffice` 同样问题）。其后各项在浏览器内替换两处已推送修复（插件 render、Kailo 头部根路径）
后执行，生产字节未改动，结论记为“模拟修复下通过”，不等同于生产通过。

| 场景 | 结论 | 证据 |
|---|---|---|
| V-SCN-186 编辑保存 | 生产失败；模拟修复下通过（版本项失败） | 服务端 action `/hosting/wopi/word/edit`，URL 不含令牌；form 只含 `access_token`、`access_token_ttl=0`、`docs_api_config={"editorConfig":{"customization":{"macros":false,"plugins":false}}}`；编辑、Ctrl+S、关闭后节点 2089 → 25612 字节、Modified 更新，再次打开 GetFile 内容含新段落（qa-1/2/3）；Cells/DocumentServer 容器日志 PAT 命中 0；Kailo 审计无新事件。`/v2/n/node/{uuid}/versions` 返回空：personal-files 数据源未出现 VersionId，设计要求的新 VersionId **未满足** |
| V-SCN-187 只读/无权/跨节点 | 模拟修复下通过 | qa-2（共享空间只读）：action `view`、`UserCanWrite=false`、编辑器 `isEdit=false`，PutFile 403；把 action 改成 `edit` 并用同一 r PAT 提交仍为只读，PutFile 403；qa-3：`/v2/n/node` 403、文档令牌 404 未签发；节点 A 的 PAT 用于节点 B：CheckFileInfo 403、GetFile 403 |
| V-SCN-188 出站拒绝 | 通过 | 同主机其他端口监听器先由 DocumentServer 容器网络正向连通（对照命中 1）；随后 `wopisrc` 指向其他主机（“Access forbidden”）、Cells 主机其他端口、Cells 其他路径时编辑器均拒绝加载，外链图片文档已打开；监听器业务请求命中 0。回执登记 `directIfIn.allowList=[…58092/wopi/files/]`、`action.allow=false`、ipfilter、镜像 digest |
| V-SCN-189 三层嵌入 | Web 通过；Desktop 未验 | Kailo→Cells→DocumentServer 正常加载；编辑页 CSP `frame-ancestors 'self' http://192.168.0.193:58092 http://192.168.0.193:58090`；未登记 origin（58198）嵌入被浏览器拒绝；CheckFileInfo `PostMessageOrigin=http://192.168.0.193:58092`。Desktop 仍为 `BLOCKED: GAP-DSK-EDITOR-01` |
| V-SCN-190 产物与呈现 | 部分通过 | 运行中：插件页签、chat、about、support 不可见，`macros/plugins=false`，`/plugins.json` 空，`/`、`/ai-proxy/`、`/sdkjs-plugins/`、`/welcome/`、`/example/` 均 404，编辑器可见文本无上游品牌，标题 `… - Kailo`，主题 `theme-kailo-light/dark` 且随 Kailo 在线切换，外壳字体 `"Inter Variable", Inter, …`，头像取 Kailo 头像路由；`/kailo-legal/` 200，AGPL 与源码地址 `tree/a854ab98…/document-editor`。未完成：`document-editor/fork/upstream.yaml` 的 `artifact_digest` 仍为 `none`（未回填 `ccd6d812`），镜像内文件清单因 CI 节点磁盘写回阻塞未能 `docker exec` 复核 |

同屏对照截图：`out/r1/qa1-light-zh/oo-kailo-qa-1-light-0{1..5}-*.png`（浅色中文）、
`out/r1/qa2-dark-en/oo-kailo-qa-2-dark-0{1..5}-*.png`（深色英文）、`*-legal.png`、`*-unregistered-host.png`。
编辑器显示名为 CheckFileInfo `UserFriendlyName`（IdP `name`），与 Kailo 显示名不一致；头像路由 404（见
`native-identity.md` 2026-10-23 一节）。
