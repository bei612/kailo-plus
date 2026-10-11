# 原作者资料公钥复制：Web 宿主接缝回执

## 原版全量对照与四步结论

- 固定 Buzz：`779af8886caae1317b4de962082429867ab61503`。完整原路径 `desktop/src/features/profile/ui/UserProfilePanelFields.tsx::ProfileFieldRow` 调用 `desktop/src/shared/ui/HoverCopyIndicator.tsx::useCopyFeedback`，后者调用原宿主 `desktop/src/shared/lib/clipboard.ts::writeTextToClipboard`，成功后才切换复制标记，失败报告原错误。已用只读 `git show`/`git grep` 核验，不运行证据源码。
- 本项来自既有完整差异台账的 profile 模块队列，而非只看本次 git diff：`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-dd399f93f584.classification.tsv`，历史比较基底 `dd399f93f584b30d4a6301a5024c3959d4d420e6`。该历史队列不证明当前所有行均是缺失。本批只证明“原公开资料字段复制”的现有共享实现和 Web 宿主接缝，不能据此关闭整个 profile 模块。
- 定位权威：用户要求原交互完整保留，Web/Desktop 共源、宿主差异留在适配层。共享 `ProfileFields.tsx::ProfileFieldRow` 与 `HoverCopyIndicator.tsx::useCopyFeedback` 属于共享迁移；本次 Web `MessageAuthorProfile` 接入既有 HTTP 宿主剪贴板方法属于已授权宿主适配。没有新布局、文案或菜单。
- 影响面：事件级 BFF 作者资料读 → 原 ProfileSummaryView → 公钥/NIP-05 公开字段 → 原复制反馈 → Web `writeTextToClipboard`。检索全部 MessageAuthorProfile 调用，未改事件级授权键、响应 pubkey 匹配、scope 切换缓存、私聊导航、媒体读取或共享组件。
- 副作用：只复制当前已授权显示的字段；不新增读取、不复制正文到 Core、不放宽准入。浏览器现代 API 存在但拒绝时仍明确失败，不能转用旧方法冒充成功。
- 边界：API 不存在时复用已提交 Profile 设置的 HTTP 实现；execCommand 返回 false 报失败；现代 API reject 不 fallback；完整 canonical npub 而非界面截断值；临时 textarea 清理。无数据库、契约、迁移、后台执行、重试或新终态，`06-工程基线规范.md` §4 的既有治理错误语义不变。

## 现网实际操作与截图

普通独立 OIDC 登录使用受控 bootstrap 账号文件，未共享会话、未打印密码/token。原入口 → 频道“频道恢复验收 20261006” → 实际消息作者头像 → 原资料面板“复制公钥”。首个脚本误等另一控件的“复制失败”，出现 `locator.waitFor: Timeout 30000ms exceeded`；未改产品文案，按原词条“未能复制到剪贴板”纠正观察条件后实际 waitFor 成立。

- 已保存并打开：`/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV/24-author-public-key-copy-failed.png`。成图时 toast 已消失；图片只证明实际资料面板、公钥入口及原布局，不声称图内可见错误。失败证据为实际点击后的原错误文案等待成立和宿主事实。
- 同一浏览器读回：`secure=false`，`clipboard="undefined"`；`/app/platform-build-info.json` 的 buildId 为 `sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`，仍为之前发布的 `032b9c304c84336a52c699244992c9bc73ff55da`，不是本候选。
- 会话 `kailo-author-copy` 已关闭。未发消息、改账号、发起新查询或部署新页面。

## 实现及事后正反验证

生产差异只有 `web-client/web/src/platform/ui/MessageAuthorProfile.tsx`：删除 direct navigator 包装，原 copy prop 改接已存在的 `@/shared/lib/clipboard::writeTextToClipboard`。未修改 helper、共享样式、文案或其他复制消费者。

已有 `MessageAuthorProfile.test.tsx` 加一项，实际渲染原 ProfileSummaryView 公钥按钮，核对完整 npub、原成功反馈、textarea 清理、明确拒绝反馈、现代 API 拒绝后无 fallback；所有作者匹配、权限/scope、原资料布局等既有断言保留。

输入 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/apps`，原 SDK `kailo-web-thread-tooltip-sdk`（4 CPU/8 GiB、网络 none、1000:1000），Data 原依赖。开始前只有 sleep，load 4.86、MemAvailable 36427752 KiB；未新建 SDK、安装依赖或开全局构建。两源码复制后 cmp exit 0。

实际命令（容器内 `/candidate/apps/web-client/web`）：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/platform/ui/MessageAuthorProfile.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
# 反证及还原沿同命令，加 -t "copies the admitted author"
```

日志目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`：

| 轮次 | 结果 | 日志 |
|---|---|---|
| 正向 | tsc exit 0；原作者资料 26/26 通过，exit 0，3.38s | `author-copy-positive.log` |
| 私有反证 | 只把 copy prop 接回旧 navigator 调用；实际复制值为空而不是完整 npub，1 failed/25 skipped，exit 1，1.88s | `author-copy-negative.log` |
| 还原 | 私有生产源码与正式字节 cmp 0；1 passed/25 skipped，exit 0，1.85s | `author-copy-restored.log` |

原套件 React act 警告保留，未调高超时、删安全断言或把 skipped 计为通过。类型检查限于原私有 Web 输入，不冒称全仓类型绿。没有新增依赖/配置/契约，主线程继续精确候选复核与提交。

## 尚未验收

未部署候选，因此没有修复后浏览器剪贴板实拍；旧版错误图不是修复成功证据。未跑全量检查、Desktop 安装包或 Mobile 检查，不宣称 profile 完整还原或生产就绪。
