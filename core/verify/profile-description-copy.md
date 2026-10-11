# 原 Profile description 词条恢复

2026-10-11，关联 DD-75／SS-WEB-PRESENTATION、用户原版文案不擅自改名要求。
本批来自[全量差异台账](buzz-restoration-checkpoint.md)中已实拍登记的
Profile description 被 About 替换缺项，不扩大页面或权限范围。

固定 Buzz `779af8886caae1317b4de962082429867ab61503`，完整路径
`desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`
的 `profile-about` 标签与 Textarea placeholder 均为 `Profile description`。
共享 `client-kit/ts/platform/src/react/profile-settings.tsx::ProfileSettingsCard`
已原样迁移这两个真实消费者，但其词条英文被改为 About；本次只恢复该英文值。
中文仍是既有“简介”，Dart 沿原 `tools/gen-platform-i18n.py` 同源生成。
共享布局、样式、交互、字段 key 和 Web/Desktop 回调均不改。

权限与副作用：只改显示词条，不新增按钮、字段或请求。原签名者身份校验、Web BFF、
Native 本机身份、资料公开范围、UNKNOWN 保存意图及 canonical readback 均保留。
空值、异常、撤权和迟到回执仍由原控件处理，本次不新增持久状态或外部副作用；
schema／迁移／API／Workflow／配额兼容无新增适用对象。

候选最初基于 main `f3ee28d4580f82f8edfc3332618c639a5b6d2958`，
源码仅 TS 词条、生成 Dart 词条及原 profile-settings DOM 文件的中英文两例。
使用私有索引只收入一个词条的两侧差异，不带正式 i18n／Dart 的其余脏改，
也不动五个既有公共暂存 blob、发布 pin、Core 或组件。

## 实际验证

证据目录 `/volumes/data/kailo/tmp/web-profile-copy.C3E6lF`。
复用已有 SDK 镜像与 Data 依赖，4 CPU／8 GiB、同额 memory+swap、512 PID，
无网络、无新镜像、无依赖安装；预检可用内存 41–42 GiB。

- 原生成器和 `--check` 成功，输出 `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
- 原 `tsc --noEmit` exit 2：已有 `src/react/messages/diff/DiffViewer.tsx` 两处 CSS 导入报 TS2882；不修改不相关页面来凑通过。
- 原 `vitest run test/profile-settings.test.tsx -t description --no-file-parallelism`，`dom-path-aligned.log` exit 0：2 passed／33 skipped，真实标签、编辑 placeholder 和无变更关闭不调用保存均验证。
- 事后只在私有 TS 恢复 About，`negative.log` exit 1：英文用例明确 `expected About to be Profile description`，中文仍通过。
- 原值恢复后 `restored.log` 复验 exit 0：2 passed／33 skipped，正式生产源未经历变异。

失败输入如实保留：前两次生成器 exit 1（Dart formatter exit 255），单独只读
格式诊断得到 `Creation failed, path = '/.dart-tool' ... Permission denied`；将该工具
目录绑定到本批 Data 子目录后原生成器成功，没有设置 HOME 或改生成规则。
DOM 首次 exit 1 为旧只读 node_modules 下 `.vite-temp` EROFS，随后第一次复制
链接缺少容器内路径映射报 MODULE_NOT_FOUND；改为本批可写目录及已有挂载映射后
执行上述真实用例，没有放宽框架超时或改断言。

未构建、未部署、未产生本批新版浏览器截图；旧 4c099 实拍只证明原缺项。
Windows／Mobile 页面、全量检查及完整原版恢复均未据此通过。
