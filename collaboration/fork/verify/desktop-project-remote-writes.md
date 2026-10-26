# Desktop 远程分支与 owner merge 定向核验

日期：2026-10-26。权威为 DD-160(2)、DD-118(5)(6) 与 DD-81；上游原生消费者来源为固定 Buzz `779af8886caae1317b4de962082429867ab61503`。本增量基线是 `019bfa0c086c594d76675227dc37cdc8865aa2ad`，当前源码固定为 `5d8767b16dafcbeb9f4e93131a1d34929f2aa924`，各阶段实际执行的固定 SHA 在下文分别记录，分支 `codex/dd160-remote-writes-20261026`。基线前的本机检出界面与证据已另行交付，不应重复选择。

## 实现与边界

Desktop 原生宿主现接通原共享 Projects 的分支创建、删除和 owner merge，使用既有 `buzz-project-git` branches/merge 与页面消费者。请求只接受仓库坐标、引用和既有操作参数；仓库地址从当前 Relay 推出，本设备 CLIENT 每次新签 NIP-98，私钥不交给 Git。原登录代际、Relay 和设备公钥在等待前后复核。owner merge 必须由坐标 owner 的实际设备公钥执行，作者显示名从本机原会话入口读取实际 HumanIdentity，不采纳页面自报的 owner、作者或 URL。

`project_git_intent.rs` 在应用数据目录按 Community 与设备分区保存 SQLite 操作意图及事后证据。发送前事务持久化幂等键、repo/ref、old→new、merge 作者/时间，使用 DELETE journal 与 synchronous FULL；同 ref 的待确认操作不能被新请求覆盖。SQLite 本身拒绝改写已冻结业务请求、引用、作者和终态；已签事件只允许在确定未送达后由同意图的新签尝试替换，旧签事件与结论追加保留。重启先用原 info/refs 对账：等于 new 确认成功，等于 old 只允许相同冻结意图续发，其他状态冲突，不能查明保留 UNKNOWN。重建 merge 时源引用变化导致冲突并结束该 ref 的占用；网络失败继续保留冻结声明。Git 成功事实不被迟到传输错误覆盖。

merge 后沿设备签名、原提交接缝与同 ID 的 writer 证据形成并核对 1631，保留原 review/root/repository/owner/author/merge-commit 标签。Community、事件与 ID 在发送前持久化；ACK 或同 ID 的已接受证据决定成功，明确拒绝结束事件阶段。丢响应先核原 ID，不能改业务意图；只有确定未送达才允许同意图的新签尝试。SQLite 不存仓库正文副本或私钥，没有新增 Core 代理推送、数据库迁移、Workflow 或第二授权权威。

Native 已沿原 native/community 消费部署的 `PUBLISH_RESULT_SETTLE_SECONDS` 与 Core 可信观察时刻，未知事件仅在同 Community writer 缺失、Core 严格过窗和 Relay settled 同时成立时恢复。缺事实、撤权、旧 Community 不明等情况继续 UNKNOWN。Core 合同生成、合批与发布由根工作流统一执行；真实安装、Win11、生产操作仍待发布后验收，不把本批源码检查称为 DD-160 全部交付完成。

## 固定源码检查

所有源码由 CI 节点从 GitHub 固定提交导出；使用原 `container-safety.sh` 核对实际 CPU、memory 与 memory+swap。输入位于 NVMe，缓存和日志位于 Data，没有在宿主运行项目 Node/Cargo 构建或测试。

