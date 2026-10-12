# Inbox 原项目事件与只读详情接线

关联 V-REQ-24、DD-39、SS-BUZ-GOVERNANCE、SS-WEB-RELAY。本批是项目通知读取闭环，不是完整 Projects 产品恢复。

## 权威、影响与异常

固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/home/lib/projectInbox.ts::getProjectInboxReference`、
`desktop/src/features/projects/projectWorkItems.ts::fetchProjectsWorkItems`、
`desktop/src/features/projects/projectIssues.mjs::projectIssueEventsToIssues`、
`desktop/src/features/projects/projectPullRequests.mjs::projectPullRequestEventsToPullRequests`、
`desktop/src/features/home/ui/ProjectInboxDetailPane.tsx::ProjectInboxDetailPane` 是本批依据。
其中 PR 1619 更新使用大写 `E` 根引用，仅接受原作者/仓库 owner 的更新；不把任意消息当成可改 PR 状态的记录。

正文、任务/审阅状态、评论仍在原 Relay。Core 不建立项目正文表；现有 Projects query 仅增加封闭的 `WORK_ITEMS`（1618/1621）和 `WORK_ITEM_ACTIVITY`（1/1619/1630–1633）读取视图。
两者必须携带非空、无重复、受 Relay max-limit 限制的 canonical 30617 坐标，不能成为任意 kind/filter 的代理。
Web 仍由 Core actor key 经既有 Community admission 读取；Desktop 原本机 key 直连 Relay，管理读标记仍走 BFF。

影响面为原目录分页、共享 Inbox 聚合、两端原 Inbox 消费、原 Issue/PR 只读 JSX 和 Core 用户读标记。
新增视图是请求枚举增量，无数据库或持久状态格式变化；旧 PROJECTS/REPOSITORIES/DELETIONS 请求保持原格式。
旧服务器不认识新视图时拒绝，而非空列表成功；发布必须先更新服务端/四侧生成，再投递调用新视图的客户端。
生成物与 schema 同批收口，不单独部署本批 schema。最终独立候选从固定
`81786a99aea969cefac4c9ccaaf79713bb0c4f94` 加本批唯一 Projects query schema
沿原 `tools/gen.sh` 生成四侧；不带 Cells 未提交字段，不覆盖工作树联合生成物。

频道与 DM 原鉴权继续执行，只有其中未解析的事件 ID 才进入 actor-bound Community 项目读取。
原 `msg:<event-id>` CAS 读账本复用，项目不伪装为 Workspace；GET/PUT 都消费真实可读事件并重新核验 scope。
客户端按原 `(repoAddress, rootId)` 聚合，项目通知在 All/Project 中可见，不归 Thread。
零项目正常空列表；页满时沿既有同秒排空规则读取，同秒桶达到限制则拒绝不截断为完整历史。
viewer、binding generation、limit 改变或任一活动页失败，整个快照拒绝，不把部分评论/状态显示为空态成功。
组件不参与此读取，不新建 workflow、额度或审计权威；没有项目写副作用、重试写入或新的持久待终结状态。

## 固定源码差异分类

- 原样保留：Issue/PR canonical reducer 的状态、可信 actor、review decision 与历史处理；原 section/feed-row/profile identity/评论折叠结构。
- 共享迁移：原任务/审阅完整只读正文、metadata、description、updates、commits、checks、review/history JSX 搬到 `client-kit/ts/platform/src/react/projects/`；Web/Desktop 共用 `ProjectInboxDetail`，不各造摘要页。
- 已授权治理改造：Host transport 与关闭未接通写分支、封闭 Core query、已有用户读账本 fresh admission、scope/generation fencing、中文默认/英文同源词条；Web copy 使用既有宿主 clipboard adapter。
- 缺失需恢复：任务分派/状态写入/评论、审阅请求/决定/合并等原写接缝；Git 文件差异与 commit 文件导航、DiscussedInChannels、buzz:// 项目深链及 ShareLinkButton。两页原 ProjectOriginReference 的来源 Agent/频道只读入口在下述独立批次恢复源码接线，不能据此认领部署验收。Web 项目通知行作者资料/头像目前未达到原完整资料触发器。这些不是已授权的永久删减，不冒称完整原版恢复。

### ProjectOriginReference 的具体读取接缝

固定官方 `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/ui/ProjectOriginReference.tsx::ProjectOriginReference`
由 `desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail`、
`desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::PullRequestDetailHeader` 及
`desktop/src/features/projects/ui/ProjectCommitDetailPanel.tsx::ProjectCommitDetailPanel` 消费。
本批只接前两者既有真实读详情，第三者仍缺完整 Git commit/diff 消费者。其来源必须明确标注
“author-claimed”，不能把事件作者的声明升级为 Relay 认证事实；私聊来源只显示
Agent 名称，刻意不暴露私聊标识。现有共享两个 canonical reducer 已原样读取
`h` → `channelId`、`buzz-origin-agent` → `originAgentName`，不需要猜测或另存来源。

四步结论：原模块支持、设计要求恢复，缺的是宿主读/导航而不是来源数据；影响面是
`PulseHost.OriginReference`、两详情原 metadata 插入点、两宿主和现有目录查询。
Core 不复制来源正文、不新增持久状态；单 ID 仅收窄当前 tenant 的原 discovery SQL，
不接受调用方 tenant/scope，不改变 `open || ACTIVE membership`、SpiceDB fully-consistent
discover、binding/window-author 及外部读取后的再次校验。旧 cursor-only 请求保持兼容，
未知/错误/跨范围 ID 不产生猜测的频道；身份/投影/Relay 失败仍走原六类错误，不降级为成功。

- 原样保留：原完整外层/文本/按钮 class、作者声明说明、`isMember || visibility === "open"`
  分支、私聊 Agent 名称而非会话 ID，及两个详情的原 header 位置。
- 共享迁移：完整展示由共享 `ProjectOriginReferenceContent` 承载，两页通过既有
  `PulseHost` 的实际宿主使用，不借用完整其他页面、不另造来源摘要。
- 已授权治理改造：Desktop 消费现有 `channelReference.ts::useChannelReferences`
  与 `useAppNavigation::goChannel`；Web 通过原目录服务的 `channelId` 可选筛选读取，
  点击时重读，再交原 `PlatformApp::openSearchChannel` 进行最新目录映射。元数据发现
  不是加入或读消息准入；不把热缓存当授权。空成功保留原不可见说明；尚未结束/失败
  不虚称私密，不露来源名称或按钮。scope 离开后禁止旧请求导航；重复点击只读、无写副作用。
  有界响应不匹配 ID、重复目标或携带 nextCursor 均拒绝；旧服务器忽略筛选不能作为成功。
  中英 8 词条沿原投影生成 Dart，不维护第二翻译权威。
- 缺失需恢复/验收：上段原写/Git/分享/Web 作者资料缺项未扩大；本批没有新镜像、部署或
  新版本截图，真实 Core HTTP/SpiceDB/Relay 与两端设备验收不能用 DOM fixture 替代。

逐项对照边界：本批对应固定官方两个实际插入点分别在
`desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail` 的原 header
与 `desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::PullRequestDetailHeader`；
当前对应共享 `ProjectIssueDetail` 与 `PullRequestDetailHeader`，不是新增页面。
全 `desktop/src` 的固定 commit `git grep ProjectOriginReference` 还确认
`desktop/src/features/projects/ui/ProjectCommitDetailPanel.tsx::ProjectCommitDetailPanel`
第三调用；该完整 commit 元数据/正文/讨论/文件 diff 模块不在本批，不生成空壳或假入口，
仍归「缺失需恢复」，不能用前两处接线宣称原 Origin 所有消费者完整恢复。
原 `desktop/src/features/channels/openChannelDirectory.ts::useChannelReferences` 还消费
warm-open-directory；当前 Native 已有 `channelReference.ts` 不消费该支路。本批复用
这一既有实现，没有把整个原目录模块归为「原样保留」，也没有把热缓存升级为权限事实。
本批改变的等待/错误呈现、Web fresh read、scope fencing 与翻译均单列为治理/本地化
适配，不能笼统说两个文件与官方 100% 相同。

全量台账边界保持：旧 `dd399` 比较点的 5314 union、1970 原 blob、115 已证共享、
0 整文件授权、3229 未证恢复队列不是当前 main 的功能缺失数。当前已提交 `8e3ac`
的 project filter/Issue/PR 只读详情不再计为完全缺失；本 Origin 批也不消除原写入、
Git、分享、Web 作者资料触发器等明确缺项。其余 Settings/Agents/Workflows/Mobile
历史队列仍须逐项核当前源码、对应版本截图与操作，不能从本批减几行就声称全量完成。

本批独立 i18n 输入 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/project-origin-i18n.mMdBKx`
是固定 `8e3ac789d6ceb12f23ba04f88a6dce8736a5160b` 加唯一 8 词条，原
`python3 tools/gen-platform-i18n.py` 与 `--check` 均退出 0（52519）；不混入 Cells 生成或
既有公共暂存删词。生成只在私有目录，不覆盖工作区 Dart。

首次 Web SDK 检查 95622 误早于私有文件复制终态，仅执行旧 21 项，被精确终止退出 137，
结果作废。复制 29975 退出 0 且 13 路径逐一 `cmp` 退出 0 后，原
`vitest run test/project-inbox.test.tsx test/projects-channels.test.tsx --pool=threads --no-file-parallelism`
在同 4 CPU/8 GiB SDK 执行 2201：30/30 通过、退出 0；记录
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-origin-shared-frozen.log`。
这些是实际 React 详情与目录校验消费者的隔离证据，不是线上项目数据或 SQL 授权证据。

Web 原 `vitest run src/platform/ui/PulsePane.test.tsx --pool=threads --no-file-parallelism`
首次 78136 退出 1（4 通过、3 失败）：撤权等测试等待 toast 后立即断言 DOM，早于
React Query 通知。保留原安全断言，仅用既有默认 `vi.waitFor` 等实际按钮消失，未改
生产或超时；94622 为 7/7、退出 0。私有反证 97351 分别只删除私密频道成员门槛、
将 Web 点击重读替换为热缓存：共享 13 通过/1 失败、Web 2 通过/5 失败，两个子进程
均退出 1。Web 其中一项因根本没有发起预期读取而没有生成测试 resolver，其 TypeError
不单独作为安全证明；其余实际 fresh-read 次数/拒绝失败断言均捕获破坏。
两生产文件还原且逐字 `cmp` 退出 0 后，43272 同套件共享 30/30、Web 7/7，均退出 0。
日志均在上述 Data 根，分别为 `project-origin-web-positive.log`、`project-origin-web-settled.log`、
`project-origin-private-negative.log`、`project-origin-fresh-negative.log`、
`project-origin-shared-restored.log`、`project-origin-web-restored.log`。

Desktop 原 `node --import ./test-loader.mjs --experimental-strip-types --test
src/features/platform/PulseScreen.test.mjs`（18361）退出 1，加载期
`ERR_MODULE_NOT_FOUND: @tauri-apps/api`，0 个业务断言执行。随后一次精确核查发现
原 `collaboration/pnpm-lock.yaml` 固定 2.11.1，既有只读
`/evidence/profile-settings-ortsoo.DRR20F/apps/collaboration/desktop/node_modules` 已有该包。
私有 Desktop 原链接只通向 Web 依赖，父层 `collaboration/node_modules` 不存在；仅在
私有父层链接该既有原依赖入口，不安装/复制依赖、不修改 loader 或原 Tauri 消费者。
同一原命令 30562 为 5/5、退出 0，新增两项实际 Native Host 通过原有界 metadata
读取与 `goChannel` 分别核 open 导航/private 非成员不导航，无写请求。日志
`project-origin-native-linked.log` 保留完整 210.47 秒耗时；首次缺包失败不抹去。
这是原调用链的隔离 fixture，不是 Windows 安装包/设备验收。

Core 与 Cells 共用一次原受限 SDK 编译窗口；联合输入只用于验证，提交范围仍分离。
原 `rustfmt --edition 2021` 退出 0，格式后 `platform_views.rs` Git blob 为
`585c85724a24635ca0e40a56e691152fb4134635`。在原 4 CPU/8 GiB SDK 的
`/evidence/first-byte-core.09N6oV/core` 执行
`cargo test --locked --offline -p platform-core discovery_channel_selector_keeps_legacy_cursor_and_rejects_non_uuid -- --nocapture`，
15114 第二段退出 0：1 passed、435 filtered out；41.26 秒复用首段编译结果，未另启编译。
日志 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/first-byte-final.LPEm6u/core-selector-final.log`。
该用例证明旧 cursor-only、合法单 ID 与非法 UUID 的解析边界，不替代下述实际 SQL
隔离验证或 Core HTTP 联调。私有候选 `git diff --cached --check` 退出 0；
本 Origin 批尚未运行规范整端类型检查、全量门禁或新版视觉验收。

主线补充原 SQL 实证：`discovery_rows` 的 SELECT 直接从正式 Rust 字符串提取，
在既有隔离 `kailo-installation-scope-pg-e4agxd`（2 CPU/1 GiB、Data 存储）的
`kailo_human_reader_20261010` 使用原 `psql -X` 事务执行，不碰生产库/不迁移。
53600 为 9 PASS、退出 0、ROLLBACK：旧目录、有界 open、private 成员、private 非成员、
跨租户、未知 ID、binding 停用、重读时撤权及 Workspace 暂停。私有 SQL 流只去掉
`w.tenant_id = $1 and`，92845 退出 3（`expected 2, got 3`）；错误断开且未 COMMIT。
恢复原流 89179 为 9 PASS、退出 0、ROLLBACK。正式文件在三轮检查中 SHA-256 都是
`91dbb29357ee47e561e710071e26da5b2ea01b3f990117d4dad09683584651b2`。
证据 `/volumes/data/kailo/tmp/project-origin-sql.1KllbW/receipt.md`、`positive.log`、
`negative.log`、`restored.log`；正向/恢复摘要同为
`b3f8817ff52b82bdb2bccd564342af722deeadfae5f117da079c6398a9d493cf`。
先前只读探测缺 PG 环境变量报 `role root does not exist`，改用该实例原 postgres OS
用户后完成；另一无表旧 DB 未用于本验证。这仅证明真实 PostgreSQL 选择器边界，
不证明 Core HTTP、SSO、SpiceDB、Relay、投影竞态或生产就绪。

## 实际验证与失败记录

