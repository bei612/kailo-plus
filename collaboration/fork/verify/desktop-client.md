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

- 本节历史核验只构建了 Linux `.deb`；2026-10-02 的 Windows unsigned 测试安装包构建见文末。macOS、Win11 安装运行和代码签名仍未覆盖。
- 安装包已在 Xvfb 桌面会话里安装运行，结果见文末「2026-09-29 安装包在桌面会话中的端到端」。
  撤权后 Desktop 界面不再提供发布入口，因此没有从安装包观察到 Relay 拒绝撤权后的发布。

## 2026-09-25 共享文案增量

共享 TypeScript 文案新增 Mobile 只读视图所需的 message key，因此 Desktop 的 `vendor_files` 字节变化。固定上游基线与既有补丁重新构建 Linux `.deb` 成功；本次文件 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的 SHA-256 为 `b866d494d54a44591d5809dc907986e32af3051ac95bc6ee1930ed06f19700d2`，已写回 manifest 与追溯记录。前表的 `c2349b...` 是上一次产物，不能用来标识这次包。本次未在真实桌面会话安装，也未重跑 Playwright 全量。

## 2026-09-25 Mobile 登录与连接文案增量

共享 `i18n.ts` 再次变化；固定 Desktop 上游基线、既有补丁和更新后的 vendor 文件重新构建 Linux `.deb` 成功。当前文件 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 经 `sha256sum` 核对为 `723202ab17efacd6e3a271f9d7e19be03cb7dc411e1d0db9c629f85c14d07241`，manifest 与追溯记录同步。此次仅更新共享文案，未在真实桌面会话安装，也未重跑 Playwright 或原生端端到端；上文结果均是历史增量证据。

## 2026-09-25 成员、设备、审计文案增量

Desktop 复用的 `web/packages/platform` 在成员、设备、审计状态视图中使用同一双语枚举映射；固定上游基线、原补丁与新 vendor 文件重新构建 Linux `.deb`。`dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的实测 SHA-256 为 `add870880648eea8ee77b641251b1948b3a21cddc7cb617b1390ee621f62a21a`，已写入 manifest 和当前追溯记录。本增量仍未在真实桌面会话安装，不能把构建成功当作运行验收。

## 2026-09-25 Mobile 设置页共享文案增量

固定 Desktop 上游基线、既有补丁与新增的共享文案文件重新构建 Linux `.deb`；当前 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的实测 SHA-256 为 `8510d2d6835849feafbefc5f208cb50a81d81a1da729f0c2ae2620cd48f30753`，已写回 manifest 与追溯记录。首次构建因磁盘余量跌至 2.4 GiB 主动取消，后台缓存回收后余量恢复至约 50 GiB；重试复用已缓存阶段并完成打包。`check.sh --full` 十项通过。本增量未在真实桌面会话安装，也未重跑 Desktop 原生端到端测试。

## 2026-09-25 Mobile 主题选择器共享文案增量

共享 TS 目录加入主题与强调色双语 key，固定 Desktop 上游基线和既有补丁重新构建 Linux `.deb`；当前 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的实测 SHA-256 为 `f81ad6a35e3741d056501edc77762db58075f4a1c40e6375147270fa13f3357f`，已写回 manifest 与追溯记录。`check.sh --full` 十项通过。本增量没有改 Desktop 的主题 UI 调用逻辑；尚未在真实桌面会话安装，亦未重跑 Desktop 原生端到端测试。

## 2026-09-25 平台时间文案增量

Desktop 共用的 `web/packages/platform` 采用同源相对时间阈值、双语文案与复数选择。固定 Desktop 上游基线、既有补丁和新 vendor 文件重新构建 Linux `.deb`；当次 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 实测 SHA-256 为 `9a31a28a97e47c7b5252089c4626491bf74ac7f0e48591b700c24ed96818dfe0`，manifest 与追溯记录已同步。共享包定时钟测试 53/53 通过；本增量仍未在真实桌面会话安装，也未重跑 Desktop 原生端到端测试，不能以 Web 走查替代桌面验收。

## 2026-09-26 角色页共享文案增量

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 基线、既有补丁与更新后的 `web/packages/platform/src/react/roles.tsx` 重新构建 Linux `.deb`。受限 BuildKit 构建成功，`dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的 SHA-256 为 `bb01ca84d44c65957030e3f32eb590db3f93b2f7a6a19d65d1b90f44694ce284`；manifest 和角色管理追溯记录已同步。此包尚未在真实 Linux 桌面会话安装，不能据此声称 Desktop 端到端验收完成。

