# Kailo CI/CD 部署测试手册

读者：开发机上的 Claude Code，以及 CI/CD 节点 的 CI/CD 运维执行者。
核对日期：2026-10-14 UTC。本手册是操作交接，不另立产品规格。

## WG SSH 登录（用户最新授权，2026-10-14）

用户已允许开发机免密码 SSH 登录 CI 的 `ubuntu` 账号，取代此前禁止 SSH 的约定。
用户已澄清当前 CC 在开发机以 `root` 运行，直接在 root 会话执行：

```bash
ssh ubuntu@10.203.193.2
# 等价别名
ssh kailo-ci-ssh
```

无需切换到 kailo-dev。专用身份为 `/root/.ssh/id_ed25519_kailo_ci`，与 GitHub key 分开；私钥只在开发机。
主机公钥已从 CI 本机可信来源固定到 `~/.ssh/known_hosts_kailo_ci`，严格校验开启。
CI 的该条公钥授权仅接受来源 `10.203.193.1`，未新增公网监听或修改密码登录策略。
对端 root 的 BatchMode 实测返回 `ubuntu`，SSH_CONNECTION 为 WG 到 WG 的 22 端口连接，退出 0。

原 `kailo-ci` / Remote Docker 仍可用；SSH 登录不改变 GitHub 固定提交取源、
资源限额和发布门禁，不把开发机工作树直接同步成发布输入。本次未额外授予 sudo 权限。

## 开发端待办与 CI 回执（固定交接入口）

在开发机运行 `rtk proxy kailo-ci handoff`，直接获取 CI 维护的结构化待办：
负责人、状态、证据任务、下一步和完成条件。不需要用户转述，也不用把文档中的历史状态
当作实时状态。任务完整结果仍通过 `status` / `logs` 读取。

### 依赖下载出口（2026-10-14 已启用）

开发端命令不变：正常 push GitHub，再用 `kailo-ci` 提交、查询；无需改 CC 配置、
上传源码或在开发机编译。CI 新建 BuildKit 构建与检查容器由专属 Docker 客户端配置
自动投递 HTTP(S) 下载代理。编译和运行仍在 CI，镜像层拉取不在此下载探针的验收范围内。

下载服务在开发机的 `10.203.193.1:3128`，只监听 WG，防火墙和 tinyproxy ACL
均仅允许 `10.203.193.2`；CONNECT 仅允许 443，原 TLS 校验保持开启。
服务 `kailo-dependency-proxy` 限额 0.5 CPU / 128 MiB，实测常驻约 1.3 MiB，
不开公网监听、不采集请求正文、不改 Claude Code 配置或其他既有代理服务。
依赖此出口的新下载在服务不可用时会报错；先查服务与 WG，不靠重排同一任务掩盖问题。

CI 配置为 `/volumes/data/kailo/ci/docker/config.json` 的 `proxies.default`。
Maven 不依赖 HTTP_PROXY 的隐式支持：原 `kailo-wren-engine-maven` 缓存内已配置
`/root/.m2/settings.xml`。运维配置原件在 `ci/dependency-download/`；清空该缓存后须用
既有受限 builder 重跑 `configure` 阶段，传入新的非密 `--build-arg CACHE_REFRESH=<本次维护标识>`，
确保重新写入。不要用 `--no-cache-filter` 重新配置共享缓存：本轮实测会重置该缓存内容。
`verify` 阶段另通过 `--build-context wren=<固定 GitHub 快照的 Wren core-legacy 目录>`
读取原 mvnw 与 .mvn，使用原版本重验 Maven 解析。发现不同的既有 settings 时拒绝覆盖。
这是标准 Maven 缓存配置，不改固定提交的 Dockerfile、锁文件、来源摘要或依赖版本。

本轮实际结果：Rust 元数据 848342 字节 2.74 秒（此前直连 12 秒超时且不完整）；
PyPI 索引 7990737 字节 4.27 秒；原 Maven 3.9.8 解析此前失败的
`aopalliance:aopalliance:1.0` 为 BUILD SUCCESS，Maven 报告 10.724 秒。
构建日志 `/volumes/data/kailo/ci/tmp/dependency-proxy-maven-20261014.log`，退出码 0。
随后反证重置了可再生成的 Maven 缓存；配置已恢复，并从固定源码的原 mvnw 重新下载
Maven 与解析插件，冷缓存复验 BUILD SUCCESS（Maven 报告 1 分 34 秒，整体步骤 106.4 秒），
日志 `dependency-proxy-maven-restored-20261014.log`，退出码 0。源码、业务数据未改动。
代理投递反证 `dependency-proxy-negative-20261014.log` 退出 1，恢复后退出 0；
原工程 `check-docs.sh` 任务 `e4f98a64` 约 23 秒成功，该任务不校验外层运维手册正文。
非 CI 来源、非 443 CONNECT 的拒绝探针均返回 403。完整组件构建仍查 handoff 的任务 ID，
不把下载修复当作发布完成；已进入编译的旧任务不为切换代理中断。

2026-10-14 后续修复：`edde81005c101248f1b779a419722308744bb2cd` 的
lint `d3fff592` 与 verify `a44bcef4` 均已成功；CI 修复跨提交产物引用后，
原 `tools/check.sh trace`、`supply` 也实际 exit 0，工作树仍干净。
8 份既有 Core/Worker 证明存入持久库，支持 `/dist` 忽略规则的提交自动建立
`apps/dist` 链接；旧提交使用真实目录，不修改其冻结源码。检查容器只读消费，
仍校验真实 digest、SBOM、provenance、源码 commit 与依赖锁，缺失或冲突继续拒绝。
运维回归含跨提交读取、缺失链接反证、同名冲突拒绝，exit 0；新 worker 的 fetch
`8f54877d` 已实际成功。无需开发端逐提交复制 dist。

Web 两次顶层 digest 的差异已由 Registry 读回确认：`fd542d59…` 与 `19d8aa47…`
指向同一个 Linux amd64 manifest
`sha256:bd1ef12d32368ada7c0f987a5c10ee73a11c4eb07c9bfe4336157e911414ce9f`，
变化的是 attestation manifest；不改源码摘要、不关闭证明生成，继续登记实际顶层 digest。
依赖失败重试与 Desktop/知识库终态以 `handoff` 的 CI-DEPENDENCY-RETRIES 为准；
重试不代表成功。目标级门禁开发端报告已写入但未提交，现行 CI 仍使用 full 准入。