私有输入 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-inbox.u115Eo`；原 SDK `kailo-web-thread-tooltip-sdk`，4 CPU/8 GiB，Data 缓存，未新建镜像或 builder。
Core 输入 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/project-inbox-core.20LvpK`；原 SDK `kailo-cells-closure-kxbrvt` 同样 4 CPU/8 GiB，复用原 Cargo 缓存，主线 full 起动前已释放 Cargo。

- `node node_modules/typescript/bin/tsc --noEmit`（Web）：exit 0。使用现有 Web TS 6 缓存，不替代规范全仓冻结依赖 typecheck。
- `vitest run test/project-inbox.test.tsx test/inbox.test.ts test/projects.test.tsx --pool=threads --no-file-parallelism`：80/80，exit 0。旧原组件 act warnings 保留。
- `vitest run src/platform/ui/InboxPane.test.tsx --pool=threads --no-file-parallelism`：29/29，exit 0；实际选择原任务通知，打开完整正文，写 `msg:<id>` 而不调用 Workspace 导航。
- 最终真实父 Inbox 加入项目读取取消消费者；身份/刷新离开后不继续旧项目活动页。末次聚合会话 71327：Web tsc exit 0、Web Inbox 29/29、项目读链加取消用例后 7/7，聚合 exit 0。
- 私有输入仅移除 bindingVersion 检查：新套件 5/6，exit 1，拒绝 generation 变化用例捕获；还原并逐字 cmp，6/6，exit 0。
- `rustfmt --edition 2021` 两个 Core 文件：exit 0。`cargo test --offline --locked --manifest-path core/Cargo.toml -p platform-core --bin platform-core projects::tests -- --nocapture`：5/5，exit 0；同入口 `user_state::tests`：2/2，exit 0。
- `cargo clippy --offline --locked --manifest-path core/Cargo.toml -p platform-core --bin platform-core -- -D warnings`：exit 0。
- `node --test --experimental-strip-types --test-name-pattern="Projects query" test/roundtrip.test.ts`：1/1，包含旧视图与两个新枚举，exit 0。
- `python3 tools/gen-platform-i18n.py`：exit 0，沿既有词条投影生成 Dart；没有手写第二套翻译。

初轮保留：抽取 PR JSX 的残余闭标签、遗漏 UserAvatar 必需属性各使 tsc exit 2，已修正；PR 更新夹具误用小写 e 使 79/80，修为固定原语义后通过；Web 检查最初点了非交互容器而不是原 row button，28/29，修正实际按钮选择器和原 seconds 字段后通过。Core 私有快照漏原 buzz-core/schema/registry 输入曾 exit 101，补回固定 HEAD 原依赖后通过，未改 build.rs。Web SDK Dart 格式化因只读根 `/.dart-tool` exit 255，改用已有缓存投递正确的 Cells SDK 原生成器通过，未改 HOME。

### 独立四侧生成收口

私有输入 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/project-contract-final.J4BW5R`；
复用原 `kailo-cells-closure-kxbrvt`，实际 4 CPU/8 GiB、memory+swap 同限额、
UID/GID `1000:1000`，源码与缓存均在 Data。生成基底之后的主线提交不改本批
schema/生成输入，最终候选精确重放到最新主线，不反向覆盖其它提交。

- `npm_config_cache=/cache/npm bash tools/gen.sh`：session 16634，exit 0，四侧全部生成。
  原 npx 因不可联网出现 `EAI_AGAIN` 后使用既有缓存继续；没有新装 SDK、
  重启生成或手改生成物。四侧完整差异仅为本批说明、两个查询枚举及生成器的
  等价枚举编码；当前主线的 `bindingDigest` 保留。
- 同一次原生成产生的 Dart `platform_text.dart` 与本批精确翻译候选逐字相同；
  `reason_text.dart` 与 HEAD 逐字相同，两项 `cmp` exit 0。
- `node --test --experimental-strip-types --test-name-pattern="Projects query" test/roundtrip.test.ts`：
  当前独立生成输入 1/1，exit 0。
- `dart pub get --offline` 后
  `dart test test/roundtrip_test.dart --name "Projects query preserves"`：session 1838，
  1/1，exit 0；使用原缓存，没有获取网络依赖。
- `GOCACHE=/evidence/project-contract-final.J4BW5R/go-build go test ./internal/contracts -run '^TestProjectsQueryRoundtrip$' -count=1 -v`：
  session 59165，1/1，exit 0；缓存与主线 full、Cells 原生 Go 检查各自独立。
- 初轮未运行 Rust 新增枚举往返：主线 full 89963 占同一 `/cache/rust-target`。
  后续核实已有独立 `/cache/secret-target` 空闲，在同一原 4 CPU/8 GiB SDK
  执行 `CARGO_TARGET_DIR=/cache/secret-target cargo test --offline --locked --manifest-path core/Cargo.toml -p contracts --test roundtrip projects_query_keeps_scoped_coordinates_and_optional_window -- --exact --nocapture`：
  session 76095，1 passed/0 failed/50 filtered out，exit 0，编译 1m11s。
  使用此前已包含真实 workspace 依赖的私有 `project-inbox-core.20LvpK`，
  仅同步冻结的 contracts 生成物、往返源码与原 schema/sample；生成 Rust 与
  往返源码逐字 `cmp` 为 0，Cargo 清单/锁与当前 HEAD 一致，旧基底到当前
  HEAD 的原 samples 没有改动。检查启动时剩余原样 schema/sample 复制尚在
  等待 I/O，此事实保留；没有修改被验生成物、用例或样本期望以获取通过。
  此检查不使用 full target，也不以此前 Core 5/5、2/2 替代契约往返。

本批完整规范全量检查尚未完成，没有部署、运行时真实项目通知验收、新版截图或 Windows 安装包验收。
前置实际失败截图仍是在线 `9d718234b74b688d9b81816f9b67470d4fc80440` 的 `10-inbox-filter.png`（路径见本次 baseline-build 视觉段），不能把旧图标记为本批通过。

### 同批原详情文案与时间格式纠偏

固定官方 `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::PullRequestCommitRow`
与 `desktop/src/features/projects/lib/projectsViewHelpers.ts::formatExactTimestamp`
是本次依据。共享 commit 行复用本批已有 `projects.commit.authored` 词条，不新增
另一翻译来源；时间格式恢复官方原 `year/month/day/hour/minute/second` 六项 options，
只保留已授权的 `getLocale()` 中英文选择。两宿主仍消费同一模块，不改调用权限、
持久状态、事件读取、排序、未定义值行为或写入准入；来源/分享/Git 等缺项仍见上表。

2026-10-11 17:39 UTC，在原 `kailo-web-thread-tooltip-sdk` 确认仅 sleep 空闲后，
复用 4 CPU/8 GiB、memory+swap 同限额、UID/GID 1000:1000 与 Data 私有输入；
cgroup 读回 CPU `400000 100000`、memory `8589934592`。本批既有平台生产输入
与冻结 `360b2048416f4447e161bdbd78a8a09bd1841f0d` 逐文件 cmp 0 后，
仅复制两处修正及原 project-inbox 套件扩展。

`node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --pool=threads --no-file-parallelism`
session 44464 实际 exit 1，62.92s：`Failed to start threads worker` /
`Timeout waiting for worker to respond`，no tests、0 个断言执行。
原日志 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-inbox-presentation-positive.log`。
该次未增加超时或循环重跑；正向未执行时没有进行私有破坏或记 PASS。
源码复核随后补正新增用例：先点击原默认折叠的 Commits 再断言实际行。
17:48 UTC 主线释放同一 SDK 后，末版输入对冻结候选逐字 cmp 0，沿同一命令
执行 session 29453：9/9、exit 0，14.66s；日志 `project-inbox-presentation-final.log`。
之后只在该私有输入分别破坏两处真实生产对象，不修改正式源码或检查期望：

- 退回硬编码 `authored`，同套件加 `-t "keeps the original PR commit"`，
  session 15237：中文断言收到 `authored` 而期待 `提交`，1 failed/1 passed/7 skipped、exit 1；
  日志 `project-inbox-attribution-negative.log`。
- 恢复词条调用后，仅去掉官方时间 options；同一过滤命令 session 74206：
  英文收到 `1/1/1970` 而期待 `Jan 1, 1970`，中文收到斜线日期而期待年月日格式，
  2 failed/7 skipped、exit 1；日志 `project-inbox-timestamp-negative.log`。
- 两处生产源码及末版检查均与冻结候选逐字 cmp 0 后，原完整套件 session 82524：
  9/9、exit 0，2.42s；日志 `project-inbox-presentation-restored.log`。

上述日志均在 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/`；最初 worker
启动失败仍保留，不改记通过；两轮实际正向与两项定向反证不替代全量门禁。
没有新版部署/截图，不能用前批 7/7 或旧线上图片替代本次两处修正验收。

### 项目正文原样式投递纠偏

2026-10-11，本批基底 `3bb40e0adeac5a9f3d436adbcc87c1c3d28fffde`。
权威为用户原版一致性要求及固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/projects/ui/ProjectRichContent.tsx::ProjectRichContent` 将默认
`text-sm` 或调用方 className 直接传入原 Markdown；
`desktop/src/features/projects/ui/ProjectIssueCommentTimeline.tsx::ProjectIssueCommentTimeline`
使用 `mt-1 text-sm text-foreground/90`，
`desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::ProjectPullRequestDetail`
使用 `text-sm text-muted-foreground` 呈现更新正文。
原 `desktop/src/shared/ui/markdown.tsx::MarkdownInner` 与
`desktop/src/shared/lib/cn.ts::cn` 在正文元素合并这些类，消除字号/颜色冲突。

影响面检索确认共享 `ProjectRichContent` 原先只给新增外层 div 设置样式，
真正 Web `MessageContent` / Desktop `Markdown` 保留自身的 `text-message` /
`text-foreground`，属于缺失需恢复，不是已授权治理差异。本批去掉这层外壳，
通过既有 `PulseHost.renderContent` 的第三个可选 className 参数投递两宿主。
默认字号、评论/更新样式归原样保留；同一组件与参数传递归共享迁移；Web BFF
媒体解析和 Desktop 原媒体/tag 适配属于已有授权接缝，本批没有改动。
原 `ProjectCommitDetailPanel` 的 Git 读取及 `hardLineBreaks=false` 消费者仍未接入，
继续列为缺失需恢复，本批不预建无消费者选项，也不改变全量台账的证明范围。

副作用及异常核对：仅展示参数，无契约、数据库、正文存储、事务或执行状态变更；
两参数 Pulse 调用保持原行为，undefined 使用原 `text-sm` 默认值，空字符串仍原样传递。
两宿主的 query/publish/startDm、scope 失效、媒体授权、链接导航均未变更；
不产生新动作或 UNKNOWN 到成功/失败的转换，06 §4 六类错误沿原消费者处理。
Mobile 无本次消费路径，没有新增页面或宿主入口。

复用原 `kailo-web-thread-tooltip-sdk`，实际核验仅 sleep、4 CPU/8 GiB、
memory+swap 同限额和 Data 挂载后，以固定基底加本批六文件私有输入验证。
没有安装依赖、新建镜像、提高超时或启动 full。证据目录：
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-rich-content.7UYjw7/`。

- 96050：Web `node node_modules/typescript/bin/tsc --noEmit` exit 0；
  `node node_modules/vitest/vitest.mjs run src/platform/ui/PulsePane.test.tsx --pool=threads --no-file-parallelism`
  10/10、exit 0；Desktop `node --import ./test-loader.mjs --experimental-strip-types --test src/features/platform/PulseScreen.test.mjs`
  8/8、exit 0。原 Web act 警告保留，完整输出在 `positive.log`。
- 检查使用真实 `ProjectRichContent`、两端实际 Host 与原 Markdown，不再 mock Web
  MessageContent。三种 className 均检查 `.message-markdown` 本体的字号/颜色、
  没有冲突类、真实粗体和链接；不是只断言外壳存在类名。既有 DM/来源消费者继续执行。
- 54090：仅私有共享组件退回旧外层 div；上述 Web 命令加
  `-t "passes original project rich-content"`，3 failed/7 skipped、exit 1；
  Desktop 原命令加 `--test-name-pattern="Native original project rich-content"`，
  3 failed、exit 1。均实际捕获正文缺少 `text-sm`，日志 `mutation.log`。
- 还原后六文件与正式源码逐字 cmp 0；70761 运行原完整两套件，Web 10/10、
  Desktop 8/8，均 exit 0，日志 `restored.log`。本批定点 `git diff --check` exit 0。

本批没有部署、新版浏览器截图、Windows 安装包验收或 full 门禁通过；
现网旧 `9d718234b74b688d9b81816f9b67470d4fc80440` 截图不认领本次修复。

### Inbox 原日历时间呈现恢复

本批基底 `f35b70a8329a91ef02cb0151e6ebac46d72a3217`，固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/home/lib/inbox.ts::formatInboxTimestamp` 直接消费
`desktop/src/shared/lib/datetime.ts::formatItemTimestamp`：当天时分、昨日、周内星期、
同年月日和跨年月日年，而非管理面“几小时前/几个月前”。Web 原有项目行与频道/DM 行
调用 `relativeTime` 是未授权呈现差异。本批两处均改用既有共享
`client-kit/ts/platform/src/react/messages/datetime.ts::formatItemTimestamp`，
不重写 formatter；Desktop 既有同名薄转发保持不变。

四步核对：权威为原版恢复要求与上述固定源码；影响面只有 Web 两个真实 InboxRow
时间参数、既有检查和本回执，无 schema、数据库、排序或读账本变化。共享 formatter
沿原本地日界与 `calendarDaysBetween` 处理跨日，语言取既有 `resolveLocale()`，
中文默认/英文适配属于已授权差异。日历规则归原样保留，同一已存在 formatter 的
实际调用归共享迁移；本批没有新治理分支。空列表、读失败、scope/generation 失效、
背压及 UNKNOWN 仍由原读取链处理，不改变 06 §4 错误分类，也不产生外部副作用、
并发写入或新的待收敛状态；Mobile 无本次入口。原 Git、Issue/PR 写操作及尚未接入
资料触发器的任务行仍缺失；已有项目创建/删除和 PR/评论资料消费者不归为整体缺失。

