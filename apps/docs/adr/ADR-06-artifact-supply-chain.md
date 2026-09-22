# ADR-06：artifact registry、签名、SBOM 与 provenance

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

`00-实施总纲.md` Stage 0 第 7 项要求建立 secret 扫描、依赖与许可证清单、SBOM、artifact digest 与来源证明流程；退出条件要求每个发布单元可追溯到源码 commit、依赖锁与 digest。`06-工程基线规范.md` §1 的追溯记录里 `release.artifacts[].digest` 在 `exposure` 高于 `none` 时必填，§2 的 baseline manifest 要求 `artifact_digest` 与 `patch_series_digest`。

`04-上游适配与升级.md` 还有一条特殊要求：上游以 artifact 或镜像引入，其 `evidence_commit` 与 `implementation_base_commit` 的关系必须显式声明，构建期对二者不一致而 `base_divergence` 为 `none` 的情况失败。这意味着供应链工具必须能把「这个镜像由哪个 commit 加哪个 patch series 构建」变成可验证的断言，而不只是一行记录。

仓库远端为 `github.com/bei612/kailo-plus`，但尚无共享的镜像 registry。方案必须在只有本地 registry 时可运行，并在接入托管 registry 后不需要重新设计。

## 候选方案

**OCI registry 加 cosign 加 syft**：全部为独立工具，本地可跑（registry 用 `zot` 或 `registry:2`），接入远端后换 registry 地址即可，签名与 SBOM 流程不变。

**绑定某托管平台的内置能力**：省事，但会把供应链断言绑死在平台上，替换成本高。

**只记录 digest，不签名不出 SBOM**：满足 `06` §1 的字段要求，但无法回答「这个 digest 是谁构建的、依赖里有什么」，达不到 Stage 0 第 7 项。

## 决策

- **registry**：OCI registry。本地拓扑内跑一个自托管 registry，接入远端后改为托管 registry。镜像一律按 **digest** 引用，compose 与 manifest 中不出现可变 tag。tag 只作人类可读别名。
- **签名**：`cosign` 对每个镜像 digest 签名，**在出现共享 registry 时启用**。当前无共享 registry、无第二参与方、单机构建，本地密钥对的人工管理成本换不到任何可验证收益，因此 Stage 0 只做 digest、SBOM 与 provenance 三项（`00-实施总纲.md` Stage 0 第 7 项的字面要求）。接入托管 registry 并具备 GitHub OIDC 身份后直接启用 keyless 签名，跳过本地密钥阶段。签名启用后，部署前校验签名，验签失败拒绝启动。
- **SBOM**：`syft` 为每个镜像生成 SPDX 格式 SBOM，作为 OCI referrer 附到镜像 digest 上。依赖与许可证清单由 SBOM 派生，不单独维护第二份。
- **provenance**：构建时生成 SLSA provenance 断言，至少记录源码 commit、依赖锁文件的摘要、构建参数与构建者身份，同样作为 referrer 附到 digest。
- **上游 patch 的可验证性**：`06-工程基线规范.md` §2 的 `patch_series_digest` 由 patch 文件内容的规范化摘要计算，写入 provenance 断言。构建上游镜像时重新计算并比对，不一致即失败。这把「`evidence_commit` 与 `implementation_base_commit` 关系已声明」从文档记录升级为构建期检查。
- **客户端发布单元按端分离**：Buzz Web 是 OCI 镜像，按 digest 引用、改 digest 即回退。Buzz Desktop 与 Buzz Mobile 是平台分发产物（桌面安装包、应用商店包），其回退是发布新版本而非更换 digest，因此这两端各自维护一条带平台签名的发布链，且必须登记「当前最低可用版本」以便在缺陷版本流出后强制升级。三者共用同一 `contracts/` 版本号与同一份 provenance 格式。
- **Buzz Desktop 的编译 feature 进 provenance**：`system-keyring` 等影响安全边界的 Cargo feature 必须写入 provenance 断言并在发布前校验，依据是 `SF-DSK-02`——该 feature 关闭时 nsec 回落为 `0o600` 明文文件，且这是编译期开关，运行时无法纠正。
- **secret 扫描**：提交与构建两个时点各扫描一次，命中即失败。扫描范围含 `contracts/`、compose 文件与 ADR 目录。

## 后果

正面：每个 digest 都能回答「谁构建的、从哪个 commit、依赖是什么、上游打了哪些 patch」；工具全部独立于托管平台，接入远端不需重新设计；SBOM 是依赖与许可证清单的唯一来源，不会分叉。

负面：本地阶段的签名密钥需要人工管理，直到接入 OIDC 身份为止；每次构建多出签名、SBOM 与 provenance 三步，构建时间上升；按 digest 引用意味着每次升级都要改引用处；两个原生端的回退受平台审核时延约束，与服务端回退不同步，缺陷响应必须依赖「最低可用版本」而非回滚。

锁定：OCI referrer 机制与 cosign 的签名格式。放弃：使用可变 tag 快速滚动的便利。

## 替换边界

接入远端托管平台后，若其内置能力能覆盖签名、SBOM 与 provenance 三项且可验证性不降低，重新评估是否收敛到平台内置流程。更换需要改动构建流水线的对应步骤与部署前的验签步骤，镜像内容与 digest 引用方式不受影响。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态。它不放宽 `04-上游适配与升级.md` 对固定 commit 与接缝登记的任何要求，也不使 `.references` 成为构建来源——上游仍以 artifact 或镜像引入。
