# Core/Worker 发布产物核验（2026-09-26，2026-09-29 追加）

对应 `ADR-06`、`00-实施总纲.md` Stage 0 第 7/8 项与
`03-验证发布与验收门禁.md` §5。本记录只证明本机固定提交的两个自建发布单元；
不把本机 provenance 断言等同于远端签名或三端发布验收。

## 2026-10-04：共用设置与原生模型终态兼容批

联合候选基于 `d247288b40ca443c653fee8d928f1adb0da010d5`。DD-53／ADR-09
要求双宿主共用设置呈现，DD-110 允许复用 AgentGateway 原生协议转换；实现与
事后破坏还原证据分别见 [Web 接缝](../../web-client/fork/verify/web-surface.md)
与 [原生终态兼容](../../model-gateway/fork/verify/llm-instruction-role.md)。
两组来源及证据共 28 文件 +1255/-125，不含之后的产物记录；不复制 Core 权威，
不改变契约、数据库、Runtime profiles、旧 Installation 或权限与额度。

### Web 产物

原 `./tools/build-upstream.sh web-client` 于 16:33:15–16:35:29 UTC 实际退出 0，
只调用一次。既有 BuildKit 实际 8 CPU／16 GiB／swap 0，缓存位于
`/volumes/data/kailo/buildkit-core-state`，执行前内存可用约 38 GiB，memory PSI 为 0；
未改资源限额、构建配方、依赖锁或并行度。原 TypeScript/Vite 构建完成，chunk-size
警告仍保留。原 plan 的完整前后输出逐字相同，三份锁／package 输入校验通过。

来源 `sha256:c0545a66df1c67b9c8ce2db395fafb851abafe74211e31977e9e5bdb497e4d72`；
镜像 `sha256:7cadbf96ea96fe1abfb9b3218e6b3c7cc5802839488dde5d15e90a0102eac6d9`。
原 helper 已推送 registry 并写回原来源记录；独立 GET 返回 HTTP 200，响应 digest
与 manifest 原字节 SHA-256 均为上述镜像摘要。这里只证明构建与 registry 投递，
没有把它记作部署、浏览器验收、Windows 安装或原 Buzz 全部设置恢复。

原件 `/volumes/data/kailo/tmp/codex-shared-settings-delivery-20261004.ci5cp1/`：
`web-build.log` SHA-256 `bc961e0e9bd89aa437bccf6aefc6556d3481b16f361937aebbc7482e5a5500a0`，
`web-build.exit` 为 0；`web-plan-before.log`／`web-plan-after.log`、
`web-locks-before.sha256`、`web-registry-get.headers` 与 `web-registry-manifest.json`
保留原始证据。本批完整检查、Git 提交与限定部署须分别记录，不由镜像成功推断。

### Web 开发预览（16:54 UTC）

在共享客户端定向验证与破坏还原完成后，原 Compose 命令
`up -d --no-deps --no-build --pull never buzz-web` 实际退出 0。调用时显式使用
正式部署目录及其唯一 `.env`，只从本候选读取新 image pin；配置解析退出 0。
前后容器清单确认仅 `platform-local-buzz-web-1` 被替换，新容器运行上述
`7cadbf96…` 镜像且 healthy；Core、Worker、Gateway 与其余现存容器未变。
sole `.env` 前后摘要校验通过，没有迁移、调整权限、补发额度或调用模型。

这是开发预览，不是尚未执行的联合完整检查或生产验收。匿名公共 build-info
请求返回 HTTP 302，不能据此声称已读取构建信息。首次从 `.env` 直接读取未展开的
派生 URL 导致 curl 退出 3；改从现有 Gateway 的有效 `PUBLIC_ORIGIN` 读取后请求
退出 0。没有为读取信息修改认证策略。原件仍在同一目录：
`web-deploy.log`／`web-deploy.exit`、容器前后清单、`web-deploy-changed.txt`、
`web-deploy-readback.txt`、`web-deploy-env-before.sha256` 与 `web-build-info.headers`。

16:59 UTC 的真实浏览器使用两个既有账号分别正常 OIDC 登录。业务账号可见设置
三组，主题 dark/light 切换后恢复 system 与原本不存在的本地存储值；通知只读，
快捷键为 Enter，Sidebar Workspace 前后相同，页面错误和 alert 均为 0。
该账号的三项 Catalog 管理 GET 返回 403，对应目录没有渲染；Catalog 管理账号的
组件目录 GET 返回 200，登记／批准能力为 true，release 数量为 0。页面有一处
目录、三份空 JSON 输入，登记按钮 disabled；没有提交表单或声称组件业务通过。
所有业务非 GET/HEAD 与模型生成请求均被观察器拦截，实际写尝试为 0。

浏览器首次退出 1 是观察器 Workspace locator 同时匹配 Sidebar 与既有角色面板；
仅限定观察范围后退出 0，未改产品。17:01 UTC 已认证的 build-info GET 返回 200，
`buildId` 精确匹配上述 `c0545a66…` 来源。观察器初次误查不存在的 source 字段退出 1；
对已捕获元数据按实际字段本地核对退出 0，没有重复网络请求。两次观察器失败原件
均保留，不计为产品失败或隐藏成通过。原 Playwright 镜像和受限容器复用，不保存
cookie／凭据，观察结束删除临时容器。

同目录 `browser-preview-handoff.md` 汇总命令与边界；
`settings-browser-corrected.log` SHA-256 为
`821417ca215211f5714a96b89befe1dbde020d8574face9a31e81bd8253d74a9`，
`settings-observation.json` 为
`a658fc976e2dbe54ba784dbbcebc8a1e3f7d8c56b1787b03a0f181440aefb56b`；
`authenticated-build-info-readback.log` 为
`115be26941931d48de9123c115edb61993e1d13be6ae2753f31710731c3284b7`。
截图保留设置三组、业务 Members 与 Catalog Members；这不是 Desktop 设备或组件
登记／批准全链验收，也不重复之前的源码完整检查。

### Gateway 原生兼容修复投递（17:10 UTC）

原 `tools/build-upstream.sh model-gateway` 单次构建实际退出 0，源码摘要为
`sha256:59c75732f7b5b230a98d45d0f78b88455acb6f1832996d6236b9d5e8a44de345`，
产物为 `sha256:b7e3d559ffd7840d73e278de656879ebe12e925b3766536f9e9952d1fd7a4fff`。
原 release 编译完成用时 19m53s；构建前后 plan 相同、两锁校验 OK，实际 builder
仍为原限额，没有降低 Cargo 并行度。registry 独立 GET 200，其响应 digest 与
manifest 原字节 SHA-256 均为上述产物。构建和本地协议破坏还原原件见模型核验记录。

部署前只读查询有三个 Invocation：两个 FAILED、一个历史 RUNNING/native completed；
没有修改该历史不一致或将其当成成功。原 Compose 配置解析及仅
`up -d --no-deps --no-build --pull never agentgateway` 均退出 0。前后容器比较
只有 `platform-local-agentgateway-1` 的 ID 改变，实际运行上述摘要，状态 running、
exit code 0；sole `.env` 原摘要校验 OK，匿名公共 `/app/` 返回 302。
未新增模型调用、补发额度、更新旧 Installation 或重启 Core/Worker/数据库。
这仍是通过定向协议证据后的开发预览投递，不代替联合完整检查或真实 Agent 回合。

同一原件目录保留 `gateway-registry.headers`／`gateway-registry-manifest.json`、
`gateway-deploy.log`／`gateway-deploy.exit`、容器前后清单与唯一变更清单、
`gateway-deploy-readback.txt`、`gateway-deploy-env-before.sha256` 及
`gateway-public-readiness.headers`。

17:11 UTC 在新 Gateway 上仅补做一次正常 OIDC 登录，session GET 200，原业务
Tenant／HUMAN 与 FULL accessMode 保持；已认证 Web build-info GET 200，来源仍
精确匹配 `c0545a66…`。无页面错误、业务写尝试或模型调用，不重复设置页面遍历。
`post-gateway-browser.exit` 为 0，`post-gateway-browser.log` SHA-256 为
`60fb26ec3bc788b05d7c16eb538778d9a2bb725fda12fd58d606d6b45618cd97`。

### 同源 Windows 安装包

