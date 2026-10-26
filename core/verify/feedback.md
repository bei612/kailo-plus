# DD-158 私有反馈操作链

本记录只覆盖 DD-158(1)(2) 的反馈候选，不宣布 DD-158 完成。Mobile 表单、
Tenant 资料受治理动作与三端消费者仍待收口。当前源码尚未完成 SDK 验证、
打包、部署或真实运营方业务验收。

## 数据与交互

- 固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/settings/ui/SendFeedbackDialog.tsx` 是类别按钮、正文/图片、
  诊断勾选布局证据。Web/Desktop 共用 `react/feedback/SendFeedbackDialog.tsx`，
  从本人菜单进入；图片留在本机，随提交以 base64 发给 Core，不上传 Community。
- 五项诊断先原样显示再由本人勾选；Desktop 版本取原 Tauri `getVersion`，Web
  取自身 package 版本。网络/5xx 结果不明冻结同一请求及幂等键，重试不换内容；
  成功后清空草稿，确定拒绝允许修改。不是 Relay kind 42000。
- Core `feedback/input.rs` 校验 1–4000 字符、固定诊断字段/4 KiB、单图片/2 MiB
  和 PNG/JPEG/WebP 文件头；`feedback/mod.rs` 在 Tenant/HUMAN 成员锁内复核资格、
  按本人幂等键判重与参数摘要拒绝冲突、每小时 10 条/每日 50 条限速，写反馈与
  元数据审计同事务。读权威为 `support.feedback_submission`。
- `feedback/operator.rs` 只允许 Platform Catalog Tenant 且 fully-consistent
  Catalog manage 的会话读取/分拣；正文不进入审计，图片读取也受审计且带
  `nosniff`。`encoding=base64` 仅为已有 Native JSON 传输提供同一份受审计图片的
  表示，不另存副本。平台管理中的共享页面按 version CAS 分拣
  `NEW→TRIAGED→CLOSED`，失败先刷新，不能盲目重发。
- 关闭 180 天后定期有界清理；Tenant 删除清理反馈及其内嵌图片。新增迁移可回退，
  已有用户反馈则明确停止回退，不删除用户数据。

## 验证边界

新增单元校验与显式隔离 PostgreSQL 测试，测试入口 `feedback::`；数据库测试
必须设置 `FEEDBACK_TEST_DATABASE_URL` 并显式 `--include-ignored`，否则不算验收。
生成合同、共享交互、格式、静态、迁移与实际 SQL 测试的结果待原 SDK 执行后追加。
本批不发送反馈到第三方，也未执行共享环境数据库迁移或部署。

首次原 SDK 生成消费者（固定 `d3b0e24d9`，1 CPU / 2 GiB）中四侧合同生成及
`gen.sh --check` 通过，同源 Dart 词条生成及 `--check` 通过，Rust 格式化已执行。
总命令退出 1：独立生成容器漏挂设计目录，`gen-registry.py` 无法读取 `.design/06`。
此失败不计为注册表通过；补齐实际反馈 Stage 归属与设计挂载后单独重跑该步。

注册表在固定 `922b4d3df` 的独立导出中补挂该分支 pin 的设计目录后，原 SDK
1 CPU / 512 MiB 的生成及 `--check` 均退出 0；39 条实际能力与 20 个封闭
Workflow kind 参与校验，计数不代表功能验收。日志 `feedback-registry.log` 与
`feedback-registry-limits.log` 位于 `/volumes/data/kailo/verification/buzz-r10/`。

## 固定共享消费者验证（2026-10-26）

固定 `814650309` 的 Git 导出，原检查 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，
原容器资源 helper 与 CI 代理/容量缓存。`pnpm@10.33.4 install --frozen-lockfile`
及共享 platform 生产 `tsc --noEmit` 退出 0。首次 1 CPU / 2 GiB 下测试类型检查
触发 Node 默认约 1 GiB heap OOM（退出 134）；改为 1 CPU / 4 GiB、
`NODE_OPTIONS=--max-old-space-size=3072` 后发现定向导出缺少现有测试实际引用的
`client-kit/embed`，退出 2。补齐同一固定 commit 的该目录后，完整
`tsc --noEmit -p tsconfig.test.json` 退出 0，原 Vitest 执行
`test/feedback.test.tsx --maxWorkers=1` **4 passed / 0 failed**。

四项实际共享消费者覆盖 Web/Desktop 诊断明文预览与主动勾选、结果不明的相同
冻结请求重试、中文明确拒绝后保留草稿，以及运营列表读取、按需附件读取和
所显示版本的 CAS 分拣。未替代 Core fresh authorization/数据库链、
Web/Desktop 宿主完整类型检查、真实浏览器操作或 Mobile 验收。
失败原件与最后成功结果分别在
`/volumes/data/kailo/verification/buzz-r10/feedback-front.log`、
`feedback-front-retry.log`、`feedback-front-complete-input.log`；相应 limits
保留资源读回。检查容器已随脚本清理；未部署服务。

## Mobile 源码批（2026-10-26）

`c17de7275` 新增 Mobile 设置入口与真实表单，使用既有 NativeSession 的
`/api/v1/feedback`、四侧同源请求及同源词条。图片仅本地读取/预览（先读大小、
限制 2 MiB 与三种文件头），在提交时一起交给 Core；诊断只含五字段、展示原文
并默认不勾选。未知结果冻结请求，可关窗再开后原样重试；账号/设备/部署变更
退休草稿，忽略旧身份的晚到完成。新增实际表单及草稿消费者检查源码。

原 check SDK 1 CPU / 2 GiB 的 Dart 格式化与再次零差异检查退出 0，日志
`/volumes/data/kailo/verification/buzz-r10/feedback-mobile-format.log`。Flutter
固定原镜像尚在准备，**未运行 Mobile analyzer/widget/controller 检查**。该条
不表示 Mobile 已验收，也不表示 DD-158 的 Tenant profile 动作与消费者已完成。

首次固定 `3e476e982` 的原 SDK Core 检查：fmt 通过，独立空库迁移在
feedback 建表失败。手写的附件三字段一致性约束名与 PostgreSQL 自动生成的
attachment 列长度约束同名；现改为明确的 `attachment_presence_check`，不改
校验语义。该迁移未部署、无旧版在线 writer。本次整体退出 1，Core 测试和
Clippy 尚未执行；原件 `feedback-core-check-complete-input.log`。后续结果另记。

修复约束名后的固定 `c9b6eb253`：fmt、完整迁移与反馈/未读两条迁移回退再前进
均通过，Core feedback 两项真实检查 **2 passed、0 failed、0 ignored**。
随后 Clippy `-D warnings` 拒绝附件读取的六项 tuple（type_complexity），
整体尚未通过、SQLx 尚未执行；现改为命名 SQLx 行类型，不加 allow 绕过。
原件 `feedback-c9b6eb253/feedback-core-check-complete-input.log`。
