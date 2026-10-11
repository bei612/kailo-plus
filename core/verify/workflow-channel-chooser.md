# 原工作流频道选择器共享恢复

## 来源与权限边界

本增量基于主线 `c442f2bb6e5c9e4db624057fe756272574a807f2` 上已冻结的删除/详情候选；已由精确补丁写入正式工作树、尚未提交；不修改运行中的 `c381e68b783b1860c510128126bba3c9a58556b9` 全量检查输入。用户要求的原版恢复、`.design/06` 工作流治理及 `.design/07` 两端共源边界决定本批范围，没有新增执行种类。

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/ChannelCombobox.tsx::ChannelCombobox`、`desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog`、`desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowFormBuilder` 是原控件和实际呈现位置来源。`desktop/src/shared/ui/PortalledScrollArea.tsx::PortalledScrollArea` 原样迁移；`desktop/src/shared/ui/popover.tsx::PopoverContent` 的 `portalled` 默认语义恢复到既有共享 wrapper。

差异分类：滚轮组件原样保留；选择器及其表单/YAML位置共享迁移；授权 WorkspaceView 目录、执行器和审批准入、同源中英词条属于已授权治理/宿主适配；原私聊工作流 scope 仍未恢复，不因原控件支持私聊而开放 Core 未准入动作。无契约、数据库或旧格式迁移。未知可见性不冒充公开频道。

## 实现后影响与异常复核

- 读写方：既有 AutomationManagement 将授权目录交给 AutomationAction，原弹窗内可检索、键盘选择频道。频道选择只调整该草稿的 scope，随后既有 automations/agentInstallations 消费者重新读取准入；两端使用同一 TS 主体。编辑既有工作流保留原只读频道控件。
- 草稿：频道改变保留名称、描述、步骤、YAML 和明确审批引用，清除旧执行器及分页。原 dirty/discard 比较包含 scope；外层宿主导航仍按既有拦截和重置规则处理，不新建第二草稿权威。
- 副作用：初版候选曾错误清空 policyKey，交叉复核后已删除该行。顶层审批与步骤审批在新 scope 不可用时原 policyAvailable/contentUsable 阻止提交；不会自动改为 NONE。原 unchanged YAML→Form 快路径保留原审批字段，不做新的配置转换。发现目录不等于创建权限，所有写入仍由原 prepare/冻结 command/BFF fresh 准入执行。
- 边界：空目录、目录未知或选中项被撤销使有效 scope 缺失；新 scope 的读取首帧为 pending，不能借旧准入或旧执行器提交。忙碌、冻结意图和 UNKNOWN 时禁用选择器；不重复投递、不将未明状态改成成功。只在原真实提交关联与目录检查后更新列表作用域，不额外声明执行终态。共享 Popover 其他消费者保持默认 portal；没有修改其权限或媒体调用。Mobile 不增加组件/工作流宿主入口，只按原词条生成路径同步目录。

## 实际证据与尚未验收

原受限 SDK `kailo-agent-receipt-xvkujx` 在生成前实际只有 sleep，4 CPU / 8 GiB 内存及同额 swap 限额有效，宿主 available 25 GiB。独立 `channel-i18n.MSlrVw` 输入只包含原生成器、当前合同与本批 TS 词条，未覆盖旧检查快照。原 `python3 tools/gen-platform-i18n.py` 会话 37962 实际退出 0，输出：

```text
Generated client-kit/dart/lib/shared/platform/reason_text.dart
Generated client-kit/dart/lib/shared/platform/platform_text.dart
```

生成后的 platform_text.dart 与本候选逐字 cmp 退出 0，仅增加九条共享词条及其枚举成员，没有手写 Dart 翻译。事后检查文件 `client-kit/ts/platform/test/workflow-channel.test.tsx` 已写入八项真实 AutomationManagement/选择器消费者场景，覆盖新 scope 拒绝、执行器清除、审批保留、只读和原键盘选择；尚未执行，不算通过，也尚无真实生产破坏/还原证据。

本批未运行类型检查、DOM、full 或新镜像构建，未提交、推送、部署。现有浏览器会话已过期，旧部署 `4c099a5f9b508f7df47b9fc923fe37ab7375aa70` 的 DOM 和截图不能证明本批选择器；没有本候选页面截图，不声明原工作流完整恢复或生产就绪。

## 集中验证结果（2026-10-10）

本批随消息派生作者、步骤字段集中执行，命令及完整输入边界见[三批集中验证](workflow-step-fields.md#三批集中验证2026-10-10)。84879 shared 生产类型退出 0，检查类型退出 2：新增审批用例 `selectedOptions[0]` 严格空值错误。仅以 `selectedOptions[0]?.disabled` 修正访问，仍断言必须为 true；无选中 option 或审批被清除不会变成通过。修正后的 77883 shared 生产、检查类型与 Web 类型均真实退出 0（采用该轮主线正式生成物），不回填原失败。原 workflow-channel 与 workflow-form-canvas DOM 60.01s、0 tests/2 worker 启动超时错误，停止重试，无业务断言或生产破坏/还原结论。正常 IdP 登录已恢复，但当前 Web 仍旧 4c099 部署，无本批候选页面截图；不称原完整工作流已恢复。

主线程统一收口时，58377 对正式冻结输入集中执行一次原六文件 DOM，结果见[四批 DOM 收口](workflow-step-fields.md#四批-dom-收口2026-10-10)。workflow-channel 再次为 worker 启动失败、0 用例，不记业务断言通过；未做生产反证，不再重试或改超时。已有三项类型 0 保留原输入边界，不替代本次交互验收。

2026-10-10 后续资源窗口实际收口：Cells 释放原 SDK、DM 两文件先真实 20/20 后，同一 69408 原命令执行本文件 8/8（与 form-canvas、agent-library 合计 51/51），shared 生产/检查类型均 0；详见[同批收口日志及命令](dm-unread-overflow.md#同批真实头像及删除证据收口2026-10-10)。30542 私有恢复跨频道清空审批的错误后，本文件 worker 未启动，因此未获得这条生产反证，不将启动失败记为有效拒绝；随后生产字节 cmp 0 还原，不重复失败文件。原 0-case 历史保留；候选浏览器/Windows 仍未验收。
