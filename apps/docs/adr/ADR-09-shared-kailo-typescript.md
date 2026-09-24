# ADR-09：Web 与 Desktop 共用的 Kailo TypeScript 只有一份

- 状态：已接受
- 日期：2026-09-24
- 决策者：Kailo 实施工程负责人

## 背景

`01` §5 原写「Desktop 与 Web 共用同一 TypeScript 主体」，`.design/04` §163、`.design/07` §108 与
`.design/18` §166 以同一前提推出「Component Host、`OfficeDocumentSurface` 在 Web 与 Desktop 上是同一实现、
适用同一改造面」，引用的源码事实是 `SF-MOB-02`：「Desktop 与 Web 同属一个 pnpm workspace」。

按固定基线核对源码，这个前提对 Kailo 选定的两个上游并不成立：

- `SF-MOB-02` 取证的 pnpm workspace 是 block/buzz 仓库根的 `pnpm-workspace.yaml`
  （`packages: ["desktop", "web", "admin-web"]`）。其中的 `web/` 正是 `SF-WEB-09` 所说「不是协作客户端」
  的那个目录（只有 `repos`、`invite`），`DD-74` 已明确它不作 Web 端基线。
- Kailo 的 Web 端上游是 hardy4yooz/buzz-web@`a6766c48`（`upstream-patches/buzz-web/baseline.yaml`）：
  独立仓库，`web/package.json` 的 `name` 为 `buzz-web`，依赖锁是 npm 的 `web/package-lock.json`，
  UI 主体在 `web/src/features/chat`、`web/src/shared/ui`。
- Kailo 的 Desktop 端上游是 block/buzz@`779af888` 的 `desktop/`（`upstream-patches/buzz-desktop/baseline.yaml`）：
  pnpm workspace 成员，UI 主体在 `desktop/src/features`、`desktop/src/shared/ui`，自带组件库与 e2e bridge。

两者都是 React 19 + TanStack + Tailwind v4 + shadcn 语义色，但是两棵独立演进的代码树：没有共同的源文件，
也没有共同的依赖锁。因此「共用 TypeScript 主体」只能以 Kailo 自己的代码实现，不能指望上游。

同时，Kailo 在两端要写的 TypeScript 是同一件事：BFF 管理平面客户端、平台页（成员、本人审计、本人设备）、
错误体与「结果不明」的解读、文案。在此之前它只存在于 Web 补丁 0001–0003 的 `web/src/platform/` 里；
Desktop 接入 Kailo 时若照抄一份，两端对同一个 `UNKNOWN`、同一个 reason code 的处理就会各自漂移。

## 决定

**Kailo 自有的 TypeScript 只有一份：`apps/web/packages/platform`（`@kailo/platform`）。**

- 内容：传输接缝（`transport.ts`）、BFF 客户端（`client.ts`）、平台页与最小外观（`react/`）、原生端登录
  引导（`react/NativeBootstrap.tsx`）、文案（`i18n.ts`）。页面只依赖 React 与 contracts 的生成类型，
  不依赖任一上游的组件库；外观只用两端 Tailwind 主题都有的语义类名。包内有 typecheck 与单元测试。
- 两端只在「一次请求怎么送到 BFF」上不同，这是两个真实实现，所以抽一个最小接口 `BffTransport`：
  - Web：`web-fetch.ts`，同源 fetch，会话由网关 cookie 承载，`401`/`opaqueredirect` 即会话结束；
  - Desktop：`native.ts`，经 Tauri 命令 `kailo_api` 进入 Rust 侧，令牌只在 Rust 侧；
    `KAILO_NOT_SIGNED_IN` 即会话结束。原生命令名与参数也只在这里写一次。
  两个实现都放在包内：它们共用同一套错误解读与测试，放进各自上游树只会多出一份需要对齐的代码。
