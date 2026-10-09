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

## 四条平台读取动作的原生当前 actor 消费（2026-10-08）

本批补的是已有 HUMAN/AGENT read、list、list_revisions、export 的真实原生
身份消费者，不新增业务动作，也不借 DOCUMENT 的浏览器 OIDC 会话。前节
“generic PEP 尚无可信当前 native actor 事实”不能继续解释这四条读链：当前
Core `application_binding_pep.rs::check` 已逐一核对冻结 AE 的
actor/agent/initiating-human，并执行 fresh execution/source PEP；本批直接
消费该已存在权威，未要求 Core 新建 Cells 用户字段。

四步影响复核：

1. 权威为 `.design/07` §5.2/§8A、DD-89 与 DD-98：平台准入不替代原生 ACL，
   SERVICE 身份不冒充 HUMAN/AGENT。只读核验固定 Cells commit
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的完整原路径与符号：
   `common/auth/jwt.go::VerifyContext/WithImpersonate`、
   `common/middleware/authorizations/web-policy.go::HttpWrapperPolicy`、
   `gateway/restv2/api-lookup.go::Lookup/GetByUuid`、
   `gateway/restv2/api-versions.go::NodeVersions`。实现留在原模块/原 REST 路由，
   不新增影子业务 API、用户生产者、任务表、权限目录或页面。
2. 影响为原 executeNode→四个已有 native read/list/revisions/export 调用→
   原 JWT handler→绑定自己的原 OIDC client_credentials/PEP callback→
   原 User UUID 回读/锁定验证→WithImpersonate→原 API PolicyEngine→原 UUID
   ACL/router。adapter 在原验签/fresh PEP 之后才附瞬时证明，绑定原 ActionToken
   与 canonical arguments；原生每次都以该 binding 的受控凭据回调原 Core PEP，
   并核 AE/Operation/target、tenant、native instance/scope/root 与真实请求
   UUID。固定账号只认证 transport，映射只接受 exact principal/kind→已有 UUID；
   AGENT 不借 initiating HUMAN，也不编造 OIDC subject。原 HttpWrapperPolicy
   的 request producer 提取为两个实际调用者共用的 HTTPPolicyRequest，原 wrapper
   语义不变；切换 actor 后重新执行原 PolicyEngine，不能遗留 transport 管理权限。
3. 原生完成上述消费才返回 exact actor ACK；adapter 必须核该 ACK，旧服务器
   忽略证明时 fail closed，不向调用方披露内容。无证明仍是原独立 native UI 的
   身份/ACL 路径；SOURCE self-pull、管理动作、DOCUMENT 不被混入这套身份。
   不新增持久状态、正文副本或清理任务。证明在原 handler 中从 request header
   移除，异常不给上游 body/凭据；静态核验未见本工程代理/中间件打印全请求
   header，但未作线上反向代理日志审计，不能宣称全链日志已验收。
4. 缺映射/锁定用户/错 tenant、kind、principal、scope/重复映射/未知 native
   类型均拒绝；回调/原 API policy/原 ACL 任一不可确认均不降级。空列表及
   原空文件合同不变；大小和 deadline 沿原受限读取，重入只作原授权读取，
   不增加副作用；披露前仍 fresh PEP 与 revision 复核。六类沿 `apps/06` §4
   既有语义：权限为 DENIED，未开放动作 BLOCKED，配置/投影不成立 PRECONDITION，
   超限 LIMIT，revision/列表变动 CONFLICT；无按 key 原生终态证据的 observe
   仍 UNKNOWN，不重读、不重放、不开假成功。该批未修改公共契约或旧数据格式。

原生配置由已有 Cells config store 的
`services[common.ServiceRestNamespace_+"n"].platform` 受控投递，不从模型、
浏览器或 native response 选择：沿原 Delivery 的 `bindingId/corePepUrl/oidcTokenUrl/
clientId/clientSecretFile/instanceServiceUuid/requestTimeout/maxResponseBytes/
clientSecretMaxBytes`，补实际消费者所需的 `tenantId/nativeInstanceRef/nativeScopeRef/
nativeRootRef/actors[{principalId,kind,userUuid}]`。映射一对一，拒绝 SERVICE UUID、
组、隐藏用户、缺失用户和锁定用户；只引用预先存在的 native account，不保存平台
密码。未投递/未配置时平台证明请求拒绝；不是默认启用开关。未向 iframe 投递
SERVICE secret 或平台 Cookie。平台的原业务 ActionToken claims/契约没有扩展。

复用原 Node SDK `kailo-wren-query-sdk-itgs2n`（4 CPU/4 GiB/UID1000）与独立
小候选、原 Go SDK `kailo-cells-native-check-lftow7`（Go 1.26.8，4 CPU/8 GiB，
无额外 swap，UID1000:1000）、原缓存；没有新镜像/数据库/工具链/全树副本。
批前及恢复前核现有进程/CPU/内存，宿主 available 约 17–18 GiB、Data 可用
约 289–309 GiB。最终 Go memory.current=1023315968 bytes，oom/oom_kill=0。

```sh
node --test --test-skip-pattern="HUMAN execute selects ONLYOFFICE|ONLYOFFICE disclosure rejects" \
  file-storage/adapter/test/query-revision.test.mjs
positive handle 31291: exit 0; tests/pass=360/360, skipped=0
restored final handle 57096: exit 0; tests/pass=360/360, skipped=0
node --test --test-name-pattern="native actor proof is mandatory" \
  file-storage/adapter/test/query-revision.test.mjs
final-check-byte private production mutation: exit 1; pass=0, fail=25
byte-restored same target: exit 0; pass=25, fail=0

CELLS_WORKING_DIR=/tmp/cells-native-actor-check \
CELLS_DATA_DIR=/tmp/cells-native-actor-check \
go test -mod=readonly ./common/auth ./common/auth/protocol ./gateway/restv2 \
  -run "TestAuthorizeActionUsesOriginalBindingPEP|TestNativeActorUsesExactControlledUser|TestNativeIndependentReadDoesNotImpersonate|TestNativeActorPolicyDoesNotBorrowTransportProfile|TestResolveNativeActorUserRejectsMissingChangedAndLockedUsers" \
  -count=1 -v
positive handle 33814: exit 0; 5 top-level + 26 subtests passed
private production mutation handle 33616: exit 1; 4 top-level + 4 subtests failed
byte-restored same target handle 89464: exit 0; 5 top-level + 26 subtests passed
```

Node 真实破坏 mandatory native actor ACK，24 个四动作×两身份×三种 ACK 异常
子项及父项全部报错；先前全套负向 handle65825 为 335 pass/25 fail/exit1。
Go 只在私有候选关闭 AE/Operation 对齐、tenant 匹配、原锁定验证和原 policy
subjects 生产，检查不变即报错；两候选生产字节逐文件还原并 cmp=0，正式源码
未受破坏。首轮失败原件保留：Node22934 误重复配置 action metadata，修正夹具
后通过；Go59742 原 PEP 1+8 通过但原错误符号 AccessDenied 不存在，改回
StatusForbidden；Go51490 原用户/PEP/映射已通过但新 policy 夹具跳过原 route
registrar 导致缺上下文，补原 registrar 后通过。Node37423 为原 future-iat
夹具 `now+1` 跨秒失效，修正为投递 token lifetime 之外的确定 future iat，
未放宽生产验签；最终检查字节再次实际破坏/还原并通过。

Go 日志根目录为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/`；
Node 日志根目录为
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`。

| 日志 | SHA-256 |
|---|---|
| Go `cells-native-actor-positive.log` | `0c202f9ac0f732ad907d8c1e9e58c0ac8567a405643f6a4e8c3c3b6a89811b70` |
| Go `cells-native-actor-positive-final.log` | `52913925267df5a97e2b245146da2eab66b4444a73085a93979d72247c9f7361` |
| Go `cells-native-actor-positive-corrected.log` | `837a60ef307e68a57ccbb9a425b71c4cb2bb21945e1f037ce2487089cd08c4b3` |
| Go `cells-native-actor-mutation.log` | `86cde090982cb6f8edb29b908572064b4b9fb0909257150396acf7504c360341` |
| Go `cells-native-actor-restored.log` | `346fe532903a1a2b0ef91e6e6228d5fb0e4558c82b69a766463d20f9acefb5fb` |
| Node `cells-native-actor-http-positive.log` | `adfc5a468aae8115bc0826ebd7c31fe439be027f2583cf0d426256ec2ed9d5aa` |
| Node `cells-native-actor-http-positive-final.log` | `eead670af62c517bef03bb0dbadf2a96cb0ff40f69e75a7e97a1188f900e733c` |
| Node `cells-native-actor-http-mutation.log` | `e5d49a77d3345063bf029a0e10eb5a81666d30e8416542e17575adfc2cd750b8` |
| Node `cells-native-actor-http-restored.log` | `d8cbdd4cacb311d099dd8a0688ef6da25bdd200ed62eefaa6563bfb502458a7d` |
| Node `cells-native-actor-http-restored-final.log` | `c678eba936f3ed32a59dceb41715e9de36e93a5e1fbd717bdfccb8e8d90ba48b` |
| Node `cells-native-actor-final-bytes-mutation.log` | `c749c5ce10fd2969f2b7f665ed0ebaeb9bcfee6de4f2d050ad878cd14b589e91` |
| Node `cells-native-actor-final-bytes-restored.log` | `d89d840a31756c36df9cb35f5487977c7638d68b3be5b99a6e92cb5382ccc662` |

证据边界：Node 为原 HTTP/MCP suite 的真实 SDK client/adapter 消费，native
端受控 HTTP；Go 为原 authenticated callback、原 generated RPC stubs、原
用户/映射/route/policy request 生产检查，不是 Core 真签名联调，也没有跑真实
Cells UserDB/PolicyEngine/tree ACL 的成功路径或重建原生服务。未部署、未投递
生产 actor 配置、未激活 release/binding、未做浏览器截图或跨服务 E2E；本批
不等于完整 FILE_STORAGE 交付。write/share 的操作幂等/终态/usage 仍缺，条件
删除保持 BLOCKED；没有因这四条读链通过而开放它们。full 与镜像发布本批跳过，
由主线集中收口，不引用主线旧字节结果冒充本批最终验证。

## 2026-10-08 原生分享权限确认与邮件发送消费者

这是原生独立业务链的实现后事实，不是平台 `file_storage.share/write`
已完成或已激活的声明。固定上游基准：
`c57f02f4962835447df694c63bd0fd8c22bd7baf`。

四步影响与差异归属：

1. 权威：`.design/07-组件接入标准.md` §4.6/§5.2/§8A，以及
   `06-工程基线规范.md` §4。保留原生独立入口、完整页面与 ACL；
   副作用调用错误不能继续被当作权限已保存或已确认终态。本批是已授权的
   必要失败传播，不自行增加菜单、文案、页面、布局或业务能力。
2. 真实调用：固定上游 `idm/share/client.go::Client.UpsertCell` 原先只记录
   DeleteACL/CreateACL/ExpireACL/RestoreACL 错误，继续写 Workspace policy
   或 ShareExpiration；`Client.UpsertLink` 原先忽略根 CreateACL 的返回错误。
   原 `idm/share/rest/handler.go::SharesHandler.PutCell/PutOrUpdateShareLink`
   已消费这些错误，不需要增加 REST 路由。前端原
   `frontend/assets/action.share/res/js/dialog/links/LinkModel.js::save`
   吞掉 `ShareServiceApi.putShareLink` 的拒绝，导致原
   `frontend/assets/action.share/res/js/dialog/composite/Mailer.js::mailerProcessPost`
   在保存未确认时继续 Email.post；现在只在确认保存后沿原邮件链发送，
   拒绝或同步校验错误沿原 `core.mailer/res/js/components.js::postEmail`
   的 `callback(null, err)` 释放 posting，不发旧链接。原
   `links/Field.js::toggleEditMode` 与
   `links/Panel.js::enableLinkWithPassword` 仅确认成功后关闭/清空，
   拒绝保留用户原输入。已检索其他调用：Panel.toggleLink 原已有 catch，
   CompositeModel.save 原已有 Promise.all catch；没有新增第二保存路径。
3. 副作用：复用原 RPC、Workspace、ACL、share document 和邮件消费者；
   无第二账本/权限权威、无新身份、无自动回放或回滚。本批错误只证明未取得
   确认，不能证明此前部分 ACL/Workspace 副作用不存在；原独立 UI 的错误提示
   与未清空草稿不是平台 ActionExecution 的确定 FAILED。
4. 异常边界：删除/创建 ACL 失败立即停止后续权限/Workspace 写；过期/恢复
   不明不写确认的 ShareExpiration。原邮件保存拒绝、同步密码校验拒绝、
   等待确认和邮件自身错误均走原消费者。没有改变任何数据库格式/契约/迁移，
   不需要新旧读路径；原生多 RPC 并非原子事务，其操作 key/终态/usage、
   丢 ACK 与并发重试仍未闭合，不能因此开放平台 share/write。

### 原 Go 专项

沿已存在 SDK `kailo-cells-native-check-lftow7`、UID1000:1000、
4 CPU / 8 GiB、无额外 swap，复用 `/cache/build` 和 `/cache/mod`，
未安装/下载/构建镜像或启动数据库。执行前 MemAvailable 17 GiB、memory
pressure avg10=0、Data 可用 284 GiB；SDK OOM 计数为 0。记录到的
memory.peak=2538696704 是该原容器累计峰值，不冒称本批独立峰值。

实际原命令（容器工作目录 `/workspace/file-storage`）：

```sh
GOCACHE=/cache/build GOMODCACHE=/cache/mod GOPROXY=off \
CELLS_WORKING_DIR=/tmp/cells-share-permission-check \
CELLS_DATA_DIR=/tmp/cells-share-permission-check \
go test -mod=readonly ./idm/share ./idm/share/rest \
  -run "TestNativeShareRequiresPermissionWriteConfirmation|TestSharesHandler|TestPutCellRejectsInvalidRoots|TestGetCellRequiresReadAccess" \
  -count=1 -v
```

正向日志为 6 顶层 + 6 子用例通过，两包 `PASS/ok`；旧 handle69138
跨轮已不可解析，不据此补造该外层退出码。私有候选撤去 5 处新错误 return，
handle21701 实际 exit1：4 子项及其父项失败；原 link-root-create 单根场景
仍被原外层 err 检查保护，该负向未独立证明多根中途停止。失败输出包含
`saves=1 calls=[delete create]` / `calls=[expire]` / `calls=[restore]`，
确认检查能检出错误后仍写 Workspace 的真实生产路径。
缺原 Role registry 时的原诊断堆栈保留，不把它称为真实 RPC/数据库验收。
随后从正式源码逐字节恢复，handle37311 同目标实际 exit0：

