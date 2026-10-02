# ADR-18：client-kit 的 TypeScript 包以副本安装，运行时依赖是 peer、由使用方解析

- 状态：已接受；细化 [ADR-09](ADR-09-shared-client-typescript.md) 与 [ADR-16](ADR-16-functional-project-layout.md) 中“两端以 `file:`/`link:` 本地路径依赖引用 `client-kit/ts`”的安装方式
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

`web-client/web`（npm）与 `collaboration/desktop`（pnpm）以本地路径依赖引用 `client-kit/ts` 的 `@client-kit/platform`
与 `@client-kit/contracts`。`@client-kit/platform` 的源码 `import "react"`。两个包管理器的默认做法都是**符号链接**
（npm `file:` 目录依赖默认 `install-links=false`；pnpm `link:`），打包器、`tsc` 与 node 都按**真实路径**解析被链接包里的
裸说明符：从 `apps/client-kit/ts/platform/src/` 向上找 `node_modules`，找到的是 client-kit 自己为单元测试安装的 react
（或 `apps/node_modules` 里的那份），不是使用方的。结果是使用方打包出第二份 React，hooks 与 context 跨副本失效。

此前用三层配置绕过去，每层都只遮住一个解析器：

| 使用方 | 绕行 |
| --- | --- |
| web-client | `tsconfig.json` 的 `preserveSymlinks`；`vite.config.ts` 的 `resolve.preserveSymlinks` 与 `resolve.dedupe: ["react", "react-dom"]` |
| desktop | `tsconfig.json` 的 `paths` 把 `react`、`react/*`、`@client-kit/contracts` 指回本项目；`vite.config.ts` 的 `resolve.dedupe: ["react", "react-dom", "@client-kit/contracts"]`；`test-loader-hooks.mjs` 把来自 client-kit 真实路径的裸说明符改从本项目解析 |

这些配置改的是上游文件，扩大了 `upstream_manifest.py sync` 的冲突面；新增一个解析器（例如新的测试运行器）就要再加一层。

## 实验（2026-09-29，本机 node 24.15.0、npm 11.12.1、pnpm 11.4.0）

在临时目录建一个 `lib`（`peerDependencies: react`，`devDependencies: react`，本地已安装 react 模拟 client-kit 自测），
一个依赖 react 与 `lib` 的使用方，用 node 比较使用方与 `lib` 拿到的 `React` 是否同一对象：

| 使用方安装方式 | `lib` 被解析到 | 同一份 React |
| --- | --- | --- |
| npm `file:`（默认，符号链接） | `kit/lib/src`（真实路径） | 否 |
| npm `file:`，node `--preserve-symlinks` | `node_modules/@ck/lib/src`，但链接目录里仍有 `lib/node_modules/react` | 否 |
| npm `file:` + `install-links=true` | `node_modules/@ck/lib`（副本，不含 `node_modules`） | 是 |
| pnpm `link:` | `kit/lib/src`（真实路径） | 否 |
| pnpm `file:` | `node_modules/.pnpm/@ck+lib@file+..+kit+lib_react@19.3.0/…`（副本，peer 以 react 版本入名） | 是 |
| pnpm workspace 成员（`workspace:*`） | `lib/src`（符号链接） | 仅当两边恰好解析到同一 store 版本时是 |

补充核对：

- npm：按 `install-links=true` 生成的锁文件，在没有该配置时 `npm ci` 不安装该依赖、构建失败，因此配置必须入库并在
  `npm ci` 之前可见。副本是打包语义，源码改动后 `npm install` 不刷新，`npm ci` 刷新。
- pnpm：`file:` 目录依赖以硬链接放入虚拟存储，原地修改的文件即时可见，新增文件在 `pnpm install`（含 `--force`）后
  仍不出现；`pnpm --filter buzz update @client-kit/platform @client-kit/contracts` 或清空后重装会刷新，且不改锁文件与
  `package.json`。
- 在真实工作树上的破坏核验：把 desktop 改回 `link:`、web-client 去掉 `install-links` 而不加任何绕行，两者的
  `vite build --sourcemap` 产物里都出现第二份 react（`react@19.3.0`，来自 `apps/node_modules`）；`tsc` 与现有测试
  均未报错，也就是只有 bundle 检查能发现这类回归。
