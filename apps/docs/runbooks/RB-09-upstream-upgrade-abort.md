# RB-09 上游升级中止与基线还原

`07-运行与运维基线.md` §6 第 9 项。升级流程以 `04-上游适配与升级.md` 与 `ADR-06` 为准：上游以固定 commit 加 patch series 构建，产物按 digest 引用，manifest 记录 `implementation_base_commit`、`patch_series_digest` 与 `artifact_digest`。

## 适用范围

当前拓扑中由本仓库构建或按 digest 引用的上游：`upstream-patches/` 下的 `buzz`（Relay 与 `buzz-admin`）、`buzz-web`、`agentgateway`、`temporal-sdk-go`，以及 compose 中按 digest 引用的其余上游镜像（Temporal、SpiceDB、OpenBao、Keycloak、Postgres、MinIO、Redis、OTel Collector）。

一次升级改变的是三处：manifest（commit、patch、两个 digest）、compose 的镜像 digest、`tools/traceability/` 中引用该产物的追溯记录。还原就是把这三处还原到升级前的提交，并按旧 digest 重新部署——**不重新构建**：旧 digest 在 registry 里，重新构建得到的是另一个产物。

## 触发信号

- 候选版本在升级验证中失败：`tools/check.sh --full`、`core/verify/run-integration.sh`、`core/verify/web-walkthrough.sh` 任一不通过；
- 候选版本上线后出现回归：本系列其他 runbook 的触发信号在升级之后首次出现；
- `tools/check.sh seam` 报 patch 目录与 `patch_series_digest` 不一致，或 `security` 报 digest 与 manifest 不一致（升级只做了一半）。

## 判定依据

1. 以升级前后的提交比对三处（manifest、compose、追溯记录），确认候选改了什么。
2. **门禁通过不等于行为正确。** `security` 与 `seam` 核对的是配置与摘要的一致性；一个丢掉了治理检查的候选，只要三处写得一致，这两步照样通过。行为只能由集成核验与走查证明——升级的放行判据必须包含它们。
3. 失败出现在候选引入的路径上，即判定为候选的回归，中止升级。

## 可执行步骤

1. **记录基线**：升级开始前记下当前提交与各产物 digest（`grep artifact_digest upstream-patches/*/baseline.yaml`）；确认这些 digest 在 registry 中可拉取。
2. **候选验证**（升级流程本身）：`tools/build-upstream.sh <project>` 构建并写回 manifest，更新 compose 与追溯记录中的 digest，部署候选，然后依次跑 `tools/check.sh --full`、`core/verify/run-integration.sh`、`core/verify/web-walkthrough.sh`。
3. **中止**：任一失败即中止。把 manifest、patch 目录、compose 与追溯记录还原到升级前的提交（`git checkout <基线提交> -- upstream-patches/<project> deploy/local/compose.yaml tools/traceability`，或放弃未提交的改动）。
4. **按旧 digest 重新部署**：`docker compose up -d <受影响的服务>`。compose 按 digest 引用，拉取的就是基线产物；不加 `--build`。
5. **核验还原**：`tools/check.sh security` 与 `seam` 通过；运行中的镜像 digest 等于 manifest 的 `artifact_digest`；重新跑第 2 步中失败的那一项，确认通过。
6. 候选的补丁工作树（例如 `/tmp/relay`）回到基线 commit，候选产物留在 registry 中供事后分析，不在 compose 中引用。

## 不可执行的动作

1. 不以「门禁通过」放行上游候选：见判定依据第 2 条。
2. 不在中止时从源码重新构建基线：重新构建的是另一份产物，digest 对不上 manifest，也不是经过核验的那一份（`ADR-06`）。
3. 不只还原 compose 而保留新 manifest（或反之）：`security` 会报 digest 不一致，且追溯记录会指向没有在运行的产物。
4. 不在候选与基线之间「挑着合」补丁：中止就是整体回到基线，修好的候选重新走完整个第 2 步。

## 完成判据

- 三处与升级前的提交一致；
- 运行中的镜像是基线 digest；
- `tools/check.sh --full` 通过，候选失败的那一项在基线上通过。

## 演练记录

2026-09-23，本地拓扑，以 Relay（`upstream-patches/buzz`）为对象：

1. **记录基线**：`artifact_digest` 为 `sha256:01927d94…`，manifest、patch 目录与 compose 复制留存。
2. **候选**：在补丁工作树上做一次「rebase 时丢掉了治理检查」的修订（`ingest.rs` 中 `governance::check_event_kind` 的调用被删掉），`tools/build-upstream.sh buzz` 构建出 `sha256:36d1d973…` 并写回 manifest，compose 两处 digest 同步更新后部署。
3. **门禁通过、行为失败**：`tools/check.sh security` 与 `seam` 均 `全部通过`；`kailo-buzz` 的 `members_cannot_govern_the_community` 失败——成员自建 Channel 被接受。据此中止。
4. **中止与还原**：还原 manifest、patch 目录与 compose，`docker compose up -d buzz-relay`（不构建），运行中的镜像回到 `sha256:01927d94…`；`seam` 通过，`kailo-buzz` 的 bridge 用例 4 项全部通过。补丁工作树回到基线提交。
