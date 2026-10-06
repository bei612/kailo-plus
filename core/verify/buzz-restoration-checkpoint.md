# Buzz 共享界面与受治理私聊：开发检查点

2026-10-06。本记录对应第一批源码，不是部署、完整 Buzz 功能恢复或生产就绪声明。
权威为 REQ-24、DD-39/40/53/75/80/81；设计已单独提交到
`design/buzz-feature-preservation-20261006`，头为
`50515dd6e3481bcb1732d1662efc88431c716a3d`。

## 已写入范围与边界

- Web/Desktop 共享原侧栏分组、行、菜单、排序，以及资料与头像编辑、新私聊选人界面。
  复用 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/messages/ui/NewMessageScreen.tsx::NewMessageScreen`、
  `desktop/src/features/sidebar/ui/CustomChannelSection.tsx::ChannelGroupSection`、
  `desktop/src/features/profile/ui/ProfileAvatarEditor.tsx::ProfileAvatarEditor`。
  宿主只保留真实 BFF 或本机签名调用；原生端不改为服务器持钥。
- Conversation 只记录参与者及原 Relay Channel 引用，消息仍归原 Relay。
  同一 Action Admission、ComponentTaskWorkflow、SpiceDB、审计、OpenBao 与
  publish attempt/reconciler 承接新增调用，不建立另一聊天或工作流权威。
- 新 Workspace 的创建者成员事实与创建动作同事务写入；原 Temporal 生命周期
  查证 SpiceDB/Relay 成员投影后才宣布就绪。旧 history 未携带 creator 时保持
  原命令序列，不给 CONTROL 增加业务成员身份。
- SSE 复用既有 snapshot、订阅池和再准入；私聊绑定参与者与两级 binding version，
  重连取真实 snapshot。读取正文后再次核权，撤权、暂停、换钥和依赖失败关闭流。
  read_contexts 沿用同一用户状态及 CAS；该批只补 Channel 级私聊已读。

影响面包含 Core/BFF、Worker、Relay 原成员表、四侧生成契约及共享 TypeScript。
数据库新增投影表和原 Relay 投影字段，前进／回退已在隔离演练库实际运行；不改
消息正文存储，不改业务库。Mobile 的本机密钥／Relay 路径保持不变，新增 UI 不
因此获得 Mobile 验收。并发重复请求沿用冻结 idempotency key；外部结果不明不
重复执行、不显示成功或失败；HTTP 接受不等于投影完成。前端已发送但导航失败
只重试导航，不重新发送。权限与作用域缺失拒绝，不回退默认租户或共享身份。

## 实际验证

固定检查镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
本批 full 为四 CPU、八 GiB、Cargo 十六并行，缓存位于 Data；数据库是新建的
隔离演练库。执行 `./tools/check.sh --full`，原日志为
`/volumes/data/kailo/tmp/tmp.SQT2AP3kht.check.log`，**退出 1**。

- 通过：Rust/Go/Dart 测试、Temporal replay、数据库前进／回退／再前进、SQLx
  同步、四语言契约同步及兼容比对、安全结构与文档检查。
- 失败：Rust 格式、两处 Conversation tuple 的 clippy 类型复杂度；Dart 平台
  文案同步；TypeScript 主题检查两项；追溯产物与阶段登记；旧产物源码摘要。
- TypeScript 原命令重跑为 408 通过、2 失败。检查误把原生宿主 dark 变体和
  ring-inset 当作独立主题／颜色，同时暴露自写频道弹窗遮罩的问题。
- 后续已将两个 tuple 改为命名数据库行并格式化；后续原 Dialog 复用、主题检查、
  富编辑器、完整频道元数据和事件级私聊已读不属于这个已运行 full 的源码快照。
- pnpm 本次复用 217 包、下载零包；Dart 报告 47 项依赖变化，不能据此确认网络下载数，也不能宣称完全离线。
  实际部署配置未投递，运行配置预检跳过；未安装 gitleaks，只有内置扫描通过。

窄验证及真实破坏／还原证据见 `conversation-projection.md` 与原侧栏交接记录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/sidebar-handoff.md`。
私聊授权、UNKNOWN 不重发、SSE scope fence、四侧未知字段拒绝均有失败后还原
记录；这些不替代真实多人多 Agent 或浏览器、Win11 验收。

