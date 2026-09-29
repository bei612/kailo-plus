# ADR-16：apps 目录与包名按功能命名、二开项目以完整项目直接开发，并持续跟踪上游变化

- 状态：已接受（取代 ADR-15 的目录布局——`apps/upstream/<项目>/`——与 `vendor_files` 构建时放置两部分；ADR-15 的其余决策继续有效）
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

用户的最高判据：所有项目都直接作为完整的项目进行二开，不再做任何补丁；实施工程要随时知晓 `/volumes/kailo/.references`
的变化，也要能把变化更新进来；`apps` 的项目目录不体现任何开源项目的名字，按功能名称划分。追加判据：`apps` 下的目录与
包名也不体现产品名 Kailo——产品名是部署配置，不是代码结构。

ADR-15 已把需要修改的上游改为固定 commit 的完整源码入库，但留下三处与判据不符：

- **目录以上游项目命名**：`apps/upstream/buzz`、`buzz-web`、`agentgateway`、`codex`。目录名说的是「来自哪个开源项目」，
  不是「在 Kailo 里承担什么功能」；上游一旦更换，目录名就与内容脱节。
- **仍有构建时拷贝**：Kailo 自有的 TypeScript 平台包、契约生成物与 Dart 共用代码经 `vendor_files` 在构建时复制进上游树，
  树里只有 `.gitignore` 忽略的空位。在树里开发、测试要先手动放入副本，编辑器与类型检查看到的是拷贝而不是权威源；
  这仍是一种「构建时才成立」的补丁式组装。
- **目录与包名带产品名**：`core/crates/kailo-core` 等 crate、`@kailo/*` 包、Dart 包 `kailo_mobile`、Go 模块
  `github.com/kailo/apps/worker`、二开树里的 `kailo/` 子目录与产物名都写死了产品名；产品一旦改名或按部署配置换名，
  代码结构就与之不符。
- **不知道上游变了什么**：`upstream_manifest.py diff` 只回答「Kailo 改了什么」。`.references` 刷新后，哪个二开项目的上游
  有了新提交、涉及哪些文件、这些文件 Kailo 是否也改过，没有工具回答，升级只能靠人读更新记录。

约束：

- `.references` 只读，只提供固定源码证据与更新差异（`AGENTS.md` 第 2 条、`04-上游适配与升级.md` §4.1）；
- 设计先于实现：上游固定 commit 的变化先落 `.design/02` §1，再改实现（`04` §4.3）；
- 每个发布产物可追溯到源码与 digest（ADR-06、ADR-15 的 `source_digest`）；
- 平台目录与标识不含业务能力实现的产品名（`DD-88`）。

## 候选方案

- **保留 `apps/upstream/<上游名>/`，另加功能别名**：目录仍以开源项目命名，别名只是第二套称呼，与判据冲突；排除。
- **按功能拆细（例如把 Relay、Desktop、Mobile 拆成三个目录）**：Desktop 的 Tauri 后端以相对路径 `../../crates/` 依赖
  `buzz-core`、`buzz-sdk`、`buzz-ws-client`、`buzz-media`，拆开就要改写这些依赖路径，每次与上游合并都在同一处冲突；排除。
- **一个上游仓库一个功能目录，目录内保持上游原样结构；Kailo 自有的共用代码独立成功能目录，以本地路径依赖引用**：采用。

## 决策