- 原 Desktop SDK `sha256:df8a3475e3e32ecf5ac79f9c12763b8ce5d4f91a75c25007fd9bfa5b282fc081`，Rust 1.95、原 GTK/WebKit、默认 feature、原 Cargo.lock。`dd7dc716a8d652279ee8498cecb2e086f9c82374` 的 `cargo test --offline --locked --lib commands::project_git_` 为 17 passed，共享 Git crate 为 38 passed，2 CPU、16 GiB，均退出 0。后续没有修改共享 crate 或锁文件。
- 最终产品 `bd1b158b45fb26ab5b7ef8028c55604fecabd328` 使用同 SDK、1 CPU、4 GiB，原 `cargo test --offline --locked --lib commands::project_git_` 为 20 passed、0 failed、462 filtered out，退出 0，OOMKilled=false。包含实际 SQLite 重启、声明不可改写、未知结果对账、merge 重建冲突与网络失败分流，以及本机检出和原生读取既有检查。格式化由同 SDK 的 1 CPU、512 MiB 容器执行并回填。
- 原前端 SDK `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，1 CPU、4 GiB，固定 `f1b83dcc47f180db62f549ed1d621e6789350708`。根 pnpm 10.33.4、Desktop 独立工作区 pnpm 11.4.0 均执行 frozen install；platform 生产与 test tsc、Desktop tsc、原 i18n 生成与 check 全部退出 0。四个原消费者文件合计 46 passed、0 failed：native 11、project-git 15、branch-review 13、review-merge 7。后续提交仅加强 Rust SQLite 声明和测试，前端源码未变。原 React act 提示保留在日志中，未删除断言绕过。
- DOM 检查通过真实 Projects 页面、原 hooks、查询与保留意图消费者，分别以原 BFF 和 Native 命令边界执行分支创建/删除未知后重试，以及 owner merge 确认、1631 回读和原幂等键重新确认；不是生产 Relay 或真实安装包操作。

首次原生编译在已知不能跨 await 保留非 Sync 的 SQLite 引用处失败；将提交阶段所需 journal 以拥有值传递并缩短引用作用域后通过。后续自检补齐原错误码映射、merge 重建确定冲突释放和 SQLite 不可改写约束，分别保留实际 17、19、20 项通过日志，不以早期结果替代后续源码。

## 丢响应与反向验证

原生回归使用真正的 Git HTTP 与 `git http-backend`，在接收 receive-pack 前重开 SQLite 核实 DISPATCH 已落盘；服务端实际应用 push 后丢 ACK 并使紧接的 info/refs 失败。调用结果 UNKNOWN；关闭并重开 journal、恢复查询后按原引用确认成功，receive-pack 次数仍为 1。

反向验证固定 `6fbd532351d801cbb3ab322d5a952dcd3889161d`，仅在独立源码导出中临时把 `journal.find(key, &request)?` 改为不读取旧意图。上述原 HTTP 重启回归真实失败：0 passed、1 failed、退出 101，错误为 TARGET_STATE_CONFLICT；不是编译失败。逐字还原后同一检查 1 passed、0 failed、退出 0，两个容器 OOMKilled 均 false。原始与恢复后的 `project_git_write.rs` SHA-256 相同：`77e3679cda8976f59b426d03b09649f8778bba09f56bdb1ff0ab8448b0fd6a9d`。临时缺陷未进入 Git。反向验证固定源码早于最终 SQLite 防线增补，不将它标成最终 SHA 的重跑。

## 原始证据与未验收范围

CI 节点根路径为 `/volumes/data/kailo/verification/dd160-remote-writes/`：

- `<原生固定SHA>-cargo.log` 及同前缀 `preflight/limits/exit/oom.log` 保留原生执行结果。
- `f1b83dcc47f180db62f549ed1d621e6789350708/frontend.log` 与同目录 `frontend-{preflight,limits,exit,oom}.log` 保留前端结果。
- `negative-6fbd532351d801cbb3ab322d5a952dcd3889161d/` 保留 mutated/restored 日志、真实退出码、限额、OOM 和恢复哈希。

本批所有消费者容器均终态并删除。未生成新安装包、未发布共享服务、未在 Win11 或真实 Desktop 完成 V-SCN-264/265 操作；也未替代 DD-157 三账号双主题发布后验收。全量集成门禁、Core 事实的合批发布、安装包及真实端到端验收由根工作流统一执行，原发布门禁保留。

## 同日 DD-81 部署事实与已知未送达恢复

源码增量基于此前 `8ac00ac9e32a547a389b7379a0b7d0b8bfa7f511`，原生定向固定源为 `fa06d4b819b1dbdb5ccef1b1e109d5505acf6344`。`66211f082b5ca37243dbd93c5bfac84c4d242cb0` 在原 native/community 增加可选 `publishResultSettleSeconds` 与 `publishResultObservedAtUnixSeconds`：窗口来自 Core 对账器同一个启动配置对象，时刻来自 Core 原 UTC 时钟，响应 no-store；没有另一套窗口、默认值或 Webview now 参数。Native 直接经 NativeSession 读取，复核原 Relay 与登录代际；旧 Core 缺失字段不猜结算窗口。四侧原合同往返检查增加新事实及旧缺省用例；生成物、Core 编译与四侧执行留给集中合批，本轮未声称这些检查通过。

Native 同一个状态消费者现先查原 ID，再只对持久 NOT_DELIVERED 的同一 merge 意图重建 1631；新尝试保留原签名者、正文、标签与 merge commit，发送前重新核仓库准入并持久化，未知原意图不能被替换。SQLite 以追加证据保留旧签事件与结论；从旧版本只有 intent 行的数据库升级时，也在替换事务中先补存旧证据。退休期间晚到的查询、ACK 不终结新会话操作。此时仍不把普通查询为空判作未送达。

原因已经源码复核：原 Relay 的 kind5 能软删除 1631，也能再次软删除前一条 kind5；原 ID 与墓碑查询同时为空，仍可能是已送达。包括软删除的 writer 读取保留这项事实，但还需解决原 ingest 先校验时间、稍后异步入库的在途竞态。新的窄读取接缝需先冻结设计与 writer 串行/过窗规则；本阶段没有开放新 HTTP 出口，不能据“窗口已到”重签未知事件，也不称完整 DD-81 收口。

原 Desktop SDK（上文同 digest）、1 CPU、4 GiB memory/memory+swap、默认 feature，固定 `fa06d4b819b1dbdb5ccef1b1e109d5505acf6344` 的 `cargo test --offline --locked --lib commands::project_git_`：25 passed、0 failed、462 filtered out，退出 0，实际重编译 18.29 秒。新增用例经同一生产状态消费者和真实 SQLite 验证可信事实/严格时间边界、原 ID 查证、无送达证据不猜、已知未送达的同意图恢复、旧库升级、撤权、退休及迟到 ACK。原生 I/O 边界在这些用例中受控，不冒称实际 Relay 或安装包通过。原 20 项中的真实 Git HTTP 丢 ACK/重启回归仍通过。OOMKilled=false，本批容器已删除；证据同目录 `fa06d4b819b1dbdb5ccef1b1e109d5505acf6344-{cargo,preflight,limits,exit,oom}.log`。后续新接缝须另留真实数据库/HTTP、负向及最终固定源码证据。

## 同日 writer 送达证据实现与实际检查

本阶段依据已推送设计权威 `0d8f9cc11b8765e66a10b5aaa8524c4714f98a4a` 的 09「本机合并状态的送达证据」、DD-81/160 与 V-SCN-265 实现，取代上一阶段“尚未开放证据出口”的源码边界。没有放宽 Core 普通消息或 Projects 的原对账算法。

`buzz-core::publication` 提供 Native 与 Relay 共用的四字段响应和已签请求校验；原 900 秒准入由 Relay ingest 与 writer 共用，Native 只消费 Relay 的 settled 事实。`POST /events/delivery` 复用原 Host→Community、真实 NIP-98 URL/method/payload 验证、共享 Redis admission/replay、relay membership、Git ban 与 live 30617→Channel→当前成员读取准入；owner 不绕过。请求只接受有效已签、空正文、无 expiration、本人为 30617 owner 的 1631，响应只有 eventId/communityId/accepted/settled 且 no-store。等待前后复验 ACTIVE Community、Host 绑定和权限；拒绝和依赖失败不成为缺失。

`buzz-db::store::publication` 在 writer 事务内持有 `(Community,eventID)` advisory lock，读取原事件行，包括软删除；没有新增送达表。原 `event::insert_event` 的 1631 分支、`insert_event_in_transaction` 经 `insert_event_on`，以及原 RPC ingest 使用的 `insert_event_with_thread_metadata_tx` 均在同锁后复验原时间准入。证据事务显式 READ COMMITTED，防止部署的 REPEATABLE READ 默认值让等待锁之前的旧快照漏看刚提交的原事件。匹配使用已验证 canonical event ID；同 ID 的另一份有效随机 Schnorr 签名仍是同一事件，不能因签名字节不同误拒绝。

Native 同一个生产消费者先读取 Core 可信观察，再查原已签事件。只有原冻结 Community 匹配、Core 已严格过结算窗且 Relay settled 的权威缺失才持久化 NOT_DELIVERED，随后允许同业务意图的新签尝试，并保留旧签事件证据。历史 UNKNOWN 没有 Community ID 时不能采用当前 Host 的肯定或否定回应：同 ID 也可能存在于 Host 新绑定的 Community，恢复必须有原范围证据。新发送在副作用前冻结 Community 与已签事件；网络等待后重新检查登录代际，迟到的证明或 ACK 不能被已退休身份采用。

- Native 最终固定 `5d8767b16dafcbeb9f4e93131a1d34929f2aa924`，原 Desktop SDK、1 CPU/4 GiB，`cargo test --offline --locked --lib commands::project_git_` 为 29 passed、0 failed、462 filtered out，exit 0，OOMKilled=false。包括实际 HTTP 的原事件正文/设备新签 NIP-98/重复请求独立 nonce/退休前后围栏，以及同一生产状态消费者的双时间窗口、Community、旧意图、重签与真实 SQLite 证据；最终增加旧 UNKNOWN 缺 Community 时不采用 positive proof 的范围围栏。初轮 `3c4bbd2f01889314b6ab052cc52e03aaa793df9f` 的 29 项通过日志仍保留，不作为最终源码的替代。
- 同一 Native 固定源临时移除 `proof.settled` 条件，原 `writer_absence_requires_both_prior_core_window_and_original_community` 真实断言失败，exit 101；逐字恢复后 1 passed，exit 0。文件 SHA-256 前后一致：`a9be856344c08a0c5948f41b85e80127af285b0ff65c8beadafa9882a9c056e9`。日志保留在 `negative-3c4bbd2f01889314b6ab052cc52e03aaa793df9f/`。
- 后端固定 `c3f1f2a679085680d90fd45a3ee2c0b8058a61d4`，原检查 SDK `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，1 CPU/4 GiB，加独立 PG 1 CPU/2 GiB、tmpfs、独立网络。原 Shared `publication::` 2 项、DB `store::publication::tests` 4 项全通过。DB 用真实 writer 事务验证提交/回滚等待、1631 与其墓碑均软删、跨 Community 与归档、等待锁后过窗拒写，以及同 canonical ID 的另一份有效签名。
- 同一后端固定源的两个反向分别恢复旧快照风险、取消取得锁后的时间准入；原测试均真实断言失败，exit 101。逐字还原后 DB 4 passed、0 failed，整个作业 exit 0。源哈希前后一致：`f94940ad5c65847963ddead257a611fdbfdd4d7f36c6cedb6e98fe6e81c8973d`。日志在 `delivery-c3f1f2a679085680d90fd45a3ee2c0b8058a61d4/`，末尾脚本文字仍写旧的“three”，准确数量以 Cargo 的 4 passed 为准。

