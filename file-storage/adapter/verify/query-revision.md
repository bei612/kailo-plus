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

## 原生零字节版本的来源读取与保存观察（2026-10-08）

真实断点是固定 Cells 默认 protojson 会省略零值 `Version.Size`；此前来源读取把
缺席当作非法大小，原历史保存观察则要求显式字符串 `"0"`，两者均拒绝真实空文件。
这是原生编码的消费者遗漏，不是新增上传能力，也不放宽未知字段或业务准入。

四步影响结论：

1. 权威为 `.design/07` §5、§8.2 和 `.design/13` §4.4 的原生版本、受权字节
   与双边回执。只读 Git 核验 Cells 完整固定 commit
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`：
   `common/proto/rest/cellsapi-rest-v2.pb.go::Version.Size` 是非 optional proto3
   int64；`common/middleware/rest-entity-rw.go::ProtoEntityReaderWriter.Write`
   使用默认 `protojson.Marshal`；`gateway/restv2/api-versions.go::Handler.NodeVersions`
   经 `gateway/restv2/api.go::Handler.TreeContentRevisionToVersion` 返回该模型。
   原生产者与 REST 协议不改，未执行上游证据中的代码。
2. 仅原 `query-revision.mjs::originalWriteRevision` 与
   `service-read.mjs::readFile` 共用 `nativeVersionSize`，以及原 HTTP 检查修改。
   缺席 `Size` 按已核实 proto3 零值解码；显式值只接受规范非负 int64 JSON
   字符串且在 JavaScript 安全整数范围。没有新配置、协议、类型权威、schema、
   数据迁移或旧读路径；Web/Desktop/Mobile 页面及组件宿主边界不变。
3. 空值、数字、布尔、空串、前导零、负数、小数、超安全整数均拒绝，绝不以零
   兜底。来源仍要求确切 VersionId、固定 root/Workspace/已授权子树、非 draft、
   受控下载 origin、精确实读字节数、三次 fresh PEP 及持久 SOURCE 回执确认。
   缺席大小但实际有字节仍 503 且没有回执；没有复制正文或追加计量权威。
4. 零字节成功保留原 SHA-256、版本、长度 `0`、一次读取 count 和零 bytes
   measurement。原已接受保存仅在同 VersionId、ETag、零 bytesWritten 与原
   HUMAN observation 关联都匹配时确认；不下载、不新写、不产生 SOURCE 回执。
   错大小/ETag/版本、撤权、超限、native 拒绝及结果不明沿原错误/UNKNOWN
   收敛，不把传输失败当空文件；没有引入新状态或期限。

实现先于扩充原检查。执行前核验无构建进程、主机约 30 GiB 可用内存、swap 0、
Data 271 MiB。复用已存在 `kailo-wren-query-sdk-itgs2n`，UID/GID 1000:1000，
实际 `cpu.max=400000 100000`、`memory.max=4294967296`、memory+swap 同值；
Node v24.21.0。仅向上一私有小候选增加六个 Cells 直接源码/检查输入，未改 Wren
输入、根 SDK、依赖缓存或其他项目；没有安装、下载、镜像、Go 链接或新数据库。
该 SDK 确实缺 `xml2js`，因此完整编辑器套件没有运行，不冒充全部 adapter 通过。

三轮使用同一原目标：

```sh
node --test --test-name-pattern='SERVICE|source bytes|accepted zero-byte|original accepted save' \
  file-storage/adapter/test/query-revision.test.mjs
positive: exit 0; 85 passed, 0 failed, 0 skipped
private production mutation: exit 1; 80 passed, 5 failed, 0 skipped
byte-restored: exit 0; 85 passed, 0 failed, 0 skipped
```

私有生产破坏把真正缺席零值解码改回拒绝，原检查及 fixture 不变：原空文件读取
和零字节保存均实际 `503 !== 200`；缺席大小的非空反例仍被拒绝，但提前返回使
下载次数由 1 变为 0，原调用次数断言也报错；三子项加两父项共五失败。正式源码未破坏；
回拷正式源字节后三个变更路径 `cmp` 均退出 0，同一目标再次通过。
完整本批 diff 已复核，`git diff --check` 退出 0，无在途命令。

日志原件在
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`：

| 日志 | SHA-256 |
|---|---|
| `cells-empty-version-positive.log` | `5e0f6375c3d8c0b10b5b30f5a32584de9c303eead28475b15511b8938cc7e4a4` |
| `cells-empty-version-mutation.log` | `86ead183dc0343a0c0b52b8ac211bd911ea0a3e96ca8c090877a06a027d7dc43` |
| `cells-empty-version-restored.log` | `90bef8d47cdf8400523dfab4e742e804f5370979bf91aa6b29019db488fd4f0b` |

这些是受控 Cells REST/PEP 的原 HTTP 消费者证据。没有执行实际 Cells 空文件
跨服务导入/解析/结算、release/binding 激活、原 UI8、Windows/Mobile、full、
镜像发布或部署；知识库冻结 Go10 的最新字节仍未验收，不借本批结果增加其完成度。

## 平台固定版本删除阻断（2026-10-08，新增实现已撤回）

沿 DD-89、DD-93 与 `.design/07` 的固定版本、幂等及 UNKNOWN 规则复核真实
副作用边界后，撤回本轮新增的 delete adapter、能力发现/配置/VALIDATE 路由、
原生 Job 扩展、专用检查及两个 schema；15 个源码/schema/检查路径均已恢复到
提交版本或删除本轮新增文件。原有独立 Cells UI、原 ACL、既有读取/文档能力和
其历史回执未改动。没有可以用开关重新开启的半成品删除入口。

固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的只读源码证据：

- `common/proto/tree/cells-tree.pb.go::DeleteNodeRequest` 没有 IfMatch/revision 字段。
- `common/nodes/core/handler-exec.go::Executor.DeleteNode` 的 StatObject 只检查
  存在性，随后不带版本条件调用 RemoveObject。
- `common/nodes/objects/mc/client.go::Client.RemoveObject` 使用空的
  `minio.RemoveObjectOptions{}`，没有对象版本条件。
- `common/nodes/core/handler-exec-flat.go::FlatStorageHandler.DeleteNode` 先删除
  对象再删除索引；`data/tree/grpc/handler.go::TreeServer.DeleteNode` 也只传 Node。
- `common/nodes/acl/handler-acl-lock.go` 中 DeleteNode 锁代码是注释，不是可复用
  的原子消费者。

因此，执行前读取 HeadVersion/UUID 与后续 DeleteNode 之间仍可能并发换版；
原任务唯一 claim 不能证明固定版本删除。没有另造锁、执行权威、二次副作用或
以文件消失推导成功。处置为关闭本批平台删除能力；重新接入需原生存储删除链
具备可证明的原子版本条件及真实并发/崩溃验证，不能只补 adapter 前置判断。

本轮调查曾在已有受限 Node SDK 运行原 HTTP 目标（排除缺 xml2js 的两项
ONLYOFFICE 检查）：226 passed/0 failed/exit 0；私有 producer-proof 破坏
220 passed/6 failed/exit 1；字节恢复 226 passed/0 failed/exit 0。它们证明
原检查能抓到旧 producer 被误接受，不证明原生条件删除，因此不能计作交付。
Go 未编译，四侧生成、full、实际业务删除、release/binding 激活及部署均未运行。

