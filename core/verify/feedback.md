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