## 2026-09-29 安装包在桌面会话中的端到端

本次先卸载旧的 `buzz` 包，再用 `dpkg -i` 安装 `dist/buzz-desktop/Buzz_0.5.23_amd64.deb`
（SHA-256 `6ad17a43284f6060703ed36b8205c077d864f53500a93dcc52a1f684e9289615`，与清单一致）。安装没有缺少依赖。
运行环境是 Xvfb `:99`（1440x900），配有独立的 dbus 会话，gnome-keyring 以 login 集合为默认，系统浏览器
设为 google-chrome；界面用 xdotool 操作。没有 Secret Service 时，应用只显示
`keyring unavailable … Secret Service: no result found` 和一个重试按钮，不会进入登录。

夹具与 Mobile 那次是同一个 `verify_workspace --governance`，两端在同一 Workspace 里同时运行。

| 步骤 | 结果 |
|---|---|
| 首次启动 | 显示「Connect to your server」，三项都为空 |
| 填写原生入口、issuer、`kailo-native` 后登录 | xdg-open 在 Chrome 打开 Keycloak；登录后回调到 `http://127.0.0.1:<随机端口>/callback`，页面显示「登录已完成」；应用进入平台主界面，设备公钥 `508df88c5510…` 登记为 ACTIVE |
| 协作面 | 收到 Mobile 安装包发出的 `mobile-apk-e2e-hello`；发送 `desktop-deb-e2e-hello`，Relay 库里存为 kind 9，由设备公钥签名，Mobile 端收到 |
| Tasks | 列出 `tenant.member.revoke`（等待审批）与两条 `identity.client_key.register` |
| Approvals | 列出另一位 admin 提交的 `tenant.member.revoke`，详情里有 Approve 和 Deny；点 Approve 后先要求二次确认，确认后记下决定，状态变为「Approved and carried out」 |
| 另一位 admin 经 BFF 撤掉核验用户的 WorkspaceMembership（→ REVOKED） | Relay 以 kind 9001 把该设备公钥移出 Channel；侧栏的 Channel 列表清空，经历史导航回到 Channel 路由也只显示「Select a channel to view messages.」 |

撤权后 Desktop 界面没有可用的发布入口，所以这次没有从安装包直接观察到 Relay 拒绝撤权后的发布。
Relay 侧的证据有两项：roster 已把该公钥移除，Relay 库中没有撤权后的消息。设备撤销后直连发布被 Relay
拒绝，此前由 `native-e2e.sh desktop` 用源码树覆盖，本次没有重跑。

另外观察到一处不一致：`identity.client_key.register` 任务显示「Allowed, not started yet」，但设备已经 ACTIVE，
与 Mobile 上看到的现象相同。截图在 `/volumes/data/kailo/tmp/native-evidence/`（`desktop-*.png`），
夹具已拆除，宿主机 hosts 已恢复。

## 外观说明使用部署显示名（2026-09-30）

`SettingsPanels.tsx::ThemeSettingsCard` 的两段说明以共享 `{name}` 参数消费既有
NativeSession 的显示名，无值时使用共享中性标题；外观与主题标题复用已有文案 key。
同文件已有的三种主题模式文案使用共享目录，主题处理器、偏好存储、布局和样式
标识不变。两条新说明只有 TypeScript 一份定义，Dart 由原生成器投影。

