# 原头像轮廓模块：Web 根挂载回执

## 全量对照与四步结论

- 固定 Buzz `779af8886caae1317b4de962082429867ab61503`：`desktop/src/main.tsx::renderApp` 在根挂载 `desktop/src/shared/ui/AvatarClipPaths.tsx::AvatarClipPaths`。既有全量差异台账 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-dd399f93f584.classification.tsv` 同名路径为 M，历史基底 `dd399f93f584b30d4a6301a5024c3959d4d420e6`；本次核查当前实际消费者，不把历史队列直接当作缺陷结论。
- 定位权威：用户要求原样保留布局样式、Web/Desktop 共用原完整页面。共享 `client-kit/ts/platform/src/react/messages/thread/AvatarClipPaths.tsx` 对官方完整文件仅多来源注释；Desktop 已有薄导出与根挂载，Web 缺根挂载。本批是“共享迁移／缺失接线恢复”，不修改原归一化曲线或发明新形状。
- 影响面：既有包 export `./react/thread/AvatarClipPaths` → Web main 根一次挂载 → 原 `styles/utilities.css::rounded-squircle` 的 URL 引用 → 已有 `messages/UserAvatar.tsx::UserAvatar`、`agent-library/IdentityInitialsAvatar.tsx::IdentityInitialsAvatar` 等消费者。只加 import 和挂载两行；不修改共享组件、样式、包依赖、任何 Agent 元数据或身份解析。
- 副作用：SVG 原本 aria-hidden、零尺寸、不参与指针事件，仅提供 objectBoundingBox 裁剪定义；不增加可见控件、网络读取、权限分支、持久状态或 Core 内容。既有圆形人类头像不消费该样式，因此不被改为方圆形。
- 边界：根唯一 ID、不同尺寸同一归一化路径、无图片 fallback、React StrictMode 都沿原模块。卸载随 React 树移除；不存在需对账的新状态。治理超时、撤权和结果不明仍沿原链与 `06-工程基线规范.md` §4，头像外观不证明 Agent 动作成功。没有契约或数据库迁移。

## 实际旧版截图与 DOM

正常独立 OIDC 登录，只做导航、DOM 读取及截图，没有创建 Agent、改资料或发消息。线上仍为 `032b9c304c84336a52c699244992c9bc73ff55da`，buildId `sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`，reportedAt `2026-10-11T07:47:07.431Z`。

- 初始频道截图 `/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV/26-agent-avatar-clip-absent.png` 已打开：clipCount=0、squircleCount=0；该页当时没有相关头像，不能据此宣称可见轮廓缺陷。
- 导航现有 Agent 列表后截图 `/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV/27-agent-library-clip-absent.png` 已打开：实际 KC 初始字母头像显示为直角方块。DOM 为 clipCount=0、squircleCount=1；该元素计算样式 `clipPath=url("#rounded-squircle-clip")`，引用目标不存在。
- 原会话 `kailo-avatar-clip` 已关闭。没有注入裁剪定义伪造修复后图片；以上均为真实旧版缺陷证据。

## 实现后的窄验证及反证

正式源码改完后扩展已有 `web-client/web/src/main.test.tsx`：在真实 main 根内渲染实际共享 UserAvatar，保留此前 Tooltip、EmojiBurst 全部断言；确认真实 squircle consumer、唯一 clipPath、原坐标系统与原 path 内容。此 DOM 检查不冒充浏览器像素裁剪验收。

复用原 `kailo-web-thread-tooltip-sdk`，4 CPU/8 GiB、network none、1000:1000；开始前容器仅 sleep，load 18.18、MemAvailable 35879596 KiB。私有输入 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/apps`；正式两源码与快照 cmp exit 0。未新建 SDK、安装依赖、执行镜像构建或全局检查。

容器内 `/candidate/apps/web-client/web` 实际命令：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/main.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

同一 Data 目录日志：

| 轮次 | 结果 | 日志 |
|---|---|---|
| 正向 | tsc exit 0；1 passed，exit 0，1.46s | `avatar-clip-positive.log` |
| 私有反证 | 仅删除私有 main 的 `<AvatarClipPaths />`；唯一 clipPath 断言实际 0 而非 1，1 failed，exit 1，1.39s | `avatar-clip-negative.log` |
| 还原 | 恢复挂载后与正式 main cmp 0；1 passed，exit 0，1.55s | `avatar-clip-restored.log` |

未改超时、未删原断言、未在正式目录执行破坏。本批基于已提交 EmojiBurst `55e290d5b7aa3ece9d183f111b244f2a0f808c3c`，不会覆盖其根挂载。

## 尚未验收

未部署候选、没有新版头像实际截图；未运行 Desktop 安装包、Mobile 或全量检查。源码接线和消费者检查通过，不等于完整视觉一致或生产就绪。
