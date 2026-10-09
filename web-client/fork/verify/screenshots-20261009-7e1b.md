# Web 已发布 7e1b 页面实拍复核

记录日期：2026-10-09，浏览器操作约 00:42–00:49 UTC。本记录只证明列出的实际页面状态，不是完整原版一致性、Windows/Mobile 验收或生产就绪声明。

## 版本、身份与操作边界

- 固定官方 Buzz：`779af8886caae1317b4de962082429867ab61503`；固定 buzz-web：`a6766c482533d028582d0efcfd3740769f86217c`。
- 实际 Web 源码：main `7e1b5db6189a48a654f807be3491c4614cf28051`。
- 实际 image：`sha256:67532de3101296b6366cc54cba36a11c9ac235924832cd1e3c2d2335acb193d8`。
- 浏览器登录后两次 GET `/app/platform-build-info.json` 均 HTTP 200，buildId 都是 `sha256:50c3622f7f2390fe474be35c215e1425d0fc1291e4f1860579bbc0f0b20f73d9`。
- 原 `/usr/local/bin/playwright-cli`，既有 `header-restoration` 会话，1920×1080，普通 `seam-verifier` 用户。页面入口 `http://192.168.0.193:58090/app/`。
- 健康后一次正常刷新发现会话过期，沿真实 OIDC 表单重新登录。复用官方 CLI 已有 `Session.run`，受控口令仅在 Node 内存读取并填入密码字段；无口令字面量进入 shell 参数、CLI 代码或输出，无明文副本、Cookie/session 注入或账号重置。既有会话无 `saveSession` 配置。
- 只通过真实页面导航和读取既有数据；未直接调用业务写 API，未发送消息、保存资料、创建项目/工作流、安装 Agent、执行 Agent turn、点赞或发帖。页面原有自动读标记不另造旁路。
- 为访问原已有页面，经 Experiments 实际 UI 临时启用四项。初始 Workflows/Projects/Pulse/Forum 均关闭；完成后经 UI 恢复全部关闭及简体中文，整页刷新再次读到 `lang=zh-CN`、四项 `aria-checked=false`。主题、密度、字号等未改。
- 本次未更改产品源码、重建产物或部署服务；不触碰其他队友模块及继承 dirty 文档。

## 实际命令与失败边界

所有 shell 命令经 `rtk proxy`，浏览器命令使用下列已安装入口：

```text
/usr/local/bin/playwright-cli -s=header-restoration reload
/usr/local/bin/playwright-cli -s=header-restoration eval 'async () => { const response = await fetch("/app/platform-build-info.json", {cache:"no-store"}); return {status:response.status, build:await response.json()}; }'
/usr/local/bin/playwright-cli -s=header-restoration click <实际 snapshot ref 或 getByTestId/getByRole>
/usr/local/bin/playwright-cli -s=header-restoration snapshot --filename=<实际 yaml 路径>
/usr/local/bin/playwright-cli -s=header-restoration screenshot --filename=<下表实际 png 路径>
/usr/local/bin/playwright-cli -s=header-restoration console
```

截图后逐张使用 `view_image` 打开原件，25 张均实际视觉复核；不是只看 DOM、snapshot 或 HTTP 状态。

- 滚动尚未健康时一次旧页面 fetch 真实失败：`TypeError: Failed to fetch`。没有重放业务动作或称通过。
- 健康后的刷新正常转到 IdP；当时错误地在 IdP 域读取相对 `/app/platform-build-info.json`，返回 HTTP 404 和 `Unable to find matching target resource method`。不是应用版本证据；正常登录后才以上述两次 200 核版本。
- 英文 Inbox 初次定位误用了不存在的 `sidebar-platform-inbox` test id，CLI 返回 `does not match any elements`。改用页面实际 `Inbox` 按钮后成功导航，重新截图覆盖本人同名临时误图；下表只列最终 Inbox 原件。
- 恢复 Forum 偏好时首次英文 locator 使用了错误大小写 `Forum channels`，目标等待未命中；实际 snapshot 是 `Forum Channels`。随后用真实 `feature-toggle-forum` 控件取消，刷新确认全部偏好已恢复。没有改产品或放宽等待条件。
- 最后一次当前页面 `console` 返回 `Total messages: 0 (Errors: 0, Warnings: 0)`。它不抹去前述滚动/定位失败，也不代表此前所有路由均无错误。