按 ADR-18 原命令刷新 kit 副本后，单文件 Biome format/check 与整体 typecheck
均退出 0；五份 package/lock 摘要前后严格相等。日志为
`/volumes/data/kailo/tmp/codex-desktop-theme-settings-check-20260930.log`。
本节类型与格式检查不是原生运行验收，不证明新显示名在安装包内刷新或换服。

原构建入口单次完成安装包，退出 0、5 分 5.481 秒；当前 source 为
`sha256:5f85180ee19ece3230e627438d07125674c5c4cb22ffa090dc17216486a8674e`，
`dist/desktop-client/Kailo_0.5.23_amd64.deb` 实存 SHA 与登记均为
`sha256:4ce222a33e4e96db6ef58ea5af1f47e8b56c18d58f1083a9c0f7ad45739abf60`。
日志为 `/volumes/data/kailo/tmp/codex-native-name-desktop-artifact-root-20260930.log`；
前两次执行包装失败保留于同目录，未据其报告构建完成。该包未安装或启动，来自
完整工作树的产物不作为选定源码提交的发布证明，能力状态与三端验收结论不变。

## 2026-10-02 Windows x64 NSIS unsigned 测试包（独立纯呈现源码）

按 DD-74、ADR-06/16/18 与现有 Desktop 打包入口，独立 Data 候选直接复用
已经核验的 Web/Desktop 共源呈现。只新增 Windows Dockerfile 与同名 ignore 文件，
并将私有候选的现有 `desktop-client` 配方指向该文件；没有恢复 sidecar、updater、
新 runtime/profile、签名凭据或身份/媒体传输路径。正式工程、Linux 原产物记录和部署未改。

原 `tools/build-upstream.sh desktop-client` 实际退出 0。Rust 1.95.0、
pnpm 11.4.0、`cargo-xwin 0.23.1 --locked`、MSVC target 与 NSIS 路线实际完成编译、
插件摘要核验及打包；生成 `Kailo_0.5.23_x64-setup.exe`，15,061,019 字节，
SHA-256 `83e612e8b577996cb69b7af08e3228c05f074302fcd1a4cbae63bef4a146d6a7`。
原来源算法复算 source 为
`66e92a99d39d40c19880bcee12ca9489f6df0a1591a035ada1f82c14565bbc4a`，
与私有产物记录一致；纯 UI 父树为 `da5bff76d9d88bc0aae292f994d4d8ddf0a0fca8`，
Windows 包装源树为 `35b7e0c4c9bb53434772f534580d83065e7d21cf`。

构建使用原 8 CPU / 16 GiB Data builder；实际 `memory.swap.max=max`，
主机无 swap，不声称 cgroup 硬零。原源先 COPY 再安装工具，因此后续合同源码变化
可能使工具层缓存失效；warm builder 不保证免除该成本，不另造 SDK 镜像或重排本配方。
工具版本、固定 cargo-xwin 发布源码/锁文件、实际 CRT 14.44/Win11 SDK 10.0.26100、
原始警告和退出码保存在
`/volumes/data/kailo/tmp/codex-win11-presentation-build-20261002.WR8wSc/provenance/windows-delivery-handoff.md`。

这是 unsigned 开发测试包，不是 signed release：安装器 PE security directory 为零，
原签名跳过警告保留。尚未在 Win11 安装、启动、登录或验证 clipboard、keyring 与协作功能；
不能把构建成功、Linux 历史运行或 SSR 核对冒充 Windows 运行验收。
该包仅属于上述旧纯呈现源码；正在收口的 Core/最终合同一旦变化，
必须在同一最终产品候选上由原入口重新构建 Web 和 Windows 并登记真实新摘要，
不得将本节 source/产物摘要当作下一轮最终合同产物或提升任何 capability/gate 状态。

## 2026-10-02：同一产品候选与最终合同的 unsigned Windows x64 包