保留真实失败：`delivery-f8362a07d5479292db43def006852d3e9f568aba/` 的反向恢复轮 exit 101。跨秒测试输入碰到相同 ID 的不同有效签名，暴露全 Event 比较造成的误拒绝；随后修复 canonical ID 查证，并固定各测试操作的时间基点使其 ID 必然不同。该失败不作为通过结果。

最终 Relay 固定 `9abd537d2d1bf0299abd34995213c48333e19598`，上文原检查 SDK、2 CPU/16 GiB，加独立 PG 1 CPU/2 GiB 与 Redis 0.5 CPU/128 MiB（各自 memory+swap 同 memory）。原 `api::delivery::tests` 3 passed、0 failed、1139 filtered out。包括真实 router/NIP-98/payload/replay/ban/owner/member/Community 准入；通过 `pg_stat_activity` 和 `pg_blocking_pids` 确认 HTTP 已实际等待 writer 后才撤成员、换 Host 或归档；原 `/events` 发布请求通过前置时间检查后等锁、跨窗后明确返回 BAD_REQUEST，writer 无行且 settled=true。HTTP 与 WebSocket 原入口均复用 `ingest_event` 的同一写入分支；服务写租约 wrapper 也经受保护的 `insert_event_with_thread_metadata_tx`。