调查日志仍保留于
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`：

| 日志 | SHA-256 |
|---|---|
| `cells-delete-final-positive.log` | `c98d179ab888959c633bf6831d8596578c9e7445e2b899c1ac07a6a7106ffa1d` |
| `cells-delete-producer-mutation.log` | `7cf855ab481c834852554feb26e15172de1f25e0a165387f6f16bba33be89055` |
| `cells-delete-restored.log` | `1149fec24c0fd5d35023da2f5c78125e9d840b973d4e64277fbe7a468b3459b6` |
| `cells-delete-positive-initial.log`（命令失败） | `e6a3fcaea729a93a92c1f3024ce86012fdcbffcd068cdc0368e14e0027b0e8a2` |

## SOURCE 回执后的实际披露保护（2026-10-08，未部署）

修正原 `readFile` / `listFiles` 的真实返回边界：此前最终 fresh PEP 之后仍会
等待 OIDC 和 `read_receipt` HTTP，回执等待期间的撤权不能阻止随后外发已缓存
文件或完整目录。现在保留原前置检查，回执返回后再验原 ActionToken 与 fresh
PEP；文件还重新核验原 UUID、binding root、Workspace 和授权子树。目录仍只做
原两遍完整列举，不新增同步器或第三遍遍历。原生 UI、页面、上传/删除和文档
接缝未改动；上一节平台固定版本删除继续关闭。

四步影响结论：

1. 权威为 DD-89、`.design/07` §8.2 和 `.design/13` §4.1–4.4/§7 的受权读取、
   撤权不得产生不完整 desired set 规则。复用固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/restv2/api-lookup.go::Handler.GetByUuid`、
   `gateway/restv2/api-versions.go::Handler.NodeVersions` 与
   `gateway/restv2/api.go::Handler.TreeNodeToNode` 所提供的 native UUID、版本、
   Workspace/lifecycle 元数据；未运行证据树代码，也未修改原生能力。
2. 影响面仅原 SOURCE 文件/目录消费者及原 HTTP 检查；同 binding、Resource、
   Operation、idempotencyKey、revision、SHA 和计量映射保持。调用方仍由既有
   WeKnora 自拉连接器消费；Web/Desktop/Mobile 无新页面、字段或身份路径。
   没有契约、数据库格式、迁移、新状态、任务或注册权威，旧数据及读格式不变。
3. 原 `SOURCE` 回执证明已发生的 native 读取，不是回执完成后的披露授权。
   回执后拒绝不撤销事实、不补造 RECEIVER、不重读字节、不猜终态；未配对的
   原 Operation 沿已有到期隔离/UNKNOWN 对账及用量规则收敛。未复制平台正文，
   未增加副作用或把认证失败降级成功。
4. 回执期间撤权、移出授权子树、跨 Workspace、UUID 替换、回收、native ACL
   拒绝/删除及 root 回收均不外发文件；平台撤权也不外发完整目录。空文件、
   空目录、合法同 UUID 改名、旧 receipt 错误及原先检查保持。原 DENIED /
   UNAVAILABLE 拒绝呈现不变，结果不明不变为成功或失败。没有新收敛状态。

执行前 Data 296 GiB 可用、根盘 88 GiB、主机 22 GiB available，无构建进程。
复用原 `kailo-wren-query-sdk-itgs2n`（UID/GID 1000:1000、4 CPU/4 GiB、无额外
swap、Node v24.21.0）与原小候选。与 Wren 的窄 Jest 检查共用限额但输入目录
独立；未安装依赖、下载、构建镜像或启动 Go/Cargo。三个实际 Node 入口语法检查
通过；原 HTTP 目标三轮：

```sh
node --test --test-skip-pattern='HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects' \
  file-storage/adapter/test/query-revision.test.mjs
final-positive: exit 0; 214 passed, 0 failed
private disclosure-guard mutation: exit 1; 187 passed, 27 failed
byte-restored: exit 0; 214 passed, 0 failed
```

私有破坏只删除原 `readFile` / `listFiles` 的回执后生产保护，检查与 fixture
不变。八种 native 撤权/移位及文件/目录平台撤权真实返回 `200`，与预期 `403`
或 `503` 不符；其余失败包含原 PEP 次数断言，不把 27 项都声称为独立漏洞。
正式源码从未破坏。恢复后八个实际 import/检查输入逐文件 cmp 一致，原目标再
通过，`git diff --check` 退出 0。初跑有两个旧 PEP 次数断言未随新增保护更新
（含父测试共 3 项失败），原日志保留；修正原次数断言后才算最终通过。一次 cmp
误列未被 import 的 `native-reference.mjs` 报候选缺失，随后按真实依赖集合核对，
未用其冒充输入完整。最后 SDK memory.events 各 OOM 计数为 0，容器共享内存
快照 680239104 bytes；全部命令已终态。

日志目录：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`。

| 日志 | SHA-256 |
|---|---|
| `cells-source-receipt-positive.log`（首次失败） | `5bd4db6bbfcc40aac97222107c01e1d2f6bbe91f26d3ab96b3b3b57480a20be1` |
| `cells-source-receipt-final-positive.log` | `f19b045b480541e3c1798201d47e46a9433b807fa94b1cc19d8a1c0f7d21197f` |
| `cells-source-receipt-mutation.log` | `bc58e08cf9c0e1a9c3c7a026395fa1d9cafd0ac853cf79a70ea7a574f59cf040` |
| `cells-source-receipt-restored.log` | `886decb9f5c925219964269933ab65a3bcc57a4bd0fd0cd62ea7724ff05339dc` |

这只是原受控 HTTP SOURCE 消费者证据，不是实际 Cells→WeKnora E2E 或生产
验收。SDK 仍缺 xml2js，上述两项 ONLYOFFICE 目标明确排除；full、四侧生成、
真实 release/binding 激活、截图、Windows/Mobile、镜像及部署本批未执行。
Knowledge 冻结 Go10/UI8 最新字节仍未验收，不借本批结果增加完成度。

## HUMAN/AGENT 原生列举消费者与丢 ACK 观察（2026-10-08，未部署）

同一 Cells adapter 原先只识别 SERVICE 自拉的 `targetType/targetId/input`
envelope；Core 的真实业务调用发送的是 `{target:{resourceId},input}`。
本批直接接原业务消费者，不把 SERVICE 身份、双边回执或完整目录传输当作
HUMAN/AGENT 工具已经接入，也不重写原生 UI。

四步影响结论：

1. 权威为 `.design/07` §2.4/§5.2/§8.2、DD-89 与 `.design/13` §4 的原
   binding、受权读取和 UNKNOWN 语义。重新以只读 Git 核验 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/restv2/api-lookup.go::Handler.GetByUuid`、`Handler.Lookup` 和
   `gateway/restv2/api-versions.go::Handler.NodeVersions`；它们提供当前 UUID、
   目录和真实 VersionId，不提供按平台执行 key 查询旧读取完成的原生任务。
