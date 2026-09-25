# RB-01 部署前置不变式校验失败

`07-运行与运维基线.md` §6 第 1 项。不变式本身以 `07` §1 为准，本文只写发现它被违反之后怎么做。

## 适用范围

当前部署拓扑（`deploy/local/compose.yaml` 的服务集合）中 `07` §1 登记的不变式：Buzz Relay、AgentGateway、OpenBao、Temporal、SpiceDB、IdP 与 Kailo BFF。`07` §1 中属于尚未部署组件的行（MCP audiences 与 RBAC 规则集）在这些组件进入拓扑前没有适用对象。

不变式在三个位置被检查，失败的表现各不相同：

| 检查点 | 覆盖的不变式 | 失败表现 |
|---|---|---|
| `tools/check.sh security`（部署前） | Relay 三个缺省即关闭的开关、`BUZZ_MEMBER_EVENT_KINDS` 与补丁构建；AgentGateway 每个 listener 的认证与身份 header 投影；OpenBao 的 `disable_mlock`、audit 块与 `-dev`；镜像按 digest；上游产物 digest 与 manifest 一致；SpiceDB schema 与设计逐字相等；无端口字面量 | 门禁 `FAIL` 并逐条列出服务与条款 |
| 进程启动 | Core 与 Worker 的全部必需配置、`BUZZ_RELAY_NATIVE_URL_TEMPLATE` 形如 `ws[s]://{host}[/path]`、Temporal 与 OTLP 连接；OpenBao 运行期的 audit device 清单非空 | 容器 `Exited (1)`，日志末行是缺失或不合法的那一项 |
| binding 推进到 ACTIVE | OpenBao 运行期的 audit device 清单非空（`DD-70`） | 该步回 503，Workflow 以 `CONVERGENCE_PENDING` 按轮等待；Core 日志 `OpenBao 没有启用任何 audit device：不把 binding 推进到 ACTIVE` |
| Tenant 激活 | Relay 实际执行成员准入：NIP-11 的 `supported_nips` 含 `43`（`SF-BUZ-35`） | `TENANT_LIFECYCLE` 的 verify 步被拒（403 → `ADMISSION_DENIED`，不可重试），Workflow `FAILED`，Tenant 停在 `PROVISIONING` |

## 触发信号

- `tools/check.sh --full` 或 `tools/check.sh security` 输出 `FAIL`；
- `docker compose ps -a` 中 `core-bff` 或 `worker` 为 `Exited (1)`；
- 指标 `kailo.entity.stranded{entity="tenant"}` 大于 0，或 `kailo.entity.nonterminal{entity="tenant",state="PROVISIONING"}` 持续不降；
- Core 日志出现 `实体搁浅`，或 Worker 日志中 `VerifyTenantBuzz` 以 `ADMISSION_DENIED` 结束；
- 指标 `kailo.tenant.without_effective_admin` 大于 0，或 Core 日志出现 `Tenant 没有有效 admin`（`DD-82` 的「有效 Tenant admin 不得为空」被打破：平台内的撤销路径都拒绝这一步，出现即是旁路改动 SpiceDB 或成员状态）。

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
   - Relay 成员准入：确认 `BUZZ_REQUIRE_RELAY_MEMBERSHIP: "true"` 且 `secrets/buzz-relay.env` 中有 relay 私钥；
   - OpenBao audit device：`openbao-config.hcl` 的 `audit "file" "file/"` 块恢复后重建 `openbao` 并执行 `openbao-init.sh`（解封并核验 `audit device 已生效`），再重建 `core-bff`。已在等待的 Workflow 下一轮自行继续，不需要重跑。
