# Cells 原生 revision 查询接缝

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
