# RB-02 Secret 轮换与紧急撤销

`07-运行与运维基线.md` §6 第 2 项。轮换与撤销的规则以 `DD-70` 与 `.design/09` 的 key revoke/rotate 行为准。

## 适用范围

当前拓扑里的四类凭据，处置能力各不相同：

| 凭据 | 持有与投递 | 轮换 | 紧急撤销 |
|---|---|---|---|
| Core 的 OpenBao AppRole `secret_id` | `secrets/openbao_core_secret_id` → `secrets/openbao-core.env` | 可执行（步骤 A） | 可执行（步骤 A 第 5 步与步骤 C） |
| 服务 OIDC client secret（Core、Worker、Browser 网关） | IdP 登记，`secrets/*_client_secret` → 派生的 `secrets/*.env` 与 realm 渲染 | 可执行（步骤 B） | 可执行（步骤 B，旧值立即失效） |
| 原生设备的 CLIENT 公钥 | 私钥只在设备上 | 不适用：换私钥就是换设备公钥，重新登记即可 | 可执行（步骤 D），执行点是 Relay roster（`DD-75`） |
| Web 托管的 HUMAN 私钥（`custody=SERVER`） | OpenBao KV v2，binding 钉版本 | 可执行（步骤 E：先撤后建） | 可执行（步骤 E 第 2 步），执行点是 Relay roster |
| RelayOperatorIdentity 私钥 | `secrets/relay_operator_private_key` → `secrets/core-service.env`，Core 写入 OpenBao KV v2 | 可执行（步骤 F） | 可执行（步骤 F 第 5 步：移出 Relay allow-list） |
| Tenant CONTROL 私钥 | OpenBao KV v2，binding 钉版本 | 不可执行：GAP-BUZ-01，见「不可执行的动作」第 1 条 | 仅遏制，见同条 |

「在途执行」对前两类的含义：已签发的访问令牌在其有效期内仍然有效（OpenBao service token 最长 1 小时，IdP 令牌按 realm 配置）。轮换不回收已签发令牌；需要立即失效时执行步骤 C。

## 触发信号

- 例行轮换周期到达；
- 凭据出现在不该出现的地方：日志、链路属性、工单、命令行历史、镜像层、版本库；
- OpenBao audit 日志出现非预期的取用或登录（`/openbao/data/audit.log` 中不属于 Core 或 Worker 的 `auth/approle/login`）；
- 设备丢失或员工离职时本人或管理员报告。

## 判定依据

1. 泄漏范围按凭据类别判定，取上表对应行。怀疑即按泄漏处理：凭据是否被使用无法从外部证伪。
2. 泄漏的是 Web 托管的 HUMAN 私钥时执行步骤 E；operator 私钥执行步骤 F；CONTROL 私钥按「不可执行的动作」第 1 条处理。
3. 是否需要回收已签发令牌：凭据落入的位置是否可被他人读取。只是例行轮换时不回收。

## 可执行步骤

**A. 轮换 Core 的 AppRole `secret_id`**（`deploy/local`，令牌与 secret 只经文件与 stdin）：

1. 记下旧 `secret_id` 的 accessor：以 root token 调 `auth/approle/role/kailo-core/secret-id/lookup`，`secret_id` 以 `secret_id=-` 从 `secrets/openbao_core_secret_id` 经 stdin 传入。
2. 签发新 `secret_id`：`write -f -field=secret_id auth/approle/role/kailo-core/secret-id`，先写临时文件，非空再覆盖 `secrets/openbao_core_secret_id`。
3. 重写 `secrets/openbao-core.env`（`OPENBAO_ROLE_ID`、`OPENBAO_SECRET_ID`），`docker compose up -d --force-recreate core-bff`。
4. 确认 Core 以新凭据取得 secret：`core-bff` 为 `Up`，且一次需要 Core 代签的动作成功（`cargo test -p kailo-core --test web_transport`，它让 Core 从 OpenBao 读取 HUMAN 私钥签名）。
5. 销毁旧 `secret_id`：`write auth/approle/role/kailo-core/secret-id-accessor/destroy secret_id_accessor=<第 1 步的值>`。
6. 以同一探针正反两面核验：新 `secret_id` 登录 `auth/approle/login` 成功，旧的被拒。