2026-10-14 本轮已启用两条独立通道，每条最多一个任务：

- `feedback`：fetch、docs、check、check-step、gen。
- `release`：build、deploy；部署保持串行。

原客户端命令不变。准备 GitHub 快照时短暂互斥；长构建不持有反馈通道锁。
两条通道的恢复、取消与清理只处理各自任务，不把另一条通道的 RUNNING 当作中断。
任务启动检查可用内存；不足时仍是 QUEUED，status 返回 waiting_for、所需与可用内存，
可正常 cancel。检查 SDK 保持 2 CPU / 16 GiB，文档快路径为 2 CPU / 2 GiB，
临时 PostgreSQL 1 CPU / 2 GiB；共享 Builder 保持原 8 CPU / 16 GiB 限额。
这不是不受限并发，也不保证其他项目突增用量时不受影响。

已从开发机实际经 WG 提交并读回：固定提交
`0b9c35874db9282934106cccd58ada1f41ed6614` 的 docs `cba59abf` 22 秒通过，
lint `8ac86dff` 66 秒通过，exit 均为 0；两者执行期间旧知识库构建仍在运行。
lint 包括 fmt、clippy、gofmt、go vet、TypeScript typecheck、Dart analyze，
临时数据库清理已回读；这是缓存条件下的实测，不保证每个新提交都用时相同，
也不证明开发机未提交改动通过。开发机没有因此安装宿主 SDK。

`check-step verify` 会先在该任务临时 PostgreSQL 上执行原 `tools/check.sh migrate`，
再执行原 verify；这是原验证入口要求的数据库前提，不访问线上业务库。
2026-10-14 此路径实际验证任务 `cac6c6bb748444a8aea12c9489cec8c9` 已
SUCCEEDED / exit 0，用时 245 秒，四语言原验证入口通过，临时库与网络清理已回读。
Rust 有 55 项显式 ignored，不作为通过的业务场景，也不外推为 full 门禁或发布验收。
初始化失败时不继续测试，退出后清理临时库。

Desktop 旧排队任务 `1676d582` 已取消并保留历史，替代任务为
`ae84223252ab44e18c452e068d09b25f`。这样旧 worker 完成知识库后退出，
不再用旧逻辑领取 Desktop；下一进程采用独立 build 副本。没有重启正在构建的知识库。
构建隔离的真实发布产物验收仍看新任务终态。

目标级发布门禁尚未交付，`handoff` 中 DEV-RELEASE-SCOPE 给出原入口与责任边界。
release.sh 诊断、PEM 误报修复及本批追溯回填已由开发端提交为 edde8100，CI 未代改业务源码。

实施顺序是实现后定向正反验证，稳定批次集中 full；每个任务只交一个已有用户操作结果，
不因格式化、准确的失败诊断或真实来源记录回填重复请求批准。涉及授权放宽、
审计丢弃、扫描关闭、门禁降低的变更仍必须说明依据，不能借提效取消这些边界。
被权限或外部任务阻断时一次写明决策点与任务 ID，等待原任务，不在停止钩子催促下重复提交。

### 构建隔离与日志变更

新 worker 的 build 在任务临时目录创建独立 Git 副本，输入仅来自已认证的固定 commit，
origin 保持 GitHub；设计与 references 仍读取固定证据。不会继承旧 build 写回的来源记录、
未跟踪文件或 dist 软链接，不通过 reset/clean 删除旧快照中的修改。
构建结束（包括失败）在日志输出 `BUILD WORKTREE STATUS` 和 `GENERATED METADATA DIFF`，
状态也返回对应字段。只输出路径及原生 fork/upstream.yaml 的来源记录 diff，不公开任意文件正文。
输出保存在任务独立 artifacts_path；失败产物不算成功，清理临时源码不删除这些输出。
成功 Core/Worker 的 digest 命名证明进入持久库，后续提交快照自动接入原 dist 消费路径；
同名内容冲突直接拒绝，不覆盖旧证明。失败构建的部分产物仅留在任务目录，不进入共享库。
其他来源记录仍由开发端提交回 GitHub，不自动改仓库。

此次验证包含真实 Git 脏输入隔离、反证、失败日志和输出留存，以及双通道锁隔离、
低内存排队取消、临时 PostgreSQL、终态清理的原回归；没有降低 full 发布门禁。
反馈通道已真实运行；构建隔离在后续 release worker 进程生效。

## 当前批次：0b9c3587 构建补齐

固定源码 `0b9c35874db9282934106cccd58ada1f41ed6614`。原 build `1958d253`
失败时，CI 源码目录的 `git status --porcelain --untracked-files=all` 完整输出为
`?? dist`。原因是 CI 创建了 `dist` 软链接，仓库的 `dist/` 忽略规则不匹配它。
CI 已改用真实目录；只移除了这个指向空产物目录的链接，没有删除源码或构建产物。
修复后工作树状态为空。未绕过 release.sh 干净树检查。

Core/Worker 重试 `169fdd87` 已 SUCCEEDED / exit 0，Registry 独立 HEAD 均返回
200 且 Docker-Content-Digest 一致：

- Core：`sha256:3ac9fc068ad9cdc8574323f1778dc6298875169b28857cd1c1516aa17e5b6b81`
- Worker：`sha256:96f8bf28454f7bebfc6321b9862bef833f08009e5d887981b367b803092af4a4`

两份新产物的 SPDX/provenance 已生成，源码均为本节固定提交；未更新运行容器。
原追溯记录引用的旧 Core `29ea050c…` / Worker `02e7f095…` 四份文件也已从
既有发布原件 `task-batch-release.zThtjJ/platform-apps/dist/` 原样恢复到本 CI 快照；
四份 SHA256 均与原件一致，未重命名、未重新编造证明。
原 `tools/check.sh trace` 在受限 SDK 重跑退出 1：Core/Worker 缺产物报错已消失，
仍报 Web 追溯摘要不一致。实际检查日志为 `tmp.ccDfyluxna.check.log`。

