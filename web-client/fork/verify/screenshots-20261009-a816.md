# 2026-10-09 06:23 UTC a816 私聊上下文与作者资料栏实拍

## 版本与范围

- 实际部署源码：`a816ea569acdce060a681c32467e4ebb4235b197`。
- 镜像：`sha256:312afc7902bc754b91307f018b0ce4f7620efbeb42e40d9232a5252e6e270270`。
- 普通 SSO 浏览器读取 `/app/platform-build-info.json` 为 HTTP 200，
  `buildId=sha256:88591b4df1fb5a044e821caa4473f223ca2e841ee93513f6d6434dbfd9f7b379`。
- 固定原版：Buzz `779af8886caae1317b4de962082429867ab61503`，
  `desktop/src/features/home/ui/InboxDetailPane.tsx::InboxDetailPane` 与
  `desktop/src/features/channels/ui/RightAuxiliaryPane.tsx::RightAuxiliaryPane`。
  原私聊不默认设置线程父目标；原分栏资料面板高于 Inbox 的背景层。
- 仅覆盖同一真实私聊的默认详情和作者资料栏显示／关闭／重新打开，
  不称全量 Inbox、完整 Profile、Agent、Windows 或 Mobile 验收。
  后续 Composer audience 源码尚未写入此发布版本。

## 实际操作与失败边界

使用现有 `/usr/local/bin/playwright-cli`、`header-restoration` 普通
`seam-verifier` 会话，1920×1080。旧会话读取 build-info 返回登录 HTML，
JSON 解析失败；保留失败，不当成 HTTP JSON 成功。
随后正常 `goto /app/`、填写用户名、从既有受控本地输入在内存中填写密码、
点击正常 IdP 登录按钮。没有 Cookie／session 注入、口令重置或值输出。

实际运行的非敏感命令包括：

```text
playwright-cli -s=header-restoration goto http://192.168.0.193:58090/app/
playwright-cli -s=header-restoration fill e17 seam-verifier
playwright-cli -s=header-restoration click e30
playwright-cli -s=header-restoration run-code <正常请求并读取 platform-build-info>
playwright-cli -s=header-restoration click e32
playwright-cli -s=header-restoration snapshot --filename=.playwright-cli/main-a816-inbox.yml
playwright-cli -s=header-restoration screenshot --filename=<下列原件>
playwright-cli -s=header-restoration click e340
playwright-cli -s=header-restoration run-code <正常关闭作者面板再点击原作者按钮打开>
playwright-cli -s=header-restoration console error
```

正常关闭／重开调用的实际结果：`panelTitle=true`、`closeVisible=true`、
`threadPrompt=0`。控制台 `Errors: 0, Warnings: 0`。
未发送消息、修改头像／权限、调用收费 Agent 或保存工作流。

## 原件与视觉复核

三个 PNG 已分别用 `view_image` 打开，而非只检查 DOM：

| 原件绝对路径 | SHA256 | 实际视觉结果 |
| --- | --- | --- |
| `/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina816-dm-context-after.png` | `4a48f0dc6c880d02ab3714228303ae46c84c039d91d81d33ea1c29c0710aee87` | 标题为“与 kailo-bootstrap-admin 的私聊”，占位为“给 kailo-bootstrap-admin 发消息”，不是“在线程中回复”。 |
| `/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina816-author-stacking-after.png` | `fa596c8afdfa2e31679d7c1433fb5335f2b3ed4e8548c2da3d3d9906bcea1946` | 分栏“个人资料”标题和 X 正常显示、不再被 Inbox 背景层模糊遮挡。 |
| `/volumes/kailo/.playwright-cli/kailo-ui-20261009-maina816-author-reopened.png` | `fa596c8afdfa2e31679d7c1433fb5335f2b3ed4e8548c2da3d3d9906bcea1946` | 正常关闭后重新打开相同作者，显示相同真实状态；与上一原件相同哈希，不计为第三种独立状态。 |

先前 5ba 的 `dm-context-before` 与 `author-stacking-before` 原件仍是旧版失败证据，
不替代此版本实拍。当前资料正文显示公钥 fallback，不能据标题与层叠修复
宣称完整资料字段／原 Profile 分区已恢复。英文同状态、全部路由关键态、
Windows 安装包和 Mobile 均未在这轮验收。