1. **目录按功能命名，不出现开源项目名**：

   | 目录 | 功能 | 来源 |
   |---|---|---|
   | `apps/core/` | 平台核心：BFF 与统一治理内核；crate 为 `platform-core`、`identity`、`secret-store`、`collab-bridge`、`contracts` | 自建；crate 原为 `kailo-core`、`kailo-identity`、`kailo-secrets`、`kailo-buzz` |
   | `apps/worker/` | 工作流执行；Go 模块路径 `apps/worker` | 自建；模块路径原为 `github.com/kailo/apps/worker` |
   | `apps/contracts/` | 契约 schema | 自建（不变） |
   | `apps/collaboration/` | 协作底座：Relay 服务端（`crates/`）、Desktop 客户端（`desktop/`）、Mobile 客户端（`mobile/`） | 原 `apps/upstream/buzz`，block/buzz 单仓 |
   | `apps/web-client/` | Web 聊天客户端 | 原 `apps/upstream/buzz-web`，hardy4yooz/buzz-web |
   | `apps/client-kit/ts/` | Web 与 Desktop 共用的 TypeScript：`platform/`（`@client-kit/platform`）与 `contracts/`（`@client-kit/contracts`，契约 TS 生成物） | 原 `apps/web/packages/platform`（`@kailo/platform`）与 `apps/web/packages/contracts`（`@kailo/contracts`） |
   | `apps/client-kit/dart/` | Mobile 共用的 Dart 包 `client_kit`（契约 Dart 生成物与平台文案，文案在 `lib/shared/platform/`） | 原 `apps/mobile/`（包 `kailo_mobile`，文案在 `lib/shared/kailo/`） |
   | `apps/model-gateway/` | 模型与工具网关 | 原 `apps/upstream/agentgateway` |
   | `apps/agent-runtime/` | Agent 运行时 | 原 `apps/upstream/codex` |
   | `apps/deploy/`、`apps/tools/`、`apps/docs/` | 部署、工具、文档 | 不变 |

   `collaboration` 不拆：Desktop 的 Tauri 后端以相对路径依赖 `crates/` 下的四个 crate。`web-client` 独立：它的上游是独立仓库，
   block/buzz 单仓自带的 `web/` 不是协作客户端（`SF-WEB-09`、`DD-74`）。以后新接入的项目同样按功能命名（例如
   `metering/`、`file-storage/`、`knowledge/`、`data-query/`），首次需要修改或自建时整体搬入；原样使用的组件（身份、授权、
   工作流服务、密钥、数据库、对象存储、观测采集等）继续使用按 digest 固定的官方镜像，不建目录。

   目录、包名与产物名不含开源项目名，也不含产品名：

   - 部署目录：`deploy/local/keycloak` 改为 `deploy/local/identity-provider`（realm 文件 `realm.json`），`deploy/local/spicedb` 改为
     `deploy/local/authorization`；运行时数据 `deploy/local/data/openbao` 改为 `data/secret-store`，`data/buzz-objects` 改为
     `data/collab-objects`；`secrets/keycloak-import` 改为 `secrets/idp-import`。
   - 构建输出：`dist/buzz-desktop` 改为 `dist/desktop-client`，`dist/buzz-mobile` 改为 `dist/mobile-client`。
   - 产物名按功能：`core`、`worker`（原 `kailo-core`、`kailo-worker`；Core 的二进制为 `/usr/local/bin/platform-core`）、`collaboration-relay`（原 `upstream-buzz`，含 Relay 与其管理工具）、
     `desktop-client`（原 `upstream-buzz-desktop`）、`mobile-client`（原 `upstream-buzz-mobile`）、`web-client`（原
     `upstream-buzz-web`）、`model-gateway`（原 `upstream-agentgateway`）、`agent-runtime`（原 `upstream-codex`）。
   - 例外：`.codex`、`.claude`、`.trellis`、`.agents`、`.gitnexus` 是对应工具规定的配置目录名，保留原名；`apps` 之外的
     仓库根目录与远端仓库名不在本 ADR 范围内。
   - 界面上显示的产品名来自部署配置，三端不写死（`.design` `DD-111`）；已持久化或跨进程约定的内部标识（workflow ID 前缀、
     Temporal Search Attribute、身份 header、指标名等）不是目录或包名，其去留由 ADR-17 决定。
2. **项目内部保持上游原样的命名**：二开项目内部的包名、crate 名、模块路径与上游一致，只有顶层目录按功能命名；否则每次
   与上游合并都会在改名处冲突。本仓库在二开树里新增的目录与模块按功能命名、不含产品名（例如 Desktop 的
   `src/features/platform/` 与 Rust 模块 `mod platform`）。
3. **每个二开项目保留 `fork/` 子目录**（原 `kailo/`）：`fork/upstream.yaml`（来源记录，格式见 `06` §2）、`fork/verify/`（接缝证据）、
   `fork/packaging/`（上游没有而由本仓库维护的构建文件）；`agent-runtime` 的固定运行配置在 `fork/runtime-config/`。只以 Go module 引用的 `temporal-sdk-go` 不设目录，来源记录归
   Worker 所有，放在 `worker/fork/upstream.yaml`。
4. **没有补丁，也没有构建时拷贝**：`vendor_files` 废弃。`web-client`（上游用 npm）与 `collaboration/desktop`（上游用 pnpm）以本地路径依赖
   （`file:`/`link:`）直接引用 `client-kit/ts`，`collaboration/mobile` 以 Flutter `path:` 依赖引用 `client-kit/dart`；需要改的
   Dockerfile 在各自树里改，引用 `client-kit` 的产物构建上下文扩到 `apps/`；来源记录的路径一律相对 `apps/`，产物以
   `inputs`/`exclude` 声明输入范围并覆盖所引用的 `client-kit` 路径，`source_digest` 按它计算（`06` §2）。上游自带的依赖补丁机制（例如 pnpm `patchedDependencies`）属于上游原样，保留。
