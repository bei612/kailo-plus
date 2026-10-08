# Cells 原生 revision 查询接缝

## Cells / WeKnora 原生错误映射真实协议消费者（2026-10-08）

本批在两个正在交付的原 Adapter HTTP 服务中实现
`POST /platform-adapter/v1/map_native_status_error`，不是另起模拟服务器或固定成功回执。
共享实现只放在已有 `client-kit/adapter/protocol.mjs`，由两个实际服务消费。
请求沿原泛型协议 JSON 参数携带 `idempotencyKey`、`nativeStatus` 及可选
`nativeError`；前者必须与 HTTP 原键相同，参数必须为 canonical JSON，重复键及未知顶层字段拒绝。
输出为原 `ErrorBody` 的 `class/reason`，没有新增契约字段、平台实体或持久状态。

实现后的四步结论：

1. 权威：`.design/07` §5 的 `map_native_status_error(native status/error)`、§8A 的
   错误分类/redaction，与 `06-工程基线规范.md` §4、`contracts/domain/error.schema.json`
   及既有六类/reason 枚举决定本批语义；此处不把错误映射当成终态或接入审批。
   固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `common/errors/errors.go::StatusForbidden/StatusConflict/StatusNotImplemented` 与
   `common/proto/rest/cellsapi-common.pb.go::Error` 保持原生错误权威；固定 WeKnora
   `2be7bd40631dda1dd485306038f07a62e9ee287e` 的
   `internal/errors/errors.go::AppError/NewUnauthorizedError/NewConflictError` 与
   `internal/mcpserver/server.go::Server.guardTool/toolResultFromAgentTool` 决定原生 HTTP/MCP
   错误结构。原错误正文、凭据、SQL、文件内容和 MCP text 不被复制到输出。
2. 影响：原两个 `query-revision.mjs::createAdapter` 新增真实路由；Cells 原
   `verifyToken` 只为该操作要求成对 ResultExposure，接受原有受权 Agent 或带有效策略的
   HUMAN read/list 业务上下文，不借 HUMAN PAT 的 NONE；WeKnora 复用原
   `verifyKnowledgeToken`。两者均保持固定 issuer/audience、tenant/workspace/target、
   operation+arguments hash，以及前后两次原 `freshPep`。管理 NONE 的
   handshake/validate_binding 合同不变，未新增匿名或凭据旁路。三端页面/传输不变。
3. 副作用：映射不调用原生 REST/MCP，不读 native credential，不执行动作，不记第二份
   执行结果。HTTP 401/403 映射 DENIED，501 映射 BLOCKED，400/404/405/412/422 映射
   PRECONDITION，413/429 映射 LIMIT，409/423 映射 CONFLICT；其余及未知值均为
   UNKNOWN/EXTERNAL_RESULT_UNKNOWN。MCP 200 中的 isError/text 不是机器可核验失败终态，
   不按消息猜分类，仍为 UNKNOWN。固定 enum/reason 值来自既有合同，原生错误只是 opaque 参数。
4. 边界：缺签名、scope 漂移、策略缺半、NONE 管理上下文、非 canonical 参数、重复 JSON 键、
   原键不一致均拒绝；披露前撤权仍拒绝，不返回已经算出的分类。超时、上游新状态及不可分类
   结果不渲染成功/失败、不盲目重放。没有新增状态，因此无额外回收器或账本。

实际先核对已有进程、CPU/内存压力及约 29 GiB 可用内存、293 MiB Data 空间，复用
`kailo-agent-receipt-xvkujx` 的 Node SDK 与已有候选依赖：UID/GID 1000:1000，
4 CPU / 8 GiB，实际 cgroup 为 `400000 100000`、`8589934592`、额外 swap `0`。
只投递五个变化源码/检查文件，不构建镜像、安装依赖或复制业务树。
容器内实际命令：

```sh
node --test file-storage/adapter/test/*.test.mjs knowledge/adapter/test/*.test.mjs
```

首次运行 329 项、327 通过、2 失败，真实 HTTP 检查抓到 HUMAN PAT NONE 可误入映射
（200 != 401）；已在原验签处收紧该操作的策略对要求。
最终原全部 Adapter 检查 330 项通过、0 失败，退出 0（1.741 秒）。
仅在私有 SDK 候选把真实 401/403 分类改为 UNKNOWN，再运行原 HTTP 消费检查：
19 项中 14 通过、5 失败（含父级汇总），退出 1，Cells Agent、HUMAN 业务与 WeKnora
路径均报实际分类不符。随后恢复候选，与正式五个源文件逐一 `cmp` 退出 0；
原全部检查再次 330 通过、0 失败，退出 0（1.584 秒）。完整本批 diff 已复核，
`git diff --check` 退出 0。