```text
--- PASS: TestNativeShareRequiresPermissionWriteConfirmation
    --- PASS: .../unchanged
    --- PASS: .../delete
    --- PASS: .../create
    --- PASS: .../expire
    --- PASS: .../restore
    --- PASS: .../link-root-create
ok github.com/pydio/cells/v5/idm/share       1.120s
ok github.com/pydio/cells/v5/idm/share/rest  0.034s
GO_EXIT=0
```

两个 Go 源码及 go.mod/go.sum 正式/SDK `cmp` 均 exit0。
夹具复用原 generated ACLServiceStub/WorkspaceServiceStub；
不是 Cells 实库、PolicyEngine 或完整分享成功的 E2E。

### 原前端模块实际执行

Cells 原 assets Vitest 配置存在，但既有受限 SDK 没有 Vitest/React preset。
未安装或另建框架；复用 `kailo-wren-query-sdk-itgs2n` 原
4 CPU / 4 GiB 的 TypeScript 5.2.2，仅在内存转译四个完整原 JS/JSX 模块，
使用 Node 原 assert 执行真实方法。React setState、原 SDK RPC 和邮件 transport
在检查边界内受控替代，因此不是浏览器/样式、真实邮件或完整 webpack 验收。
完整 stdin 如下，原执行为：

```sh
sudo -n docker exec -i -w /work kailo-wren-query-sdk-itgs2n node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('/work/node_modules/typescript');
const base = '/work/knowledge-observation-guard.8QFEVq/file-storage/frontend/assets/action.share/res/js/dialog/';
const messages = [];
const auth = {};
let put;
class Observable { constructor(){ this.events=[]; } notify(event){ this.events.push(event); } }
class Component { constructor(props){ this.props=props; this.state={}; } setState(update){ Object.assign(this.state, typeof update === 'function' ? update(this.state,this.props) : update); } }
const React = { Component, createRef:()=>({current:null}), createElement:()=>null, Fragment:()=>null };
class Pydio {}
Pydio.getInstance=()=>({UI:{displayMessage:(kind,message)=>messages.push({kind,message})}});
Pydio.getMessages=()=>({});
Pydio.requireLib=()=>({});
class ShareLink { static constructFromObject(value){return Object.assign(new ShareLink(),value);} }
const sdk = {
 ShareServiceApi:class {putShareLink(request){return put(request);}},
 RestPutShareLinkRequest:class {},
 RestShareLink:ShareLink,
 RestShareLinkAccessType:{constructFromObject:value=>value},
 RestShareLinkTargetUser:{constructFromObject:value=>value},
};
const helper={getAuthorizations:()=>auth,buildPublicUrl:()=>'/original-share'};
const validators=new Proxy(function(){},{get:()=>validators,apply:()=>validators});
const moduleCache=new Map();
function load(relative){
 if(moduleCache.has(relative)) return moduleCache.get(relative);
 const filename=base+relative;
 const source=fs.readFileSync(filename,'utf8');
 const result=ts.transpileModule(source,{fileName:filename.replace(/\.js$/,'.jsx'),reportDiagnostics:true,
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}});
 const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,relative+': '+errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
 const mod={exports:{}};
 function imports(name){
  if(name==='react')return React;
  if(name==='pydio')return Pydio;
  if(name==='prop-types')return validators;
  if(name==='pydio/lang/observable')return Observable;
  if(name==='pydio/http/api')return {getRestClient:()=>({})};
  if(name==='cells-sdk')return sdk;
  if(name==='material-ui/styles')return {muiThemeable:()=>value=>value};
  if(name.endsWith('/ShareContextConsumer'))return value=>value;
  if(name.endsWith('/ShareHelper'))return helper;
  if(name==='pydio/util/pass')return {checkPasswordStrength:(_password,callback)=>callback(true)};
  if(name==='pydio/http/resources-manager')return {loadClass:()=>Promise.resolve({})};
  if(name==='./LinkModel')return load('links/LinkModel.js');
  return {};
 }
 vm.runInNewContext('(function(require,module,exports){'+result.outputText+'\n})',{console,Promise,Math,Date,RegExp,React},{filename})(imports,mod,mod.exports);
 moduleCache.set(relative,mod.exports);
 return mod.exports;
}
const LinkModel=load('links/LinkModel.js').default;
const Mailer=load('composite/Mailer.js').default;
const Field=load('links/Field.js').default;
const Panel=load('links/Panel.js').default;
console.log('FULL_MODULE_TRANSPILE=4');
const cause=new Error('native permission outcome is unknown');
function model(){const value=new LinkModel();value.link.Uuid='existing-link';value.notifyDirty();return value;}
function mailer(linkModel){
 const value=new Mailer({});
 value.state.mailerData={crippleIdentificationKeys:false,identifiedOnly:true,linkModel};
 return value;
}
let posts=0,targets=0;
class Email {
 addTarget(){targets++;}
 post(callback){posts++;callback({sent:true});}
}
const users={recipient:{getLabel:()=> 'Recipient'}};
const ui={UI:{displayMessage:(kind,message)=>messages.push({kind,message})}};
const checks=[];
function check(name,fn){checks.push([name,fn]);}
check('LinkModel preserves rejection and dirty state without save notification',async()=>{
 put=()=>Promise.reject(cause);const m=model();
 await assert.rejects(m.save(),error=>error===cause);
 assert.equal(m.isDirty(),true);assert.equal(m.events.includes('save'),false);
});
check('LinkModel confirmed save retains original successful flow',async()=>{
 put=async request=>({...request.ShareLink,LinkHash:'confirmed'});const m=model();
 await m.save();assert.equal(m.isDirty(),false);assert.equal(m.events.includes('save'),true);assert.equal(m.link.LinkHash,'confirmed');
});
check('Mailer never sends after real LinkModel rejection and releases callback',async()=>{
 put=()=>Promise.reject(cause);posts=0;targets=0;const callbacks=[];
 await mailer(model()).mailerProcessPost(Email,users,'subject','/original-share','',(...args)=>callbacks.push(args));
 assert.equal(posts,0);assert.equal(targets,0);assert.equal(callbacks.length,1);assert.equal(callbacks[0][0],null);assert.equal(callbacks[0][1],cause);
});
check('Mailer forwards synchronous password validation without email',async()=>{
 posts=0;const m=model();m.ValidPassword=false;m.ValidPasswordMessage='original validation';const callbacks=[];
 await mailer(m).mailerProcessPost(Email,users,'subject','message','',(...args)=>callbacks.push(args));
 assert.equal(posts,0);assert.equal(callbacks.length,1);assert.equal(callbacks[0][0],null);assert.equal(callbacks[0][1].message,'original validation');
});
check('Mailer waits for confirmation then uses original email flow once',async()=>{
 let resolve;put=request=>new Promise(r=>{resolve=()=>r(request.ShareLink);});posts=0;targets=0;const callbacks=[];
 const completion=mailer(model()).mailerProcessPost(Email,users,'subject','/original-share','',(...args)=>callbacks.push(args));
 await Promise.resolve();assert.equal(posts,0);assert.equal(callbacks.length,0);
 resolve();await completion;assert.equal(posts,1);assert.equal(targets,1);assert.equal(callbacks.length,1);assert.equal(callbacks[0][0].sent,true);
});
check('Mailer preserves actual email callback error',async()=>{
 put=async request=>request.ShareLink;const callbacks=[];
 class FailedEmail extends Email {post(callback){callback(null,cause);}}
 await mailer(model()).mailerProcessPost(FailedEmail,users,'subject','message','',(...args)=>callbacks.push(args));
 assert.equal(callbacks.length,1);assert.equal(callbacks[0][0],null);assert.equal(callbacks[0][1],cause);
});
function field(m){const value=new Field({linkModel:m,pydio:ui,getMessage:()=>''});value.state.editLink=true;value.state.customLink='edited-link';return value;}
check('Field keeps edited value and mode after rejected save',async()=>{
 put=()=>Promise.reject(cause);const value=field(model());await value.toggleEditMode();
 assert.equal(value.state.editLink,true);assert.equal(value.state.customLink,'edited-link');
});
check('Field exits edit mode only after confirmed save',async()=>{
 put=async request=>request.ShareLink;const value=field(model());await value.toggleEditMode();
 assert.equal(value.state.editLink,false);assert.equal(value.state.customLink,undefined);
});
check('Field consumes synchronous validation without clearing input',async()=>{
 const m=model();m.ValidPassword=false;m.ValidPasswordMessage='original validation';const value=field(m);await value.toggleEditMode();
 assert.equal(value.state.editLink,true);assert.equal(value.state.customLink,'edited-link');
});
function panel(m){const value=new Panel({linkModel:m,pydio:ui});Object.assign(value.state,{showTemporaryPassword:true,temporaryPassword:'original-password',temporaryPasswordState:true});return value;}
check('Panel retains password form after rejected save',async()=>{
 put=()=>Promise.reject(cause);const value=panel(model());await value.enableLinkWithPassword();
 assert.equal(value.state.showTemporaryPassword,true);assert.equal(value.state.temporaryPassword,'original-password');
});
check('Panel closes password form only after confirmed save',async()=>{
 put=async request=>request.ShareLink;const value=panel(model());await value.enableLinkWithPassword();
 assert.equal(value.state.showTemporaryPassword,false);assert.equal(value.state.temporaryPassword,null);
});
check('Panel consumes synchronous validation and retains form',async()=>{
 const m=model();m.save=()=>{throw cause;};const value=panel(m);await value.enableLinkWithPassword();
 assert.equal(value.state.showTemporaryPassword,true);assert.equal(value.state.temporaryPassword,'original-password');
});
(async()=>{
 let failed=0;
 for(const [name,fn] of checks){try{await fn();console.log('PASS '+name);}catch(error){failed++;console.log('FAIL '+name+'\n'+error.stack);}}
 console.log('CHECKS='+checks.length+' PASSED='+(checks.length-failed)+' FAILED='+failed);
 process.exitCode=failed?1:0;
})();
NODE
```

正向 12/12 PASS、exit0；私有生产者撤去 LinkModel 的 throw 与 Mailer 的
失败 callback 后，5 FAIL/7 PASS、exit1，真实检出误发送、验证失败不释放
callback、错误清空原输入。原测试输入不变，四个候选生产文件恢复并逐一
`cmp` 正式源码 exit0，恢复同 stdin 12/12 PASS、exit0。

### 原件索引与尚未完成

Go 日志根：
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/`。
Node 日志根：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq/`。

| 原日志 | SHA-256 |
|---|---|
| cells-native-share-permission-positive.log | `fbb06c4ff96ea64a3096831c1faa046b1be7e82139a4e428e2cb625596c191e9` |
| cells-native-share-permission-negative.log | `622cad2aaf473801bb94de0aa8ce2db78190f48e7eb6a892cac53b81981478de` |
| cells-native-share-permission-restored.log | `ea0a642506cfc9e45a2d6f321801099eb1cc851b1534b115563b250c560a4475` |
| cells-native-share-ui-positive.log | `e1c152f4ce76824bddf4f533fd24e30c509b63554510208d0fe30322ce469a0c` |
| cells-native-share-ui-negative.log | `85ad22150e28ef86d9d27c0eaa131acb161c6696aff36558b883ba16154c9237` |
| cells-native-share-ui-restored.log | `e1c152f4ce76824bddf4f533fd24e30c509b63554510208d0fe30322ce469a0c` |

本批未部署、未投递 actor 配置、未激活 release/binding、未运行全仓 full、
未做原页面截图或三端/跨服务 E2E，不声明 100% 还原或完整 FILE_STORAGE。
当前 live native 仍是旧源码 afc462d836c770b6f402372b53cd05b3c203786a，
未挂 nativeAction 配置；主线最近只读 release/binding 仍为 0。
完整批准 catalog、可信现有用户/scope 投递与实库 ACL 验收、平台 write/share
的稳定操作 key/终态/usage 以及原子条件删除仍是上线门禁；没有伪造它们。
原生独立入口保留，继承的 deploy/compose.yaml 未改。

## 2026-10-08 原生自定义分享链接的文档写入确认（源码批）

本节初次冻结时只记录实现后的源码事实，未沿用上一节的通过数；当时未执行的
边界保留如下，后续实际正向、生产破坏与还原终态见本节末。

