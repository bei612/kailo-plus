# 原版设置差异与共源缩放恢复

## 固定基准与范围

要求为 `REQ-08`、`REQ-24`、`DD-53`、`DD-74`，归属原 `platform.pages`
追溯和设计覆盖矩阵 `V-REQ-24`。本批比较固定
`Buzz@779af8886caae1317b4de962082429867ab61503`，不是只比较本批 Git 改动。

源码证据为只读 `.references/buzz` 中：

- `desktop/src/features/settings/ui/SettingsPanels.tsx::SettingsSection/settingsSections/renderSettingsSection`。
- `desktop/src/features/settings/ui/SettingsView.tsx::settingsNavGroups/SettingsView`。
- `desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx::KeyCombo/KeyboardShortcutsCard`。
- `desktop/src/app/useWebviewZoomShortcuts.ts::useWebviewZoomShortcuts/getZoomAction/getNextZoomFactor`。
- `desktop/src/features/settings/ui/SignOutSection.tsx::SignOutSection`。

固定树的 `desktop/src/features/settings/` 共 56 个文件；按原路径比较，9 个改变、
47 个不在原路径、0 个逐字相同。路径不存在不是功能缺失的充分证据：主题、
通知、资料、快捷键及设置壳的真实消费者已经迁到 `client-kit`，必须核对映射。
以下是全部 16 个原设置 section 的模块级映射，不是所有子组件逐行审核通过，
也不宣称全功能还原。

| 原 section | 当前真实实现与差异分类 |
|---|---|
| profile | 共享迁移：`react/profile-settings.tsx` 及头像子树；SERVER/CLIENT 写入为已授权治理改造。原私钥备份与清除全部本机数据仍缺，不能以普通注销代替 |
| notifications | 共享迁移：`react/notifications/NotificationSettingsCard.tsx`；系统通知请求留宿主；Web 另有现有工作区 mute 呈现，未声明原版全量一致 |
| voice | 缺失需恢复；当前两宿主没有原 `VoiceSettingsCard` 消费者，不复制空菜单 |
| experimental | 缺失需恢复；原实验页及 feature 消费链不在当前设置中，不以本地开关开启被关闭的 Agent 路径 |
| agents | 缺失需恢复；原默认配置/harness 设置不等于现有受治理 Agent 管理页；原本机进程启动不能取代 Codex 执行权威 |
| channel-templates | 缺失需恢复；原模板 hook、persona/team/runtime 选择与频道创建消费者未贯通 |
| compute | 缺失需恢复；原 MeshComputeSettingsCard 没有本批可用宿主消费者 |
| appearance | 共享迁移：`appearance-settings.tsx`、主题控制、会话密度、字号、链接预览、线程布局；中文/英文为已授权适配 |
| shortcuts | 共享迁移：`settings.tsx::ShortcutSettings`；本批恢复 Web 缺失的真实 Zoom 调用及其三条快捷键，恢复原 KeyCombo 分割行为 |
| hosted-communities | 缺失需恢复；不能用受治理邀请页冒充独立社区管理 |
| community-members | 已授权治理改造：当前 TenantInvitations 经 BFF/原 Action；不是完整原版成员设置等效声明 |
| moderation | 缺失需恢复；原列表/处理调用未接回，不生成假管理操作 |
| custom-emoji | 共享迁移及已授权治理改造；由独立批次处理，本批不修改其源码或声明其业务通过 |
| local-archive | 缺失需恢复；原页面及归档消费者没有接入当前设置 |
| mobile | 缺失需恢复；原密钥配对与 Kailo 独立设备绑定不同，不能把 Web 服务端密钥发给手机 |
| updates | 缺失需恢复；原 updater/provider 与签名发行链未接入当前设置 |

## 已完成的源码改动

提取前 `git show <固定提交>:desktop/src/app/useWebviewZoomShortcuts.ts` 与 Kailo
同路径 `cmp` 退出 0。该原实现完整迁入共用
`client-kit/ts/platform/src/react/use-text-scale-shortcuts.ts`；原缩放值、步长、
上下界、`buzz:text-scale`、修饰键/小键盘解析、storage 同步及清理保持不变。
它们是固定官方呈现规则，不是新造的业务配置、容量或配额限制。

Desktop 的 `useWebviewZoomShortcuts` 只保留原 Tauri `setZoom(1)`，调用同一
共享 hook。Web `PlatformApp` 真正调用该 hook，设置页恢复原 Zoom 分类的
Zoom in / Zoom out / Reset zoom；不是仅补一张说明表。原有中英文词条已存在，
没有新翻译权威。`ShortcutSettings` 删除自行添加的 Mac 修饰符拆分，恢复原
`KeyCombo` 只按 `+` 分割：`⌘B`、`⌘+` 各为一个原版键帽。