3. 重新执行 `tools/check.sh security`，直到 `全部通过`。
4. 重建受影响的服务：`docker compose --env-file .env -f compose.yaml up -d <服务>`。
5. 进程类失败：确认 `docker compose ps` 为 `Up`，且日志没有再次出现同一行。
6. Tenant 激活类失败：重做第 3 步的 NIP-11 观察，得到 `True`。已经 `FAILED` 的那次 `TENANT_LIFECYCLE` 不会自己恢复：该 Tenant 停在 `PROVISIONING`，不获得任何协作能力（fail closed），它计入 `kailo.entity.stranded`。原因修复后按第 7 步重跑。
7. **重跑搁浅实体**（Tenant、Workspace、Tenant/Workspace 成员通用；RB-03 的撤权搁浅同样走这里）。重跑创建新的 ActionExecution 与新的 Workflow，不改写旧 history（`.design/06` §9）；新 workflow ID 由实体版本 +1 得到（`.design/06` §3.1、`DD-48`），实体状态不变。在 `apps` 目录下 `. core/verify/integration-env.sh` 后执行：
   1. 找出驱动实体当前版本、已终结而未完成的那条 Workflow（`<表>` 取 `identity.tenant`、`identity.workspace`、`identity.tenant_membership` 或 `identity.workspace_membership`）：

      ```sh
      psql "$DATABASE_URL" -Atc "select w.workflow_id, w.action_execution_id, w.tenant_id, t.status from projection.workflow_ref w
        join projection.task_projection t using (workflow_id) join <表> e
          on split_part(w.workflow_id, ':', 4) = e.id::text and split_part(w.workflow_id, ':', 5) = e.version::text
        where e.id = '<实体 ID>' and w.projection_state = 'TERMINAL' and t.status <> 'COMPLETED'"
      ```

      没有行就不是搁浅：Workflow 还在跑（RB-03 第 1–2 步）、结果不明（RB-05 的 `UNKNOWN`）或已完成——这三种都不重跑。
   2. 记录这次重跑的准入。Stage 1 没有产品内的 Action 准入面，平台级生命周期动作（建 Tenant 本身也是）由平台运维以 Catalog Tenant 下自己的 `SERVICE` Principal 为发起方记录准入；`target_id` 必须是第 1 步返回的原 `action_execution_id`（Core 核对，不符即 403），不能填实体 ID。一条 ActionExecution 只能驱动一个业务 Workflow，它同时是这次重跑的幂等键：

      ```sh
      action=$(python3 -c 'import uuid;print(uuid.uuid4())')
      psql "$DATABASE_URL" -Atc "insert into admission.action_execution (id, operation_id, tenant_id, action_key, action_version,
        initiator_principal_id, actor_principal_id, target_id, parameter_hash, gate_state, dispatch_state, correlation_id)
        values ('$action', gen_random_uuid(), '<第 1 步的 tenant_id>', 'task.rerun', 1, '<运维 Principal>', '<运维 Principal>',
        '<第 1 步的原 action_execution_id>', '<第 1 步的 workflow ID>', 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())"
      ```

   3. 以 Worker 的 service 身份调用重跑入口，client secret 从文件读入：

      ```sh
      token=$(curl -sf -H "Host: $OIDC_TOKEN_HOST" "$OIDC_TOKEN_URL" --data-urlencode grant_type=client_credentials \
        --data-urlencode client_id="$OIDC_WORKER_CLIENT_ID" --data-urlencode "client_secret@deploy/local/secrets/kailo_worker_client_secret" \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
      curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
        "$CORE_SERVICE_URL/service/v1/tasks/rerun" -d "{\"workflowId\":\"<第 1 步的 workflow ID>\",\"actionExecutionId\":\"$action\"}"
      ```

      `200` 返回新的 `workflowId`；`409` 是旧 Workflow 不在可重跑的终态，或实体已不在它冻结的版本（有人先重跑过，回第 1 步重新定位）；`403` 是准入不成立；`503` 是结果不明，以**同一个** `actionExecutionId` 重发——同键重发回答同一个新 Workflow，不会第二次推进版本。
   4. 核验：实体到达目标状态（`ACTIVE` 或 `REVOKED`），新 Workflow `TERMINAL` 且 `COMPLETED`，旧 Workflow 仍是原来的终态；`audit.audit_event` 有一条 `result_code='RERUN_ACCEPTED'`，`evidence_refs` 同时指向新旧两个 workflow ID；`kailo.entity.stranded` 回落。