原件目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/`：

- `cells-knowledge-error-mapping-initial.log` SHA-256 `5fff083b6de27857f7396c3e8cfb6f537b7d94590e2463d9f1a2b27035f562f8`
- `cells-knowledge-error-mapping-final.log` SHA-256 `e15f05d474181186c148c069fa7d7e04e274bfa216e2fe37614aa73df7125573`
- `cells-knowledge-error-mapping-mutation.log` SHA-256 `42a870229f45a4f4d1c743a908fcf980cad255d11ca309d054e262df3daf8995`
- `cells-knowledge-error-mapping-restored.log` SHA-256 `36fdf619af7d631f50a70ad534ecc97085270526f3f51f582c16c01b24fe0e74`

这些是原 Adapter 的隔离 HTTP 消费验收，不等于真实 Core PEP、release 登记或绑定已启用；
Core 原 PEP 的 map 接缝由主线独立修复和验证。本批未部署、未更新安装包，未运行全量
`check.sh --full` 或浏览器截图。Adapter bytes 变更须随新 immutable release 固定 digest；
不能原地改写已批准 release 或将本次窄验当成生产激活。

## 实际原生 UUID 读取的空间投影修复（2026-10-08）

本批从正在运行的二开 Cells 发起原生 REST 只读诊断，不以隔离响应器证明线上结构。
沿既有受控部署文件取得原生地址和安装凭据，在 2 CPU / 2 GiB、只读根文件系统的
Node 容器中建立原生 session；没有输出令牌、创建账号、上传文件或修改业务数据。
`/a/workspace` 返回 200，原生 bootconf 给出的 REST v2 前缀为 `/v2`。
工作区路径读取、UUID 目录列举均返回 200，但真实 `GetByUuid` 的节点没有
`ContextWorkspace.Uuid`；个别子目录仍返回原生 403，未绕过这些拒绝。

实现后的四步结论：

1. 权威：DD-89、SS-CEL-MATERIALIZATION 与 `.design/07` §5.2 要求使用已授权的
   原生 scope 事实。Cells ACL/Workspace 仍为原生业务权威，Core 仍为平台准入权威。
   本批属于既有原生对象读取的接缝适配，不开放 RESOURCE_PROVISION。
2. 影响：固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `common/nodes/uuid/handler-uuid-workspace.go::WorkspaceHandler.updateOutputBranch`
   已通过原 AccessList 把可访问工作区 UUID/slug 写入 `Node.AppearsIn`；
   `common/nodes/uuid/handler-uuid-path.go::externalPathHandler.updateOutputBranch`
   原来只投影第一项的路径，遗漏身份。现在同一第一项同时投影原有 `ws_uuid/ws_slug`，
   由 `gateway/restv2/api.go::Handler.ContextWorkspace` 消费为已有响应字段。
   同一 UUID router 的原生 REST 读取受影响；前端布局、管理面、三端传输和 Mobile
   非组件宿主边界不变。没有新增协议字段或持久状态，无数据迁移或四侧生成。
3. 副作用：不改变工作区选择、不选择另一工作区作为降级、不改 ACL、Bearer 或 PEP。
   先清除输出克隆的旧空间投影（包括 REST 消费的 repository_id 旧别名），
   再只使用原生授权链的当前结果；原节点不修改。
   无可访问工作区或所选 UUID 缺失时不推导身份，严格适配器继续关闭。
   返回字段对旧消费者为加法兼容；没有复制文件正文或另造 scope 权威。
4. 异常：空工作区集合清空外部路径及旧 UUID/slug；多个工作区保持原第一项，
   其身份缺失不跳到下一项。原生拒绝、超时、漂移、撤权和完整统计缺失继续失败。
   当前真实虚拟根为 `DATASOURCE:` 引用，不符合适配器既有 UUID 根约束，未放宽；
   该空间投影不处理目录统计；同轮后续原快路径修复见下一节。

实现后复用 `kailo-cells-native-check-lftow7`，实际 4 CPU / 8 GiB、无额外 swap；
先读取现有进程与约 23 GiB 可用内存，只同步两个文件，不构建镜像或复制全树。
首次窄验实际失败：`Could not create local data dir ... -/.config/pydio/cells`。
随后按原 `common/runtime/dirs.go::ApplicationWorkingDir` 的运行配置接口，把
`CELLS_WORKING_DIR/CELLS_DATA_DIR` 投递到同一 SDK 已有可写 `/tmp`，未改业务实现。
实际命令为容器内
`gofmt -d common/nodes/uuid/handler-uuid-path.go common/nodes/uuid/handler-uuid-path_test.go`
及 `go test -mod=readonly ./common/nodes/uuid -run TestExternalPath -count=1 -v`。
格式差异为空，三项通过，退出 0。实现后检查覆盖当前工作区选择、禁止替换缺失身份、
清空不可访问节点的旧投影及输入不变。

只在私有 SDK 候选删掉 UUID 投影，检查实际报
`external path and native Workspace identity diverged`，两项通过、一项失败，退出 1。
恢复后与正式生产文件 `cmp` 退出 0；同一检查三项通过，退出 0。
原件目录 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/` 的
`cells-workspace-projection-mutation.log`、`cells-workspace-projection-restored.log`
保留负向与恢复结果；证据目录只用于验证，不作为正式源码位置。

该修复尚未发布到原生镜像，没有启用 release/binding、运行生产 adapter 或更新安装包。
原受控目录尚无 adapter config/JWKS/SecretRef 与 Agent socket 的完整投递。
Go 窄验不等于真实平台文件读取、跨服务同步、浏览器或全量 `check.sh --full` 验收。

## 显式原生统计不再被祖先 metadata 快路径短路（2026-10-08）

继续沿相同 DD-89/SS-CEL-MATERIALIZATION 定位真实目录列举。严格适配器的
`service-list.mjs::nativeListing` 原本正确请求 `GetByUuid?Flags=WithMetaDefaults`；
缺统计时必须失败，不能删除独立 ChildrenCount 或拿列举条数冒充完整性。

同一固定上游完整 commit 的
`gateway/restv2/api-options.go::Handler.parseFlags` 将该默认 flag 转为未指定
统计列表，`gateway/restv2/api-lookup.go::Handler.GetByUuid` 随即要求原生
FolderCounts、FolderSize、VersionsAll。真正断点为
`common/nodes/core/handler-exec.go::Executor.ReadNode`：原快路径只看到
`common/nodes/meta/meta-providers.go::enrichNodesMetaFromProviders` 的 metadata
加载标记便返回输入克隆，忽略显式统计及可能发生的原生失败。
这个 metadata 标记不证明统计完整，线上响应确实缺少 FolderMeta。

