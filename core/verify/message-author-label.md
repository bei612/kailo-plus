# 原消息作者名称的已授权资料消费恢复

## 固定来源与本批权威

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/messages/lib/formatTimelineMessages.ts::formatMessageAuthor` 用原 `resolveUserLabel` 解析 profile、私聊参与者 fallback 和 npub；原 `getAuthorAvatarUrl` 使用同一身份资料。
- `desktop/src/features/messages/ui/MessageHeader.tsx::MessageAuthorText` 是频道/线程原作者文本；本批向原消息模型投递已解析作者，不替换原节点或另写 Web 样式。
- `desktop/src/features/home/ui/InboxMessageRow.tsx::InboxMessageRow` 及已有共享 `InboxMessageRowSurface` 是 Inbox 原作者元素；本批保留该实际元素及全部 class/属性，由统一消息模型提供名称。
- 已有 `ForumAuthorButton` 保存原 `ForumPostCard`、`ForumThreadPanel` 作者布局，本批继续由该共享按钮呈现。

本批落在 `.design/07` 两端同源及 Web 经 BFF、`.design/02` 身份边界和 DD-77 多公钥成员语义内。正文、profile 仍由原 Buzz 服务权威提供；无 Core 复制、合同字段、迁移或新权限。原 `WebProfileView` 没有 owner/Agent role，故本批不伪造这些标识，也不宣称完整 Agent 作者管理栏恢复。

## 实现后四步影响与副作用结论

1. 缺口已定位：Web 的频道/线程/Inbox/论坛头像已有基于实际消息的 profile 请求，但作者标题和头像 fallback 名称仍只用成员目录，未消费已读取的 profile 名字。原固定实现并非这个行为；不是上游不支持。
2. 实际读写链：四个 Web 宿主经既有 MessageAuthorProfile 适配器读取当前 scope + eventId + pubkey 的 profile；姓名投影和头像复用原 `messageAuthorQuery` 的同一 queryKey/请求。共享 `resolveUserLabel` 保持 displayName、NIP-05、显式成员 fallback、npub 顺序。Channel/ChannelThread 在构造 TimelineMessage.author 前解析，再由原 buildThreadPanelData 生成 composer.replyTarget；Inbox 的消息行、回复提示与视频上下文共用 rows，不再独立算三次名字。Forum 原按钮和视频上下文使用同一事件解析器。Native 已有该原解析链，不另写第二套算法；没有写请求或新订阅。
3. 安全副作用：保留原 profile.pubkey 与实际 author 精确匹配检查。渲染仅消费成功且未 fetching 的当前 query；pending/error、403、换 principal/scope 或迟到旧回应不能展示上一个 profile 名字。显示名不作为身份或授权依据，打开资料仍指向同一 exact pubkey/event。头像仍走原媒体读取映射，不在此批放开代理或上传。
4. 异常与终结：空/空白名字按原 parser 回退到 NIP-05、显式 fallback 或 npub；没有假用户或 Agent 身份。读取错误继续原失败分类，未创建新的持久状态、定时器、重试账本、UNKNOWN 终态或副作用。父页面撤权/断流除保留原卸载行为，适配层 available=false 时也立即排除缓存资料。同一作者另一个事件读取被拒绝时，不借其他成功事件的资料填充；没有跨消息授权提升。

## 四类差异与验证边界

本批的姓名解析/文本和原 Inbox/Forum 布局属于原样保留/共享复用；Web 按消息 scope 读取、成员多公钥 fallback 属于已授权治理适配；原 Agent owner/role 与其他尚无可信合同的标识继续列为缺失需恢复，不以本次名称修复覆盖整个模块。

独立私有增量以主线 `c442f2bb6e5c9e4db624057fe756272574a807f2` 上当前正式宿主文件逐字基线导出，频道选择九路径和正在运行的 c381 冻结输入未修改。原六文件渲染层补丁被交叉复核否决：它未修复 TimelineMessage.author，回复提示仍用旧名称。该草稿未落正式，现已删除 MessageAuthorName 渲染覆盖，替换为原消息派生数据链。最终八源码路径共 +228/-48；`git apply --check --whitespace=error /volumes/data/kailo/tmp/ui-author-label.eg6dqJ/derived-author-source.patch` 对正式 apps 实际退出 0。此为补丁适用证据，不是编译或交互通过。

实现后在既有 `MessageAuthorProfile.test.tsx` 添加十个实际用例（含三参数分支）：同请求姓名/头像、NIP-05/成员/npub、原 Forum/Inbox 元素、读取中/换 scope/拒绝/迟到响应、错误作者、不可用清缓存呈现、同作者不同事件独立准入。另在原 ChannelThreadPane/InboxThreadPane 检查中增加四个宿主用例，真实线程投影/buildThreadPanelData/回复选择向原 ComposerReplyBanner 投递，覆盖频道与私聊及撤权。所有新增检查尚未执行，尚无类型/DOM、生产破坏/还原、文档门禁结果；没有启动构建或 full。没有有效新会话页面截图，旧部署截图不能证明此候选。经主线程复核授权后，八源及本回执已由 apply_patch 精确写入正式 apps，逐文件 cmp 退出 0；公共 index 写入前后 SHA256 均为 7bd5fb04a69f8f3eaba9c8d893d882f7cc808589b4e56157f6e386765234d57e。未暂存、提交、推送或部署，正在运行的 c381 冻结全量不覆盖本批。

## 集中验证结果（2026-10-10）

本八源随频道选择器和步骤字段冻结在原受限 SDK 执行；历史三批记录为工作区 `core/verify/workflow-step-fields.md`，不属于本次最小提交。84879 的 Web 类型因私有 file: 包投递跨入另一版本 React 类型而退出 2，未修改产品源码规避；恢复原包副本布局并逐字核对后，77883 的 Web 类型真实退出 0，共享生产/检查类型亦为 0，包含主线最新 RFC3339 字符串生成物。原 MessageAuthorProfile、ChannelThreadPane、InboxThreadPane DOM 三文件均在 worker 启动阶段失败，60.07s、0 tests/3 errors，未重试；本批实际消费者断言、生产负向/还原仍未执行。原 SSO 登录材料可用且实际 session 200，但当前仍旧 4c099 Web build-info；不能用其现网姓名或图片作为本候选验收。

主线程统一收口的 58377 已终态：保留已纠正 file: 实体包布局和最终字符串契约，Web 三文件依旧各为 forks worker 启动失败；63.17s、0 用例/3 errors，transform/setup/import/tests/environment 全为 0ms。历史四批 DOM 记录仍保留在上述工作区回执，本次不混入其余功能源码。未改产品/超时/池配置，未执行生产反证，不再重复启动；旧部署实拍不改写本候选未验收结论。

2026-10-10 后续实际执行：69408 在同原 SDK 跑 Web 三文件，共 57 通过/6 失败，Web/Native 类型 0。失败中两条旧断言仍禁止连续消息逐事件 profile 读取，已纠正为各事件一次、保留原头像折叠和实际打开断言；三条检查将 query 网络结束错作 observer 已渲染，改为等待原 DOM 期望；DM 头像检查补原已有 loadedImages。未改姓名生产逻辑、期望文字或超时。46083 最终四文件（含 DM 窗口）又因 worker 启动失败而 0 用例/4 errors，最终 Web 类型 0；不再重试，修正后的 Web 消费者和生产反证仍未验收。历史 DM 同批记录为工作区 `core/verify/dm-unread-overflow.md`，不属于本次最小提交；旧失败保留，不声称候选截图已通过。

## 2026-10-11 系统消息签名者误查询修正

真实浏览器 `kailo-ui-status` 在已有授权频道读到消息接口 200；九条
`author-profile` 请求返回 503 / PRECONDITION / DEPENDENCY_UNAVAILABLE。
逐事件对照当前返回窗口，失败对象均为 kind 40099 系统消息，签名者是同一
Relay 公钥；普通 kind 9 消息的作者请求存在真实 200。这个现象不是全部
作者资料不可用，也不证明 Agent 执行失败。

四步结论：

1. 固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/lib/formatTimelineMessages.ts::collectMessageAuthorPubkeys`
   对系统消息收集 payload 的 actor/target，而非 Relay 签名者。当前 Web
   `useMessageAuthorLabels` 对整个可见窗口建作者请求，是宿主适配错误。