复用已完成且六文件逐字核对基底的私有输入 `project-rich-content.7UYjw7`，仅投递
本批两个 Web 文件；原冻结 index/日志未覆盖。实际检查原 SDK 仅 sleep、
4 CPU/8 GiB、等额 swap 和 Data 挂载后运行，无新镜像/依赖/大导出。
本批日志目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/inbox-calendar-closure/`。

- 5034：`node node_modules/typescript/bin/tsc --noEmit` exit 0；原 Inbox 套件
  37 passed/11 failed，exit 1，保留 `positive.log`。夹具先设英文再清 storage，
  导致真实共享 formatter 正确回到默认中文；另有 jsdom 缺 `scrollIntoView`。
  仅纠正两处夹具初始化顺序及还原式 DOM 方法投递，未改生产语言或断言期望。
- 90811：上述 tsc exit 0；
  `node node_modules/vitest/vitest.mjs run src/platform/ui/InboxPane.test.tsx --pool=threads --no-file-parallelism`
  48/48、exit 0，6.34s，日志 `positive-fixture.log`。项目与频道真实行各执行
  当天/昨日/周内/同年/跨年、中英共二十组，检查实际时间 span；原详情、预览点击、
  精确读标记与不得外跳断言保留，不 mock formatter。
- 2307：只在私有 `InboxPane.tsx` 恢复旧 `relativeTime` 两调用；上述命令加
  `-t "calendar timestamp"`，20 failed/28 skipped、exit 1，日志 `mutation.log`。
  实际中文跨年收到 `16 个月前`，原规则期望 `2025年6月20日`，两行均捕获退化。
- 还原两个文件与正式源码逐字 cmp 0；69972 原完整套件 48/48、exit 0，
  6.10s，日志 `restored.log`。原 act 警告保留，不提高检查超时。

本批为源码恢复与定向消费者证据；未部署、未做对应新版浏览器截图或 Windows
安装包验收，未重跑 full。已有旧部署图片不能认领本批日历时间修复。

### Inbox 打开原任务/审阅的精确项目目标

基底 `a3923f375435e31f587b703c1f72f9eb35825849`；固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批恢复的是具体目标的原只读
详情分支，不是完整 `ProjectDetailScreen` 或完整项目功能验收。

四步变更核对：

1. 权威为 REQ-24 原版恢复和 DD-72/75 的 Web BFF/原生本机身份边界。
   官方 `desktop/src/features/home/ui/ProjectInboxDetailPane.tsx::ProjectInboxDetailPane`
   的 `onOpenProject`/`openLabel` 原按钮、`useElementWidth` 和 760px 宽窄规则
   直接进入共享原组件；`desktop/src/features/home/ui/ProjectInboxDetail.tsx::ProjectInboxDetail`
   原调用传递 project、repository 和互斥 issue/PR 引用，不以跳公告代替。
2. 影响面是共享 `ProjectInboxDetail`、`ProjectsView`、目标解析、既有尺寸 hook、
   双宿主原导航/search/详情接线与同源词条。复用原 `ProjectIssueDetail`、
   `ProjectPullRequestDetail`、`loadProjectWorkItems` 和 Pulse 资料/正文宿主；
   没有新增治理 schema、数据库、资源权威或工作项写操作。三个 search 字段只是
   原页面导航引用，旧无字段链接仍进原目录。Desktop 原 hook 路径薄转发同一函数。
3. URL 不当授权：目标页重读现有有界目录与仓库历史，project/repository/互斥类型
   全部匹配才显示正文；不从 Inbox 热缓存冒充 fresh 授权。scope 切换销毁旧查询，
   fresh 失败隐藏正文、保留原错误态；URL 引用可保留，不自动跳公告掩盖失败。
   原用户资料/来源频道仍由各自真实宿主核验，不把项目可读等同频道消息可读。
4. 空目标沿原目录；缺仓库、双类型、未知目标或读取失败不落到其他详情。原读取的
   generation、主体、分页与中止校验保持；没有外部副作用、幂等写入或新增待终结
   状态，06 §4 分类不变。Mobile 本批无新页面入口。

四类差异逐项范围：原按钮文案、ExternalLink、ghost/size/title/aria-label、
宽窄规则及 `desktop/src/shared/hooks/use-mobile.tsx::useElementWidth` 函数语义
原样保留；共享 hook 和原详情两端消费归共享迁移。Web BFF/Native Relay 有界读取、
导航引用重新校验和中英词条属于已有授权接入差异。仅复用官方
`desktop/src/features/projects/ui/ProjectDetailScreen.tsx::ProjectDetailScreen`
的滚动容器与 `ProjectWorkspaceTabs.tsx::WorkspaceTabs` 选中只读详情分支；
完整 `ProjectDetailChrome`、`WorkspaceTabs`、`ProjectCommitDetailPanel`/Git diff、
Issue/PR 评论及状态/分派/合并写操作仍归缺失需恢复，不生成空标签或假写按钮。
既有项目创建/删除、`ProjectProfileIdentity.tsx::ProfileAuthorName` 与
`ProfileIdentityButton` 的 PR/评论资料实际消费者不再泛称全部缺失。

本批复用原 `kailo-web-thread-tooltip-sdk`：4 CPU/8 GiB，memory+swap 总限额等于内存
（无额外 swap），源码/依赖与
TMPDIR/npm cache 均在 Data。基底六个原详情/宿主依赖逐字 cmp 0 后只更新本批
源码输入；原 Reminder index/patch/日志保留。日志统一位于
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-open.LdrqIc/`。

- 92082：规范共享 TypeScript 5.9.3 `tsc --noEmit` exit 0；原四套件 97 pass/
  5 fail、exit 1，`shared-positive.log`。新增检查误用原错误/加载态同样具有的
  `data-project-detail-panel`，不代表真实正文；纠正为原 Issue/PR 具体 testId，
  保留正文、实际回调、fresh 读取、错目标与撤权断言，不改生产错误态。
- 92498：`tsc --noEmit -p tsconfig.test.json` exit 0；原 ProjectInbox 19/19
  exit 0；Web `tsc --noEmit` 和原 `platform-navigation.test.tsx` 26/26 exit 0。
  Native 首轮 TS1128 发现机械移动 hook 后残留 return/括号，删除该残留；90533
  原 Desktop `tsc --noEmit -p tsconfig.json` 最终 exit 0。原始失败日志保留。
- 19840：只在私有 `ProjectInboxDetail` 断开原按钮 onClick；原 19 项中 17 pass/
  2 fail、exit 1，`click-mutation.log`，实际回调 0 次，两个原目标均不能打开。
- 正式字节还原 cmp 0；85932 原
  `vitest run test/project-inbox.test.tsx test/projects.test.tsx test/reminders.test.tsx test/message-row.test.tsx --no-file-parallelism`
  102/102、exit 0，`shared-restored.log`。覆盖项目精确目标 19、原目录 57、
  同批提醒 9、消息行 17；React act 警告保留，无超时扩展。
- 57824：原 closure 的独立 HEAD 加本批两词条小输入执行
  `python3 tools/gen-platform-i18n.py` exit 0；日志
  `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/project-open-i18n.aqPAH3/generation.log`。
  仅提取生成 Dart 的两个 enum/两条消息，不覆盖公共历史暂存词条，reason 文件
  无增量；没有修改 HOME、四侧合同或其他队友的生成输入。
- 原只读 `bash tools/check-docs.sh /workspace/.design`：58940 exit 1，唯一失败
  为同时在制 Gateway 文档的禁用措辞；owner 精确纠正后同容器 2389 exit 0。
  两原件为 `/volumes/data/kailo/tmp/project-open-docs.mDbTgP/{check,restored}.log`；
  实际 2 CPU/2 GiB，memory+swap 总限额等于内存（无额外 swap），无网络、UID 1000，apps/design 只读且缓存/tmp
  位于 Data，无全仓导出。这是当前工作树 top/docs 与设计门禁，原脚本不逐行
  检查 core/verify 等 receipt 子目录，不冒称固定候选或全量发布检查通过。

本批没有部署、安装包或对应新版浏览器截图；现网 9d718 的图片不能认领上述改动。
这只是源码/隔离 DOM/路由定向证据，不是实际 BFF/Relay 端到端或完整原版恢复。
未重跑全量，已有 full 失败和发布阻断保持。

### 原 Tasks/Reviews 列表与精确详情返回链

基底 `c4ea0957896b292b220d1823ad580deaa918faf8`；固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批恢复全局 Projects 的原
Tasks/Reviews 列表实际消费者，不是完整仓库详情、全部筛选或全部项目功能。

四步变更核对：

1. 权威为 REQ-24 原版恢复及 DD-72/75 双宿主边界。固定官方
   `desktop/src/features/projects/ui/ProjectsToolbar.tsx::ProjectsToolbar`、
   `ProjectsIssuesList.tsx::ProjectsIssuesList` 与
   `ProjectsPullRequestsList.tsx::ProjectsPullRequestsList` 的原分类、网格/列表、
   项目分组、作者入口及精确详情调用直接进入共享主体，不新造页面布局。
2. 实际读链复用 `loadProjectWorkItems`，沿既有有界 Project/Repository/Issue/PR
   查询读取；Tasks/Reviews 两类仅在宿主有实际目标导航时开放。原 repository
   `id` 是 owner/dtag，不是带 kind 的 `repoAddress`；两端传相同 project、
   repository 与互斥工作项引用到已恢复详情。原 `buzz.projects.filter` 保存分类，
   宿主原历史返回后恢复该分类；没有新合同、服务、数据库或业务写入权威。
3. URL、作者与缓存均不充当身份：正文和列表 fresh 查询失败立即不显示旧内容，
   scope 变更取消/移除旧查询。资料宿主 viewer 来自当前已验证读结果的
   `viewerPubkey`。Web/Native 普通项目目录不挂完整 Pulse；资料宿主只在真实
   工作项内容挂载，composer 人目录读取移至真实 composer 子组件。Web 不再
   让无关本人 profile 请求失败阻断只读列表；Native 工作项资料宿主保留原
   scoped session 读取，DM 仍用原 fresh session 准入。异步导航 Promise 两端
   实际向上传回，拒绝显示原错误而不自动重发。
4. 空列表沿原空态；不存在/跨 scope/撤权目标仍走既有错误态，不能落到项目公告。
   读取期间不渲染旧正文，查询分页、主体及 generation 校验保持。未引入外部
   副作用、持久状态、重试账本或 UNKNOWN 转成功逻辑，06 §4 分类不变；Mobile
   只沿原词条生成路径更新，无本批新页面。并发卸载后的导航拒绝不回写旧视图。

固定源码四类映射：

- 原样保留：上述两列表的行/卡片布局、原分组与渐进挂载；
  `desktop/src/features/projects/ui/ProjectEventTypeIcon.tsx::ProjectEventTypeIcon`
  的原图标映射；`projectGridCardStyles.ts::PROJECT_GRID_CARD_BODY_CLASS` 两行
  原定义，两个真实列表共用。原 `desktop/src/shared/ui/card.tsx::Card` 本身输出
  div；此处 div 使用该默认类与原调用类合并后的最终类（覆盖背景、阴影、边框），
  不是新的卡片设计，也不归因于治理。
- 共享迁移：上述模块进入 `client-kit/ts/platform/src/react/projects/`；
  `desktop/src/features/projects/ui/ProjectAuthorIdentity.tsx::ProjectAuthorIdentity`
  保留原 Tooltip、禁重复 hover popover 和资料点击；
  `projectWorkItemGroups.ts::groupProjectWorkItemsByProject`、
  `desktop/src/shared/hooks/useIncrementalMount.ts::useIncrementalMount` 的实际
  分组/渐进消费两端同源。Web/Desktop 仅保留传输、资料与原导航适配。
- 已授权接入：BFF/本机 Relay 有界读取、fresh 失败关闭、当前 viewer 投递与
  中文默认/英文适配。原部分段失败后保留可用段的加载方式不适用此原子治理读链，
  本批整次读取失败保持错误，不伪装部分成功或空列表。
- 缺失需恢复：原 selection→Agent 上下文、share link、Activity/Repositories
  分类、updated 排序和完整原加载视觉仍未闭合；完整
  `desktop/src/features/projects/ui/ProjectDetailChrome.tsx::ProjectDetailChrome`、
  `ProjectWorkspaceTabs.tsx::WorkspaceTabs`、`ProjectChannelHome.tsx::ProjectChannelHome`
  与 Git/CommitDetail 及工作项写动作依旧缺失。本批没有把原 Home 链接改为
  不可点击文字、没有七个空 tab，也不以两只读列表声称完整 Project 恢复。