以下均是已提交的真实任务，不代表已成功；直接用 `kailo-ci status <ID>` 和
`kailo-ci logs <ID> --tail 100` 查看终态，勿重复排队：

| 产物 | 任务 ID |
|---|---|
| core-worker | 169fdd8759554253afd1b3aa1afbc783 |
| collaboration-relay | 66cc962746324334a9ebb4a786be0afc |
| data-query-ai-service | 77cec0c26e3f447e8337037bf6f01fbf |
| data-query-engine | fdf803b7ac0d48e0b59825edb1fbc881 |
| knowledge-adapter | aca0a09ac447430db3d1f55125889ffa |
| model-gateway | 404f3ab50e7c4aafafe4e75979c50e60 |
| web-client | b3fbf75689f64ae7a8a572aa3ca54b01 |
| knowledge-service | f2f5f0b12c724c68b5034e8b382f6fe9 |
| desktop-client | 1676d582d29541ff9aa74c472f012be0 |

上述构建目标均可通过原 `kailo-ci submit "$COMMIT" build <产物>` 调用；
worker 只接受登记目标，沿固定提交中的原构建入口执行。Desktop 仍是原登记的
Windows 未签名测试包，不是签名或设备验收。知识库保留原完整构建与默认解析引擎；
版本取固定源码 VERSION，commit 与构建时间按任务投递，不使用宿主 Go 工具链。

原 full `f1e11f8e` 的失败不止缺产物。开发端还需处理：

- 第 6 步：`tools/traceability/*.yaml` 中的发布摘要必须与实际产物相符。
  构建成功后读取 `generated_metadata_diff` 和 `artifacts_path`，再在开发机提交真实来源记录；
  不改摘要冒充已构建，也不把新产物重命名成旧摘要。
- 第 7 步：`core/crates/platform-core/src/action_token.rs:187、196` 的 PEM 生成/解析
  格式字符串触发内置扫描。这两处不是私钥内容；开发端按实际扫描规则修正误报并保留
  真正私钥负例。CI 不跳过 supply，不要求轮换凭据。
- 第 8 步：上表中除 Core/Worker 与 Web 外的 7 个来源摘要过期，正在按原入口补构建。

先完成构建与来源记录提交，再对最终提交集中 full；全量通过前不触发业务部署。
本节是运维回执，不宣称业务验收或生产就绪。

## 当前交接：队列恢复与设计分支推送

2026-10-14：CI 和运行数据的 NVMe 切换已完成，执行队列已恢复。原 gen 任务
`7f3c673ba79542479d664f0d34292ab7` 已 SUCCEEDED / exit 0，源码提交
`41c4b0004202e337aeeebbd303c4ac5116325a59`。无需重复提交，可以沿原 `artifact` 命令取回生成包。
生成包 419082 字节，6 个文件、4 个变更，SHA256
`0cbdd2323002614e7d5e1db1e79e04f27fcf50a3c332fe05487702ba8ed7320a`。
后续任务继续使用 `kailo-ci status` / `wait` / `logs` 查询，不把本任务成功外推到其他检查。

Docker、containerd、CI 临时目录、语言/编译缓存、BuildKit 卷均已读回为 NVMe；
Registry 仍在 SATA。缓存切换前 rsync 元数据比对无差异，隔离队列验证退出 0，包含
挂载设备拒绝反证、取消、临时 PostgreSQL 正反访问及四种退出清理。
Cells、Wren、Agent runtime、知识库原生启动文件和既有验收运行库也已逐项停写、
复制并经 rsync checksum 比对后切换到 `/var/lib/kailo-runtime-nvme`。
恢复保持原镜像摘要；Core 沿固定旧版本启动入口重新投递 wrapping，Wren 只重发既有角色的
一次性引导凭据，原 KV、策略和 binding 未改。容器进程 mountinfo 回读：仅 Registry 使用 SATA。
业务切换前副本保留在 NVMe 的 `rollback/` 下；迁移不是新业务功能发布。
本轮旧 SATA 迁移副本清理已全部退出 0，未保留后台清理任务；没有删除当前数据或共享镜像。
收口回读 SATA 可用约 965 GiB、NVMe 可用约 233 GiB，实时容量仍以每次任务启动检查为准。

开发机经 WG 实测：Web `http://10.203.193.2:58090/` 返回 302；Cells
`http://10.203.193.2:58092/`、知识库 `http://10.203.193.2:58094/` 返回 200。
知识库额外 WG 端口映射由 CI 节点 `ci/knowledge-wg.compose.yaml` 和 `ci/knowledge-wg.env`
维护，后续重建该前端须与原 Compose 一起使用，保留原入口、镜像与认证配置。
Wren 原运行实例无独立 WG 发布端口，原页面未认证访问返回 401；未擅自上架组件或放宽授权。
网络/重启验收不等于正常 SSO 业务验收，后者仍由开发端按对应能力范围执行。

开发机外层旧 `.git/hooks/pre-push` 会误调用 apps 全量检查，已移出生效位置，备份为
`.git/hooks/pre-push.retired-20261014`；没有关闭 apps 仓库钩子，也没有使用 `--no-verify`。
设计分支 `design-authority-pending` 已普通推送到 GitHub 同名分支，`git ls-remote` 读回
`43e058b06c4ffa9629a213f5ccdad567a96a2391`。没有更新 main，没有重写设计工作区或 index。

## 直接调用入口：在开发机执行

无需把发布请求转告人或等待聊天中的 Agent。开发机已安装 `/usr/local/bin/kailo-ci`；
root 调用时自动切换 `kailo-dev`，再通过原 `kailo-ci` Docker context 提交任务。
以下 `COMMIT` 必须是已推送 GitHub 的完整提交，不是未提交工作区或任意示例值。

```bash
COMMIT=$(git -C /volumes/kailo/apps rev-parse HEAD)
rtk proxy git -C /volumes/kailo/apps ls-remote origin refs/heads/main
# 先核对上面的远端 main 就是本批 COMMIT，再提交。
rtk proxy kailo-ci submit "$COMMIT" fetch
```

命令打印 32 位任务 ID。此时仅表示入队，不表示成功；复制实际返回的 ID 查询：

