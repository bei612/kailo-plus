# buzz-desktop：Kailo 一期版本的核验

## 范围

基线 block/buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/`（Tauri，SF-DSK-01/02）。
Desktop 与 Web 同步交付完整能力面（apps/02 §1.1）：Kailo 登录引导（RFC 8252 PKCE、刷新令牌只在
Rust 侧）、本机持钥直连 Relay 的协作数据平面（DD-75）、经原生入口进 BFF 的管理面（DD-78），
平台页为成员（Tenant admin 另有邀请一节，DD-83）、本人任务、待我审批、本人审计、本人设备。
平台页与登录引导是 Kailo 共用包
`web/packages/platform` 里与 Buzz Web 同一份的组件（ADR-09），构建时经 `vendor_files` 放入。

一期不交付而删除的上游能力见 [baseline-build.md](baseline-build.md) 末节；清单登记为
`remove_paths`（整块删除的 821 条路径，构建时 `git rm -r`）与一份补丁 `0001-kailo-desktop.patch`
（其余 461 个文件的改动）。两者由 `tools/upstream_manifest.py export` 从开发分支
（block/buzz 的 `kailo` 分支，HEAD `d788da8a9489c7f2755721beb2113917841bc61f`）导出。

## 清单可复现

`UPSTREAM_MIRROR=<开发树> tools/build-upstream.sh --source-only <目录> buzz-desktop` 按清单取基线、
删除登记路径、打补丁、放入 14 个 vendor 文件，再与开发树逐文件比对（内容与可执行位）：

```
工作树已跟踪 3063 个文件；重建树 3077 个（其中 vendor 14 个）
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
| 文件 | `dist/buzz-desktop/Buzz_0.5.23_amd64.deb`（20,885,430 字节） |
| `artifact_digest` | `sha256:f59a18d3e48e5d8b725552de08604050f721538ab7c5bb0152a7e42a62ac8a5c` |
| 包元数据 | `Package: buzz`、`Version: 0.5.23`、`Architecture: amd64`、`Depends: libwebkit2gtk-4.1-0, libgtk-3-0` |
| 内容 | `/usr/bin/buzz-desktop`、`Buzz.desktop` 与图标；可执行文件的 127 个共享库依赖在 Ubuntu 24.04 上全部可解析 |

## 实测（2026-09-25，开发分支 HEAD 加 Kailo 当前共用包与契约生成物）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck`（`tsc --noEmit`） | 通过 |
| `pnpm check`（biome、px-text、pubkey-truncation） | 通过：`Checked 997 files … No fixes applied.` |
| `pnpm test` | `pass 2290`、`fail 0` |
| `pnpm build:e2e`（`tsc && vite build`） | 通过 |
| 前一共用包的 Playwright `--project=smoke`（437 例） | `435 passed (16.2m)`，2 skipped；这是前次全量结果，本次未重跑全量 |
| 当前共用包的 `@kailo/platform` 测试 | `49 passed`：设备重查、角色管理候选人、最后一位 admin 的不可撤销提示、受控动作提交与异常响应均通过 |
| 本次 Linux `.deb` | 固定上游 commit + manifest 补丁 + 当前共用包重新构建成功；`Buzz_0.5.23_amd64.deb` SHA-256 `c2349b05821540e12441b08d4e5a27bd449162efee4cc69e6f6b343905ee9b75`；未在真实桌面会话中安装运行 |
| Kailo 登录冒烟（`kailo-bootstrap.spec.ts`） | 当前共用包 `8 passed`；其中旧服务端未给重查间隔的脚本仍走手动确认。此前版本的登录与平台页合计 `16 passed`，不能代替本次未重跑的平台页冒烟 |
| 前一开发分支的 `cargo clippy --all-targets -- -D warnings` | 通过；本次安装包构建已重新编译 Rust，未重跑 clippy |
| 前一开发分支的 `cargo test --lib` | `387 passed; 0 failed; 9 ignored`；本次未重跑 |
| `core/verify/native-e2e.sh desktop /tmp/dsk` | 当前开发树、当前 Core 容器与真实本地拓扑：`kailo::e2e::desktop_signs_in_registers_device_and_publishes_through_relay ... ok`，`1 passed` |

破坏核验（均已还原并复验通过）：平台页路由把 `tasks` 指向审计页 → 冒烟「my tasks …」失败；
共用包里把 observation 为 `EXTERNAL_RESULT_UNKNOWN` 的任务按 Workflow 终态显示 → vitest
「结果不明与投影落后不说成功也不说失败」失败；批准不经确认直接提交 → 两例审批用例失败。

## 端差异

- 设备登记进行中只按 Core 回应的 `recheckAfterMillis` 自动重查；旧服务端未给该字段时保持待激活并提供「重新确认」，不猜间隔。新间隔路径由共享 TypeScript 测试验证；上表的登录冒烟覆盖旧服务端手动路径。
- 任务的取消与重跑在 Core 目录里没有登记为 Governed Action，Desktop 与 Web 都不渲染入口。
- 邀请的兑换不在 Desktop：邀请链接是浏览器入口上 Web 兑换页（`/app/invite`）的地址，在系统
  浏览器里打开即兑换。Desktop 不为它注册 URL 处理——那会让一次性凭据经操作系统的 URL 分发
  与日志；尚不是成员时原生引导显示本人的兑换进度，管理员确认后「重新确认」即可登记本机。
- 新 `.deb` 已包含共用包的 Tenant/Workspace admin 管理页；BFF 按 SpiceDB 当前关系返回
  角色与按钮可用性，前端不自判权限。首次构建因磁盘余量降至 9.1 GiB 主动取消；打包
  Dockerfile 将编译目录改为 BuildKit cache mount 后重建成功，安装包仍需真实桌面会话验证。

## 未覆盖

- 只构建了 Linux `.deb`；macOS、Windows 安装包与代码签名未做。
- 安装包未在带桌面会话的机器上安装运行；运行时行为由 `native-e2e.sh`（Rust 侧 Kailo 层对真实
  拓扑）与 Playwright（前端经 e2e bridge）分别覆盖。