- 两棵上游树都经 manifest 的 `vendor_files` 在构建时放入这个包（与 contracts 生成物同一机制，
  `06` §2）：Web 放到 `web/src/kailo-platform/`，Desktop 放到 `desktop/src/kailo-platform/`；
  各自以 `@kailo/platform/*`、`@kailo/contracts` 引用，上游树的 `.gitignore` 忽略这些目标，补丁只引用、
  不携带副本。放置只有一个实现（`tools/upstream_manifest.py vendor`），开发中的上游工作树用
  `vendor --refresh`。
- 文案 key 只定义在包里；Web 的 i18n 表把 `platformMessages` 并入自身，不在两处各写一份（`AGENTS.md`
  第 12 条的同源要求）。
- 上游 UI 主体各自保留：频道、消息、侧栏等仍是各自上游的代码，Kailo 以补丁改造。

`01` §5 据此改为：两端共用的是 Kailo 自有的 TypeScript 主体与 Component Host 契约；上游 UI 主体各自保留。

## 对 `.design` 措辞的解释

`.design` 不在本 ADR 中修改。`apps` 层把 `.design/04` §163、`.design/07` §108、`.design/18` §166 中的
「共用同一 TypeScript 主体 / 同一实现」解释为：**Kailo 为两端新增的 TypeScript（平台页、BFF 客户端、
将来的 Component Host 宿主与 `OfficeDocumentSurface`）只写一份，经 `vendor_files` 进入两端**；对各自上游
已有 UI 的改造（例如 Component Host 需要的 WorkspaceShell 提炼、route 与导航接入）按两棵树分别做成补丁。
由此，`SS-WEB-COMPONENT-HOST` 只证明了 buzz-web 一侧的改造面；Desktop 一侧在 Component Host 进入实施时须在
block/buzz `desktop/` 上另行取证，不能以「共用主体」为由沿用 Web 的证据。这一差异应在下一次 `.design` 修订
时回写到 `SF-MOB-02` 的适用范围。

## 放弃的做法

**两端各写一份 Kailo 代码**：最省眼前的事，但同一个错误分类、同一个「结果不明不渲染成成功或失败」的规则
要在两处维护，任何一处漏改都是跨端不一致；contracts 生成类型的引用也会分散成两份。

**把 buzz-web 整体并入 desktop（或反之），让两端真的共用 UI 主体**：两个上游各自演进，合并即意味着 Kailo
长期维护一个同时偏离两个上游的分叉，每次上游升级都要人工三方合并，违背 `04-上游适配与升级.md` 的「以补丁
在新 commit 上重放」。Desktop 还带着 Tauri 专有的窗口、菜单、keyring 与 e2e bridge，Web 带着 BFF 传输
与 Service Worker，两者的外壳本就不同。

**以 npm 包发布 `@kailo/platform`，两端经依赖锁引入**：需要一个包 registry 与发布流程，且上游树的依赖锁
（npm 与 pnpm 各一份）都要改；`vendor_files` 已经是本仓库既有、可复核（进 `patch_series_digest`）的机制，
不必再引入第二条供应链。

## 后果

正面：同一个页面、同一段错误解读在两端逐字相同，单元测试只写一次；改动经 `patch_series_digest` 暴露——
包改了而两端没重建，`check.sh seam` 失败。

负面：包的外观只能用两端都有的 Tailwind 语义类名，不能用任一端的组件库；包内文件每增加一个，两端的
`vendor_files` 都要登记（漏登记即宿主 typecheck 失败，不会静默）。

## 重新评估条件

- 任一端上游换掉 React、Tailwind 或 shadcn 语义色体系，使「只依赖 React 与语义类名」不再成立；
- 两端上游在某个固定基线上真正合并为同一代码库（届时直接共用上游主体，本包随之并入）；
- Kailo 自有 TypeScript 增长到需要独立版本与多消费方（例如 Component SDK 需要对外发布），
  `vendor_files` 不再是合适的分发方式。