检查沿现有 `kailo-web-thread-tooltip-sdk`，4 CPU/8 GiB，memory+swap 总限额
等于内存（无额外 swap）；源码、依赖、TMPDIR 与 npm cache 均在 Data。
没有新增镜像、安装包、全仓导出或全量编译。日志目录：
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/projects-lists.grYYl4/`。

- 60649 exit 1：共享生产/测试类型通过，原三套件 87 passed/5 failed；新增原
  toolbar 消费漏 jsdom ResizeObserver，按已有 Projects 夹具补齐，不改产品。
  原件 `platform-typecheck.log`、`test-typecheck.log`、`positive.log` 保留。
- 21972 exit 1：共享生产、共享测试、Web、Native 四项 `tsc --noEmit` 均为 0；
  原共享 88/92，四项期望误将 repoAddress 当 repository.id；固定官方
  `desktop/src/features/projects/projectModels.ts::eventToRepository`
  的 owner/dtag 原语义与既有解析消费者确认后只纠正期望。Web 11/12，新增目录
  消费缺 scrollIntoView DOM 夹具；只补原夹具方法。Native 因本次命令漏原
  `--import ./test-loader.mjs`，ERR_UNKNOWN_FILE_EXTENSION，未执行断言。
  对应 `*-final-typecheck.log`、`web-typecheck.log`、`native-typecheck.log`、
  `final-positive.log`、`web-positive.log`、`native-positive.log` 不覆盖。
- 28934 exit 0：共享测试类型与原
  `vitest run test/project-inbox.test.tsx test/projects.test.tsx test/pulse.test.tsx --no-file-parallelism`
  92/92；Web 原 `vitest run src/platform/ui/PulsePane.test.tsx --no-file-parallelism`
  12/12；Native 原
  `node --import ./test-loader.mjs --experimental-strip-types --test src/features/platform/PulseScreen.test.mjs`
  8/8。日志 `test-corrected-typecheck.log`、`corrected-positive.log`、
  `web-corrected-positive.log`、`native-corrected-positive.log`。
- 11863 仅私有输入断开列表 `onOpen` 委托；原 ProjectInbox 套件加
  `-t "list and exact detail"`，4 failed/20 skipped、exit 1，
  `navigation-mutation.log`。中英 Issue/PR 真正 overlay 按钮均未调用导航，
  断言实际捕获 0 次回调。正式字节还原且本批 20 个源路径逐个 cmp 0 后，
  16298 原三套件 92/92、exit 0，`restored.log`；包含最后原样式常量双消费者。
  实际作者按钮不触发行导航、正确 project/repository/类型、分类返回、撤权隐藏
  正文、Promise 拒绝只发生一次且不发布事件均有原消费者断言。返回为隔离 React
  宿主状态，不冒称真实浏览器历史或 BFF/Relay 端到端。React act 警告保留。
- 88929 原 closure 私有 HEAD 加 23 新 TS 词条，执行
  `python3 tools/gen-platform-i18n.py` exit 0。输入/输出位于
  `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/projects-list-i18n.hBOGap/`；
  Dart 仅 23 enum/23 消息共 73 新行，reason 无变化。原 public TS/Dart 历史暂存
  未覆盖，未变更 HOME、四侧合同、其他队友生成输入或工具版本。

本批没有部署或对应新版浏览器截图，现网 9d718 的原截图不能认领本批。
Windows/Mobile 安装验收及完整原版一致性未完成；原 full 失败门禁保留。

2166 原只读 `bash tools/check-docs.sh /workspace/.design` 实际 exit 0，七段全部
通过，日志 `/volumes/data/kailo/tmp/projects-lists-docs.IFl9mh/check.log`。
运行使用原检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
2 CPU/2 GiB，memory+swap 总限额等于内存，无网络、UID 1000、只读根及
apps/design 挂载；tmp/npm/node 缓存位于 Data。设计实际 HEAD 为
`87625ff0e45ae1d89567105591f60da04b98e8d8`。该入口覆盖当前工作树 top/docs 与
设计资料，不逐行检查 receipt 子目录，不冒称同一固定候选 full 或发布门禁通过。

## 原 Tasks/Reviews 分享链接与精确打开消费者

本批基于 `f29fc77d4f444ba0d11600ad2cb9e56bc4e983de`，固定官方仍为
`779af8886caae1317b4de962082429867ab61503`。只恢复原 Issue/PR 行菜单复制、
编辑器链接识别、正文打开及 Native OS 入站队列；不扩展项目写操作或 Git 读取。

四步变更核对：

1. REQ-24 原版恢复与 DD-72/75 双宿主边界：原
   `desktop/src/shared/lib/entityLink.ts::parseEntityLink`、
   `desktop/src/features/projects/lib/projectShareLinks.ts::issueShareLink` /
   `pullRequestShareLink` 与
   `desktop/src/features/projects/ui/CopyShareLinkMenuItem.tsx::CopyShareLinkMenuItem`
   决定链接格式和菜单，不另立 URL。原
   `desktop/src/shared/ui/markdown/entityLinks.tsx::EntityLinkAnchor` 决定原 chip、
   authored label 与 Tooltip 呈现；两端消费同一共享主体。
2. 完整调用影响为 Tasks/Reviews 原菜单 → 剪贴板 → 原 composer entity 识别 /
   Markdown remark 转换 → 双宿主 → `readProjectEntity` → 既有
   `loadProjectWorkItems` → 原 `goProject` / Web `navigation.openProject` →
   已交付的精确工作项详情。Native 同时恢复原
   `desktop/src-tauri/src/deep_link.rs::canonical_entity_deep_link`、
   `PendingEntityDeepLinks`、真实 Tauri command 注册及
   `desktop/src/shared/useEntityDeepLinks.ts::useEntityDeepLinks` 消费。
   无新契约、数据库或第二权限/执行权威。
3. URL 和 warm metadata 不授权。每次点击重新有界读取当前主体的项目、仓库和
   工作项，并核 exact repositoryAddress、Issue/PR 类型及 event ID；失败不转到
   公告或别的项目。Web 仍经 BFF，Native 仍用当前本机会话 Relay 读链。
   Promise 返回保留原导航失败；metadata 失败不展示旧标题，点击拒绝只报原错误。
   `interactive=false` 只渲染原 inert chip，不挂实际读宿主或触发查询。
4. 空、未知类型、畸形链接及不匹配目标不开假入口；重复 OS 投递沿原 FIFO href
   去重和逐头 ACK。身份切换清除旧队列；清除失败保持准入关闭，不读取/重调度，
   在途旧 scope 不 ACK。未登录时没有 AppShell 消费者，登录身份切换沿原清队列
   边界，不能宣称跨登录自动恢复导航。卸载中止读取；明确拒绝可移除已处理头，
   不等于导航成功。没有新持久状态、外部写入或 UNKNOWN 转成功，06 §4 分类不变。

本批四类差异：

- 原样保留：完整 `entityLink.ts` parser/builders、原
  `desktop/src/features/messages/lib/remarkEntityLinks.ts::remarkEntityLinks` 的正文
  转换、原行菜单图标/事件阻止规则、Issue/PR chip 的稳定 repo dtag 文本和原
  Tooltip 类；metadata 只影响原提示和可访问名称，不替换 chip 标题。
- 共享迁移：上述原模块进入 `client-kit/ts/platform/src/react/projects/` 与
  `react/messages/`；原 composer 节点真实消费同一 parser，原 Native Markdown
  仅保留宿主适配。原 Rust parser/queue 进入当前原 Tauri 注册路径，不是孤儿文件。
- 已授权接入：原查询改接既有 fresh scope 读链，Web BFF / Native 本机传输，
  当前身份队列屏障及中文默认/英文词条；不按链接 owner 推导当前用户。
- 缺失需恢复：repository/project/Git/commit 链接仍无完整执行消费者，正文保持
  inert，OS handler 不启用这些分支。完整 ProjectDetailChrome、WorkspaceTabs、
  ProjectChannelHome、selection→Agent、Activity/Repositories 分类、updated 排序、
  工作项写操作和 Mobile entity 导航依旧未闭合。前节“share link 缺失”只在本节
  Issue/PR 已实际验证的消费者范围内更新，不声明全项目分享或完整原版恢复。

检查仍用原 `kailo-web-thread-tooltip-sdk`，4 CPU/8 GiB，memory+swap 总限额
等于内存（无额外 swap）；输入、依赖、TMPDIR 和 npm cache 均在 Data。没有新
镜像、依赖安装、全仓导出或冷 Rust 编译。日志目录为
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-share.Qrh78R/`。

- 95894 实际 exit 1，`positive.log`：共享生产类型 0、测试类型 2（issue 已收窄
  后的冗余 PR 分支）、共享 25/27（夹具未传原 `onSelectedProjectChange`，真实
  页面因而不开放 Tasks/Reviews）；Web 类型 2（原 Pulse Origin 夹具缺新增
  必需导航回调），原 MessageContent 30/30；Native 类型 0，原 deep-link /
  composer 两套件 61/61。只纠正真实夹具和死分支，不改生产门禁或超时。
- 73770 原 closure 独立 HEAD 加 8 个同源词条执行
  `python3 tools/gen-platform-i18n.py`，实际 exit 0。输入输出位于
  `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/project-share-i18n.l9vfvT/`。
  Dart 仅提取本批生成增量，保留原公共三项暂存及工作树历史词条；不改 HOME 或
  四侧合同生成。

Rust 原 parser/队列金样本已恢复到原测试模块，但本批未编译/执行 Rust，不以
Native TypeScript 或金样本文件存在替代。没有新部署、Windows 安装或对应新版
浏览器截图；现网 9d718 不能认领本批，完整 full 失败门禁仍保留。

末版集中结果：

- 79181、4948 正式/私有 27 个源码路径逐个 `cmp` 实际 exit 0；后者包括反证还原
  和最后 Rust 机械格式整理。i18n 私有输入是上述 HEAD 加本批 8 词条，不包含
  原公开暂存删词。受限 SDK 运行前实际仅 sleep，4 CPU/8 GiB、Data 挂载，
  MemAvailable 约 34 GiB；I/O full avg60 约 50%，没有新增冷编译。
- 95626 实际 exit 0，`final-positive.log`：共享生产/测试、Web、Native 四项
  `tsc --noEmit` 全为 0。共享原 `test/project-inbox.test.tsx` 28/28；Web 原
  `MessageContent.test.tsx` 31/31 与 `PulsePane.test.tsx` 12/12；Native 原
  `deep-link.test.mjs` / `composerMessageLinkNode.test.mjs` 62/62。Vitest 使用
  `--no-file-parallelism`，Native 仍为
  `node --import ./test-loader.mjs --experimental-strip-types --test`；没有改超时。
  新增实际消费者证明原行菜单复制精确 URL，原 composer 接受该链接，shared
  exact-detail 导航成立；Web 真实 Markdown/BFF host 重新调用 queryProjects，
  撤权后只拒绝一次且不导航，inert preview 零读取。BFF 响应为隔离夹具，不能
  写成真实 Core/Relay 请求、OS shell 或浏览器历史验收。
- 47009 私有副本仅断开 `EntityLinkAnchor` 向真实 `onOpen` 的委托：共享两个
  分享用例均失败、Web BFF 消费者失败，均捕获 0 次导航，实际 exit 1。
  原日志 `navigation-mutation.log` 中 `SHARED_MUTATION=1 WEB_MUTATION=1`。
  正式字节还原后 18075 实际 exit 0，共享 28/28、Web 43/43，见 `restored.log`。
- 原 `rustfmt --edition 2021 --config skip_children=true --check` 对三处实际 Rust
  文件首次 exit 1，`rustfmt.log` 保留长行/import 及 HEAD 模块顺序差异。只作机械
  整理（含 lib.rs 既有 initial_window/key_backup 两行排序），18075 同一命令
  `RUSTFMT=0`。这是解析格式，不是 Cargo 编译或原金样本执行。

原 React act 与 jsdom Canvas 警告完整保留；本批不据局部成功改变部署、整端或
完整 full 的未验收边界。候选重基 `0e8055cfd03d4149fc536b00e393499b6c47e98c`，
仅主线两个不重叠的 Core 文件已推进，本批已验证源码字节不变。

主线合批文档检查 73586 实际 exit 0，七节全部通过；原始日志为
`/volumes/data/kailo/tmp/share-observe-docs.gvKsJg/check-docs.log`。复用固定 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
2 CPU/2 GiB、无额外 swap、UID 1000、network none、只读 apps/design，
缓存和临时目录均为 Data。实际命令为 `bash tools/check-docs.sh /workspace/.design`。
该脚本检查当前 top/docs 与设计资料，不逐行检查本回执，也不是固定发布树的
`check.sh --full`；本段补记不触发另一轮相同全局检查。

## 2026-10-12 原任务/审阅详情分享按钮恢复

本批基准 `2e6973daea764b3d447c894f54773c5a9cb0e765`，固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503`。此前分享菜单与打开链已经成立，
但详情标题里的原按钮仍缺；不能把菜单已恢复等同所有原分享入口均恢复。

四步变更结论：

1. 权威为 REQ-24 原版恢复和 DD-72/75 双宿主边界。直接迁移官方
   `desktop/src/features/projects/ui/ShareLinkButton.tsx::ShareLinkButton`，
   按 `desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail`
   与 `desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::PullRequestDetailHeader`
   的原调用位置接入，不设计新的标题、菜单或 URL。
2. 两个共享详情同时由 `ProjectInboxDetail` 与
   `ProjectsView.tsx::ProjectWorkItemPage` 消费，Web/Desktop 复用同一主体。
   原 `issueShareLink` / `pullRequestShareLink` → `PulseHost.copy` → 两宿主现有
   剪贴板适配；打开仍复用前节实际 fresh 项目/仓库/事件匹配链。本批没有新增
   契约、Core 状态、权限、工作项写入、i18n key 或持久数据。
3. 原图标、标题内位置、class、Tooltip、复制成功后 Check、两秒反馈及卸载
   timer 清理均保留。授权适配逐项为宿主剪贴板与既有同源中英文词条；
   宿主拒绝时不增加 toast，也不把失败渲染为已复制。成功提示复用现有
   `video.linkCopied`（英文为 “Link copied to clipboard”，官方为 “Link copied”），
   这是既有共用反馈词条适配，不宣称提示文案逐字原样。
4. 原构造器返回 null 时不生成按钮；拒绝不显示成功勾、不自动重试；重复成功
   仍按原 timer 替换语义。剪贴板不是项目读取授权，链接不携带凭据，既有
   撤权/错 repository/未知事件的拒绝与历史引用规则不变，无新增错误分类。

实际验证复用 `kailo-web-thread-tooltip-sdk`，启动前只有 sleep；4 CPU/8 GiB，
memory+swap 总限额等于内存（无额外 swap），可用内存约 36 GiB，I/O full
avg60 约 26.84%。仅向已验证 Data 私有输入投递本批四文件并逐个 cmp；
TMPDIR、npm cache 和依赖均在 Data，不改 HOME、不安装依赖或构建镜像。
原输入中 client-kit 在 dd65 与本基准之间无源码变化；旧候选/日志保持不改。

在原 `client-kit/ts/platform` 目录执行：

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --no-file-parallelism
```

17335 实际 exit 0：TypeScript 5.9.3 两项通过，原套件 29/29。两个已有分享
用例继续实际复制菜单→原 entity 解析→fresh 读取→精确详情，并新增在真实详情
标题点击原按钮、核精确链接、原 class 及成功/两秒恢复断言；新增一个 null
和拒绝消费者，中文默认标签也已核对。夹具不是实际 Core/Relay 或 OS 剪贴板。

私有副本只把 `copy(link)` 改为无调用的 resolved Promise，76137 实际 exit 1，
3 个相关用例全部失败（copy 调用为 0），其余 26 个显式跳过。还原后 cmp 0，
99759 原完整套件实际 exit 0、29/29。原 React act 警告保留，未修改超时。
日志均在 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-detail-share.QNfj38`：

- `positive.log` SHA256 `f3f3e80f39c6df44eb1122543da1d4c1b91f463ae433287618fb2b004112ed93`。
- `mutation.log` SHA256 `20757c905a2c4e124e154b2945f393d820cf603faf7d1eb55af09cb5714cdfa8`。
- `restored.log` SHA256 `13245a19c2e71754b4401c89ce014f35533d071c285e8764595d4fff53678a2b`。

四类差异：原样保留按钮原布局/交互；共享迁移上述组件与两详情调用；已授权
适配仅上列宿主与词条；仍缺完整 Chrome/WorkspaceTabs/Home/Git、
其他 entity 类型分享、selection→Agent、工作项写入和 Mobile 实际消费者。
本批未部署，未拍新版截图、未运行 Windows/OS 或 full；旧 9d718 截图不得认领。

交叉复核纠偏：首版错误沿用菜单的错误 toast；固定官方
`desktop/src/shared/lib/clipboard.ts::writeTextToClipboard` 只有剪贴板调用，
并非另一个带 toast 的 helper。本批已删除新按钮错误 toast，拒绝只保持原图标，
消费者明确断言无 toast/无成功勾。14503 末版实际 exit 0，测试类型检查通过、
原完整套件 29/29；`no-toast-final.log` 保留原输出。首版三份正反日志未覆盖或
删去，不将首版呈现称为正确。末版只改此拒绝呈现，精确链接调用和反证点不变。

## 2026-10-12 原 Projects 目录多词搜索接线

基底 `1e4157c061c6df6972c0efe8783dd581dc797715`；固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/ui/ProjectsView.tsx::ProjectsView` 中
`visibleProjects` 消费
`desktop/src/features/projects/lib/projectsSearch.ts::matchesProjectsSearch`。
当前共享目录却使用整串 `.some(includes)`，跨项目/仓库字段或换序关键词会漏项；
本批只将该实际目录读消费者接回已共享的原 helper，不新增搜索算法或控件。