- 实施后两端 `vite build --sourcemap` 的 source map 里只有一个 react 包根（desktop `react@19.2.8`，web-client
  `web/node_modules/react`）；两端 `globals.css` 的 Tailwind `@source "…/node_modules/@client-kit/platform/src"` 照常
  扫描副本（只在 client-kit 里出现的 `grid-cols-[max-content_1fr]` 进入两端 CSS）。按记录的构建方式在空白目录复现
  （client-kit 不带 `node_modules`）：web-client `npm ci`、collaboration `pnpm install --frozen-lockfile` 均成功，副本只含
  `package.json` 与 `src/`。

## 决定

**client-kit 的 TypeScript 包不给使用方带运行时依赖：react、Shiki、`@types/react` 与 `@client-kit/contracts` 都是
`peerDependencies`；两个使用方按包管理器的副本语义安装它们，peer 在使用方的依赖树里解析。不加任何解析改写。**

- `@client-kit/platform`：`peerDependencies` 为 `react ^19.1.0`、`@types/react ^19.1.8`（`peerDependenciesMeta`
  可选，只供类型检查）、`@client-kit/contracts 0.0.0` 与 `shiki ^4.0.2`；react、react-dom、jsdom、vitest 等只在 `devDependencies`，
  供 `apps` 根 pnpm workspace 里的包内单元测试使用。两个包都以 `files: ["src"]` 声明发布内容，副本只含源码。
  共享主题与正文高亮使用两端已有的 Shiki；它同时在包内自测的 `devDependencies` 中，使用方的版本由各自锁文件固定。
- desktop（pnpm）：`file:../../client-kit/ts/*`。pnpm 把目录依赖装成虚拟存储里的副本并按使用方解析 peer，
  锁文件记录解析结果（`…(react@19.2.8)(@types/react@…)`），`--frozen-lockfile` 可复现。
- web-client（npm）：`file:../../client-kit/ts/*`，加 `web/.npmrc` 的 `install-links=true`（npm 官方配置：目录依赖
  按打包副本安装）；`Dockerfile` 在 `npm ci` 之前放入这个文件。
- 删除上表全部绕行。

不纳入使用方 workspace：同一个 `client-kit/ts/platform/node_modules` 只能归一个安装者，client-kit 已是 `apps`
根 workspace 的成员，再加入 `collaboration/pnpm-workspace.yaml`（上游文件）会让两个安装者争写同一目录；web-client
是单包 npm 项目，没有 workspace 可加入。workspace 成员也是符号链接，只在版本恰好一致时共用一份 React，不是保证。

### 这不是“构建时拷贝”

ADR-16 禁止的是构建脚本把源码复制进二开树、让树里出现一份需要同步的副本。这里仓库里仍只有 `client-kit/` 一份
源码；副本在 `node_modules`，由包管理器按锁文件生成、不入库、每次 `npm ci`/`pnpm install --frozen-lockfile` 重建，
和任何第三方依赖一样。产物的 `inputs` 仍覆盖 `client-kit/ts/*`，改包即“需重建”。

## 后果

正面：两个使用方的 `tsconfig.json`、`vite.config.ts` 回到上游原样，desktop 的 `test-loader-hooks.mjs` 去掉 client-kit
分支；任何新的解析器（测试运行器、Tailwind 扫描、IDE）都按普通依赖处理，不必再加一层改写。上游差异只剩
`package.json` 两行依赖、锁文件与 web-client 的 `.npmrc`/`Dockerfile` 一行。

负面：开发时副本不随源码自动更新（实验已证实：pnpm 不带入新增文件，npm install 不刷新）。改了 client-kit 后，desktop 执行
`pnpm --filter buzz update @client-kit/platform @client-kit/contracts`（原地修改的文件本就可见，新增或删除文件需要这一步），
web-client 执行 `npm ci`。发布构建总是全新安装，不受影响。

防回归：两端产物的 bundle 里只能有一份 react（按构建产物的 source map 统计 `node_modules/react` 的包根）；`tsc`
与单元测试发现不了双份 React，这一项只能靠 bundle 检查。

## 重新评估条件

- `@client-kit/platform` 需要自带某个运行时依赖且该依赖有模块级状态（此时它也必须是 peer）；
- 任一使用方换包管理器，或 npm/pnpm 改变目录依赖的安装语义；
- client-kit 改为经 registry 发布（ADR-09 的重新评估条件），届时副本语义天然成立，本 ADR 的配置随之移除。
