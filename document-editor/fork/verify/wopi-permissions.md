# ONLYOFFICE 原生 WOPI 接缝

此目录是完整固定原生源码，不是自制编辑器，也不是已部署或已验收保存的声明。

## 四步变更说明

1. 要求：`.design/18` §5.3/5.5/6.3、SS-CEL-WOPI/SS-OFF-WOPI 固定
   Cells + ONLYOFFICE WOPI。DocumentServer 官方页创建原 DocEditor，平台不建立
   普通 Docs API callback 或正文桥。dirty/close 只作 UI evidence，不证明 SAVED。
2. 原生事实：聚合 `f580eb58439432310943ece02c9730c6a21365e7` 及原八个 gitlink
   按 `fork/upstream.yaml` 固定并完整归档。原聚合 `.gitmodules` 还列出插件，但该 commit
   的 `git ls-tree -r` 只有八个 gitlink；没有额外下载或激活宏、AI、插件。
   `web-apps` 的 `apps/api/wopi/editor-wopi.ejs` 在 launch 创建 permissions；
   `server` 的 `DocService/sources/DocsCoServer.js::fillDataFromWopiJwt` 在 WOPI
   JWT 恢复时重新覆盖 permissions。后者是实际消费符号，不把邻接的 authRestore
   名称误当权限对象所在函数。
3. 实现与影响：两处原 permissions 对象都消费 DisableCopy，并保留原 CopyPasteRestrictions；
   DisableExport 或 HideExportOption 使 download=false，print/chat 原逻辑不变。
   Cells FileInfo 从每次受认证 Core PEP 取得固定 PUBLIC_ORIGIN，设置
   PostMessageOrigin、EditNotificationPostMessage、ClosePostMessage。
   原 DefaultJWTVerifier、PAT 节点范围、native HUMAN 映射、fresh read/update、
   exact VersionId 和原 Cells GetObject/PutObject 仍是执行消费者。
4. 兼容与验证：PEP machine response 仅新增可选 postMessageOrigin；新 Cells consumer
   缺失/非 origin 值即拒绝，不回退 wildcard。因此 Core/schema/Cells 必须作为同一
   component source release 验证后投递，旧 Core 不支持此字段时该编辑 binding 不能启用。
   普通原生 Cells WOPI FileInfo 不带新 optional flags，原独立行为不变。验证回执见下节。

## 构建、运行与业务边界

完整原生导入为 59,884 个上游文件；Kailo 对 DocumentServer 原生源码的改动只有上述
两处权限镜像。聚合与三个已初始化子仓只做只读 git archive；五个缺少的 gitlink 从
官方固定 commit 取到 Data 独立对象缓存后 archive，原句柄 16745/69123 均实际 exit 0。
没有执行 `.references` 中的任何程序，没有复制 Git 元数据。

原聚合 Readme 的构建入口指向官方 build_tools 与 Docker-DocumentServer，当前固定
聚合树自身没有原生 Dockerfile。此批没有注册一个不存在的构建配方，没有借原版发布
镜像冒充二开产物，`artifacts: []` 准确表示尚未构建。后续实际源码产物仍需原配方固定
与登记，不能把本次 Node 映射检查当 DocumentServer 整体构建。

真实启用前还须按 `.design/18` §10 投递并核验 WOPI enable、确切 Cells host 的
ipfilter.rules，以及 useforrequest、externalRequest.directIfIn.jwtToken、
externalRequest.action.blockPrivateIP、request-filtering-agent.allowPrivateIPAddress
组合进入 binding config digest；不能使用默认通配 allow-all。Cells/DocumentServer
实例、独立数据库/凭据、完整来源产物、注册/批准/绑定以及浏览器实际保存与原生版本回读
没有在本批执行。Desktop editor GAP 仍关闭，Mobile 不承载。

## 实现后验证