2. 影响面是原 execute/observe HTTP 分发、新 `node-execution.mjs` 与原
   `service-list.mjs::nativeListing` 的两个实际消费者。业务路径校验原
   HUMAN/AGENT、ResultExposurePolicy、AGENT delegation；HUMAN 还核原冻结
   EE/idempotencyKey，再经 binding 自己的 client_credentials 调 fresh PEP。
   可信 targetResource 必须匹配原 resource、受控 validation 的 native instance
   与固定 native Workspace，随后按原 root/UUID 完整列举两遍并检查一致性。
   最终再验 token、PEP 与同一原生目标；没有新的契约、迁移、状态或身份目录。
3. SERVICE canonical envelope、文件字节、完整列表合同及 SOURCE 回执保持原状。
   HUMAN/AGENT 列举只返回确认的 execution 原引用/状态，不把组件间 raw items、
   文件正文、临时 URL 或第二目录塞进 Core，也不补造 SOURCE/RECEIVER 回执。
   调用方原参数顺序不决定授权，原 typed arguments 的 canonical hash 才决定。
   原生页面、菜单、上传/分享/删除、PAT/文档编辑、三端宿主与凭据路径未改动。
4. actor 混用、策略/委托/EE/key 缺失、租户或 Workspace 不匹配、native instance
   或 scope 错配、未知/缺失可信资源、目录中途变化、末次 PEP 拒绝或目标变化
   都不能外发成功观察。丢 ACK 的原 node 观察仍绑定原 EE/key/策略并经 fresh
   PEP，但没有读取完成证据时保留既有 UNKNOWN；不再列举、不读取正文、不借
   PAT、不以“对象仍在”推断旧执行成功。错误沿原 Refused/redacted 失败路径与
   Core 六类分类处理，未知不会变成失败或完成；无新增待终结状态。

实现后复用原 `kailo-wren-query-sdk-itgs2n` 与原独立小候选，实际 UID/GID 为
1000:1000、4 CPU/4 GiB、swap 0、Node v24.21.0。开始前主机约 11 GiB
available、Data 294 GiB、根盘 82 GiB；容器无在途工具进程。资源检查发现宿主
另有 GitNexus 索引进程，已反馈主代理，本队未调用或操作它。没有安装、下载、
新镜像、全树快照、Go/Cargo 构建或数据库操作。三个原入口语法检查 exit 0。

```sh
node --test --test-skip-pattern='HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects' \
  file-storage/adapter/test/query-revision.test.mjs
positive (handle 60374): exit 0; 250 passed, 0 failed
private production mutation (handle 8470): exit 1; 239 passed, 11 failed
byte-restored (handle 89608): exit 0; 250 passed, 0 failed
```

私有候选同时破坏四处生产保护：native instance/scope 关联、HUMAN 冻结 EE/key、
两遍完整列举比较、无旧完成证据时 UNKNOWN。原检查与 fixture 不变，实际捕获
7 个子项失败及其 4 个父项失败；不把父子合计 11 称为 11 个独立漏洞。正式源码
未被破坏；恢复后九个实际 import/检查输入逐文件 cmp 一致，原目标复验通过。
`git diff --check` exit 0；最终 cgroup memory.events 的 OOM 计数均为 0。

日志保留在原候选
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`：

| 日志 | SHA-256 |
|---|---|
| `cells-business-node-positive-initial.log` | `562c7dfa504512fe32c2328f51242cf6f908b49eae191901165d56287881e77f` |
| `cells-business-node-mutation.log` | `31bea11f940beb561a451b5192603eebecd58d1f4d30853c1f7920a677d7d2c7` |
| `cells-business-node-restored.log` | `343104d545727f89890e4885353b4c8e9cbc655e1415898e2a548911b351eb51` |

交付边界：本批证明原 HTTP 业务列举/观察消费者，不证明完整 FILE_STORAGE
工具可发布。`file_storage.read@v1` 仍只使用既有 SOURCE 字节合同，未发明给
Core 的 base64/正文 schema；业务 list 没有把 SERVICE list_output 充当工具结果。
原生读取丢 ACK 后仍缺按 key 查证终态，不能据此通过终态 conformance 或强制
ACTIVE。原 SDK 缺 xml2js，上述两项 ONLYOFFICE 目标明确排除；extract_usage、
完整契约登记/终态套件、live release/binding、实际 Cells→WeKnora E2E、页面截图、
full、四侧生成、Windows/Mobile、镜像与部署均不在本批通过范围。

## HUMAN/AGENT read/list 实际结果生产者（2026-10-08，未部署）

本批接续上述 HTTP 业务消费者，修正只返回执行状态、没有工具结果的缺口。
它不将前一批的状态观察证明冒充 MCP 工具已上线，也不将 SERVICE 的完整目录
传输合同注册成文件工具输出。

四步影响结论：

1. 权威沿 `.design/07` §5.2/§8.2、`.design/18` 的源服务正文/版本权威与既有
   ResultExposurePolicy。重新只读核验 Cells 固定
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/restv2/api-lookup.go::Handler.GetByUuid`、`Handler.Lookup` 及
   `gateway/restv2/api-versions.go::Handler.NodeVersions`；实际使用 UUID、原生
   VersionId 与带该版本的受控预签名下载，不创造读取任务或正文存储。
2. 影响原 `node-execution.mjs::executeNode`、`service-read.mjs::readFile` 与
   `query-revision.mjs::verifyToken`。两个真实文件读取消费者共用 `nativeFile` 的
   原生版本下载，身份校验、最终授权和结果/回执各留在自己的原调用方。
   业务 list 返回既有消费结构 `{citations: ContentReference[]}` 的 resultJson；
   非空时另带完全相同的 typed contentReferences，空列表不带该 typed slot。
   业务 read 接收完整五字段 ContentReference，返回严格 UTF-8 `{text}` 与同一
   typed contentReference。HUMAN 的原 query_revision 允许该业务策略对，仍需
   原 actor/scope/hash/fresh PEP；PAT NONE 和 SERVICE 身份不因此放宽。
3. Core `application_tool.rs::success`、`output_value` 和 `citation_output` 只沿
   原结果策略、固定输出 schema 与逐引用 revision 复核消费结果；本批没有修改
   它们、公共契约或能力登记。文件正文只在原受授权即时结果中流转，不复制到
   Core 持久库。SERVICE canonical envelope、字节传输及 SOURCE 回执不变，
   HUMAN/AGENT 不补造组件间回执。原生 UI、独立入口、ACL、页面与三端不改。
4. 实际检查覆盖 Unicode、保留 BOM、空文件、非法 UTF-8、缺失固定版本、JSON
   转义后的完整响应超限、下载后的原生移位、平台撤权、最终目标变更及引用
   策略缺失。任何拒绝均不外发正文/终态成功或 SOURCE 回执；read 最后再次
   查询原 UUID/root 与 fresh PEP，list 仍比较两遍原完整列举。原 node 丢 ACK
   观察仍 UNKNOWN、无重读/重列举或假完成，无新增状态/重试权威。