5. **知晓 `.references` 的变化**：`tools/upstream_manifest.py status` 只读取 `.references/<上游目录>`（目录名由来源记录的 `reference_tree` 登记）的 HEAD、
   `.references/UPDATE_TASKS.json` 与 `.references/<上游目录>更新记录.md`，与每个二开项目来源记录的 `implementation_base_commit` 比较，列出
   上游的新提交与涉及文件，并标出其中哪些文件在二开树里被 Kailo 改过。`tools/check.sh` 包含这一步，上游有新变化时明确提示
   （`status` 恒以 0 退出，提示不等于失败：是否升级由 `04` 的影响分类决定）。每次开工先运行一次。
6. **能更新**：`tools/upstream_manifest.py sync <项目> [--to <commit>] [--into <目录>]` 以来源记录的 `implementation_base_commit` 为共同祖先、
   二开树的当前内容为一方、`.references` 的新 commit（默认其 HEAD）为另一方做三方合并，结果直接写进二开树，冲突按 git
   标准冲突标记留在文件里人工解决（`--into` 写进指定目录里的一份树副本，供先行演练）；`sync` 不提交、不改来源记录。合并后按 `04` §4.2–§4.4 重验受影响的 `SF-*`/`SS-*`，同步 `.design/02` §1 的固定 commit
   与来源记录的两个 commit；设计改动与实现改动按 `AGENTS.md` 第 19 条分开提交、设计先行。
7. **`.references` 始终只读**：`status` 与 `sync` 只读取其文件与 git 对象（对象库经本机缓存库的 alternates 借用），不在其中
   写入、检出、构建或运行任何东西。
8. **沿用的上游构建文件由本仓库维护**：`collaboration-relay` 与 `model-gateway` 直接沿用上游树里的 Dockerfile
   （`collaboration/Dockerfile`、`model-gateway/Dockerfile`），其基础镜像按可变 tag 引用、未按 digest 固定；而 `check.sh
   security` 目前只检查 `fork/packaging/` 下的构建文件，这两份不在检查范围内。源码既已归本仓库维护，这两份 Dockerfile
   在各自树内把基础镜像改为按 digest 固定，门禁随之扩到每个产物登记的 `build_dockerfile`，不再以所在目录区分；上游示例、
   基准测试与 CI 用的 Dockerfile 不是产物的构建文件，仍不检查。

## 后果

正面：

- 目录回答「这是平台的什么功能」，换上游不必改目录；平台目录不带开源项目名。
- 本仓库自有的共用代码只有一份，且在开发、测试、构建三处都以同一路径被引用，不再有副本与放置步骤。
- 上游有新提交时 `status` 与 `check.sh` 会提示，`sync` 把「读更新记录、手工合并」变成一条可重复的命令。

负面：

- 构建上下文扩到 `apps/` 后，产物输入范围要显式排除无关目录，否则无关改动也会让 `source_digest` 失效。
- 本地路径依赖改写了上游的依赖声明与锁文件（`package.json`、`package-lock.json`、`pnpm-lock.yaml`、`pubspec.yaml`、`pubspec.lock`），这些是
  本仓库在二开树里的改动，合并时会与上游的依赖升级冲突，需人工处理。
- 目录与包名搬迁一次性改动所有引用这些路径与包名的代码、脚本、compose、追溯记录与文档；本地运行时数据目录改名需停机
  迁移或 `--fresh` 重建；历史核验记录保留当时的路径。

锁定：功能目录名与包名、`fork/` 子目录约定、本地路径依赖的引用方式。放弃：`vendor_files`、以上游名或产品名命名的目录与包。

## 替换边界

替换本方案只涉及 `apps/` 顶层目录布局、`tools/upstream_manifest.py` 的 `status`/`sync`、各二开项目的依赖声明与构建文件；
产物 digest、compose 按 digest 引用、追溯记录格式与 ADR-06 的供应链流程不受影响。某个功能换用另一个上游时，目录名不变，
替换目录内容与来源记录。

## 重新评估条件

- 某个二开项目的 Kailo 改动与上游分歧大到三方合并在一次升级周期内无法完成，需要改为长期独立维护；
- 本地路径依赖在上游的包管理器或构建工具的新版本下不再可用；
- 同一功能需要同时承载两个上游（例如 Web 客户端改用另一个上游并与旧上游并行），一个功能目录一个上游的对应被打破。