同一候选的原 `tools/build-upstream.sh desktop-client` 单次执行退出 0，
产物 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe` 为 15119452 bytes，
SHA-256 `aeb33abd15314ed6b1d932524eb2cb9c92872d2e0a9df5d3c29ec3b9eda69580`；
source `sha256:3f4783a0df074942e4473575f17b601d861f407d1919b32d252ea8d65955e329`。
2272 项真实输入的构建前后清单逐字一致，pnpm/Cargo 两锁校验 OK，原 manifest
重算来源与登记相等。Web 与 Desktop 本次直接消费同一设置实现，不是两套页面。

构建保留上游 dead-code、bundle identifier 与交叉编译实验性警告；安装包没有签名，
没有执行 Win11 安装、Relay 连接或业务验证，不记为正式 Desktop 发布。
原件 `desktop-build.log` SHA-256 为
`1612cf6e0f47821a118bda3ca9086cd6e1c9f00b4b254904db0e16826a9f26a4`；
`desktop-final-verification.log` 为
`9fc9f5d849b606b68ed1ce5d09e295de6002ddb63e10aade4b2c4e37466829e5`。

### 联合完整检查：首次失败与恢复通过

首次固定树 `a57ec47164b02ff03ceb1af09d5b6b7c67cb97cf` 的原 full 退出 1：
隔离 runner 看不到 shared clone 借用的 Git 对象，历史 tag 的 `git ls-tree` 返回
128；缺少只读 `.references`，六个上游基准不可读；追溯中的 Web/Gateway 摘要
仍指向旧产物，且候选 dist 没有既有 Core/Worker 的发布证明。不能把这些失败
改写为通过。原 `full.log` SHA-256 为
`6165c17965657d80855c7d7b4691359d6accf90fe26c6532fcb08cdbf88b0541`。

只修验证环境与已有发布登记：既有历史 tag 对象由标准 Git 导入私有 clone，
没有更改 tag/ref/历史；恢复 runner 只读挂载正式 `.references` 和原 Git 对象路径。
16 份既有追溯只同步新 Web/Gateway 摘要，能力 gate 不提升；原 Core/Worker 的
两份 SBOM 与两份 provenance 原字节复制到候选 dist、逐一 cmp 0，不重建或伪造。
四侧原 npx 首轮各在 DNS 重试后使用缓存且退出 0；恢复时用已有固定版本缓存的
offline 选项，不修改生成器、脚本或锁。额外的全文件哈希准备曾遇符号链接退出
123，已停止；正式输入一致性以 private index 的固定 Git 树和 diff 0 为证据。

恢复固定树 `585a9afe384c1a2a7455b64204afa6472ac5e148` 的原
`./tools/check.sh --full` 实际退出 0，末行 `全部通过。`。
原固定 SDK、4 CPU／8 GiB／swap 0、Cargo 16 与 Data 缓存不变；
唯一隔离库 `settings_full_ci5cp1` 完成迁移前进、回退、再前进和 SQLx，
73 条成功迁移、最高版本 `20261004018000`、失败 0；44 个枚举约束一致。
四侧生成、193 个 schema 与 3 个历史 schema 兼容、语言验证、Workflow replay、
20 条追溯与六份来源门禁通过。正式运行库没有参与本次数据库演练。

`full-recovered.exit` 为 0，`full-recovered.log` SHA-256 为
`26360b13a96d763aa4cfac789879736cdd0bd034858780b37eabc4b941727a3e`。
十项显式 Rust 演练 ignored；SDK 内实际部署 `.env` 预检 SKIP（实际投递时另有
原 Compose 配置解析与只读运行回执）；未安装 gitleaks，内置扫描通过。
这些边界、unsigned Desktop 与 Mobile 签名阻断均不因 full 通过消失。
此结果只覆盖选定批次，不包含正式工作树原有 67 文件 +6185/-467 未提交改动；
原改动与未跟踪清单均保留。本节追加只属结果记录，不改变已检查的可执行源码。

## 2026-10-04 15:58 UTC：组件批准批恢复发布并完成限定部署

权威为 DD-75、DD-107、ADR-06 与已经通过完整检查的提交
`9fa402fbe529f3bf4ba9e77f9825413c574411e0`，固定树
`20348b1251da28c025f39a1b2219df1350ec3038`。影响是既有 Core/Worker 镜像指针、
四条原迁移和三个运行容器，不新增契约、权限或 Workflow。外部副作用仍走原治理链，
历史不明任务不重放；部署失败不自动 down 数据库，也不把健康响应当作业务终态。
Web/Desktop 共享源码边界不变，本次没有安装 Desktop/Mobile 或绕过其签名门禁。

| 运行单元 | 实际镜像 digest |
|---|---|
| Core | `sha256:53e94494f9b36c0109607d0cf8cf6e425527bc359305aa7866b137b5821d496a` |
| Worker | `sha256:91c47ea6ca4b853eefcf3ae4880ea7ac41c5f1f17f697ff37046341f92377ba5` |
| Web | `sha256:7df928821ac674deebd167b51c9b5326107e4f04ad9715a2bfe01a0bfead6e3d` |

原 `tools/release.sh` 在相同干净源码于 15:24:18–15:51:46 UTC 退出 0；
两个镜像 push 退出 0，独立 registry HEAD/GET 均 200，header、manifest 原字节
摘要、image ID、RepoDigest 与本地 provenance 相符。499 项源码输入、Git entries
和三份锁文件未变。原受限 BuildKit 与 Data 缓存不变，没有改 DNS、镜像配方或来源；
下节首次 IPv6 访问失败保留。锁摘要清单初次逐字比较因行序不同退出 1，逐文件校验
全部通过，不据此宣称锁文件变化。原 SBOM/provenance 不是远端签名或 OCI referrer。

15:58 UTC 原 `migrate_core_database` 退出 0：`20261004015000`、`20261004016000`、
`20261004017000`、`20261004018000` 四条成功；实际库为 73 条、最高版本
`20261004018000`、失败 0。迁移使用固定 SDK，实际限额 4 CPU、8 GiB、swap 0。
原 `start-core.sh --no-build` 首次退出 1：私有候选缺少相邻 `.design` 路径，
在生成 registry 前停止，没有启动旧凭据。补齐指向设计权威的只读使用路径后，
原 helper 重新签发 wrapping 并退出 0；Worker/Web 原
`compose up -d --no-deps --no-build --pull never worker buzz-web` 退出 0。

37 个既有运行容器前后比较仅 Core、Worker、Web 三项 ID 改变，其余 34 项未变。
sole `.env` 仅从已有 `.env.example` 补发构建信息观察的 timeout 与 max bytes；
部署后与投递后基准摘要一致，Runtime profiles 原摘要也保持一致。
Core BFF `/healthz` HTTP 200，Worker 日志确认开始轮询 `kailo-component-task`，
Web running/healthy。首次将 `/healthz` 发到 service listener 得到 HTTP 404，
按现有路由改查 BFF listener 后返回 200，前者不作为服务健康结论。
历史 Gateway usage 缺 Core trace 仍保留原游标并报告 UNKNOWN，不猜测归因。

原完整检查 `full-final.log` 退出 0，SHA-256
`d0ef4f4b50d28bad9ea14b3eae6fbe367c4538cc55fdba9a3dd3039f207ce7f9`；
固定可执行树与发布树仅差回执文档。本次投递没有重复产品完整编译或 Web/Win 打包。
真实模型回复、组件审批终态与参考组件接入不由此证明；binding 合同冲突、工具授权、
设备验收及签名仍为开放缺口。本节优先于以下历史“未部署”状态。

发布原件目录 `/volumes/data/kailo/tmp/codex-component-approval-release-20261004.UTIeIb/`：
`release-resumed.log/.exit`、`artifact-readback.log`、四份原 SBOM/provenance；
完整交接 `release-resumed-handoff.md` SHA-256
`ba60acbd4a05e1e0cd650ceadfe8e7761a597e58936a437172f205c0a1ff4147`。
部署原件目录 `/volumes/data/kailo/tmp/codex-component-delivery-live-20261004.gEnXVl/`：
`migration-forward.log/.exit`、`core-start.log/.exit`、`core-start-restored.log/.exit`、
`worker-web-start.log/.exit`、`containers-before.txt`、`containers-after.txt`、
`container-comparison.txt`、`targets-after.txt`、`core-health.txt` 及两份配置摘要。

## 2026-10-04 15:14 UTC：组件批准批发布受阻，未切换运行版本

本次仅投递已验收提交 `9fa402fbe529f3bf4ba9e77f9825413c574411e0`，固定树
`20348b1251da28c025f39a1b2219df1350ec3038`，不增加产品需求、契约或工作流。
相对当前在线源码 `acbab8036911922c0dad4b4d28c7bb8e13c03afc`，累计差异为
140 文件 +15902/-816；本次投递尝试本身没有修改产品源码。
原 `tools/release.sh` 在干净私有 clone 中于 15:14:14–15:14:18 UTC 退出 1。
固定 Rust 基础镜像 digest 为
`sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9`；
`registry-1.docker.io` 的 HEAD 请求解析到不可达 IPv6，原始错误为
`connect: network is unreachable`。本地 registry 的既有 Runtime 镜像读取成功。

失败发生于 Core 基础镜像元数据读取，尚未执行 Cargo；Worker、SBOM/provenance
与镜像 push 未执行。原 builder 限额和 Data 缓存未改变，未重复构建 Web/Win。
只读排查未找到现成代理或镜像 mirror；没有修改全局 DNS、daemon、builder 或配方，
没有以另一个 Rust digest 替代固定输入。恢复原 registry 可达性后，继续同一固定
提交的原发布入口；不因本次失败重复此前已通过的产品完整检查。

部署前只读查询确认旧库仍为 69 条成功迁移、最高版本 `20261004015500`；没有执行
新增四条迁移、修改运行配置或替换容器。一个历史 Invocation 为 RUNNING、原生状态
completed、无 reply，另一个为 FAILED；没有重发、不明转成功或修改这些业务状态。
两次元数据查询因 shell 引号错误失败，修正后的只读查询退出 0；这些错误不是迁移失败。
组件批准所需两项构建信息观察配置尚未投递，缺失时按原实现拒绝批准。
本次未运行新版本浏览器验收，旧在线页面不能充当新提交业务链证据。

原件目录 `/volumes/data/kailo/tmp/codex-component-approval-release-20261004.UTIeIb/`：
`release.exit` 为 1，`release.log` SHA-256 为
`d55f7f19ffdb86ac2ff4aeffc52f1b386708134c0df7acf85f211a791191c0c3`；
`release-handoff.md` SHA-256 为
`02af61209344ef3fcc8d4dbb45dc523f246dd5612b932bd320137523ccdb5397`。
源码与锁文件前后相同；既有完整检查退出 0 与本次发布退出 1 是独立结果。

## 2026-10-04：Inbox/Workflows 集中发布与限定部署

权威：DD-75、DD-106/107、ADR-06 及已检查提交
`acbab8036911922c0dad4b4d28c7bb8e13c03afc`（tree
`ab96952c8c8ca4fc9cab34b319001d7e816bbe1a`）。影响仅原发布产物、两个
Compose image pin、原迁移链与三个运行容器；不改契约、上游版本、权限、额度、
Runtime profile 或工作流定义。数据库先执行原 forward 迁移，Core 启动复用原
一次性 OpenBao wrapping 投递；不重放历史不明模型回合，不自动 down 已有数据。

| 运行单元 | 实际镜像 digest |
|---|---|
| Core | `sha256:aee20a37489e37f3f43c4437fae1aa5bea02ef7592c751ae17823669ea532df4` |
| Worker | `sha256:ffc2b19b2127d1bacdc69cb4e970cf147a5f00b79e93f136e22002e357821002` |
| Web | `sha256:924abf4b367e1521102b2eb1d31df11bd725fb1ebe145401728cb455775e8ccf` |

原 `tools/release.sh` 于 11:55:41–12:08:56 UTC 退出 0，两组 SPDX/provenance
均生成；registry HEAD/GET 各 200，manifest 原字节 SHA、header、image ID 与
RepoDigest 一致。19216 个 tracked entries、477 个发布输入和三份实际锁文件
前后 cmp 0。复用已有受限 builder（8 CPU、16 GiB、swap 0、Data 缓存），没有
修改 Cargo 并行度或重复构建 Web/Win。首次缺少 `REGISTRY` 在构建前退出 1，
改为显式消费既有 `.env` 的 `REGISTRY_HOST` 后执行上述唯一一次实际构建。
发布原件目录 `/volumes/data/kailo/tmp/codex-workflows-core-worker-release-20261004.5W7pia/`，
`release-handoff.md` SHA `e77d4605535ed4a4613528e08f967305fde58732713edd54ce9c4bbf4ef85885`；
`release.log` SHA `233f0a8b656135402cd2ad0ce700cda9fe7f9a4642e2e92dc2455fea5ad18601`。

12:14–12:15 UTC 只调用原 `migrate_core_database`、`start-core.sh --no-build`
及 `compose up -d --no-deps --no-build --pull never worker buzz-web`，均退出 0。
实际数据库从 61 条成功迁移到 69 条，最高版本 `20261004015500`，失败 0。
迁移 SDK 实际限额 4 CPU、8 GiB、swap 0；原 SQLx 工具来自固定检查镜像。
37 个既有运行容器前后比较仅 Core、Worker、Web 三项改变；原 Relay、数据库、
其他应用容器没有替换，sole `.env` 与 Runtime profiles SHA 均不变。
首次 checksum 命令从错误 cwd 读取相对 `.env` 路径失败；在工程根重跑两项均 OK，
不将路径失败记作配置变化或部署失败。

原 Worker 实际开始轮询既有 TaskQueue。浏览器受限容器只执行登录及读取，
阻止业务写请求，12:15:26–12:15:27 UTC 完成 Inbox、Workflows、Agents 页面观察：
相关 API 全部 HTTP 200，pageErrors/alerts 均为空；Automation 区域仅在 Workflows
出现。浏览器没有生成工作流或消息，因此不证明执行历史、回复或外部副作用成功。
原完整检查固定可执行树 `0bd70a9070913e3770760d7d397ecd9e061fb705` 已退出 0，
本次只登记投递事实，不重复产品编译；全局数据库门禁此前 SKIP 与本次实际
forward 迁移是两项不同证据。历史缺 trace 用量仍 UNKNOWN，日志明确不重发模型；
真实 Agent 回复、工具 consume 授权、组件 release/binding、设备安装和签名仍未验收。

部署原件目录 `/volumes/data/kailo/tmp/codex-workflows-live-20261004.gP82UK/`：
`migration-forward.log/.exit`、`database-after.txt`、`core-start.log/.exit`、
`worker-web-start.log/.exit`、`containers-before.txt`、`containers-after.txt`、
`delivery-after-check.txt`、`browser.log/.exit`、`observation.json` 与三页截图。

## 固定输入与资源边界

- 源提交：`4e0dc502a118cf45c99048e39928ee943ebc47e6`；工作树干净。
- `release.sh` 从该提交的 `apps/` tree 导出 `.dockerignore`、`core/`、`worker/`。
  归档必须由仓库根执行；在 `apps/` 下执行原命令稳定报
  `pathspec '.dockerignore' did not match any files`，修正命令退出 0。
- 构建前确认无其他 Cargo/Rust/Go 构建进程。使用
  `BUILDX_BUILDER=kailo-core-limited-20260925`，其 BuildKit 容器实际配置为
  `memory=25769803776` 字节、`CpuQuota=1000000`、`CpuPeriod=100000`；
  脚本外层另由 `systemd-run --user --scope -p MemoryMax=2G -p CPUQuota=200%` 约束。
- 根盘在构建期间最低观察到约 48 GiB 可用；没有删除或重启旧 K8S 的资源。

## 实际运行

```text
env BUILDX_BUILDER=kailo-core-limited-20260925 \
    KAILO_BUILDER_ID=kailo-core-limited-20260925 ./tools/release.sh
