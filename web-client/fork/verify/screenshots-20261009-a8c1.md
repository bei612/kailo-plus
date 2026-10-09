# 2026-10-09 a8c1 Workflows／图库实拍

## 实际版本与边界

- 固定源码：`a8c1cc8cc9a61334acf4bb4ed776a16992a37d35`。
- 浏览器正常刷新后实际 GET `/app/platform-build-info.json` 为 200，buildId 为 `sha256:0269a07631509d28ade623f38e4dac6fa229e363f153c92fb10780bf4b770127`； reportedAt 为 `2026-10-09T01:48:14.103Z`。
- Root 发布回执对应 image `sha256:871dc5b0719889d6e4cee4eab17540015c48f58385ce86910680d7e80de00ac1`。
- 实拍时间 2026-10-09 01:53–02:04 UTC；安装好的 `/usr/local/bin/playwright-cli -s=header-restoration`，正常 seam-verifier 身份，1920×1080。
- 本批 17 张截图全部用 CLI screenshot 产生、再逐张打开原件视觉复核；只覆盖下列状态，不代表全页面、全量 Workflows、Windows 或 Mobile 验收，也不声明 100% 还原。

## 工作流实际操作

使用现有 Kailo 工作区、授权目录实际返回的执行器安装；未创建、保存、启停或运行工作流，未触发 Agent turn。

1. 中文创建草稿选择“发布模板消息”及真实执行器，原“添加步骤”主按钮可用，画布显示原 trigger 节点。
2. 点击实际 Dialog→Canvas 首步骤消费者；编辑第一条发送消息草稿，Inspector 显示原步骤字段与详情入口。
3. 在真实消息 textarea 按 Escape：Inspector 关闭，编辑 Dialog 与该步骤草稿保留。紧接操作返回值可能早于 React 更新，后续 detached 等待、截图及 YAML 内容均证实草稿保留，不将瞬时计数误称缺失。
4. 切换 YAML：实际 textarea 含同一草稿 `KAILO_WORKFLOW_DRAFT_VISUAL_20261009`；原 Textarea 与“直接编辑原始 YAML 定义”帮助文案已呈现。
5. 英文重做相同草稿操作，确认原 Add first step / Close inspector / Form / Workflow YAML 的真实消费及同草稿英文 YAML。
6. 两种语言均点击 Close→Discard changes，均复现真实关闭缺陷：Dialog/AlertDialog 已为 0，但 `body.style.pointerEvents` 与 computed 值仍为 `none`。中文随后正常个人菜单点击 30 秒超时，日志明确 html intercepts pointer events。没有 force click、改 DOM 或全局 pointer reset；仅正常刷新继续后续验收。

尚未验收：写意图 busy/UNKNOWN 的真实发布链、审批/额度与实际执行、完整原 trigger/action 集、原运行历史及所有步骤类型。本批只验证草稿，不以打开弹窗代替工作流创建成功。整个父 Dialog 的治理字段布局与固定原版仍有差异，不称完整像素一致。

## 图片真实业务链

Root 明确授权在本人已加入的专用“频道恢复验收 20261006”通过正常附件 UI 使用最多 3 种已入库官方非敏感图片资源。没有创建账号/成员/频道、没有操作用户业务文件、没有直接写 API/数据库。实际频道上下文为 `96f53670-409d-4f8e-aa49-c32550fdd10d`。

资源均在固定官方 779 和 a8c1 中同 blob，上传前已打开查看：

| 源资源 | Git blob |
| --- | --- |
| `collaboration/desktop/public/landing/buzz-wordmark.png` | `a05e0fdb1cb186edaf6a4c3ea139c15dca1447cb` |
| `collaboration/desktop/public/pow/poof1@3x.png` | `48b5166c1a686b74780a3a8d81883e59cdab260c` |
| `collaboration/desktop/public/pow/poof2@3x.png` | `2e1d6f269b6ee18fa4e9747beba0fa1cb13fffca` |

CLI `run-code` 的 fileChooser.setFiles(3 张) 实际已启动上传，但命令回显仍报告 File chooser modal；随后原 `upload` 命令又选了 wordmark，产生重复附件。因此实际媒体 POST 共 **4 次，均 200**（原网络编号 2564、2565、2567、2570），涉及 3 种资源；不是 UNKNOWN 后重传，不隐瞒第四次上传。没有再上传。原移除附件按钮经真实键盘 Tab→Enter 删除 wordmark 附件，两个同 URL 附件均从草稿中移除。鼠标直接点隐形移除按钮及 hover 原缩略图曾超时，均保留为交互边界，不 force click。