四步结论延续同一读取边界：权威及源服务不变；影响原 Executor 的显式 StatFlags
和旧 WithExtendedStats 消费者。无统计要求时保留原克隆快路径；需要统计时将
完整原请求交给原 native tree client，由原
`data/tree/grpc/handler.go::TreeServer.ReadNode` 读取统计。不添加另一统计层或
合成 FolderMeta，不更改 ACL、数据库、契约或三端 UI。原生失败原样传播，
无缓存成功降级；空目录、叶节点、重复读取沿原服务处理，不引入持久状态。

实现后新增 `common/nodes/core/handler-exec_test.go`，复用上节受限 SDK/caches。
实际执行 `go test -mod=readonly ./common/nodes/core ./common/nodes/uuid -count=1 -v`，
覆盖原无统计快路径、8 类原 flag、旧扩展统计、原生错误，以及 3 项空间投影。
只在私有候选恢复旧快路径条件后，9 个子检查真实失败，退出 1；其中原生拒绝
确实错误变成 `err=<nil>` 的缓存成功。还原正式字节 `cmp` 退出 0，两包最终通过，
退出 0，格式检查无差异。没有发布编译或镜像构建。

空间投影另在最终私有候选删除 UUID 投影及旧别名清理后，两项检查真实失败；
恢复后两个原生包一并通过。上节同一原件目录的最终证据为
`cells-native-stats-legacy-mutation.log`、`cells-workspace-projection-alias-mutation.log`
及 `cells-native-read-final.log`；早期日志保留，不替代最终候选结果。
这些检查使用原 Executor/UUID handler 和隔离 tree client，不是线上新镜像结果。
两个修复均尚未部署，真实 adapter 读取、Cells→WeKnora 业务同步和全量验收未闭合。

## 原绑定管理握手接通（2026-10-08）

本批按 DD-88/94、`.design/07` §5.2 修复实际调用断点：Core 的
`application_binding_native::validate` 已先调用 handshake，Cells Adapter 原路由却
没有消费者。现在沿同一服务与原协议处理该请求；不新建管理页、注册表或生命周期。

影响与边界如下：

1. `ADAPTER_CONFIG_FILE` 的可选 `management` 只投递实际 release 的
   `componentTypeKey/componentReleaseId/artifactDigest/protocolRange`。协议为既有 `1`，
   缺投递不开放成功握手，格式错误拒绝启动；没有默认 release 或凭据。
2. Cells 与知识 Adapter 共用 `client-kit/adapter/protocol.mjs::verifyBindingManagementToken`，
   只接受既有 `application_binding.create` / APPLICATION_BINDING / HUMAN 形状，
   不把业务 RESOURCE 的 ResultExposure 要求放宽。请求 release、type、range、
   canonical body、幂等 key 与 header 必须一致；租户、工作区、binding 必须精确匹配。
3. 沿既有 Cells REST transport 读取固定空间根目录，核 UUID、COLLECTION、
   ContextWorkspace、路径及回收状态；只有原生事实成立且前后两次签名/PEP 均通过，
   才返回原 Core 消费的 protocolVersion/artifactDigest。无文件正文、CREATE、
   PAT 创建、业务数据库写入或新增状态；重复调用仍重读，不缓存准入结果。
4. 拒绝、超时、超限、scope 漂移及读取期间撤权不返回成功观察。成功握手也不代表
   validate_binding、SecretRef 读取回执、投影或 binding ACTIVE；剩余阶段继续关闭。
   三端页面、传输与 Mobile 非组件宿主边界没有改变。

固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`gateway/restv2/api.go::Handler.TreeNodeToNode` 与
`gateway/restv2/api.go::Handler.ContextWorkspace` 是沿用的节点及空间转换来源，
本批以 `git show/git grep` 只读复核；原 `nativeNode` 实际消费者继续核该结构。
没有编辑、构建或执行 `.references`。协议与 Core 契约不变，无四侧生成或数据库迁移。