本节关联 `REQ-21`、`DD-74/75`、`DD-111`、`SS-WEB-PRESENTATION` 与 ADR-06/09/18，
只记录既有 Tauri 主体的真实 Windows 测试安装包，不新增 sidecar、runtime/profile
或业务接口。原三路径 Windows 配方与上节一致，未做缓存层排序优化或引入第二 SDK。
共享 UI、最终合同和 Core/Worker 在同一个 Data 产品候选闭合；初始业务源 tree
`575163abf772e380125ab1682881ad344371a810`、文档 tree
`06e6c45100959bcdeac1ef11cae8933af57efd72`，随后 Core-only 修正的 tree
`e1717576d4d97892d60abadea86978b9d0410173` 不改变本产物输入。
这些 tree 不冒充 commit；正式提交由批次负责人完成。

原 `tools/build-upstream.sh desktop-client` session `82920` 真正退出 0，
以 `PLATFORM_DISPLAY_NAME=Kailo` 构建。原 helper 实际 stage 2880 个文件，
摘要按既有 exclude 消费 2253 个文件；实际 stage 与最终候选均由原
`tools/upstream_manifest.py source_digest` 核得
`sha256:ae470872bfc63b972249045f75c5579765c1fb840e1dd545ff8703efceccc0ec`。
前后路径和字节摘要一致；原 helper 已登记该 source 与新 artifact，未借旧包改摘要。

真正的安装包为
`/volumes/data/kailo/tmp/codex-delete-commit-candidate-20261002.KBSv5P/dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，
15,066,717 字节，uid/gid `1000:1000`、mode `0644`，SHA-256 为
`9aef4725e49e87daa4b52decc2ed69de14eb293aeaf2540d4a854e97f868970b`。
Desktop 类型/Vite 已通过；真正 Windows MSVC release 编译完成（9m48s），
本体是 `target/x86_64-pc-windows-msvc/release/buzz-desktop.exe`。
NSIS 插件 hash 验证、`Target: x64`、真实 `makensis` 与 `Finished 1 bundle` 均有原日志。
`file` 报 I386 是 NSIS bootstrap，不把它当作本体架构；PE Security Directory 两字段为零，
原 cross-platform experimental、跳过签名、dead-code 和 chunk 警告保留。

实际镜像内工具为源树 Rust 1.95.0、pnpm 11.4.0、固定 `cargo-xwin 0.23.1 --locked`，
xwin 完成标记记载 MSVC CRT 14.44.17.14 与 Win11 SDK 10.0.26100。
沿用[官方 Tauri NSIS 交叉打包路径](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos)，
固定 cargo-xwin crate/锁来源原件仍在上一节 `windows-official-route.md`；未安装宿主 SDK。
APT/Rust/cargo-xwin/pnpm 实测分别为 849.6/128.3/175.9/369.0 秒，warm builder 不保证
工具层命中。与 Relay 按本轮明确批准共享同一个 8 CPU/16 GiB 父 BuildKit cgroup，
不是各分一份限额；实际 `memory.swap.max=max`，主机无 swap，不称硬 swap 0。
Windows 终态时父 cgroup 的 max/oom/oom_kill 计数均为 0。

全部原件位于 `/volumes/data/kailo/tmp/codex-unified-web-win-build-20261002.0VQIcC`：
`windows-build.log`、`tmp/build-desktop-client.V0IYsn.log`、`windows-build-exit-receipt.txt`、
`windows-original-build-context.tar`、`windows-actual-stage-source-proof.json`、
`final-source-record-proof.json`、`actual-xwin-sdk-crt-DONE.txt`、
`windows-installer-pe-signature.log` 与 `actual-shared-builder-at-windows-terminal.log`。
两处已有 Desktop trace 只同步真实新 artifact digest，不改 status/gate。
这个包是 unsigned 开发测试安装包，不是 signed release；没有在 Win11 安装、启动、
登录或验收 clipboard、keyring、协作功能，不把构建 0 或 Linux 历史证据当 Windows 运行验收。

## 2026-10-02 21:41 UTC：上一批 Agent 共源 Win11 测试包实际构建

本节补记已发生的正式原 helper 结果，不能用下节历史下载失败继续表示
所有 Windows 构建均阻断。输入是上一批 `fc0c2e0d…` 的 Agent 共用页面与
合同，不包含后续 Automation 页面；2254 个真实输入的前后 source 均为
`sha256:6113ccd288f87488fd8dc8e4ac09e6baa96e007dc3917995ad69f5013b891143`。
原 `tools/build-upstream.sh desktop-client` 的类型/Vite、Windows MSVC、
cargo-xwin 与 NSIS 全部实际退出 0，工具链与 recipe 沿已有锁和容器。

真正产物位于
`/volumes/data/kailo/tmp/codex-current-win11-20261002.PjUMXE/apps/dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，
15,071,240 字节，SHA-256 为
`e7e1c79450d804033ec4e9db03d51e19c514637990656ad4686ebf6c7c9de656`。
原 helper 日志同目录上层 `helper.log` 的 SHA-256 为
`cdd355923b9949d19cb0b25e297bf3f879572accca243b5a1392eb1c376a60fd`；
原构建日志 `/volumes/data/kailo/tmp/build-desktop-client.wVh5Jy.log` 的 SHA-256 为
`906d17d58858a515f219da0c4b7de7a81d622b97b659b1073e1cedb0f0872342`。
本包是 unsigned Win11 x64 开发测试包，没有签名、安装、启动或设备业务验收。
本批 Automation 合同改变后，旧包的 source 不能冒充当前 Desktop source；
没有把旧 artifact 填入本批来源登记，也未据此提高 Stage/生产完成状态。