1. 权威仍为 `.design/07` §5.2/§8A、`.design/08` §4/§9.2、
   `apps/06` §4，以及独立组件原生业务边界。只读重新核验固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`：
   `idm/share/client-hash-doc.go::Client.StoreHashDocument` 在改自定义 hash 时，
   未检查新文档 PutDocument 的错误便删除旧文档，随后以删除 RPC 的错误覆盖
   写入结果。该源码中的 `Client.UpsertLink`、`Client.LinkById` 与
   `Client.WorkspaceToShareLinkObject` 分别位于完整路径
   `idm/share/client.go`、`idm/share/client.go`、`idm/share/client-acls.go`，
   确实消费该写入/读取链。原 hash 和 workspace UUID 是原生引用，不是绑定
   actor/generation/操作参数的 operation key，也不能证明完整平台 share。
2. 影响检索沿原 REST PutShareLink/GetShareLink、自定义链接 Field 和上节
   LinkModel/Mailer 消费者，未改页面/布局、认证或 ACL。当前修改只复用原
   DocStore RPC/DAO：新文档 ACK 必须对应原请求的完整 Document；确认前不删
   旧 hash；旧文档删除确认前不把调用方 LinkHash 改为新 hash。不新增契约、
   表、任务、状态、重试、补偿、凭据或配置。现有数据格式与原 RPC 响应不变，
   无数据迁移；旧原生 writer 与旧错误传播不因此获得安全证明。
3. 核对同一固定 commit 的 `data/docstore/grpc/handler.go::Handler.GetDocument`
   发现任意 DAO 失败都被转换为 DocStoreDocNotFound，会把超时/取消/存储故障
   当成“新 hash 不存在”。该真实生产者现仅把既有 StatusNotFound 映射为原
   DocStoreDocNotFound，其余错误传播。完整路径
   `data/docstore/dao/mongo/mongo.go::mongoImpl.GetDocument` 只将真实
   mongo.ErrNoDocuments 归一到该原缺失类型；原 Bolt 的完整路径
   `data/docstore/dao/bleve/bolt.go::BoltStore.GetDocument` 已返回 StatusNotFound，
   不需修改。分享的 collision 探测只接受这种确定缺失，其他拒绝/不明不写入。
4. 原生确定 collision 仍为原 StatusConflict（平台归类 CONFLICT），配置/权限
   拒绝不被变成不存在（PRECONDITION/DENIED）；写入或删除 ACK 不明不得作为
   完整 share 成功（UNKNOWN/EXTERNAL_RESULT_UNKNOWN），且本批不开放该平台
   动作（BLOCKED）。先写后删仍是多 RPC：新文档可能已保存而 ACK 丢失，或
   新旧文档同时存在/旧删除 ACK 丢失；错误沿原调用链返回，没有重试、回滚
   猜测或第二账本。原生 hash collision 的读后写不是原子 CAS，创建与
   workspace/ACL/hidden-user 等多步副作用也没有 operation-key 终态证据。
   这些仍阻断 generic write/share，不以本批修复宣布已闭合。

实现之后在原 `idm/share/client-acls_test.go` 追加真实生成 DocStore RPC stub
消费者检查，覆盖原样保存、hash 更换、collision、读取失败、写前失败、写后
ACK 丢失、缺/错 ID/正文/索引 ACK、删除错误/ACK 丢失与三种坏删除确认。
原 `data/docstore/grpc/handler_test.go` 追加原 manager/DAO 注入检查，覆盖确定
缺失、取消、超时、解码错误、存储故障与成功回读；原
`data/docstore/dao/dao_test.go` 追加既有 Bolt/Mongo fixture 的缺失类型断言。
初次冻结时这些检查已写入但没有执行，不能据此报告通过或 mutation 被检出。

按主代理当时 I/O 暂停指令，初次冻结未运行 Go/Node 构建、测试、formatter、
生产破坏/还原、Docker、镜像或部署。仅只读源码及固定 commit 检索，六个
源码/检查文件的 `git diff --check` 实际退出 0；这只证明 diff 空白检查。
集中原目标、实际生产保护破坏/还原与最终字节检查由主代理协调原受限 SDK，
其运行结果须另行记录。本批未修改继承 compose、未投递 native actor 配置，
未激活 release/binding、未做 Playwright/实库/三端 E2E，不声明 100% 还原或
完整 FILE_STORAGE 已交付。

### 同一源码批的受限 SDK 核验与未执行边界

后续检查确认原 `kailo-cells-native-check-lftow7` 仍运行且没有在途任务，
UID1000:1000、Go `go1.26.8 linux/amd64`；实际 cgroup 为
`cpu.max=400000 100000`、`memory.max=8589934592`、
`memory.swap.max=0`，OOM/oom_kill 均为 0。六个源码/检查输入以及
`go.mod`、`go.sum` 与该原候选逐字节相同。镜像内原 `gofmt -l` 检查六文件
无输出；未更改源码字节。`CELLS_TEST_MONGODB_DSN` 未投递，真实 Mongo
fixture 明确 SKIP，不新建数据库、不打印或猜测凭据。

执行前宿主 MemAvailable 约 24 GiB、Data 可用约 278 GiB，但原 Knowledge
专项正在链接、全量检查也在途，磁盘 I/O full avg10 从约 67% 升至约 74%。
因此先仅核对原缓存目标命令规模，没有启动实际测试：

```sh
GOCACHE=/cache/build GOMODCACHE=/cache/mod GOPROXY=off \
go test -n -mod=readonly -tags=kv \
  ./idm/share ./data/docstore/grpc ./data/docstore/dao \
  -run "TestNativeShareDocumentRequiresWriteConfirmation|TestDocumentReadPreservesUnavailableEvidence|TestDocStore" \
  -count=1 -v
```

该只读 dry-run 等待约五分钟仍未完成缓存/依赖读取，未启动 compile/link。
为避免叠加发布 I/O，仅对该次 Go 进程发出 TERM；原 handle34535 实际终态
为 exit143，不是检查通过或源码编译失败。保留的部分命令日志为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/cells-native-hash-doc-dry-run.log`
（40 行，SHA-256
`f8da6bf0a02f5b188ee8c2c4abd3bf99e907e78c27f95709391ef2375804bcca`）。
最初日志目的目录不可写的一次 shell 诊断未进入 Go，后改用原宿主候选目录；
没有因此重建 SDK、安装依赖或修改产品代码。该次资源窗口没有执行实际正向、
生产破坏或还原验证；后续移除 `-n` 的真实终态见下节。当时本批未提交或部署，
generic write/share 准入继续 BLOCKED。

### 同一冻结源码的实际正向、生产破坏与还原结果

资源窗口恢复后，没有重建 SDK 或重启上一检查，沿原
`kailo-cells-native-check-lftow7` 完成以下同一精确目标；原镜像为
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
UID1000、4 CPU/8 GiB/swap0 与原缓存不变。开始前 MemAvailable 24 GiB、
Data 可用 282 GiB、memory pressure avg10=0、I/O full avg10=15.8%；
后续窗口分别读到 MemAvailable 17/25 GiB，未叠加第二份本批编译。

```sh
GOCACHE=/cache/build GOMODCACHE=/cache/mod GOPROXY=off \
CELLS_WORKING_DIR=/tmp/cells-hash-document-check \
CELLS_DATA_DIR=/tmp/cells-hash-document-check \
go test -p=1 -mod=readonly -tags=kv \
  ./idm/share ./data/docstore/grpc ./data/docstore/dao \
  -run "TestNativeShareDocumentRequiresWriteConfirmation|TestDocumentReadPreservesUnavailableEvidence|TestDocStore" \
  -count=1 -v
```

- 正向 handle91250 实际 exit0：三包 `PASS/ok`，3 顶层、24 子项通过。
- 仅在原私有候选禁用 `StoreHashDocument` 的 5 处保护（非确定缺失、Put
  错误、完整 Document ACK、Delete 错误、Delete ACK/count），并将
  `Handler.GetDocument` 的错误分支恢复为旧的无差别 NotFound。原检查、
  fixture 与正式源码没有破坏或改写。负向 handle15196 实际 exit1：
  2 顶层、16 子项失败（分享 12、读取错误误映射 4）；其余 1 顶层、8 子项
  仍通过。原 DAO 的确定缺失与正常读写未被误报为失败。
- 从正式源码恢复全部六个候选文件，逐字节 `cmp=0` 后沿同一命令复跑；
  handle1366 实际 exit0，三包 `PASS/ok`，3 顶层、24 子项再次通过。
  最终六文件 `cmp=0`，镜像内 `gofmt -l` 空输出/exit0。

负向原输出包含（分享行仅摘录开头及调用序列，中间原 fixture link 字段见日志）：

```text
client-acls_test.go:129: unconfirmed share write became success: error=<nil>
calls=[get:new-hash put:new-hash delete:old-hash]
handler_test.go:94: unavailable evidence became confirmed absence: document not found
negative exit=1
```

完整日志与实际生产破坏差异均保留在
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 文件 | SHA-256 |
|---|---|
| cells-native-hash-doc-positive.log | `34f0ae8c4c6a510200d84ec21d9585a629263bbd001d2f3aae9a511532d489d9` |
| cells-native-hash-doc-negative.log | `b0de3c4700dc13c730800a4b1b03feba621f6da76393e1bd0ac8d98671f39215` |
| cells-native-hash-doc-restored.log | `9002adc9c225b993834cb8d4e48cddc771a4531f02e0c297af4c152aea31782e` |
| cells-native-hash-doc-production-mutation.diff | `c562ed11aa6a20de15973aab4fd9ac325857f025397f7a6218eacabb664d5a03` |

上述候选只保证本批六文件及依赖锁与正式输入一致，不冒充全 main 快照。
检查实际覆盖生成 RPC stub、原 Handler/manager 注入与原 Bolt/Bleve fixture，
不是部署后的跨服务 E2E。Mongo fixture 仍无投递，真实 Mongo/索引迁移 SKIP；
编译 Mongo 实现不算实库通过。最终 SDK 无 Go/compile/link 在途，OOM/
oom_kill=0；累计 `memory.peak=2538696704` 不是本批独立峰值。
未运行全量检查、镜像发布、Playwright 或三端验收；没有激活 release/binding。
多 RPC 的未知副作用、原子 collision 与操作 key/终态/usage 门禁没有因此
闭合，generic write/share 继续 BLOCKED。本节仅更新实施后的实际验证事实。

## 2026-10-08 原生 Task 首次派发与 Version 持久结果接缝

本批是 `file_storage.write` 的原生前置生产链，不是完整写入能力；没有增加
Adapter write 入口、批准 FILE_STORAGE release/binding 或部署。原生完整页面
与独立入口未修改，未新增队列、任务表、平台账本、权限注册表或 protobuf 字段。

### 四步影响结论与实际实现

1. 权威是 `.design/07-组件接入标准.md` §5.2 的稳定 operation key、真实 native
   terminal 与 UNKNOWN 不重放，及 `.design/08-内置组件与交互场景.md` 的完整
   FILE_STORAGE 类别门禁。固定官方源码为
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`；以下路径与符号均经该 commit
   只读 `git grep/show` 核验，不执行或修改 `.references`：
   `/volumes/kailo/.references/cells/scheduler/jobs/rest/handler.go::SendControlCommand`
   原样投递 `RunTaskId=cmd.TaskId`；
   `/volumes/kailo/.references/cells/scheduler/tasks/task.go::NewTaskFromEvent/Task.Queue`
   原来复用该 ID 后直接排队；
   `/volumes/kailo/.references/cells/scheduler/jobs/dao/bolt/bolt.go::PutTask` 与
   `/volumes/kailo/.references/cells/scheduler/jobs/dao/mongo/mongo.go::PutTask`
   原来可覆盖任务；
   `/volumes/kailo/.references/cells/data/versions/action-version.go::VersionAction.Run`
   原来不从 task/action/node 固定版本引用；
   `/volumes/kailo/.references/cells/scheduler/jobs/dao.go::Migrate` 是原生存储迁移
   的真实消费者。全部二开仍在 `apps/file-storage` 的上述原模块。
2. 影响面是原 `RunTaskId`→`Task.Queue`→JobService `PutTask`→原 Task DAO→
   原状态流，以及 Runnable→VersionAction→原版本 DAO→原 Task.ActionsLogs。
   显式原生任务 key 的首次派发先以原 `StatusMeta` 的 create-only 分支持久化
   queued Task，取得完整一致的原 RPC ACK 后才进入原 dispatcher。冻结 Job、
   event、计算后参数和 native owner 的摘要，不把参数或凭据复制进公开任务日志。
   同 key、不同 Job/actor/输入或已存在引用均拒绝，不把重复请求当新执行。
   Bolt 在原单事务内同时重验 jobs bucket、检查原 tasks buckets 并插入；
   DeleteJob/普通状态写与清理不能删除或替换 claim。原 Migrate 对已有 claim
   调用原 DAO 的 ClaimTask 保留 status/首次输入/版本回执，冲突立即退出，不用
   PutTask 覆盖恢复。Mongo 复用原 tasks collection 的唯一 native ID、InsertOne、
   状态快照条件替换与删除排除条件；没有第二任务存储。
3. 副作用边界是 claim 必须先落盘再派发。丢失、错误、空或不一致 ACK 均不派发；
   claim 后进队列前崩溃仍保留 queued 原引用，不假装 Finished 或自动重放。
   受信的进程内 claimed-task context 才使原 VersionAction 从 task/action/node
   关联固定 VersionUuid；原 CreateVersion 返回其他引用即拒绝，原 CopyObject
   和 StoreVersion 完整持久 ACK 后才产生真实 ContentRevision 输出。Runnable
   只将该类型回执追加到原 Task，不复制任意 raw/string body 或继承输出链；
   已持久版本证据不可由后续状态写擦除。原无显式 key 的 UI 任务保持原版本路径。
4. 空引用、未知 create-only 枚举、变更 owner/输入、重复 dispatch、Job 已删除、
   不完整版本和变更版本证据均有确定拒绝。Bolt 的先读 Job→Job 删除→claim
   竞争由同事务重验关闭；两个真实 Bolt store 的原迁移、重复迁移冲突及普通
   task 清理仍被原目标覆盖。Mongo 的跨 collection Job 删除/claim 存活性**未闭合**：
   删除条件保住了 claim，但 Job 可在 handler 旧读与 InsertOne 之间被删除，
   不能宣称其 Job 原子性成立。无受控 Mongo fixture，实库/索引迁移明确 SKIP。

### 原受限 SDK 实际验证

沿既有 `kailo-cells-native-check-lftow7`，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
UID1000:1000、`cpu.max=400000 100000`、8 GiB、swap0；复用 `/cache/mod` 与
`/cache/build`，没有新 SDK、镜像、依赖安装或全树复制。开始前 MemAvailable
约 24 GiB、Data 可用约 283 GiB；窗口间复核约 24 GiB、memory pressure=0、
OOM/oom_kill=0。首轮原句柄经历 I/O 等待后终结，未重复启动在途编译。

实际同一命令（仅日志目的文件不同）：

```sh
sudo -n docker exec \
  -e GOCACHE=/cache/build -e GOMODCACHE=/cache/mod -e GOPROXY=off \
  -e CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  -e CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  go test -p=1 -mod=readonly \
    ./scheduler/jobs/grpc ./scheduler/tasks ./data/versions ./scheduler/jobs/dao/mongo \
    -run "TestNativeTask|TestVersionActionRequiresExactNativePersistence|TestNewTaskFromEvent|TestTaskSetters" \
    -count=1 -v