2. 原 hook 同时被频道、频道线程、Inbox 线程和论坛消费；输入保留已有 kind，
   用共享 `KIND_SYSTEM_MESSAGE` 排除系统签名者查询。系统行仍由原
   `SystemMessageRowSurface` 和已准入成员资料呈现；没有删除事件、布局、菜单、
   参与人点击或普通消息姓名/头像。Native 原收集逻辑未变，无契约或存储迁移。
3. Core 的消息证据、签名、scope、fresh admission 和 profile.pubkey 校验均不放宽；
   不给系统签名者创建身份、不借其他事件或目录绕过被拒绝的读取，不产生外部写副作用。
4. 空窗口和全系统窗口不发普通作者查询；混合窗口仍按每个普通事件单独准入。
   unavailable、拒绝、换 scope、迟到响应继续原缓存排除逻辑，错误分类保持 `06` §4。
   不新增持久状态、重试或成功终态。

生产修正后在原 `MessageAuthorProfile.test.tsx` 添加混合窗口消费者用例，断言只有
普通消息发生一次作者读取；原两个 hook fixture 补齐实际 kind。没有新增检查脚本，
没有修改运行中的冻结构建输入。正式源码与既有 Data 私有 SDK 副本已按窄补丁同步；
`git diff --check` 对两文件实际退出 0。该新用例及生产破坏/还原尚无执行结果，
不能将旧截图或旧类型结果算作本修正验收；当前未提交、推送或部署。

