# Web e2fd 实际页面读回

## 运行身份与执行边界

2026-10-10，使用既有 `playwright-cli -s=kailo-ui-status` 正常 SSO 会话，
账号 seam-verifier。没有注入 Cookie、DOM、模拟响应或切换为其他管理员。
未使用 Wren 的浏览器会话。

实际 `/app/platform-build-info.json` HTTP 200：
`buildId=sha256:e2fd03703af893438467954c20bf5aef154ad0b29d0914ac79143f1d624f4415`，
`subject=BUZZ_WEB`，`reportedAt=2026-10-10T23:04:46.820Z`。
对应 root 提供的实际部署 image 为
`sha256:7fd2aacefd5527ac5334ca7e1100153252a41c3abd381692822e7e8e31c5b456`，
候选树 `252cf1239c04717370df803dec302aba354a8e32`。
原 92698 构建已取消 exit 130，没有部署；新 69700 构建 exit 0。
本回执仅证明该 Web；不证明 Core/Windows/Mobile 同步升级或全量门禁通过。

## 逐图和实际操作

全部图片位于 `/volumes/data/kailo/tmp/ui-deployed-e2fd-20261010.sOY1Dh/`，
01–24 都已实际打开作视觉核对，不仅检查 DOM。

| 文件 | 实际状态与结果 |
| --- | --- |
| 01-channel.png | 频道完整消息、授权作者头像、输入区；侧栏仍无三业务组件入口 |
| 02-channel-thread-split.png | 对已有根消息正常 hover 后打开回复；原 split 布局 |
| 03-channel-thread-focus-draft.png | 原 focus 布局与本地未发送草稿 |
| 04-index-thread-reload-missing.png | 确认故障：默认 `/app/?thread=…` 刷新后线程不再显示 |
| 05-channel-route-reload-draft.png | 同频道显式 URL 刷新恢复根线程和本地草稿 |
| 06-inbox-dm-context.png | Inbox 读取已有私聊上下文、作者与回复 |
| 07-inbox-draft.png | 本地草稿列表及预览 |
| 08-inbox-open-original-thread.png | 文件名不准确：实际是悬停后的草稿操作区，第一次全局定位碰到两个按钮，没有完成打开 |
| 09-inbox-open-thread-success.png | 使用原列表内按钮真正打开草稿，导航至正确频道/根消息 |
| 10-dm-native-thread-focus.png | 既有私聊的原 focus 线程 |
| 11-dm-native-thread-split.png | 同私聊原 split 线程 |
| 12-workflows-list.png | Kailo 作用域已有三条工作流；语义卡片、频道和名称，未再堆叠 UUID |
| 13-workflow-detail.png | 原定义对话框及真实治理版本/权限信息；未执行启停或删除 |
| 14-workflow-existing-form.png | 读取原有 AGENT_TURN 单动作草稿，未改写/发布 |
| 15-workflow-existing-yaml.png | 同一既有草稿 YAML，未提交；不据此推断多步骤分支不存在 |
| 16-agents-list.png | 原 Agent 卡片布局，实际安装记录状态；不把 ACTIVE 当健康证明 |
| 17-agent-installation-unavailable-session.png | 安装详情会话请求实际 HTTP 404，显示不可用，没有伪空历史 |
| 18-profile-settings.png | 原资料布局和现有头像；未修改资料 |
| 19-appearance-zh.png | 中文外观设置 |
| 20-appearance-en.png | 原语言单选切换英文后截图，随后正常切回中文 |
| 21-invitations.png | 原邀请页面无旧重复标题；显示已有三成员及历史邀请，未新建或撤销 |
| 22-notification-settings.png | 实际浏览器通知被阻止，提示保留；未修改浏览器授权 |
| 23-keyboard-shortcuts.png | 原快捷键页面，只读 |
| 24-explicit-unknown-channel.png | 不存在的显式频道引用不回退到其他可见频道，不显示线程；当前错误文案误说整个 Tenant 无可进入工作区，仍需准确化 |

真实频道为 `96f53670-409d-4f8e-aa49-c32550fdd10d`，根消息
`310e1df1d786508f9f848b28254b946fc8ac288d5875ff2e683893b9a3ec64d0`。
私聊 binding 为 `36667917-f326-4a36-86f2-e0b31a0ea4c8`，根消息
`fce7c175281118f078a1f9e05c1eccd45540459c344550ef62cb7248c359ab5e`。

只在原空线程输入框创建了本地草稿
`Kailo 线程布局验收草稿 2026-10-10T23:10Z（不发送）`，未点击发送。
频道 split→focus→split→focus 的真实编辑器 ElementHandle 比较均为同一个 DOM 实例，
文本不丢；私聊 focus→split 也为同一实例。
Inbox 打开此草稿后实际 Back/Forward 仍恢复同一根与草稿，没有发出消息。
这不等于 UNKNOWN 写请求保持验收，也不等于已有消息 dirty-edit 离开提示已验。