同一固定源临时移除等待后的第二次 `readmit`，原权限撤销检查真实断言失败，exit 101；逐字恢复后原 3 项再次全通过，整个作业 exit 0、OOMKilled=false。`api/delivery.rs` 恢复前后 SHA-256 相同：`2a559efbe41d5e4637037585e882278a114a6bae3bb846afff3a1e12c6122dcf`。原日志与限额在 `relay-delivery-9abd537d2d1bf0299abd34995213c48333e19598/`。初轮 `relay-delivery-c3f1f2a679085680d90fd45a3ee2c0b8058a61d4/` 的 2 项通过日志也保留；最终新增实际等待同步和原发布入口检查，没有改变此前已通过的 Native/Shared/DB 产品代码。

最终 Native 同一 `5d8767b16dafcbeb9f4e93131a1d34929f2aa924` 还做了历史 Community 反向：临时允许没有原 Community ID 的 UNKNOWN 采用 positive proof，原消费者检查真实断言失败、exit 101；逐字恢复后同一检查 1 passed、exit 0。SHA-256 前后一致：`6ec59145798502269e96a042938fcd9fcb5c237f8c18cd290f9ed1b51acf3d3f`，日志在 `negative-5d8767b16dafcbeb9f4e93131a1d34929f2aa924/`。这一历史状态没有足够范围证据就保持 UNKNOWN；已证明 NOT_DELIVERED 的旧尝试仍可在新发送前冻结 Community。最终 Native 增量没有更改上述已验证的 Relay、DB、Shared 源码。

