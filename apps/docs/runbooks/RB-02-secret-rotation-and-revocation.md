# RB-02 Secret 轮换与紧急撤销

`07-运行与运维基线.md` §6 第 2 项。轮换与撤销的规则以 `DD-70` 与 `.design/09` 的 key revoke/rotate 行为准。

## 适用范围

当前拓扑里的四类凭据，处置能力各不相同：

| 凭据 | 持有与投递 | 轮换 | 紧急撤销 |
|---|---|---|---|
| Core 的 OpenBao AppRole `secret_id` | `secrets/openbao_core_secret_id` → `secrets/openbao-core.env` | 可执行（步骤 A） | 可执行（步骤 A 第 5 步与步骤 C） |
| 服务 OIDC client secret（Core、Worker、Browser 网关） | IdP 登记，`secrets/*_client_secret` → 派生的 `secrets/*.env` 与 realm 渲染 | 可执行（步骤 B） | 可执行（步骤 B，旧值立即失效） |
| 原生设备的 CLIENT 公钥 | 私钥只在设备上 | 不适用：换私钥就是换设备公钥，重新登记即可 | 可执行（步骤 D），执行点是 Relay roster（`DD-75`） |
| Core 托管的 Nostr 私钥（HUMAN 的 SERVER key、Tenant CONTROL）、RelayOperatorIdentity | OpenBao KV v2，binding 钉版本 | 不可执行，见「不可执行的动作」第 1 条 | 仅部分遏制，见同条 |

「在途执行」对前两类的含义：已签发的访问令牌在其有效期内仍然有效（OpenBao service token 最长 1 小时，IdP 令牌按 realm 配置）。轮换不回收已签发令牌；需要立即失效时执行步骤 C。

## 触发信号

- 例行轮换周期到达；
- 凭据出现在不该出现的地方：日志、链路属性、工单、命令行历史、镜像层、版本库；
- OpenBao audit 日志出现非预期的取用或登录（`/openbao/data/audit.log` 中不属于 Core 或 Worker 的 `auth/approle/login`）；
- 设备丢失或员工离职时本人或管理员报告。

## 判定依据

1. 泄漏范围按凭据类别判定，取上表对应行。怀疑即按泄漏处理：凭据是否被使用无法从外部证伪。
2. 泄漏的是 Core 托管的 Nostr 私钥或 operator 私钥时，按「不可执行的动作」第 1 条处理，不套用前两类的步骤。
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

## 不可执行的动作

1. **Core 托管的 Nostr 私钥与 operator 私钥没有产品内的轮换或撤销入口。** `.design/09` 规定的顺序（停签 → 关连接 → 新 pubkey 与新 binding version → roster 换人并查证 → 旧 binding 留 `REVOKED` 历史；CONTROL 另需带 expected-owner CAS 的 owner 转移）属于 Stage 2 的完整 SecretRef 生命周期（`02-纵向交付路线.md` §4）。在此之前：
   - 不手工改 `buzz_identity_binding` 的公钥、版本或 SecretRef，不直接向 Relay 发 roster 事件——它们是 Core 签发并查证的投影；
   - 能做的遏制只有一件：对泄漏的 KV 版本执行 `delete`（可 `undelete` 回滚，不用不可逆的 `destroy`，`DD-70`）。此后 Core 读不到该版本，一切经 BFF 的代签 fail closed。它**不能**阻止持有私钥者直连 Relay 发布——该 pubkey 仍在 roster 上。按 P1 升级给实施工程负责人。
2. 不 `destroy` 仍被任何 binding 钉住的 KV 版本：SecretRef 不可读时 binding 不得 active，销毁即永久失效（`07` §1 的 `max_versions` 一行）。
3. 不把 secret 写进 `.env`、compose 文件、命令参数或 `docker -e`；不在工单或聊天里传递明文。
4. 不在轮换后跳过第 4 步的实际动作核验，只凭容器 `Up` 判定成功——容器能起来不代表凭据被接受。

## 完成判据

- 新凭据经实际动作核验可用，旧凭据经同一探针核验被拒；
- 派生文件与 realm 渲染已由 `bootstrap.sh` 重新生成；
- 需要立即失效时，步骤 C 已执行；
- 对「不可执行的动作」第 1 条的情形：泄漏版本已 `delete`，升级已登记。

## 演练记录

2026-09-23，本地拓扑，基于 commit `395855e` 之上的工作树：

1. **AppRole `secret_id`（步骤 A）**：记录旧 accessor → 签发新值 → 重建 `core-bff`（`Up`）→ 销毁旧值 → 新值登录成功、旧值登录被拒。随后 `web_transport` 6 项全部通过，Core 以新凭据从 OpenBao 取私钥代签。
2. **Worker client secret（步骤 B）**：IdP 重新生成 → `bootstrap.sh` 重新派生 → 重建 Worker。新值换令牌 HTTP 200，旧值 HTTP 401；`membership_lifecycle` 通过，Worker 以新凭据完成 SpiceDB、Relay roster 与 Core 三处投影。
3. **派生文件的教训是演练中真实撞到的**：此前一次只还原了 operator 密钥文件而没有重新派生，Relay 重建后读到另一把公钥，Core 建 Community 全部 `403 not a relay operator`。`bootstrap.sh` 重新派生后恢复。步骤 B 第 2 步的警告由此而来。
4. **设备撤销（步骤 D）**：`native_client` 用例撤销已登记设备后，该设备直连 Relay 发布被拒，同一人的 Web 身份照常发布（`core/verify/native-identity.md`）。
5. **回收令牌（步骤 C）**：执行 revoke-prefix 后立即让 Core 代签一次（`web_transport` 的发布用例通过）。OpenBao audit 日志依次记录 `17:34:39 sys/leases/revoke-prefix/auth/approle/login` 与 `17:34:41 auth/approle/login`——Core 的旧令牌被回收，它以新 `secret_id` 重新登录。
6. 演练前把 `openbao-init.sh` 与 `seed-secret-ref.sh` 中 root token 与解封分片经 `docker -e` 或参数传递的写法全部改为 stdin；以封存 OpenBao 后重跑 `openbao-init.sh` 核验解封路径（`sealed: True` → `sealed: False`）。