## 截图原件与逐状态结论

原件目录 `/volumes/kailo/.playwright-cli/`，以下每个文件名都带统一前缀 `kailo-ui-20261009-main7e1-`。共 25 张：11 对中英文状态及 3 个中文只读详情。不是 25 个独立页面，更不代表页面总覆盖率。

| 后缀（含扩展名） | SHA256 |
| --- | --- |
| dm-intro-placeholder-zh.png | 5b8ea14ccb3fb78ef86c74cda38f858f1626739128ddd438e9096798f75bed9f |
| dm-intro-placeholder-en.png | 2098b643825d900a492360b1cf63eaf011cc1a56bebbed988ac4c4c9f78d85c2 |
| settings-profile-zh.png | 7e8974d69d52798bc624f9f2ef5a4fb1a385e107b877c82335c148ba2f507177 |
| settings-profile-en.png | baa9a5ad69dcf5b8008af493da4841dd236e9dedd60567fbed776827587237cc |
| settings-appearance-zh.png | fa9ecec292f81fa95f1529ef2c9f464690a7235a1ce57b3deba3649a1bde1125 |
| settings-appearance-en.png | 89ec6d86e9588bba4706fdb499995b69a41be60aa6cd7817f6e97139c8f2ff5d |
| members-zh.png | e120309bfe4a6199126d4ef83dc75742e9102c0865ea536af2f0a931fa0c1e77 |
| members-en.png | 2b3a7e9b14311bb0b19ac2251cf7b193dddf8c362bff1818fce342b2bc49551b |
| member-profile-zh.png | c64a905e620dd2348f2f17729bd64c8bde3d904cdd4736237f4e2ced51d915d5 |
| channel-zh.png | 95ed9b6948370c159cce6c86c4174e76c3ffc62119ec24d031225c49249c7eff |
| channel-en.png | fb5098c9bb4c773ac8d315ab00486e89d57a203ac188e317a2cea2b3313c6e54 |
| inbox-zh.png | 8e95e959078cadbd7fbd400ed640ecc4dadc86d379b7a93cbb56a225ad6a317b |
| inbox-en.png | 4558cf56ca34f12cc1eabc82eecb74d58434d8708437f91dd48ed45481bac3f7 |
| projects-empty-zh.png | 8c998b5bffc24da138897e27316bc04bc6f048c0b4eee3925cd620c6ff69ca9d |
| projects-empty-en.png | 6d781ea7108655d1b4a14801a5baaef644b1df1bc0ef40d0174f1ce873c99cb2 |
| project-channels-zh.png | 1989115eee4350830171082da9fc3a7ce5b15398bb596811cdf181a61559f5b7 |
| project-channels-en.png | fcbd8a5e611e5b70af94ac0be44812217b7b7f7733428ee7f1868885cf6a8db2 |
| agents-zh.png | 6e4f09fef6812453695aae2ad3648684fa23c52b6e8ca07813e0c06900456d97 |
| agents-en.png | beca1ba65ba3dc462a088152e3051726918e13360da0266bf27fcc8873e7c00a |
| agent-definition-zh.png | 1063db26f2a5247b80dcd41df460abc8f0ae83b459fd2f135b928c7b483bf249 |
| workflows-zh.png | a71e4544a346830f0466e80c92ed9fab008de6604bd32263c8fd769ae5d73f8b |
| workflows-en.png | aa475b9ba2e87a62119a31d28aa70714799e5ee52dd563027f323bee8aba5ee3 |
| workflow-definition-zh.png | 30ad053f88bc8e199634ee3a39ee9d4ef500d8f0dafee5ba92ba1604dd78a184 |
| pulse-zh.png | b8d65fb29e519cb7cde615f17a897f900ed620f536e1ebe25df6f540a9e632c1 |
| pulse-en.png | ee8e52b5a1d62378d493c69cddd62397b74614ee1897aa2b2523159983b43187 |