## 改动前四步结论

1. 权威：固定上游已经支持整页 rem 缩放；Web/Desktop 共源为既定要求。
   状态是上游支持、共享迁移，不涉及关闭能力的重新准入。
2. 影响：真实写者是共享键盘事件，读者是根字号及同源窗口 storage 监听。
   原设备偏好键不变，旧值仍可读；与 `buzz.appearance.fontSize` 文本专属偏好
   分离。不改变数据结构、契约、BFF、工作流、迁移或 Mobile 原生字号逻辑。
3. 副作用：仅本机 UI 偏好，未复制权威正文、未触发业务动作，也未改变身份、
   scope、权限、额度、计费或 UNKNOWN。Tauri 调用没有进入 Browser。
4. 边界：缺失/非数值取原默认，超界取原边界；StrictMode 清理防止重复监听；
   错误修饰键不接管输入，storage 更新采用同一偏好，卸载移除两个监听。
   不新增网络超时、重试或业务状态；业务六类错误及外部副作用无适用对象。

## 验证边界

本批源码写入之后增加共享行为检查，覆盖原三平台修饰键、缩放/复位、持久值、
原上下界、无关按键、storage 与卸载；原 Web 设置检查同步三条实际快捷键。
本文件不把源码或局部检查当作部署、Windows 设备、全部页面截图或原版
100% 等效验收。

2026-10-07 使用既有 `kailo-agent-receipt-xvkujx` SDK，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
执行用户 `1000:1000`，cgroup 为 4 CPU、8 GiB memory/8 GiB memory+swap。
运行前已检查并发任务、内存与 pressure；本批不另起 Rust 编译或整站构建。
运行目录为其 `/evidence/profile-settings-ortsoo.DRR20F/apps` 私有副本。
原始日志位于 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/`：

| 命令（各工程目录内） | 实际结果 |
|---|---|
| platform `./node_modules/.bin/tsc --noEmit` | 退出 0，`shared.log` |
| platform `./node_modules/.bin/tsc --noEmit -p tsconfig.test.json` | 退出 0，`shared.log`、`restored.log` |
| platform `./node_modules/.bin/vitest run test/text-scale-shortcuts.test.tsx test/settings.test.tsx` | 2 files / 32 tests passed，退出 0，`restored.log` |
| Web `./node_modules/.bin/tsc --noEmit` | 退出 0，`hosts-restored.log` |
| Web `./node_modules/.bin/vitest run src/platform/ui/SettingsPane.test.tsx` | 1 file / 9 tests passed，退出 0，`hosts-restored.log` |
| Desktop `./node_modules/.bin/tsc --noEmit` | 退出 0，`hosts-restored.log` |

第一次 Web 类型检查退出 2：`TS2307 Cannot find module
'@client-kit/platform/react/use-text-scale-shortcuts'`（`hosts.log`）。原因是私有
SDK 的已安装 `file:` 包仍是旧副本；将本批准确的 package export、共享 hook
和 settings 文件同步至两宿主已安装包后，上表双宿主类型检查通过。
没有修改产品依赖、降低检查或添加 fallback。

主动破坏只发生于私有副本，未破坏工作树或线上服务：

- 将共享 hook 修饰键过滤改为 `if (false)`：`mutation.log` 为 1 failed /
  8 passed、退出 1，错误修饰键被接管，`defaultPrevented` 不再为 false。
  还原后与工作树 `cmp` 退出 0，`restored.log` 中 32 项再次通过。
- 删除 Web 的三个 Zoom 表项：`menu-mutation.log` 为 1 failed / 8 passed、
  退出 1，实际 9 行而非预期 12 行。随后还原，与工作树 `cmp` 退出 0；
  `menu-restored.log` 为 9 tests passed、退出 0。

主线已实际截图并打开旧线上 profile、appearance、notifications、shortcuts，
证据目录 `/volumes/data/kailo/tmp/buzz-main-delivery-20261007.s3n2ml/`，
文件 `settings-{profile,appearance,notifications,shortcuts}-live.png`。
旧 shortcuts 缺 Zoom，与本批修复点一致；`settings-emoji-ready-live.png`
实际显示“此处不可用”，不能标记该功能已验收。本批未发布新版本，未把旧图
当成新 hook 的浏览器行为验收；未做 Windows 安装包/设备验证、Mobile 验证，
也未单独重复全量 `check.sh --full`，由主线批次统一收口。