## 未交付范围

仍需修完检查、集中构建、部署及真实客户端验收。完整富编辑器、完整频道
公开／TTL／模板、其余设置、Pulse/Projects、私聊隐藏／偏好等原功能继续恢复，
不是从需求删除。Cells/WeKnora/Wren 的独立服务集成也不在此检查点宣称完成。
该检查点不更新旧 EXE 或镜像为“最新版”。

## 第二批源码与验证（2026-10-06）

设计另行提交 `088de845e2cc173e64c624e82db73d38f04d608b`，保留完整产品范围，
区分协议 private 与产品公开频道，明确私聊偏好、原生隐藏及 TTL 归档权威。
`./tools/check-docs.sh` 退出 0，日志
`/volumes/data/kailo/tmp/tmp.RfJ4DAZFZn.check.log`。外层遗留 pre-push 错误地调用
整个 apps 检查，因缺执行配置退出；已独立完成文档检查后，仅该次设计 push
不执行遗留钩子，没有将完整检查记为通过。

本批将原富编辑器、工具栏、链接、草稿与样式移到同一共享实现；Desktop 原位置
转发，Web 删除简化输入框并保留 BFF 发布及上传。频道名称、描述和类型沿原
ActionCommand、Temporal 生命周期到 Relay 的签名元数据回读，不另建元数据表。
私聊收藏／静音复用同一用户状态 CAS；隐藏／恢复保留原 Relay 权威及原发布
幂等／UNKNOWN 对账。影响面、迁移和副作用证据见 `conversation-projection.md`
及 `membership-lifecycle.md`。

实际集中验证：共享 TypeScript 236 项、Web 20 项、Desktop 原编辑与草稿 177 项
通过，三处 TypeScript 类型检查通过；Core clippy、元数据、私聊准入、发布检查
通过；四侧序列化通过；Relay 编译及隔离 PostgreSQL 隐藏／恢复检查通过。
主动丢弃 UNKNOWN 草稿键、退回纯文本发送、绕过 binding 比较、反转 hidden_at
以及丢弃频道描述均被对应检查捕获，私有副本还原后通过。文案生成器与 Dart
输出已同步，不以旧生成物代替检查。

收口复核还修复同实例切换身份／频道时空草稿继承旧内容的问题，并阻止旧发送
回执解锁新会话。原上游无作用的选区回调已移除，保留编辑器自己的真实选区。
补充后 Composer 12 项及三处类型检查通过；私有副本回退两处错误，新增 3 项
全部失败，逐字还原后 12 项再次通过。此修复不因父组件当前使用 key 而省略。

这些是本批源码证据，不是发布验收。公开频道发现／加入、TTL 生命周期、完整
模板和 Forum 页面，以及 Web 完整附件编辑／录音等仍未恢复；不从需求中删除。
尚未部署新 Core／Relay／Web，不把旧 EXE 标为新版；真实多人多 Agent 和
Win11／浏览器验收仍需在新产物上进行。

频道元数据另已完成真实 Relay 验证：启用 `PLATFORM_INTEGRATION=1`，执行已有
`non_member_publish_is_rejected_and_member_publish_is_accepted` 二进制，实际输出
`1 passed; 0 failed; 7 filtered out`，退出 0。覆盖重复建频道、stream/forum 名称
与描述签名回读、同 ID 异描述拒绝、非成员拒绝及成员发布；独立验证 Community
已归档。首次因 operator URL 与签名 Host 不一致退出 101，未创建 Community；
第二次仅在隔离验证容器解析原 Host 到原地址，不改部署配置。完整执行及当前
旧镜像摘要记录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/channel-metadata.xjOQiU/relay-live-evidence.md`。

第二批集中 full 使用固定源码树 `0d295fc349b94b06670938578c59ade6215a72a0`，
日志 `/volumes/data/kailo/tmp/tmp.tcktt3EYUb.check.log`。保存本检查点时进程仍在
运行；已输出 Rust fmt/clippy、Go vet、TypeScript/Dart 静态检查、四侧生成同步、
契约兼容与数据库往返通过，Rust 测试链接仍未结束。此记录没有完整检查退出码，
不授予发布资格。后续附件与私聊菜单改动不在该固定树中，不能借用这次 full 验收。