## 2026-10-02 历史记录：AgentVersion 契约变更后的 Windows 构建失败

选定输入 `/volumes/data/kailo/tmp/codex-agent-version-selected-20261002.7p1PX8` 的
Desktop 当前真实 source 为
`sha256:9255e0e8ff3d8764973770ee1cc7598a84fd1e6d89977c4614eb6d8f98f051a7`，
仍由原来源算法消费 2253 个输入文件。原 `bash tools/build-upstream.sh desktop-client`
session `99519` 实际退出 1：类型/Vite 与第二轮 MSVC CRT 获取已完成，但 Cargo
无法下载 `https://index.crates.io/2/h2`（锁定 `reqwest 0.13.4` 的依赖），
重试后仍报 `[28] Timeout was reached`。原 Tauri Windows MSVC/NSIS 入口失败，
未导出新的安装包；没有改配方、依赖、签名要求或门禁来迎合此次失败。

完整原 helper 日志为
`/volumes/data/kailo/tmp/codex-agent-version-client-artifacts-20261002.ZqqCat/win-helper.log`，
SHA-256 `4c05c2a7190660d51d74fe936e0c2093022a546c96d209aa0c65ce02f6a2ff1f`；
原 BuildKit 日志为同目录 `build-desktop-client.I4wlez.log`，SHA-256
`b6e57a8b69f2907ea109de718e1777be43eeab6dd4725c86dfcc018f7b2fd08d`。
Web/Desktop 联合 2308 个输入的前后清单字节完全一致，清单 SHA-256 为
`ebc901ae66b3125dd41f8d1bb88df650cc0117a6bfef134fe72bbde6e8208177`。

旧 `9aef4725e49e87daa4b52decc2ed69de14eb293aeaf2540d4a854e97f868970b`
包仍属上节 `ae470872…ccc0ec` 来源，不匹配当前 `9255e0e8…051a7`；
15,066,717 字节的原包及历史验证保留，额外原字节备份位于上述日志目录的
`dist-before/Kailo_0.5.23_x64-setup.exe`。因此当前 Desktop artifact 真实登记为
`blocked`，`source_digest` 与 `artifact_digest` 均为 `none`；两处既有追溯仅移除
无效的 Desktop 发布条目，不改 routes/actions/surfaces 或提升任何能力状态。
尚无与当前来源匹配的 Win11 测试安装包，更没有 Win11 安装运行验收或 signed release。