同日首次四消费者集中命令先执行 `tsc --noEmit`，成功后进入原 Vitest，
最终退出 1：ConversationSidebar 14 项通过，MessageAuthorProfile、
ChannelThreadPane、InboxThreadPane 三文件均因 forks worker 启动超时未执行。
原日志 `/volumes/data/kailo/tmp/ui-dm-unread.LopLWa/author-system-final-20261011.log`
的 SHA-256 为 `bdd00b01e50d4a7c30b0bf7bea724e315a7d8ae79e1dbae1bd3fce2d72812731`。
这不是三文件产品断言通过，也不是新增系统消息用例的负向反证。

同一私有输入、同一 4 CPU/8 GiB SDK 随后只把 Vitest 的池选择为 threads，
不改生产源码、用例、断言或超时，不重复 TypeScript 编译。实际命令为：

```sh
node node_modules/vitest/vitest.mjs run \
  src/platform/ui/MessageAuthorProfile.test.tsx \
  src/platform/ui/ChannelThreadPane.test.tsx \
  src/platform/ui/InboxThreadPane.test.tsx \
  src/platform/ui/ConversationSidebar.test.tsx --maxWorkers=1 --pool=threads
```

43778 实际退出 0：4 文件、82 项通过，分别为 25、21、22、14 项。
React `act(...)` 警告保留，没有屏蔽 stderr；成功不抹去上一条 forks 启动失败。
随后仅在隔离副本删除 `useMessageAuthorLabels` 的系统消息过滤，使用同一命令的
单文件 `-t 'does not query a Relay system-row signer'` 定向执行：20849 退出 1，
明确报作者读取期望一次、实际两次，包含不应读取的系统事件。此为真实消费者
断言失败，不是 worker 启动失败。apply_patch 恢复生产原行、与正式文件 cmp 退出 0，
75861 还原复验退出 0：1 项通过，24 项按本次定向选择跳过；没有残留破坏。

原日志目录仍为 `/volumes/data/kailo/tmp/ui-dm-unread.LopLWa/`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| author-system-threads-20261011.log | eb157f406f635281bc415df98ad6313b88da6f13c2c9cda5e665e778d05a7c7e | 四消费者 82 项通过 |
| author-system-negative-20261011.log | 62b93ddbe474c3e24f610776a186f9b7f7cb4e9ebd5ef52b0f6341da1fa7ef7f | 移除生产过滤后断言失败 |
| author-system-restored-20261011.log | 53c17222d89a9af7b81fd936c474c510195d63180e9a5df8ce587877ddb77d2d | 原字节还原后定向通过 |

本结果补齐该源码批的类型、消费者和系统消息反证证据，不是新镜像、真实频道
修复后截图或完整交付；正在构建的 bd47 冻结树不含这次系统消息过滤增量。

## 2026-10-11 最小提交切分与当前线上复核

正常业务账号在 04:57 UTC 的只读复核中，频道 messages 返回 200；窗口内四个
kind 40099 的 `author-profile` 返回 503，错误体均为
`PRECONDITION / DEPENDENCY_UNAVAILABLE`，同窗口普通 kind 9 的作者请求返回 200。
当前部署仍为 `sha256:e2fd03703af893438467954c20bf5aef154ad0b29d0914ac79143f1d624f4415`，
不能把已有工作区修正称为已部署修复。

具体拒绝链为 `web_transport.rs::message_author_profile_for` →
`read_message_event` → `channel_message_event`：kind 40099 不属于普通消息证据，
在 `web_profile.rs::read_author` 之前已被拒绝。保持 Core 的实际消息证据校验，
修复责任在 Web 不应请求 Relay 系统签名者；本批不改 Core 或身份/权限数据。

为避免把其他未完成交互混入主线，以
`76f2378fd0698ee5679bb160a5ac8cd02a3acde2` 为提交基线，私有 index 仅组合原八文件
姓名派生链、系统消息过滤及断言。源码共八文件 +254/-51，源码候选树为
`91d0d90dabda49645712f79783074d1daf7373f7`。其他线程视图切换、历史、草稿、DM overflow
改动不在候选中。三处 observer 等待以及两处逐事件作者读取断言沿上述已实测纠正纳入，
没有新增依赖、契约、生成类型或迁移。现有其他五个暂存 blob 不参与本批。