```

首轮 handle71380 实际 exit1：旧 job-recheck 夹具漏原 TriggerOwner，被不可变
owner 保护拒绝；新检查误用了原工程并不存在的 JobServiceStub，tasks 编译失败。
保留失败输出后，只修夹具 owner 和原 RegisterMock 所接受的 ClientConnInterface，
没有放宽生产保护。同步 Bolt/Migrate 修正后 handle6326 exit0；首次生产破坏
handle21075 exit1（4 顶层、18 子项失败），还原 handle27264 exit0。该次迁移
夹具沿嵌套 callback 调外层 Fatal，负向附带 Goexit 测试框架告警；随后改为
Error+return，并用原 tree.ContentRevision 的 protojson 载荷，保留全部旧日志。

最终字节的集中结果：

- handle59498 正向 exit0：三个原包 9 顶层、46 子项通过；其中 4 子项是原 Bolt
  fixture 包装，另有原 GoConvey 14 assertions。Mongo 仅编译/no test files。
- 仅私有候选禁用 6 处真实生产保护：Bolt Job 重验和已有 key 拒绝、Queue 的
  RPC error 与完整 ACK 拒绝、VersionUuid 因果校验、Migrate 的 claim 选择。
  三个检查文件与正式源码未破坏。handle26681 实际 exit1：4 顶层、16 子项失败，
  其余 5 顶层、30 子项通过；无 Goexit 告警。相同 key 真实允许 16 次 claim、
  丢 ACK 后排队、错误版本关联及迁移错走普通状态写均被原检查捕获。
- 从正式源码恢复全部 12 输入，逐字节 cmp=0 后同目标复跑；handle46310 实际
  exit0，9 顶层、46 子项再次通过。最终 12 文件和 go.mod/go.sum cmp=0，
  镜像内 gofmt-l 空输出/exit0。SDK 无 Go/compile/link 在途，OOM=0；累计
  `memory.peak=2538696704` 是原容器历史峰值，不冒充本批独立峰值。

负向原输出摘录：

```text
native claim survived a deleted job's stale read: <nil>
same native operation permitted 16 first dispatches
unconfirmed native task entered dispatch: calls=1 queued=1 err=<nil>
native migration lost existing task evidence: counts=map[Jobs:1 Tasks:2]
err=native first-dispatch claim is required before status persistence: conflict
```

原日志与生产破坏 diff 保留于
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 文件 | SHA-256 |
|---|---|
| cells-native-task-claim-positive.log | `05fcf720ac7313d8b455cd609a38c2373d442ee5dfb69bd5245202f1838564d1` |
| cells-native-task-claim-final-positive.log | `d8cc1a7ddeca426742c2a2cbe3dc943fc892a59092dae6bd7590b5a7e4cf2696` |
| cells-native-task-claim-negative.log | `da9c3d71269fa2df84a25dc7c01764e46b24d695f048e8c5ec03c9870fba608e` |
| cells-native-task-claim-restored.log | `e83d05885bd88fe10daa3841e46d92dafb5aa246812877f20f720cb8a8db61ca` |
| cells-native-task-claim-fixture-final-positive.log | `dd28344f9cdfb586fe352c61ef813153a96b334425f19d126812e1e48e818492` |
| cells-native-task-claim-fixture-final-negative.log | `f96287d724f6928084d69f940497a86a214989d15f5e064cb3a49fa77f634007` |
| cells-native-task-claim-fixture-final-restored.log | `be3bb04b43f60ab3ebf8f6d61f8ccf5a1314fbb57eee59bbb9c213f3a6760f63` |
| cells-native-task-claim-fixture-final-production-mutation.diff | `dbc48e09b1be49ea43ad6a04a84c55abdf3dfc0994a9e13caeb8f125fa1b1e3d` |

本候选只保证本批 12 文件及依赖锁一致，不冒充全 main 快照、部署后的原生
业务 E2E 或线协议准入。实际覆盖原 Bolt、原 Handler、原生成 RPC client/
RegisterMock 与原 VersionAction 消费者；未运行全局检查、镜像发布、Mongo
实库、Playwright 或三端验收。没有改变正式业务库或激活 binding。

完整治理写入仍有硬缺口：真实 uploader→claimed Task→Version 因果尚未接通；
平台 principal/scope/binding generation 到 native write actor、固定输入与终态
byte/op 用量消费尚未闭合。已保留原生 claim，但安全 dedup 退休窗口、失联
queued claim 对账期限及责任入口未成立，不能把永久保留记录当作生产收敛。
Mongo 跨 collection Job 存活性、条件删除原子性和分享多 RPC UNKNOWN 也仍
是对应发布阻断。本批不宣称 generic write/share、完整 FILE_STORAGE 或生产就绪。

## 2026-10-08 原生历史版本实际读取与完整历史错误传播

本批只闭合已有原生版本读取消费者，不宣称 uploader→Task→Version 已接通。
固定官方基准仍为 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`，只读核验
`common/nodes/version/handler-version.go::Handler.ListNodes/ReadNode/GetObject/CopyObject`
与 `gateway/restv2/api-versions.go::Handler.NodeVersions/promoteDraftVersion`。
原 NodeVersions 已明确只显示当前 native user 的草稿，原 promoteDraftVersion
也拒绝提升他人的草稿；本批让原版本包装器的历史 stat、列表、下载与复制消费
同一条规则，不新增权限权威或改动原页面。

### 四步影响与实施事实

1. 权威为 `.design/07` §5.2/§8A、`.design/08` §4 SS-CEL 及 `.design/13` §4.4：
   指定版本不能读成其他版本，不完整历史不能冒充完整列表；现有 native actor、
   当前 scope、binding generation、fresh PEP 与原 ACL 接缝保持不变。差异归为
   已授权治理接入下的原读取消费者修复，不是原版布局、菜单或功能的删减。
2. 实际影响是原 `common/nodes/compose/{compose-path.go,compose-uuid.go,reverse.go}`
   的 `version.WithVersions` 包装器。原数据 gateway 的 GetObject/CopyObject
   和原版本提升沿它读取指定版本；原 StatFlags/WithVersions 沿它读取历史。
   `ContentRevision.VersionId/Draft/OwnerUuid/Location/Size/ETag/MTime` 仍由原生
   版本服务生产，本批只消费；没有新格式、契约、数据库字段、旧数据迁移或第二正文。
3. 原 WithVersions 忽略流错误、StatFlags 的列表路径仅写日志，均已改为用原
   WrappingStreamer.SendError 传给真实调用者；收到部分历史后中断也不报完整。
   三个指定版本入口均核验原 HeadVersion 的确切 ID；草稿只接受当前原生 owner。
   下载与复制必须有原生 Location 的 path/datasource，使用克隆位置及同一版本的
   Size/ETag/MTime；历史 stat 克隆原 node，不把当前调用者节点改成历史 metadata。
   原字节读取、复制目的地、存储、Task 与 Version 权威未替换，没有重放未知副作用。
4. 空/错误版本、缺少原生位置/数据源、他人及无 owner 草稿均确定拒绝，已发布
   历史和本人草稿保留；历史流中断沿原错误路径暴露，不当成功或完整空列表。
   原检查还验证拒绝时不进入 bytes/copy、原当前 node 不变。并发撤权仍依赖既有
   native actor/fresh PEP/native ACL，本批没有部署后的撤权、浏览器或跨服务证据。

### 原受限 SDK 正向、真实生产破坏与字节还原

复用既有 `kailo-cells-native-check-lftow7`，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
UID1000:1000、`cpu.max=400000 100000`、8 GiB、swap0；原 `/cache/mod` 和
`/cache/build`，没有新 SDK、镜像、数据库、依赖安装或整树复制。开始前
MemAvailable 约18.1 GiB，最终字节窗口前约23.9 GiB、memory PSI avg10=0，
CPU PSI avg10=0.58、I/O avg10 some=6.74/full=6.00。首轮实际经历文件页 I/O
等待，始终续同一句柄，没有重复启动在途编译。最终 SDK 无 Go/compile/link
在途，OOM/oom_kill=0；`memory.peak=2538696704` 是容器历史峰值，不算本批峰值。

同一个原包命令，仅日志目的文件不同：

```sh
sudo -n docker exec \
  -e GOCACHE=/cache/build -e GOMODCACHE=/cache/mod -e GOPROXY=off \
  -e CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  -e CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  go test -p=1 -mod=readonly ./common/nodes/version -count=1 -v
```

- 首轮 handle9839 实际 exit1：3 顶层通过、1 顶层失败；58 子检查通过、3 子检查
  失败（子数含分组）。历史 copy 的 published/own-draft 两个叶子实际抓到缺少
  ContentRevision metadata，已修真实生产者，不放宽检查。原生成的 in-process
  NodeVersionerStub 不能确定保留 Send 后的流错误，因此原检查追加确定的 grpc
  ClientStream 夹具，经原生成 client 的 Recv 送出部分历史后再失败；不是新协议。
- 最终两文件一次同步/gofmt、cmp=0 后，handle38082 实际 exit0：4 顶层、61 子检查
  通过，包含原上传持久 ACK 目标与新增原生历史三个读取、三个列表消费者。
- 仅私有候选禁用真实草稿 owner 比较、三处确切版本 ID 比较和两处流错误传播，
  正式源码与检查文件未破坏。handle61978 实际 exit1：2 顶层、20 子检查失败，
  其余2 顶层、41 子检查通过；实际抓到他人/无 owner 草稿与错误版本获准、历史
  漏掉流错误和列表泄漏他人草稿，非编译失败。
- 从正式源码恢复原生产文件，两个输入逐字节 cmp=0，再跑同一原包。
  handle33480 实际 exit0：4 顶层、61 子检查再次通过。最终两输入及 go.mod/go.sum
  正式/候选 cmp=0，原 SDK gofmt-l 空输出/exit0。

负向原输出摘录：

```text
revision access allowed=true, wanted false: <nil>
native draft visibility lost: [published own-draft other-draft]
partial native history was reported as complete: <nil>
```

日志及私有生产差异保留于
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 文件 | SHA-256 |
|---|---|
| cells-native-revision-read-positive.log | `413d96878847ebbeaed2d941324169c0a09b984fbb910fd1bd285245439579d5` |
| cells-native-revision-read-final-positive.log | `158a2a29fe4647fb492ddd127bb06c83dccad71e14cd73385762b5e50104e102` |
| cells-native-revision-read-negative.log | `cf5e28a2afb7260300b9dbf7dd885ccba29b3cbdc7bfa691d05fe374e1425f40` |
| cells-native-revision-read-restored.log | `104fe44c20d3b4309aa02b894519a2824773e0172857f67df5ad058d728c5328` |
| cells-native-revision-read-production-mutation.diff | `c3c1ac6bf48919cfd62e3359ff97faa2c95937f258593771e1b52086490d09b5` |

候选只保证本批两个文件及依赖锁与正式树一致，不是完整 main 快照。实际验证
原 Handler 与原生成 grpc client，用原检查的下游夹具确认 bytes/copy 转发；没有
启动真实对象存储读写，也没有运行 full、镜像发布、Mongo 实库、Playwright 或
三端验收，没有改正式业务库或激活 binding。

### uploader 真实接缝仍阻断

对同一固定官方 commit 只读核验：

- `frontend/assets/uploader.html/res/js/model/Task.js::Task` 的
  `local-upload-task-` Job 与 `upload` Task 只送原 JobsStore 本地展示，不是持久 native Task。
- `frontend/assets/uploader.html/res/js/model/UploadItem.js::UploadItem.uploadPresigned`
  沿原 PydioApi/S3 上传；`gateway/data/gw/gateway-pydio.go::pydioObjects.PutObject`
  只向原 router 传字节、size/hash 与原 UserDefined metadata。
- `gateway/data/hooks/auth-handler.go::pydioAuthHandler.ServeHTTP` 消费原 Cells JWT/S3
  身份；原 `data/versions/grpc/jobs.go::GetVersioningJob` 消费 NodeChangeEvent，未冻结
  平台 operation key、binding generation 和上传不可变字节与 claimed Task 的因果。

当前二开 `gateway/restv2/native-actor.go::Handler.nativeActor` 只承接已实现的四个
授权读动作，不能借其证明开放 S3 写入，也不能拿本地展示 Task/随机 UUID 充当
稳定操作回执。故本批不猜 key/TTL、不启用 generic write/share 或完整 FILE_STORAGE；
原 Mongo 跨 collection Job 存活性、claim 安全退休/失联对账、条件删除原子性与
分享多 RPC UNKNOWN 仍保留发布阻断。版本读取修复不代表 uploader 或跨服务 E2E。

## 2026-10-09 原 PromoteVersion 的 HUMAN 准入生产者与真实 HTTP 观察

本批只交付原生已持久 draft 的准入生产者及观察消费者，不是 write executor、
完整 uploader 或 FILE_STORAGE 批准。源码范围为 12 路径（11 个 Go 文件及原
`deploy/start.sh`），相对当前 main 新增 1041 行、删除 16 行；本回执另计。
继承的 `deploy/compose.yaml` 不属于本批。未更改原页面、数据库或部署任何服务。

### 四步影响结论及固定来源

1. 权威：`.design/07` §2 的 `file_storage.write@v1 → update` 与 §5 原
   COMPONENT_ACTION/Temporal 接缝是已有要求；当前执行者缺失属于需恢复项，
   不据此把一期永久缩为只读。DD-89/93、SS-CEL-MATERIALIZATION 保持原
   native Node/Task/Version 与正文权威；Core 只收原 ActionCommand 的引用。
2. 影响：原 `NativeKailoOIDC` 回调、native session、两条原 logout 调用方、
   `Handler.PromoteVersion` 与原 binding callback transport；没有新增上传路由、
   队列、账号、权限目录或任务账本。独立无 platform 投递仍走原 copy/ACL；
   绑定模式不因凭据缺失退回该路径。公共 write schema 由主线独立生成验收，
   本批实际消费五字段 ContentReference，不自建 schema 或批准目录。
3. 副作用：只接受独立验签的真实上游 access JWT，不借 ID token、Cells 本地
   HS256 JWT、SERVICE 身份或发起者身份。credential 在原 key 加密的 native
   HttpOnly/Secure/Strict Cookie 内，绑定现有 native user、session、connector
   和 token expiry；同 session 刷新不延长上游有效期，退出清除该 credential。
   每次原 Core callback 仍验证 SERVICE transport 及 HUMAN proof。两者不进入
   页面 JSON、Task.RunParameters 或诊断正文；未消费的 native execution proof
   在原 route 任何 ReadNode 前摘除并拒绝。
4. 边界：单个 canonical Idempotency-Key 先走原观察，只有权威 404 才允许确认
   原 draft owner/location 后提交一次原 ActionCommand；观察不可用、提交 ACK
   丢失均不 copy、不换 key、不重复提交。目标先由原 current user/scope Resource
   查询解析，冻结资源版本、binding 实例/scope、原 draft revision 及原 Publish
   flag。来源资源缺失不能伪造新 Resource。命令 opaque 引用精确编码 node/publish，
   重复键、未知字段及非 bool 均拒绝；原 revision 保留 opaque 字符串能力。

