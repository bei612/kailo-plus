# 原版频道导航快捷操作恢复

本批关联 REQ-24、DD-75、DD-80 与 SS-BUZ-GOVERNANCE。恢复原版可执行入口，不建立新的频道、私聊或权限权威。

## 固定源码与完整差异边界

比较基准为 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/app/useAppShellKeyboardShortcuts.ts::useAppShellKeyboardShortcuts` 的完整文件已核对。原版 Mod+Shift+K/N/O 三个分支分别调用新私聊、创建频道、浏览频道；Kailo 原 Desktop 只保留搜索 F/K 与主页 A，本批将缺失三分支迁入共享 `useChannelNavigationShortcuts`，Web/Desktop 使用同一实现。
- `desktop/src/shared/lib/keyboard-shortcuts.ts::KEYBOARD_SHORTCUTS` 完整对照，原 `browse-channels`、`browse-dms`、`new-channel` 三条按原顺序、原英文文案、原 Mac/Windows 键位恢复。中文词条进入既有同源 i18n；不重新设计设置页。
- 原搜索与主页分支仍由 Native 既有 hook 承担，没有复制处理器。原 huddle capture handler 不在本批恢复范围；缺失的 huddle、push-to-talk、always-address-agent、publish-note 等不能因这三个导航分支恢复而记为完整还原。Web 不将没有处理器的搜索/主页条目伪装成已恢复。
- 原 `desktop/src/features/sidebar/ui/CreateChannelDialog.tsx::CreateChannelDialog`、`desktop/src/features/channels/ui/ChannelBrowserDialog.tsx::ChannelBrowserDialog` 已有的共享治理适配继续复用；本批只将真实快捷操作连到这些消费者，不添加卡片或替代弹窗。

四类差异：事件过滤、分支键位、英文描述为原样保留；三分支及两端对话框为共享迁移；创建/加入继续经现有 BFF 准入属于已授权治理改造；未交付的原其他快捷能力仍属缺失需恢复，不混入本批完成声明。

## 动手前四步结论

1. 权威：DD-80 保留原创建频道与私聊产品能力，但替换未治理的 Relay 管理写入。本次只是原快捷入口恢复，既有 `CreateChannelDialog → useWorkspaceCreate → /api/v1/actions`、`ChannelBrowser → discoverableWorkspaces` 和两宿主原 `onNewMessage` 都已有真实消费者；没有新权限模型、Schema、持久表或工作流。
2. 影响：共享 hook/包导出、共享设置说明、两宿主侧栏对话框状态及原快捷列表。Web 使用当前已认证 SignedIn 导航，设置打开时禁用；Desktop 侧栏仅在非设置视图挂载，缺 principal 时禁用。对话框按 principal key 隔离，仍使用原 PlatformProvider 认证作用域。Mobile 无本批键盘入口变化。
3. 副作用：按键只导航或打开原弹窗，不直接创建、加入或发送消息。创建继续要求服务端投递的 createActionKey，缺失时原输入/提交禁用；已有准入、UNKNOWN 意图与幂等行为没有改写。没有恢复原直接 Relay 自建或绕行入口。
4. 边界：Mod 排他、Alt、repeat、defaultPrevented、Shift 与大小写沿原语义；普通 Mod+K 留给搜索/编辑器。监听器卸载/禁用清理并验证 StrictMode 不重复调用。空目录由原空态承担、拒绝授权由原禁用态承担；网络错误、额度、审批及不明终态继续由原消费者按六类错误合同处理。本批不宣称新增跨会话串行保证。

## 实际验证

在既有 `kailo-agent-receipt-xvkujx` 受限 SDK、`/evidence/profile-settings-ortsoo.DRR20F/apps` 执行；运行前核实容器 `NanoCpus=4000000000`、`Memory=8589934592`、`MemorySwap=8589934592`，宿主约 31 GiB available，未见并发编译。不安装依赖、不重建镜像。

```text
client-kit/ts/platform:
./node_modules/.bin/vitest run test/channel-navigation-shortcuts.test.tsx test/settings-shortcuts.test.tsx
Test Files 2 passed (2)
Tests 27 passed (27)
exit 0

./node_modules/.bin/tsc --noEmit -p tsconfig.test.json
exit 0

web-client/web: ./node_modules/.bin/tsc --noEmit
exit 0
collaboration/desktop: ./node_modules/.bin/tsc --noEmit
exit 0
```

新 14 项覆盖三宿主键位、StrictMode、错误修饰键、repeat、已处理事件、禁用/卸载、真实创建对话框有/无准入、真实频道目录读取及中英文原文。创建按键本身零写，实际填写提交仍调用 `/api/v1/actions`，acceptance 不渲染为 Channel created。无 createActionKey 时原输入与提交均禁用，点击不产生写入。

首次新检查错误预期无权限时不渲染 input，实际原组件渲染 disabled input；得到 `1 failed | 26 passed`。修正检查以验证真实输入与提交禁用且零写，没有弱化正式实现。

实现之后仅在私有 SDK 主动将 N 分支改为 X，并移除 repeat/defaultPrevented 保护：`7 failed | 7 passed`、exit 1。随后 apply_patch 精确还原，`cmp` 与正式 hook 相等，重新 `27 passed`、exit 0；还原日志 `/volumes/data/kailo/tmp/channel-shortcuts-20261007.sG31MZ/restored-tests.log`。正式树没有变异残留。

本批精确文件 `git diff --check` 通过。全树 diff check 另报 inherited custom-emoji/附件四文件 EOF 空行，不由本批修改。全局 full、真实浏览器逐页截图、Windows 安装包与 Mobile 设备、部署均未在本子任务执行，由主线集中收口。浏览器保留快捷键若不向页面投递事件，不属于 DOM 检查可以证明已可用的范围；未以该检查声称设备全等效。

## 仍有的独立差距

Channel templates 仍需其完整 Canvas/persona/team 依赖；本批没有削掉模板目标。Canvas 原版 UI admin 限制不能证明 Relay 服务端管理权限。此前 kind 40100 候选因缺同一 SpiceDB 管理权限闭合已精确撤回，保留于私有 `/volumes/data/kailo/tmp/canvas-authority-candidate-20261007.GyimlR`；正式 Core 三文件 diff 为零、两 schema 删除，未开白名单、能力或菜单。不能把该候选、源码复制或本批快捷键记为 Canvas/模板已交付。