root token 调用的写法见 `deploy/local/openbao-init.sh` 的 `run_bao`：令牌作为 stdin 第一行进入容器，不进 `-e`、不进参数。

**B. 轮换服务 OIDC client secret**（以 Worker 为例，其余同形）：

1. 以 IdP 管理员身份（口令经 `--data-urlencode password@secrets/keycloak_admin_password` 从文件读入）调 `POST /admin/realms/<realm>/clients/<client uuid>/client-secret`，响应里的新值直接写入 `secrets/kailo_worker_client_secret`。旧值此刻即失效。
2. `bash bootstrap.sh` 重新派生 `secrets/worker.env` 与 realm 渲染——**只替换密钥文件而不重新派生，运行中的服务与下次导入的 realm 会各持一个值**。
3. `docker compose up -d --force-recreate worker`。
4. 核验：新值换取令牌 HTTP 200，旧值 HTTP 401；一条真实 Workflow 跑完（`cargo test -p kailo-core --test membership_lifecycle`）。

**C. 回收已签发的 OpenBao 令牌**：在步骤 A 之后，以 root token 对平台 namespace 执行 `bao lease revoke -prefix auth/approle/login`（即 `sys/leases/revoke-prefix/auth/approle/login`，`DD-70` 的 `RevokePrefix`）。Core 下一次取 secret 时收到 403，按既有逻辑用新 `secret_id` 重新登录。

**D. 撤销一台原生设备**：本人或管理员在 Web「设备」页撤销，或 `DELETE /api/v1/identity/client-keys/{pubkey}`。binding 进入 `REVOKING`，`BUZZ_IDENTITY_PROJECTION` 把该公钥移出全部 roster 后 `REVOKED`。进行中可见于 `kailo.entity.nonterminal{entity="buzz_identity_binding",state="REVOKING"}`；Relay 不可达时 Workflow 按轮等待而不失败（RB-03）。

**E. 轮换或撤销一个 Web 托管的 HUMAN 身份**（`.design/09` 的 key revoke/rotate 行；`apps` 目录下 `. core/verify/integration-env.sh` 后执行，令牌取法同 RB-01 第 7.3 步）：

1. 记录准入：与 RB-01 第 7.2 步同一条语句，`target_id` 是该身份的 Principal，`action_key` 分别为 `identity.key_revoke` 与 `identity.key_provision`，每个动作一条 ActionExecution。
2. revoke：`POST $CORE_SERVICE_URL/service/v1/identities/server-keys/revoke`，body `{"pubkey":"<旧 pubkey>","actionExecutionId":"<id>"}`。`200` 时 binding 已是 `REVOKING`：Core 立即停签（Web 发言 `403`），已建立的 BFF 流在 `BFF_STREAM_READMIT_SECONDS` 内以 `identity-revoked` 关闭（Relay 先移出 roster 时是 Relay 自己关订阅）。Workflow 移出 relay 与全部 Channel roster 后 binding `REVOKED`。`409` 是该身份不是 Web 托管的 HUMAN（CLIENT 走步骤 D，CONTROL 见 GAP-BUZ-01）或不在 `ACTIVE/RECONCILING`；`503` 以同一 `actionExecutionId` 重发。只需要紧急撤销时到此为止。
3. 重建：binding `REVOKED` 后 `POST $CORE_SERVICE_URL/service/v1/identities/server-keys/provision`，body `{"principalId":"<Principal>","actionExecutionId":"<另一条 id>"}`。Core 生成新私钥写入同一 locator 的新 KV 版本，新 binding 投入 relay 与此人全部 ACTIVE Channel 后 `ACTIVE`。仍有非 `REVOKED` 的 SERVER binding 时回 `409`：每人至多一条（`DD-77`），先撤后建。
4. 核验：新 pubkey 与旧不同，SecretRef 同 locator、版本 +1；Web 发言恢复且作者是新 pubkey；持旧私钥直连 Relay 发布被拒；`audit.audit_event` 各有一条 `identity.key_revoke=REVOKING` 与 `identity.key_provision=RECONCILING`。用户需要刷新页面：流在撤销时已关闭，重连会得到 `403` 直到重建完成。