固定官方源码为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`，本轮只读 git
核验其完整路径和符号：

- `gateway/restv2/api-versions.go::Handler.PromoteVersion/promoteDraftVersion/publishDraftNode`：
  原 Promote 是 draft copy，Publish 是另一原 UserMeta 操作；只有实际 Publish
  成功才可设置 Published，版本存在本身不证明那次发布完成。
- `common/nodes/version/handler-version.go::Handler.routeUploadToContentRevision` 与
  `data/versions/grpc/handler.go::Handler.CreateVersion`：原 VersionUuid 可由调用方
  提供，非空时不强制 UUID。因此仅 node/key 保留其既定 UUID 校验，不额外削减
  nativeRevision 的 opaque 语义。
- `idm/oauth/grpc/handler.go::Handler.LoginChallengeCode`：复用实际 native login
  session，不新建第二会话权威。

COMPLETED 只消费原 Core producer 的三个已定终态之一：ALLOWED/DISPATCHED、
nativeType=version、真实不同于 draft 的 VersionId、原 HeadVersion owner/非 draft
全部成立，随后沿原 UuidClient/原 ACL 以显式 StatFlagNone 真正回读当前 Node。
拒绝不可查、异 UUID、目录及撤权结果，不返回调用前快照。没有独立 publish 因果
receipt 时 publish=true 明确拒绝；不从请求推断 Published。原 producer 未终态时
省略 terminalStatus 才返回 202；显式 UNKNOWN/RUNNING/未来枚举/null/空值等不
冒充 pending，FAILED/CANCELED 拒绝。运行中/结果不明不填 TaskID 充当 nativeId。

按 `06` §4，认证/引用失配属于 DENIED，配置/binding/secret 缺失属于 PRECONDITION，
响应或请求超过已投递上界属于 LIMIT，确定 FAILED/CANCELED/冲突保留 CONFLICT，
不明外部结果保留 UNKNOWN、不得重放；执行链未开放属于 BLOCKED。当前只验证
不明 ACK 不重放，原 uploader 的 UNKNOWN 呈现尚无真实消费者验收，不能据后端
错误返回声称前端六类状态已经全部闭合。

### 实际命令、失败及还原

复用原 `kailo-cells-native-check-lftow7`，Go 1.26.8、UID 1000、4 CPU/8 GiB、
无额外 swap；镜像 `sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`。
原候选 `codex-cells-native-identity-20261005.LfTow7/apps/file-storage` 挂到
`/workspace/file-storage`，独立原缓存投递 `/cache/mod`、`/cache/build`。
执行前实查无其他 Go/Cargo 编译、MemAvailable 约 24.7 GiB、memory pressure=0，
回读 cgroup 4 CPU/8 GiB/无额外 swap；本窗口峰值 2632499200 字节、OOM=0。

最终正向、唯一生产破坏及还原复验共用原五包目标：

```sh
sudo -n docker exec -e GOMODCACHE=/cache/mod -e GOCACHE=/cache/build \
  -e CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  -e CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  go test -mod=readonly ./common/auth/protocol ./frontend/web ./gateway/restv2 \
  ./frontend/rest ./frontend/rest/modifiers \
  -run 'Test(AuthorizeAction|NativeHumanAction|Resolve|KailoOIDC|NativePromote|NativeActor|NativeIndependent)' \
  -count=1 -v
```

- 79495 exit1：最初漏 working/data 投递，原 init 拒绝目录，未进入业务检查。
- 60232 exit1：原 native OIDC policy fixture 缺真实 PolicyEngine RPC，7 子项拒绝；
  后补原生成服务 stub 的精确 native user/login allow，没有放宽生产策略。
- 98563 exit1：原 response 未提供 Content-Type 协商，7 子项 406；另两包因
  GOPROXY=off 缺锁定依赖 setup failed。随后经批准沿原正常 Go proxy 获取
  go.sum 固定依赖及其锁定传递依赖，未改 go.mod/go.sum，不能称纯离线。
- 15349 exit1：真实 MIME 协商揭出 Cells 全局 ProtoEntityReaderWriter 对 pending
  map 断言 proto.Message 的真实 panic；生产出口改用原 go-restful
  WriteHeaderAndJson，COMPLETED 仍用原 protobuf 响应。
- 52913 exit1：剩余 4 子项来自 SourcesPool 只初始化一次、fixture 重换 opener
  无效及使用普通 JSON 解码原 protobuf int64；修正为原 stable client/原 ACL、
  原 protojson 与原 Role RPC，未修改生产授权规则。
- 74907 exit0：最终五包 16 顶层、103 子检查通过。
- 48475 exit1：只破坏私有两个真实生产文件的五处保护（ID token 冒 access、
  冻结 native 引用匹配、publish 因果、fresh Node 输出、未知终态拒绝），原目标
  实际 2 顶层、15 子检查失败；正式源码未破坏。
- apply_patch 原字节恢复后 38961 exit0：同目标 16 顶层、103 子检查再次通过。
  12 自有输入及 go.mod/go.sum 正式/候选 cmp=0；原容器 gofmt-l 空输出/exit0，
  bash-n 与正式 diff --check 均 exit0。frontend/rest 只编译通过、筛选无适用
  检查，modifiers 无 test files，不把这两包记成新 logout 业务检查。

原部署入口 `bash file-storage/deploy/start.sh --check` 在既有私有无真实凭据
fixture `cells-native-action-delivery.gJxSPm/upload.env` 上正向 exit0；bool version、
未知 write 字段、缺 policy、空 workspace 四次输入破坏均 exit2，字节恢复后
exit0。未启动服务；最初使用不完整 env fixture 的 exit1 原日志保留。

主 Go 日志及生产变异原件均在
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 文件 | SHA-256 |
|---|---|
| cells-native-upload-admission-positive.log | `7478e09533f5348b1a50bf2b5641d2190b25a1ad2210f7bb8f341886f4d16eeb` |
| cells-native-upload-admission-final-positive.log | `24c51118693b3039933786b1c83b92e3902e5e0221685b2c6880cc7c45c14f3c` |
| cells-native-upload-admission-opaque-positive.log | `232a5d05936585154a78154187b7b6f39f5baab51a848d0d8ff44c3c5c532867` |
| cells-native-upload-admission-completed-positive.log | `3a525b935e8d7ca6be4a900c77f548a1e86d30832c75537c96dc7fd7d967a809` |
| cells-native-upload-admission-json-positive.log | `0619bc22d1ad20209a1c9a73f38206a22a18e0ed378f5eb42863fdf8984e17d9` |
| cells-native-upload-admission-final-byte-positive.log | `b2550cf7a7e2cb0fe2cceca9fcddd484fb3cb237783253be86f06fa4f9e70005` |
| cells-native-upload-admission-production-negative.log | `54bc6bfbb7c988c81efa431e80a1daf8e27d055c2d0cfae4b622d8643df6b99d` |
| cells-native-upload-admission-restored.log | `b2a068925cf3dd74d99d594b73dfd139be1330aacc278c512097c4500098122e` |
| cells-native-upload-admission-production-mutation.diff | `279cc782f8d4c8b99126a0315eab2c8f20b9ecbf577431e0d878ee6e3bf8fe37` |

### 准入生产者不是完整写入交付

尚未实现/验收 native write executor、原 uploader UI 到该 producer、Task 到实际
published Version/byte-op usage 的端到端因果与 typed 输出引用；publish 副作用仍
没有原终态 receipt。当前只针对已注册现有 node Resource 的原 draft Promote，
不能冒充新文件全上传。完整 FILE_STORAGE 七必选键、delete/share、Mongo 跨
collection Job 存活性、claim 安全退休/失联时限与真实批准 binding 仍为发布缺口。
本批无 full、镜像/服务更新、真实对象存储写入、业务库改写、浏览器截图、Windows
或 Mobile 验收。私有原 RPC/HTTP fixture 的通过不等于组件 E2E，不声明 100% 还原。

## 2026-10-09 原 Promote → native Task → published Version 写入消费者

本节追加的是上一批准入生产者之后的真实执行消费者，不把旧批的成功数字计入
新字节。原页面、上传器、独立入口与 native ACL 均未重新设计；仅在已投递的
write 配置及可信原生执行证明存在时进入平台执行分支，无证明继续原独立流程。
完整 FILE_STORAGE 仍未批准或激活，本批不修改业务库状态。

### 权威、影响、副作用与异常

1. 权威：`.design/07` §2、§5/5.2 的 `file_storage.write@v1 → update` 与
   原 COMPONENT_ACTION/Temporal 执行已经确定，本批补实际消费者，不缩成永久
   只读目标。固定官方 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/restv2/api-versions.go::Handler.PromoteVersion`、
   `data/versions/action-version.go::VersionAction.Run`、
   `scheduler/jobs/rest/handler.go::JobsHandler.UserListJobs` 是复用入口；
   原 live 文件 CopyObject 消费当前 native actor ACL，版本归档和已归属 draft
   清理沿固定原实现的 system version router。publish 是另一副作用，不能靠
   请求标志、版本存在或任务排队推断成功，本分支仍明确拒绝 publish=true。
2. 影响：既有 adapter 的 HTTP/MCP execute、observe、extract_usage、原 Promote
   REST、原 Job/Task、原 VersionAction/CreateVersion、受控 start 投递共用同一
   输入和结果。沿已存在的五字段 ContentReference 消费，不改公共合同、Core、
   Worker、原数据库结构或 native Task/Version 权威。原 node actor 映射移到有
   两个真实消费者的 common/auth 模块，仍只关联既有独立 native 用户；
   不共享 SERVICE 角色、不借 initiating HUMAN 身份、不在前端投递凭据。
3. 副作用：execute 的签名 key、AE/Operation、actor、binding、target 和冻结
   参数必须精确相等，fresh Core PEP 后再由原 HTTP Policy/root/ACL 消费。
   原 Task 的 create-only 原子 claim 及完整落盘 ACK 是唯一首次 copy 准入；
   原任务已存在只读回相同 intent/receipt，不再次 copy。task 只存 scope、
   输入引用及摘要，不写 ActionToken、SERVICE secret、Job.RunParameters 或
   文件正文。execute 前后和输出披露前均保留授权检查；不明写入不结算用量。
4. 异常：原 draft 先按 owner、opaque revision、Size/ETag/Location 实查，
   归档只读取该 revision，不把另一次上传的新 head 当输入。原 VersionAction
   普通事件即使携 version 元数据也仍走原 head 路径。显式 claimed VersionId
   不会被同 ETag 的原 dedup 吞掉，普通无显式 key 的 dedup 不变。发布结果须
   原 StoreVersion ACK、同 task/action/node 的稳定 VersionId、原 draft 清理
   ACK、最后 HeadVersion 回读以及 Finished Task 完整落盘全部成立；零字节
   使用真实 Size=0，不据字段缺失伪造非零或终态。中途撤权、RPC/claim ACK
   不明、部分 copy/清理成功均保留原 Task RUNNING/UNKNOWN，不重放副作用。

Core 原 EE 从始至终 nativeType=version；只有确定的 published Version 才填
nativeId，不能先填 TaskID 再换 ID。typed 输出 nativeObjectRef 是真实 node UUID，
不是输入命令 JSON；resultJson 为原空 metadata 对象，不复制正文到 Core。
观察与用量调用沿原 `/jobs/user` 和已持久 Task/ContentRevision，只带原 AE/key
及可选已知 nativeId，既不重读 SOURCE 字节也不再次执行。CONTENT_BYTES/COUNT
只取已完成 Task 的原 published Size/EndTime 与受控 meter 投递。

按 `06` §4，签名、actor、目标与冻结引用失配为 DENIED；缺配置/secret/native
Job/版本条件为 PRECONDITION；超投递响应预算为 LIMIT；同 key 异 intent、
已知 nativeId 不一致为 CONFLICT；未知外部结果为 UNKNOWN；未闭合的完整
FILE_STORAGE/delete/share/publish 能力维持 BLOCKED，不借 NONE 管理 token
执行业务或把前置条件缺失降级为原独立执行。

### 验证范围与仍保留的发布门禁

验证复用原受限 `kailo-cells-native-check-lftow7`（Go 1.26.8、UID1000、4CPU/
8GiB、无额外 swap、原 /cache/mod 与 /cache/build）和原
`kailo-wren-query-sdk-itgs2n` 的独立小候选（4CPU/4GiB、锁定 MCP SDK 1.26.0）。
执行前实际回读 cgroup/原构建进程/CPU内存及 I/O 压力；没有新镜像、依赖
安装、数据库、全树副本或 full。原 Go 首次运行因 auth/authorizations 导入环
exit1，保留 `cells-native-write-positive.log`；随后把 Policy 留在实际 REST
调用方而非共享 auth 中，修正后原六包目标 exit0。jobs/rest 原包无 test files，
其编译通过不计作真实原生观察端到端通过。

尚未验收真实对象存储/原生 HTTP 多 RPC 纵切、原 uploader UI → Core →
Temporal → native executor → 页面观察闭环；本批原 native fixture、真实 Bolt
Task 持久化检查与 HTTP/真实 MCP SDK wire 检查是分层证据，不冒充 live E2E。
Mongo 跨 collection Job 存活性与 claim 安全退休仍未闭合；已 claim 在副作用
中断后没有安全的终态对账及失联收敛时限，保持 UNKNOWN 且不重放，构成发布
阻断。当前 native 配置/action/result-policy 更换后旧 Task 观察可因精确匹配
拒绝，旧代投递保留与生命周期对账仍须真实运营验证，不能称完整 generation
切换已验收。delete/share、publish 因果、完整七必选 catalog、批准 binding 与
实际部署继续为门禁；本批不更新服务/安装包、不改线上业务数据，不声明生产
就绪或 100% 原版还原。

原 HTTP 与实际锁定 SDK Streamable HTTP client-wire 使用同一目标：

```sh
sudo -n docker exec \
  -w /work/knowledge-observation-guard.8QFEVq/file-storage/adapter \
  kailo-wren-query-sdk-itgs2n node --test \
  --test-name-pattern='native write|pinned SDK MCP|MCP transport|MCP discovery|MCP calls' \
  test/query-revision.test.mjs
```

最终正向 exit0，66/66；只在独立候选破坏 signed key、typed node 引用关联和
末次 PEP 三处真实生产保护，原目标 exit1，10 项失败、56 项通过；apply_patch
原字节还原、5 个实际 adapter 输入 cmp=0 后同目标 exit0，66/66。
覆盖 HUMAN/AGENT 的 HTTP 与真实 MCP SDK 调用、observe/extract_usage、空文件
真实 byte-op 用量、无完成证据时不计量，以及 HUMAN write 的原 map 错误策略
消费者；错误映射不调用 native writer，不借 DOCUMENT/NONE 身份。

本批 Node 证据仍在原 Cells 候选根目录：

| 文件 | SHA-256 |
|---|---|
| cells-native-write-http-final-map-positive.log | `e5aaad4bf9b58ffaf9ff9b5ee65b3dc8d381bb09e98a92d3b1388c5bbfccba03` |
| cells-native-write-http-final-production-negative.log | `490b16f3f746ddeacaf68ea95e43b0b0af0430f084f53583616394042d45bb25` |
| cells-native-write-http-final-restored.log | `87f626e1d6e246086098353646704c2d8cac1bc0d197fade0a995afe090e7ae0` |
| cells-native-write-http-final-production-mutation.diff | `204deac28d332a603bb817c5ee1162ce41627a6f91794ca4a31989d85b9a2de1` |