8. **Tenant 没有有效 admin**（`DD-82`、ADR-11）。先查清为什么变空：`audit.audit_event` 中该 Tenant 最近的 `ROLE_REVOKED`、`ROLE_REMOVED` 与成员 `REVOKED` 记录，以及 SpiceDB 上 `tenant:<id>#admin` 的现状。旁路改动须按 RB-02/RB-03 处置后再恢复。恢复只有一条路：以该 Tenant 的一位 `ACTIVE` 成员的 IdP subject 执行部署引导，它只在有效 admin 为空时写入一位（0→1）：

   ```sh
   docker compose --env-file .env -f compose.yaml exec -T core-bff kailo-core bootstrap-tenant \
     --slug <tenant slug> --name <显示名> --admin-subject <IdP subject> \
     --admin-display-name <显示名> --wait-seconds <秒>
   ```

   退出码 `0` 且输出 `COMPLETED` 即恢复；`4`（`INERT`）说明该 Tenant 此刻已有有效 admin，引导什么也没做；`3`（`PENDING`）以同一参数重跑。已撤权的人不能用引导恢复：成员恢复只经邀请签发、兑换与 Tenant admin 确认（`DD-83`），而没有有效 admin 时无人能签发邀请，所以先以一位现有 `ACTIVE` 成员完成 0→1。

## 不可执行的动作

1. 不以关闭门禁条款、在 `check.sh` 中加例外或把值改成「临时」来让部署继续——每一条都对应一种已经证实的 fail-open。
2. 不以代码默认值补缺失配置；Core 与 Worker 故意没有默认值。
3. 不在 Relay 成员准入未恢复前激活任何 Tenant，也不直接改 `projection.tenant_buzz_binding` 或 `identity.tenant` 的状态列——ACTIVE 的判据是对 Relay 的实际观察，改库等于伪造这次观察。
4. 不以 zed 或任何旁路直接写 `tenant#admin`/`workspace#admin`：角色只经角色动作与部署引导写入（`DD-82`），旁路写入会被角色对账以成员事实为准删掉，并留下没有准入依据的授权窗口。
5. 不手工改实体的版本号或状态，不用 Temporal CLI 以旧 workflow ID 重新启动或 reset 已终结的 Workflow：重跑只经第 7 步的入口，它在同一事务里推进版本、预写新 WorkflowRef 并写审计。拒绝原因没有修复就重跑，只会得到第二条以同样原因 `FAILED` 的 Workflow。

## 完成判据

- `tools/check.sh security` 输出 `全部通过`；
- 相关容器 `Up`，日志中没有同一条启动失败；
- 对每个在服务的 Community host，NIP-11 `supported_nips` 含 `43`；
- `kailo.entity.stranded{entity="tenant"}` 为 0：搁浅的 Tenant 已按第 7 步重跑并收敛；
- `kailo.tenant.without_effective_admin` 为 0。

## 演练记录

2026-09-23，本地拓扑，基于 commit `395855e`：

1. **门禁**：把 `buzz-relay` 的 `BUZZ_REQUIRE_RELAY_MEMBERSHIP` 改为 `"false"`，`tools/check.sh security` 输出 `FAIL` 与 `buzz-relay: BUZZ_REQUIRE_RELAY_MEMBERSHIP 为 false，必须显式为 true`；还原后 `全部通过`。
2. **启动**：把 `.env` 的 `BUZZ_RELAY_NATIVE_URL_TEMPLATE` 改为不含 `{host}` 的固定地址并重建 `core-bff`，容器 `Exited (1)`；还原后 `Up`。2026-09-24 该检查收紧为整个 authority 必须恰好是 `{host}` 后复演：以 `ws://{host}:8090` 启动 `core-bff`，日志末行 `Error: "BUZZ_RELAY_NATIVE_URL_TEMPLATE 必须形如 ws[s]://{host}[/path]"`，进程退出。
3. **激活前观察**：Relay 以 `BUZZ_REQUIRE_RELAY_MEMBERSHIP=false` 重建后，`/info` 的 `supported_nips` 不含 `43`；还原并重建后含 `43`。这正是 Tenant 激活时 Core 读取并据以拒绝的那个值（`tenant_lifecycle.rs` 的 verify）。