```bash
rtk proxy kailo-ci status "$JOB"
rtk proxy kailo-ci logs "$JOB" --tail 100
rtk proxy kailo-ci wait "$JOB" --timeout 60
```

`JOB` 取前一步真实输出。`status` 的 `state=SUCCEEDED` 且 `exit_code=0` 才是该阶段通过。
`QUEUED/RUNNING/DEPLOYING` 均未完成；`FAILED` 读失败日志后修复；`CANCELLED` 表示未通过且已停止；`UNKNOWN` 先查运行现场，
不能自动重新部署。`status` 命令自身退出 0 只代表读到了状态，不代表任务成功。
执行中日志持续公开已脱敏的完整输出行；原始日志保留在 CI/CD 节点受控目录。
`wait` 退出 0 才是成功，失败/取消/结果不明退出 1；等待到期退出 124，仅结束等待，不取消任务。
任务 ID 可以用唯一的至少 8 位前缀；歧义或不存在时拒绝。

### 队列维护：直接执行，不需要找运维代取消

```bash
rtk proxy kailo-ci list                 # 活动任务及需要核查的 UNKNOWN
rtk proxy kailo-ci list --all           # 全部历史，包括已归档任务
rtk proxy kailo-ci cancel "$JOB"        # 指定任务取消；可重复调用
rtk proxy kailo-ci status "$JOB"        # 取消请求不等于已停止，读回终态
rtk proxy kailo-ci retry "$JOB"         # FAILED/CANCELLED 非部署任务；返回新 ID，保留旧回执
rtk proxy kailo-ci clean                # 预览可归档的已结束记录
rtk proxy kailo-ci clean --apply        # 归档；保留状态、日志和发布产物
```

同一 commit/stage/targets 的活动任务重复 submit 返回原 ID，不重复排队。
新 commit 不会自动取消旧 commit；确认旧检查已被新提交覆盖后，显式 cancel 旧任务。
retry 拒绝 UNKNOWN 和部署任务；先核查外部状态，不盲目重复执行。
排队取消会立即移出 pending；运行取消由 worker 终止该命令的进程组，并清理仅属于本任务的临时检查容器。
强制终止或清理失败记 UNKNOWN。进入 DEPLOYING 后拒绝 cancel，等待部署回读或运维对账，避免误报“已取消即未部署”。
正常终态后释放任务专属临时工作目录；共享缓存、镜像、固定源码、业务数据与发布产物不由 clean 删除。
默认 list 不显示已结束的普通历史，UNKNOWN 始终保留到核查。status/logs 仍可查询归档 ID。

2026-10-13 队列纠偏：旧 docs `bbf8fc35` 的 BuildKit 记录已确认 Canceled；冗余 fetch `82c0898c` 已取消。
已核对 `651953d6` 是 `86c00f96` 的祖先，旧全量检查 `989daf5c` 已取消，保留关键检查 `1fb7d26c`。
这里不是全量检查通过记录，最新状态用 status 回读。
`1fb7d26c` 随后在取码阶段因浅克隆缺少新对象失败，未开始检查；取码已补为从 GitHub 显式 fetch 经验证的固定 commit。
保留原失败，重试任务为 `3a6a7d43975b488cacafb75cc80e6100`，查询这个新 ID 获取本批结果。

已登记阶段：

| 调用 | CI/CD 节点执行内容 | 成功不代表什么 |
|---|---|---|
| `kailo-ci submit "$COMMIT" fetch` | GitHub fetch、校验 main 可达提交、准备独立固定源码与设计树 | 不代表构建或部署 |
| `kailo-ci submit "$COMMIT" docs` | 原 `tools/check-docs.sh`，实际进入受限 SDK | 不代表 full 或业务验收 |
| `kailo-ci submit "$COMMIT" check` | 原 `tools/check.sh --full`，保存该树的检查回执 | SKIP 不变成通过 |
| `kailo-ci check-step "$COMMIT" lint` | 原 `tools/check.sh lint`，编译/格式/静态检查 | 不产生全量发布回执 |
| `kailo-ci check-step "$COMMIT" verify` | 原 `tools/check.sh verify`，Rust/Go/TypeScript/Dart 原测试 | 不替代迁移、兼容与其余门禁 |
| `kailo-ci gen "$COMMIT"` | 独立 GitHub 提交副本内运行原 `tools/gen.sh`、再运行 `--check`；返回生成文件和补丁 | 不提交、不 push、不证明四侧 round-trip 或 full 通过 |
| `kailo-ci submit "$COMMIT" build web-client` | 原 Web 构建，返回生成元数据 diff | 不自动提交生成记录或更新容器 |
| `kailo-ci submit "$COMMIT" build core-worker` | 原 `tools/release.sh` 构建 Core/Worker | 不自动执行迁移或替换服务 |
| `kailo-ci submit "$COMMIT" deploy buzz-web` | 要求同一树 full 通过、Git 干净、镜像固定 digest，再只更新 Web | 不代表 SSO 或业务验收 |

### 开发反馈与契约生成回传

开发过程中选用 lint 或 verify，稳定批次再 full。两个快捷命令也可写成
`kailo-ci submit "$COMMIT" check-step lint` / `verify`；gen 也可写成
`kailo-ci submit "$COMMIT" gen`。仍用同一串行队列、取消、去重、状态和日志，不绕过资源限额。
它们复用按本提交 Dockerfile 配方识别的 SDK、CI 节点原语言与编译缓存。首次构建 SDK、依赖变化、
缓存未命中或前面已有长任务时仍可能较慢；没有承诺固定“几分钟”，分阶段只减少无关检查。
lint/verify 仍执行原检查脚本的依赖准备；不伪装所有端设备验收。