原 Go 正向、有效生产破坏和最终还原共用原六包目标：

```sh
sudo -n docker exec -e GOMODCACHE=/cache/mod -e GOCACHE=/cache/build \
  -e CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  -e CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  go test -mod=readonly ./common/auth/protocol ./data/versions \
  ./data/versions/grpc ./scheduler/jobs/grpc ./scheduler/jobs/rest ./gateway/restv2 \
  -run 'Test(AuthorizeAction|AuthorizeOperation|VersionAction|KailoNative|NativeWriteTask|NativeTask|NativePromote|NativeActor|NativeIndependent)' \
  -count=1 -v
```

- 60915 exit1：最初 auth/authorizations 导入环，非通过；原日志保留。
- 60932 exit0：修正导入边界后的六包通过。随后集中加入普通 event 与显式
  Version key 的原消费者检查、原 system version router 与 terminal HeadVersion
  回读，97562 exit0：14 顶层、134 子检查通过。
- 77401 的最初私有变异误删 `zed` 唯一使用，原编译真实失败；没有冒充保护
  命中。确认精确自有 Go 进程后终止该无效运行，终态 exit143，原日志保留。
- 修正变异为可编译的真实保护绕过，仅私有三生产文件：空 PEP revision、
  frozen draft CopyObject 与 Task→Version 稳定引用。24619 exit1，实际 4 顶层、
  6 子检查失败；不是 fixture 断言自改或只编译失败。
- apply_patch 原字节恢复后 45566 exit0：同六包 14 顶层、134 子检查通过。
  最终包含 HUMAN/AGENT 两种 actor 共用的 native signed EE/key 严格要求，
  15 个 Go 输入正式/SDK cmp=0；gofmt-l 空输出/exit0，bash-n、diff --check
  均 exit0。jobs/rest 无 test files，仅编译，不将其计作新 native E2E。

本窗口未新拉依赖、未改 go.mod/go.sum。原 SDK 最终 memory.events 各项均 0；
生命周期 memory.peak=2632499200 字节，不能将该既有容器累计值冒称本批独立
峰值。Go 在途实查宿主 I/O full 曾超过 60%，保留原有效句柄等待，没有因 I/O
重启有效检查或另建环境。部署 start 的新 nativeJob/binding 配对仅 bash-n
通过；本批没有运行新的 --check 配置 fixture 或实际启动，明确未验收该投递。

| Go 文件 | SHA-256 |
|---|---|
| cells-native-write-positive.log | `ab6798f770b41df5166355d0904bae5459d43d45665c4c041482c406bf18ed65` |
| cells-native-write-corrected-positive.log | `554915094b41bcb2a43dde3a3cdb82e3c2432432c4ed33ad12846860df71d49a` |
| cells-native-write-final-positive.log | `c0d6fd6b1451e4c639c5253802d3fa6895641774a5ddcce90185ee5b588713d7` |
| cells-native-write-final-production-negative.log | `6a34e2bcf9203d2ccd8952a707296cc9be905da86182cb28a9e823416259f482` |
| cells-native-write-effective-production-negative.log | `052d383505831c63b41a9c0a6c2c790be5e88192b928c24b361470b0bb5fea06` |
| cells-native-write-effective-production-mutation.diff | `0973a7fc266843a6f35a37c29254c03d5ccb97bc8a79c6aefa6c855ade932241` |
| cells-native-write-final-restored.log | `19ec3797326a4bbebfc1e216c1a885760e44c53158b6faf4cd81c41d6d33d23c` |

## 2026-10-09 原生首次 draft 预留、字节 ACK 与清理 fence

本批是原 Cells Version 生产者、读取者和清理消费者的二开，不是完整上传入口
验收。原 uploader 页面与独立原生 ACL 未改；平台配置存在时，原 S3 hook 的
PUT/POST/DELETE 继续明确拒绝，不能借未登记节点或不完整配置退回独立执行。
read/list/list_revisions/export 和既有 Promote 执行链不因此被声明为完整七项
FILE_STORAGE。修正历史提交说明：`2f26494c5` 的提交正文出现的
`SS-CELLS-GOVERNANCE` 并非已登记接缝，不能作为设计权威；本节依据仍为
`.design/07` 原组件 Action/授权与错误合同、DD-90/DD-93 及下述固定源码。

### 四步影响与真实调用链

1. 权威与基准：固定官方 commit
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`，本轮只读 Git 重核对应符号：
   `common/nodes/version/handler-version.go::Handler.routeUploadToContentRevision`、
   `data/versions/grpc/handler.go::Handler.CreateVersion/StoreVersion`、
   `data/versions/dao/bolt/bolt.go::BoltStore.StoreVersion/DeleteVersionsForNode`、
   `data/versions/dao/mongo/mongo.go::MongoStore.StoreVersion/DeleteVersionsForNode`、
   `data/versions/action-prune.go::PruneVersionsAction.Run`。原样保留独立 UI、
   native router/ACL 与普通版本路径；本批属于已授权治理接入所需的原生版本
   持久化改造，不是重新设计页面或另建同步、任务、账本和权限权威。
2. 影响：原 PutObject/MultipartComplete 在原 CreateVersion 前冻结 owner、
   revision、Location、预期大小和时间；绑定模式用原 Version 同一行先做
   create-only 预留，成功才给原 writer Location。真实字节 ACK 通过原
   StoreVersion，只有 ETag/ContentHash/实际 Size 可更新，其他冻结字段必须
   精确一致。Bolt 原事务和 Mongo 原唯一 node/version key 分别承接 CAS。
   GetVersion 拒绝不明行，GetLastVersion/GetVersions 隐藏 pending/cleanup；
   普通 StoreVersion 不可旁路 completion。原单个/批量删除保留该行和原
   Location 为 cleanup fence，不释放同 key。Core 不存正文，字节仍在原
   Cells 对象存储，native 行只有原版本引用及生命周期元数据。
3. 副作用：相同 key 的重复 reservation（包括完全相同输入）也不再次发放
   Location；预留 ACK 不明不写 bytes，字节 ACK 不明不发布版本、不二次
   PUT。PruneDraftUploads 沿原 DeleteNode，先在原行 fence 再删除对象，
   false ACK/error/cancel 不当清理完成。清理失败保留可发现 Location；晚到
   PUT 后后续同一消费者仍能找到该 Location。清理顺序取首次 deadline、
   后续原行最后 sweep 时间，避免持续新过期行饿死旧 fence；该时间绝不证明
   writer 已终结。没有第二份正文、操作收据或平台执行状态。
4. 边界与配置：原 config store 的 `NativeActorDelivery.draftUploads` 必须
   显式投递 timeout/sweepInterval/sweepBatchSize，没有默认值；清理请求上界
   复用同份已投递 requestTimeout，不借 multipart expiry 或新硬编码期限。
   原服务启动冻结配置并沿 AfterServe 启动消费者；缺项/无正期限拒绝配置或
   暂存。每轮开始先撤 cleanerReady，使用有界 ctx；阻塞/超时/取消时不得
   沿用上一轮 ready 放行新暂存，Bolt 长扫描逐行响应 ctx。零字节真实
   Size=0；未知生命周期记录、异 owner/Location、超期 ACK、重复/并发 key
   均不产生成功版本。取消/配置变更/远端不明仍不能证明旧 writer 未写。

版本模型未改公共 protobuf。原 ContentRevision 与 legacy ChangeLog 读取仍由
原 DAO 检查覆盖；新私有上传 wrapper/字段不能交给旧 binary 混合读写。该模式
不得在混合版本运行时开启；部署需同批原生 writer/reader/cleanup 二进制，
本批未实际发布该兼容窗口。原 Migrate 遇 pending/cleanup 直接拒绝，不能用
普通版本迁移静默丢 fence；新鲜库发布要求不等于旧 reader 可读新行。

按 `06` §4，平台 S3/owner/权限拒绝沿 DENIED；缺投递或未就绪沿
PRECONDITION；重复 key、冻结字段不一致、超期 completion 沿 CONFLICT；
对象/落库 ACK 不明沿 UNKNOWN；完整上传未闭合沿 BLOCKED。没有新增平台
错误分类，也不把 fresh 资源授权称作审批或 quota 预留已经完成。

### 实施后验证与生产破坏

复用 `kailo-cells-native-check-lftow7`：Go 1.26.8、UID1000:1000、4CPU/
8GiB、swap.max=0，原 `/cache/mod`、`/cache/build` 与已有候选。启动前只读
核实原在途进程、cgroup、CPU/内存/I/O；最终批前 MemAvailable 22GiB，内存
PSI=0，Data 可用 279GB。未建镜像/SDK/数据库或运行 full。

最终命令（外层 RTK、pipefail 与 tee 保存原输出）：

```sh
sudo -n docker exec -e GOMODCACHE=/cache/mod -e GOCACHE=/cache/build \
  -e CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  -e CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  go test -mod=readonly -tags kv ./common/nodes/version ./data/versions \
  ./data/versions/dao ./data/versions/grpc ./data/versions/grpc/service \
  ./gateway/restv2 ./gateway/data/hooks \
  -run 'Test(DraftUploadRequiresNativePersistence|NativeDraftUpload|KailoNative|NativeBoundDataGatewayDoesNotBypassPromote|DAO_|VersionActionRequiresExactNativePersistence)' \
  -count=1 -v
```

- 初次 25458 exit0：7 顶层/91 子检查；中间 55326 exit0：12/118。
  这些是较早字节，不能代替最终输入验收。
- 私有生产变异 46006 exit1：绕过 Bolt 重复预留拒绝和清理前 fence，实际
  4 顶层/13 子检查失败；原 RPC writer 真执行两次，非只改 fixture 断言。
  同轮删除保护因上游断言先停止未独立命中，故没有冒算其覆盖。
- 独立删除保护变异 72612 exit1：关闭原 Bolt native-row 保留分支，实际
  1 顶层/1 子检查失败，原 Location/key 已不可检出，被原检查捕获。
  这两个负向的原 storage fixture 用外层 t.Fatal，附有 Goexit 提示；这是
  fixture 的退出行为，不是生产 panic，更不是把编译失败当负向通过。
- 初次恢复 60116 exit0：14 顶层/121 子检查。随后完善阻塞 fixture 的真实
  native policy 条件；私有生产变异 22684 移除每轮 ready 撤销和有界 ctx，
  原 TestKailoNativeDraftUploadBlockedSweep exit1，1 顶层失败，实际报告
  旧 ready 留存、阻塞期 CreateVersion 给出新 Location、超出投递请求上界
  三处错误；不仅检查私有状态枚举。
- apply_patch 原字节还原后 86058 的六个业务包 14 顶层/121 子检查通过，
  新增真实 S3 hook 编译因 GOPROXY=off 缺缓存的锁定 MinIO 而整体 exit1，
  原失败保存，未冒称七包通过。
- 沿原正常代理获取 go.sum 固定的
  `github.com/pydio/minio@v0.0.0-20251127102432-d3b575770589`（76302 exit0）
  及同锁传递依赖后，最终 78561 同七包 exit0：14 顶层/121 子检查通过。
  这轮并非纯离线。go.mod/go.sum 无改动，正式/候选二者 cmp=0。
- 最终 14 个自有源码/检查/启动输入正式与 SDK cmp=0；gofmt-l 空输出、
  bash-n、diff --check exit0。SDK memory.events 全 0，既有容器生命周期
  memory.peak=2632499200 字节，不冒充本批独立峰值。所有句柄已终态，
  没有重复启动在途目标。service 与 gateway/data/hooks 无 test files，
  只证明编译；原 REST 48 子项消费实际 S3 gate helper，不是签名 S3 wire。

日志均在
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 日志 | SHA-256 |
|---|---|
| cells-draft-reservation-positive.log | `63825e1e8fa044afbc82ef8a04cb39ac8aafa18c6f3c67b842d17c428ec4bccd` |
| cells-draft-reservation-final-positive.log | `7bf16509ab3bf1bcd91b0347db910070f6eb9355aa9ac9ce23939007c22b2737` |
| cells-draft-reservation-production-negative.log | `1229c44748ccfd135c1dd86894ed8df6738e5b98a633dcdc5d835a295734c31f` |
| cells-draft-reservation-retention-negative.log | `add439fe2963ccb3ad9c0db49eb0a93bff141dcd25ac5498b0d0498cb43999ca` |
| cells-draft-reservation-final-restored.log | `2d13b4d56b4c27b665eb54b504ba052dfd7cca64ea72d4e4b9bc1f1e701a9454` |
| cells-draft-reservation-readiness-negative.log | `484d3b6041c5dbfe11d4317ff3066f8dc064e97ef3046c34bc2d7cf70a2461da` |
| cells-draft-reservation-cleaner-final-restored.log | `c65193fc947dff87277e3f967308a37cf367935f4025ab3abd83f819d3178359` |
| cells-draft-reservation-locked-dependency.log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| cells-draft-reservation-with-hooks-final-restored.log | `889e971d49a1e51418698cbd0e767ff15c8ea95a98bd18f3e80581de50ac7038` |

### 未验收与发布门禁

CLEANUP fence 保留、后续定期删除不等于 writer 已终结；远端 writer 退休、
安全释放原 key/最终清理时限仍无确切证据，不能凭 deadline、一次 Delete ACK
或本机取消删掉原行。当前引用可检出但尚不能确定终结，因此平台上传保持
关闭，不能把本批写成完成首次上传、全上传或生产就绪。审批/quota 前 staging
的完整边界、原 uploader→稳定 Action→202/同键观察消费者也没有本批 live
证据；本批没有把有 Resource 的老节点路径冒充新文件完整注册/上传。

Mongo 仅编译，真实 unique/cleanup index 迁移与数据库 CAS 并发明确 SKIP：
没有受控 Mongo fixture，不造新数据库。原服务 AfterServe 启动、start.sh
配置投递/重启、真实 S3 签名 wire、原对象存储多 RPC、浏览器/设备、跨服务
Cells→WeKnora/live binding/full 均未在本批验收或部署。Task 失联/旧代对账、
delete/share、publish 独立因果、完整七必选 catalog/批准 binding 原门禁仍在；
没有强改业务库 ACTIVE，也不声明 100% 原版恢复。

## 2026-10-09 原下载/预览/历史版本的 Promise 消费修复

本批不继续扩上传 fence。固定官方
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`common/nodes/version/handler-version.go::Handler.PutObject/MultipartComplete/MultipartAbort`
提供原对象写入与 multipart abort 调用，但没有按平台上传 key 查询远端
writer 已不可再写的终结证据；abort 接受不能证明分区恢复后不会晚写。
上一节原预留/CAS/清理仍不是完整上传，平台 S3 写入保持关闭。

本次转到不依赖上述缺口的原生读取消费者，四步结论：

1. 权威/差异：固定官方
   `frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::PydioApi.buildPresignedGetUrl`
   与修改前交付文件精确 diff=0，属于官方原有缺陷，不是共享迁移漏复制。
   原 `awsLoader.js` 动态加载 SDK，固定官方
   `frontend/assets/gui.ajax/res/dist/core/aws.min.js` 实际设置 window.AWS/self.AWS；
   因而不能说浏览器必然缺全局 AWS。修复逐项为：直接消费已加载模块的 S3，
   串回原 token/module/signing Promise 的拒绝，原下载与 callback 调用显示
   原有 ERROR 消息。不改页面、文案、布局或交互入口，不声称字节原样一致。
2. 影响：原 `downloadSelection` 的单文件、目录、多选归档都复用同一签名
   Promise 与原隐藏表单/移动浏览器跳转；`openVersion` 继续相同 VersionId
   与原 callback API；预览继续原 preset/key/cache。原函数原先的外层
   Promise 只接 resolve，内部拒绝不返回给调用者，导致永久 pending。
   现沿原返回链传递拒绝；callback 仍返回 null，错误沿现有 UI 消费，不能
   将 undefined 当 URL 发给隐藏表单。没有第二下载器或新 endpoint。
3. 副作用：native JWT/签名、当前 workspace slug、原 key/VersionId、
   MIME/附件参数、缓存和原 ACL 均保持。没有向前端投递 SERVICE credential
   或 ActionToken，不绕平台授权、不启上传；多选归档仍调用原 createSelection，
   其拒绝不会继续签名/下载。Core、schema、版本持久化和用量权威未改。
4. 异常：token 刷新拒绝、动态模块拒绝、实际 signer 抛错分别使 Promise
   明确 reject 或使原 callback/download 显示错误，不生成成功 URL；普通
   文件/目录/多选、移动跳转、预览 inline、历史 opaque VersionId 与 cache
   命中保留。该 native 读取错误不产生平台业务终态或结算事件，沿 `06` §4
   保留既有认证/前置条件失败边界，不把本批前端拒绝当写动作 FAILED。

实施后在原 `adapter/test/query-revision.test.mjs` 追加真实消费者检查。VM 只
替换原浏览器模块 imports 为已有 API/SDK fixture，执行完整原 PydioApi 类，
没有复制下载实现；它是 browser API 调用逻辑证据，不是完整 bundler、真实
AWS 签名 wire、原页面截图或 HTTP/对象存储验收。复用原受限
`kailo-wren-query-sdk-itgs2n` 独立候选，4CPU/4GiB、UID1000、swap.max=0；
执行前原 SDK 无在途 Node，宿主 MemAvailable 22GiB、内存 PSI=0，未新装
依赖/镜像/SDK。与 Wren 单 suite/tsc 错开，只做本批两筛选：

```sh
sudo -n docker exec \
  -w /work/knowledge-observation-guard.8QFEVq/file-storage/adapter \
  kailo-wren-query-sdk-itgs2n node --test \
  --test-name-pattern='original native download|original native signing failures' \
  test/query-revision.test.mjs
