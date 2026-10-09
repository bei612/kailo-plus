# c309 设置与消息菜单只读实拍

2026-10-09 03:29–03:32 UTC，普通 `seam-verifier` 用户，既有
`header-restoration` 浏览器会话，1920×1080。固定原版对照为 Buzz
`779af8886caae1317b4de962082429867ab61503`。

## 实际版本与边界

- 本轮开始原会话已过期：读取 build-info 被重定向 IdP 后触发浏览器
  `connect-src 'self'` 拒绝。普通 reload 到真实 OIDC 登录表单。
- 沿官方 CLI 已有 `Session.run` 在 Node 内存读取受控验证账号输入并正常填表，
  不输出口令或填表响应，不保存明文副本，不注入 Cookie/session，不重置账号。
- 登录后两次 GET `/app/platform-build-info.json` 均为 HTTP 200，buildId 为
  `sha256:8fad767a9bbf7aad320025c6a0ab7a8e83e4580aad4617b13c4c54521f0c3fb4`，
  对应已发布源码 `c309a2606c2f4f688a8fe5f50fbe6742b1ca0d74`，不是当前 main。
- 生成并打开了 10 张图片；本文件纳入 8 个有效状态。过期会话的旧已加载外观图、
  滚轮落在非滚动面产生的重复视口图不作为验收证据。
- 未新增、修改或删除账号、频道、消息、表情、资料、邀请或权限，未运行工作流或
  Agent turn。仅导航、滚动、打开菜单；语言、主题和实验功能偏好未改变。

## 已打开的有效原件

目录：`/volumes/kailo/.playwright-cli/`。所有下列文件均带前缀
`kailo-ui-20261009-mainc309-`。

| 图片后缀 | 视觉复核及范围 |
| --- | --- |
| `appearance-original-gap-zh.png` | 真实字号/密度行及预览；原 `ConversationPreview` 的 Eye 图标缺失 |
| `appearance-link-thread-preview.png` | 真实链接/线程预览，二者保留原 Eye；会话预览仍缺图标，原中英文案有删改 |
| `notifications-readonly.png` | 设置完整可见状态；浏览器通知权限实际被拒绝，不能称通知送达通过 |
| `shortcuts-readonly.png` | 原只读快捷键列表实际呈现；未逐项执行快捷键 |
| `custom-emoji-readonly.png` | 原上传/命名表单及本人列表空态；未上传、保存或验证非空列表 |
| `invitation-existing-gap.png` | 现有 BFF 邀请列表真实数据；仍为平台简表/重复标题，不是原社区成员页恢复 |
| `message-menu-before-read-restoration.png` | 本人既有图片消息菜单，编辑/复制/删除可见；没有读/未读项，未执行这些写动作 |
| `profile-popover-existing-gap.png` | 实际头像/个人菜单仅设置与退出；presence/custom status 未恢复 |

```text
fa9ecec292f81fa95f1529ef2c9f464690a7235a1ce57b3deba3649a1bde1125  appearance-original-gap-zh.png
fe417c1fb72797167733725f09698f86b329d3be84132e3b2934a4faa16f1b71  appearance-link-thread-preview.png
e7ea2e5780c719d7d9792c95666a946ff230715c00a57073756344a669bc3126  notifications-readonly.png
fdab3b83e62eaa15b74bb5a2145d1f87782e658cb4b4e77d128d3e8922f0be93  shortcuts-readonly.png
ffc179aa194f61a398e8c92e4d7173d67a9febe498d87af35650c9e8c84627f7  custom-emoji-readonly.png
cb8db95ac4e700519fad9e51c880ccf3736c7265b0476fa65a0d572c61222df8  invitation-existing-gap.png
019fa22281834449cd653b693ef4560585e1d813b0a03620008a6d5e57cd16af  message-menu-before-read-restoration.png
2991481f1fc1c7555946676bc84145b752a6accd78f843e9e9d1ecff3b68c918  profile-popover-existing-gap.png
```

实际命令为 `playwright-cli -s=header-restoration` 的 `reload`、`snapshot`、
`click`、`hover`、`press Escape`、`screenshot --filename=…`；滚动使用
`run-code` 调用真实元素 `scrollIntoViewIfNeeded`，未改变 DOM 或业务响应。
图片保存后逐张调用本地图片查看器打开，不以 DOM 计数替代视觉复核。

## 不能据此声称的内容

原字号/密度行及 Eye/文案恢复候选尚未发布；已提交的普通频道读/未读菜单也不在
本轮 c309 产物中。这些截图是修复前缺项证据，不是候选源码通过后的图片。
本轮没有覆盖英文、全部设置分区、全部页面和关键状态、Windows 安装包或 Mobile。
原版全量差异仍未逐处验收，不能声称 100% 还原或生产就绪。
