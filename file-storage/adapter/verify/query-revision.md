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