### 已实际看到的修复与授权差异

- DM：原 `desktop/src/features/messages/ui/MessageTimeline.tsx` 的开场及 `desktop/src/features/channels/ui/ChannelPane.tsx` 的收件人 placeholder，迁到共享 `client-kit/ts/platform/src/react/messages/timeline/MessageTimelineSurface.tsx::MessageTimelineSurface`、`DirectMessageIntroAvatarStack.tsx::DirectMessageIntroAvatarStack` 及现存两个宿主真实消费者。实际同一 DM 两条历史消息、可信人物名称、头像、中英文开场和 `Message kailo-bootstrap-admin`/`给 kailo-bootstrap-admin 发消息` 均可见。未发送新消息或覆盖群聊/陌生人/历史分页所有边界。
- 成员与资料：实际两名当前 scope 人物，seam-verifier 原头像读出；本人资料侧栏宽度正常，未再出现旧 80px 裁切。无公开头像的人员保留原 initials fallback，不编造图片。平台角色、身份读数及管理导航仍是已授权治理接缝，不把其称原社区角色全量还原。
- Channel/Inbox：频道有真实历史多作者消息及线程摘要，频道 placeholder 是真实名称；Inbox 列表及已选 DM 详情非空且头像正常。没有通过新发消息证明多人/多 Agent 稳定协作，也没有在本轮逐项执行编辑/删除/反应/线程深链。
- Settings：Profile 原头像/卡片和 Appearance 原 segmented 控件、主题/偏好布局实际可见；System 中文已显示单行“系统”。中英文切换成功，不把资料空值“未设置”称保存成功。未重新上传头像、编辑资料或运行 Native 私钥备份。
- Agents：一个实际定义和四条安装记录可读，详情读出真实版本及指令；三条 ACTIVE、一条安装中如实显示。没有执行 Agent、证明运行时收敛或完整原 Agent profile/tabs/私聊。
- Workflows：两个真实卡片（停用草稿/启用已发布）和既有定义详情可读，未改开关或触发运行。详情仍是治理 JSON/表格，不是完整固定原版表单/YAML 编辑器与运行步骤轨迹；此项仍缺失，不能因卡片相似或详情有内容称完整恢复。
- Pulse：两个既有真实帖子/回复可见，原 tabs、composer 与操作图标有中英文；部分作者仍只有可信 npub/initials，不补造身份。未点赞、回复、发帖、跟随或开 Agent turn。
- Projects：项目与项目频道均是明确空态，布局/分类控件可见；没有项目、仓库或关联频道数据，不计其非空详情、创建/编辑/仓库功能验收。

## 完整差异与本批未验收范围

本次截图不是重新完成全树分类。现有可复核 classification TSV 仍以 apps `dfc7a33835174bbaa9e43e0e335c2f12959edfeb` 比较上述固定 Buzz：5195 上游路径、5314 union、3332 原始差异；1982 blob 原样、110 已证共享迁移、0 独立逐项授权、6 历史残缺记录、3216 未分类。历史残缺条目中部分消费者已在后续提交恢复，不能直接当成本版本剩余六项清单。不得把这些历史数字改称当前 7e1b 全量逐处复核。

```text
/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-dfc7a3383517.classification.tsv
SHA256 df5d9cc72776323de5f81c379390b55afe64b346ad8cde42fe9a0c152168b3fc
```

本轮没有覆盖其余五个已存在设置分区的全部关键状态、剩余九个原设置分区、频道创建/管理/撤权、完整消息操作、原图片图库、Agent Activity/profile/DM、Workflow 全创建编辑执行链、组件 iframe/上传下载/撤权、Cells→WeKnora 同步。没有验证三个独立人类加多个独立 Agent 的持续协作，也没有 Desktop 安装包或 Mobile 设备验证。当前 Web 局部实拍不消除全量门禁既有失败，不声明 100% 还原或一期生产就绪。