```

原目标正向 exit0：2 顶层+20 子检查，计 22/22。只在私有原生产文件的真实
签名 Promise 后追加 `.catch(() => undefined)`，原目标真实 exit1：13 失败、
9 通过，捕获 token/module/signer 拒绝被吞及错误 URL/原 UI 未获拒绝；未改
断言或用编译失败冒充命中。apply_patch 恢复原字节、两输入正式/SDK cmp=0
后同目标 exit0，22/22。原 SDK node --check、正式 diff --check 均 exit0。
SDK memory.events 全 0；生命周期 memory.peak=3837739008 字节，不是本批
独立峰值。无在途命令，随后把原共享 SDK 窗口归还 Wren 队友。

原日志仍在
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/`：

| 日志 | SHA-256 |
|---|---|
| cells-native-download-positive.log | `33a8dc0e88baf9c0a2ef5b09bfe003bd41f51718d812e9ae0691ac509e450bc9` |
| cells-native-download-production-negative.log | `590f594e8f3f298bd2d86c11619b3f18e4dfd72fbf679166fb2a0ee0dfdc6e36` |
| cells-native-download-restored.log | `d2cdc7d00af4c49fa667fab0e2abaeb45ad2b8a0fa89780060b89c340d962357` |

本批未构建前端 artifact、未部署、未跑 full、未做浏览器/设备截图。原完整
预览 Hook 的 React 渲染与失败展示、真实当前用户撤权后的 S3 请求以及完整
FILE_STORAGE release/binding 仍未验；检查中的 mobile 分支只是原浏览器跳转
逻辑，绝不冒充 Kailo Mobile 宿主或设备验收。上一节写入退休/清理、上传
准入、Task/usage、delete/share 及七必选 catalog 原门禁均未解除。

## 2026-10-09 原历史版本与归档下载的目标仓库消费者修复

固定上游仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`，本批正式
HEAD 核对为 `5baad5e09a6c8abeb33bbfa1904fe0ee77034b78`。本批不开放
platform S3 写入、未完成的 uploader、generic share/delete 或 Skills 入口。

1. 权威与来源：`.design/08` §4、DD-90/93 与原版本功能要求读取/恢复的是
   原目标对象，不是当前活动仓库的同路径对象。固定上游完整路径
   `frontend/assets/meta.versions/res/js/Revisions.js::load/applyAction` 已按
   `node.repository_id` 加载历史并把原 node 交给 openVersion/revertToVersion；
   `frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::openVersion/revertToVersion`
   却直接取 active workspace。这是固定官方原调用缺陷，不是此前迁移删页面。
   本批复用同文件 `getSlugForNode` 与
   `frontend/assets/gui.ajax/res/js/core/model/User.js::getRepositoriesList` 的
   原当前用户目录，不增加第二仓库映射或 native 业务 API。
2. 影响面：两个原版本入口共用目标仓库解析；显式 repository_id 未知、空值、
   slug 不可用或无 active workspace 时拒绝，不回退到当前同路径对象。
   单目录归档构造的原临时 node 保留 repository_id，多选归档在原 selection
   RPC 前固定 context 仓库/路径并验证可解析。签名 Promise/callback、普通
   下载、原文本读取/保存的实际错误链接回原 displayMessage，恢复只有原
   copyObject callback 无错误才回调关闭原版本面板。没有改合同、数据库、
   平台状态、绑定或客户端传输权限。
3. 副作用：不新建上传、版本、队列、Task、权限或操作收据；恢复至多原一次
   copyObject，不因丢失或拒绝响应重发。这里的浏览器仓库目录不是授权权威，
   原 S3/native ACL 和 platform S3 禁写仍由后端执行；本批不以本地 slug 选择
   证明 Core 审批/quota 或当前资源授权已验收。
4. 边界：已知跨仓库、当前仓库、opaque VersionId、文件/目录/多选、预览与
   cache 原行为保留；未知/已撤销仓库无签名、下载、copy、读取或保存请求。
   selection 在途切换 workspace 不改变原归档目标；token/loader/copy 失败
   不调用原成功 callback、不自动重试。没有新错误词条，复用原 core.pydio
   `391`（zh-cn“没有仓库”、en-us“No Repository”）；原 native 错误继续原 UI
   错误通道，不能将其当作平台外部副作用确定终态。

原 Revisions.js 与 User.js 分别对固定官方源码完整 cmp 为 0，原版本页面、
布局、菜单与交互文案未改。PydioApi.js 固定官方源码 SHA-256 为
`9ef29db86d85f8a20de40527ec10a6b38538e6ef218e2703408e520533d342e8`；
该文件官方→当前的完整 diff 原件 `cells-native-history-workspace-official-pydio-api.diff`，
SHA-256 `dfa80e143f9cd38aabe3abe2f9c7c41bef228381112ffd48bea61deda3bcc47a`。
其中保留上一批签名 Promise 修复，本批差异是上述必要真实调用修正，不声明
整个 Cells 原样字节一致或全页面视觉验收。

先实现后在原 `query-revision.test.mjs` 中执行完整真实 PydioApi 类；只替换
浏览器/SDK 环境，不复制下载/恢复实现。原 `kailo-wren-query-sdk-itgs2n`
SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU/4 GiB、memory+swap 同额、UID/GID 1000；复用原独立候选与现有依赖。
执行前该 SDK 仅 sleep，宿主 available 22 GiB、memory pressure 0；与 Wren
协调短窗口，没有 Go/Cargo、镜像、依赖安装、类型全扫或全局检查。

```sh
cd /work/knowledge-observation-guard.8QFEVq
node --test --test-name-pattern='original native (download|signing|history|workspace|archive|restore errors)' file-storage/adapter/test/query-revision.test.mjs
```

正向 64/64（6 顶层、58 子项）退出 0。私有候选中真实改回两个版本消费者取
active workspace，并给真实 helper 恢复未知仓库 fallback；同命令实际
43 pass / 21 fail（含 2 个失败分组与 19 子项）退出 1，捕获错对象 copy/下载、
未知仓库放行与原错误消费者破坏，不是仅改 fixture 或编译失败。apply_patch
精确还原后两个正式/候选输入 cmp 0，同命令再次 64/64 退出 0。
memory.events 的 max/oom/oom_kill 均为 0。

原件目录：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq`。

| 日志 | SHA-256 |
| --- | --- |
| cells-native-history-workspace-positive.log | `63e8c7ee6cb6297df9ebecdb6275d3539ddd9f9122fb1e4fa206295bcbedad3e` |
| cells-native-history-workspace-production-negative.log | `484c8a6cbbc8abe3208883156189530adff55319d0b45e4dc044491909a68c33` |
| cells-native-history-workspace-restored.log | `7f1785661770edb055a5cd0b6d07998f0ff8055507f0d10e08c803cfccf8d191` |

本批没有原浏览器截图、真实 S3/native ACL wire、平台绑定或端到端恢复验收，
没有构建或部署，不将原回调检查通过称为完整上传、FILE_STORAGE 激活或生产就绪。

## 2026-10-09 原 multipart 上传错误、取消与晚回包消费者修复

固定官方仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`。本批是在原生完整
上传器内修复真实错误调用，不新增上传页面、平台状态或业务能力，不开放平台
S3 写入。五个源码/原检查路径 +375/-47，以下四步均在实现后核对：

1. 权威与来源：`.design/07`、`.design/08` 与 `06` §4 要求未知副作用不得
   自动重放。固定官方 `frontend/assets/gui.ajax/res/js/core/http/RestClient.js::
   getAuthToken/getOrUpdateJwt` 原刷新 catch 吞错，`PydioApi.js::uploadMultipart`
   的外层 Promise 只 resolve，`awsLoader.js::ManagedMultipart.uploadPart/
   finishMultiPart/abort/cleanup` 不消费 JWT 拒绝，原
   `frontend/assets/uploader.html/res/js/model/UploadItem.js::_doProcess/
   _doAbort/uploadPresigned` 可整文件自动重传或在取消后继续派发。这些是固定
   官方原缺陷，不是缺页面。差异归为恢复实际调用可用性所必需的失败收敛改造，
   不声称四文件原样字节一致；原页面、布局、文案及已有独立入口均保留。
2. 影响面：原 UploadItem → PydioApi.uploadMultipart → awsLoader → 原
   AWS ManagedUpload 同链闭合；RestClient 仍沿原 refresh/logout/remove，
   明确拒绝空凭据，不共享身份或回退 token。原匿名 callApi 的既有处理未改。
   multipart 在 send 前已确认失败仍保留原有界初始化重试；进入 send 后的
   transport/JWT/Complete 结果不明不再由外层重传整文件，收到原 401 拒绝
   仍可沿原同 part 刷新重试。没有改 schema、DB、配置阈值或执行权威。
3. 副作用：取消意图先于异步 JWT 刷新设置；实际 SDK failed 标记与本地取消
   意图共同阻止后续 part/complete。原 `frontend/assets/pnpm-lock.yaml`
   锁定 aws-sdk 2.1693.0，其 [原 ManagedUpload.cleanup](https://raw.githubusercontent.com/aws/aws-sdk-js/v2.1693.0/lib/s3/managed_upload.js)
   设置 failed，而非上游 wrapper 先前读取的 _aborted，不能以不存在的属性
   证明取消。cleanup 刷新拒绝仍把原错误交原 SDK callback，longtask 收尾一次。
   本地 attempt 对象只隔离旧浏览器回调，不是 native Task、操作 key 或收据；
   新手动 attempt 不被旧 JWT/完成回包覆盖，取消后不调用原 loaded 出口。
4. 异常：刷新拒绝/空 token、模块加载失败、两个 part JWT 交错、part/complete
   丢 ACK、send 同步抛错、abort 刷新拒绝以及取消后晚回包均有原消费者检查。
   认证错误属于既有 DENIED；派发前依赖失败保留原 PRECONDITION/修复后重试
   边界；派发后结果不明仍是 UNKNOWN，不生成平台 FAILED/CANCELED/usage。
   原 native 独立上传器只显示原错误，不具平台待对账终态视图，本批没有把
   该 UI error 冒充平台确定失败；这仍不能替代平台上传闭环与准入。

四个生产文件各自固定官方→当前的完整 diff 原件保留在下述候选目录，包含
PydioApi 已提交的下载/仓库修复，不仅看本批修改：

| 文件差异原件 | SHA-256 |
| --- | --- |
| cells-native-multipart-official-RestClient.js.diff | `a3f370047e7144481830d66d26e3d01ec1133a1a5cee2a6ea450f5ef00bc338a` |
| cells-native-multipart-official-awsLoader.js.diff | `3389839ba9bd32553abbf9cef343f50932f428dadf7060f6be779cb58fc877f9` |
| cells-native-multipart-official-PydioApi.js.diff | `9d41d91fbd55400480053d5631ef6ab247eee7fca22bb5bf7544d18d750b9046` |
| cells-native-multipart-official-UploadItem.js.diff | `90fe660300feee919ece6fa931f52e3cd08561eacc8079da74dc8c0bfcf62b7f` |

复用既有 `kailo-wren-query-sdk-itgs2n`、4 CPU/4 GiB、memory+swap 同额、
UID/GID 1000。03:56 UTC preflight：memory.current=1486286848 字节，
memory.events 全 0，宿主 MemAvailable=22990436 kB、内存 PSI avg10=0；
原 Wren Jest PID15422 为 Dl、RSS 1354164 kB，与本批轻目标实际叠加，不是
独占 SDK。未停止或修改其输入，未新增容器/SDK、依赖、镜像、Go/Cargo 或
全局构建。仅把自身五输入和未改 StatusItem.js 同步到原独立候选，cmp=0。

```sh
cd /work/knowledge-observation-guard.8QFEVq
node --test --test-name-pattern='original native (refresh|multipart|download|signing|history|workspace|archive|restore errors)' file-storage/adapter/test/query-revision.test.mjs
```

正向实际 exit0：92/92（11 顶层、81 子项），其中本批新增 5 顶层、23 子项。
原 VM 执行完整 RestClient/PydioApi/awsLoader/UploadItem/StatusItem，只有
浏览器、REST transport 与外部 AWS SDK 为 fixture；没有复制实际重试/认证
实现。SDK fixture 按其真实 failed 标记，不以 _aborted 假造终态。

只在私有生产输入破坏四处：删除 RestClient 原 catch 的 throw；删除
ManagedMultipart.cleanup 的即时取消意图；取消 PydioApi send 前取消检查；
取消 UploadItem 的结果不明整文件重试拒绝。原目标实际 exit1：78 pass /
14 fail（4 顶层、10 子项），命中吞刷新错误、晚 part 派发、UNKNOWN 重传与
取消后/旧 attempt 派发；不是改断言或编译失败。六输入含未改 StatusItem
按正式原字节恢复、cmp=0 后同目标 exit0：92/92；正式源码从未变异。
正式 diff --check exit0；SDK 还原终态 memory.events 全 0，memory.current
116502528 字节（共享容器当时值，不当本批独立峰值）。无本批在途命令。

原件目录：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/knowledge-observation-guard.8QFEVq`。