实现后复用原 `kailo-wren-query-sdk-itgs2n` 和原独立候选，UID/GID 1000:1000、
4 CPU/4 GiB、swap 0、Node v24.21.0；与 Wren 使用不同输入目录。运行前主机
约 17 GiB available、Data 294 GiB、根盘 82 GiB，无本队在途构建；只有原 Node
目标，没有安装、下载、镜像、Go/Cargo 编译、新数据库或全树复制。四个本批
源/检查输入语法检查 exit 0。

```sh
node --test --test-skip-pattern='HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects' \
  file-storage/adapter/test/query-revision.test.mjs
positive (handle 85031): exit 0; 267 passed, 0 failed
private production mutation (handle 89525): exit 1; 258 passed, 9 failed
byte-restored (handle 28745): exit 0; 267 passed, 0 failed
```

私有候选破坏五处生产保护：typed citations 关联、严格 UTF-8、完整响应预算、
读后原生 scope 复核与 HUMAN 引用策略。原检查和 fixture 未修改，抓到 6 个
独立失败断言及 3 个父项失败；缺失策略/移位/非法字节/超限实际错误放行为 200
而被原断言拒绝。正式树从未破坏；恢复后九个实际 import/检查输入逐文件 cmp
一致，同一原目标再通过，`git diff --check` exit 0。最终 cgroup memory.events
各 OOM 计数为 0，共享容器 memory.current 快照 526565376 bytes；命令均终态。

日志仍在原候选
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`：

| 日志 | SHA-256 |
|---|---|
| `cells-business-result-positive.log` | `30ce4b0aad67f9acc328d6dd545167172b8f83066d1763a7f98f3fb4e81f6fb4` |
| `cells-business-result-mutation.log` | `46e4485fb91e7c673020df1247d62c32b55af30ec43388448d2e922128269c36` |
| `cells-business-result-restored.log` | `cf7c54b62d0852dea504a71c57c9e4c355150ca589a95e67da79b20c27f59b56` |

交付边界：本批是原 HTTP read/list 的结果生产者，不是 AgentGateway MCP
transport/工具注册验收；现适配器尚无 MCP server 消费其 Gateway transport
身份，未手写 MCP 协议绕过。文本格式沿已有结构，不以知识能力冒充文件能力
登记；二进制结果合同及编码未实现。原生读取仍无按 key 查旧终态的证据，不能
因此通过完整终态 conformance 或强制 ACTIVE。SDK 缺 xml2js，上述两项
ONLYOFFICE 目标明确排除；full、四侧生成、extract_usage、live release/binding、
实际 Cells→WeKnora E2E、页面截图、Windows/Mobile、镜像与部署本批未执行。

## 同 Adapter 的真实 Streamable HTTP MCP（2026-10-08，未部署）

本批将前节已核验的原生 read/list 结果生产者接到同一个 adapter HTTP server，
复用 `knowledge/adapter` 已锁定的 `@modelcontextprotocol/sdk` 1.26.0，而不是
手写 JSON-RPC、另建 MCP 服务、工具注册表或执行权威。未投递 `mcp` 时没有
MCP 路由，不改变原 HTTP 协议、SERVICE 读取、独立 Cells UI 或数据库。

四步影响结论：

1. 权威沿 `.design/07` §5 与 `.design/08` §9.2：知识组件继续复用其原生 MCP，
   本批仅接 Cells 原 REST node 消费者。重新只读核验 AgentGateway 固定
   `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
   `crates/agentgateway/src/http/auth/jws.rs::JwtSigningAlg::header` 和
   `SigningKey::encode`；实际 ES256/kid JWT 与原公共 `verifiedClaims` 对齐。
   Cells UUID/版本仍沿前节固定 `c57f02f4962835447df694c63bd0fd8c22bd7baf`
   原生接缝，没有新的上游创建、取消或终态声明。
2. 影响 `src/mcp.mjs`、原 `configuration/createAdapter`、原 HTTP fixture 与包锁。
   Core `application_binding_gateway::publish` 投递独立 Gateway transport 身份；
   `service_auth::adapter_backend_auth` 将它放在
   `x-kailo-gateway-authorization`，受众仍是该 binding 的 adapter audience。
   `agent_tool_pep::Policy::request` 只转发 input，另投 ActionToken 与执行 key；
   adapter 按可信 token target 重建原 `{target:{resourceId},input}`，交原
   `executeNode` 校验 hash、actor/delegation、scope、ResultExposure 与 fresh PEP。
3. 所有 MCP 请求（含初始化、notification、list）先验 Gateway 签名、独立
   issuer/JWKS、固定 sub/azp、audience 与投递有效期上限；业务 call 另验原
   ActionToken、同一 key、批准 name→action/version，再经原生读取后的最终
   Gateway 身份检查。返回 `content:[]` 与原 AdapterExecutionResponse 的
   structuredContent，不单独外发未过 Core response PEP 的 text。Core 原
   `application_tool::list/disclose` 仍核批准 input schema、终态、引用和结果策略。
   包锁原样复用知识 SDK 依赖树并保留 Cells 的 xml2js/sax/xmlbuilder 锁定项。
4. actor/transport 混用、缺令牌/key、委托/策略丢失、scope/hash 篡改、action/version
   错配、未知工具/模型自选 native URL 均在原生读取前拒绝；读后 Gateway key
   撤销不暴露缓冲结果。SDK 负责 stateless 初始化/HTTP framing，不保存新 session
   或任务状态；原 node UNKNOWN、丢 ACK 不重放和取消边界不变。原生/鉴权错误
   只返回固定 redacted 拒绝，不返回 provider body、凭据或结果正文。

实际私有配置由原受控 adapter 投递面提供：可选 `mcp` 包含 `path`、
`gatewayIssuer`、`gatewayAudience`、`gatewayJwksFile`、`gatewayCaller`、
`gatewayMaxTokenSeconds`、`tools`；audience 必须等于顶层 actionTokenAudience。
tools 每项为 `name/actionKey/actionVersion/inputSchemaDigest/inputSchema`，可有
description；只接受原 management.validation.actionVersions 中已实现的 read/list
精确映射、唯一 name/action/version 与正确 canonical schema SHA-256。无批准
元数据、配置缺失或漂移不生成工具入口，不从模型参数取身份、凭据或原生地址。

实现后复用原 SDK/独立候选，实际 Node v24.21.0、UID/GID 1000:1000、
4 CPU/4 GiB、swap 0；运行前主机约 22 GiB available、Data 294 GiB、根盘
93 GiB，无本队在途构建。直接使用原 `/work/node_modules` 中 SDK 1.26.0，
无下载/安装、镜像、数据库、Go/Cargo 构建或全树复制。三个源/检查语法目标
exit 0；原测试通过真实 `Client/StreamableHTTPClientTransport` 完成 init/list/call，
不是只构造 raw JSON 冒充 MCP。

```sh
node --test --test-skip-pattern='HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects' \
  file-storage/adapter/test/query-revision.test.mjs
positive (handle 35157): exit 0; 297 passed, 0 failed
private production mutation (handle 16303): exit 1; 284 passed, 13 failed
byte-restored (handle 70039): exit 0; 297 passed, 0 failed
```