四步结论：REQ-24 要求原搜索行为；影响为原 `ProjectsSectionSearch` 输入和
deferred query → 同 scope 受权目录 → 共享 `ProjectDirectory` 筛选 → 原卡片
打开回调，Web/Desktop 共源。字段仍为项目名/描述及仓库名/描述，没有扩大数据
查询、缓存或授权。原 fresh 失败清空列表/详情不变，无新契约、状态、写操作或
错误分类。空词返回已有受权目录；多个 token 必须全部命中，顺序和大小写按原
helper 处理；任一缺失为原筛选空态，关闭搜索清除关键词，不重发读取请求。

四类记录：原样保留匹配算法、搜索 UI 和原字段；共享迁移补齐这一漏接调用；
既有 BFF/Native scope 治理没有本批增量；updated 排序仍依赖原 activity summary，
完整项目 Chrome/Git/写操作等前述缺项不因此恢复。

原 Web SDK 启动前仅 sleep，4 CPU/8 GiB、无额外 swap、Data 挂载；可用内存约
35.7 GiB，CPU pressure full 为 0，I/O full avg60 约 27.9%。仅更新原私有输入
的 `ProjectsView.tsx` 与 `test/projects.test.tsx` 并 cmp，TMPDIR/npm cache 沿
原 Data 路径。原命令为 `node node_modules/typescript/bin/tsc --noEmit -p
tsconfig.test.json` 后接 `node node_modules/vitest/vitest.mjs run
test/projects.test.tsx --no-file-parallelism`；未改原超时或执行池。

27489 实际 exit 0：TypeScript 5.9.3 测试类型通过、58/58 原消费者通过；新增
一项真实搜索链证明跨字段/换序/多空白/大小写、缺词空态、空词和关闭清除、
打开正确项目一次、查询不增加，以及 fresh 拒绝后正文清空。私有副本恢复原错
整串筛选，87557 实际 exit 1，新增项因目标卡片为 null 失败，57 项明确跳过；
还原 cmp 0 后 32629 原完整套件 exit 0、58/58。React act 警告保留。
日志目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/projects-search.LWqaSR`：

- `positive.log`：`858061ad9ee2d614411ec45ebd9975fd1b7f0b6d967731f34efa11e7f11d98a6`。
- `mutation.log`：`63f77c87e619b8ef0ecf26c01a8a2dd65a7e55e4d6f2ddbc2bc2be261f0b1295`。
- `restored.log`：`9f7962cadb84c670560350d3a950e21e7e18d487d36925058239cecbdb2514ee`。

本批未执行 docs/full、未构建部署、未截图或 Windows 验收；旧线上图不能认领
本批搜索。没有修改 i18n、Dart、公开暂存或其他治理模块。

## 2026-10-12 原项目首页频道、Overview 与返回导航

基底 `ab7c601970500bfd0f8cc5b6c05c1101d20ea2fa`。固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503` 的实际来源为：

- `desktop/src/features/projects/ui/ProjectChannelHome.tsx::ProjectChannelHome`；
- `desktop/src/features/projects/ui/ProjectHomeContextPanel.tsx::ProjectHomeContextPanel`；
- `desktop/src/features/projects/ui/ProjectHomeColumn.tsx::ProjectHomeColumn`；
- `desktop/src/features/projects/ui/ProjectContextRail.tsx::ProjectContextRail`；
- `desktop/src/features/projects/ui/ProjectDetailChrome.tsx::ProjectDetailChrome`；
- `desktop/src/app/AppTopChromePortal.tsx::AppTopChromePortal`。

四步结论：REQ-24 要求项目卡片打开原项目首页，不是自造公告侧栏。本批删除
该替代侧栏，将已受权项目的原频道、Overview Channels、开关/收起/拖宽、原
Projects 返回 crumb 接到共享主体。影响为 ProjectsView → ProjectChannelHome
→ 原 Web ChannelPane / Native ChannelScreen；不是另写聊天面。Web 传递原
PlatformApp 的线程、导航守卫、已读和身份消费者；根导航补齐 projectId 且无
repository/issue/PR 目标时的 thread history，不让工作项页误接频道线程。
Native 沿原 history hook、本机 identity、profile 和频道查询消费。

项目签名内的频道引用不授权读频道。共享层用现有目录读取当前 scope 的 ACTIVE
成员，相关频道点击重新读取；Web 另复用原 channel-descriptor key 前缀与 BFF
读取，原撤权失效通知会卸载频道。Native 同时核实际频道 id/type/member/archive
与本机 identity，不凭项目作者推导本人、不制造 archived 时间值。目录或频道
刷新中、失败、非成员、身份晚返回均不沿旧正文继续挂载；原错误态不表示成功。
scope/session key 变化销毁旧消费，原异步导航拒绝保留失败，不先改变本地选中。
无新契约、数据库、权限、写动作或错误分类；正文仍由原频道服务负责。

四类差异逐项说明：

- 原样保留：原 portal 目标、主页列/rail 样式、Overview toggle/折叠/拖宽，
  原 Channels 行及 clickable Projects crumb；没有重排原模块内布局。
- 共享迁移：上述六模块进入 `client-kit/ts/platform/src/react/projects/`，
  两端实际入口共用；sidebar 原最小宽度只增加真实 export，不复制常量。
- 已授权治理适配：现有 BFF/本机 Relay 宿主、fresh 目录与成员准入、身份隔离、
  不确定/拒绝清正文，以及原六句中英词条；Core 不复制正文。
- 缺失需恢复：完整 Overview 的工作区 sheet、Tasks/Reviews/Commits/Files/
  People/Codebase 与 repository healing/management 原消费者尚未接通，不生成
  假入口或以全局 Tasks 页替代；WorkspaceTabs 和 repository/detail Chrome
  调用仍缺。当前目录/元数据 pending 是既有加载文案，未迁入完整原首页骨架。
  本批不声称完整 ProjectChannelHome/Projects。Web 项目首页的 draft/search/
  message URL 定位不因传递宿主 props 就视为已恢复，Mobile 没有本批页面消费者。

原 SDK `kailo-web-thread-tooltip-sdk` 实核空闲，4 CPU/8 GiB，memory+swap 总
限额等于内存（无额外 swap），UID 1000，输入、TMPDIR、npm cache 均在 Data；
可用内存约 34 GiB。只投递本批路径到既有
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/reminder-consumers.RcN79Y`，
没有新镜像、冷构建或 full。原命令为共享 `node node_modules/typescript/bin/tsc
--noEmit -p tsconfig.test.json` 和 `node node_modules/vitest/vitest.mjs run
test/projects.test.tsx --no-file-parallelism`；Web 原 `tsc --noEmit`、Vitest 的
`src/platform/ui/PulsePane.test.tsx` / `src/app/platform-navigation.test.tsx`；
Native 原 `tsc --noEmit -p tsconfig.json`。未改超时、线程池或断言安全要求。

失败原件保留：72629 exit 1（59/63）、74499 exit 1（62/63）暴露旧公告断言及
异步查询 DOM/既有错误文案不匹配；86480 共享类型和 63/63、Web 类型与导航
32/32 通过，但 Pulse 12/13，原项目 fixture 错用了 `channel` 而不是固定官方
`buzz-channel`，整轮 exit 1，Native 未执行。纠正 fixture 后 68477 exit 1，
Pulse 撤权断言读到 Query 尚未通知的 Loading；改为原 vi.waitFor 等待实际错误
DOM，不使用固定 sleep。70184 Pulse 13/13 后 Native 首次执行报 TS18048，
本批 channels.data 可空；改为原数据可空时拒绝挂载。31543 最终 exit 0，分别
记录 Native 类型 0、共享 TypeScript 5.9.3 类型 0、真实共享消费者 63/63。
React act 警告保留；类型/DOM 不等于 Windows 安装包或浏览器业务验收。

根导航反证 38884 exit 1（1 failed/31 passed），私有副本恢复旧路由判断使项目
首页 thread 变成 undefined；精确还原 cmp 0 后 37361 exit 0、32/32。原日志在
上述 `reminder-consumers.RcN79Y/navigation-project-home-negative.log` 与
`navigation-project-home-restored.log`，SHA256 分别为
`9469d4717f6eed28fd0b24822b81f6271fd70805fec1577bdd927014dafbe69d` 与
`55e8d93a72fa3c99cc517d664094d219373fdcea2c26051abbda7cc675b8cc3f`。

同源词条先在 Web SDK 原入口失败：Dart analytics 写 `/.dart-tool` 无权限，
`i18n.log` exit 1、`dart-entry-error.log` exit 255；未改 HOME 或生成脚本。
随后复用运行中原 Wren SDK（4 CPU/4 GiB、原 HOME 配置），独立 Data 输入
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/project-home-i18n.iq04CX`，
52908 原 `python3 tools/gen-platform-i18n.py` 与 `--check` 实际 exit 0。
输入仅 HEAD 加本批六词条，Dart 输出只取六枚举/六翻译 hunk；正式 TS/Dart
既有暂存和未暂存差异均保留，不整文件覆盖正式 Dart。

本批其余原始日志目录为
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-channel-home.EtRkGd`。
根合批 docs 52910 已 exit 0、七节通过（只读当前顶层/docs/design，不覆盖此
receipt 正文），日志 `project-wren-batch-docs.htxK34/docs.log` SHA256
`fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`。
本批未部署、未截图、未 Windows/OS 验收；线上旧 9d718 图片不能认领本批。

共享首页反证 28417 仅在私有输入去掉实际 ACTIVE/member 过滤，原非成员拒绝
用例实际 exit 1（1 failed/62 skipped）：非法频道 slot 仍被挂载，被断言捕获；
不是静态字符串检查。复制正式原字节还原、cmp 0 后，14091 原完整项目套件
exit 0、63/63。原件 `home-membership-negative.log`、
`home-membership-restored.log` 保留于上述本批日志目录；正式生产文件从未变异。

提交前同批收缩：全树精确检索 TS 字符串与 Dart enum 消费（排除两份词条
定义）确认已删除公告 aside 的 `projects.announcement`、`projects.close`、
`projects.owner`、`projects.address`、`projects.repositories`、
`projects.readBoundary` 六项已无调用，正式 TS 与私有生成输入一并删除。
`projects.unavailable` 仍由 `ProjectsView.tsx::ProjectWorkItemPage` 的拒绝态
消费，保留；`projects.closeSearch` / `projects.closeSearchTitle` 没有改动。
同一原 Wren SDK / 独立输入执行原生成和 `--check`，60236 实际 exit 0，
日志 `project-home-i18n.iq04CX/contraction.log`；仅回填生成的六项 Dart
enum/翻译删除 hunk，未覆盖其余 dirty 或公共暂存。最终类型/DOM 上述结果先于
这次无消费者词条收缩，不将生成检查冒充重新运行整端检查。

## 2026-10-12：原项目首页 Tasks / Reviews 侧面板读闭包

基底 `1fd25b763a21359698ddc1278d915429837f3134`；固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批仅恢复首页 Overview 的
Tasks / Reviews → 原侧面板分组列表 → 原共享详情 → 原返回/关闭操作，
不是完整 Projects、写操作或已部署验收。

### 权威、影响、副作用与异常

1. 权威为原版一致性要求、DD-75 的双宿主传输边界与 DD-87 的共享页面边界。
   读数据仍来自既有 ProjectsHost、目录和 Relay/BFF；不新增平台实体、注册表、
   schema、服务或写动作，不把项目公告当频道 membership。
2. 影响从 `ProjectHomeContextPanel` 两个原入口，经 `ProjectChannelHome`、
   `ProjectHomeWorkspaceSheet`、`loadProjectWorkItems` 到已有 Issue/PR reducer
   和详情。Tasks 汇总当前项目各仓库，Reviews 只读所选仓库；项目过滤在去重前，
   共享仓库不能因全局去重归到另一个项目。Web / Desktop 经同一共享主体，
   仅真实 ChannelPane/ChannelScreen 的辅助面板、身份、传输留在宿主。
   没有持久格式或旧数据迁移；Mobile 未接此页面，不称移动端恢复。
3. 新增动作均为读取/本机展开关闭；不发布事件或复制正文进 Core。
   沿 fresh 目录、当前项目/仓库和受信 viewer 读取，scope 更换销毁旧挂载，
   查询中不显示旧列表/详情。修复实际检查发现的撤权动画残留：Web 失去准入时
   直接卸载辅助面板 Presence，并清覆盖状态，不等退出动画继续暴露正文。
4. 零条目用原空态；超限/分页沿既有枚举器；重复打开不产生新写意图；
   中断/撤权/未知保持原 `platform.loadFailed` 结果不明，不冒充空集合或成功。
   既有六类错误及上游拒绝合同不变。原线程被侧面板覆盖时保留原线程，
   置 inert / aria-hidden，禁用被覆盖线程 Escape，关闭后按原焦点目标恢复。

### 固定原版四类对照

- 原样保留：固定 `desktop/src/features/projects/ui/ProjectWorkItemRow.tsx::ProjectWorkItemRow`、
  `desktop/src/features/projects/ui/ProjectWorkItemGroup.tsx::ProjectWorkItemGroup`、
  `desktop/src/features/projects/ui/ProjectStatusProgressIcon.tsx::ProjectStatusProgressIcon`
  的只读行、分组与 SVG；不另绘列表。
- 共享迁移：固定 `desktop/src/features/projects/ui/ProjectHomeWorkspaceSheet.tsx::ProjectHomeWorkspaceSheet`、
  `desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::{ProjectIssuesPanel,IssueRow}`、
  `desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::{PullRequestsPanel,PullRequestRow}`
  的 Tasks/Reviews 读分支与现有详情复用；固定
  `desktop/src/features/projects/ui/IssueAssigneesRow.tsx::IssueAssigneeFacepile` 的原头像组。
  首页 toggle 不强改 summaryOpen，沿原 previous-open 判定抑制 sheet 开关时的宽度动画。
- 共享迁移：固定 `desktop/src/features/channels/ui/IdleAuxiliaryPanel.tsx::IdleAuxiliaryPanel`、
  `desktop/src/features/channels/ui/ThreadPanelSurface.tsx::useThreadPanelSurface`、
  `desktop/src/features/channels/ui/ChannelPane.tsx::ChannelPane` 的实际辅助面板/覆盖消费，
  双端共用同一 IdleAuxiliarySurface；原
  `desktop/src/features/channels/ui/FocusThreadDrawer.tsx::FocusThreadDrawer` 的 label、编辑 Escape、
  覆盖和关闭焦点契约补齐，原消息/线程发布路径未改。
- 共享迁移：固定 `desktop/src/shared/ui/ViewLoadingFallback.tsx` 的
  `LoadingHeaderSkeleton`、`MessageRowsSkeleton`、`ChannelLoadingBody` 三函数体逐字一致，
  96 原行移到共享 `ChannelLoadingFallback.tsx`，Native 重复实现删除。
  原文件 SHA-256 `f15dc33b79e4e82b21ebee03c0cc68bdb10bc81ebbd9a5353afcb2cac284378d`。
  首页目录等待无额外 header，lazy ChannelScreen 等待保留 includeHeader。
- 共享迁移：固定 `desktop/src/shared/ui/BuzzLoadingState.tsx::BuzzLoadingState`、
  `desktop/src/shared/ui/buzz-logo/BuzzLogoAnimation.tsx::BuzzLogoAnimation` 与
  `desktop/src/shared/ui/buzz-logo/buzz-logo-animation.css` 原加载呈现。
  CSS 与固定源码 cmp 0，只作用于原 `.buzz-logo` 类及原关键帧，保留 reduced-motion。
  SVG 原 722 行仅为共享严格类型检查在源码确已初始化的 v1/v8 读取加两处非空断言，
  类型擦除不改变动画；原 loading 函数仅改 import，Tasks/Reviews 同源消费。
  Native 原 BuzzLoadingState/BuzzLogoAnimation 路径收缩为共享薄转发，删除唯一由
  旧动画引用的 CSS，避免双份呈现实现；删除的源码可由 Git 历史恢复。
  queryPending/拒绝/正常 body 始终位于原 sheet `-mx-4` / data-tab 外壳，
  列表保留原 `desktop/src/features/projects/ui/projectPanelStyles.ts::PROJECT_DETAIL_PANEL_CLASS`，
  不因加载把正文横向边界跳到另一布局。
- 已授权治理改造：原 native hooks 改接现有受权读链，身份/仓库失配拒绝、scope 退出
  撤销、fresh 时隐藏旧正文；中文默认/英文适配新增 13 个同源词条。
  私有 HEAD + 本批词条原生成，正式 Dart 仅回填精确增量，公共旧 TS/Dart 暂存及
  未暂存资料保留，没有把其余历史词条变更纳入候选。
- 缺失需恢复：原 create/comment/status/assignment/review 写消费者、selection-to-Agent、
  展开为完整仓库 WorkspaceTabs、仓库管理/healing、Commits/Files/Contributors/Git
  仍未在本批闭合，不生成假按钮；详情内已登记的写/执行缺项继续保留。
  四类映射只说明本批原调用闭包，不能替代全量台账或宣称 100% 原样。

### 实际命令与结果

原 SDK `kailo-web-thread-tooltip-sdk`：4 CPU / 8 GiB，memory+swap 总限额等于
内存（无额外 swap），UID 1000，检查前仅 sleep，宿主可用内存约 34 GiB。
输入 `/candidate/reminder-consumers.RcN79Y`，TMPDIR / npm 缓存均显式投递该
Data 私有目录；没有新 SDK 镜像、冷构建或全量构建。
日志根 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-workspace-sheet.CUh2Hi/`。

