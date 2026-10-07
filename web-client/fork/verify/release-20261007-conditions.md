# 工作流条件与原版设置增量发布回执

2026-10-07 18:32 UTC 开发环境集中发布；不是生产就绪、全部页面验收或原版全量一致声明。

## 来源、范围与实际部署

固定 Buzz 基线为 `779af8886caae1317b4de962082429867ab61503`。原版路径、可解析符号、差异分类和四步影响结论见 [触发条件](../../../core/verify/workflow-trigger-conditions.md)、[缩放](settings-original-scale.md)、[通知纠偏](settings-notifications-original.md)。本次不改变设计合同、数据库结构或迁移，不放宽认证、scope、授权、额度与终态裁决。

| 产物 | 固定 Kailo 源 commit | 实际运行 digest |
|---|---|---|
| Core | `cbee1e07f77009e4cee27e5dad64d7ced6e01655` | `sha256:11584b7305f254ac867d61aee12e4665545f173904bd919ab28f8a7d31e26e62` |
| Worker | 同上 | `sha256:3c8175de164ea84a932fe1ecbec436e4b67c2af72c998868808cac63f123c4db` |
| Web | `1a8a3ae842d77c6d25b7b1260a15a770579eef06` | `sha256:d313fb1326cec59bcd4f3dc3b4785033026c43a438a41594895e6f57b5157e83` |

Web 真实构建 source digest 为 `sha256:a484ceeba47f06e572461060c2b12353cd4646654d02fd45c04308558ebd7642`，由原构建工具写回 upstream.yaml，不按后续脏工作树重算。随后 `f52b3157885df8947a3a5fd4e62a30e18d26c307` 的原定时频率界面已 push main，但不在本次镜像；其 87 项窄验证、五项反向破坏和双语生成见 [定时编辑器](../../../core/verify/workflow-schedule-fields.md)。源码前进不等于线上升级。

操作及证据目录：`/volumes/data/kailo/tmp/buzz-conditions-release-20261007.rjEksd/`。受限 BuildKit `kailo-core-data` 为 8 CPU、16 GiB memory/swap，复用 Data 缓存；运行前核对在途构建和内存压力。没有修改或执行 `.references`，没有反复重建同一批小改动。

- 原 `tools/release.sh` 退出 0；Core/Worker registry push 均退出 0，两个 provenance 实查 gitCommit 为上述 cbee；SBOM 与 provenance 在该目录 `apps/dist/`。
- 原 `tools/build-upstream.sh web-client` 退出 0，实际 Vite 构建 2.36s；原 virtua patch 应用成功。大 chunk 警告保留，不以删功能消除警告。
- `docker compose config --quiet` 通过；停止旧 Core/Worker writer 后，以 `start-core.sh --no-build` 取全新一次性 OpenBao wrapping 启动，再 `up -d --no-deps --no-build --wait worker buzz-web`。后两服务 Healthy，Core `/healthz` 200。
- 首次 start-core 在 gen-registry 因私有工作树缺少相邻 `.design` 而报 `IndexError: list index out of range`，没有继续投递。补只读设计目录引用后原命令通过，失败 `deploy.log` 与恢复 `deploy-restored.log` 均保留。未重跑初始化或迁移、未重建身份与配额。
- `containers-before.txt` 与 `containers-after.txt` 仅三个目标容器 ID 改变，其他 21 个平台容器未替换。实际启动时间为 Core `18:32:34.992984173Z`，Worker/Web `18:32:35Z`。
- 新 filter 不能由旧 Core 消费：回退旧 Core 前必须停用含 filter 的定义并对账在途执行，不能将 optional schema 当作旧执行器安全兼容；详见触发条件回执。

## 真实浏览器复核

使用 playwright-cli 的独立 `seam-verifier` 真实 SSO 会话，未 mock 请求、注入 session 或提交新工作流。入口为 `http://192.168.0.193:58090/app/`。重新登录后 `/app/platform-build-info.json` 为 200，buildId 与上述真实 Web source digest 相同。

- 通知：`notifications-live.png` 已打开视觉复核，单份原通知卡片及声音/提示音/角标布局存在，删除了非原版第二工作区通知块。浏览器通知权限为拒绝，页面如实显示，不记投递通过。
- 外观：`appearance-zoom-live.png` 已打开；真实键盘 Ctrl+= 后根字号由 16px 到 17.6px，Ctrl+0 恢复 16px。初次错误观察 `style.zoom` 得到空串，不作为失败或成功依据；原版使用根字号缩放。
- 表情：原 `/api/v1/custom-emoji` 带当前 workspace 的真实请求从旧 404 变为 200，空个人目录、上传和名称区域完整显示；`emoji-ready-live.png` 已打开。第一次 `emoji-live.png` 仍在加载，不用它作就绪证明。没有执行上传/发布，不称完整表情业务验收。
- 工作流：`workflow-basic-live.png`、`workflow-advanced-live.png` 已打开，原条件八操作符、基础/高级切换可操作。输入 `str_starts_with(trigger_text, "review")` 后 YAML 保留 `trigger.filter`，返回表单显示“开头是 review”；未提交，不产生外部任务。
- 作者候选来自真实目录，显示人名与独立 pubkey；同名项不按名字合并为同一身份，也不把候选数量当独立人类人数。
- 验证过程曾错误使用不存在的 `/api/v1/build-info`（404）、重复 main 的 strict locator 和作者 button locator；随后按真实路由和 DOM 复核。失败不是产品已通过的证据。

这些截图不是固定官方全部页面逐项对照，不覆盖 Windows 安装包或 Mobile。当前仍有原版设置、Projects 创建/终端、完整工作流、三组件完整业务及稳定多人多 Agent 的缺口。

## 收口边界

Core/Worker/Web 已部署不等于一期生产就绪。最近一次完整 `./tools/check.sh --full`（固定 `9f81195cc7b80ebee7c79eafb385a0a92b5120a5`）退出 1，原日志为 `/volumes/data/kailo/tmp/buzz-main-delivery-20261007.s3n2ml/full-9f811.log`：Core fmt/Clippy、追溯产物和上游来源一致性失败。Core 窄修复已通过；本次仅将真实新 Web 产物登记到现行追溯，并为 Projects 填入真实 Core/Web，保持其未完成 gate。其余来源差异没有伪造摘要消除。

本批未再次执行 full：Data 可用空间曾降至约 2 GiB，完整跟踪源码约 2.52 GB，尚不含依赖与验证写入。未清空缓存或业务数据腾空间；不是 full 退出 0。Windows/Mobile 没有新安装包或实机验收，三独立外部业务服务未在本次替换，不宣布全部集成完成。
