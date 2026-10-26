# DD-160 Desktop 本机仓库检出

本批对应 DD-160(3)、DD-118(2)(3)(6) 与 V-SCN-264/265。固定来源是 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src-tauri/src/commands/project_git.rs`（工作区快照、同步状态、pull、打开目录）、`project_git_workflow.rs::clone_project_repository_blocking`、`project_git_push.rs::push_project_local_repository_blocking`、`project_git_diff.rs::local_diff_range`，以及同目录的 types/file_content。该版本没有 `project_git_local*.rs`，实际功能分散在以上文件中。

实现基准为 `448a1c19156ceba17888d4162dfd561b0fa67179`；本机源码候选为 `a3e2f63a8249b7986db711bd45b030e752d92649`。共享 `buzz-project-git::checkout` 保留原 clone、sync、push/pull、工作区文件树与提交 diff 的数据形状及流程，继续使用原 `run_git`、历史解析器、64 KiB 文件预览和 250 项 eager preview 上限。单文件读取在超过 eager 上限后仍读取本机工作区；不会退回远程版本。路径穿越、符号链接逃逸、二进制和过大预览沿共享校验处理。

Kailo 接缝由 `commands/project_git_checkout.rs` 消费现有 `RepoScope`：前端只给 30617 坐标、引用与当前 Relay/设备公钥期望，不接受 clone URL 或磁盘路径。本机目录为 AppData 下按当前 Community HTTP base 摘要及 owner/d 分区的 `project-checkouts`，不搜索全局旧目录，不跨 Community 回退。目录、Git 元数据和配置不得借符号链接逃逸；本机 Git 配置不得通过 include、URL 重写、pushurl 或可执行 filter 转移新签名。配置检查保留合法 SHA-1/SHA-256 仓库。原认证头、每次调用前的会话代际重验、info/refs 预检与整体 120 秒期限继续成立；私钥不进入 Git 子进程或持久文件。

原版会忽略 fetch 错误继续给出状态，本批改为整次失败；未找到明确指定的 clone 分支不回退到别的 HEAD。clone 在同目录临时树完成后才发布目标目录。首次空仓推送可将旧 master 对齐到 main，但不覆盖已有本机 main；pull 只快进到刚验证的远端提交，脏工作区、分叉与分支不匹配拒绝。Desktop 原 single-instance 插件与本批跨 await 的 owned checkout 锁串行化本机操作；锁等待计入相同截止时间，调用方消失不提前释放正在执行的 Git 操作锁。

推送前将无秘密的 root/ref/old/new/merge_base 写入 `.git/kailo-push-intent`，临时文件 sync_all 后原子发布且不得覆盖已有意图；Unix 同步目录元数据。已有意图跨重启保留，只经 info/refs 对账：观察到 frozen new 才完成，仍为 old 时仅能重送同一 frozen new，其他提交为冲突，不可查询为 UNKNOWN。当前 HEAD 改变不会替换待确认意图，没有清理未知意图的命令。状态的 `pending_push` 返回 frozen target 和 retry_same_intent/unknown/conflict；未知和冲突不 fetch、不允许 pull。Git 错误正文不交给页面，未知/冲突保留稳定错误码供共源 i18n 消费。

原生八命令为 clone、sync status、push、pull、local snapshot、local file content、local diff、open folder。宿主界面、调用注册与共享中英文文案由同一 DD-160 集成分支接线；本批不新增 Web 本机能力。没有数据库、公开合同或 Workflow schema 变更；新增 Desktop path 依赖锁仅登记原有 `buzz-project-git` 及其既有 serde/tempfile 依赖，不升级第三方包。源码证据目录未编辑或执行；独立 worktree 的 `upstream_manifest.py status` 因没有相邻 `.references` 明确报告无法比较，不能把 exit 0 当作上游全量比较通过；上述来源直接通过固定 Git objects 核验。

## 原 SDK 验证

使用既有 Desktop SDK `sha256:df8a3475e3e32ecf5ac79f9c12763b8ce5d4f91a75c25007fd9bfa5b282fc081`，GitHub 固定提交导出、原 container-safety 预检与实际 cgroup 核验；未在宿主执行 Node/Cargo/Go。格式检查为 1 CPU/512 MiB，无网络；Rust 检查为 2 CPU/16 GiB，memory-swap 同限，原 `/volumes/data` target 与 Cargo 缓存，`SQLX_OFFLINE=true`。

第一轮固定集成源 `b3eebd33cee19018d7a30ac0f83332a9f0ec7a23`：Desktop `cargo test --offline --lib commands::project_git_` 为 10 passed/0 failed/0 ignored；首次完整解析生成的 Cargo.lock 只有 +9 行，已单独提交 `1b96c98e4e9b37269c19a0613ea97e30365dc6ca`。共享 `cargo test --offline --locked -p buzz-project-git` 为 36 passed/1 failed/0 ignored，失败是既有 `branches::tests::remote_branch_create_and_delete_round_trip`：Git 对同名同提交返回 up-to-date，原 empty lease 未令创建失败。此失败保留，不通过删断言改成通过；根集成分支随后修正远端存在性检查。首次所有本机检出用例已通过，但该轮不是共享 crate 全通过。OOM=false，检查容器已清理。

原始日志位于 CI 节点 `/volumes/data/kailo/verification/dd160-checkout/`，第一轮日志/exit/oom 文件以前述完整 SHA 为前缀。后续固定锁正向和反向结果见下一节。

## 固定锁复验与反向验证

最终集成 Rust 源 `0b9b72ba64c248a239abfb0f5d4ab242c662001c` 含锁文件、原同名分支创建修正和八个 native invoke 注册。相同原 SDK 内，Desktop `cargo test --offline --locked --lib commands::project_git_` 为 10 passed/0 failed/0 ignored；共享 `cargo test --offline --locked -p buzz-project-git` 为 38 passed/0 failed/0 ignored，其中本机检出 10 项。Doc-tests 0 项，无适用用例。整个容器 exit 0，OOM=false，结束后实查没有残留检查容器。日志、exit、oom、limits 与 preflight 均在上述证据目录，以完整 `0b9b72ba...` SHA 为前缀；该结果不覆盖随后未在此 SHA 的 TS 消费者改动。

反向验证复用同一固定 GitHub 导出和原 SDK，1 CPU/4 GiB、memory-swap 同限，只临时在 `push_checkout` 读取 pending 后把 frozen new 改为当前 HEAD，恢复本批所修的真实缺陷。已有 `checkout::tests::pending_push_survives_restart_and_head_changes_without_changing_intent` 在 `checkout_tests.rs:282` 的提交相等断言处失败：实际送出较新的本机提交，与先前冻结提交不同，exit 101、0 passed/1 failed/0 ignored。并非编译、超时或 OOM 失败。

随后逐字恢复 `checkout.rs`，同一 `cargo test --offline --locked -p buzz-project-git checkout::tests::pending_push_survives_restart_and_head_changes_without_changing_intent -- --exact` 为 1 passed/0 failed/0 ignored，exit 0。原文件和恢复文件 SHA-256 均为 `7e841ac22402a2a18b27c5b26cb5ed3986dc5bfe56858f7df5ed4cfe541c54a4`。正反向 OOM 均 false，容器已删除；临时破坏不进入 Git。原件在 `negative-0b9b72ba64c248a239abfb0f5d4ab242c662001c/` 的 mutated/restored log、exit、limits、oom 和 original/restored SHA 文件。

## 交付边界

上述源码、SDK 测试与 Git push 不等于 Desktop 安装包、Win11 真机或生产部署。文件夹打开的 OS 交互、真实设备密钥库、三用户/多社区操作、实际 Relay 撤权与 Web/Desktop 双主题界面验收仍随集成批执行；V-SCN-264/265 不因本记录而改成通过。原发布门禁保留。