私有候选同时破坏五处真实生产保护：批准 schema digest、Gateway caller/TTL、
ActionToken key 关联、读后 Gateway key 复核及只用 structuredContent 的结果通道。
原检查和 fixture 未变，捕获 10 个独立失败断言及 3 个父项失败。正式树未破坏；
恢复后十二个实际源/检查/依赖锁输入逐文件 cmp 一致，同原目标复验通过。
`git diff --check` exit 0；最终 cgroup OOM 计数均为 0、memory.current 快照
218112000 bytes，全部本队命令终态。

日志保留在原候选
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`：

| 日志 | SHA-256 |
|---|---|
| `cells-mcp-wire-positive-initial.log` | `8a04c77f7b6ddb01cb526aeea9c24dcaca5fb0ca5379832f9a29787a5c1f543f` |
| `cells-mcp-wire-mutation.log` | `45539881390edceb62b47187e93941e870274e9a8796a41bedae76950e47585b` |
| `cells-mcp-wire-restored.log` | `ce5b5aa8974ac32e2efd4f3b999ee9e47669207cbffdafd596f1539c99a4e269` |

边界：这里证明原受限 SDK 客户端与同 adapter 的实际 wire/原生消费者，不是
真实 Gateway/Codex/live release/binding 全链；批准 FILE_STORAGE 工具登记及
配置投递仍由原平台目录承接。二进制结果、按 key 证明旧读取终态及完整 usage
conformance 未在本批补造。SDK 缺 xml2js，上述两项 ONLYOFFICE 目标继续明确
排除；full、四侧生成、实际 Cells→WeKnora E2E、截图、Windows/Mobile、镜像、
部署和安装验证未执行；继承的 compose 脏改未修改。

## 原生版本列表与完整二进制导出（2026-10-08，未部署）

本批沿现有 node execute/MCP 消费者补齐 `file_storage.list_revisions@v1` 与
`file_storage.export@v1`，同时为原 read 及两项新结果建立六份能力 schema，
不是新建文件目录、任务、执行回执或存储权威。前节“二进制结果未实现”由
本节源码与专项证据更新；完整 FILE_STORAGE release、Core 历史引用消费及
真实业务激活仍未完成，不能由本节通过数推导为可发布。

四步影响结论：

1. 权威为 `.design/07` §2.4、§5、§8A、`DD-89` 与 `.design/08` §9.2。
   只读重新核验 Cells 固定 `c57f02f4962835447df694c63bd0fd8c22bd7baf`：
   `gateway/restv2/api-versions.go::Handler.NodeVersions` 按真实 UUID 读取原生
   版本流、只在完整迭代后返回 VersionCollection；
   `gateway/restv2/api.go::Handler.TreeContentRevisionToVersion` 返回真实
   VersionId/Draft/IsHead，并按同一 VersionID 生成固定版本预签名读取。
   `.references` HEAD 与上述基准一致；未在证据树执行代码。
2. 影响原 node/service-read/query-revision/MCP 与原 HTTP 检查：共享现有
   action 集合，不复制执行链。HUMAN/AGENT 保持各自签名 actor/delegation、
   同一 key、Resource/scope/binding/generation、ResultExposure 及前后 fresh
   PEP；SERVICE 自拉读取的 claims、列表/双边回执合同没有混用或改名。
   `contracts/adapter/file_storage.v1/` 的 read/list_revisions/export 六份
   input/output schema 经原生成器投影到四侧；未建立部分能力 registration
   或更改 Core seed，没有迁移、旧正文读路径或新增不安全开关。
3. 原生版本消费者要求唯一非空 VersionId、确定 Draft/IsHead、唯一已发布
   head、可信 native MIME/文件名；所有草稿从平台引用中剔除，完整列表前后
   比对一致后才返回。原 read/export 固定所选原生 VersionId，不以当前 head
   替换；export 沿已有即时 export 结果结构输出精确 base64，支持空文件与
   非 UTF-8 字节，不外发预签名 URL/owner/凭据、不将正文落到 Core 持久库。
   结果沿原 AdapterExecutionResponse typed ContentReference 与策略通道，
   计入 base64/JSON 开销后限流；读取后再核原生 UUID/root 与 fresh PEP。
4. 空/畸形/重复/未知原生版本、丢失冻结版本、集合变化、scope/key/policy
   错配、撤权、原生移动和超限均确定拒绝，无正文或假终态；未知结果不回放。
   原 read/list 没有按平台 key 持久观察完成证据时仍返回原 EE 的 UNKNOWN，
   不重读正文、不借 DOCUMENT/PAT 观察，不伪造取消或 usage。原生独立 UI、
   ACL、数据库与上传/分享功能均未精简。

实现后原 Node/真实 SDK 专项使用前节原候选、Node v24.21.0、SDK 1.26.0、
UID/GID 1000:1000、4 CPU/4 GiB、swap 0。原目标实际读取本批 input schema
文件作为受控工具元数据，并通过真实 SDK Client/StreamableHTTPClientTransport
完成两种 actor 的 initialize/list/call；没有手写 MCP wire 或测试专用路径。

```sh
node --test --test-skip-pattern='HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects' \
  file-storage/adapter/test/query-revision.test.mjs
final schema consumer (handle 92975): exit 0; 335 passed, 0 failed
private production mutation (handle 23263): exit 1; 310 passed, 25 failed
byte-restored (handle 37568): exit 0; 335 passed, 0 failed
```

私有候选同时破坏五处生产保护：剔除草稿、精确冻结版本、完整列表二次比对、
二进制 base64 编码及 export 读后原生 root 核验；原检查/夹具不变，捕获
17 个独立失败断言和 8 个父项失败。正式树未破坏，恢复后 18 个实际输入
逐文件 cmp=0。早期一次检查错误地把 target/hash 漂移预期为 401，而原 fresh
PEP 确定拒绝为 503；原失败 332/3 日志保留，修正断言后才形成上述最终证据。
SDK 缺 xml2js，两项 ONLYOFFICE 目标继续明确排除，不以输出 skipped=0 隐去。

随后复用原 `kailo-agent-receipt-xvkujx`（4 CPU/8 GiB、swap 0、同 UID/GID），
两容器镜像均为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
原 `bash tools/gen.sh` 与 `bash tools/gen.sh --check` 均 exit 0，四侧新增
生成类型共 454 行；没有手工编辑正式生成物。原四侧 roundtrip 仅追加本批
六类型的同一真实载荷样例，保留已有 dirty 检查内容。

```sh
cargo test -j16 --offline --locked --manifest-path core/Cargo.toml -p contracts --test roundtrip
(cd worker && go test ./internal/contracts -count=1 -v)
(cd client-kit/ts/contracts && ./node_modules/.bin/tsc --noEmit -p tsconfig.test.json && \
  node --test --experimental-strip-types 'test/**/*.test.ts')
