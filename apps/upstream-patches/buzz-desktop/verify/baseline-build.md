# buzz-desktop 基线可构建性

改造上游之前先证明未改的基线在本机构建得出来——否则第一个 patch 失败时分不清是 patch
的问题还是基线本来就不通。

## 实测（2026-09-23）

从 `https://github.com/block/buzz` 取 `779af8886caae1317b4de962082429867ab61503`，在仓库之外的
工作目录里（`.references` 是只读证据，不在其中构建）：

| 步骤 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（monorepo 根） | 成功 |
| `desktop/`：`pnpm typecheck` | 通过 |
| `desktop/`：`pnpm build`（前端） | 通过 |
| `cargo build --manifest-path desktop/src-tauri/Cargo.toml` | 通过 |

Tauri 在编译期校验 `externalBin` 声明的 sidecar 是否存在；基线构建按上游 `Justfile` 的
`_ensure-sidecar-stubs` 为它们放置空占位，这些 sidecar 是 Agent 运行时与工具链
（`buzz-acp`、`buzz-agent`、`buzz-dev-mcp`、`git-credential-nostr`、`buzz`、
`buzz-backend-kubernetes`）。

## Linux 构建前置

以上游 CI（`.github/workflows/_ci-desktop.yml`）的依赖为准，Ubuntu 24.04 上需要：
`build-essential`、`file`、`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、
`librsvg2-dev`、`libssl-dev`、`libxdo-dev`、`libasound2-dev`、`patchelf`，另加 `libopus-dev`（或
`cmake`，由 `audiopus_sys` 从源码构建 Opus；上游 CI 的 runner 自带 cmake）。逐个缺失时的失败：
缺 ALSA 时 `alsa-sys` 构建脚本失败，缺 Opus 与 cmake 时 `audiopus_sys` 构建脚本失败——两者都来自
huddle 的音频栈。

## 一期要从这个基线里去掉什么

`.design/01` §5 把以下能力排除在一期之外，`DD-75` 与 Stage 1 的明确限制另排除 Agent：Huddle/视频、
NIP-44 私聊（上游的 DM）、项目管理（Projects）、个人日历（Reminders）、本机自动化（Terminal）。
上游的 YAML Workflows、Pulse（含 Agent 活动流）、mesh LLM 与 Forum Channels 在设计中没有登记。
上游只有四项在 preview 开关后（workflows、projects、pulse、forum），开关只能隐藏入口而不能让入口
不存在；其余是一等功能。因此 Kailo 版本以 patch 移除全部入口——路由、导航与菜单项、发起它们的
对话框与动作、Tauri 命令、设置开关与打包的 sidecar——再按可达性删除因此不可达的代码。

## 2026-09-26 任务取消入口增量

从固定 `779af8886caae1317b4de962082429867ab61503` 重放登记的裁剪、补丁与共享平台包，受限 BuildKit 构建 Linux `.deb` 成功；`dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 摘要为 `sha256:d4ce55cdad81e8dc07e3c4c0d64b80208bc28bd6256c478e998a26ea36ab163e`，`baseline.yaml` 已同步。`check.sh --full` 的共享 TypeScript 类型与测试、四侧契约检查通过。此项只证明 Linux 安装包可构建；未在本增量重跑 Desktop 原生端端到端操作，亦无 macOS/Windows 安装包证据。

2026-09-26 取消终态展示修正后，从同一固定基线重放并以受限 BuildKit 重建 Linux `.deb`，`dist/buzz-desktop/Buzz_0.5.23_amd64.deb` SHA-256 为 `345cd7a86da3f9ca0bfeaa224f9695c3f8b09e9d5845e5c7b2a2f276f0f5b640`，`baseline.yaml` 与追溯清单已同步。共享平台包 56 项测试通过；本增量仍无 Desktop 原生会话端到端或 macOS/Windows 产物证据。