exit 0
core image  sha256:c970190c38de308ce2467ea78ad9898fb76d067f78711642a23a1cfd9c5360ba
worker image sha256:7abd2c5501e90f849134d6db357b7447f97f187e24fb04e9ec8d534c7d3ed0f4
```

两个 digest 均由 `docker image inspect` 对该提交的 tag 独立回读，
与各自 provenance 的 `subject[0].digest.sha256` 和文件名一致。
各自的 SPDX SBOM 与 provenance 都已实际生成；provenance 的 `gitCommit`
均为上面的 40 位提交，依赖锁摘要均为
`7e9525d5f5451335342ebcc16e0975a3ccfedb18c2af36a3addc29ea40f6b3ef`。
该摘要由提交中 `apps/core/Cargo.lock`、`apps/pnpm-lock.yaml`、
`apps/worker/go.sum` 的 Git blob ID 按路径序拼接计算，不依赖当前工作树内容。

`./tools/check.sh supply` 在原样产物上退出 0，报告 12 个现存 digest 的
SBOM、provenance、commit 与锁摘要一致。分别把本次 Core provenance 的锁摘要
首位和 subject digest 首位改错，检查均退出 1，明确报告对应不匹配；恢复两个
字段后再次退出 0。`dist/` 不入 Git，原样产物留在本机供复核。

## 2026-09-29：功能目录重构后的发布单元

- 源：`tools/release.sh` 从提交 `076681d`（ADR-16 目录重构）的 `apps/` 构建。provenance 中的
  `gitCommit` 为 `dae9abd5954a05019ea5ab89e3e4050d8da94341`，该提交只改仓库根的 `AGENTS.md` 与
  `CLAUDE.md`，`git diff --quiet 076681d dae9abd -- apps` 退出 0，两者的 `apps/` 树相同。
- 产物（产物名按 ADR-16 改为 `core`、`worker`）：

```text
core   sha256:7e9b800d79e791b003ca10b1091e98b24b1756a56afa94b360ee631a792ae8c2
worker sha256:9e7d3a6d48b1d0281974db4806a307d44f3f30b72348c76a1bb3c18707bfd46c
```

- `dist/` 下各有 SPDX SBOM 与 provenance（`core.<digest>.spdx.json`、`core.<digest>.provenance.json`，
  worker 同）；provenance 的 `subject[0].digest.sha256` 与文件名一致，`externalParameters` 为
  `dockerfile: core/Dockerfile`（worker 为 `worker/Dockerfile`）、`context: apps/`，依赖锁摘要为
  `7fb91d1a70c935f857e07bdec20bd68de5983f71abd2fcfb0acafb65a6a77b77`。
- 14 份追溯记录的 `release.artifacts` 改登记这两个 digest（提交 `9566ac0`）；随后
  `tools/check.sh trace`、`seam`、`supply` 通过（同一提交说明）。
- 本段不含对这两个 digest 的破坏核验与回滚演练；重构后的行为回归见
  `core/verify/functional-layout-regression.md`。

## 未被本记录证明的边界

本地镜像尚未作为 OCI referrer 连同 SBOM/provenance 推送到共享 registry，
也没有远端签名及部署前验签；这按 `ADR-06` 在出现共享 registry 时启用。
本记录不证明 Desktop/Mobile 的安装包供应链，也不代替 Stage 2 业务门禁。

## 2026-10-03：公开 Memory 批 release 与限定部署

源码来自已普通 push 的 `4b44ac6b266345fbc19e3c315df5c3d9bd0af00b` clean 私有快照，
origin 为实际 `git@github.com:bei612/kailo-plus.git`；不纳正式工作树的后续功能。
原 `tools/release.sh` 完整退出 0，源码 Git blob 回执前后逐字相等；
没有重建 Runtime `ad13c952…`、Web `97bc2379…`、Relay `d42f83fa…` 或 Win11 `5378f370…`。

```text
core   sha256:577c274086d1528c30c41fef92d47066a555a3c2c06ac335fe8e4f1c9e93fa6f
worker sha256:d10b518458921cf2ff400e9069f5fe2905aae567f6c81a3410e194a469f3b78c
```

两项原 registry push 均为 0，OCI manifest GET 均 HTTP200，正文 SHA 与 digest 相等。
原 syft 生成的 SPDX/SLSA provenance 均实存于项目 ignored `dist/`，subject 对齐上列产物；
源 commit 均为 `4b44ac6b…`，依赖锁摘要均为
`76be59e4720e1f1f2653857787fd9bc712fbaeda83fb919746c5daf9ef32eb27`。
按 Core provenance、Core SPDX、Worker provenance、Worker SPDX 次序，四份文件 SHA-256 为：

```text
391525447407c93415ad9cbf3d39542810a030006c7d6efad9bf064df365b73a
0081d410cfd5aade8dfe0d596472b5973053ea4c7ef9a77e2709ae693e6cd7c7
9d3db14a54f8f1ac4ccd8656793ced444b07334715767fad44bed237a1d2c9ac
e97659206c70c61c06cb2143b3bc58a9e4184db84b7a6feeeacd8f003548a589
```

原安全入口返回 0。实际 BuildKit 父 cgroup 为 8CPU、16GiB、swap0，
Data 缓存不变；没有以宿主无 swap 推断限额，没有降 Cargo 并行度。
完整原件在 `/volumes/data/kailo/tmp/codex-memory-core-worker-release-20261003.j7LhAk/`；
`release.log` SHA-256 为 `b9b6534ef28103edc355803b062b03d9e734cf4f8a8ccdc1527763769eb02ecc`。
原 `migrate_core_database` 对在线库仅 forward，50 条迁移前进至 53 条且全部成功，
没有 rollback、删库或业务 seed；`live-forward.log` SHA-256 为
`e2bfc8ab4524df697d5166272cff4168c35856ebaca62f1a7dd94a31a579cbc5`。

首次原 `start-core.sh --no-build` 因私有快照未投递相邻 `.design` 而在 registry 预检退出 1，
发生于 wrapping/create 前，旧 Core/Worker 未动。使用原脚本支持的
`DESIGN=/volumes/kailo/.design` 后退出 0，正常取得三份新的一次性 wrapping；
不重用已消费凭据，不改工具或设计正文。Core 首次过早 curl 56 保留，随后 healthz 为 0。
仅替换 Core、Worker、Web、Relay，Worker 启动原 Task Queue，Web/Relay 原 healthcheck healthy。

首次对照发现原 OpenMeter Kafka 在替换前的 `06:18:27Z` 退出 137/OOM。
主线明确授权后只执行一次原容器启动，`06:37:03Z` 同 ID/镜像/volume/参数恢复 healthy。
原 OpenMeter 鉴权 Customer health 脚本独立 HTTP200/退出 0；原 Kafka consumer 查询退出 0，
真实 `openmeter-sink-worker` member 已连接，但 `om_default_events` log-end-offset 为 0。
Kafka 原有效 JVM 为 `-Xms1G -Xmx1G`，实际 cgroup 为 2CPU/1GiB/swap0，
heap 等于总内存 limit；未调整配置，不能声称重复 OOM 风险已消除。
最终 28 个平台容器中 24 running：四个替换、Kafka 同 ID 一次恢复，其他 23 个所有
原对照字段逐字相同。保留首次失败、137/OOM、恢复及 health/consumer 原件。
live Compose 使用此 clean Data 快照，受控 secret/data 仍绑定唯一正式投递目录，
下一原部署替换前须保留该快照与绑定，不将临时目录清理当作业务数据清理。

四步结论：复用既有发布、wrapping 与部署权威；影响为真实产物指针、三条 forward
迁移和上述限定服务操作；权限、正文瞬态、UNKNOWN 与 native stored 权威不变；
原 full1/full0/SKIP/ignored 保留，健康不代替真实 Memory/计量 E2E、AGENT 运行或
Win11/Mobile 设备验收，亦不证明远端签名或部署验签。

## 2026-10-03：3d8c0c1 checkpoint Core/Worker 产物

唯一输入为公开提交 `3d8c0c11285fbf1cfa447ba21e465842ceb4abf3` 的 clean Data
clone，origin 为实际 Github 来源。原 `tools/release.sh` 一次退出 0；
整树输入前后 SHA-256 均为 `9738c33b20bbc6ceda87c6c4dec19e0fd374d82e5dd0bdd54823a4c3af23b9bb`，
clone 仍 clean，不纳后续工作树。复用登记 Runtime `ad13c952…`，没有重建它。

```text
core   sha256:e51b71ff686be05af1e3e0db252883f25baa32c3e8deae0a03c87a6b3ccbc350
worker sha256:dcbbbd6cf583048aad89ee996d37ec201be829c292f3e4d717cfba07eb8eb0f0
```

两项正常 registry push 均退出 0，HEAD/manifest GET 均 HTTP200，manifest 正文
SHA 与上列 digest、原 SPDX/provenance subject 一致。四份原 syft/SPDX/SLSA
文件实存 `dist/`；依赖锁摘要仍为 `76be59e4720e1f1f2653857787fd9bc712fbaeda83fb919746c5daf9ef32eb27`。
原 `tools/check.sh supply` 退出 0、SKIP/FAIL 均为 0；未安装 gitleaks，
原上游 added-lines 内置扫描 PASS，2 个真实产物的 SBOM/provenance/commit/锁摘要 PASS。

实际执行者为既有 `kailo-core-data`，8CPU/16GiB，父 cgroup swap0、
max/oom/oom_kill 均为 0，Data 缓存与配方不变。Core Rust 原层成功后
才释放 Win Rust 窗口，Worker Go 接续；没有降低并行度或另建 builder。
原件在 `/volumes/data/kailo/tmp/codex-final-core-worker-release-20261003.CepL5P/`；
`release.log` SHA 为 `d85388a736d0e92e469ee2378cf8572d70756d58696e7867e95fee7963edaeeb`，
`supply.log` SHA 为 `a1cc6f7bea5391b1d43d6003d84ee1cbad5ee39ca027ec02af49bce6f8a910b3`。

四步结论：既有 clean-commit release、Runtime 与 registry 为原权威；
影响仅真实产物及已有 Trace digest；未改业务、权限或运行配置；
失败保持原证据，此次未运行 full、部署、迁移或 Agent 联合 E2E，
不能由 build/supply 0 声称 Agent READY 或生产可用。

### 同批产物实际部署与治理创建（2026-10-03）

原 `bootstrap.sh --validate-config`、`init-local.sh` 的原迁移函数、
`start-core.sh --no-build` 和三个目标服务的 `compose up --no-deps --no-build`
均实际退出 0。只替换 Core、Worker、Web、Gateway，不执行初始化重置。
迁移实际新增 `20261003100000`、`20261003130000`，原生数据库只读计数为 57。
Core 与 Worker 使用上列产物；Web 使用同一公开 checkpoint 的 98 个真实输入，
source `b6a0c1159a5d84fa8454622816638a06b5fc0d21f72112f5cf719f9e0f451df4`，
artifact `42afa40d12af5ae1d17dd7571a31375b948983e65031b6976c37effbf2b8d498`。
Gateway 原产物 `14bf9f87…` 未重新构建，重新加载私有严格 LLM listener 与持久配置。

Core healthz 200；Worker 原 `kailo-component-task` 队列启动；Web healthy。
真实管理员完成 OIDC 登录；私有模型目录匿名请求 401。管理员经原 BFF 提交
`workspace.create`，ActionExecution `0056fb6d-792d-41bf-a2ba-d1242ca853cb`
的 Temporal task 读回 `COMPLETED`，Workspace
`ad9a6443-f0a2-47d2-895d-f11b8fef9e38` 读回 `ACTIVE`。
原生 provider/model 经已认证配置 API 登记，再由 `llm_route.create`
ActionExecution `93444fce-67cf-415d-9a99-237be9c6debd` 创建受治理 Resource
`eb0d3d98-b49f-4002-b9b4-f00023ea35ab`：实际 `ACTIVE`、version 2、
native revision 1、hash `8a12148819ddde184110b2becba6678b2d33a65ad8e6e73e88c426710088c013`。
原 Gateway 集合接口读回同 ID 的 virtual model revision 1；没有直接写业务表。

原件在 `/volumes/data/kailo/tmp/codex-agent-chain-deploy-20261003.sAsJuW/`：
`live-forward.log`、`start-core.log`、`replace-three.log`、
`model-source-readback.log`、`model-route-create.log`、`route-state-readback.log`、
`route-native-collection-readback.log`。早期短 tag 不存在、查询误用表/列及单资源
GET 返回 405 均为操作失败，未写业务状态；更正为真实 full-commit tag、既有
数据库列和原集合接口后得到上述结果，不把失败记为通过。

四步结论：权威为 DD-13/70/71 与现有 Resource、Action、Workspace 生命周期；
影响仅已发布镜像、非密配置投递、原迁移和经治理创建的业务对象，不改契约；
不复制模型配置正文到 Core、不共享模型凭据、不绕过权限；重复或未知创建保留
原 ActionExecution 观察，不生成第二个请求。目录缺 RuntimeProfile 时继续关闭
Version 入口。此次没有运行 full，没有创建 Agent Installation 或实际调用模型，
未证明计量、工具、客户端设备或一期生产就绪。

## 2026-10-03 Customer 初始化与 run 登记批产物

固定公开 commit `104a9104b60d5357306cfc7528d7b8188399c536` 的干净 Data
快照执行原 `tools/release.sh core worker`，真实退出 0。Core、Worker 的镜像、
原 Syft SPDX 与 SLSA provenance 均成功产出；没有重建 Runtime、Web、Relay 或 Win。
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。

```text
core   sha256:0b4299137ebe516a99f8e05763cd106ed952ae8a08ef40817ae1c1a829a0339d
worker sha256:2cb5525cf269ab9099eaa609363e6088c14e9aa1ea2272c67aeff3d707ce947e
```

两者原 registry push 均退出 0，独立 HEAD/GET 均为 200，返回 digest 和 manifest
原始字节 SHA 与上述产物一致。Git archive、ls-tree 前后比较均 0；Git 来源为真实
Github remote，不是本地 clone。原 BuildKit 父 cgroup 为 8 CPU / 16 GiB、swap 0；
未修改 Cargo 并行或原配方。Core 配方没有显式 `CARGO_BUILD_JOBS`，不将其写作 16。

原件位于 `/volumes/data/kailo/tmp/codex-customer-core-worker-release-20261003.853u9M/`：
`release.log`、`release.exit`、两份 `*-push.*`、`*-registry-*`、
`artifact-proofs.sha256`、`source-*-before.*` / `source-*-after.*` 和资源回读。
此前输入哈希跟随 symlink 的失败保留，不作源码证明；以 Git 原生字节比较为准。
本条只证明发布产物与来源；限定部署、Customer 初始化、Agent 首 turn 与联合计量
E2E 不由 release 或 registry 200 推导。固定源码的原 full 由同一批单独留存实际结果。

### 同批部署与 Customer 重入实证

原 `start-core.sh --no-build` 与 Worker 的原 Compose 限定替换均退出 0；
部署前后容器 ID、镜像和启动时间比较只有 Core/Worker 改变。Core healthz 200，
Worker 日志确认原 Task Queue 启动。在线库已有 57 条成功迁移，
`3d8c0c11..104a9104` 的迁移目录无变化，本批不重复执行迁移。

从原 `init-local.sh` 复用 IdP subject 查找及 `bootstrap-tenant` 调用，对既有业务 Tenant
`6179e160-6055-4e9a-ae63-1793509c230c` 初始化原生计量 Customer；不直接写业务表。
首次与第二次调用均退出 0，均返回相同 Tenant、管理员与 `state=COMPLETED`。
Core binding 为 ACTIVE、version 1，customer_id 为 `01M41A96ZS6QM302QNE3EDF3YM`；
OpenMeter 原生集合与单项接口均 200，集合总数 1，key 为该 Tenant UUID。

ActionExecution `74dbc127-674e-45fa-94ce-fbb156e808ab` 为 ALLOWED/DISPATCHED，
Operation `d4e13300-34ad-4d36-8f8d-868c257dbb0a` 与幂等键均未改变。
重入后同一 Operation 下仍为六条审计事件：INTENT 一条、DECISION 一条、
派发 fence 两条、RECONCILIATION/ACTIVE 一条、DISPATCH/DISPATCHED 一条。
审计关联读取既有 `operation_id` 与 `evidence_refs`，不把未填的顶层 AE 列误判成无审计。

原件位于 `/volumes/data/kailo/tmp/codex-source-close-20261003.7MzqS1/`，SHA-256：

| 文件 | SHA-256 |
|---|---|
| `start-core.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `start-worker.log` | `66e5df7d95496e455d35f38e84dc8166d0926e99935c99c44fe136b9a6d31be0` |
| `tenant-customer-bootstrap.log`、`tenant-customer-bootstrap-repeat.log` | `779188d123f4c9d0d134c4402610a376bf06e580910bd9f50b9a8f8500b40b78` |
| `customer-reentry-readback.log` | `187ee9239c0e2db16c589bd4c3f4b72df2c9fa6c740e1715101c32f5d5802950` |
| `native-customer-readback.log` | `5b966ce72c3b4e87a34c6dbe9ec66114bf611e58bac1d79f535691682fcc71e9` |