`check`、`check-step lint`、`check-step verify` 由 CI 自动启动独立临时 PostgreSQL。
每次从线上 Core 数据库容器读取正在运行的不可变镜像 ID，只复用镜像，不读取其业务数据或凭据；
当前基线为 PostgreSQL 16.15。任务库使用随机密码、独立 Docker 网络、不发布宿主端口，
就绪后通过原检查入口的环境投递把 `DATABASE_URL` 传入 SDK。开发机不需要配置数据库地址。
数据库限制为 1 CPU/2 GiB，数据使用最大 1 GiB 的 tmpfs；结束即销毁，不生成持久数据卷。
成功、失败和取消均清理任务容器、数据及网络；worker 异常重启先清理中断任务残留，
原任务保持 UNKNOWN，不自动重放。`status` 的 `postgres` 字段提供镜像 ID、版本和
`cleaned_up` 回读；清理失败不会报成功。`docs`、`gen`、构建和部署不启动这个测试库。
临时库初始为空，迁移和测试仍由 GitHub 提交中的原检查脚本负责；full 的迁移步骤保留，
单独 verify 的测试需自行准备所需 schema，不能把仅配置了 DATABASE_URL 当作迁移或测试通过。

本次运维验证：`ci/verify_queue.py` 使用真实 PostgreSQL 和 SDK 容器完成 SQL 写入/读回、
错误密码拒绝、成功/失败/取消/重启清理，退出 0；临时禁用清理的反向验证确实报错。
这是 CI 临时数据库生命周期验收，不是项目 full 或业务验收通过。

生成时先 push 契约及其消费输入到 GitHub，COMMIT 指向该提交，随后在开发机执行：

```bash
JOB=$(kailo-ci gen "$COMMIT")
kailo-ci wait "$JOB" --timeout 60
# 124 仅表示仍在执行，继续查询原 JOB；非 SUCCEEDED 不下载、应用产物。
kailo-ci status "$JOB"
kailo-ci artifact "$JOB" > generated.tar.gz
sha256sum generated.tar.gz
# 与 status.artifact.sha256 核对一致后，解压到新的空目录：
GEN_DIR=$(mktemp -d)
tar -xzf generated.tar.gz -C "$GEN_DIR"
jq '{commit,job,image_id,changed,validation}' "$GEN_DIR/manifest.json"
```

下载经原 WG Docker exec 二进制输出，不增加 HTTP 服务、SSH 调用或宿主目录访问。
CLI 在输出前再次校验包的 SHA-256；非成功 gen、缺包、摘要不符均拒绝。
包内 `files/` 包含原生成器报告的四语言契约和同源 Mobile 文案文件（即使某文件未变化），
`changes.patch` 包含相对提交的实际差异，`manifest.json` 记录输入 commit、SDK image ID、
生成脚本摘要、各文件摘要与变更列表。原生生成器和 --check 任一步失败都不发布成功产物。

核对 manifest.commit 等于 COMMIT，并在工程根复核后应用补丁：

```bash
test "$(git -C /volumes/kailo/apps rev-parse HEAD)" = "$COMMIT"
# changed 为空表示该提交已同步，不必应用空补丁。
if [ "$(jq '.changed | length' "$GEN_DIR/manifest.json")" -gt 0 ]; then
  git -C /volumes/kailo/apps apply --check "$GEN_DIR/changes.patch"
  git -C /volumes/kailo/apps apply "$GEN_DIR/changes.patch"
fi
git -C /volumes/kailo/apps diff --stat
```

遇到应用冲突保留本地修改，回到对应 commit 核对；不强行覆盖。开发端负责复核、提交并 push
生成物，再对新 commit 调用 verify/full。CI 不改业务源码权威，也不为 gen 创建 full 通过回执。

Web 操作顺序：提交源码 → 需要时调用 build → 开发机核对返回的来源元数据并提交、push
来源记录和部署 pin → 对新 commit 调用 check → 通过后调用 deploy。每一步都等待本任务终态，
不要一次排入下一批。测试由开发端安排与判断；服务通过 WG 可达不代表已完成业务验收。

Core/Worker 自动部署、其他组件和数据库迁移尚未登记，CLI 会明确拒绝，不会创建假成功任务。
它们仍按下文原运维入口处理；本次接通的是可直接触发的 CI 任务及受门禁约束的 Web 部署入口，
不是所有产品的一键发布。2026-10-13 后续清理后 Data 可用约 939 GiB，已高于 32 GiB 重型任务启动门槛；每次任务仍以实时空间检查为准。这不代表 check/build 或发布已经通过。

## 1. 两机分工与当前可用边界

| 位置 | 职责 | 源码来源 |
|---|---|---|
| 开发机 `/volumes/kailo/apps`，账号 `kailo-dev` | 阅读设计与 references、业务实现、复核、Git 提交和 push | GitHub 与已交接的未提交工作 |
| CI/CD 节点 `/volumes/kailo` | CI/CD 工作区：拉取、受限构建、发布、运行、测试、回滚、留存证据 | 只从 GitHub 拉取指定提交 |

CI/CD 节点 不再做业务开发。测试发现产品问题，向开发机返回失败命令、版本和复现结果，
由开发机修复并 push 后再次拉取；不在 CI/CD 节点 临时改代码使测试通过。
CI/CD 节点 上保留源码是构建和测试需要，不代表它仍是开发机。

交付路径固定为：开发机 commit/push → GitHub → CI/CD 节点 拉取并固定 commit →
原有受限构建/检查 → 按 digest 部署 → 真实操作验收 → 回传证据。
任务提交使用 WG 上的 Docker Remote API，也可按顶部最新授权使用 WG SSH 登录；源码不通过 scp、rsync、docker cp
或本地 build context 上传到 CI/CD 节点。运维方从 CI/CD 节点 向开发机交付本手册，不是反向源码同步。

当前事实必须分开理解：

- Remote Docker 双向 TLS 通道已验证，可读取 daemon、启动受限临时容器和查询运行状态。
- 已安装 `kailo-ci-control` 控制容器及主机 `kailo-ci-worker.path/service`。
  控制容器只写任务队列，不挂 Docker socket、运行凭据或源码；主机串行消费任务，沿原入口执行。
  现有 GitHub workflow 仍不是自动部署任务；开发机用本手册顶部命令显式触发。
- 原构建脚本要求执行侧使用本地 Unix Docker socket；不能在开发机直接运行它们，
  让其通过 TCP context 构建。脚本检查的是执行机器的资源和 Data 路径。
- 主机 worker 使用本地 Unix socket、原 GitHub 读取身份及运行投递；开发机只提交固定参数，
  队列参数不传 shell 命令、源码、凭据或主机路径。WG SSH 登录已单独授权；不借 nsenter/特权容器绕过执行边界。
  下文主机命令是运行原理及未登记发布单元的维护入口，已登记任务不用人工转发。

