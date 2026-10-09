# 4c099 Profile 局部实拍

2026-10-09 15:45–15:50 UTC，独立 `avatar-seam-restoration` 浏览器以本人 `seam-verifier` 正常 IdP 表单重新登录。既有受控口令由原 CLI Session 的 `raw` 填表消费，不输出值、无 Cookie 注入或账号重置。

- 实际 Web 源码：`4c099a5f9b508f7df47b9fc923fe37ab7375aa70`；镜像：`sha256:7ea0c5fa4cf0897ae1c762fa7b42bcc5b087b26950106bc0de2604be5137e07f`。
- 浏览器与刷新后均实际读回 `/app/platform-build-info.json`：`sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`。
- 固定原版对照：Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard / handleProfileMetadataEdit / handleAvatarEditorDone`、`desktop/src/features/profile/ui/ProfileAvatarEditor.tsx`。本次只覆盖以下真实状态，不证明整模块原样、所有页面、Windows 或 Mobile。

## 操作与边界

`playwright-cli -s=avatar-seam-restoration goto …/app/` → 正常登录 → 个人菜单 → Settings；通过真实按钮打开图片头像选择器、Done 关闭，未选图、未粘贴 URL、未上传或保存。随后打开资料编辑，空值 Done 关闭；在原 Appearance 语言选择器切英文，填三空格后 Done；仅填本地未保存的 `Unsaved profile preview`，最后恢复原空值、Done、刷新并恢复中文。

最终真实读取文本为“个人资料信息编辑显示名称未设置简介未设置”，头像 alt 为“seam-verifier的头像”。CLI requests 原件只显示本轮 `GET /api/v1/profile`，无 `PUT /api/v1/profile` 或头像媒体 POST；不以最初匹配错误 URL 的内存 listener 计数作证。CLI console 实际 0 errors / 0 warnings。资料、头像及语言已恢复，不执行私钥导出或 wipe。

保留三个失败/过渡边界：语言切换后旧 ref `e349` 不存在；因此 04/05 实际是 Appearance，而非文件名声称的 Profile。随后隐藏 Profile 编辑按钮的正常点击 30 秒超时，没有 force click 或改 pointer。09 是切分区后尚保留的本地草稿帧；现有设置保留挂载，不能以瞬时文本检查声称导航取消编辑成功。10 的真实刷新才证明原资料状态恢复。

## 原件索引

原件目录：`/volumes/data/kailo/tmp/profile4c-20261009.Gke8nW`。以下十张均已通过 `view_image` 实际打开，01/02/03/06/07/08/10 为七个目标状态，04/05 为错页、09 为过渡；不得合称十项 Profile 验收。

| 文件 | 实际状态 | SHA256 |
| --- | --- | --- |
| `01-profile-zh.png` | 中文资料、原头像 | `7e8974d69d52798bc624f9f2ef5a4fb1a385e107b877c82335c148ba2f507177` |
| `02-avatar-picker-zh-no-write.png` | 原图片选择器，不选图 | `02c521f442ba0f9cded2ac9a7668c419ede4e8feede488b450059eb18110975e` |
| `03-edit-empty-name-zh.png` | 中文空姓名/简介编辑 | `ad16d9c75d28301241d3e1a94984cac4fd119a21bfab7cd8e2a8f1cf458d221a` |
| `04-profile-en.png` | 错页：英文 Appearance | `9f6b203ba973c7573137dcf28de6e2f630684ecd12ed8e480994242f431e9492` |
| `05-edit-blank-name-en.png` | 错页：同一 Appearance | `9f6b203ba973c7573137dcf28de6e2f630684ecd12ed8e480994242f431e9492` |
| `06-edit-blank-name-en-actual.png` | 英文三空格姓名 | `a9575b19bf83e137a945bbbc36a7855e97b6930df500b8a3e71be1efd2a390a8` |
| `07-profile-en-actual.png` | 空格 Done 后英文只读 | `d25ea098480180c9e9820bb81e884c1c89c7efa7c7f08f683961b696f2a8b906` |
| `08-unsaved-preview-en.png` | 本地未保存姓名草稿 | `4df500da90a901c6fcffbc8db0a73dd64d85007ba9a4cec2b469ee5714c9b521` |
| `09-profile-restored-zh.png` | 过渡：仍有未保存草稿 | `e40e40659de807aabc99e276d35e1a73efd4a9b9d7b84fd4873fe02e634cbd84` |
| `10-profile-reloaded-zh.png` | 刷新确认原资料/中文恢复 | `d36a8b07d93e3f4feb3d7d4021fbdc139f9d7760eff6e45302d676cdcb472304` |

请求/控制台原件为同目录 `requests.txt`、`console.txt`。未验：非空既有姓名清空提示、真实上传/保存/跨用户读回在本轮没有执行；不能以以前 9edf 业务操作替代本版这些状态。原 SignOut 本机 wipe、Web 私钥边界、剩余设置模块仍保留各自缺项。新邀请 Dialog/成员 Card 候选不在本镜像，本次截图不验该候选。