执行原 adapter `node --test test/*.test.mjs` 与原 native Go 窄入口；测试使用隔离
HTTP/原生 RPC fixture，不使用业务身份或正文。DocumentServer 测试执行原生产源码的
两个 permissions 对象，证明字段映射，不宣称跑过完整 authRestore 或实时 DocumentServer。
Node 原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-onlyoffice-check.bCmhrJ/`。

| 原件 | 实际结果 | SHA-256 |
|---|---|---|
| adapter-onlyoffice-first.log | 65 passed / exit 0 | `bb17bb60c0871f82a09360b3c4b747159a99d4aa1a1061abd79a853c9e0bc0b6` |
| onlyoffice-permission-mutant.log | 两个原权限对象断言失败 / exit 1 | `6a43038727ac55a7de39c25d096f222080ed2522e55e26d14a3c9e9c29b93819` |
| adapter-onlyoffice-restored.log | 65 passed / exit 0 | `1e4ea8d803a9ae4a950d194b28000217ac0c21e5c3e96a2e9998ab800a6e7675` |

原生页撤掉 DisableCopy 消费、服务端 download 改 true，原断言分别失败；apply_patch
恢复后与独立候选两生产文件 cmp 均 0。fixture 还从真实 HTTP execute 入口核对原
ONLYOFFICE XML discovery、一次 native PAT 创建、固定 theme/locale/chat、标准 form
POST、无 token URL，以及错误 editor origin/未确认 native PAT reference 拒绝。

首次原 SDK 离线依赖安装实际 exit 1（ENOTCACHED），原网络尝试 exit 1（EAI_AGAIN）；
两原件保留。改用同一固定 10ad51 镜像的 4 CPU/8 GiB/no extra swap、UID1000
受限 bridge 验证容器后，xml2js 0.6.2 原依赖安装 exit 0；真实 package-lock 保存三项
解析结果与 integrity，未升级其他工程锁。测试使用 Data 缓存，没有产品镜像构建。

同一独立候选使用原 tools/gen.sh 实际四侧生成 exit 0；Rust/Go/TS/Dart 都保留
postMessageOrigin 可选字段。首次 TMPDIR 不存在 exit 1 原件保留；仅修 runner 目录
后恢复执行，没有改生成脚本或 schema 含义。四生成物不用于覆盖冻结联合批；主控后续
按真实并集 schema 集中生成。日志 `onlyoffice-gen-recovery.log` SHA-256 为
`52b398e382b2959e01fb16033b4e4b80dde009698f1f262ed6881c8f1db4f1f2`。
原 native Go 窄目标使用固定 Go 1.26.8 镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
4 CPU/8 GiB/no extra swap、UID1000、GOPROXY=off、-mod=readonly；没有更新 go.mod/go.sum。
原句柄 23411 实际 exit 1：native 初始化目录 `-/.config/pydio/cells` 不可写，未进入断言。
按原 `runtime.ApplicationWorkingDir` 消费 CELLS_WORKING_DIR 到 Data 缓存后，恢复句柄
63897 实际 exit 1：原 TestFileInfo 固定 +01:00 期望与 runner UTC 不一致；新增 origin
测试已通过。仅 runner 设置 TZ=Europe/Paris 后，同一原窄命令句柄 91161 实际 exit 0，
common/auth/protocol 和 gateway/wopi 两包均通过，生产源码未因环境问题修改。

三个 Go 原件均在 `/volumes/data/kailo/tmp/codex-cells-protocol-session-20261005.rFQ2Hl/`：

| 原件 | 实际结果 | SHA-256 |
|---|---|---|
| onlyoffice-native-first.log | 原生工作目录初始化失败 / exit 1 | `730d024d37439fb46da1ed49688d2464952f58e31f9721eac5e80df811f92d26` |
| onlyoffice-native-recovery.log | 原 fixture 时区不匹配 / exit 1 | `54096ab7d45d99b7d645838438c7765183d9975852fe7942e7c8ae8541de6467` |
| onlyoffice-native-restored.log | 两包窄目标通过 / exit 0 | `00f8ddcb0305ae8e5dbff98a4f12581d8a3162d1fef61930284ee1cea8aef7f2` |

本增量没有执行 Core 编译、四侧往返、产品构建或真实编辑保存验收。原 UI dirty/close
与权限字段检查不能替代 native result_revision、GetObject(VersionId) 或 Node/Version
持久化回读；这些仍须完整实际实例及已准入 Session 验证。

## 完整源码的原生基准核对

原来源工具把聚合 commit 的八个 gitlink 与展开后的源码直接比较，会把 59,884 个
原样上游文件误算成 Kailo 新增。现由原 `upstream_manifest.py` 消费上述
`source_components`：精确核对固定聚合的全部 pin、同树 `.gitmodules` URL 和
子树对象，只在 Data 缓存组合比较树。原 manifest 的真实基准 commit 不变；
diff、added-lines、删除检查、status、sync 与既有 seam 核对共用该原生树。
声明缺失时旧记录行为不变；错 pin、缺 URL 或未展开嵌套 gitlink 明确拒绝。
不修改只读上游、不豁免真正改写行、不创建另一份来源注册表。

实现后在原固定 10ad51 SDK（4 CPU、8 GiB、UID 1000）实际运行 12 个 Git
夹具，恢复后全部通过，涵盖原样二进制、真实新增/删除、pin/URL/路径拒绝、
无字段兼容、目标 pin 更新和三方合并冲突。实际八子树展开为
`97c5b5117a7e1cc1d160bb57c659f76337426ced`，59,884 文件且无残留 gitlink；
与本批原生源码树 `44749a6ade8dbe1de62dcb3fa0aae09ab8543c95` 比较只有前述
两个文件 +4/-2，非 59,884 个自写文件。原检查脚本语法与 Python 编译检查通过。

移除生产 pin 精确比较守卫后，真实错误 pin 用例实际失败（exit 1）；恢复生产
字节并 cmp 0 后，两项真实来源断言重新通过（exit 0）。最初夹具缺 worktree
和第一次原生断言误写路径的失败原件保留，未通过弱化产品规则使之通过。
原件目录为 `codex-web-protocol-surface-20261005.Sv3Qhy/apps/upstream-components.wxABJP/`：

- `restored.log`：`ccf844c162e552eabe6f204b51c7338797f079826e5207620540169e6f524bea`。
- `guard-mutant.log`：`80bead635b1aa8f91074a57c6484a8d60a5d4e19483e944d5e7e799abd1939a3`。
- `onlyoffice-restored.log`：`9fc92878d2a21e79dfbc0850691c7e7714c0be0b7ce481f2ddd6b8a683e3bb77`。

合入联合候选时三个来源工具/说明文件 SHA-256 与冻结交付逐个一致，范围内
diff --check 退出 0。这是源码来源证据，不是供应链全批通过、编辑器镜像构建或
真实编辑保存验收；未为本增量重跑产品编译或 GitNexus。