四步结论：权威为 DD-13 与既有租户计量接缝、AE/Operation 和原生 Customer；
影响为已发布镜像及一个既有业务 Tenant 的外部引用，schema/API/Workflow 不变；
不复制原生账本、不创建默认授权、不重放未知副作用；重复调用读取同一结果，
失败与 UNKNOWN 仍沿既有对账处理。此次不证明全部 Tenant、Quota/credit、真实用量、
普通 mention、模型推理、工具或三端设备通过，不改变任何追溯门禁状态。

### 同批完整检查的失败边界

同一次原 `tools/check.sh --full` 实际退出 1，原件为上述 `853u9M/full.log`，
SHA-256 `64f955bece49e71cfe80550126d56b21e05fc132ddc8d97cc18d066f74598fa1`。
Core/Worker 静态检查与既有验证、四侧生成与 143 个 schema 兼容、隔离库
57 条迁移前进/末条回退/再前进、SQLx 和 44 个枚举约束通过。
失败项为 Desktop 来源校验：登记值 `6243945683bd87a306e8e1194ba295f2b08d4e3b599b380bc2b229293a8eb356`
与检查树实算 `b624765fdef6a30f0935d3a8cd705e2e8088d859f10230b24dc05bd52ae4bd13` 不一致。
不手改来源摘要冒充重新构建，不把这个结果外推成当前整个工作树通过。

