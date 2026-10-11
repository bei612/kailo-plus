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
