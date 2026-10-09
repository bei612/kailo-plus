# 2026-10-09：5ba Inbox 与审批只读实拍

本次仅验实际部署的 Web，不验正在改写的 Inbox 双语源码、Windows 或 Mobile。

- 已部署源码：`5baad5e09a6c8abeb33bbfa1904fe0ee77034b78`。
- 镜像：`sha256:04dc4615b6e39c377339c01120a9311b0c10b3ead6c6a0ec75101335acc16f4c`。
- 普通 SSO 会话：`header-restoration`，用户 `seam-verifier`，1920×1080。
- 浏览器正常只读 `/app/platform-build-info.json` 返回 200；
  `buildId=sha256:9985c612c146a9cd611f13457ce699a740354023646d45e26ffb4c107fdfeaaa`。
- 页面入口沿实际 `/app/`；不注入 Cookie、不修改身份、权限、业务数据或消息，不运行 Agent。

## 命令与视觉结果

使用已安装 `/usr/local/bin/playwright-cli -s=header-restoration` 的 `snapshot`、
`click`、`screenshot --filename=…`；通过实际侧栏和 Inbox 原菜单操作。
每张原件均用 `view_image` 打开，不用 DOM 代替视觉判断。

```text
click 收件箱
screenshot --filename=.playwright-cli/kailo-ui-20261009-main5ba-inbox-terminal.png
click 收件箱筛选菜单
screenshot --filename=.playwright-cli/kailo-ui-20261009-main5ba-inbox-filter-menu.png
click 草稿
screenshot --filename=.playwright-cli/kailo-ui-20261009-main5ba-inbox-drafts-empty.png
click 全部
click 原 Inbox 行作者头像
screenshot --filename=.playwright-cli/kailo-ui-20261009-main5ba-inbox-author-profile-terminal.png
click 原资料面板关闭按钮
click 审批
screenshot --filename=.playwright-cli/kailo-ui-20261009-main5ba-approvals-empty.png
console warning: Total messages: 0 (Errors: 0, Warnings: 0)
```

截图目录：`/volumes/kailo/.playwright-cli/`。本次 5 张不同原件、2 条真实页面路由、5 个关键状态；
其中 Inbox 筛选菜单是同页的单独交互状态，草稿只覆盖空态。

| 文件 | SHA256 | 实际结果 |
| --- | --- | --- |
| `kailo-ui-20261009-main5ba-inbox-terminal.png` | `14ad1b20d74cd97eae2d0abd1082033e828573bba6aa767946bd38bddb28bd74` | 真实既有私聊消息、头像、原 Inbox 两栏；私聊详情仍使用线程回复提示，未恢复完整原 DM 文案/语义。 |
| `kailo-ui-20261009-main5ba-inbox-filter-menu.png` | `b0c0e3e4dd80009747d29d34c2755bb14613a911facfabbd2fe3f3a2ee9e107a` | 菜单实际显示全部、提及、线程、Agent、草稿；原其他筛选与实际生产者仍缺，不能称完整原版菜单。 |
| `kailo-ui-20261009-main5ba-inbox-drafts-empty.png` | `9633b68141f5da599eba21e9eaca4dc41cc50a7db4f5e5b4380753992fd85de6` | 原双栏空态和中文提示可见；本次不创建草稿，未覆盖非空草稿/发送。 |
| `kailo-ui-20261009-main5ba-inbox-author-profile-terminal.png` | `21dd5d06ca33aa88ecbc80b99f71469f6f54201ae3b03ea97c7e9c006ca198da` | 资料栏正文宽度已正常，不再 80px 裁切；截图顶部标题/关闭图标空白或模糊，视觉不通过。正常关闭点击成功。资料无 metadata 时保留公钥 fallback，没有伪造姓名、头像、presence。 |
| `kailo-ui-20261009-main5ba-approvals-empty.png` | `f6b778e2c71f3b32864e32df1756713ede79a62feb8bce7344fd5ff94358326f` | 实际平台审批空态；未生成审批请求，不证明审批执行闭环。此为 Kailo 治理页面，不冒称 Buzz 官方原页面。 |

早一张 `kailo-ui-20261009-main5ba-inbox-author-profile.png` 与终态图 SHA 相同，
已打开但不重复计入 5 张。不存在的非空业务状态没有用假数据补图。

固定官方对照：Buzz `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane`、
`desktop/src/features/home/ui/InboxFilterMenu.tsx::InboxFilterMenu`、
`desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane`、
`desktop/src/shared/layout/AuxiliaryPanelHeader.tsx::AuxiliaryPanelHeader`。
私聊 `DM with`/`Open conversation`/`Message {sender}` 分支、其他原筛选及资料视觉缺项仍需恢复；
不把未证明的差异归为治理授权。

首次只读 build-info 辅助使用 `new URL`，CLI 服务端报 `ReferenceError: URL is not defined`，
没有执行写请求；按当前 `page.url()` 解析原入口后正常 GET 200。
该辅助失败与浏览器控制台零错误分别记录，未伪装为首次通过。

本轮源码候选未发布，没有用以上旧版本截图证明新词条、Native 详情调用方或 Web 空正文修复通过。
原全量源码对照未逐处验收，当前仍不能声明 100% 还原或生产验收完成。