(cd client-kit/dart && dart test test/roundtrip_test.dart --reporter expanded)
positive: Rust 45 / Go 37 top-level / TypeScript 53 / Dart 45 passed; all exit 0
private generated-field mutation: Rust exit 101, Go exit 1, TypeScript exit 2, Dart exit 1
byte-restored (handle 32024): same four full targets passed; all exit 0
```

四侧私有生成类型各破坏一次 export 的 contentBase64 字段；Rust/Go/Dart 原
新增断言各实际失败 1 项，TypeScript 原 tsc 报 2 处确定字段错误。检查与样例
未改，恢复后九个本批生成/检查/样例输入 cmp=0。兼容核验复用原
`tools/check.sh::step_contract` Python 比较规则，SDK 无 Git 元数据，仅读取
正式 Git 导出的 `contracts-v0.1.0`（`0ecbdc17984f0cfed36b7c7b8605c3f0532db3c0`）
旧 `apps/contracts` 树替代原 Git reader；当前输入包含六份新增 schema。
实际 290 个 schema、匹配 3 个历史 schema、无破坏性变更，exit 0。首次误以
新目录 `contracts` 导出旧 tag 时原 Git 报 `fatal: pathspec 'contracts' did not match any files`；
按实际 ls-tree 修正旧路径后才比较，未把读不到旧目录称作“无基线”。没有
运行会安装依赖的 prepare_check_dependencies，也未复制/改写 Git 元数据。

本轮没有安装、下载、镜像、新数据库或全树快照。执行前 available 约 19 GiB、
Data 295 GiB、根盘 97 GiB，检查实际限额后才执行；Cargo 保留 -j16。
Node cgroup OOM=0，Core SDK 既有 oom/oom_kill=2 本轮前后无增加，最终
memory.current 快照分别为 257998848 / 1017483264 bytes；命令均终态。

Node 日志沿前节原候选，文件名与 SHA-256：

| 日志 | SHA-256 |
|---|---|
| `cells-file-revisions-export-contract-positive.log` | `90dce9c089e0ac466367a407538f1156f8da83549883c488c2f2ab46adc6e61f` |
| `cells-file-revisions-export-contract-mutation.log` | `9dc2138be8c534fce38904121b90f5fff95bf3c70f4daa9496cf723918c0e8fc` |
| `cells-file-revisions-export-contract-restored.log` | `3ec3623606882d69dc0a2290d79397ee84786198ec0d6bed84b3bcc51b2e29f2` |

生成、兼容与四侧日志在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/`，前缀为
`cells-file-storage-`；`four-side-gen.log`、`four-side-gen-check.log`、
`contract-compat.log` 与 `roundtrip-{rust,go,ts,dart}{,-mutation,-restored}.log`
均保留。恢复日志 SHA-256：Rust
`605779d52dac31ccca30813e43d422371fe4e1e62e6bffee611b4e90076822ca`，Go
`af4f4a3c543f6423309ef5df3f1b61689f509f7e56efcab00ef8a8c40f908579`，TypeScript
`bebb58544c9bc40979a03d1e72e4e32f949ff84c5beb4022ffe9a78fb9e64e6f`，Dart
`4f3aed66c9bb134a4e7ef0365efa3f92091afd186be9de30115511233c00e44b`。

交付边界：Core `application_tool::verify_content_reference/require_current_revision`
目前按 query_revision 当前 head 核验每个引用，本批没有擅改该既定语义；返回
历史版本的 adapter 专项通过不等于 Core 历史版本结果可用。FILE_STORAGE v1
完整七项必选能力的批准 catalog/registration、平台 write/delete/share、安全
按 key 观察/完整 usage 仍有缺口，不将四项 node 能力冒充完整 release；原条件
删除阻断没有重开。full、真实 Gateway/Codex、live release/binding、实际
Cells→WeKnora E2E、页面截图、Windows/Mobile、构建发布和部署均未执行。

## 原生上传与共享写结果传播（2026-10-08）

本节是实现后的专项事实，不是平台 write/share 完成声明。四步影响复核：

1. 权威仍为 `.design/07` §5.2/§8A、独立组件原生业务边界及固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`。只读核验该 commit 的完整
   原路径与符号：`common/nodes/version/handler-version.go::Handler.PutObject`、
   `Handler.MultipartComplete`、`Handler.routeUploadToContentRevision`，
   `data/versions/grpc/handler.go::Handler.StoreVersion`，以及
   `idm/share/rest/handler.go::SharesHandler.PutCell`。原版本服务吞掉 DAO 错误，
   原分片完成错误返回了另一变量，上传不核版本存储确认，原共享根校验也误返
   旧错误变量；本批直接修正这些已有消费者，没有另造任务或执行权威。
2. 影响仅为原上传 wrapper、原版本 RPC 和原共享 REST，附三个原模块检查。
   普通上传/分片完成消费真实 `ObjectInfo.Size`；两调用方共用精确的
   StoreVersion 确认，要求 Success 和原 ContentRevision 一致。原创建返回的
   VersionId、Draft、Location/datasource 完整且匹配后才上传。未改契约、表、
   迁移、认证、原生 ACL、独立入口、UI、配置或上架状态；未碰继承的 compose
   改动，也没有不安全开关。
3. StoreVersion 的真实 DAO 错误原样返回，未落盘不报 RPC 成功；共享根目录
   校验错误不再报空成功。对象写入后存储确认丢失/失败仍可能结果不明，本批
   不重复上传、不猜版本、不造完成收据或回滚证明。原分片缓存清理行为未改，
   不因此声称其重试/对账已成为平台可用的 write/share 终态合同。
4. 实际检查包括空/中文内容、上传前未知 Size、精确 owner/node/version、创建
   引用畸形、版本存储失败/缺确认/确认错版本或大小、对象写错误与空共享根。
   原生无 versioning policy 仍返回 Success=false，上传消费者拒绝把它当已
   存储；没有把拒绝、未知或旧引用转换为假成功。独立 UI 的原功能和 ACL 保留。

沿已有 `kailo-cells-native-check-lftow7`，Go `go1.26.8 linux/amd64`、
UID/GID 1000:1000，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`。
实际 cgroup CPU=4、memory=8 GiB、额外 swap=0；每轮先核现有进程和内存，
可用内存约 10–13 GiB、Data 295 GiB，始终复用原 mod/build cache。没有创建
镜像、数据库、工具链或全树快照。按主线要求用原 Go 配置补拉已锁定的缺失
依赖，`-mod=readonly`，正式/候选 go.mod 与 go.sum 最终 cmp=0；没有换版本。

```sh
CELLS_WORKING_DIR=/tmp/cells-write-check CELLS_DATA_DIR=/tmp/cells-write-check \
go test -mod=readonly ./common/nodes/version ./data/versions/grpc ./idm/share/rest \
  -run 'TestDraftUpload|TestKailoNative|TestPutCellRejectsInvalidRoots|TestGetCellRequiresReadAccess' \
  -count=1 -v
positive (handle 77985): exit 0; 6 top-level + 27 subtests passed
private production mutation (handle 11160): exit 1; 4 top-level + 16 subtests failed
byte-restored (handle 56250): exit 0; 6 top-level + 27 subtests passed
```