| 日志 | SHA-256 |
| --- | --- |
| cells-native-multipart-positive.log | `862c6e3e84908b950c42d745eab528204d713129c49f250e4dda4c093f0c1772` |
| cells-native-multipart-production-negative.log | `b9f249e91da35ee61ea113fe6a5c96c806a96e4c1b9e83c0c7109b6053f83208` |
| cells-native-multipart-restored.log | `4a58940403fb441917f515caeb5b81943739c0302d223ee695533d4a25d5404f` |

本批未执行前端 bundler、原页面浏览器/设备截图、真实 AWS SDK/S3 wire、
对象存储撤权/取消与完整上传 E2E，未构建 artifact、未部署、未跑 full。
原 SDK 仍可能在远端已派发后晚写；本地 abort/cleanup/error 不证明远端没有
副作用。平台 staging/writer 退休、Task 失联与旧代对账、publish 独立因果、
generic write/delete/share 和七必选 catalog/批准 binding 原门禁不变；
本批不声称完整 FILE_STORAGE 可用、100% 还原或生产就绪。

### 2026-10-09 完整上传的实际写者边界复核

固定 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`frontend/assets/uploader.html/res/js/model/UploadItem.js::uploadPresigned` →
`frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::uploadPresigned` →
`gateway/data/gw/gateway-pydio.go::pydioObjects.PutObject` 是原文件字节入口。
`common/nodes/models/structs.go::PutRequestData/PutMeta/CopyRequestData` 未传递
目标预期 revision 或原子写条件；`common/nodes/core/handler-exec.go::Executor.PutObject/CopyObject`
及 `common/nodes/objects/mc/client.go::Client.PutObject/putMetaToMinioOpts`
未消费目标条件。对上述固定树执行条件写符号检索未发现该原生消费者；这是需要
二开补齐的既定能力缺口，不是把 `file_storage.write@v1` 从交付目标删除。

`go.mod/go.sum` 锁定的 `github.com/minio/minio-go/v7 v7.0.99` 原 SDK 在现有
受限容器缓存内具有 `PutObjectOptions.SetMatchETag/SetMatchETagExcept`，但发出
条件头不等于条件已被写者执行。锁定的 `github.com/pydio/minio
v0.0.0-20251127102432-d3b575770589` 的
`cmd/object-handlers.go::objectAPIHandlers.PutObjectHandler` 未消费该条件；
Cells 自身 `pydioObjects.PutObject` 也未向原 Router 传递它。因此不得用 HTTP
header 或写前 `ReadNode/HeadVersion` 冒充跨对象写入及索引更新的原子边界。

当前 `contracts/adapter/file_storage.v1/write_input.schema.json` 明确消费已持久
输入 revision，必选五字段为 `resourceId/nativeObjectRef/nativeRevision/displayName/mediaType`，
不接受其他字段。`adapter/src/write-execution.mjs::executeWrite` 及
`gateway/restv2/native-human-upload.go::platformPromoteVersion` 消费已有 draft；
它们不是完整首次上传。原 `Version` 预留、ACK CAS 与清理 fence 也未证明远端
失联 writer 已退休，不能将本地超时、取消或删除 ACK 作为不会晚写的证据。
继续保留 `common/auth/native-action.go::AuthorizeNativeDataMutation` 的 platform
S3 禁写；没有新增入口、模型、执行账本、契约字段、批准 binding 或部署。
原完整独立上传页面与其 native ACL 未删减。后续补齐必须让真实原生写者消费
已准入的冻结操作及条件，不重放 UNKNOWN，不借只读子集批准完整七项能力。

本轮权威定界保持上述五字段与“确切已持久原生输入 revision”语义；
本动作输入的 `nativeObjectRef` 是不透明服务引用，可在 Cells 原 Upload/Task 模型的私有引用中
冻结来源及目标条件，并由 Core canonical arguments 绑定，但实际原生消费者仍须
验证来源与真正的目标原子条件。它不单独证明第一步上传已通过准入/额度或失联
writer 已退休。本批没有把 v1 改为 raw-byte 上传，没有扩展公共 required 或
预建 v2；完整上传仍属于既定交付范围，当前缺口不能用 opaque 包装消除。

### 2026-10-09 原生删除任务的真实 ACK 与列举错误消费

实施后的四步影响结论：

1. 权威是 `07` §5.2 的真实终态/UNKNOWN 边界及 §2.1 的七个必选键，固定
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `scheduler/actions/tree/init.go` 原 `DeleteAction` 注册与
   `scheduler/actions/tree/delete.go::DeleteAction.Run` 是已存在调用者。
   原 `common/nodes/core/handler-exec.go::Executor.DeleteNode` 在原
   `RemoveObject` 返回后产出 `DeleteNodeResponse.Success`；本批直接修消费方，
   没有新建删除 API、平台动作或原生任务。
2. 影响只在原任务读取目标、递归列举及四个 `DeleteNode` 调用点：单文件、
   原递归 worker、flat 根目录及 `childrenOnly` 一级目录。忽略不存在只接受
   原 `common/errors/errors.go` 的 `NodeNotFound/ObjectNotFound`，撤权、
   scope 缺失及超时继续返回原错误；空节点/空流拒绝。`Recv` 只有 `io.EOF`
   可结束完整列举，中途错误在已派发 worker 收口后原样返回，不删父目录。
   多 worker 不再并发写同一个错误变量，首个实际处理错误经单项有界通道归集，
   每个 worker 的原错误仍留日志，在原 `Wait` 后读回，不按节点数留存结果。
   原并发数量和索引会话机制未改；状态通道在 context 取消时退出。
3. 没有改身份、scope、native ACL、平台 PEP、binding generation 或数据权威，
   没有增加重发。无删除 ACK 不写原 `Success=true`，沿原 internal error 返回，
   不把它归为确定冲突。`scheduler/tasks/runnable.go` 原错误消费仍写 native
   `TaskStatus_Error`；这只表达该原任务处理错误，不证明远端未执行，更不能
   映射为平台已核验的 `FAILED/CANCELED`。generic delete 入口仍关闭。
4. 已确认不存在可按原选项忽略；未知/撤权不能忽略。无 ACK、nil 回包、
   非 EOF 流中断、部分原生删除、并发 worker 错误及状态通道取消均不能走本任务的
   成功出口。原多 RPC 删除仍不是预期版本的原子条件删除，没有可安全重放的
   operation-key 终态查询；本批没有将它宣布为完整 `file_storage.delete@v1`，
   也没有改变其发布门禁或批准残缺的 FILE_STORAGE 类别。

实际执行复用 `kailo-cells-native-check-lftow7`：UID `1000:1000`，
4 CPU / 8 GiB，`cpu.max=400000 100000`，`memory.max=8589934592`，
无额外 swap，`/cache/mod` 与 `/cache/build` 是原缓存。第一次执行前实际
MemAvailable 约 31 GiB、memory PSI avg10=0；root 另一受限 full 的 Clippy
在途，本批不是独占宿主。最终窄批 MemAvailable 约 32 GiB、memory PSI
avg10=0，SDK `memory.events` 全部为 0；没有新 SDK、镜像、依赖安装或数据库。
同步只覆盖本工程原 Go 源与 `go.mod/go.sum`，最终 `rsync -anic` checksum
比对只有 mtime/目录元数据差异，没有 Go 文件内容或大小差异。

原目标的实际命令（通过、真实生产变异及还原使用同一个命令）：

```sh
rtk proxy sudo docker exec --user 1000:1000 -w /workspace/file-storage \
  kailo-cells-native-check-lftow7 \
  env PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  GOMODCACHE=/cache/mod GOCACHE=/cache/build GOPROXY=off \
  TMPDIR=/cache/build/cells-delete-task-20261009.7dbx3E \
  CELLS_WORKING_DIR=/tmp/cells-version-task-key-check \
  CELLS_DATA_DIR=/tmp/cells-version-task-key-check \
  go test -mod=readonly ./scheduler/actions/tree -run TestDeleteAction -count=1 -v
```

日志目录为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/cells-delete-task-20261009.7dbx3E`。
所有命令均已终结，结果依真实输入字节区分如下，顶层与子项不相加：

| 日志 / 原句柄 | 实际结果 |
| --- | --- |
| cells-delete-task-positive.log / 25948 | exit 1：新增夹具误用不存在的 `BranchInfo.FlatStorage` 字段，编译失败；已按原 `LoadedSource.DataSource.FlatStorage` 修正，不计生产负向 |
| cells-delete-task-final-positive.log / 75754 | exit 1：漏投递上述 Cells 可写目录环境变量，原初始化拒绝默认 `/.config/pydio/cells`；尚未进入用例 |
| cells-delete-task-configured-positive.log / 44696 | exit 0：4 顶层 / 25 子项 PASS；此版本尚使用每节点错误结果，不作最终字节验收 |
| cells-delete-task-production-negative.log / 43900 | exit 1：移除实际 ACK、NotFound 判定及流错误传播，1 顶层 / 10 子项 FAIL；其余 3 顶层 / 15 子项 PASS |
| cells-delete-task-restored.log / 93741 | exit 0：精确还原该版本，4 顶层 / 25 子项 PASS；之后收口复核发现新增 O(节点数) 错误归集，已删去并改为有界首错通道 |
| cells-delete-task-bounded-positive.log / 79787 | exit 0：最终有界生产版本，4 顶层 / 25 子项 PASS |
| cells-delete-task-bounded-negative.log / 48322 | exit 1：私有候选移除实际 ACK、NotFound、非 EOF 传播并切断实际 worker 错误归集，1 顶层 / 11 子项 FAIL；其余 3 顶层 / 14 子项 PASS |
| cells-delete-task-bounded-restored.log / 56336 | exit 0：`apply_patch` 精确还原后，4 顶层 / 25 子项 PASS；两原源码与正式树 `cmp` 均为 0，`gofmt -l` 无输出 |

负向仅改私有候选的生产 `DeleteAction.Run`，没有改检查断言、正式源码或
真实业务数据；原检查实际抓到了缺 ACK 假成功、撤权/超时/scope 被忽略、
非 EOF 中断和 worker 错误被吞掉，不以编译或环境失败充当负向证据。
并发错误的原返回只要求保留一个真实可解析原因，不承诺 worker 到达顺序；
多错误用例验证返回原因属于实际 native 错误且不走 Success，所有已派发 worker
仍先 `Wait` 收口。错误通道只留一项，不保留按节点增长的错误结果切片。

最终原源码 SHA-256：`delete.go` 为
`ca2aff7f541b122006c94b9e908d03f9406c6421c07a26710d75612dc19cb541`，
`delete_test.go` 为
`8e20885d81fd7b12bfcbe4efe2a0c0142bc0951e59c7f2c758690b95ad77f4e2`。

| 原日志 / 生产变异补丁 | SHA-256 |
| --- | --- |
| cells-delete-task-positive.log | `4704fcb8201a733f43d29aa9b90ee5691707dbb4852e15eabb253899b5ee0b53` |
| cells-delete-task-final-positive.log | `b598c1eca4adfa3771dedb57e2f9c5192bcbdca7344fbde58eb52cd5f9412545` |
| cells-delete-task-configured-positive.log | `33ced2665593c51e8309fd4f3eafd2488ae7a5864ec012022fcc26665cf1161a` |
| cells-delete-task-production-negative.log | `643ff0c320ab11800ffb28429ac25d1cdea59a15a8d0f156904ee6ba815f87f6` |
| cells-delete-task-restored.log | `33ced2665593c51e8309fd4f3eafd2488ae7a5864ec012022fcc26665cf1161a` |
| cells-delete-task-production-mutation.patch | `badd0c588d34edc88c159c235c1f9c43f39445dd48a81f30f274245e10a73147` |
| cells-delete-task-bounded-positive.log | `a7367801c18cb870f80ff699b7b3455a28efb536c1ee2310306f69a1de4316b1` |
| cells-delete-task-bounded-negative.log | `ae494068bd3038e8a7d2202f369698e3b097110ea30d8f3da9f49102170febd8` |
| cells-delete-task-bounded-restored.log | `55ef47871b9272f6d1be0aace9e000d0e5cb85423207c1bb947b139bcd3d810b` |
| cells-delete-task-bounded-production-mutation.patch | `c9fde139066c4d1fb5f2573da6e42ca09b64a50aad013307358cba279e39e1af` |

上述原检查使用原 `Run` 与 native Handler fixture。日志保留原 logger/broker
的 `no driver registered` 诊断，故没有验证真实索引会话消息投递；未执行实 S3、
Mongo/业务库、持久 Task 终态、删除并发 writer fence、浏览器/设备、full 或
artifact 构建/部署。本批源码是必要错误消费修复，不是原样字节保留；原页面、
布局、文案及 UI 功能未改。完整条件删除、失联 writer 退休、首次上传准入与
generic write/delete/share、七必选 catalog/批准 binding 仍未闭合，不声明
完整 FILE_STORAGE 已可用、100% 还原或生产就绪。