## 2. 先读什么、保留什么

工程根是 `/volumes/kailo/apps`，不是外层目录。
执行前读取 `apps/AGENTS.md`、`apps/README.md` 和
`apps/07-运行与运维基线.md` §2.1；发布要求见
`apps/03-验证发布与验收门禁.md`，历史状态见 `交接文档.md`。

| CI/CD 节点 路径 | 用途及处理边界 |
|---|---|
| `/volumes/kailo/apps` | GitHub 源码工作树，供构建、检查与运维脚本消费；保留 `.git` |
| `/volumes/kailo/.design` | 设计权威，检查时与该提交固定的设计版本对齐 |
| `/volumes/kailo/.references` | 原版只读证据；来源门禁仍消费，不编辑、不执行其中程序 |
| `apps/deploy/local/.env`、`secrets/`、`data/` | CI/CD 节点 的运行投递与数据，不从开发机覆盖，不上传 GitHub |
| `/var/lib/kailo-ci-nvme` | CI 热数据的 NVMe 实体目录；见下方磁盘分工 |
| `/volumes/data/kailo` | 保留历史证据和兼容路径；不能仅凭路径前缀判断物理磁盘 |
| `apps/dist` | 已产生的安装包和来源证明；只交付核对过的确切文件与摘要 |

2026-10-13 核对：本机仍有 95 个 tracked 文件的 unstaged 差异，另有 staged 和
untracked 内容。这些是交接前积累的工作，不是可以任意丢弃的缓存。
对端已接收历史工作并不等于它们已经全部提交到 GitHub。
首轮更新前由开发机完成选定批次收口；CI/CD 节点 不执行 `reset --hard`、`clean -fdx`
或覆盖式同步来取得“干净工作树”。worker 保留原脏树，在
`/volumes/kailo/ci/sources/<commit>/apps` 准备独立的 GitHub 固定发布树。

## 3. 开发机如何使用已验收的 Remote Docker

以下在开发机以 `kailo-dev` 执行。root 登录后用 `claude-kailo` 进入该账号和项目。

```bash
rtk proxy docker context inspect kailo-ci --format '{{.Endpoints.docker.Host}} {{.Endpoints.docker.SkipTLSVerify}}'
rtk proxy docker --context kailo-ci info --format '{{.ServerVersion}}'
rtk proxy docker --context kailo-ci ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

核对值：`tcp://10.203.193.2:2376 false`；仅回读服务端版本，不打印主机名。
本次读回版本为 `29.1.3`；以后版本变化以真实回读为准。
连接失败先核查 WG、context 和证书，停止发布，不回退公网或明文 TCP；可用已授权 WG SSH 排查。

客户端材料位于开发机 `/home/kailo-dev/.docker/kailo-ci/`：
`ca.pem`、`cert.pem`、`key.pem`；context 还保存其受保护副本。
CA 私钥只在 CI/CD 节点。证书私钥不写日志、聊天、仓库，不发给业务容器。
当前服务端和客户端证书于 2027-10-13 到期；维护证书后同步 context 并复验。
这些证书授予 daemon 管理能力，不是只限 Kailo 的权限；不得操作其他项目。

重要路径语义：Remote Docker 的 bind source 是 **CI/CD 节点 的路径**，不是开发机路径。
但 Compose 的配置读取、构建 context、`--output type=local` 的文件写出属于
运行客户端的机器。不能在开发机用同名路径冒充 CI/CD 节点 的配置和产物。
CI/CD 节点 内部 registry 回环地址也不能被解释成开发机自己的回环地址。

已验收：受限临时容器执行退出 0；无客户端证书的 TLS 请求被拒绝。
这两项只证明控制通道，不代表任何业务版本已构建或发布。

## 4. 提交发布请求与从 GitHub 更新

开发机交付一个批次时提供：

- 完整 40 位 commit、GitHub 分支、改动范围及此次目标服务。
- 是否有契约/数据库/配置变化；对应迁移顺序、停止条件和回滚边界。
- 已完成的定向正反验证；本批实际用户操作及预期可核验终态。
- 所需非密配置的名称和凭据位置，不传凭据正文。

开发机先普通 push 并独立读回远端 ref。后续已在 kailo-dev 身份下验证 GitHub 读取和 push --dry-run 成功；
这是权限预检，不代替每批实际 push 与远端 ref 回读。CI/CD 节点只需读取权限。
公钥路径为开发机 `/home/kailo-dev/.ssh/id_ed25519_kailo_github.pub`。
这只是开发机到 GitHub 的 Git 身份，与顶部 WG SSH 登录使用的专用 key 分开。

下面仅在 **CI/CD 节点** 执行，且先确认没有并发构建、验证或发布占用该工作树。
`KAILO_RELEASE_COMMIT` 必须由本批发布请求投递，不填写随意示例值。

```bash
rtk proxy bash -c '
set -euo pipefail
cd /volumes/kailo/apps
: "${KAILO_RELEASE_COMMIT:?发布请求必须提供完整 commit}"
[[ "$KAILO_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
test "$(git rev-parse --show-toplevel)" = /volumes/kailo/apps
test "$(git remote get-url origin)" = git@github.com:bei612/kailo-plus.git
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain --untracked-files=all)"
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$KAILO_RELEASE_COMMIT"
git show --no-patch --format=fuller HEAD
'
```

此命令会因当前脏树而停止，这是保护，不是通过记录。本轮没有执行更新或覆盖脏树。
若 main 在请求后又前进，最后的版本核对会拒绝发布，不默默发布较新版本。
若有本地分叉、待收口改动或需发布历史提交，保留原树；以 GitHub 已存在的 commit
准备经核对的干净 CI 工作树，放在本机 CI/CD 工作区内，不从开发机补传文件。

设计来源沿选定提交的 `.github/workflows/check.yml` 中 `DESIGN_COMMIT` 获取，
仅导出该 commit 的 `.design` 子树到本次检查快照。保留现有权威目录，
不以最新设计覆盖历史构建输入。references 按来源清单只读核验。

## 5. 构建与检查：CI/CD 节点 侧原入口

