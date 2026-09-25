# buzz-desktop：Kailo 一期版本的核验

## 范围

基线 block/buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/`（Tauri，SF-DSK-01/02）。
Desktop 与 Web 同步交付完整能力面（apps/02 §1.1）：Kailo 登录引导（RFC 8252 PKCE、刷新令牌只在
Rust 侧）、本机持钥直连 Relay 的协作数据平面（DD-75）、经原生入口进 BFF 的管理面（DD-78），
平台页为成员、本人任务、待我审批、本人审计、本人设备。平台页与登录引导是 Kailo 共用包
`web/packages/platform` 里与 Buzz Web 同一份的组件（ADR-09），构建时经 `vendor_files` 放入。

一期不交付而删除的上游能力见 [baseline-build.md](baseline-build.md) 末节；清单登记为
`remove_paths`（整块删除的 821 条路径，构建时 `git rm -r`）与一份补丁 `0001-kailo-desktop.patch`
（其余 461 个文件的改动）。两者由 `tools/upstream_manifest.py export` 从开发分支
（block/buzz 的 `kailo` 分支，HEAD `2812efe4b0c51431220021818c73b3d98a3abec3`）导出。

## 清单可复现

`UPSTREAM_MIRROR=<开发树> tools/build-upstream.sh --source-only <目录> buzz-desktop` 按清单取基线、
删除登记路径、打补丁、放入 13 个 vendor 文件，再与开发树逐文件比对（内容与可执行位）：

```
工作树已跟踪 3063 个文件；重建树 3076 个（其中 vendor 13 个）
只在重建树：0
只在工作树：0
内容不同：0
可执行位不同：0
vendor 与 kailo 源不一致：0
```

破坏核验：从 `remove_paths` 删掉一条（`desktop/.env.e2e`）后重建，比对报「只在重建树：1
desktop/.env.e2e」并退出 1。`UPSTREAM_MIRROR` 只换取源地址：构建仍取清单里的 commit，取到的
HEAD 与 `implementation_base_commit` 不一致即失败。

## 产物

`tools/build-upstream.sh buzz-desktop`（构建文件 `packaging/Dockerfile`，工具链取源树的
`rust-toolchain.toml` 与 `packageManager`）产出唯一的安装包：

| 项 | 值 |
|---|---|
| 文件 | `dist/buzz-desktop/Buzz_0.5.23_amd64.deb`（20,882,322 字节） |
| `artifact_digest` | `sha256:4203c410685ba6ca8099a0027e961e691844d206e97b0ccc619646751468f4d3` |
| 包元数据 | `Package: buzz`、`Version: 0.5.23`、`Architecture: amd64`、`Depends: libwebkit2gtk-4.1-0, libgtk-3-0` |
| 内容 | `/usr/bin/buzz-desktop`、`Buzz.desktop` 与图标；可执行文件的 127 个共享库依赖在 Ubuntu 24.04 上全部可解析 |

## 实测（2026-09-24，开发分支 HEAD 加 kailo 仓库当前的共用包与契约生成物）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck`（`tsc --noEmit`） | 通过 |
| `pnpm check`（biome、px-text、pubkey-truncation） | 通过：`Checked 997 files … No fixes applied.` |
| `pnpm test` | `pass 2290`、`fail 0` |
| `pnpm build:e2e`（`tsc && vite build`） | 通过 |
| Playwright `--project=smoke`（435 例） | 432 passed、2 skipped、1 failed：`scroll-history.spec.ts:1287` 的覆盖率阈值（194 ≥ 100）。该例在同机并行 cargo/flutter 构建时失败；单独以 `--repeat-each=3` 重跑 `scroll-history.spec.ts` 为 54 passed，判为负载引起的时序抖动，与本次改动无关 |
| Kailo 冒烟（`kailo-bootstrap.spec.ts`、`kailo-platform.spec.ts`） | 14 passed：登记 RECONCILING 时没有定时重读、两次「重新确认」各读一次列表；任务列表→详情→带确认的撤回；审批的确认、结果不明不说成功或失败、原样重发同一决定 |
| `cargo clippy --all-targets -- -D warnings` | 通过 |
| `cargo test --lib` | `387 passed; 0 failed; 9 ignored` |
| `core/verify/native-e2e.sh desktop <开发树>` | `kailo::e2e::desktop_signs_in_registers_device_and_publishes_through_relay ... ok`，`1 passed` |

破坏核验（均已还原并复验通过）：平台页路由把 `tasks` 指向审计页 → 冒烟「my tasks …」失败；
共用包里把 observation 为 `EXTERNAL_RESULT_UNKNOWN` 的任务按 Workflow 终态显示 → vitest
「结果不明与投影落后不说成功也不说失败」失败；批准不经确认直接提交 → 两例审批用例失败。

## 端差异

- 设备登记进行中不再定时重查：客户端没有依据选间隔，BFF 也不下发；由用户「重新确认」。
- 任务的取消与重跑在 Core 目录里没有登记为 Governed Action，Desktop 与 Web 都不渲染入口。
- Tenant/Workspace admin 的授予与撤销没有界面入口：BFF 没有给出「调用方能否管理」的回答，
  前端不自判权限，因此不渲染。

## 未覆盖

- 只构建了 Linux `.deb`；macOS、Windows 安装包与代码签名未做。
- 安装包未在带桌面会话的机器上安装运行；运行时行为由 `native-e2e.sh`（Rust 侧 Kailo 层对真实
  拓扑）与 Playwright（前端经 e2e bridge）分别覆盖。