本阶段全部自有检查容器、临时 PG/Redis 和独立网络已实际回读确认不存在，资源已通知根工作流释放。Core 合同生成、设计 pin 和合批门禁由根工作流统一执行；Core 普通消息“墓碑再次删除”的缺口未在本批放宽或冒称修复。本文不将上述 Rust 定向检查算作安装包、Win11、生产发布或 DD-157 三账号双主题真实验收。

## 同日冻结 Community 的实际提交与回执围栏

前一 writer 批的检查没有证明“查证后 Host 改绑，原 `/events` 仍只能写冻结范围”。复核还发现 `/events/delivery` 自行增加了没有原配置来源的 16 KiB 上限。上述两个缺口不由前一批的通过结果覆盖；本批依据独立推送的设计权威 `bb41415a5241ce31564f9da01272ee6b82158c60`，完成 09 同节、DD-160 与 V-SCN-265 的窄接缝，不扩张普通消息或 Git receive-pack 的协议范围。

删除局部 16 KiB 限制，继续消费原 `router::build_router` API 分组的 1 MiB `RequestBodyLimitLayer`。原 `/events` 新的限定形式为 `POST /events?community=<canonical UUID>`，设备 NIP-98 同时签入唯一、恰好两个字段的 `community` 标签。query 与标签缺一、重复、畸形、非 canonical UUID、彼此不一致或不匹配本次 Host 解析的 Community，均在 ingest 前拒绝。验过的同一 TenantContext 继续进入原 admission/replay/member/ingest/writer；本人的空正文、无 expiration 的 1631 还消费原 Git ban 与 live repository 读取准入，未改变原 quota/replay 执行顺序。肯定 ACK 只回填该已验范围的 `community_id`，没有再次按 Host 查找来决定写入或 ACK 的范围。