生产破坏只在私有候选三个生产路径中进行：吞掉 DAO 错误、关闭准确存储确认、
去掉两处真实 Size 回填、恢复分片误返变量、放宽原创建引用、恢复共享根校验
误返变量，共七处。原检查与夹具字节不变；失败分别抓到两种 draft/published
DAO 错误、八种坏确认、未知/分片大小、分片对象错误、三种坏创建及空共享根。
正式树未破坏，恢复后三个生产/三个检查输入逐文件 cmp=0，最终 cgroup
oom/oom_kill 均为 0，memory.current=1529839616 bytes；全部命令已终态。

首轮 handle 44042 exit 1，临时 GOPROXY=off 使共享包缺已锁依赖，候选漏同步
已提交 `common/proto/tree/native-head.go`；分片夹具还复用了原 WithBranchInfo
会改写的请求 context。第二轮 handle 59265 正常拉取依赖后仍 exit 1：新增
DAO 故障夹具只改变旧实例，而原 manager 每次 Resolve 重建 DAO。分别最小
同步原文件、按真实分片完成新请求恢复 source context、共享原 factory 故障
引用后，才形成上述最终字节证据；未以失败轮次冒充验收。原 GetCell 既有
Role lookup 打印堆栈但原目标 PASS，该输出完整保留，未为本批隐藏或更改。
StoreVersion 成功路径实际读回原 Bolt 存储；DAO 失败通过原接口故障注入，
上传/共享检查使用原生成 RPC stub，不把它们称作线上组件 E2E。

日志位于 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 日志 | SHA-256 |
|---|---|
| `cells-native-write-persistence-positive.log` | `a0b4029a23732523e1e34a54b3410162cc8c6588f5be774651600a6789df1458` |
| `cells-native-write-persistence-positive-final.log` | `a5a5d7575897119d6be133af0996ddea93b54e7eabe9b2f164928c43d0f9d828` |
| `cells-native-write-persistence-positive-validated.log` | `10a41406b2e15e0389befc69385afc8ab931b39f5fbdd07fbbc57c8699fda454` |
| `cells-native-write-persistence-mutation.log` | `181d60b6b5602ec456283fe6c13023c4e641142c027a590cdbd052c1f4491f4b` |
| `cells-native-write-persistence-restored.log` | `80abde8f3f920a59edf13e96852f660e9a91048e02150847b4d7891ef6129e71` |

本批没有新增/启用 adapter write/delete/share；完整七项 FILE_STORAGE catalog、
按 key 观察终态、原子条件删除与平台写入幂等/usage 仍按前节缺口处理。
三包仅执行上述筛选目标，未跑完整 Cells、check.sh --full、Gateway/Codex、
真实 binding、Cells→WeKnora E2E、浏览器/安装包验收或部署，不将原生修复
当作平台完整组件上线。

## 原生版本引用与任务持久回执（2026-10-08）

本节记录原生写入依赖链的实施后事实，不代表平台 write/share 或按 key 执行
去重已经完成。四步影响复核：

1. 权威为 `.design/07` §5.2/§8A 及原生任务作为 ExternalExecution 的边界。
   固定官方 commit `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的原路径/符号
   已用只读 git 核验：`data/versions/dao/bolt/bolt.go::BoltStore.StoreVersion`
   每次 NextSequence 插入，同路径 `BoltStore.GetVersion` 首条匹配即返回；
   `data/versions/dao/mongo/mongo.go::MongoStore.StoreVersion` 每次 InsertOne，
   `MongoStore.Migrate` 原为空；`scheduler/jobs/grpc/handler.go::JobsHandler.PutTaskStream`
   对中间态/Error 先 ACK、后批量落库，断流不 flush，失败还 SendMsg(error)
   后继续。`scheduler/tasks/reconnecting-client.go::ReconnectingClient.chanToStream`
   实际等待该 ACK，失败时重送同一原生状态写入；本批直接修真实生产者。
2. 原 Bolt 节点桶事务内固定 VersionId：完全相同的 ContentRevision 重复确认
   不新增行或更换 head，变更 owner/content 或已有同 ID 多行返回原 Conflict；
   GetVersion 不再从歧义旧行中挑一条报成功。Mongo 复用原 versions collection，
   原 Migrate 建 `(node_uuid, version_id)` 唯一索引；只有真实 duplicate-key
   且原 GetVersion 精确相同才确认。保留原首次/版本变化 StorageMigration
   入口，没有新表/账本或修改 Core 合同；Mongo 迁移遇旧重复必须失败停发，
   不删行、不静默覆盖。该迁移没有在实库运行，不能据编译声称索引已生效。
3. 原 PutTaskStream 统一调用原 PutTask，所有状态先 DAO 提交，再原事件/ACK；
   去掉流内旧批缓冲、Job cache 及其死字段/关闭方法。每条重新查原 Job，
   缺原 task/job 引用拒绝；存储/收流/发 ACK 错误原样返回，Job 读取结果不明
   不再伪装 JobNotFound。EOF 正常结束，丢 ACK 后原任务记录可读；原客户端
   重送状态不创建第二原生 task。没有因此保证执行 exactly-once，原事件可
   重复；没有新增重放、回滚、取消或完成收据权威，也未改变独立原生 ACL/UI。
4. 检查实际覆盖 16 个并发相同版本、四种 actor/content 冲突、其他节点同 ID、
   空引用、旧重复行，以及 Running/进度/Error/Interrupted/Finished 的落盘
   时序、存储失败零 ACK/事件、丢 ACK 后原引用、Job 删除后重新核验和未知
   Job 读取错误。旧 ChangeLog 编码、CRUD/删除原 33 assertions 保留通过。
   没有契约、调用字段、SecretRef、平台主体/权限、页面、菜单或部署变更。

复用原 `kailo-cells-native-check-lftow7`，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
Go `go1.26.8 linux/amd64`、UID/GID 1000:1000，实际 cgroup CPU=4、memory=8 GiB、
无额外 swap。每轮先查现有进程及压力，宿主 available 约 17–19 GiB、Data
约 294 GiB；原缓存/候选继续使用，未创建镜像、数据库、工具链或整树副本。
只同步五个本批源码/检查输入；恢复后逐文件 cmp=0，检查文件没有参与破坏。

```sh
CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
go test -mod=readonly -tags=kv ./data/versions/dao ./scheduler/jobs/grpc -count=1 -v
final positive (handle 18710): exit 0; 5 top-level + 14 subtests passed
private six-guard mutation (handle 96702): exit 1; 4 top-level + 3 subtests failed
private pre-commit ACK mutation (handle 77809): exit 1; 4 top-level + 3 subtests failed
byte-restored same target (handle 94286): exit 0; 5 top-level + 14 subtests passed
```

六保护破坏仅在私有候选中关闭 Bolt 同键判定/歧义读取、task/job 引用校验，
吞掉 Task 存储错误、恢复未知 Job 读取伪 missing、吞掉收流错误。第二次在
同候选真实 DAO 调用上复现“仅 Finished 落库，其余先 ACK/事件”，检查立即
抓到未持久任务；没有修改检查使其故意失败。两个失败原件和最终恢复均保留。
实际 fixture 仅 Bolt：原测试会过滤未配置的 Mongo fixture，Go 输出没有 SKIP
标记不等于 Mongo 实库通过。Mongo runtime/unique-index migration/冲突与
并发实库验证均明确 SKIP，未新造 Mongo 服务。最终 cgroup oom/oom_kill=0、
memory.current=1321623552 bytes，所有命令已终态，无在途构建。

日志仍在 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 日志 | SHA-256 |
|---|---|
| `cells-native-version-task-final-positive.log` | `b7d2f31d18f42f026328953e09f735cbe39f10021c0b61d34d9c5bb7fe5f11d5` |
| `cells-native-version-task-mutation.log` | `90503a039583f4d0f2f5ff7d0cd16c1d055620da9efe1e63b784fa74d2f2cc41` |
| `cells-native-version-task-before-commit-ack-mutation.log` | `5e8db68c153363d325ba81fee12cf2f516f9da1bdae511a42203677ac830f683` |
| `cells-native-version-task-restored.log` | `1ae233ea10b4dc838f2e8415377496ca387430aed788727e2749aa4911321291` |

尚未闭合完整 FILE_STORAGE 七项批准 catalog、平台 write/delete/share 的可信
actor/generation 与按 key 终态/usage、原子条件删除。版本 DAO 同键确认不
等于 StoreVersion 发布后的 pruning 或整个对象上传副作用已经幂等；原生
Task 状态持久化不等于 Job 派发已去重。full、真实 Gateway/Codex、live binding、
Cells→WeKnora E2E、浏览器/安装包验收、镜像构建与部署均未运行。

## 原生后台版本保存的真实持久确认（2026-10-08）

本批直接修复原后台版本写入消费者，不声明平台 `file_storage.write/share`
已经接通。四步影响复核：

1. 权威仍为 `.design/07` §5.2/§8A 的真实终态及原生任务边界。只读核验固定
   commit `c57f02f4962835447df694c63bd0fd8c22bd7baf`、完整上游路径
   `data/versions/action-version.go::VersionAction.Run`：原 `CopyObject` 成功后
   提前追加 Success，只有 `objectInfo.Size > 0` 才调用原 StoreVersion，且不核
   原 RPC 的 Success/Version。因此空文件复制没有版本元数据，未确认存储也
   可有成功输出。本批在 `apps/file-storage` 原模块修正，没有重写页面或执行器。
2. 影响为原 native scheduler version action→CreateVersion→CopyObject→
   StoreVersion→原 pruning。保留当前原生 claims→SearchUniqueUser 与原 ACL/
   router；创建结果必须带原当前用户 owner 和非空 VersionId，才进入对象写入。
   复制结果 size=0 正常保存，负 size 拒绝，持久 size 使用实际复制结果而非
   旧输入。原 StoreVersion 必须 Success 且完整 ContentRevision 相同后才追加
   Success、进入 pruning。没有契约、平台 actor、binding、配置或迁移变更。
3. 不接受缺失/错误版本、owner、size 或 false ACK，不在原存储错误时提前输出
   成功。没有创建新 Task/账本/回执权威；原 copy 与 StoreVersion 仍不是一个
   原子事务，也未由本批证明源内容 ETag、复制失败/未知结果及残留对象的全链
   收敛。不能拿本批当作 operation-key 去重、generation 或 usage 终态的证据。
4. 实施后新增检查直接调用原 VersionAction.Run 和原生成 RPC stubs，覆盖空
   文件、实际复制大小、存储错误、缺失/false/错版本/错 owner/错 size ACK、
   负大小、复制错误与创建 owner/ref 缺失。复制、身份查询和持久 RPC 在原
   接口边界受控注入；本批未使用真实对象存储/数据库，不冒充实库或跨服务 E2E。

沿用 `kailo-cells-native-check-lftow7` 原 Go 1.26.8/UID1000 SDK、镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
CPU=4、memory=8 GiB、无额外 swap，原缓存/候选不变。批前及恢复整包前核对
现有进程/资源，宿主 available 约 15–17 GiB、Data 约 292–294 GiB；没有新建
镜像、数据库、工具链或全树副本。正式生产和检查未被破坏，两个候选输入恢复
后逐文件 cmp=0；最终 oom/oom_kill=0、memory.current=933646336 bytes，命令
全部终态。

```sh
CELLS_WORKING_DIR=/tmp/cells-version-action-check \
CELLS_DATA_DIR=/tmp/cells-version-action-check \
go test -mod=readonly ./data/versions \
  -run TestVersionActionRequiresExactNativePersistence -count=1 -v