- `94151`：首轮共享 tsc exit 2，PR 数组类型未收窄；修真实类型，不删消费者。
- `43038`：共享 tsc 0，DOM 105/108（新夹具缺 matchMedia），Web/Native tsc 均 0，
  聚合 exit 1；补现有媒体查询夹具，不改产品响应式逻辑或测试超时。
- `55204`：共享 108/108 与类型 0；Web 类型 0，Web DOM 41/43，
  一个实际撤权 Presence 残留和一个旧单参 spy 失败，聚合 exit 1。
  撤权修复后 `58724` Web tsc + ChannelPane/Pulse 两原套件 43/43，实际 exit 0。
- `59056`：仅私有断开 openWorkspace 状态投递，两条实际 Tasks/Reviews 点击检查失败，
  exit 1；精确还原 cmp 0 后 `31414` 原四共享套件 108/108，exit 0。
- `1756`：追加原 Buzz loading 后 DOM 109/109；类型 2 为上述原字典读取的严格类型差异。
  两处类型适配后 `23988` 共享 TS 5.9.3、Web、Native tsc 全部实际 exit 0。
- `21770`：私有退回非原 loading 呈现，Tasks/Reviews 两条实际 pending 检查失败，exit 1；
  还原 cmp 0 后 `27748` 原 project-inbox 全套 34/34，实际 exit 0。
  原父外壳接线纠正后 `72229` 共享 tsc 与同一套 34/34 均实际 exit 0；
  新增断言检查实际 loading 父级原 class / data-tab，不只检查图形存在。
  Native 旧入口薄转发、旧 CSS 收缩后 `89683` 原 Native tsc 实际 exit 0，
  日志 `native-final.log`；不把类型检查称作 Windows 运行验收。
- 共享命令为 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json` 与
  `node node_modules/vitest/vitest.mjs run test/projects.test.tsx test/project-inbox.test.tsx test/thread-panel.test.tsx test/channel-loading.test.tsx --no-file-parallelism`。
  Web 原 `./node_modules/.bin/tsc --noEmit`、
  `./node_modules/.bin/vitest run src/platform/ui/ChannelPane.test.tsx src/platform/ui/PulsePane.test.tsx --no-file-parallelism`；
  Native 原 `./node_modules/.bin/tsc --noEmit -p tsconfig.json`。React act 警告保留。
- Root 骨架正反还原：31705 2/2 exit 0；私有移除 hasHeader 投递 77865 exit 1；
  还原 cmp 0，49757 2/2 exit 0。原日志在上述 `reminder-consumers.RcN79Y`
  的 `channel-loading-{positive,negative,restored}.log`，不是设备截图。
- i18n `45816`：原 `kailo-wren-query-sdk-itgs2n` 4 CPU / 4 GiB（无额外 swap），
  原 HOME 配置、独立 `project-sheet-i18n.U3sm8s` 输入，
  `python3 tools/gen-platform-i18n.py` 与 `--check` 均实际 exit 0。

源码未部署；不复用现网旧 Web 截图证明本批。没有 Windows/Mobile 新包或设备验收。
既有 full 的 11 项 artifact source 摘要失配发布门禁仍未解除，本批定向通过不等于
full exit 0 或生产就绪。文档门禁由主线同批唯一原只读入口负责，不额外导出全树。
主线 `29634` 的原 `tools/check-docs.sh` 实际 exit 0，七部分通过，
日志 `/volumes/data/kailo/tmp/projects-sheet-docs.afxLm7/check-docs.log`，
SHA-256 `fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`。
执行为原镜像 2 CPU / 2 GiB、无额外 swap、UID 1000、network none，
只读 apps/design，缓存/tmp 在 Data；脚本覆盖顶层/docs/design，不称其扫描本 verify 正文。

## 2026-10-12 PR 提交哈希复制的原失败呈现

比较基准 `581f4f890e4a45a1e8c9b9d79ddf8bfac0d08d3e`；固定 Buzz
`779af8886caae1317b4de962082429867ab61503`。

1. 权威：REQ-24 原版恢复，原
   `desktop/src/features/projects/ui/ProjectCommitCopyButton.tsx::CopyTextButton`
   调用 `desktop/src/shared/lib/clipboard.ts::writeTextToClipboard`，仅成功显示
   Check 两秒；它不是另一个带成功/错误 toast 的 `copyTextToClipboard`。
   共享版的额外错误 toast 属未授权呈现差异，本批移除，不新增按钮或文案。
2. 影响：共享 `ProjectPullRequestDetail.tsx::PullRequestCommitRow` 的现有按钮
   继续经 `PulseHost.copy` 使用 Web/Desktop 各自原剪贴板适配。完整提交哈希、
   原 class、键盘/点击冒泡阻止与成功反馈时长不变，无 schema、权限或状态迁移。
3. 异常：宿主拒绝被处理但不显示成功勾、不弹额外 toast、不重试；失败没有被
   转成成功。四类差异分别为原按钮呈现保留、既有共享实现继续复用、宿主/i18n
   沿既定授权适配、原 Git 详情及其余未接通写操作继续列为缺失需恢复。
4. 消费者证据：已有 `project-inbox.test.tsx` 从原 query/reducer 取得 PR，展开
   原 Commits section 后点击实际提交行按钮；断言复制完整更新后哈希、父行不
   打开、成功 Check/两秒复原，以及拒绝无 toast/无成功勾，而非只测试孤立按钮。

实际复用原 `kailo-web-thread-tooltip-sdk` 与镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
本轮限额回读为 2 CPU/4 GiB，memory+swap 总限额等于内存（无额外 swap），
UID 1000、network none；cgroup `cpu.max=200000 100000`、`memory.max=4294967296`、
`memory.swap.max=0`。启动前无其他编译/测试进程，可用内存约 38 GiB；I/O full
avg60 约 31.89%。仅两文件投递原 Data 输入并 cmp，相邻已提交代码字节未变；
TMPDIR/npm cache 显式使用 `/candidate/reminder-consumers.RcN79Y` 下既有目录，
未安装依赖、构建/加载镜像或运行 full。Node 24.21.0、TypeScript 5.9.3、Vitest 4.1.11。

在该输入的 `client-kit/ts/platform` 执行原命令：

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --no-file-parallelism
```

- `59414` exit 1：两项类型通过，48/50；新夹具在清空设备语言后误定位英文
  Commits，沿既有 PR 双语检查在用例内设置语言，不改生产语言或测试超时。
- `46509` exit 1：类型通过，48/50；新断言误写初始哈希，原 kind 1619 update
  已使 reducer 使用更新后的完整哈希，纠正断言而不更改原 reducer/夹具事件。
- `32138` exit 0：末版测试类型检查与原套件 50/50。
- `88839` 私有恢复旧错误 toast，原套件加 `-t "original PR commit-copy feedback"`，
  exit 1：1 通过、1 失败、48 显式跳过，捕获拒绝时额外 toast 一次。
- 精确还原源码/测试 cmp 0 后，`32135` 原完整单套件 50/50、exit 0；React act
  警告保留。正式文件和公共 index 未参与反证。

日志目录 `/volumes/data/kailo/tmp/project-commit-copy.eLSdp5`：
`positive.log` SHA256 `502c80c901df69781ce66a71e40c546fa653356c6c104c7fe11ce935d34017b1`；
`final-positive.log` 为第二次失败，SHA256 `36b62b546c885b889d8ebfecdf284c068746cbfb9dc2c6384ecacdf027cf3167`；
`consumer-final.log` SHA256 `aba4c643e00ea0c4f6aca289b5ebe63ada33cf35b48d9db9c47eb2ea748f35f6`；
`mutation.log` SHA256 `91ccfae619632bd7166920291799c09f9e99d24fddfb6609f2c4c48d01450809`；
`restored.log` SHA256 `a3a825abdcb5f95402240ec7a98b34891c3448823957bc1fd25ecc287d3933a9`。

本批没有部署、新版截图、真实 OS 剪贴板或 Windows/Mobile 验收；现网旧 Web
截图不证明此源码。needs_action 仍缺原 46010/40007 生产及受权读链，不能以本批
小修复或现有 30300 提醒冒充已恢复；未运行 full，已有发布门禁不变。

## 2026-10-12 Tasks / Reviews 原最近活动排序消费者

基底 `9a4340dcd811dbd42718c47770534e7cd3a5621c`；固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/ui/ProjectsView.tsx::ProjectsView` 内
`visibleIssues` / `visiblePullRequests` 使用 `right.updatedAt - left.updatedAt`，
`desktop/src/features/projects/ui/ProjectsListHeaderBar.tsx::ProjectsSortSelect`
提供 `updated` / `created` / `name` 三选项。当前共享 canonical reducer 已有
该活动值，列表却只允许后两种排序；本批接回原实际排序，不添加数据查询或新控件。

四步结论：

1. 权威为 REQ-24 原版恢复；作用于既有 Tasks / Reviews 的受权列表，不影响
   Project / Repository 事实、写入准入、契约或任何新 Workflow。
2. 读链仍为 `loadProjectWorkItems` → 原 `projectIssues.mjs::eventToProjectIssue`
   与 `projectPullRequests.mjs::eventToProjectPullRequest` → 共源列表。
   Issue 的评论/状态、PR 的更新/评论/状态归约为原 `updatedAt`；没有活动时由原
   reducer 回落创建时间。排序保留原减法和相等返回 0，不补本地时间或新 tie-breaker。
3. 共享 `ProjectsSortSelect` 原位置/样式增加原选项，复用已有中英
   `search.recentActivity`；已有 Tasks / Reviews 恢复入口初值为 `updated`。
   项目目录缺少原 activity summary，切回目录只回到已支持的 `created`，不显示
   无数据支撑的选项，不新增提示文案。其它原可支持排序仍保留。
4. fresh 获取中或拒绝仍清空列表；排序不新发 Relay/BFF 请求、不调用发布或修改
   读账本。scope 生命周期保持既有实现；本批不新增持久格式或错误分类。

四类映射：原样保留比较顺序、原 select 呈现和 canonical 活动归约；共享迁移为
这三个 TS 呈现消费者接回缺失选项；已授权适配仅为双端既有 Host / fresh 读门禁与
同源中英词条。目录活动选项未恢复属于缺失，不归为用户授权删除；缺失需恢复仍含项目目录活动汇总、
原 `projectsViewHelpers.ts::readStoredSort/writeStoredSort` 持久偏好、Git/审阅写操作、
selection→Agent、needs_action 原生产链和 Mobile 实际入口；不称全部排序恢复。

原 `kailo-web-thread-tooltip-sdk` 启动前仅 sleep；固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
2 CPU/4 GiB，memory+swap 总限额等于内存（无额外 swap），UID 1000、network none；
实际可用内存 37 GiB、I/O full avg60 24.78%。私有源码、TMPDIR/npm cache 均在
Data 原挂载，四文件投递后 cmp 0；没有新镜像、依赖安装或复制依赖树。

82168 实际 exit 0：原 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
及 `-p tsconfig.test.json` 均 0；原
`node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --no-file-parallelism`
54/54。新增四项中英真实列表验证评论/更新对创建顺序的覆盖、无活动回落、三种
排序、刷新状态后重排、正确详情回调、撤权清空及目录切换，不以纯 formatter 检查替代。
20950 仅私有比较器恢复旧 created：exit 1，四项逆序断言失败、50 跳过。
apply_patch 还原、cmp 0 后 92149 原完整套件 exit 0、54/54；React act 警告保留。

日志 `/volumes/data/kailo/tmp/projects-recent-sort.8m551m/`：
`positive.log` SHA256 `686b65482c99e8a4e6a8df978c3605c51b65c6fc575e3cafabf6cb12fe3547ca`；
`mutation.log` SHA256 `3fbf05614012b3d5215729f63c673657334533df02e90f16f0006c39766718b2`；
`restored.log` SHA256 `fd232a3834e3424f843faabd76358473d825f1e1aeeb80287a64d80989724701`。
仅定向源码证据：本批未构建、部署、截图、执行 Windows/Mobile、docs 或 full；
线上旧 Web 不能认领新排序，已有发布门禁保持。

## 2026-10-12 原 Projects 排序偏好持久消费

基底 `0fc0d44226906f4138a86c10766ad3102216c099`。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/lib/projectsViewHelpers.ts::readStoredSort/writeStoredSort`
及 `desktop/src/features/projects/ui/ProjectsView.tsx::ProjectsView` 是本批依据。
两函数和 `buzz.projects.sort` 原键直接共享迁移，不新增用户配置权威。

