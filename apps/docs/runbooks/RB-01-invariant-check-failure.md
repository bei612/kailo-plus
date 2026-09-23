# RB-01 部署前置不变式校验失败

`07-运行与运维基线.md` §6 第 1 项。不变式本身以 `07` §1 为准，本文只写发现它被违反之后怎么做。

## 适用范围

当前部署拓扑（`deploy/local/compose.yaml` 的服务集合）中 `07` §1 登记的不变式：Buzz Relay、AgentGateway、OpenBao、Temporal、SpiceDB、IdP 与 Kailo BFF。`07` §1 中属于尚未部署组件的行（MCP audiences 与 RBAC 规则集）在这些组件进入拓扑前没有适用对象。

不变式在三个位置被检查，失败的表现各不相同：

| 检查点 | 覆盖的不变式 | 失败表现 |
|---|---|---|
| `tools/check.sh security`（部署前） | Relay 三个缺省即关闭的开关、`BUZZ_MEMBER_EVENT_KINDS` 与补丁构建；AgentGateway 每个 listener 的认证与身份 header 投影；OpenBao 的 `disable_mlock`、audit 块与 `-dev`；镜像按 digest；上游产物 digest 与 manifest 一致；SpiceDB schema 与设计逐字相等；无端口字面量 | 门禁 `FAIL` 并逐条列出服务与条款 |
| 进程启动 | Core 与 Worker 的全部必需配置、`BUZZ_RELAY_NATIVE_URL_TEMPLATE` 含 `{host}`、Temporal 与 OTLP 连接 | 容器 `Exited (1)`，日志末行是缺失或不合法的那一项 |
| Tenant 激活 | Relay 实际执行成员准入：NIP-11 的 `supported_nips` 含 `43`（`SF-BUZ-35`） | `TENANT_LIFECYCLE` 的 verify 步被拒（403 → `ADMISSION_DENIED`，不可重试），Workflow `FAILED`，Tenant 停在 `PROVISIONING` |

## 触发信号

- `tools/check.sh --full` 或 `tools/check.sh security` 输出 `FAIL`；
- `docker compose ps -a` 中 `core-bff` 或 `worker` 为 `Exited (1)`；
- 指标 `kailo.entity.stranded{entity="tenant"}` 大于 0，或 `kailo.entity.nonterminal{entity="tenant",state="PROVISIONING"}` 持续不降；
- Core 日志出现 `实体搁浅`，或 Worker 日志中 `VerifyTenantBuzz` 以 `ADMISSION_DENIED` 结束。

## 判定依据

1. 门禁 `FAIL`：输出里每一行都是「服务: 条款」，直接对应 `07` §1 的一行。不需要另行判断是否误报——每条检查都经过破坏后确认报错的核验。
2. 进程退出：`docker compose logs <服务> | tail -1` 给出缺失或不合法的变量名。它来自 `.env` 或 `secrets/` 下的投递文件，不来自代码默认值（代码里没有默认值）。
3. Tenant 激活被拒：以 Tenant 的 Community host 读取 Relay NIP-11：

   ```sh
   curl -s -H 'Accept: application/nostr+json' -H "Host: <community host>" \
     http://127.0.0.1:<relay 发布端口>/info | python3 -c \
     'import json,sys; print(43 in json.load(sys.stdin)["supported_nips"])'
   ```

   `False` 即 Relay 当前没有执行成员准入，原因只有两个：`BUZZ_REQUIRE_RELAY_MEMBERSHIP` 不为 `true`，或没有配置稳定的 relay 私钥（`SF-BUZ-35`）。

## 可执行步骤

1. 定位违反的条款：门禁输出、容器日志末行或 NIP-11 观察，三者之一。
2. 修正配置来源：
   - compose 条款：改 `deploy/local/compose.yaml`（或部署描述）中对应的值，使其等于 `07` §1 的要求；
   - 缺失变量：补到 `.env`；若是 secret，补到 `deploy/local/secrets/` 并由 `bootstrap.sh` 生成，不写进 `.env`、不上命令行；
   - Relay 成员准入：确认 `BUZZ_REQUIRE_RELAY_MEMBERSHIP: "true"` 且 `secrets/buzz-relay.env` 中有 relay 私钥。
3. 重新执行 `tools/check.sh security`，直到 `全部通过`。
4. 重建受影响的服务：`docker compose --env-file .env -f compose.yaml up -d <服务>`。
5. 进程类失败：确认 `docker compose ps` 为 `Up`，且日志没有再次出现同一行。
6. Tenant 激活类失败：重做第 3 步的 NIP-11 观察，得到 `True`。已经 `FAILED` 的那次 `TENANT_LIFECYCLE` 不会自己恢复：该 Tenant 停在 `PROVISIONING`，不获得任何协作能力（fail closed），它计入 `kailo.entity.stranded`。按「不可执行的动作」第 4 条升级处理。

## 不可执行的动作

1. 不以关闭门禁条款、在 `check.sh` 中加例外或把值改成「临时」来让部署继续——每一条都对应一种已经证实的 fail-open。
2. 不以代码默认值补缺失配置；Core 与 Worker 故意没有默认值。
3. 不在 Relay 成员准入未恢复前激活任何 Tenant，也不直接改 `projection.tenant_buzz_binding` 或 `identity.tenant` 的状态列——ACTIVE 的判据是对 Relay 的实际观察，改库等于伪造这次观察。
4. 已 `FAILED` 的 Tenant 建立没有产品内的重试入口：重试以新的实体版本与新 workflow ID 发起（`DD-48`），属于 Stage 2 的任务重试能力（`02-纵向交付路线.md` §4）。在此之前按缺陷升级给实施工程负责人，附上该 Tenant 的 ID、workflow ID 与 verify 被拒的日志；不手工改版本号或状态。

## 完成判据

- `tools/check.sh security` 输出 `全部通过`；
- 相关容器 `Up`，日志中没有同一条启动失败；
- 对每个在服务的 Community host，NIP-11 `supported_nips` 含 `43`；
- `kailo.entity.stranded{entity="tenant"}` 为 0，或非零部分已按不可执行动作第 4 条登记升级。

## 演练记录

2026-09-23，本地拓扑，基于 commit `395855e`：

1. **门禁**：把 `buzz-relay` 的 `BUZZ_REQUIRE_RELAY_MEMBERSHIP` 改为 `"false"`，`tools/check.sh security` 输出 `FAIL` 与 `buzz-relay: BUZZ_REQUIRE_RELAY_MEMBERSHIP 为 false，必须显式为 true`；还原后 `全部通过`。
2. **启动**：把 `.env` 的 `BUZZ_RELAY_NATIVE_URL_TEMPLATE` 改为不含 `{host}` 的固定地址并重建 `core-bff`，容器 `Exited (1)`，日志末行 `Error: "BUZZ_RELAY_NATIVE_URL_TEMPLATE 必须包含 {host}"`；还原后 `Up`。
3. **激活前观察**：Relay 以 `BUZZ_REQUIRE_RELAY_MEMBERSHIP=false` 重建后，`/info` 的 `supported_nips` 不含 `43`；还原并重建后含 `43`。这正是 Tenant 激活时 Core 读取并据以拒绝的那个值（`tenant_lifecycle.rs` 的 verify）。