实际 `.env` 预检在该隔离检查中 SKIP，三项显式业务演练 ignored，未安装 gitleaks；
Win11 实机/签名与 Mobile release 签名仍未闭合。本轮追加回执走原文档快路径，
不重新编译 Core/Worker 或重跑 full；客户端来源在其独立交付批次收口。

### 2026-10-04 固定 8b Core 交付与限定容器替换

干净输入为 `8b3882d35b84b2c0d6bfcb29321c62c7a44f82d4`，包含 Runtime 恢复
锁序及 AgentTask 跨页恢复。沿原 `release.sh` 的 Core 构建/pin/Syft/provenance
步骤执行，未改发布工具、未构建 Worker/Web/Win/Gateway/Runtime。原构建 session
69355、push 与独立 manifest byte 读回 64702 均退出 0；Core artifact 为
`sha256:c970fc9d076640fbf0f0176ef13b2dbbe9e30ca757ec7e8950622d4efa6dbf54`，
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
既有 builder 实际 8CPU/16Gi/swap0、Data 缓存；原 Core 配方未显式设置
`CARGO_BUILD_JOBS`，不能由后来定向 SDK 的 16 推导构建参数。

原件目录 `/volumes/data/kailo/tmp/codex-core-runtime-task-delivery-20261004.d2t87J/`。
同 artifact 的 SPDX SHA-256 为 `d4ea2401ef741aa88bc332f7c80f4ce182108af952dc5749e9c12d8268750457`，
provenance 为 `631e95e83fd6f495e5353de60501db0e39e1aacd9c0091a59a9e49f1ca00eb04`，
其来源提交为上述 8b；原输入 allowlist 前后 SHA 相同：
`2a047b705f4d326c5370e7e88a1a273ba6020009f1aca53778205a9b83dfba9f`。

仅私有干净 Compose 的 Core image pin 选用该 artifact。原 `start-core.sh --no-build`
session 66580 退出 0，fresh wrapping 后仅 Core 被替换，新容器
`f2d6b36e805cdfeeb5383cdfd0da64d801a27374e537b19bc2beee75ad65b52f`，
StartedAt `2026-10-04T00:21:25.204388912Z`；healthz 200、Core/原生 Codex child
存活、OOMKilled=false。唯一 `.env` 未改，SHA-256
`9542763e36156af691b6f74c2bbb3076031ac3f5f25c873cf2a8c2ce0a45be31`。
因此只证明当前运行 Core 已替换，不宣称正式默认 Compose pin 已升级，
也不保证下一次不带该私有 pin 的启动会选择此产物。

原 profiles RO 内容及 state RW 挂载保持；只读数据库前后事实一致：Installation
`8f240978-34bb-437d-97ee-498a30e67e86` 仍 ACTIVE generation 1，固定 Version
`cc099e7c-74d6-48a8-86c2-63bb878551ea`，projection hash
`118822289da62c5ccf3020ad75a06806d719b74cc8e9cc9ec3ec2505802074c7` 不变，
Invocation 0、成功迁移 57。未重发安装、Workflow 或模型 turn。
所有既有容器前后 ID/image/StartedAt 对比仅 Core 变化；另一 lane 新增自身 SDK，
故不声称全宿主容器集合不变。Gateway/Worker/Web、数字人与其他既有服务未替换。

原日志 SHA-256：`core-release.log` 为
`6cbf713fca57d3bdbfacfa012ea633c4602f3605775ac22d77d765e07f49e6cb`；
`core-registry-readback.log` 为 `9d4e148141cab261ad6516e125f530aa1e009e89b512ad21230be92b5c3fe4c2`；
`core-start.log` 为 `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e`；
`core-health-runtime.log` 为 `855470cc8028306a206c60d5165aabafef133289a898ff5e7e1dae4b05d27ca4`。
四步边界：权威为原发布步骤与已提交 Runtime/Task 消费者；影响仅固定旧源码产物
和运行 Core；副作用未改变配置秘密、数据库事实或其他服务；本批普通 `agent.invoke`
与权限/模型 SUM 结算源码尚未部署，不继承本节健康、来源或 SBOM 为新入口/业务验收。

### 2026-10-04 固定 13a8 普通 Core 交付：02:02 UTC 限定部署