隔离验证目录为 `/volumes/data/kailo/tmp/web-author-candidate.RwJqMf`。
该目录的 Web 与共享 TypeScript 源码从精确候选树导出；原锁文件与既有依赖副本一致，
`file:` 平台包重新投递为候选树原字节，旧依赖仅只读挂载，未混入工作区其他源码。
实际执行容器 `kailo-web-author-rwjqmf` 为 4 CPU / 8 GiB / memory+swap 8 GiB，
镜像固定 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
与主线程全量检查不共享可写缓存。

本精确候选实际执行：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run \
  src/platform/ui/MessageAuthorProfile.test.tsx \
  src/platform/ui/ChannelThreadPane.test.tsx \
  src/platform/ui/InboxThreadPane.test.tsx --maxWorkers=1 --pool=threads
```

结果：`TYPECHECK_EXIT=0 TEST_EXIT=1`。MessageAuthorProfile 的 24 项全部通过；
ChannelThreadPane 与 InboxThreadPane 各在 threads worker 启动阶段超时，两个文件
均 0 项执行，报 `Timeout waiting for worker to respond`，不属于产品断言通过。
Vitest 原输出为 `1 passed / 24 passed / 2 errors`、Duration 212.23s；
React act 警告保留。没有修改超时、断言或执行器，也没有循环重试。
日志 `validation.log` 的 SHA-256 为
`8c21d77bb30286d117d66a74f87dd899bf20612747ebd3002b9e068e0b815800`。
候选完整八源码差异为 `candidate.patch`，SHA-256 为
`c4e041510bd2cfc165fb7eb89390891f3f23eaddf5c7e3add19484e38d8af868`。
本次私有 SDK 容器退出 1 后已删除，保留 Data 快照和日志，不占运行窗口。

候选 `MessageAuthorProfile.tsx` 与上述 43778/20849/75861 使用的原 SDK 最终生产
文件逐字 `cmp` 退出 0；既有移除过滤失败/还原通过仍保留为该保护的历史证据，
本次没有重新执行负向用例，不称为本次精确候选的负向复验。
主线程交叉复核后允许按已验证范围阶段提交；两线程消费者仍受启动失败阻断。
全量门禁由主线程另行汇总，本记录不宣称全量通过、已部署、修复后截图或完整恢复。

## 2026-10-11 已提交输入的两线程消费者补验

主线程推送 `3df3c396c065b8500a2da648d9b7aa8f508d19ea` 后，在资源窗口释放时，
复用上述逐字相同候选、固定 SDK 镜像和私有 Data 依赖副本，串行执行两个原套件。
容器 `kailo-web-author-serial-rwjqmf` 启动前回读为 4 CPU、8 GiB memory/swap、
UID/GID 1000，旧依赖只读挂载；没有更改生产代码、断言、worker 池或超时。

```sh
node node_modules/vitest/vitest.mjs run src/platform/ui/ChannelThreadPane.test.tsx --maxWorkers=1 --pool=threads
node node_modules/vitest/vitest.mjs run src/platform/ui/InboxThreadPane.test.tsx --maxWorkers=1 --pool=threads
```

实际结果：频道线程 17/17，通过耗时 12.16s；私聊线程 22/22，通过耗时 4.41s；
`CHANNEL_EXIT=0 INBOX_EXIT=0`，容器终态 exited 0，随后仅删除本次已退出容器。
React act 警告保留。日志为同候选目录的 `consumer-serial-20261011.log`，SHA-256：
`f3cb490bce900ad753e62527bf0487e540b0c6d9bbc3416aba41dde968ebe332`。
该结果补齐最小提交两线程消费者验收，不抹去前次启动失败，不代表真实部署或全量恢复。

发布前另核对现网冻结树 `252cf1239c04717370df803dec302aba354a8e32` 与当前 main
`1e8811854de99cefabfca2cf79cdd0cba93e79d8`：Web 原构建输入相差 47 文件、+293/-2357。
main 尚不包含现网已有的线程历史、线程模式及 Workflow 频道选择器等未提交恢复。
因此不能把当前 main 镜像直接替换现网并称作无回归发布；在这项来源收口前未切换在线 Web。
完整差异留在 `/volumes/data/kailo/tmp/web-author-release-20261011.1kMi4F/live-to-main.patch`。
该 main 输入曾通过原 `tools/build-upstream.sh web-client` 启动既有 8 CPU/16 GiB
BuildKit；确认上述回退范围后，精确取消本次 buildx PID 472768，句柄 15353
退出 130，原输出 `Canceled: context canceled`。保留同目录
`build-web-client.pDpajt.log` 和缓存；未完成产物、未更新部署 pin、未切换在线服务。