Native 在 EVENT_DISPATCH 持久化后重读 journal 的 Community，放入完整签名 URL 与标签。只有同 event ID、同 Community 且 accepted=true 的回执才记 ACCEPTED。2xx 缺少或错配 Community、错 event ID、accepted=false、坏 JSON、服务端 401/403 及连接建立后的断流均保持原事件和 DISPATCHED/UNKNOWN；不让普通发布错误字符串把冻结意图改成 REJECTED。journal 重读失败也保留带原 operation key 的 UNKNOWN。明确无法建立连接等原有发送前失败分类仍沿原路径处理。普通无 query、无 community 标签的提交及其 ACK 保留原语义；原 NIP-98 URL verifier 对 query 严格比较，旧 `/events` 的无 query 预期 URL 无法接受新消费者的签名请求。

固定 `1a7c9e7d00a0268410315338701bea50597dcd1f`，原 Desktop SDK、1 CPU/4 GiB、默认 feature，`cargo test --offline --locked --lib commands::project_git_publication::tests` 为 11 passed、0 failed、481 filtered out，exit 0。新增证据使用实际 loopback HTTP、真实设备签名与同一生产 publication/SQLite 消费者，逐项检查请求 URL、唯一 community 标签、payload 与已持久化范围，以及上述 9 类回应/断流。临时移除 `relay/submit.rs` 的 ACK Community 匹配条件后，同一新增检查真实断言失败、exit 101；逐字恢复后 1 passed、exit 0。SHA-256 前后一致：`95c67979aa30f5908e2d7c509e6c74739e9bdbe767981ad53776e8bdaad4634c`。日志在原证据目录的 `1a7c9e7d00a0268410315338701bea50597dcd1f-{cargo,preflight,limits,exit,oom}.log` 与 `negative-1a7c9e7d00a0268410315338701bea50597dcd1f/`。

保留本批真实失败：同一 `1a7c9e7d00a0268410315338701bea50597dcd1f` 的 Relay 首轮编译 exit 101，原因是新增认证元数据后 gifs/workflows 两处解构未加 `..`，以及 Community UUID 值与引用比较错误；不是 Relay 业务检查通过。原日志保留在 `relay-delivery-1a7c9e7d00a0268410315338701bea50597dcd1f/`。修复后才执行下述最终 Relay 轮。

Relay 最终固定 `d5c4667f4d82b326dbdab7c253d0565a2c45119f`，原检查 SDK、2 CPU/16 GiB，加原隔离 PG 1 CPU/2 GiB、Redis 0.5 CPU/128 MiB、独立网络与 tmpfs，`cargo test --offline --locked --lib -p buzz-relay api::delivery::tests -- --ignored --test-threads=1` 为 6 passed、0 failed、1139 filtered out。新场景实际先取得旧 Community 的 proof，再将 Host 改绑至仍授予该设备同一 repository 权限的新 Community：冻结请求返回 401，两个 Community 均无该事件行；恢复原绑定后，同意图成功写入并返回匹配 ACK。另实际覆盖原无 scope 提交成功、缺失/重复/空/畸形/错配 query/tag、签名后篡改标签、旧无 query 预期 URL 验签拒绝，以及 17 KiB 合法 proof 可处理、超过原 1 MiB router 上限返回 413。

同一 Relay 固定源临时取消 Host 所属 Community 与冻结 UUID 的比较，新场景实际收到错误的 200，原检查断言期望 401 而失败、exit 101；逐字恢复后原 6 项再次通过，整个作业 exit 0、OOMKilled=false。`api/bridge.rs` SHA-256 前后一致：`a967362e6f1ffc24d136353e83b6ef9f69dbadc9b0cfe1c9698425c6fe53cdd8`。原日志、实际限额、终态与 OOM 回执在 `relay-delivery-d5c4667f4d82b326dbdab7c253d0565a2c45119f/`。容器、临时 PG/Redis 和独立网络已实际确认不存在，重资源窗口已通知根工作流释放。未改 DB writer 实现，未重复原独立 DB 全批；不把这些结果扩写成全工程、旧 Relay 二进制混部署、安装包或生产 UI 验收。