2026-09-24，本地拓扑，基于 commit `62051fe` 之上的工作树（新增重跑入口 `core/crates/kailo-core/src/task_rerun.rs`）：

1. **重跑搁浅实体（第 7 步）**：`bash core/verify/drill-task-rerun.sh`。在真实开通的 Tenant 下把 TenantBuzzBinding 暂置 `DISABLED` 后建立第二个 Workspace，`WORKSPACE_LIFECYCLE` 以 `ADMISSION_DENIED` 结束：`…:1 → FAILED；Workspace PROVISIONING v1`，搁浅计数 `1`。还原 binding 后按 7.1–7.4 逐条执行：定位查询返回唯一一行 `…:1|<原 ActionExecution ID>|<tenant>|FAILED`；重跑 `HTTP 200` 返回 `…:2`；同键重发 `HTTP 200` 返回同一个 `…:2`、`runId` 为空（未另起执行）；另一张准入重跑同一条旧 Workflow `HTTP 409`。核验：`Workspace ACTIVE v3`，新 Workflow `TERMINAL COMPLETED`，旧 Workflow 仍是 `TERMINAL FAILED`，`RERUN_ACCEPTED` 审计 `1` 条，搁浅计数 `0`。
2. **入口的拒绝面**：`cargo test -p kailo-core --test scope_lifecycle` 的 `stranded_workspace_is_rerun_with_new_version` 覆盖终结的固定 ID 再 Start 得 `409`、准入 target 指向别的实体得 `403`、`DENIED` 的准入得 `403`、无 service 令牌得 `401`、对 `COMPLETED` 的 Workflow 重跑得 `409`。破坏核验：把准入查询的 target 条件改为不核对后重建 `core-bff`，该用例在「target 指向别的实体」一步失败（`left: 200, right: 403`）；还原后 2 项全部通过。
3. **OpenBao audit device 的运行期观察**：从 `openbao-config.hcl` 删去 audit 块、重建 `openbao` 并解封，`openbao-init.sh` 输出 `audit device 未生效`。此时仍在运行的 `core-bff` 上跑 `cargo test -p kailo-core --test scope_lifecycle tenant_and_workspace`：Tenant 停在 `PROVISIONING`（`left: "PROVISIONING", right: "ACTIVE"`），Core 日志 6 次 `OpenBao 没有启用任何 audit device：不把 binding 推进到 ACTIVE`。随后重建 `core-bff`：`Exited (1)`，日志末行 `Error: "OpenBao 没有启用任何 audit device：取用不留痕，拒绝启动"`。还原 audit 块、重建并解封后 `audit device 已生效（声明式）`，`core-bff` `Up`，`scope_lifecycle` 2 项全部通过。

2026-09-24，本地拓扑，基于 commit `6ada92e` 之上的工作树：

1. **首位 admin 与 0→1（第 8 步）**：`role_management` 集成用例以部署引导建立 Tenant：`{"state":"COMPLETED"}` 退出码 `0`，zed 读到 `tenant#admin`；同一人重跑 `0`/`COMPLETED`；另一人 `4`/`INERT`，没有登记外部身份、没有成员关系。破坏核验：去掉 0→1 判定后重建 `core-bff`，另一人的引导得到 `COMPLETED`，用例在断言 `INERT` 处失败；还原后通过。
2. **角色对账**：旁路以 zed 写入已撤权者的 `tenant#admin`，三个对账周期内被删，留 `RECONCILIATION`/`ROLE_REMOVED` 审计。破坏核验：对账不删任何关系时用例超时失败；还原后通过。