每批先检查磁盘、已有进程、CPU/内存压力和当前构建容器；四个开发任务不等于
允许四套高负载构建同时运行。复用已存在的镜像与缓存，稳定批次合并跑一次 full。

检查容器内存由 CI 执行配置 `ci/config.json` 的 `environment.CHECK_MEMORY` 投递，
已从 4 GiB 调整为 16 GiB，memory+swap 与 memory 同值；CPU 仍为 2，
保留 Cargo 原并行度。原因是旧检查容器触发 memcg OOM，`clippy-driver` 被内核杀死，
不是主机内存耗尽。worker 自身的 4 GiB 限额不等于 Docker 检查容器限额。
配置在 worker 进程启动时读取；更新配置后以新任务日志中的“容器限额”及 Docker
HostConfig/cgroup 实际值确认生效，不能仅检查配置文件。运行中任务不因修改配置自动扩容。
开发机照常提交 `check-step`，无需投递内存参数或降低并行度；失败旧任务保留原状态，
通过新任务的结果判断是否恢复，不把调大限额本身当作 lint/verify 通过。

```bash
rtk proxy df -h / /volumes/data
rtk proxy uptime
rtk proxy free -h
rtk proxy docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
rtk proxy docker buildx ls
```

调用方须投递 `TMPDIR`、`CHECK_CACHE_ROOT`、`CHECK_CPUS`、`CHECK_MEMORY`、
`CHECK_NETWORK`，需要构建时再投递 `BUILDX_BUILDER`、`REGISTRY` 及产物要求的参数。
这些不是让开发机重造一份 `.env`；执行配置与运行投递分别管理。
临时目录及所有 Cargo/Go/Node/Dart 等缓存实际落在 NVMe，核对挂载设备而非路径名称。
工具链由固定镜像提供；保留原 Cargo 并行度，通过执行容器的 cgroup 限制资源。

```bash
# 以下工作目录均为 CI/CD 节点 的干净 apps/ 构建树
rtk proxy bash tools/check-docs.sh
rtk proxy bash tools/check.sh --full
rtk proxy bash tools/release.sh
# KAILO_ARTIFACT 是本批来源清单中选中的真实产物名
rtk proxy bash tools/build-upstream.sh "${KAILO_ARTIFACT:?提供产物名}"
```

这四条按用途选用，不是每批全部重跑：文档批跑 docs；源码批先原消费者定向验证，
稳定批次跑 full；只构建受影响的产物。`release.sh` 当前同时构建 Core/Worker，
不虚构单服务参数。上游二开产物名及参数读取 `*/fork/upstream.yaml` 与原 helper。
`.references` 永不作为编译目录。

`build-upstream.sh` 会写回来源记录。这是构建产生的来源元数据，不是 CI/CD 节点 继续开发：
留存元数据 diff、source digest 和 artifact digest，交开发机按原算法核对并提交；
CI/CD 节点 不手改 source digest 凑门禁，也不代替开发机提交业务改动。
后续需 clean tree 的步骤必须先闭合这些生成差异，不能混入下一批。

每一步保存真实退出码；管道日志使用 `pipefail`，不能用 tee 的成功覆盖左侧失败。
full 中的数据库、签名、工具缺失、环境缺项与 SKIP/ignored 单独列出。
迁移演练使用一次性隔离数据库，不把线上业务库当回退演练库。

### 磁盘分工（2026-10-13 用户修订）

NVMe 承载 Docker、containerd、容器运行层、CI 工作区、临时文件、语言/编译缓存和 BuildKit；
SATA 仅作为镜像仓库的存储层。旧的“全部迁入 Data”要求已被替代，历史记录不能继续指导迁移。

| 用途 | 稳定入口 | 实体存储 |
|---|---|---|
| Docker / containerd | `/var/lib/docker` / `/var/lib/containerd` | NVMe |
| 固定源码快照 | `/volumes/kailo/ci/sources` | NVMe |
| 队列、临时目录、私有日志、生成产物 | `/volumes/data/kailo/ci`、`ci-private`、`ci-artifacts` | 绑定挂载到 `/var/lib/kailo-ci-nvme/` 下同名目录 |
| 语言和编译缓存 | `/volumes/data/kailo/check-cache` | 绑定挂载到 `/var/lib/kailo-ci-nvme/check-cache` |
| BuildKit 状态 | `/volumes/data/kailo/buildkit-core-state` | 绑定挂载到 `/var/lib/kailo-ci-nvme/buildkit-core-state` |
| Cells / Wren / Agent 运行状态及知识库启动文件 | 保持原部署路径 | 绑定挂载到 `/var/lib/kailo-runtime-nvme` 下对应目录 |
| Registry 镜像仓库 | `apps/deploy/local/data/registry` | SATA |

迁移验收以各入口的 `findmnt -T` 设备读回和真实任务为准。保留旧路径是为了固定提交中的脚本、
控制容器和 CC 客户端兼容，不是继续使用 SATA 热数据。持久挂载登记在系统 fstab，worker
通过 `RequiresMountsFor` 依赖挂载，并在接任务前核对实际块设备；错误或缺失挂载直接拒绝执行。
Docker 服务同样依赖运行数据和 CI 挂载。已校验 fstab 与生效的 systemd 依赖；本轮未重启整台机器。
CC 的 `kailo-ci` 命令、WG Remote Docker、GitHub 提交/push 流程和权限不变。

builder `kailo-core-data` 继续使用专用 CI Docker 配置连接本地 Unix socket。
worker 执行配置位于 CI/CD 节点 `ci/config.json`，重型任务要求实际 CI 临时目录所在磁盘可用至少 32 GiB，
文档任务要求至少 4 GiB。SDK 限 2 CPU/16 GiB，实际 BuildKit 限 8 CPU/16 GiB。
固定提交对应的 SDK 镜像缺失时，文档任务同样要求 32 GiB，防止文档检查隐式触发重型构建。
低于空间门槛返回失败，不启动构建，不回退默认 builder。

## 6. 部署：固定产物、限定服务、保护数据

部署前记录目标及其他项目容器的 ID、镜像 ID、启动时间和重启次数。
查看实际 Compose 标签中的 project、working_dir、config_files，不能凭历史文件名猜部署输入。
CI/CD 节点 存有临时目录下的运行挂载和 override；清理临时目录前必须检查是否仍被引用。