最终 Native 固定 `f8cb31cf134e1204947f962c27635cd6e421ffd8`，包含原 SDK 格式回填与 journal 重读失败的 UNKNOWN 保真修正，同一原 Desktop SDK、1 CPU/4 GiB、同一 `commands::project_git_publication::tests` 命令再次 11 passed、0 failed、481 filtered out，exit 0，OOMKilled=false；实际编译 11.29 秒。终态日志为 `f8cb31cf134e1204947f962c27635cd6e421ffd8-{cargo,preflight,limits,exit,oom}.log`。此提交没有修改最终 Relay 检查所覆盖的任何 Relay 源码。当前自有 Native 验证容器也已退出清理；这里只交付固定源码与检查证据，根工作流负责设计 pin、合同生成和合批门禁，生产发布、Win11 安装及三账号双主题 after 走查仍须分别完成。
## 合批生成与三侧 wire 消费者（2026-10-26）

固定集成 `65f82f0b897a6282479ea6a335ca733196968806`、设计
`bb41415a5241ce31564f9da01272ee6b82158c60`：原工具 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，
1 CPU / 2 GiB，四侧生成/check、共享目录及注册表均退出 0，42 能力、20 Workflow kind。
生成物已逐文件回读提交，原件在 CI
`/volumes/data/kailo/verification/phase1-integration/profile-65f82f0b8/`。

固定 `01f332f3a2d3c13a2e46ea361c73d4b81ac5bd81` 的同一 SDK，1 CPU / 4 GiB：

- Node 24.21.0 / pnpm 10.33.4：原 contracts 类型检查与 **74/74**。
- Go 1.25.14：原 contracts `-count=1`，**57** 个顶层、**50** 个子用例通过。
- Dart 3.9.4：原 `dart pub get` 后 **75/75**；库没有入库 pubspec.lock，未借用
  Mobile 锁。解析锁 SHA-256 为
  `d0690a2bc70d95e2d5ecd3312b60d2e6f2caa87105066533d7e00721b3feebde`。
- 临时从真实生成 `toJson` 移除 `publishResultObservedAtUnixSeconds`，原 roundtrip
  因缺少 map key 失败；逐字/SHA 恢复后 75/75。恢复生成文件 SHA-256 为
  `99350571f7306159a7b39de7c93fcc0673061457ec40e0dada538f2607ecf33a`。

CI 原件位于 `/volumes/data/kailo/verification/buzz-r10/`，目录为
`community-wire2-01f332f3a2d3c13a2e46ea361c73d4b81ac5bd81/`（TS/Go通过，随后不适用
的无锁 enforce 命令失败，整体 exit 1）及
`community-wire3-01f332f3a2d3c13a2e46ea361c73d4b81ac5bd81/`（Dart 正/反/恢复，exit 0）。
第二目录保存实际解析锁，主日志 SHA-256 为
`06b767781789ec66940a9050d6ba70dd0f7d4afe4fb29d5f7a16e42e448d98c4`。
首轮缺锁预检早停独立保留，不计消费者失败或通过。本批容器均已清理，无 OOM。
Rust 合同及 Core 联合结果由合批单独记录，不用三侧结果替代。

固定集成 `1dd5ee3e5fcf22f07ffd93587de459fffb3f124c` 的写入/保留源码复核：
`store/partition.rs` 仅建分区；硬删状态历史仅限 30078/read-state 与 30003/mesh；
频道 TTL 只归档；全 Community purge 必须 fenced/tombstone，purge 后不能 abort
回 ACTIVE。本版本生产 1631 INSERT 均进入已验证 guard，替换写入不接受该 kind。
这是固定代码范围的结论；屏障位于 Rust 写者，部署时全部在线 writer 必须使用匹配
实现，不外推旧 Relay 混跑、手工 SQL、恢复或外部分区维护期间仍能证明缺失。