四步结论：REQ-24 要求原偏好；影响限共享 Projects 目录/Tasks/Reviews 现有排序
状态及原 select 委托，两端消费相同主体。原 `created`/`name` 读回保留，空值、
未知值或存储读取拒绝按原 `updated`；写入失败保持内存操作，不新增 toast。
用户选择才调用原 write，页面 remount 按原 read 恢复。目录仍缺原活动汇总，
`effectiveSort` 只在目录显示既有 `created` 回退，不能把这个回退保存为用户选择；
返回工作项或刷新仍恢复原 `updated`。目录缺项不因此成为已授权功能裁剪。
只有排序枚举字符串进入原 localStorage，不保存业务正文/身份或授权证明；无
schema、API、状态迁移、错误分类或读取准入变化，fresh 失败清正文的既有检查保留。

四类记录：原样保留 storage key、两函数、best-effort 错误分支和原比较逻辑；
共享迁移其实际初始化/用户选择消费者，`ProjectsSort` 回原 helper 定义，旧位置
仅 type re-export；既有授权 Host 与同源词条不变。本批解除“sort 持久偏好”源码
缺项，目录活动汇总、Git/审阅写操作、selection→Agent、needs_action 和 Mobile
前述缺项继续保留；没有新样式、控件或伪造目录活动值。

复用同一 Data SDK，2 CPU/4 GiB、memory+swap 总限额等于内存（无额外 swap）、
UID 1000/network none。预检仅 sleep、可用内存 37 GiB、I/O full avg60 23.38%；
四源码/测试文件精确投递 cmp 0，TMPDIR/npm cache 仍为原 Data 路径，无新依赖。
原命令为 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`、
`-p tsconfig.test.json`，以及 `node node_modules/vitest/vitest.mjs run
test/project-inbox.test.tsx --no-file-parallelism`，未改 pool、超时或断言预算。

85167 exit 0：生产/测试类型均 0、56/56；终态后仅补“实际选择 name 后 remount”
断言，89700 测试类型 0、56/56。末版页面用例覆盖选择 created/name 后刷新、
stored updated 跨分区/目录刷新不被覆盖、切回恢复、存储拒绝仍能内存排序，以及
坏值回原默认。9660 私有断开 `writeStoredSort` 委托 exit 1：1 fail/1 pass/54 skip，
实测期待 stored created 却得到旧 name；apply_patch 还原及 cmp 0 后 50627
原完整套件 exit 0、56/56。React act 警告保留，不把反证失败当环境故障。

日志 `/volumes/data/kailo/tmp/projects-stored-sort.lvzis9/`：
`positive.log` SHA256 `38c177ea2794959f20854f9f07a6bb2991f92d94fbf8547af3edf29871476306`；
`final-positive.log` SHA256 `dc79055ce62f8994943257c1f0e0cb1627d5f000889106c9c70a9f67ada34c0f`；
`mutation.log` SHA256 `f46f838148f6abb380662591205fafd3339a425bd33c2c01ee46244e00fe41ae`；
`restored.log` SHA256 `97e4e0910e7f9b555c8e4c4c59fcb62fd6a56116846864242ce417010d29b546`。
本批未构建、部署、新截图、Windows/Mobile、docs 或 full；仅源码定向证据，
不能借旧版线上图认领本批偏好恢复，现有发布门禁不变。

## 2026-10-12 旧部署 Inbox 完整线程与单次刷新实拍

本次只读操作时源码 HEAD 为 `ab07c6c9d395fad604712b10086fec211892e64b`；
固定原版仍为 Buzz `779af8886caae1317b4de962082429867ab61503`。
沿原 Playwright CLI 会话 `kailo-official-views` 正常 SSO 登录，未创建业务对象、
发送消息、轮换凭据或保存认证快照。初始过期会话读取 build-info 被登录跳转/CSP
拒绝，正常登录后 08:51:44.887 UTC 实际 HTTP 200：buildId 为
`sha256:1fe5c137da245352680e90626a67aef906cd4bee1bb9b7964b2c080964c0653e`。
它对应既有发布记录的 `9d718234b74b688d9b81816f9b67470d4fc80440` 输入，
不是当前 Tasks、评论、排序或作者批读源码部署；未重新检查容器镜像。

从 `/app/inbox` 已有线程点击原“打开完整线程”，实际进入频道
`ad9a6443-f0a2-47d2-895d-f11b8fef9e38`，URL 保留 thread/threadRootId/messageId，
原根消息与既有“结果：367”回复可见。随后仅做一次正常 `page.reload()`：
08:52:46.901–08:52:48.544 UTC 捕获窗口内文档 200、路由及该回复仍在，
但新增 30 个 429（作者资料 26，profile/custom-emoji/messages/channel 各 1）。
这是本次 response 监听所得，不是累计旧 console；未重复刷新或通过重试覆盖失败。
作者资料同窗口另有 28 个 200，user-state 4 个 200、主频道 stream 3 个 200，
因此不能把部分读取成功记为完整刷新通过。日志 responseStartMs 仅表示响应开始，
不是完整请求耗时；没有记录请求头、令牌或认证值。

证据目录 `/volumes/data/kailo/tmp/inbox-thread-online-read.BqzhP3/`：
`01-inbox-thread.png`、`02-channel-thread.png`、`03-thread-reload.png` 均已逐张打开。
前两张证明原 Inbox/完整线程跳转；第三张线程正文仍可见，但左栏停在“载入中…”、
频道目录为空，不记刷新验收 PASS。三个图片 SHA256 依次为
`ecf4a4961cb6f1fa46b3b5db7499ce2448d54ecf75ba2423dc9a4b9e328c5984`、
`630a426f88e857717d58f14f6c5b1bcfa4de178fdcba73c6be45ad9ed34649fe`、
`0ea59c1fdf184f6338b2cecb915a4c895fb8175700dd87855d3efd816498b053`。
`reload.log` SHA256 `d3ab068ff00ba84f65e10c074a2322795ff739b9d04e17df0c3ea0a18ed9a83f`，
含精确脱敏路径、时间、计数及原操作；98175 实际 exit 0 仅为浏览器脚本正常结束。

作者批读源码 `dd65fb74a53ebb6aaac7ba1c3ecb766b2accb3b0` 已提交但不在此旧 Web；
本次不改已修读取链或提高预算，失败交主线发布收口。部署后最小复验仍为同一
Inbox 线程→完整线程→一次刷新，先读新 build-info，再核正文、侧栏及实际请求；
Tasks 创建/评论、Projects 排序等尚未部署功能继续分别保留未验收，不借此三图认领。

## 2026-10-12 原 Inbox URL 选择与受权冷定位

固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/home/ui/HomeView.tsx::HomeView` 的 `INBOX_SEARCH_KEYS`、
`useHistorySearchState`、`urlSelectedItemId` / `applyInboxSearchPatch`；
`desktop/src/features/home/useInboxSelectionAnchor.ts::useInboxSelectionAnchor`；
`desktop/src/features/home/useHomeInboxAutoSelection.ts::useHomeInboxAutoSelection`；
`desktop/src/features/home/ui/InboxDetailPane.tsx::InboxDetailPane`。

四步结论：

1. 权威为 REQ-24 原版恢复和 DD-75 的 Browser BFF 边界。`?item=` 只是原事件导航
   引用，不携带 scope、身份、正文或权限。正文及签名仍在 Relay，不另建 Inbox 存储。
2. 原共享 history hook 和自动选择 hook 已存在；本批接 Web 原 navigation 与
   InboxPane。手选进入历史，自动选择只留本地，前后退/刷新保留原 item 语义。
   未在 feed 的引用只作详情上下文，不制造 feed 行或未读数。
3. Web 冷定位沿已有目录与 messages 查询串行遍历本次准入 scope，新增可选
   `WebMessageQuery.anchorEventId`。Core 复用 `read_message_event`，逐个验证本人
   当前 scope、频道、签名、kind、root/parent；返回前再 admit 与 actor-key 核对。
   原消息及父级权限边界未放宽，回应 `no-store`。旧请求缺字段语义不变；anchor
   与 parent、Agent、分页、Forum 模式冲突拒绝。原生端既有原 Inbox 链未改。
4. 查无目标才尝试下一已准入 scope；403、503、UNKNOWN、畸形及祖先缺证不当 404。
   选择取消停止后续请求并忽略晚回应，不新增扇出或放宽请求预算。URL 变化不清除
   原发送意图：沿原 scope 实例保留 key/parent/draft，发送在途或 UNKNOWN 时保留
   原详情；仅明确终态后应用最新选择。持有引用仍受 principal、fresh 目录、可见
   scope 和原 thread read/撤权门禁限制，不是权限缓存或新增执行账本。

四类原版差异：

- 原样保留：既有 Inbox 行/详情布局、按钮与文案；原 `?item=`、手动 history 与
  自动选择不写 URL 的行为。未新增菜单、时间 formatter 或空态产品文案。
- 共享消费：Web 直接调用已迁移的 `useHistorySearchState` 与
  `useHomeInboxAutoSelection`，没有第二实现；原 Desktop 页面保持现有调用。
- 授权宿主差异：官方 `getEventById` 冷读取改为受权 scope 内的既有 BFF reader；
  管理 workspace ID 与签名事件 native channel ID 分别传递。未知发送保留原目标，
  不依靠按 item 重挂载清掉 UNKNOWN；显式选择与后台 feed 代表项更新分别处理。
- 仍缺/未验收：needs_action 无可用原 producer，Mobile、部署后的真实 SSO cold
  URL、HTTP/SpiceDB/Relay 联调未由本批 fixture 证明。当前线上旧版本不含这批；
  本批无构建/部署/新截图，不将旧截图、类型检查或本次窄验记作完整恢复/full 通过。

