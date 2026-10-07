# 原版设置：配色模式控件恢复

## 固定来源和本批差异

基线 `/volumes/kailo/.references/buzz` commit `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/settings/ui/SettingsPanels.tsx::ThemeSettingsCard`、`APPEARANCE_MODE_OPTIONS`：原版 `appearance-color-mode-row` 左侧标题/说明，右侧 `SegmentedControl`，选项按 System / Light / Dark 排列，图标 SunMoon / Sun / Moon。原选择值为 `selectedMode`，指示器与选择即时对应。
- `desktop/src/shared/ui/segmented-control.tsx::SegmentedControl`：Kailo 已有共享迁移 `client-kit/ts/platform/src/react/segmented-control.tsx`；本批直接复用，没有新增另一组件。
- 缺失需恢复：原共享 `ThemeSettingsControls` 将此行替换成自写 `ThemeModeControl` radio 表单，失去左右布局、原图标和移动指示器。本批按固定原代码恢复这一整行，删除该无消费者替代函数。
- 原样保留：原有 `handleModeSelect`、主题配对、系统跟随、暗色类与 CSS variables 的真实消费者。没有新主题存储或设置开关。
- 共享迁移：Web 的 `SettingsPane → AppearanceSettings → ThemeSettingsControls` 与 Desktop 的 `SettingsPanels::ThemeSettingsCard → AppearanceSettings → ThemeSettingsControls` 共用同一实现。
- 授权差异：中文默认/英文词条；英文标题和说明恢复原句。删除替代页遗留 `platform.settings.deviceAppearance`，按既有生成器同步 Dart，不手写第二翻译来源。

## 设置模块核对范围与未完成项

核对固定原版 SettingsPanels 的全部 16 个 section 和 SettingsView 的实际分组（不能把 descriptor 顺序误当侧栏顺序）。当前共享注册表只有 profile、appearance、notifications、shortcuts、community-members、custom-emoji 六项；其中六项存在不证明其所有交互完整。原版另有 voice、experimental、agents、channel-templates、compute、hosted-communities、moderation、local-archive、mobile、updates，本批未恢复这些页面或证明其治理消费者就绪。

优先检查头像：原 `ProfileSettingsCard` 与头像编辑/相机/模式组件已有共享迁移和双宿主真实上传/保存回调；本批不改 media、Rust 或 Core 既有脏修改，也不把源码链存在说成已完成本次实机头像验收。原 `SignOutSection` 是导出 nsec 后擦除身份和全部本机数据，不等于现有企业登录退出；没有将二者混同而生成假恢复入口。

这是一批明确差异恢复，不是“设置全量 100% 还原”的声明。

## 四步影响结论

1. 权威：用户原版一致性要求、DD-53/74 与 `.design/07` 两端同源页面/宿主边界。不存在本批新的领域合同。
2. 影响：共享呈现/两端现有主题消费者、TS 词条及同源 Dart 产物；搜索 `ThemeModeControl` 仅原一个生产调用和旧检查，现均移除。无契约字段、服务 API、DB migration 或 Workflow compatibility 变更。
3. 副作用：仅调用原有 `setFollowSystem`/`setTheme`，不触碰认证、scope、quota 或 Relay 身份，未增加网络请求和第二偏好权威。
4. 边界：原模式集合、原配对/无配对主题回退、异步加载保护与系统变化逻辑不变。指示器使用原 `selectedMode`；重复点击仍沿既有语义。没有未知外部副作用或新持久状态需要对账。

## 实际验证

受限 SDK：`kailo-agent-receipt-xvkujx`，4 CPU / 8 GiB，复用 `/evidence/profile-settings-ortsoo.DRR20F/apps`，未创建镜像或全量构建。

```text
client-kit/ts/platform:
./node_modules/.bin/vitest run test/theme-appearance.test.tsx test/settings.test.tsx
Test Files 2 passed; Tests 34 passed; exit 0

client-kit/ts/platform、collaboration/desktop、web-client/web:
各执行 ./node_modules/.bin/tsc --noEmit
串行 && 命令链 exit 0（三侧均通过）

python3 tools/gen-platform-i18n.py
Generated client-kit/dart/lib/shared/platform/reason_text.dart
Generated client-kit/dart/lib/shared/platform/platform_text.dart
exit 0
```

实现后在真实 `useAppearance` 消费者补两语言验证：原控件层级/三个图标/英文原文与中文、三个模式点击、aria-pressed 与移动指示器、本机偏好和实际文档暗色类。旧 radio 函数检查移除，其真实消费者验证由本组替代，并非删检查规避失败。

只在私有 SDK 主动把 `onValueChange` 破坏为始终选择 system：两语言用例均实际失败，`expected 'false' to be 'true'`，exit 1；10 个未选中的用例明确 skipped。已还原，集中两文件 34 例复验通过。完整日志：`/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/color-mode-{mutation,final}.log`。日志包含 reduced-motion 提示和异步主题更新的 React act 警告，未隐藏或称零警告。

截图、Windows 实机、Mobile 运行、部署、全量检查未由本批执行；Dart 同源生成不等同 Mobile UI 验收。