干净提交 `13a8af775afb5232a5ce590bd9d5750cbb0f1a73`、源码树
`bf6ddebe2a37ca5905b8ba16529b28daa1c3853c`，沿原 `tools/release.sh` 的 clean/pin/
Core/Syft/provenance 步骤，只在内存收窄 unit 为 Core；原脚本、锁和配方未改。
session 32339 退出 0，未重建 Worker/Runtime/Gateway/Web/Win。复用既有 builder
8CPU/16Gi/swap0 与 Data 缓存；原 Core 配方无显式 Cargo jobs，不推定为 SDK16。
Core artifact 为 `sha256:bd5c5f57b34dd3e93a34ee8a924294049b9ed688aa7ead154552ecfed0054c54`，
Runtime 仍为 `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
原 registry push 0；独立 HTTP200、manifest 原字节 SHA 与 header digest 均匹配。
输入 allowlist 前后 SHA 同为 `0b71cbe02d844a6d9cf57a16211f26521c06bb65613ea03f90521f7d1796dce7`。
原 SPDX SHA 为 `dafdbdc3350afdebbecafd8dff25f183b6c4423ef7eca0abf669a2a2a79b2039`，
provenance SHA 为 `249697420c1ab84ccf03c422893929fa01652d0ea2105544925633ea9973df79`；
subject/source/runtime 已读回，未重造证明。

原 init-local 迁移函数在固定 10ad SDK、4CPU/8Gi/swap0/UID1000 内执行；仅 forward
`20261004002000_agent_invoke_model_usage` 和 `20261004003000_agent_installation_execute`，
线上成功迁移 57→59，无 rollback/reset/夹具。原 `start-core.sh --no-build`
session 49374 退出 0；新 Core `1b9a987e6957970b4cb73375682b8c373fbbff9a43ce092bf323654ce9d99da3`
StartedAt `2026-10-04T02:02:49.594758448Z`，healthz 200、OOMKilled=false、Codex child 存活。
原 profiles RO/state RW、固定 Installation/version/generation/hash 不变；Invocation
在本 lane 部署后首次只读为 0，不重发安装或 turn。Core 阶段 Web 已是另一 lane 的
`b399d911…`；本阶段其余 23 个平台容器及 5 个既有数字人容器 ID/image/StartedAt/status
均未变。Worker/Gateway/存储/IdP/OpenBao/OpenMeter 未替换。

运维先将真实隔离验收 meter 投递 sole `.env`；本 lane 前后 env/profile SHA 相同。
持久 Core pin 与 14 条 trace artifact 引用窄补丁已交主线并选入，未操作默认 index；
运行替换不等于该元数据已提交，最终以主线实际 checkpoint 为准。02:05–02:07 原
BFF owner 审批及 uses0/maxUses1 的 ACTIVE Delegation 回读见
[Agent 记录](agent-definition.md)，不是模型首轮或业务终态。

原件 `/volumes/data/kailo/tmp/codex-agent-invoke-core-delivery-20261004.HRUiTs/`：
`core-release.log` SHA `249b803a348cacb26bccda18fb689ee17a632de981e766be2db68d12428e2b77`；
`core-proof-push.log` 为 `02aaf3cddccff2e0d8ebb89f8a5fb4620a591ea3b26318f876ab254762344922`；
`forward-migrations.log` 为 `763b1b26a3bee7e06e92981f823e0e7b490d9b5ab8d61aaa40f0c0c645bc4f3b`；
`core-start.log` 为 `a764a4d2c8435c3ec008e05e7c2b8462cdd1b8705816c53094285de681b9cf37`；
`core-health-runtime.log` 为 `d9ac559b8519c24b5ef1c679c047d924d99fc445d2ba9bc4f5c416f9c5c72d62`；
`deployment-comparison.log` 为 `387dc814b1dc71fb30e69d808138c279881f11356a35ee2604b55db82f2838b7`。

四步结论：权威为已提交普通调用、原发布/迁移/启动与 Approval/计量链；影响仅固定
源码产物、两条 online migration 和 Core 容器；副作用前原引用和受控凭据边界不变，
不改业务事实或其它服务；异常仍保留原 UNKNOWN，不重放 turn。原源码阶段 full1/
数据库 SKIP 保留，本节没有重复 full；隔离预算不等于生产计费配置，未证明真实模型、
频道回复、stored usage、Win11 安装/签名或 Mobile 设备验收。

主线元数据选定树 `d368cbb4438d7022465313a5d2f02352eaf11285`（相对 13a8
18 文件 +36/-36）的原 `./tools/check.sh seam`，session 66154 实际退出 0。
6 份来源/6 个当前源码产物通过，Win11 unsigned 和 Mobile release 签名 NOTE
保留。原件 `/volumes/data/kailo/tmp/codex-agent-invoke-delivery-stage-20261004.2nYIn8/seam.log`，
SHA `532b7b29179a81a6909e9089b06abd53a96b45bfcb207f9700da92c9d4048654`。
这是上轮 full1 唯一产物维度的定向读回，不改写原 full 结果，不称新 full0。

### 2026-10-04 固定 b282 MENTION Core：02:51 UTC 交付与拒绝边界

干净输入为 `b2829522227d7f17053228835c9fac61734a04ef`，tree
`41d61388c80614fba10e7ac46a9fe58361cd92ba`。复用原 `tools/release.sh`
clean/pin/Core/Syft/provenance 步骤，仅在内存收窄 unit 为 Core；session 28771
实际退出 0，不构建 Worker/Runtime/Gateway/Web/Win。原 builder 为 8CPU/16Gi/swap0、
Data 缓存，Core 配方未显式设置 Cargo jobs，不以 SDK16 推导构建参数。
Core artifact 为 `sha256:cae7005b2dcaecea2fbacf5edbc32421f08f61dca2b574ae3a1b92202dc0fcb4`，
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
原 push 0，独立 registry HTTP200、header 与 manifest 原字节 SHA 均匹配 artifact。
Git archive 前后 SHA 同为 `bb19c184495a4282d36e5627e88428958f56219ef93a7e965ee859e40fe69a2f`，
原构建输入与固定提交的逐字比较为 0。SPDX SHA 为
`f77f17796f861665709455d6f4f5d899f79fa00e2ca52bf63a82fb18538b6bcf`；
provenance SHA 为 `e6211ae8c2c25d1ef222b53e927c2032fe55e80ad50de9edbd41dcdf90b31e81`，
subject/source/runtime 均实际读回。首次 proof 路径读取误用 `with_suffix` 退出 1，
发生在成功 push 后；保留原件，修正文件名读取后 0，没有重复构建或推送。

原 init-local 迁移函数在固定 10ad SDK、4CPU/8Gi/swap0/UID1000 内只 forward
`20261004004000_web_message_mentions`，线上成功迁移 59→60，新增 mentions 列
NOT NULL/default 读回一致。首次函数提取错误退出 127，未执行数据库动作；
原函数正确调用后 0，没有 rollback/reset、夹具或安装重放。
原 `start-core.sh --no-build` session 65219 退出 0，新 Core
`8d0efc4c1366890b75aba3e43a1c17479e196ecb4d3972bf58ec2976465d78e7`，
StartedAt `2026-10-04T02:51:01.388831144Z`；healthz 200、OOMKilled=false、
原 Codex child 存活。sole env/profile 字节前后相同，profiles RO/state RW 未变；
该阶段只有 Core ID/image/StartedAt/status 改变，其余 27 个既有平台容器不变，
不将其中非运行容器写作健康。原 Installation 仍 ACTIVE generation 1，固定
Version/hash 不变；部署后的 Invocation 0 是首次 UI 发送前的时间点，不是最终业务结论。
Core pin 与 14 条 trace digest 的 15 行独立补丁已同步并交主线选入；未操作默认 index。

首次 UI 发布的原 403/Relay 400 `restricted: not a channel member` 是合法拒绝：
固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`.references/buzz/crates/buzz-relay/src/handlers/ingest.rs::{ingest_event,check_channel_membership}`
与本 fork 相应消费者读取认证 `auth.pubkey()`，不是 `p` 目标；平台 governed 分支
仅认原生 roster。主线经原 BFF 明确添加 WorkspaceMembership 后，03:03:13 UTC
native 只读查询证实同 community/Workspace 下 sender `76bc7224…` 为 member，
joined_at `02:59:12.490892Z`、removed_at NULL、active count 1；本 lane 未写 Relay、
授权或业务对象，未重启或重发。主线 03:00:14 的单次消息已由 Relay 原 ID 读回。
该消息后 native turn completed，但本节不能声称 Invocation/回复/计量终态：
03:03:16/31 Core 仍明确拒绝 native usage `01a104db-1d99-7e81-9e50-e28a0baff358`
缺 Core trace，checkpoint cursor 0 留存。`gateway_usage::correlate` 只消费写前冻结的
trace/Invocation/operation，不能从共用 Gateway principal 猜关联；未弱化该 failclosed。

原件目录 `/volumes/data/kailo/tmp/codex-mention-core-delivery-20261004.pf77zn/`：

| 文件 | SHA-256 |
|---|---|
| `core-release.log` | `d1226ef4f0b720dedabf04f7c7fea1881f5c716687f62c18bd0da8350e3f2bdc` |
| `core-proof-readback.log` | `0e90497ca55b2ba2f0cfde1f4814191267c878c0125f138191b3ce627c571652` |
| `forward-migrations.log` | `f7b214023cbdc43f4366e235d3f3bc496e42e026a02b40857e159e617fd4c351` |
| `core-start.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `deployment-comparison.log` | `9f26800370a8211c08b00e9c3859469f479feb72ad105f55abf78a2bc0145eb7` |
| `relay-membership-readonly.log` | `c69e3014a44c6d1d229e954982660f57f7969765d4db7ab270cdc7aa5e7026cb` |
| `usage-tail-rejection.log` | `3a1a08444d8af99fc555b6cff8e39f47376787f2deb905300dd2a6d3daea2b0c` |

四步结论：权威为已提交 MENTION、原发布/迁移/启动、Relay sender roster 与冻结计量归因；
影响仅该 Core 产物、一次 forward migration 和 Core 容器，Relay 拒绝无需源码改动；
副作用保留原 Installation/Workflow/业务数据与受控凭据，不扩大权限、不重放 UNKNOWN；
健康、来源和原 ID 接受不等于模型业务结算，trace 缺失、reply NULL/usage 未提交仍待原链对账。
本节没有重复 full，不证明 Win11 安装/签名、Mobile 设备或生产计费配置完备。

### 2026-10-04 固定 99dd 原生 trace Core：03:45 UTC 限定交付

干净输入 `99dd3ebba3d278ca2c373b390909d72c0a4d5cbd`，tree
`7cc70711ee8281ce580227d5182b4c3daf6eef95`。原 `tools/release.sh` 在内存仅收窄
unit 为 Core，其 clean/archive、Runtime pin、原 Core 配方、Syft 与 provenance 均保留；
session 22942 退出 0。原 builder 8CPU/16Gi/swap0、Data 缓存及 Cargo 配方未改，
不把 SDK 的 jobs=16 推导为构建实参。Runtime 复用
`sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`，
Worker/Gateway/Web/Win 均未构建。Core artifact 为
`sha256:50bd7f19299544399da452481be06ff312dd11c486ccaff8edbbe691cccafd16`；
原 push 0，独立 registry HTTP200，header 与 manifest 原字节 SHA 均等于 artifact。
构建输入 archive 前后 SHA 同为
`96273c28d1dd36dcd95063c854a04d92b4457df944d03cf9435a4f027e0acce7`，逐字源核对 0。
SPDX SHA `a6fbd7ff6a09577990db2322975ecaf7f0cd9a5256381193367d0275cfba5548`、
provenance SHA `78c3114d6676c609221e51374731799756e5f413a14ade4bbf420b79074b33d4`；
subject/source/Runtime 实际核验 0，两份原 proof 已逐字交付正式 ignored `dist/`，cmp 0。

03:41:47 只读部署前核验 active/unconfirmed native turn 为 0；旧 Invocation 原生
completed，不是业务成功。原 `start-core.sh --no-build` session 71353 退出 0，
新容器 `b532c724acb3ffab66961dcd678ad767cc43644b976b45ebb8cf4ae3c6f3fd29`，
StartedAt `2026-10-04T03:45:34.719770259Z`；healthz HTTP200、OOMKilled=false，
仅 Core ID/image/StartedAt 改变，其余 27 个既有平台容器完整比较不变。
没有新迁移，线上成功迁移仍 60；sole `.env` 与 profiles 前后 SHA/cmp 均不变。
原 Supervisor 恢复唯一 Codex child；`agent_runtime::Supervisor::ensure` 只有原生
initialize/config/read 全部 guard 通过后才保存 process，失败由 kill_on_drop 关闭。
本次不另开生产 RPC 或第二进程；同 Installation ACTIVE、generation 1、resourceVersion 3
与 config hash `118822289da62c5ccf3020ad75a06806d719b74cc8e9cc9ec3ec2505802074c7`
保持不变。仅辅助读取原配置的 OTel 字段：trace endpoint 为原 collector `/v1/traces`、
binary，logs/metrics exporter 为 none、prompt=false；磁盘读取不冒充独立 native 回读。
主线原 browser read 03:47:04 退出 0，旧 Task 仍 RUNNING/BILLING_UNAVAILABLE，
source 1/reply 0，Delegation EXPIRED version 2/uses 1；未续预算、改权限或重发旧回合。