会话读取实际路径
`/api/v1/agent-installations/115225ae-330c-4597-9b00-a297b02f0555/sessions`
返回 404；未以新版 Web 的展示成功宣称服务端接缝可用。
图 24 只证明未知资源的显式路由无回退，不是运行中真实撤权验证。

## 原版对应及仍未完成项

来源分开记录：Web 独立宿主来自 `web-client/fork/upstream.yaml` 的
`implementation_base_commit/evidence_commit = a6766c482533d028582d0efcfd3740769f86217c`
（`.references/buzz-web`）；下列共源 UI 来自 `collaboration/fork/upstream.yaml`
固定的 Buzz 779af（`.references/buzz`）。两工程来源字段与原符号均以只读 git show 重新核对。
e2fd 是实际产物输入摘要，不是任一上游 commit，不能混称。

固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/channels/ui/ThreadViewModeToggle.tsx::ThreadViewModeToggle`：
  共享迁移，原图标、tooltip、split/focus 行为与本次实拍相对应。
- `desktop/src/features/channels/ui/useChannelPanelHistoryState.ts::useChannelPanelHistoryState`：
  线程部分共享迁移与 Web 授权读取适配；其余 profile/agentSession/channelManagement URL 状态未在本轮恢复或验收。
- `desktop/src/features/messages/ui/DraftsPanel.tsx::openDraftEntry/sendDraftEntry`：
  原打开草稿导航已实际消费；发送仍沿治理，本轮不发送，不凭打开成功声明发送/幂等完成。
- `desktop/src/features/workflows/ui/WorkflowCard.tsx::WorkflowCard` 与
  `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel`：
  原语义卡与详情结构共享恢复；版本、准入与委托数据是具体治理接入差异，不豁免其余视觉差异。

此前全量差异表的基底为 apps `dd399f93f584b30d4a6301a5024c3959d4d420e6`，
不能将其中 5314 路径分类统计当成本次 e2fd 的全量完成率。
本轮用既有逐批来源回执补充实际运行证据，不重新制造全量扫描工具。

仍缺完整 Projects Detail/Issues 正文权限闭包、原 Agent Transcript/working 的逐 turn 内容授权、
三组件可用绑定入口与真实页面链，以及本轮未覆盖的页面/关键状态。
图 17 的长治理元数据详情不是原版 Agent 工作/会话面板；即使这些数据真实，
也不能计作原 Working/Transcript 布局与交互已经恢复。
默认索引频道刷新故障已形成独立私有修复与 23 项原路由验证，尚未部署；
图 04 不被改写为修复后成功。没有“100% 还原”或生产就绪结论。

## 2026-10-11 头像保存、刷新与恢复

同一正常 SSO 会话在原资料页操作验收账号 seam-verifier，先读取原值，再由
原头像编辑器选择 😀 并点击完成。`GET /api/v1/profile` 实际 200，返回
原生 SVG 表情及新事件
`c1877fc72f760fd504e3289d784feb512b568c382e8e54e02cbf1391e23bfc0b`；
整页刷新后仍显示该表情。显示名和简介均保持原空字符串。

恢复沿同一编辑器的图片页签粘贴原链接、点击完成，没有直接写数据库或借其他身份。
首次尝试没有读到恢复事件，不计成功；重新打开编辑器完成操作后，实际 200 返回
恢复事件 `7ed29f5275d37016759473b52a3e604a18f7d2e755f8c70497c9fd990173f954`。
再次整页刷新后，avatarUrl 与原值一致，原对象摘要
`d2224f5bbefa9e513c459e7e2248683bc01f036ab1719c724accd06808db3dde`
对应的 `/api/v1/profile/media/` 图片实际加载完成，naturalWidth 大于零；名称、
简介未变。恢复的是资料值，不伪造恢复旧事件 ID 或删除这两次真实发布记录。

两张图片均实际打开作视觉复核，目录为
`/volumes/data/kailo/tmp/ui-restored-consumers.IjIJBy/`：

| 图片 | SHA-256 | 实际证据 |
| --- | --- | --- |
| avatar-emoji-saved-20261011.png | 98bb2219e66226e3247ff99576c1334196d61359cabe4d01d426a85a8e4517ee | 保存并刷新后蓝底表情 |
| avatar-original-restored-20261011.png | 48cb0ca941ae4efb1d7ca19f1afa3ae54866b21a6145563202fed8be29b993c8 | 恢复并刷新后原机器人图片 |

仍有明确边界：编辑器粘贴旧链接时，当前资料已是表情，旧图片不在该次
avatarMediaPaths 中，临时预览触发一次被 CSP 拒绝的外站图片加载；未放宽 CSP，
保存后的授权媒体映射和刷新显示正常。这项预览缺口没有被本次验收修复。
本轮只证明已有头像表情保存及旧图片链接恢复，不证明新图片上传、动态头像、
全部用户设置、Desktop/Mobile 或全量原版一致性通过；没有发布新镜像。