私有输入及日志根：
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/inbox-item-cold.0C8wTo`。
固定生成使用 a48632b6379b22aab78a60afa348523c309855ca 的 HEAD contracts 加本批
唯一 schema；公共四侧生成文件原有 dirty 没有覆盖。复核候选已重放至
`3306a3d5826c7cebb13c5caadc32f0b52715e4ab`，保留已提交的 Knowledge、发布记录
及全量固定源码分类纠偏；Core 冻结验证输入未因这些无关提交重跑。
Rust/Dart 既有往返文件的非本批格式改动不进入候选，公共三项旧暂存不改。

实际检查（均沿已有 SDK image `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`）：

- Web `kailo-web-thread-tooltip-sdk`：2 CPU、4 GiB，memory+swap 总限额等于内存，
  UID 1000、network none；TMPDIR、npm 缓存和私有源码均在 Data。已有 TS 5.9.3 /
  Vitest 4.1.11，不下载依赖。原命令 `node node_modules/typescript/bin/tsc --noEmit
  -p tsconfig.json`；`node node_modules/vitest/vitest.mjs run
  src/platform/ui/InboxPane.test.tsx src/platform/ui/InboxThreadPane.test.tsx
  src/app/platform-navigation.test.tsx --no-file-parallelism`。
- 首轮 38991 exit 1，类型 0、98 pass/13 fail：旧 fixture 的新增导航按钮打乱
  数字索引，及已恢复 Tasks 评论后原十项仍期望无 composer；修 fixture 位置与
  真实现有呈现断言，不改产品/超时。60682 exit 0，112/112。
- 私有 21572 将 403 当查无目标继续下一 scope：exit 1，原撤权断言失败；
  精确恢复 cmp 0。34107 的 DOM 112/112、合同类型 0，但聚合 exit 1：私有输入
  漏四份旧 sample。只投递原 fixture 后，68559 的 TS 过滤往返 1/1、exit 0。
- 68559 聚合 exit 1：新 explicit selection 修正使旧 live DM 代表项不移动
  断言失败（112 pass/1 fail）。区分显式选择与 live 更新，保留该原断言。
- 15536 exit 0：末版 Web 类型及 114/114（Inbox 56、thread 25、navigation 33）。
  包含 cold 精确命中/DM/不存在/撤权/UNKNOWN/畸形/取消、原导航历史/刷新、未决
  选择不卸载详情，以及 UNKNOWN→403→同 key+parent 查证→确认后切最新选择。
- 私有 58427 断开父层未决选择保持并移除 Pane UNKNOWN 锁：exit 1，两项新增
  真实父/详情消费者均失败（提前发下一 anchor 查询、草稿目标被切换）。
  apply_patch 还原并与正式源码 cmp 0；80025 exit 0，114/114。
  `selection-held-final.log`、`selection-mutation.log`、`selection-restored.log`
  保留全部原始输出及 React act 警告。
- 原 `bash tools/gen.sh`：46809 exit 1 为私有输入缺末尾原 i18n 生成脚本；补同
  HEAD 原脚本/catalog 后 81854 exit 0，四侧同步生成。没有手写类型，也没有
  将该私有 i18n 投影覆盖公共 i18n/Dart 内容。
- Go 原 `go test ./internal/contracts -run '^TestApplicationBindingProtocolRoundtrip$'
  -count=1 -v`：母用例及 28 子样例通过，含新增 anchor 与旧无字段请求。
  Dart 原 `dart pub get --offline` 仅现存缓存；`dart test test/roundtrip_test.dart
  --name 'conversation references roundtrip'`：1/1。原轻容器 2 CPU/4 GiB、UID1000、
  network none、只读 root，Data `/tmp`、`/.dart-tool`、Go/Pub 缓存，不改 HOME。
  72098 聚合 exit 1：两往返均 exit 0，但原兼容 Python 片段的 shell 引号拆开，
  片段 exit 127；该失败保留在 `go-dart-compat.log`，不重复已过往返。
- 只将 `tools/check.sh` 原 49 行兼容 Python 改为文件参数投递，61557 实际
  exit 0：316 个 schema、3 个历史 schema 匹配，`contracts-v0.1.0` 无破坏性
  变更；不把未在该旧 tag 的 schema 计作历史比较通过。日志为
  `compatibility-corrected.log`，容器 2 CPU/2 GiB、network none、UID1000、
  只读 Git/固定私有 schema 与 Data 临时目录，不新建兼容算法。
- `rustfmt --edition 2021` 94721 exit 0，只整理本批 Core 源；不代替 Rust 编译。
- Core 原聚合 94761：`cargo test --locked --offline -p platform-core --bin
  platform-core inbox_anchor_ -- --nocapture` 已 exit 0，2 passed/445 filtered，
  覆盖旧查询与冲突模式、精确 stream/root/parent 证据。随后 `cargo test --locked
  --offline -p contracts --test roundtrip
  forum_channel_and_composite_cursor_roundtrip_preserve_native_fields -- --nocapture`
  已 exit 0，1 passed/55 filtered。末段原 `cargo clippy --locked --offline -p
  platform-core --bin platform-core -- -D warnings` exit 101，聚合实际 exit 1：
  新纯证据 helper 的 `Result<(), Response>` 触发 `result_large_err`。
  最小改为 `Result<(), ()>`，仅两个实际调用点将该无载荷拒绝映射回原
  `invalid_message_evidence()`；不改 status/body、kind、祖先或授权条件，
  不添加 lint allow。原单元断言保持；同 SDK 5595 增量实际 exit 0：原格式完成，
  anchor 2/2（445 filtered）与窄 clippy 均 exit 0，正式/私有源码 cmp 0。
  原始 `core-positive.log` 与修正 `core-corrected.log` 分开保留；未重复已通过
  Web/四侧往返，不把首轮聚合失败覆盖成通过。
  独立 Data 输入 `core-check`，原 SDK 4 CPU/8 GiB、memory+swap 总限额等于内存、
  UID1000、network none、只读 root；`/tmp`、Cargo registry/git/target 均在 Data。
  原生成/源字节 cmp 0，仅刷新私有输入 mtime 防止跨快照错误复用；不降 Cargo
  并行度、不清缓存、不改 HOME。日志 `core-positive.log`；这些签名事件单元
  消费者不替代真实 HTTP、SpiceDB 或 Relay 联调。

原 Layer 2 交叉复核收尾：`useInboxSelectionAnchor` 的 committed same-anchor
latch 现已接入 Web；同身份/同 item 的直接命中在 feed 代表项推进或窗口移出后
保留，不重新执行 cold 查找。原 fresh scope 可见性与最新目录仍决定能否展示，
不把该引用当权限缓存；principal/item 改变即不消费旧 latch。Project 全历史读
的既有命中语义不变，没有扩大 Core anchor kind。

- 67980 exit 1：Web 类型通过、114 pass/1 fail；新增 feed-window fixture 缺
  原 39006 window bounds，初始聚合即拒绝。补原必要 metadata，不改生产拒绝或超时。
- 11910 exit 0：末版类型及原三套 115/115（Inbox 57、thread 25、navigation 33）。
  新实际 Inbox 消费者验证窗口移出后原正文/parent 保持、anchor 请求为零，再
  撤销目录 membership 后正文清空且不查询旧 scope。原 UNKNOWN/身份/冷定位
  断言全部保留，React act 警告未消音。
  原件 `committed-latch-final.log` / `committed-latch-corrected.log`。
- 12446 私有仅从 resolvedAnchor 删除 latchedAnchor：只运行新增 feed-window，
  exit 1、1 failed/56 skipped，确实抓到额外 anchor 查询（期望空请求，实际出现
  workspace-a）。apply_patch 原字节还原并 cmp 0；14712 同一单例 exit 0，
  1 passed/56 skipped。没有再跑整三套；正式生产未变异。
  原件 `committed-latch-mutation.log` / `committed-latch-restored.log`。

最终原文档入口 `bash tools/check-docs.sh /workspace/.design`，87917 实际 exit 0，
七节全部通过，原件同目录 `check-docs.log`。使用同一已有 SDK 镜像，2 CPU/2 GiB、
memory+swap 总限额等于内存、UID1000、network none、只读 apps/design，原 npm
离线缓存与 `/tmp` 均在 Data；不导出整树、不安装依赖、不改 HOME。输入为当时
实际只读工作树而非发布树；该脚本检查顶层/docs/design，不直接扫描本 verify
正文。当前只完成源码与定向检查，未构建/部署，本批无新版截图，原 full 失败
门禁保持，不以本次文档或窄检查代替整批发布验收。

## 2026-10-12 原 Tasks / Reviews 列表加载消费者

基准 `bca0e2819e9e298cf97d77076a74b8420c8c23db`；固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/projects/ui/ProjectsIssuesList.tsx::ProjectsIssuesList` 与
`desktop/src/features/projects/ui/ProjectsPullRequestsList.tsx::ProjectsPullRequestsList`
在初次读取时使用 `BuzzLoadingState`，不是普通单行文字。

1. 权威为 REQ-24 的原呈现恢复；直接消费已经共享的原 `BuzzLoadingState`、
   SVG/CSS 和已有中英文 `projects.sheet.loadingTasks/loadingReviews`，不新建图形或词条。
2. 影响仅共享 `ProjectsView.tsx::ProjectWorkItemsList`，Web/Desktop 的已有
   Tasks/Reviews 入口同源；原目录、详情和项目首页加载分支不改。
3. 无合同、存储、授权或查询变化；沿现有 `isPending || isFetching` 同时隐藏旧行。
   原上游允许部分分区加载，当前已有原子读取门禁保持，不借加载呈现放宽该边界。
4. 失败仍显示原错误区/Retry；实际重试重新消费同一 Host，不发送发布命令，
   不在撤权或读取未知时显示旧内容，不把加载状态当空列表或成功。

四类对应：原布局/动画/无背景及无纹理 SVG 为原样保留；两个列表入口复用
现有模块为共享迁移；既有 fresh 原子读取与同源中文属于授权适配，本批不新增；
selection→Agent、Git/CommitDetail、审阅决定/inline、目录活动汇总和 Mobile
实际页面仍缺失。此处不把历史 5195 文件覆盖清单更新为当前全语义验收。

证据目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-list-loading.XI1Gjx`。
原 `kailo-web-thread-tooltip-sdk` 开跑前仅 sleep；2 CPU/4 GiB、memory+swap
总限额等于内存、UID1000、network none，源码/依赖/tmp/npm 缓存均在 Data；
MemAvailable 约 36 GiB、load 6.16。未新建 SDK、镜像或安装依赖。
原 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`（TS 5.9.3）
及 `vitest run test/project-inbox.test.tsx --no-file-parallelism`：71011 聚合 exit 1，
DOM 63/63，但新增夹具错误地给单参数 mock 传 signal，类型 exit 2。只修夹具调用，
不改产品/断言；5169 类型 exit 0，原套件筛选 `-t "original work-item loading consumer"`
4/4 exit 0，59 项未重复。保留原 React act 警告与 `positive.log` 首次失败。
4 项覆盖中英 Tasks/Reviews 初读原 SVG、成功后正确详情回调、fresh 等待隐藏旧行、
拒绝后仍无正文，以及原 Retry 重新加载成功；不是只检查孤立组件存在。
私有仅恢复旧文字加载分支，73499 同 4 项全部失败/exit 1；apply_patch 还原且
两个投递文件逐字 cmp 0，12925 同 4 项通过/exit 0。原件 `corrected.log`、
`mutation.log`、`restored.log` 保留；还原日志 SHA256
`d38e9ffc436293f763913089fba56e074f60273dfb20d543a58bbf75d851f44e`。
未运行新 full、构建、部署或浏览器；旧在线图及新 236b 构建均不包含本增量，
不宣称新版本视觉或 Native 设备验收。公共三路径暂存未改。

## 2026-10-12 Tasks/Reviews Related Conversations 原消费者恢复

比较基准 `a0bb89ee97249029b6908665e3778b517f69622f`；固定 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批只接已存在 Issue/PR
Activity 详情，不开放 Git、Commit 或新的 Channels 页。

1. 权威为 REQ-24 原版恢复及 DD-72/75 的双宿主读取边界。原
   `desktop/src/features/projects/ui/DiscussionChannels.tsx::DiscussedInChannels`、
   `desktop/src/features/projects/lib/discussionChannels.ts::entityDiscussionQuery` /
   `groupDiscussionChannels` / `mergeOriginDiscussionChannel` / `discussionSnippet`，
   以及 `desktop/src/features/projects/ui/ProjectEntityListRow.tsx::ProjectEntityFacepile`
   为固定源码依据，不新建讨论数据权威。
2. 影响为共享 `ProjectIssueDetail` / `ProjectPullRequestDetail` 的原 Activity 卡片，
   和现有 `PulseHost` 的双端实际读取/导航。Web 沿原 `searchMessages` BFF 与
   `loadChannelDirectory`，Native 沿原 `search_messages`、`get_channels`、
   `get_channel_details`；两端消费同一共享呈现与归约，不复制两份页面。
3. 无 schema/API/Workflow/写入或持久状态变化。原 500 条有界搜索、按频道聚合、
   三行收起、展开、作者头像/资料、原非交互 Markdown 预览和精确消息导航保留。
   原 `h` 仅为作者声明来源；只有 fresh 目录的 member/open 可形成来源行，不能
   据来源标签推导消息正文或项目权限。展示与点击均检查当前 scope；点击重新读取，
   原引用已不在有界结果时拒绝，不能当成功。身份晚返回不导航。
4. 加载/refetch/拒绝不复用旧内容，点击拒绝复用既有
   `platform.linkChannelUnavailable` 提示，无新增错误布局。Native 仅接受原
   `commands/channels.rs::get_channel_details` 经 `toTauriError` 传递的
   `TauriInvokeError.payload === "channel not found"` 为不存在；包含该文本的
   依赖错误仍拒绝。不存正文、不新增业务操作或重试执行。

四类差异：本批没有新增整文件“原样”认领；共享迁移上述已消费函数、JSX/classes、
排序/预览/展开语义。授权适配为 imports、同源中英 17 词条、Web BFF / Native
Relay host、fresh/scope 门控及既有失败提示。原组件只在 channels 为空时不渲染，
原缓存/来源能跨 search pending 留存；本批 pending/error 无旧内容、无 Host 不读取
也不渲染，明确是治理适配而非字节原样。未恢复：原可选
`ProjectConversationPanelContext` 侧对话面板、完整 `DiscussionChannelsPanel`、
Commit 第三调用者；当前消费原 `openSearchHit` / `goChannel` fallback，不能据此
称完整 Projects 恢复。原 needs_action 的生产链、Git/Files/管理写入等缺项不变。

实际证据目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-discussions.jDzBTS`。
原 Web SDK 启动前仅 sleep，2 CPU/4 GiB、memory+swap 总限额等于内存、UID1000、
network none；源码/依赖/TMPDIR/npm/node 缓存在 Data，未安装依赖或启 builder。
44824：原共享 `tsc --noEmit -p tsconfig.test.json`、Web/Native 各自
`tsc --noEmit -p tsconfig.json` exit 0。18835 串行初验 exit 1：共享 63/65
（新增夹具漏原 OriginReference）、Web PulsePane 15/15 exit 0、Native 8/9
（真正 Tauri wrapper 返回 Error，首版按裸字符串识别遗漏）。修夹具并按真实 payload
纠偏后，85948 exit 0：共享 65/65、三端类型全部 0、Native PulseScreen 9/9。
命令沿原 Vitest `run test/project-inbox.test.tsx --pool=threads --maxWorkers=1`、
Web `run src/platform/ui/PulsePane.test.tsx --pool=threads --maxWorkers=1`，Native
`node --import ./test-loader.mjs --test src/features/platform/PulseScreen.test.mjs`。
保留 React act 警告；这些是实际 React/宿主代码的隔离消费者，不是生产 Relay 或设备验收。

60719 私有仅把点击 `search.refetch()` 改回旧 snapshot，中英两新增详情消费者都在
撤权残留行断言失败，exit 1；apply_patch 还原且 cmp 0，50431 同两项 exit 0，
其余 63 项不重复。`restored.log` SHA256
`6373211c3f4d7b05d3abdf14b1f297fb5147eb5cbb2dfccb2b35b103988a6861`。
实际覆盖来源不伪造引用、三行展开、Issue/PR 精确事件导航、撤权清空/失败提示、
双端原非交互 Markdown、Native 精确不存在与未知区分、身份切换后晚返回拒绝。

词条生成是私有 HEAD + 本批 17 条，沿原 `tools/gen-platform-i18n.py` 和 `--check`。
最初 login shell 遮蔽镜像默认 Dart PATH，两次启动均 exit 1；首份 `i18n.log` 保留。
改用同一缓存镜像默认 PATH、Data `/.dart-tool`/tmp（不改 HOME），7687 gen/check
exit 0，临时容器已删除；只把 70 行新增 Dart 投回正式文件，旧未暂存删除不覆盖。
正式 TS/Dart 历史脏改与公共三暂存不纳入候选，公共 staged patch SHA256 仍为
`9a67c7044797bdbebafd706982d2845b68d2fa121a2ca10d2959f5b695b320fb`。
本批未新跑 full、未构建/部署/浏览器；现在线旧版和已构建 236b 均不含本恢复，
不认领旧截图，不解除现有发布门禁。