final positive (handle 26146): exit 0; 1 top-level + 12 subtests passed
private production mutation (handle 71589): exit 1; 1 top-level + 11 subtests failed
byte-restored same target (handle 1222): exit 0; 1 top-level + 12 subtests passed
go test -mod=readonly ./data/versions -count=1 -v
restored original package (same handle 1222): exit 0; 5 top-level + 12 subtests passed
original pruning/duration/change-log checks: 56 assertions passed
```

私有候选实际关闭 owner/ref、负大小、精确持久 ACK，恢复提前 Success、空文件
跳过与旧输入 size；原检查 11 个子项立即报错，原 copy-error 子项仍通过。没有
修改检查让它故意失败。首四轮原件保留：18983 为夹具 RPC 缺 CallOption 的编译
失败；17823 为原 mem driver 未注册；56031 为 config 注入没有使用原 Pool 的
panic；10086 为空 Path 被原 IgnoreNodeForOutput 当隐藏节点。只修复这些夹具
消费者后才取得最终正向，不能用失败轮次表示完成。

日志位于 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 日志 | SHA-256 |
|---|---|
| `cells-native-version-action-positive.log` | `59c51b400d27c2f9475855d437a5dcbe3573dbd32b0220daebc3ada9a2ae2404` |
| `cells-native-version-action-positive-final.log` | `a9fffd83dc2af035aa40f219cc41c50c99ec5b0064bd7b3816d2b0ae6acb05b1` |
| `cells-native-version-action-positive-registered.log` | `ba27088d178d3d940f08b4b22bdf683ecf2dc91d89d4cb5e6d875c73a513c04d` |
| `cells-native-version-action-positive-pooled.log` | `b470e67d85953d69ffa33757370384b7f3eb5896c0ae3e7b77fc3e05031a8934` |
| `cells-native-version-action-positive-actual.log` | `6d6e662a6402bafce6ac17a40f1d62f8114587e5e55aeafb94e0e595f8290d2a` |
| `cells-native-version-action-mutation.log` | `bab14a4d9ae5ec0153d22796ae7a8b8475f3d58b7d3183ddf89625fd9dfe598e` |
| `cells-native-version-action-restored.log` | `6d6e662a6402bafce6ac17a40f1d62f8114587e5e55aeafb94e0e595f8290d2a` |
| `cells-native-version-action-package.log` | `4ffbd7b346dc7f8c131596545d852ee8a32590403f53b55285b52f4195424b69` |

平台 generic PEP 尚无可信当前 native actor 事实，DOCUMENT 的 OIDC 会话事实
不能借用于 generic write；没有把固定实例 SERVICE bearer 冒充 HUMAN/AGENT。
write/share、条件删除仍未开放，没有新增或激活完整 FILE_STORAGE release。
full、Gateway/Codex、live binding、Cells→WeKnora E2E、截图、镜像和部署均未运行。
