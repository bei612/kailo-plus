# Desktop 远程分支与 owner merge 定向核验

日期：2026-10-26。权威为 DD-160(2)、DD-118(5)(6) 与 DD-81；上游原生消费者来源为固定 Buzz `779af8886caae1317b4de962082429867ab61503`。本增量基线是 `019bfa0c086c594d76675227dc37cdc8865aa2ad`，当前源码固定为 `9abd537d2d1bf0299abd34995213c48333e19598`，各阶段实际执行的固定 SHA 在下文分别记录，分支 `codex/dd160-remote-writes-20261026`。基线前的本机检出界面与证据已另行交付，不应重复选择。

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

Native 同一个生产消费者先读取 Core 可信观察，再查原已签事件。只有原冻结 Community 匹配、Core 已严格过结算窗且 Relay settled 的权威缺失才持久化 NOT_DELIVERED，随后允许同业务意图的新签尝试，并保留旧签事件证据。历史 UNKNOWN 没有 Community ID 时不能凭首次空回应否定送达。新发送在副作用前冻结 Community 与已签事件；网络等待后重新检查登录代际，迟到的证明或 ACK 不能被已退休身份采用。

- Native 固定 `3c4bbd2f01889314b6ab052cc52e03aaa793df9f`，原 Desktop SDK、1 CPU/4 GiB，`cargo test --offline --locked --lib commands::project_git_` 为 29 passed、0 failed、462 filtered out，exit 0，OOMKilled=false。包括实际 HTTP 的原事件正文/设备新签 NIP-98/重复请求独立 nonce/退休前后围栏，以及同一生产状态消费者的双时间窗口、Community、旧意图、重签与真实 SQLite 证据。后续至 `c3f1f2a679085680d90fd45a3ee2c0b8058a61d4` 没有更改这些 Native 源码。
- 同一 Native 固定源临时移除 `proof.settled` 条件，原 `writer_absence_requires_both_prior_core_window_and_original_community` 真实断言失败，exit 101；逐字恢复后 1 passed，exit 0。文件 SHA-256 前后一致：`a9be856344c08a0c5948f41b85e80127af285b0ff65c8beadafa9882a9c056e9`。日志保留在 `negative-3c4bbd2f01889314b6ab052cc52e03aaa793df9f/`。
- 后端固定 `c3f1f2a679085680d90fd45a3ee2c0b8058a61d4`，原检查 SDK `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，1 CPU/4 GiB，加独立 PG 1 CPU/2 GiB、tmpfs、独立网络。原 Shared `publication::` 2 项、DB `store::publication::tests` 4 项全通过。DB 用真实 writer 事务验证提交/回滚等待、1631 与其墓碑均软删、跨 Community 与归档、等待锁后过窗拒写，以及同 canonical ID 的另一份有效签名。
- 同一后端固定源的两个反向分别恢复旧快照风险、取消取得锁后的时间准入；原测试均真实断言失败，exit 101。逐字还原后 DB 4 passed、0 failed，整个作业 exit 0。源哈希前后一致：`f94940ad5c65847963ddead257a611fdbfdd4d7f36c6cedb6e98fe6e81c8973d`。日志在 `delivery-c3f1f2a679085680d90fd45a3ee2c0b8058a61d4/`，末尾脚本文字仍写旧的“three”，准确数量以 Cargo 的 4 passed 为准。

保留真实失败：`delivery-f8362a07d5479292db43def006852d3e9f568aba/` 的反向恢复轮 exit 101。跨秒测试输入碰到相同 ID 的不同有效签名，暴露全 Event 比较造成的误拒绝；随后修复 canonical ID 查证，并固定各测试操作的时间基点使其 ID 必然不同。该失败不作为通过结果。

最终 Relay 固定 `9abd537d2d1bf0299abd34995213c48333e19598`，上文原检查 SDK、2 CPU/16 GiB，加独立 PG 1 CPU/2 GiB 与 Redis 0.5 CPU/128 MiB（各自 memory+swap 同 memory）。原 `api::delivery::tests` 3 passed、0 failed、1139 filtered out。包括真实 router/NIP-98/payload/replay/ban/owner/member/Community 准入；通过 `pg_stat_activity` 和 `pg_blocking_pids` 确认 HTTP 已实际等待 writer 后才撤成员、换 Host 或归档；原 `/events` 发布请求通过前置时间检查后等锁、跨窗后明确返回 BAD_REQUEST，writer 无行且 settled=true。HTTP 与 WebSocket 原入口均复用 `ingest_event` 的同一写入分支；服务写租约 wrapper 也经受保护的 `insert_event_with_thread_metadata_tx`。

同一固定源临时移除等待后的第二次 `readmit`，原权限撤销检查真实断言失败，exit 101；逐字恢复后原 3 项再次全通过，整个作业 exit 0、OOMKilled=false。`api/delivery.rs` 恢复前后 SHA-256 相同：`2a559efbe41d5e4637037585e882278a114a6bae3bb846afff3a1e12c6122dcf`。原日志与限额在 `relay-delivery-9abd537d2d1bf0299abd34995213c48333e19598/`。初轮 `relay-delivery-c3f1f2a679085680d90fd45a3ee2c0b8058a61d4/` 的 2 项通过日志也保留；最终新增实际等待同步和原发布入口检查，没有改变此前已通过的 Native/Shared/DB 产品代码。

本阶段全部自有检查容器、临时 PG/Redis 和独立网络已实际回读确认不存在，资源已通知根工作流释放。Core 合同生成、设计 pin 和合批门禁由根工作流统一执行；Core 普通消息“墓碑再次删除”的缺口未在本批放宽或冒称修复。本文不将上述 Rust 定向检查算作安装包、Win11、生产发布或 DD-157 三账号双主题真实验收。