原件目录 `/volumes/data/kailo/tmp/codex-native-trace-core-delivery-20261004.7a3Hd1/`：

| 文件 | SHA-256 |
|---|---|
| `core-release.log` | `b80877b8636caca2dfa4ac0bdb1d2483eb54f8f659b74b48fa1d6b3aa5e2ebd0` |
| `core-proof-readback.log` | `63678ded80ec73de82c66c8c9f863f818afac700626a394b34472d465c936870` |
| `core-start.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `core-health.log` | `279563bb5e00563f197cd3fcf8e247f57aad3eeda2c301ea89906d3a1623d33d` |
| `native-config-selected.log` | `19543b3b766b5795f052f97fc5a3bf941633ea58a5fcc4698ea7313e2475d043` |
| `bff-after-core-read.log` | `2edb5ebc7f84af2d4b6fc91de11f9f424fd2e0e999752d0e5ebf1f16e52479cf` |

四步结论：权威是固定提交、原 Core 发布/启动链与强制 config/read guard；影响仅 Core
产物、15 个持久 pin/trace digest 值及一次 Core 替换；副作用未改变 DB 业务事实、
profile/秘密配置、权限、预算或其它容器；本次健康/配置恢复不证明新模型调用、旧无 trace
用量修复、回复或计量终态，不重复 full，不扩大 Win11/Mobile 设备验收结论。

### 2026-10-04 客户端准入、提及与共享设置集中收口

基准 `9273f48cb042ad866d2c173e77b8d11b80423e6d`；源码冻结树
`b6dc5839d2280459a9d6936a6cf4d22046531599`，产物引用同步后的完整检查树
`dbe2e25fb8c5be669d7dcc442bfa95f5304bded0`，均为选定的 62 文件 +2499/-501。
包含共享设置、撤权停流、多 Agent 提及与 Core 同 Session 派发重核；未混入正式树
历史脏改。四步边界：复用原宿主/BFF、共享组件与原 Invocation 权威；影响为选定源码
及真实产物引用；本次副作用仅私有构建、registry push 和隔离检查库；未部署、未发送
消息、未调用模型、未追加额度或改写历史 UNKNOWN。验收不等于真实多 Agent E2E。

先在固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
内执行原 `pnpm -r typecheck && pnpm -r test`、Web `npm run typecheck && npm test`、
Desktop 同名命令：共享 307、Web 39、Desktop 2302 项均通过，类型检查退出 0。
Web 依赖沿 `npm ci --offline --ignore-scripts --no-audit --no-fund` 安装；Desktop
首次依赖副本缺少祖先 pnpm 目录而退出 1，补齐既有 ignored 依赖后原命令退出 0，
没有修改产品源码或锁文件迁就环境。

原 `./tools/build-upstream.sh web-client` 与 `desktop-client` 分别为 session 9922、
9930，实际退出 0。原 `kailo-core-data` BuildKit 为 8 CPU/16 GiB、memory=swap，
缓存位于 Data；未调整配方、并行度或忽略规则。两份 plan 构建前后逐字相同，
共享、Web、collaboration 三份锁文件 SHA 核对一致。Core/Worker/Gateway 未重建。

| 产物 | source digest | artifact digest |
|---|---|---|
| Web | `a56840b9cff74320164a8b83df3c5d330e5972a700750255f4a9dd85ed72c5dc` | `ebfbe53111f329afe7fd46bb52f6e95764127bad98fb240da49ffffe3a95453e` |
| Win11 x64 | `4325bd6d4867a8ef0c5a93df8702330662346de3b65bc08387cd4005155b39c6` | `f93b0f36cc1096bb4911a4d54c08ff9edacd05ea0e344397794d0eae5bb66de5` |

Web registry 独立 GET 200，响应 manifest 原字节 SHA 与 artifact 一致。Win 包为
`dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，15,120,596 字节，未签名、未安装或
设备验收。候选仅同步两原 manifest、Compose Web pin 与既有追溯 digest。

首轮 `full.log` 实际退出 1，保留 TypeScript 主题守卫、README 链接、追溯阶段和
来源摘要不符的原失败，不以通过其它项覆盖失败。主题检查暴露 Web 缺少原 Buzz
字体映射；修复后私有 `color:red` 与错误 timestamp 映射两处生产变异使两个断言
失败，逐字还原后原共享 307 项再次通过。最初 Web 构建期间源码变化，后续的
`06480e20…`/`1d7bc93a…` 也因合并修正失配；均保留原件，不用旧产物冒认新来源。

最终同 SDK 4 CPU/8 GiB、无额外 swap、UID 1000、Cargo 16、Data 缓存执行原
`./tools/check.sh --full`，session 72628 实际退出 0；全过程产品源码与锁文件未变。
独立 `client_admission_full_jdneh9` 库迁移前进/回退/再前进、SQLx 与 44 枚举约束通过，
最终 73 条迁移、最高 20261004018000、失败 0；193 schema 兼容、四语言验证、
Workflow replay、20 份追溯、六个源码产物和原 Core/Worker 四份供应链证明通过。
Core 主单元 155 passed/9 ignored，另两项显式演练 ignored；这些不计业务 PASS。
实际部署 `.env` 预检 SKIP，未安装 gitleaks、仅内置扫描；Mobile 签名缺口保留。

原件目录 `/volumes/data/kailo/tmp/codex-client-admission-20261004.JdnEH9/`：

| 原件 | SHA-256 |
|---|---|
| `merged-targeted.log` | `a37e1e759c1b02536459303b165354f18f56002f20a085e2c8f93a2715f97852` |
| `merged-desktop-targeted-corrected.log` | `19046721b726b798493f7809e34ace8163e666ecf5fff34e8abfc1e9d653ac47` |
| `merged-web-build.log` | `531068b4d8e74a14f2d3497ebc79a2afb1ad2eb65e2e676f98de02c8fb58b159` |
| `merged-desktop-build.log` | `261d3ad98dc813e97d5b5c1478433539c32eadca8436ea23a6b592f55e1b0af1` |
| `full.log`（首次 1） | `ecb5d397267afbb553d551938805abc1ee6aeada1cd3c07bb11ed69b62cf64d3` |
| `theme-production-mutant.log`（1） | `2ca1b467f39454bc8dde8d23691d338bc03a29a7c58aa3ecd89ff15a4345f79c` |
| `theme-final-restored.log`（0） | `013171c37b31d05262a744ac6f31b33679c234656bc0e294b14191ce26e366f4` |
| `merged-full.log`（最终 0） | `e728ca351e03f6e20b256010fc31e7d1745a476f2b56bc740349208ff709f61d` |

### 2026-10-04 a0defa2 交付与新来源证明核对

发布源码为已提交的 `a0defa2eb067362fb37e3e224a48b3c6b674bc4f`，使用 Data 干净克隆，
没有从正式脏工作树抓取产品。原 `./tools/release.sh` session 8490 退出 0，保持既定
Core、Worker 两单元；Worker 业务源码未改，因原入口固定发布两单元而一并产出。
Core/Worker 各一次 registry push 退出 0，独立 HTTP 200 的 manifest body/header、
image ID、RepoDigest 与原 provenance subject 一致。Core/Worker 尚未部署。

| 单元 | 新 registry artifact digest |
|---|---|
| Core | `2f17c22140f4a71a684ff50c5872a7d72af0d71b878f50cd6b96d81b3303682a` |
| Worker | `996c777cae940a2155282428fcc18f246bb622cd65299e1833a7d78a62bc3e14` |