仅点击一次正常“发送消息”，网络编号 2571 的消息 POST 为 200。验证代码里使用服务端未提供的全局 URL 导致回执监听抛 ReferenceError，但**点击已执行**；立即只读核对原 requests 和实际消息，没有重发。实际事件 ID 为 `310e1df1d786508f9f848b28254b946fc8ac288d5875ff2e683893b9a3ec64d0`，实际发送 **2 张 pow 图片**，wordmark 未发送。

已实际通过：

- 两张图片授权 BFF URL 加载成功，naturalWidth/naturalHeight 均 528，真实消息呈原双图网格。
- 原灯箱第 1/2 张、Zoom in 100%→115%、下一张→2/2、键盘 ArrowLeft→1/2。
- Escape 关闭灯箱并把焦点还给真实 `message-image-lightbox-trigger`，body pointerEvents 为 auto。
- 正常刷新后同一消息仍存在且原两张图片可打开，没有重复发送。
- 中英文灯箱、原媒体右键 Copy image / Download image 菜单实际呈现并打开截图。
- 实际下载完成 `failure=null`，文件 `gallery-downloaded-poof2.png` 的 SHA256 为 `53006c9103f9132ea7da1fb0ee77bc9f0af399df8ec0d1a3f76588c374b3247a`，等于真实 BFF 资源 hash。原件位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/workflow-editor.yrqvYl/gallery-downloaded-poof2.png`。

真实失败：该部署入口为 HTTP，`isSecureContext=false` 且 `navigator.clipboard` 为 undefined。实际点击“复制图片”得到“复制失败” toast，截图记录；未开浏览器不安全 flag、未注入 ClipboardItem，也不声明复制成功。未有真实坏图，图片网络错误 UI 未验收；不 mock route、不伪造 DOM 或通过破坏资源制造错误。

本批最终 console error 原 CLI 汇总为 `Total messages: 0 (Errors: 0, Warnings: 0)`；这不抹除上述真实操作及工具调用失败。

## 偏好恢复

临时只启用 Workflows，其他 3 开关未改。结束后恢复简体中文、Workflows/Projects/Pulse/Forum 4 开关全 false；正常刷新后实际再次读取仍全 false，lang=zh-CN、pointerEvents=auto、buildId 仍为 0269a076。未改其他偏好。

## 固定官方当前完整 union

只读两个固定 Git 树的 `git ls-tree -r`，按原相对路径 mode/type/blob 一一比较；apps 仅映射 collaboration/ 并排除 fork/ 来源记录，不以 worktree dirty 或旧 3313/3323 快照充当当前。

- 官方：`779af8886caae1317b4de962082429867ab61503`，5195 路径。
- apps：`a8c1cc8cc9a61334acf4bb4ed776a16992a37d35`，collaboration/ 下 2894 路径，排除 fork/ 20 后 2874。
- union **5314**；同原路径 mode/type/blob **1978**；差异 **3336**＝M777＋D2440＋A119。
- 四类台账：原样保留 **1978**；共享迁移 **110**；已授权治理改造 **0**（未凭笼统治理给整文件授权）；缺失需恢复（尚未证明保留或授权） **3226**。
- 110 共享仅沿既有窄原模块/实际消费证明，其中 109 目的文件当前 blob 与既有证据逐条一致；另一个固定原 9 行 GuardedChannelPane 转发包装已重新核对 a8c ChannelScreen::ChannelPane 直接消费。它们**不是**整个文件/UI 的功能或像素验收。
- 3226 是尚无完整保留/共享/授权证明的恢复复核队列，包含新增、修改、原路径缺失；不是断言 3226 项业务功能全不存在。旧“未分类”已按本次要求显式归入该保守类别，不用改名掩盖实际证明缺口。
- 完整 TSV：`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-a8c1cc8cc9a6.classification.tsv`；SHA256 `6101ed6be510d1b44585c31e35ceff61783992357ee2814a9eb052dedf5b6c56`，5314 数据行。
- 列：upstream_commit / apps_commit / path / change_kind / category / upstream_mode / upstream_type / upstream_blob / apps_mode / apps_type / apps_blob / destination / evidence / historical_category。
- 历史 dfc7 台账保留不改，本节不把其 1982/3332 旧统计称为 a8c1。原样保留仅源码字节证据；完整原功能、三个组件、全页面中英、Windows/Mobile 仍需分别验收。

## 本批截图原件与 SHA256

| 原件（全部已打开复核） | SHA256 |
| --- | --- |
| [kailo-ui-20261009-maina8c-gallery-copy-http-failure.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-copy-http-failure.png) | `50f6e4d9a61e07d4a5136bacf8dcbea2b5750f0a37940b9fa2888d450a1fbe89` |
| [kailo-ui-20261009-maina8c-gallery-en-context.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-en-context.png) | `ecccf9129071e1d4d7ed678813a35201fedfade8df0f302d71b319fe7e84bdb0` |
| [kailo-ui-20261009-maina8c-gallery-en.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-en.png) | `33353dc41bcd5d88c8c8cf495cb1b66d0fcf2ea1143fb46c8169dd5cef769b11` |
| [kailo-ui-20261009-maina8c-gallery-zh-context.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-zh-context.png) | `f0314b08e1c791b1df4d549c055db842ca262c023416b9f5493ea2c77383952f` |
| [kailo-ui-20261009-maina8c-gallery-zh-first.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-zh-first.png) | `33353dc41bcd5d88c8c8cf495cb1b66d0fcf2ea1143fb46c8169dd5cef769b11` |
| [kailo-ui-20261009-maina8c-gallery-zh-second.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-zh-second.png) | `db3a83fb7012f8d61a2d3c2dac6ec4e33409cf7e8b27049e2c960799c054dfea` |
| [kailo-ui-20261009-maina8c-gallery-zh-zoom.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-gallery-zh-zoom.png) | `0d0ccef6799df8a6f1a773bb35f343a98c4c816537b51530299983dad3e98b42` |
| [kailo-ui-20261009-maina8c-media-grid.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-media-grid.png) | `82029f2e3358de7c495bbaaf75ddcc27a42c6b98105f49bf750b7e141419985d` |
| [kailo-ui-20261009-maina8c-media-upload-ack.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-media-upload-ack.png) | `2e4d309e0f5482ed7432e74653db8a54b5f23fc94e259395c3c250d48f69dc16` |
| [kailo-ui-20261009-maina8c-workflow-discard-pointer-failure.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-discard-pointer-failure.png) | `404e98408128138c5b69ea65cf74d35c8458da0596ce747341b0672ae12c6861` |
| [kailo-ui-20261009-maina8c-workflow-en-escape.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-en-escape.png) | `7e14e08ef455c386ee4b32a9cbe2f82b42d667e43ff3b9906ed3f1e4edc22d9a` |
| [kailo-ui-20261009-maina8c-workflow-en-inspector.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-en-inspector.png) | `3c773caafadc9f03f95361c683edec44d0a67bd1eeb7e77af602c182652ee4fe` |
| [kailo-ui-20261009-maina8c-workflow-en-yaml.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-en-yaml.png) | `cfe1c39cf864b5f37e6c936c14675b512a8c7ed59c6406bef94b8744d8a71804` |
| [kailo-ui-20261009-maina8c-workflow-zh-empty.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-zh-empty.png) | `a94cbc3cc482a522324443fcc9a5795625b4748c1d775ff2dc006acdfce20e95` |
| [kailo-ui-20261009-maina8c-workflow-zh-escape.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-zh-escape.png) | `cb729e623bcc5b89d83f8779d6aa23ec75249132d3f4e6bde553511dc7f836fc` |
| [kailo-ui-20261009-maina8c-workflow-zh-inspector.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-zh-inspector.png) | `8ae6ee0375f41315c7359a8f1e46e6980e8d3bdbce87ec70fa89efd021f7dbb8` |
| [kailo-ui-20261009-maina8c-workflow-zh-yaml.png](/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina8c-workflow-zh-yaml.png) | `c7e76d6af85a871c1c986e1fc8555fe30ff7752f6a16c8410ae701f21b4c0f9a` |

## 原命令与失败／跳过

实际命令沿既有 CLI：`reload`、`snapshot`、`click`、`fill`、`press`、`upload`、`screenshot --filename=...`、`run-code` 的正常 page/locator 操作；下载使用真实 download 事件并 saveAs。没有请求头、Cookie、token 或密码写入本记录。

保留工具级错误：英文初次误写 option “Post message” 而实际 “Post template message” 导致 30 秒 select 超时，改为当前快照实际项；原自定义媒体菜单是 button 而非 menu/menuitem，初次 locator 等待超时后按原 data-media-context-menu/button 实际消费者操作；错误 settings-nav-experiments locator 等待超时后使用实际“实验功能”按钮恢复偏好。均不计为功能通过，也不把定位错误说成后端拒绝。

没有运行新 bundle/镜像/full/新 SDK；没有 Windows/Mobile 设备验收。工作流关闭锁已报告并进入按固定原依赖/实际消费者修复，当前这 17 张图只证明 a8c1 运行字节，不能证明后续修复。
