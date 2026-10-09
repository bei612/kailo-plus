# 5ba 普通频道读状态实拍

2026-10-09 04:04–04:14 UTC，普通 `seam-verifier` 用户，原
`header-restoration` 正常 SSO 会话，1920×1080。固定原版为 Buzz
`779af8886caae1317b4de962082429867ab61503`。

## 实际版本与操作

- 正常 reload 后 GET `/app/platform-build-info.json` HTTP 200，buildId 为
  `sha256:9985c612c146a9cd611f13457ce699a740354023646d45e26ffb4c107fdfeaaa`，
  对应已发布源码 `5baad5e09a6c8abeb33bbfa1904fe0ee77034b78`、镜像
  `sha256:04dc4615b6e39c377339c01120a9311b0c10b3ead6c6a0ec75101335acc16f4c`。
- 本人已加入的频道恢复验收频道只有本人既有图片消息：正常菜单标为未读后侧栏
  显示未读；本人作者排除仍生效。离开并重新进入后原会话覆盖清除。不能单据此
  证明其他作者消息的读状态。
- 导航到未加入的 Web 验收频道，实际呈现无成员准入的拒绝状态；没有加入或绕过。
- 随后在本人可访问的 Kailo 频道找到既有其他作者消息，对
  `collab-third-20261005` 的事件
  `1423eae8fb88a0359a6eb85389543242a9c6f4bab82012ade1e879d49b76edf1`
  正常打开原行菜单：初始“标为未读”→点击后侧栏未读且菜单“标为已读”→点击后
  侧栏清除且菜单恢复“标为未读”。末次真实 PUT `/api/v1/user-state/read`
  HTTP 200，回执 `{"version":36}`。未读覆盖没有被自动读立即抹掉。
- 一次 ACK 观测代码使用了 CLI 运行上下文不存在的 `URL` 构造，报
  `ReferenceError: page.waitForResponse: URL is not defined`；该次正常点击已完成。
  这是辅助观测失败，不作为 HTTP 成功或失败证据。随后使用 URL 字符串筛选，
  经同一真实菜单完整循环取得上述 HTTP 200 回执，没有直接调用写 API。
- 最后状态已恢复为已读、行菜单关闭。语言、主题和实验开关未改变；没有新增
  消息、账号、频道、成员、资料或权限，没有启动工作流或 Agent turn。

## 已逐张打开的原件

原件目录 `/volumes/kailo/.playwright-cli/`，共同前缀
`kailo-ui-20261009-main5ba-`。8 张均实际截图并调用本地图片查看器打开。

| 图片后缀 | 实际覆盖 |
| --- | --- |
| `message-read-menu.png` | 本人既有消息原读状态菜单 |
| `message-own-unread-preserved.png` | 本人标未读后原侧栏会话覆盖 |
| `nonmember-read-refusal.png` | 未加入频道真实拒绝，不绕准入 |
| `message-unread-leave-clear.png` | 离开后重新进入清除原会话覆盖 |
| `peer-read-menu.png` | 其他作者既有消息初始原菜单 |
| `peer-forced-unread.png` | 手工未读保持，菜单转为标已读 |
| `peer-restored-read.png` | 菜单回到标未读、侧栏覆盖已清 |
| `peer-read-ack.png` | 真实 HTTP 200/version 36 后同一可操作状态 |

```text
e4ba1f7d173333ee3ad8689ed9e9ca24b8d9cd172ff2485c65260de3c58e23e2  message-read-menu.png
6b05cd926c617ad7f1f48cd49180357954a1d6438c2f564ce586eb202b0b7beb  message-own-unread-preserved.png
3fefcc2317a2ae19ae95c2aa0b0843d8985207e8a76cfcc4bc4e43fe37b620b4  nonmember-read-refusal.png
c0c262e83d261e81ae1a6a5b52862ee4a79bea6b934d8743f94dd99120232d06  message-unread-leave-clear.png
d7c985c0d2d4d4848fc4ab91dafe46f100803ed2f68ff92c6d018b07c97ca62b  peer-read-menu.png
67d87892ffb5dc0a189c0dfd11f87dd4c055a3d5bb68ee65dc005b7fc58da89e  peer-forced-unread.png
3e13be228f3fc95a2635625ae50a6babe193833c4c580f4f828a21efb26a74e2  peer-restored-read.png
78a2f8909452ead469bf7b3a1f2de93dd3a115b512b77957fbbb7c307efff33b  peer-read-ack.png
```

使用原 `playwright-cli -s=header-restoration` 的 `reload`、`hover`、`click`、
`screenshot --filename=…`、`press Escape`；`run-code` 只用真实元素定位、普通
点击及响应观测。没有 force、DOM pointer 重置、Cookie/session 注入或虚构响应。

## 未验收范围

本轮仅 Web 普通频道这些真实状态。DM 读/未读传输、未加载线程子树、同秒并发、
撤权在途、Windows 安装包和 Mobile 没有在本轮实际验收。当前候选 Appearance
原行/Eye/文案和 Inbox 类型共源迁移不在该已部署镜像中，不能拿本批图片证明新
源码已发布或视觉通过。全量官方差异仍未逐处功能验收，不能称 100% 还原。