原 provenance 精确记录 source commit 和 `PLATFORM_BUILD_ID=a0defa2…`，Core Runtime
仍为 `ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
依赖锁摘要为 `6d85e3bb36aa52c803938ca949d49a587408452fe7325440615e041f3bc885e8`，
原 Git 索引与三份受跟踪锁构建前后核对不变。BuildKit 沿原 8 CPU/16 GiB、无额外
swap、Data 缓存；调用环境保留 Cargo 16，但原 Dockerfile 未转发 jobs 参数，不能
声称容器内另有该参数。未改全局网络、工具链、配方或并行度；builder OOM 计数为 0。

19:10 UTC，仅用冻结 Compose 原 `up -d --no-deps --no-build --pull never buzz-web`
替换 Web，session 45277 退出 0；新容器 `914e005e…`、镜像 `ebfbe531…` healthy。
全体现有容器 ID/image/StartedAt 比较只有 Web 改变，sole `.env` SHA 不变。实际
HTTP health、页面、两份 JS、一份 CSS 和 build-info 均 200；build-info 的 BUZZ_WEB
来源 `a56840b9…c5dc` 与本批 manifest 相同，公开匿名入口仍 302 OIDC 跳转。
Win `f93b0f36…` 已逐字放入既有 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，
旧 `206c62bf…` 包在 Data 原件目录备份；未创建下载服务，仍未签名、未设备验收。

真实浏览器以既有业务身份读取设置，Composer 同时选中两个 Agent；无 API 写入、
消息或模型调用。首次 build-info 路径误读 404 保留，使用真实路径的后续 GET 200
精确核对来源，不能把两项选择当作两个 Agent 已执行或回复。另一次身份只读核验：
bootstrap 所在频道有 1 个 ACTIVE HUMAN、2 个 ACTIVE Installation；seam-verifier
OIDC 成功但四项业务 GET 均 403/TENANT_MEMBERSHIP_NOT_ACTIVE，不证明多人协作。

首次原 `check.sh supply` 退出 1：检查器只识别旧 `release.sh` 的 buildArgs 字面形态，
拒绝了本次真实包含 PLATFORM_BUILD_ID 的两份证明。本批只修原消费者，从证明所记
commit 的发布脚本确认形态，build ID 必须等于该 commit，继续精确比较完整参数，
并保留 Runtime pin/OCI dependency 严格校验；旧形态仅验证其真实历史产物。
因此本次收口不再是纯元数据批，须在两项反例还原后运行一次原完整检查。
此前 trace/seam/security 均 0；实际 `.env` 预检 SKIP、内置扫描而非 gitleaks 的边界保留。

原件目录 `/volumes/data/kailo/tmp/codex-client-core-delivery-20261004.fXcD9L/`，
`artifact-readback.log` 保存 commit/build ID/锁/原证明与 registry 核验。

| 原件 | SHA-256 |
|---|---|
| `release.log`（0） | `cfb30e1b07ebee6653b7fe2a7a6fbb79fb673859a96faff58f3cf17e65f6017f` |
| Core SPDX | `6d718238295ea04f62b2bc3e5f604cbcd902605864062f24f47cf827213656e7` |
| Core provenance | `06c16042baff01f9ee3df75e23b27d7b5a0b648550c236c4ef0f17aad25c081d` |
| Worker SPDX | `99667395056afe23804e4d349070a981c7d294b02446cc97c8c2abc59ebca3d6` |
| Worker provenance | `94c11c8b3e8357914e2425a38db4f7f8facd992a81c10c1982bc7a8d8de3f9a3` |
| `../codex-multi-mention-20261004.qlM03z/live-browser.log` | `d9a787ebb54587b28895190429f5750dc776ac81ad9946793aa756a317d38cf8` |
| `../codex-multi-mention-20261004.qlM03z/live-browser-build.log` | `0cf7fab3e902ba68b84c0b4cdfedaa69c3a5e1caad2a60de2eea17b9061a29ba` |
| `../codex-multi-mention-20261004.qlM03z/two-identities-readonly.log` | `d810708e146106c61e4eafd9a9ebe8b158601c9d285204f9ff3d65d6c595fa30` |

随后两个实际反例分别退出 1：把 Core 证明的 build ID 改为其它值，原供应链检查
拒绝构建形态；把 Runtime digest 改为其它值，原检查拒绝与 source commit 的 pin
不符。其它证明不改。首次文本还原多出 EOF 换行而 cmp 失败，已从保留的原生成
文件逐字恢复，四份原 proof SHA 全部一致；此恢复完成于 full 的 lint 阶段，早于
供应链消费，产品源码和原证明内容没有改变，未手调 artifact digest。

最终固定树 `bbf990d8f4ebd51ba56b45cacda9236fe7952061` 的原
`./tools/check.sh --full` session 90620 实际退出 0；沿原固定 SDK 4 CPU/8 GiB、
无额外 swap、UID 1000、Cargo 16 和 Data 缓存，复用原独立验证库而非生产库。
73 条迁移往返、SQLx、193 schema、四语言验证、Workflow replay、20 条追溯、
新两镜像的供应链证明与六产物接缝通过。Core 主单元 155 passed/9 ignored，另两项
显式演练 ignored；实际部署配置预检仍 SKIP，未安装 gitleaks，只运行内置扫描。
此 full 覆盖检查器修正及新产物引用；上节 dbe2 产品树的 full 是独立原件，不改写。
本段仅追加验收结果，随后只运行原文档快检查，不重新构建或部署 Core/Worker。

| 原件 | SHA-256 |
|---|---|
| `metadata-supply.log`（首次 1） | `0333cecfbc2d2e363a583238df998da702c93d199b55246b8dc167f4fd0182eb` |
| `supply-build-id-mutant.log`（1） | `825c7f19e3bda47f41b208a36e939b5ca3b49ebcee5c7704555b31c54839916b` |
| `supply-runtime-mutant.log`（1） | `25a960569132fe21275fc3f96db6440669ef69d7bc9b9e538ad95819dc5cdfcb` |
| `full.log`（0） | `6bacffd9494503c5301cbe9d26c32c35d0ed18627d85f2d056f39dfd04bb7ea5` |

### 2026-10-04 19:46 UTC：已验 Core / Worker 限定部署

来源登记提交 `32eb863d846efde47fd1e1dc045b6f51c4704257` 已普通 push；
实际产品来源仍为 `a0defa2eb067362fb37e3e224a48b3c6b674bc4f`。
冻结 Compose 通过原 `start-core.sh --no-build` 使用 fresh wrapping 启动 Core，
Worker 通过原 `up -d --no-deps --no-build --pull never worker` 启动；两命令退出 0。
完整容器比较仅 Core 和 Worker 改变，实际 image ID 为上节 `2f17c221…` 与
`996c777c…`，与原证明一致。Core health HTTP 200，Worker 于 19:46:10 开始
原队列轮询；源码身份以实际 image → 原 provenance 的 build ID 关联核对，
没有声称访问公开 Core build-info 端点。

sole `.env` 与 Runtime profiles 摘要不变；迁移前后均 73 条、失败 0。
三条历史调用的 native 均终态且容量 RELEASED，旧 `4cfe99fe…` 仍保留
`BILLING_UNAVAILABLE`，未重放或补写用量。首次只读预检查询错误表名失败，
纠正为真实表后退出 0；不掩盖首次失败。没有修改权限、成员、额度或发起模型调用。
本节仅记录部署事实，不代表真实回复、多用户协作或生产就绪。

原件仍为上节 `fXcD9L` 目录：`core-start.exit`、`worker-start.exit` 均为 0；
`deploy-containers.diff.log` 为限定变更证据，`deploy-after.log` 为只读回读。
`core-health.headers` SHA-256 为
`ec16965c8a02823ee28903c7769eae039cc4ada4c7521200a61abdc84a6773a4`；
`deploy-identity.log` 为 `7103af17d0336972cbee4b1f739dd6803e53988510724db65a505145c3f07300`；
`deploy-config.after.log` 为 `f74db10a410f11ff18135185895973c80bcba26e8fe76eac45d6b46b993ce3ae`。

### 2026-10-05 共享导航设置与频道已读失败恢复联合产物

基线 `a714684260d261ce520f6f3a625a197c83b07e9c`，仅私有干净候选
`codex-channel-read-recovery-20261005.tLs1fL/apps`；正式历史脏改动未写入。
产品源码冻结树 `ebcc7c4a5f0abc18c0fae94b2def4e8334033f7c`，合并原 Buzz
突出当前导航设置复用与频道已读失败恢复。两组生产变异和定向结果见
[Web 验证记录](../../web-client/fork/verify/web-surface.md)。

原 `./tools/build-upstream.sh web-client`、`desktop-client` 分别仅运行一次，
session 12881、46168 实际退出 0；使用既有 kailo-core-data BuildKit，
实际 8 CPU / 16 GiB / memory+swap 同限额，缓存位于 Data，不降低并行度。
Windows 原交叉构建经历基础依赖冷层，最终产出 Win11 x64 NSIS 测试包，
不是 Linux 包；不改变配方、锁或忽略规则来绕过来源检查。

| 产物 | 冻结源码 SHA-256 | 实际 artifact SHA-256 |
|---|---|---|
| Web | `f76af8a137a7f962d08d2971583c2a131fdc9ae363e2cf787d59e846e2d0e8e2` | `d3e75136ed23120f28386824bb4dd5914cc236d8f7ca2101031559d4ac1eeb41` |
| Windows | `fda858436b076f9fb88b5000e6996c00d2c0d47d5950abc3322ec99f8433ec0e` | `1342aa56420ba9c0dc11f5860c9f5531037694a767d060b879116055f1bf28d2` |
| Relay | `4ffa0b5a3f5f223c9f455c682f31f7959b6347632288b1c534e0e750f12bc9f2` | `af0453a61bb2fe9d4576d2cd59f7e7608a04c12719d2ec1dfa50ee48bf011c11` |

首次原 `./tools/check.sh --full`（77150）退出 1，唯一失败是 Relay source_digest：
原 manifest 把 `collaboration/pnpm-lock.yaml` 计入 Relay 输入，本批共享 peer
依赖的机械锁更新正是唯一变化的 Relay 输入；`relay-rust.diff` 为空。
经明确授权追加原 `./tools/build-upstream.sh collaboration-relay` 一次（93916），
实际退出 0，未重建 Web/Windows/Core/Worker。两镜像均独立 registry GET 200，
响应体 SHA 与记录 digest 相同；Windows 包字节 SHA 相同。三个原 source plan
前后 cmp 0，三份 pnpm/npm 锁 SHA 未变，Compose/trace 只同步实际摘要。

最终检查固定树 `76f231cab5c2ea544277bc4d870e012c4f5fd9e5`，44 文件 +756/-111。
同固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`、
4 CPU / 8 GiB / memory+swap 同限额、Cargo 16、原 Data 缓存执行
`./tools/check.sh --full`（38778），实际退出 0。独立空库
`channel_read_final_tls1fl` 完成 73 条迁移（最高 20261004018000）前进/回退/再前进
及 SQLx 核对，193 个 schema、六产物来源、供应链、追溯与安全门禁均通过。
首次失败原件完整保留，不用最终通过覆盖失败历史。

原 Core 主目标 155 passed / 9 ignored；另有审批 CAN 与停启 Relay 的两项演练
保持 ignored，缺其专用夹具/操作授权，不计为通过。未向候选投递线上 `.env`，
实际部署配置预检明确 SKIP。Mobile 签名阻断保留；Windows 未签名、未设备安装运行。
本批只生成和登记产物，未部署任何服务，未做修复后的真实浏览器已读验收、
双 Agent 模型回合、权限或额度写入，也未触碰旧 UNKNOWN。

完整原件在上述 `tLs1fL` 目录，各命令 `.exit` 与原日志并存。日志 SHA-256：
`web-build.log` `743bc415e9275c9bb88dca031a627c21e3a794b240bed2543dd585b5757196ae`；
`desktop-build.log` `74a59f6fe866274a2998d2bd210a6cdb3530cd43f41117af2bd08086cd5bac03`；
`relay-build.log` `0a9b5edfd3c638a8b2c563b855fb21d66c0b0e4941efc99e3010660a79083f5c`；
`full.log` `d511bd89dcd9b75733d1a676367e7cc7cffab0596194ba25fa9560825797794b`；
`full-final.log` `081a8c923e4f08ee93a0c364bec6727cbc7fdd727458f7e56e7dce8e70d969fc`。