**F. 轮换 RelayOperatorIdentity**（部署动作，不经 Workflow；`.design/09` 的 RelayOperatorIdentity rotate 行）：

1. 退役旧 key：`mv secrets/relay_operator_pubkey secrets/relay_operator_pubkey.retiring`，私钥同样改名为 `.retiring`。
2. `bash bootstrap.sh`：生成新密钥对，`buzz-relay.env` 的 `RELAY_OPERATOR_PUBKEYS` 为「新,旧」并列，`core-service.env` 投递新私钥。
3. `docker compose up -d --force-recreate buzz-relay`，待 `/_readiness` 为 200 后 `docker compose up -d --force-recreate core-bff`。Core 启动时先以新 key 签一次只读 operator 请求：被 Relay 拒绝即拒绝启动（日志末行给出原因），库与 OpenBao 均未改动——第 3 步顺序颠倒时正是这个结果。查证通过后写新 KV 版本，以旧 pubkey 为 CAS 原地推进 identity，写 `relay_operator.rotate=ROTATED` 审计，日志 `RelayOperatorIdentity 已轮换`。
4. 核验新 key 被接受：`cargo run -p kailo-core --example operator_probe -- ../deploy/local/secrets/relay_operator_private_key`（在 `core/` 下）输出 `ACCEPTED`，且能建立 Tenant（`cargo test -p kailo-core --test scope_lifecycle tenant_and_workspace`）。
5. 关闭窗口：删除 `secrets/relay_operator_pubkey.retiring`，`bash bootstrap.sh`，重建 `buzz-relay`。以同一探针对 `.retiring` 私钥得到 `REJECTED 403`，再删除该私钥文件。OpenBao 里的旧 KV 版本保留（第 2 条）。

## 不可执行的动作

1. **Tenant CONTROL 私钥没有轮换或撤销入口（GAP-BUZ-01）。** Channel owner 只能由现任 Channel owner（旧 CONTROL）签发 9000 授予，而 Kailo 的 Relay 只接受 Community owner 签发的 9000/9001（`SF-BUZ-42`、`DD-80`），所以移交必须由旧私钥在 Community 转移之前完成——泄漏时持钥者可以抢先移除新 CONTROL。`server-keys/revoke` 对 CONTROL 回 `409`。泄漏时：
   - 不手工改 `buzz_identity_binding` 的公钥、版本或 SecretRef，不直接向 Relay 发 roster 事件——它们是 Core 签发并查证的投影；
   - 能做的遏制只有一件：对该 CONTROL SecretRef 所钉的 KV 版本执行 `delete`（可 `undelete` 回滚，不用不可逆的 `destroy`，`DD-70`）。此后 Core 读不到它，该 Tenant 的建立、成员与设备投影全部 fail closed。它**不能**把持钥者移出 Community 或 Channel。按 P1 升级给实施工程负责人。
2. 不 `destroy` 仍被任何 binding 钉住的 KV 版本：SecretRef 不可读时 binding 不得 active，销毁即永久失效（`07` §1 的 `max_versions` 一行）。
3. 不把 secret 写进 `.env`、compose 文件、命令参数或 `docker -e`；不在工单或聊天里传递明文。
4. 不在轮换后跳过第 4 步的实际动作核验，只凭容器 `Up` 判定成功——容器能起来不代表凭据被接受。

## 完成判据

- 新凭据经实际动作核验可用，旧凭据经同一探针核验被拒；
- 派生文件与 realm 渲染已由 `bootstrap.sh` 重新生成；
- 需要立即失效时，步骤 C 已执行；
- 步骤 E：旧 binding `REVOKED`、新 binding `ACTIVE`，持旧私钥直连发布被拒；步骤 F：新 key `ACCEPTED`、旧 key `REJECTED 403`，allow-list 不再含旧 pubkey；
- 对「不可执行的动作」第 1 条的情形：泄漏版本已 `delete`，升级已登记。