运行配置权威是 CI/CD 节点 的 `apps/deploy/local/.env` 与受控凭据；不得向聊天输出
整份 `docker inspect`、完整 Compose 渲染或 `.env`。检查配置可使用
`docker compose config --quiet`；具体命令须带核对过的项目、env 和配置文件。
源码里的旧 image pin 不自动代表当前运行镜像；按本批 registry manifest digest
核对来源后再投递，实际 image ID 与 manifest digest 的含义分别记录。

顺序：确认备份及兼容性 → 按原迁移入口执行必需迁移 → 更新目标镜像 →
启动并等待目标服务 → 回读镜像与 build-info → 确认无关容器未改变。
普通更新只选择本批服务，使用已构建镜像；不要执行整个共享项目的 down/up。

Core 每次启动都需要新的一次性 OpenBao wrapping 投递。在正确的发布配置上下文中使用：

```bash
# CI/CD 节点，工作目录为已核对的 deploy/local
rtk proxy bash ./start-core.sh --no-build
```

不能对 Core 用普通 restart/start 重用旧凭据；不能直接复制已消费的 wrapping token。
该入口还会投递 runtime/adapter 配置，历史临时 override 不当作永久启动入口。
已有环境不运行 `init-local.sh --fresh`，不删卷，不重建账号和业务对象。

平台 Compose 与 Cells、WeKnora、Wren 是独立部署单元。
发布某个组件不自动激活 release/binding，也不自动证明侧栏应出现。
保持 fail-closed；不写死菜单、不关闭 CSRF、不借共享身份使页面“能打开”。

## 7. 发布后测试与回传

开发端负责发起测试及判断验收；CI/CD 节点只运行构建、发布和所需检查，回传结果。
分层验收，失败停在对应层：

1. 产物：运行镜像、源码 commit/source digest、锁文件与 provenance 可关联；
   Web build-info 与实际运行一致；安装包核对文件 SHA256。
2. 运行：health、Worker 原 Temporal 队列、迁移状态、依赖及日志；这些仅是运行检查。
3. 业务：正常 SSO 从本批真实页面操作，观察返回、原服务与最终状态；
   用 playwright-cli 截图，并打开图片作视觉复核，不以 DOM 断言代替视觉验收。
4. 治理：对应场景的未授权/跨用户拒绝、撤权、重复投递和未知结果处理。
   结果不明保持 UNKNOWN，按原引用对账，不重发副作用来制造成功。
5. 范围：三人双 Agent 协作必须三个独立 HUMAN 与多个独立 Agent 实际验证；
   Web 截图不是 Windows 实机验收，打出 Mobile 包不是设备验收。

常用既有证据和消费者位于 `core/verify/`、`worker/verify/` 与各工程 `fork/verify/`。
调用脚本前读它的参数、身份来源和副作用范围，不盲跑所有历史 E2E。
凭据只从 CI/CD 节点 原受控投递面读取，不同步浏览器会话或测试口令给开发机。

回传必须包含：commit、目标服务、构建/检查命令及退出码、artifact digest、
实际运行版本、完成的真实用户操作、截图/日志位置、失败与 SKIP、未发布范围。
报告分别写“源码提交/push、实际验收、部署/安装包”；健康不等于生产就绪。
需要修复的最小复现回开发机；不在 CI/CD 节点 开新功能、加补丁或重新设计页面。

## 8. 失败、回滚与清理

- 拉取或构建失败：保持现有运行服务，不覆盖 dirty tree，不重复全量构建排障。
- 部署后失败：保存前后镜像及日志；仅在 schema/Workflow 兼容已核对时切回原 digest。
  不可逆迁移按原发布停止条件处理，不以镜像回滚冒充数据库回滚。
- 临时测试容器：确认本批身份与终态后按确切容器 ID 删除，不按名字模糊匹配群删。
- 开发遗留源码：先证明已在对端完整保留或 GitHub 提交，并排除挂载、回滚、证据依赖，
  再按确切目录清理。当前未提交源码、`.git`、`.design`、references 不纳入本次删除。
- 构建缓存：是 CI 的正常资产，不因停止开发全部清空。只清已确认废弃的产物和缓存，
  保留当前及回滚所需镜像。禁止共享 daemon 上无差别 `system prune -a --volumes`。
- 测试截图与日志：当前交付证据保留；历史重复件核对引用后清理，记录删除范围及能否恢复。

## 9. 本次手册交付的验收边界

远端 root 通过 `kailo-ci` 自动切换普通身份，实际触发 GitHub 拉取；
任务 `74cc2283156d4081b342a4ba21096e51` 返回 `SUCCEEDED / exit 0`，
源码 commit 为 `d1a371acf840a1c693f02ecb8a84303f42fb51ab`。
首次任务因固定设计对象未进入浅克隆而失败，已改为从 GitHub 显式读取固定设计 commit，
失败任务保留，不覆盖为成功。非法 commit 与未登记目标均实际拒绝。

控制容器实际回读：network=none、0.25 CPU、256 MiB、只读根文件系统、非 root、非特权；
仅挂客户端与任务目录。worker 有串行锁，主机资源限额 2 CPU/4 GiB；
实际项目编译由独立 Docker SDK 容器限额约束，当前为 2 CPU/16 GiB；
BuildKit 保持自身原限额。私有日志不挂载到控制容器。
worker 中断后在下次启动把在途任务标为 UNKNOWN，不自动重放副作用。

完整检查触发任务 `8b816228f28b4565bc4b17b64b2b14b3` 已实际返回
`FAILED / exit 1: insufficient CI workspace disk space; build not started`。
第一次文档任务尝试重建缺少的固定 SDK，已主动停止，状态保留 UNKNOWN；
补入 SDK 缺失时的空间门槛后再验证拒绝，不把它记作文档通过。
另在已有受限 SDK 中运行现有手册检查，七组通过、Markdown lint 无错误；
这是操作文档验证，不是 GitHub 固定提交的 full 通过。

本轮未替换业务容器、未执行数据库迁移或清理数据；Web 部署路径尚未用真实发布任务验收，
Core/Worker 自动部署未登记。GitHub 开发机写权限与 Claude 模型登录不由任务通道代替。
