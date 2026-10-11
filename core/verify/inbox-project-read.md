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
- 缺失需恢复：任务分派/状态写入/评论、审阅请求/决定/合并等原写接缝；Git 文件差异与 commit 文件导航、DiscussedInChannels、buzz:// 项目深链及 ShareLinkButton；两页原 ProjectOriginReference 的来源 Agent/频道只读入口也未迁移，不归并为写操作或 Git 缺项。Web 项目通知行作者资料/头像目前未达到原完整资料触发器。这些不是已授权的永久删减，不冒称完整原版恢复。

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