实现后复用 `kailo-agent-receipt-xvkujx`，实际 4 CPU / 8 GiB / 无额外 swap，
启动前读回 cgroup、进程与约 26 GiB 可用内存。仅同步本批文件到既有
`read-receipts-20261007/apps`，未做全树快照、镜像构建或发布。
证据目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/read-receipts-20261007/`：

- `cells-binding-handshake.log`：原 Node HTTP 检查按 handshake/SERVICE/source bytes
  选择，48 passed，退出 0；真实 HTTP、签名和 PEP 客户端，原生服务为隔离响应器。
- `cells-binding-handshake-mutation.log`：只在私有候选删除 binding target 校验，
  同一检查实际报 `200 !== 401`，退出 1；随后恢复原字节并 `cmp` 退出 0。
- `cells-binding-handshake-restored.log` 与 `cells-binding-handshake-complete.log`：
  首次扩大检查时 ONLYOFFICE 分支失败；后者为 104 passed / 5 failed。
  实际导入得到 `ERR_MODULE_NOT_FOUND`，该旧轻量候选没有原 package.json/xml2js。
  首次 npm 在缺 package 的父目录结束且没有安装所需依赖，不记为修复成功。
- 同步正式原 package.json 后，在受限 SDK 的该 package 内执行
  `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false --workspaces=false`，
  从已有 `/cache/npm` 缓存补齐 3 个包，没有联网下载或修改正式依赖。
  `node --test test/*.test.mjs` 最终为 **109 passed / 0 failed，退出 0**，日志
  `cells-binding-handshake-final.log`，约 0.993 秒。包含原 ONLYOFFICE 分支，
  不是实际 DocumentServer/浏览器/设备验收。

本批没有启用 release/binding、部署服务或更新安装包。真实 OpenBao Agent 读取
request_id 的回执消费仍未闭合，不能靠回填配置伪造 validate_binding 成功。
全量 `tools/check.sh --full` 本批未运行，磁盘约 1.2 GiB；定向通过不提高生产就绪结论。

## 绑定验证与本次 Agent 读取接通（2026-10-08）

沿同一 DD-88/93/94 与 `.design/07` §5.2、`.design/08` §4，接通原 Core
`application_binding_native::validate` 的第二个调用 `validate_binding`，不添加
第二个绑定流程。Cells 原始来源仍为上述完整 commit 的 `Handler.TreeNodeToNode`
和 `Handler.ContextWorkspace`；实际 SDK 读取路径和 Node/PAT 业务实现不替换。

实现后的四步结论：

1. 权威：Core 保留 binding、SecretRef、AE 和 AuditObserver；Cells 保留空间和
   文件正文，OpenBao 保留密钥。Shared `binding-validation.mjs` 被 Cells、知识
   两个实际消费者复用；管理验签仅封闭为 handshake/validate_binding。
2. 影响：现有 `ADAPTER_CONFIG_FILE.management.validation` 投递 bindingVersion、
   servicePrincipalId、adapterServiceRef、nativeInstanceRef、nativeScopeRef、
   isolationMode、normalizedConfig、secretDeliveries、actionVersions。请求完整值
   与投递值比较，不能以请求选择凭据文件、实例或 socket。Cells 固定
   DEDICATED_INSTANCE，nativeScopeRef 必须等于 nativeWorkspaceId，并以原 root
   的 ContextWorkspace.Uuid 核实；独立数据库与部署归属仍须由原 release/binding
   部署证据证明，读取一个根目录不证明实例独占。协议、四侧契约和数据库无变化。
3. 副作用：复用 Wren `nativeBindingService.ts::connectionSecret` 已有的 OpenBao Agent
   Unix API proxy 读取方式，无 adapter token、远端 Bao URL、新凭据管理器或缓存。
   固定版本 KV 值必须等于实际使用的 secretFile；仅把原 request_id/version/
   audience 返回 Core，由原审计配对核 AppRole、locator 和 AE 时间窗口。密钥值
   不进入输出、日志或业务数据。读取前后原 PEP 均保留，返回前再次验签。
4. 异常：原生 scope 漂移、过期 token、撤权、超限、总截止时间、错误/销毁/删除
   密钥版本、不同值、重复 request_id 均拒绝；读取期间轮换不能拿前一次观察成功
   应答。不建立新持久状态，不触发原生 CREATE、PAT 或文件写入，重复调用重新
   查原引用。三端页面及 Mobile 非组件宿主边界不变。

投递使用说明：每个 secretDeliveries 条目保留原
`secretKey/locator/version/audience`，另指定实际绝对路径 `secretFile`、
专属 Agent Unix `secretSocket` 和 KV 数据字段 `secretValueKey`。namespace 与
KV 路径由同一 SecretRef locator 解析，不再另投递一份可能不一致的路径。
Agent 原 API proxy 不配置 cache；adapter 不持有 Agent token，不发送共享凭据。
至少覆盖真实 Cells bearer 和 PEP OIDC client secret，不能只证明未使用的密钥。
actionVersions 只接受实际启用消费者：readEdge 对应 read/list@v1，documentLaunch
对应 open_view/open_edit@v1；不因配置列出未实现动作就宣称支持。
该运行配置不是新增放宽安全的开关，不启用任何原先 blocked 的能力。

静态 Agent 模板回执方案在本批复核中被撤回：即使能匹配实际值，启动时的旧
request_id 也不能证明本次 AE 后的读取。没有保留双模式或靠文件 mtime 冒充
新审计。首次文件回执验证日志保留，但不能用于宣称最终 Unix proxy 版已验收。

最终验证复用已有 `kailo-agent-receipt-xvkujx`，4 CPU/8 GiB、无额外 swap；
运行前读取进程、内存和磁盘（约 20 GiB available、Data 1.2 GiB），无依赖安装、
镜像构建或全树快照。`node --test test/*.test.mjs` 为 **126 passed / 0 failed**，
退出 0；实际 HTTP + Unix socket 消费者验证固定 scope、两凭据版本/值、新读取
request_id、前后授权及中途轮换。隔离响应器不是线上 Cells/OpenBao 审计验收。

私有候选把末尾即时读取改为直接返回初次观察后，原生读取中和最后 PEP 中的
轮换都错误返回 200，检查实际报 `200 !== 503`，**14 passed / 3 failed**（含父
用例），退出 1。还原正式字节 `cmp` 0，完整重跑日志为
`cells-binding-agent-proxy-restored.log`；同一既有证据目录还保留
`cells-binding-agent-proxy.log` 和 `cells-binding-agent-proxy-mutation.log`。

本批没有修改线上 Agent 配置、启用 release/binding、发布镜像或更新安装包；
真实审计时窗、完整组件业务、Web/Windows/Mobile 与全量检查仍未验收。
本机剩余磁盘不能支撑原全树导出，此处不把定向通过称为 `check.sh --full` 通过。

## 历史原查询候选 RTq1FU

这是独立候选 RTq1FU 的实际 HTTP 适配器证据，不是 Cells 已接入 Kailo 的验收。
运行体不拥有目录、文件、版本、权限或工作流；它没有 execute、MCP 注册或编辑入口。

## 四步边界

1. 权威：`.design/07` §5.2 的 `query_revision` 返回当前 revision；`18` §2/§4/§5.3
   固定 Cells node UUID / VersionId，历史版本不得换成 latest，只有 EDIT 准入要求 head。
2. 影响：固定 binding 的目录配置、Core ActionToken 公钥投递、binding OIDC client、原 Core
   PEP、Cells REST v2 节点与版本查询；新增两份原 Adapter Protocol 机器编码，不改能力契约键。
3. 副作用：只读 Cells 原生对象与版本；不读取文件正文，不创建对象或令牌权威。
   原 OIDC client_credentials 仅为受认证 PEP 回调，密钥只读 OpenBao Agent 投递文件。
4. 异常：租户/Workspace/签名/摘要/PEP 不符不读 native；重复 intent 仍重新 fresh 检查。
   原生 UUID、Workspace、回收状态、根目录段、唯一 IsHead 与 VersionId 必须成立。
   空、歧义、超限、重定向、未知错误不输出 revision；读取后再次验签与 PEP，撤权不披露。

## 固定只读上游

以下路径均在完整 commit `c57f02f4962835447df694c63bd0fd8c22bd7baf` 重新核验：

- `common/naming.go::DefaultRouteRESTv2`：原生默认前缀 `/v2`；部署地址由目录配置投递。
- `common/proto/rest/cellsapi-rest-v2.proto::NodeService.NodeVersions`：
  `POST /n/node/{Uuid}/versions`，节点按原 UUID 查询。
- `gateway/restv2/api-versions.go::Handler.NodeVersions`：直接读取 `NodeVersionsFilter`，
  使用原 `UuidClient(true).ReadNode`、原版本服务及调用者 draft 可见性，不是 `{Query: ...}` 包装。
- `gateway/restv2/api.go::Handler.TreeContentRevisionToVersion`：VersionId、IsHead 来自
  原 ContentRevision，不从 MTime、ETag 或临时下载 URL 推断。
- `gateway/restv2/api.go::Handler.ContextWorkspace`：Workspace UUID 来自原生节点上下文。

`.references` 未编辑或执行。

## 实现后执行

原检查命令：`node --test test/query-revision.test.mjs`。
运行在既有 `kailo-installation-scope-sdk-e4agxd`，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU / 8 GiB / swap 0，UID:GID 1000:1000，Data 挂载内独立源码归档。
执行前读回现有 SDK 无其他工具进程，宿主可用内存约 36 GiB；未安装依赖或新建容器。

原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-revision-check-AUjl3C/`。

| 原件 | 实际结果 | SHA-256 |
|---|---|---|
| baseline.log | 21 passed，退出 0 | `2b7427e13809b73821b63ec25f84a0313665f5c063c0daee408fb0d4af9ca471` |
| mutation.log | 17 passed / 4 failed，退出 1 | `0f76e4c565dc92d53cac7cd808babec590f6d5a7784c3e33e7ddce8e6c4edf64` |
| restored.log | 21 passed，退出 0 | `dd117d37fdda202f376d56c1639a5690e17697d22aa7b9e686727a85568b9ac3` |

变异仅在归档中移除原生根目录边界，并接受多个 IsHead；原 HTTP 用例实际分别遇到
越界 200 和歧义 200 而失败。apply_patch 恢复后与候选生产文件 cmp 退出 0，原目标再次通过。
原生产文件 SHA-256 为 `a2c7d10c5b223850b675f2b02f7ca9295126902c59b69f8ae8d1774d13c3df73`。

这些用例调用真实适配器 HTTP 入口，原生 Cells / OIDC / Core PEP 为隔离 HTTP fixture；
没有运行真实 Cells 服务，没有业务数据、生产密钥或模型请求。Core 生产签发和 PEP 的
query_revision 分支、真实 Resource 原生归属、注册/批准/binding 与运行投递尚未共同验收。
当前查询只能证明 head，不能证明任意历史 ContentReference 的 revision 存在；
不得据该局部检查开启历史引用披露。两份新 schema 尚未进入集中四侧生成，未提交或部署。

## RESOURCE_PROVISION 的原生 fence 缺口

`.design/03` §4 与 `07` §5.2 / DD-98 要求：结果不明后只 LOOKUP，缺失结论必须
在同一原子步骤写入该 platform Resource ref 的拒绝标记，之后 CREATE 一律 REFUSED。
本批 Core 只有原 Delegation 对 `resource.create` 的识别与套件中的协议操作名，
尚无生产 RESOURCE_PROVISION writer/Workflow 消费者。

同一 Cells 完整 commit 的实际接缝为：

- `gateway/restv2/api-create.go::Handler.Create` 把 ResourceUuid 放入原 InputResourceUUID，
  再调用 `scheduler/jobs/userspace/userspace.go::MkDirsOrFiles`。
- `scheduler/jobs/userspace/userspace.go::MkDirsOrFiles` 先独立检查 path/UUID，存在返回
  conflict；否则再调 CreateNode。adapter 可以用稳定 ResourceUuid 对重复冲突做严格查证，
  但该行为本身不是“缺失并永久拒绝后续创建”。
- `gateway/restv2/api-create.go::Handler.CreateCheck` 遇 NodeNotFound 只返回 Exists=false，
  没有拒绝标记写入。
- `data/tree/grpc/handler.go::TreeServer.ReadNode` 按 UUID 查找并返回错误；
  `TreeServer.CreateNode` 独立调用 datasource writer，没有消费上述 LOOKUP 的拒绝标记。

因此现成原生调用允许如下顺序：CREATE 已通过不存在检查 → LOOKUP 读空 →
CREATE 的 writer 成功。把 LOOKUP 的 404/Exists=false 写成 ABSENT_FENCED 会形成假的
失败终态；HTTP 超时或取消连接也不能证明原生 writer 未成功。本次未新增临时台账、
进程内 mutex 或拒绝一切的 stub 来伪装原子 fence，RESOURCE_PROVISION 入口没有开放。
该证据仅说明现成被核验的调用链不足，不宣称整个 Cells 没有其他可扩展的原生接缝。

## Cells 空目录的真实完整列举（2026-10-07）

本批关联 DD-89、SS-CEL-MATERIALIZATION 与 `.design/13` §4.4：仅完整、成功且
受权的来源列举可以成为 WeKnora 的缺失项集合，空目录也必须能够表示成功的空集合。
固定上游仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`，以下符号重新只读核验：

- `gateway/restv2/api-lookup.go::Handler.Lookup` 在零节点时仍返回原 NodeCollection。
- `common/proto/rest/cellsapi-rest-v2.pb.go::NodeCollection` 的 Nodes 为 repeated 字段。
- `common/middleware/rest-entity-rw.go::ProtoEntityReaderWriter.Write` 使用默认
  `protojson.Marshal`，不启用 EmitUnpopulated；空 Nodes 不输出为 JSON 字段。
- `common/service/web.go::init` 的原服务注册路径使用该 JSON
  EntityAccessor；不是测试随意指定的另一种编码。

原适配器强制 `Array.isArray(response.Nodes)`，因此合法空目录被拒绝；来源最后一个
文件删除后的同步也无法向接收方给出完整空集合。本批直接纠正原 `service-list.mjs`
解析，不新建列表或同步权威、不修改原 Cells 页面/数据，不放宽 Resource 或 binding。

只有独立原生 ChildrenCount 明确为零、响应为原 NodeCollection 对象且 Nodes 省略时，
才按 proto3 语义解读为空数组；非零计数缺 Nodes、显式 null/对象、未知响应字段、
缺失计数、异常分页、读取中计数变化或撤权均拒绝且不产生来源完成回执。
计数字段的 proto3 省略零值不等于显式 null：后者及字符串计数仍拒绝；省略 Nodes
时也拒绝 malformed 或非空 Facets，不能把过滤结果伪装成完整空集合。
保留原前后节点核验、两次完整遍历、fresh PEP、来源摘要与用量回执。分页存在时还须为对象；
不能把错误字符串的缺失属性默认为零。没有新状态、schema、迁移、配置或 secret。
成功空集合为原 `items=[]` 合同，由现有 WeKnora 消费；不在 Cells Adapter 删除知识。
Web/Desktop/Mobile 的页面与宿主边界均不变。

实现后复用 `kailo-agent-receipt-xvkujx` 原 4 CPU / 8 GiB cgroup；执行前只有 sleep、
OOM false，宿主约 30 GiB 可用。仅向原 read-receipts 候选补齐七个轻量源码/测试输入，
没有新全树快照、镜像、依赖安装或 Go 编译。实际命令：

```sh
node --test --test-name-pattern='SERVICE|source bytes' \
  file-storage/adapter/test/query-revision.test.mjs
```

原 HTTP 消费者专项 **29 passed / 0 failed**，退出 0，覆盖 `{}`、省略零值分页、
显式空数组、错误缺失/类型、非零计数、变化计数以及披露前撤权；真实适配器仍经过
两次 PEP、两次列举并提交 `[]` 的 SHA-256 与两字节回执。删除 SDK 中的空集合适配、
恢复旧 Nodes 强制存在行为后，实际 **3 failed / 26 passed**，退出 1（含父用例失败）；
正式源码不破坏。还原后两个变更输入 cmp 退出 0，同一专项再次 **29/29** 通过。
随后补入原生 Facets 空数组、null/字符串计数、异常 Facets 的边界检查，最终
**34 passed / 0 failed**，退出 0。私有候选恢复旧 `Value ?? 0` 后，null 计数
错误地产生 200，被实际检查抓到 **2 failed / 32 passed**（含父用例失败）；
再次还原并 cmp 两输入退出 0，最终 **34/34** 通过。
交叉复核后同批进一步纠正三个分页字段的旧 `?? 0`：Total、NextOffset 与
CurrentOffset 都仅省略时采用 proto3 默认零，显式 null 不再获得完整列举回执。
三个真实 HTTP 反例补入后 **37/37** 通过；私有候选恢复旧分页逻辑后
**4 failed / 33 passed**（含父用例失败），三个 null 均真实错误返回 200。
原字节恢复、两个输入 cmp 退出 0，最终 **37/37**、退出 0。

完整原 HTTP 文件也实际运行：**72 passed / 5 failed**，退出 1；失败位于原 ONLYOFFICE
discovery/PAT 路径。该轻量候选没有 `xml2js`，独立动态导入确认 `ERR_MODULE_NOT_FOUND`；
没有绕过 XML 解析或把此结果记成完整通过。它不影响上述来源读取专项，但仍是完整
套件未通过的明确边界。

日志位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/read-receipts-20261007/`：
`cells-empty-discovery.log`、`cells-empty-discovery-targeted.log`、
`cells-empty-discovery-mutation.log`、`cells-empty-discovery-restored.log`、
`cells-empty-discovery-final.log`、`cells-empty-count-mutation.log`、
`cells-empty-count-restored.log`。
分页纠正的原件为 `cells-empty-pagination.log`、
`cells-empty-pagination-mutation.log`、`cells-empty-pagination-restored.log`。
`git diff --check` 退出 0。Cells/Core/OIDC 仍为隔离 HTTP fixture，不是线上空目录删除
验收；没有 full、浏览器截图、生产绑定投递、部署、安装包或真实跨服务同步验收。
本批未修改已有未提交的 `file-storage/deploy/compose.yaml`。

## 空集合最后一次来源状态复核（2026-10-07）

权威与影响面：沿 `.design/13` §4.4/§7 查到既有
`knowledge/internal/application/service/datasource_file_storage.go::fileStorageConnector.retire`
已消费完整来源列表、退休 checkpoint、原生删除及其精确终态，不能把已有执行链说成缺失。
本批确认的遗漏在 `service-list.mjs::nativeListing` 的每目录末尾复核：旧实现只比较
path 和 ChildrenCount；最后第二轮遍历末尾，即使原生目录已报告为草稿、回收对象、
LEAF 或丢失原有工作区证据，只要 path/count 不变仍产生成功的空集合。
该集合会进入原来源 SOURCE 回执，成为接收方退休判断的错误前提。

固定 Cells 上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`common/proto/rest/cellsapi-rest-v2.pb.go::Node`、`Node.GetIsRecycled`、
`Node.GetIsDraft`、`Node.GetContextWorkspace` 本轮经 `git grep <commit>` 核验；
这些是原生节点生命周期与工作区字段，不另造删除或撤权状态。
直接补齐原末尾复核的 Type、ContextWorkspace UUID 和三项生命周期条件；原先正常
省略 false 标志的空目录不受影响。未添加平台实体、回执类型、配置、数据库迁移或
客户端页面；成功路径、前后 PEP、两次遍历和原生索引删除权威均保持。

副作用与异常：已经观察到来源状态变化时拒绝并且不提交 SOURCE 完成回执，不把
“不再是合格来源目录”解释为“成功读取零文件”，也不返回成功/失败的删除终态。
未知结果仍进入既有读取/导入失败与对账路径，不在这里重发删除或清空接收方状态。
这不是原子快照、不能证明读取后永不发生变化；原生并发变化及跨组件事务限制不变。
Web/Desktop/Mobile 及原生 UI 均未修改。未增加新的持久状态或收敛机制。

实现后在原 `kailo-agent-receipt-xvkujx`（4 CPU / 8 GiB，OOM false）复用上述轻量
候选，只同步两个变更输入，无安装、全树复制或 Go/Rust 编译。执行前查过构建进程、
CPU/内存压力，未发现活动构建、宿主约 22 GiB 可用。实际运行同一来源读取命令：

```sh
node --test --test-name-pattern='SERVICE|source bytes' \
  file-storage/adapter/test/query-revision.test.mjs
```

**43 passed / 0 failed，退出 0**。新增五个真实 HTTP 消费者反例在两次列举完成后、
第 4 次 root 读取才改变状态，全部 503、零来源完成回执；正常空目录仍通过。
只在私有候选撤掉本批末尾状态检查，五个反例均错误返回 200，实际
**37 passed / 6 failed，退出 1**（含父用例失败）。还原正式字节并对源码/测试分别
`cmp`，均退出 0；重跑 **43/43，退出 0**。
原日志位于同一 `read-receipts-20261007` 目录：`cells-final-root-state.log`、
`cells-final-root-state-mutation.log`、`cells-final-root-state-restored.log`。

这修复的是来源列表的可核验性遗漏，不声称已经验收“真实 Cells 删除后线上索引不可检索”。
原 Connector 的退休/删除链仅做源码追踪，本轮未编译 Go，未运行真实跨服务删除、
Wiki 撤回终态、浏览器、full 或部署；上一节完整 HTTP 套件缺 xml2js 的失败记录保留。

## 2026-10-08 原生已发布 head 的实际读取消费

四步影响结论（DD-89、SS-CEL-MATERIALIZATION、设计 18 原生版本证据）：

1. 权威仍在固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`。
   `common/proto/rest/cellsapi-rest-v2.proto::Node.IsDraft` 与
   `common/proto/rest/cellsapi-rest-v2.proto::ContentRevision.Draft/IsHead`、
   `common/proto/tree/cells-tree.proto::ContentRevision.Draft/IsHead` 定义真实草稿和
   head 事实；当前适配器原生读取不得把未发布 head 当作成功版本。
2. 实际读写点是 `src/native-reference.mjs::nativeDocumentSelection`、
   `src/query-revision.mjs::nativeDocumentTarget` 及其 `nativeNode` 读者。
   同一原生事实供 revision 查询、在线文档 PAT producer 和 SERVICE 来源读取消费；
   不新增平台字段、数据库、工作流、凭据、状态库或第二份版本权威，无旧数据迁移。
3. 原实现只核 head 唯一性，漏核 Draft 和非布尔状态。现在拒绝草稿节点、
   未发布 head 和未知字段值；拒绝发生在字节读取、PAT 创建或 SOURCE 完成回执前。
   历史非 head 草稿仍允许存在，不裁减原版本列表。原前后 PEP、精确 UUID 和
   workspace/subtree 归属不变，不按名称或默认 scope 降级。
4. 空版本、重复/多个 head、草稿 head 及畸形原生标志走现有 503 来源证据拒绝，
   不显示已确认版本或推断写入失败；原 UNKNOWN 对账与不重放副作用边界不变。
   Web/Desktop/Mobile 和原生页面未改，在线编辑继续原 PROTOCOL 生命周期，
   不为该 PAT 链伪造通用 ExternalExecution observe。

实现后在既有 `kailo-agent-receipt-xvkujx` 的 4 CPU/8 GiB cgroup、非 root
执行身份和原 Data 缓存运行原 adapter 检查；先核对构建进程与内存压力，
未安装依赖、整树复制、编译 Go/Rust、新建镜像或重启服务。

```sh
node --test file-storage/adapter/test/*.test.mjs
```

实际全部 **170 passed / 0 failed / 0 skipped，退出 0**。新增检查消费真实 HTTP
revision、PAT producer 与 SERVICE 读取入口，核对拒绝时零版本读取、零 PAT、
零字节和零 SOURCE 完成回执。私有 SDK 去掉本批原生状态守卫，实际
**24 个检查失败，退出 1**；原字节还原且四文件 `cmp` 退出 0 后，同一完整
adapter 命令再次 **170/170，退出 0**。

原件目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/`，
日志为 `cells-adapter-published-head-restored-20261008.log` 与
`cells-adapter-published-head-mutation-20261008.log`。
这是当前四源码/检查文件 `+88/-7` 的专项证据，不是实际 Cells→WeKnora 同步、
三组件 release/binding、浏览器/Windows/Mobile、full、镜像或部署验收。

## 2026-10-08 来源下载缓冲后的原生归属与撤权复核

四步影响结论（DD-89、SS-CEL-MATERIALIZATION、设计 07 §8.2 与 13 §4.4）：

1. 固定官方 Cells 基准仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`，
   `common/proto/rest/cellsapi-rest-v2.proto::Node` 的 UUID、ContextWorkspace、
   IsRecycled、IsRecycleBin、IsDraft 是原生归属和生命周期事实。下载初始读取
   已复用 `src/query-revision.mjs::nativeDocumentNode` 核实这些事实；原
   `src/service-read.mjs::readFile` 在预签名 GET 完成后仅重核签名和 Core PEP，
   原生移动/删除/ACL 撤回不会自动改变 Core Resource，不能由先前路径证明最终
   正文披露仍在冻结根及授权子树内。上传/移动/删除/分享未实现的 adapter 能力
   没有在本批生成入口或声明完成；本批闭合的是已有的真实来源下载消费者。
2. 仅改 `src/service-read.mjs` 与原 `test/query-revision.test.mjs`：正文缓冲后
   先重验原 ActionToken/fresh PEP，再经同一 helper 重读固定 root/source/node
   UUID 和 Workspace/subtree/lifecycle，最后再次重验 token/fresh PEP，然后
   才提交原 SOURCE 回执并返回字节。固定 nativeRevision、operation、meter 和
   原回执确认合同不变。无新端点/配置/平台字段/数据库/注册表/工作流或迁移。
3. 不能把已读入的字节当作可披露成功：跨根/跨 Workspace、UUID 被替换、回收、
   草稿、未知生命周期值、native ACL 拒绝/404、授权子树移动都沿原 Refused 路径
   拒绝，零 SOURCE 完成回执、零正文响应；不回落路径或其他凭据，不重复下载。
   合法同 UUID 在授权范围内改名仍返回冻结版本，不把移动误当新正文。二次原生
   查询期间撤权由最后 PEP 拒绝。这是离散检查，不承诺 native/Core 原子快照。
4. 空文件原读取规则、原版本大小/摘要、凭据隔离和受控 presigned origin 不变；
   失败仍由接收方原同步失败/对账消费者处理，不能提交删除 desired set。不新增
   持久状态或新的终态权威。Web/Desktop/Mobile 和三组件原生页面未改；正式服务
   与 release/binding 均未替换/激活，不能据专项通过声称真实端到端可用。

实现后核对了现有构建进程、CPU/内存、Data 及 SDK 限额：Data 641 MiB 可用，
宿主内存约 26 GiB 可用；有非本项目 CUDA 编译，未操作其进程。复用空闲的
`kailo-native-page-sdk-4rbmbz`（4 CPU/4 GiB、无额外 swap，UID 1000），仅在
其原挂载 `/work` 下建 160 KiB 私有证据叶，复制原 adapter mjs 和两个实际
client-kit adapter 模块；未安装依赖、复制完整工程、新建镜像或执行 Go/Rust
编译。使用原 Node 检查，没有增加检查脚本或替代执行器。

三轮实际命令相同：

```sh
sudo -n docker exec -u1000:1000 \
  -w /work/cells-read-scope-20261008.WRMhHQ/apps \
  -e TMPDIR=/work/cells-read-scope-20261008.WRMhHQ/tmp \
  kailo-native-page-sdk-4rbmbz node --test \
  --test-name-pattern='SERVICE|source bytes|shared PEP' \
  file-storage/adapter/test/query-revision.test.mjs
```

正向 **72 passed / 0 failed / 0 skipped，exit 0**。只在私有生产候选移除真正的
post-buffer `nativeDocumentNode` 调用（保留最后 PEP、原 fixture 和断言），同一
检查实际 **57 passed / 15 failed，exit 1**：11 个真实原生变化反例错误得到
200（应为 403/503），同时实际 native 查询次数从 5 降到 3；包含父项失败。
以正式源码原字节还原，源码与检查各 `cmp` 退出 0 后，同一检查重新
**72 passed / 0 failed / 0 skipped，exit 0**。最后 SDK memory.events 所有 OOM
计数为 0，memory.current 为 46370816 bytes；没有在途命令。

原件目录：
`/volumes/data/kailo/tmp/codex-native-page-navigation-20261005.4rBmBZ/cells-read-scope-20261008.WRMhHQ/`。

- `positive.log`：SHA-256 `293f42cc3dc09a9633838ad537d936cd36118030516d31f235e1338f4addfc7a`。
- `mutation.log`：SHA-256 `edf6a54d1ca8dbb9f21611d3fe5d77846a68679e529d10578289223660891292`。
- `restored.log`：SHA-256 `4a6076cb79df6f708327c0c4888e238493646bde18bb3e9af6d9d90dd414c649`。

原完整 adapter 套件、上游 manifest status、真实 Cells→WeKnora 导入/解析/撤权、
其他 native 写操作、浏览器截图、Windows/Mobile、full、镜像和部署均未在本批
执行。这里不沿用历史 170 项的全部 adapter 验收口径；本批证据精确限于上述
原 SERVICE/source-bytes/shared-PEP HTTP 消费者。