## 演练记录

2026-09-23，本地拓扑，基于 commit `395855e` 之上的工作树：

1. **AppRole `secret_id`（步骤 A）**：记录旧 accessor → 签发新值 → 重建 `core-bff`（`Up`）→ 销毁旧值 → 新值登录成功、旧值登录被拒。随后 `web_transport` 6 项全部通过，Core 以新凭据从 OpenBao 取私钥代签。
2. **Worker client secret（步骤 B）**：IdP 重新生成 → `bootstrap.sh` 重新派生 → 重建 Worker。新值换令牌 HTTP 200，旧值 HTTP 401；`membership_lifecycle` 通过，Worker 以新凭据完成 SpiceDB、Relay roster 与 Core 三处投影。
3. **派生文件的教训是演练中真实撞到的**：此前一次只还原了 operator 密钥文件而没有重新派生，Relay 重建后读到另一把公钥，Core 建 Community 全部 `403 not a relay operator`。`bootstrap.sh` 重新派生后恢复。步骤 B 第 2 步的警告由此而来。
4. **设备撤销（步骤 D）**：`native_client` 用例撤销已登记设备后，该设备直连 Relay 发布被拒，同一人的 Web 身份照常发布（`core/verify/native-identity.md`）。
5. **回收令牌（步骤 C）**：执行 revoke-prefix 后立即让 Core 代签一次（`web_transport` 的发布用例通过）。OpenBao audit 日志依次记录 `17:34:39 sys/leases/revoke-prefix/auth/approle/login` 与 `17:34:41 auth/approle/login`——Core 的旧令牌被回收，它以新 `secret_id` 重新登录。
6. 演练前把 `openbao-init.sh` 与 `seed-secret-ref.sh` 中 root token 与解封分片经 `docker -e` 或参数传递的写法全部改为 stdin；以封存 OpenBao 后重跑 `openbao-init.sh` 核验解封路径（`sealed: True` → `sealed: False`）。

2026-09-24，本地拓扑，基于 commit `62051fe` 之上的工作树：

1. **Web 托管 HUMAN 身份（步骤 E）**：`bash core/verify/drill-server-key-rotation.sh`。revoke 期间停掉 Worker，roster 移除无法推进：revoke `HTTP 200` 后 binding `REVOKING`、此刻发言 `HTTP 403`，已建立的流关闭帧 `data: identity-revoked`——此时关流的只有 Core 的再准入。恢复 Worker 后旧 pubkey `REVOKED`；重建 `HTTP 200`，同键重发返回同一 workflow ID、`runId` 为空；新 pubkey 与旧不同，SecretRef `platform/kv/buzz-human/<tenant>/<principal> v1 → v2`，轮换后发言 `HTTP 200`，审计 `identity.key_revoke=REVOKING, identity.key_provision=RECONCILING`。破坏核验：把再准入对签名身份的检查短路后重建 `core-bff`，同一演练的关闭帧为空；还原后恢复。`cargo test -p kailo-core --test server_keys` 另证持旧私钥直连 Relay 发布被拒、新消息作者是新 pubkey、对 CONTROL 回 `409`；破坏核验：去掉 `kind=HUMAN` 条件后该用例在 CONTROL 一步失败（`left: 200, right: 409`），还原后通过。
2. **RelayOperatorIdentity（步骤 F）**：`bash core/verify/drill-operator-rotation.sh`，真实轮换了本地拓扑的 operator key。破坏核验在第 1 步：Relay 仍是旧 allow-list 时启动 Core，日志末行 `新投递的 operator key 152b75… 未被 Relay 接受（Relay 拒绝: HTTP 403 …not a relay operator）`，进程退出，库中身份仍是 `b4e994… v1 kv1`。重建 Relay 后 Core 启动并轮换：`152b75… v2 kv2`，审计 `ROTATED` 带新旧两个 pubkey 与 KV 版本 2；窗口内新旧 key 均 `ACCEPTED`；以新 key 建 Tenant 通过；关闭窗口后新 key `ACCEPTED`、旧 key `REJECTED 403`。
