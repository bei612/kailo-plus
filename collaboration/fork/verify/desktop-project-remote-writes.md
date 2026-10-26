# Desktop 远程分支与 owner merge 定向核验

日期：2026-10-26。权威为 DD-160(2)、DD-118(5)(6) 与 DD-81；上游原生消费者来源为固定 Buzz `779af8886caae1317b4de962082429867ab61503`。本增量基线是 `019bfa0c086c594d76675227dc37cdc8865aa2ad`，产品最终固定源码是 `bd1b158b45fb26ab5b7ef8028c55604fecabd328`，分支 `codex/dd160-remote-writes-20261026`。基线前的本机检出界面与证据已另行交付，不应重复选择。

## 实现与边界

Desktop 原生宿主现接通原共享 Projects 的分支创建、删除和 owner merge，使用既有 `buzz-project-git` branches/merge 与页面消费者。请求只接受仓库坐标、引用和既有操作参数；仓库地址从当前 Relay 推出，本设备 CLIENT 每次新签 NIP-98，私钥不交给 Git。原登录代际、Relay 和设备公钥在等待前后复核。owner merge 必须由坐标 owner 的实际设备公钥执行，作者显示名从本机原会话入口读取实际 HumanIdentity，不采纳页面自报的 owner、作者或 URL。

`project_git_intent.rs` 在应用数据目录按 Community 与设备分区保存 SQLite 操作意图及事后证据。发送前事务持久化幂等键、repo/ref、old→new、merge 作者/时间，使用 DELETE journal 与 synchronous FULL；同 ref 的待确认操作不能被新请求覆盖。SQLite 本身拒绝改写已冻结请求、引用、作者或已签事件，也拒绝终态倒退。重启先用原 info/refs 对账：等于 new 确认成功，等于 old 只允许相同冻结意图续发，其他状态冲突，不能查明保留 UNKNOWN。重建 merge 时源引用变化导致冲突并结束该 ref 的占用；网络失败继续保留冻结声明。Git 成功事实不被迟到传输错误覆盖。

merge 后沿原 Relay 查询、设备签名与提交接缝形成 1631，保留原 review/root/repository/owner/author/merge-commit 标签。事件与 ID 在发送前持久化；ACK 或同 ID 回读决定成功，明确拒绝结束事件阶段，丢响应只继续查同一个 ID，不能重新签名或换幂等意图。已知连接未建立的失败重试复用同一已签事件。SQLite 不存仓库正文副本或私钥，没有新增 Core 代理推送、公开 schema、迁移、Workflow 或第二授权权威。

仍有明确未完成边界：Native 尚未消费部署的 `PUBLISH_RESULT_SETTLE_SECONDS` 可信事实。未知提交且按原 ID 暂查不到时继续 UNKNOWN，不擅自猜超时后失败或重签；与 Core 完全同形的结算期限收敛及配置事实投递仍待集成实现。本节不宣称 DD-160 全部交付完成。

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

本批所有消费者容器均终态并删除。未生成新安装包、未发布共享服务、未在 Win11 或真实 Desktop 完成 V-SCN-264/265 操作；也未替代 DD-157 三账号双主题发布后验收。全量集成门禁、部署事实投递、安装包及真实端到端验收仍由后续集成执行，原发布门禁保留。
