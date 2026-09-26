# SecretRef 解析核验

对应 `DD-70` 与 `.design/03` §9：SecretRef 只是 locator
（`<namespace>/<mount>/<path>` + KV v2 版本号 + audience），Core 把它换成内存里的
值，**不写数据库、不写日志、不落盘**。任何 binding 在其全部 SecretRef 指向的版本
可读、且该次读取已被 OpenBao audit 记录前不得 active。

夹具：`core/verify/seed-secret-ref.sh`（写两个版本；只有一个版本时
「取到的正是请求的那个版本」这条断言恒真，等于没验）。

## 值出不去，是类型挡住的

`SecretValue` 不实现 `Debug`/`Display`/`Serialize`，取用必须显式调 `expose()`。
这不只是约定：核验用例最初写的是 `expect_err`，编译器直接拒绝，因为
`expect_err` 要求 `T: Debug`。**连测试代码都没有把 secret 打进输出的口子**，
改成 `matches!` 才通过。

## 实测结果（2026-09-22）

`core/crates/kailo-secrets/tests/openbao.rs` 对运行中的 OpenBao 执行：

| 性质 | 结果 |
|---|---|
| 请求版本 1 与版本 2，分别取到 `v1` 与 `v2` | 通过。不取 latest——binding 冻结的是具体版本，取 latest 会让一次无关的轮换悄悄改变已 active 的 binding 行为 |
| audience 与本服务身份不符 | 通过，`AudienceMismatch`，且在发出任何网络请求之前就拒 |
| 请求不存在的版本 9999 | 通过，`VersionUnavailable`，不是「读到空值算成功」 |
| 策略之外的 mount | 通过，读不到。守的是「凭据的能力等于策略」，不是「代码里没写过那条路径」 |

## audit 确实记录了取用

`DD-70` 要求「该次读取已被 OpenBao audit 记录」。复核 `/openbao/data/audit.log`：
上述取用共命中 22 条 request/response 记录，其中也包括那次越界读取
（`not-a-mount/data/verify/secret-ref`，response 带 error）。

值不在日志里：审计条目中的敏感字段是 `hmac-sha256:...`，明文 `v1`/`v2` 未出现。

## 版本保留不是无限的

KV v2 默认只保留 10 个版本，超出的静默删除。核验夹具每跑一次写两版，跑到第 18
版时最旧可读版本已经是第 9 版——用例断言「版本 1 可读」于是失败。

这不是测试的问题，是一条真实的运维边界：SecretRef 钉的是具体版本，被裁掉的版本
永远读不回来，而 SecretRef 不可读时 binding 不得 active（`DD-70`）。一个还在用的
binding 会因为别处的几次轮换而永久失效。已把 `max_versions` 显式设定写进
`07` §1，并由 `openbao-init.sh` 落到 mount 配置上。

用例也改为断言夹具**本次**写入的两个版本号，不再假设它们是 1 和 2。

## 最小权限

Core 的策略只给登记 mount 的 `create/update/read`（data）与 `read/list`（metadata），
**不给 `delete`/`destroy`**。secret 的撤销是受治理动作，不是运维旁路；真要撤销时
显式扩策略，而不是一开始就把能力留在那里。

AppRole 换取的 token 是短 TTL（20 分钟，上限 1 小时），Core 不持有长期凭据。

## 引导自检失败后的令牌回收（2026-09-26）

`AppRoleSession::connect` 在首次登录后、单次使用自检成功前不再发布 service token 到内存 lease。若 role 错配导致同一 `secret_id` 第二次仍可登录，先以各自的 token 调 OpenBao `PUT auth/token/revoke-self` 撤销额外与首次签发的两枚令牌，再以 `SecretIdReusable` 拒绝启动；首次响应缺少 renewable/有效 lease、或自检请求失败时，同样尝试撤销首次令牌。撤销失败不被吞掉：返回 `RevocationUnconfirmed`，Core 不进入 serving，运维按 RB-02 步骤 C 处置，不能把“请求已发出”当作“令牌已撤销”。

定向 `cargo test -p kailo-secrets reusable_secret_id_revokes_both_issued_tokens`：1/1 通过，模拟可重复登录时观察到两次独立撤销请求和空 lease。临时移除首次令牌撤销后，同一用例以“收到 5 次请求，应为 6 次”失败（退出码 101）；恢复后 1/1 通过。真实 OpenBao 的正常单次投递路径由 `seed-secret-ref.sh` 加 `cargo test -p kailo-secrets --test openbao` 再验，1/1 通过。反向用例验证的是撤销请求与 fail-closed，不把 mock HTTP 200 冒充真实 OpenBao 已撤销的网络证据。

## 启动后失败及停服时的令牌回收（2026-09-26）

Core 在首次平台 AppRole 登录成功后，把后续 audit 登录、audit device 查证、平台引导、其他依赖初始化与服务生命周期纳入同一显式收尾范围。无论哪一步返回错误或正常结束，分别尝试撤销平台 namespace 与 root audit namespace 的当前 service token；没有成功登录的会话不发撤销请求。任一撤销未确认都不能作为正常退出报告，原始错误保留在日志。`revoke_current` 仅在 OpenBao 确认撤销后清空 lease；失败时在当前会话保留令牌，但 Core 退出时没有自动重试，不能把它当作已撤销。Core 进程非正常强杀仍依赖 OpenBao 的短 TTL，不能声称收到撤销确认。

定向 `kailo-secrets` 单测 4/4、现有 OpenBao 集成用例 1/1、`kailo-core` 编译通过。新增单测模拟首次撤销 HTTP 500、再次 HTTP 204，核对失败时 lease 保留、成功后清空且只发两次请求；暂时移除真实撤销调用时该用例退出 101，恢复后通过。真实 OpenBao 的正常 SecretRef 用例再次显式启用并通过 1/1，结束前主动撤销其核验用 token。

另用已构建的 Core 二进制验证启动失败分支：在本地数据库只建立连接，平台凭据使用一次性 response wrapping，audit wrapping 故意设为无效，故障发生在任何平台引导写入和监听之前。Core 退出码 1；日志确认平台 service token 已换出及 audit 凭据被拒；OpenBao audit 中 `auth/token/revoke-self` 记录由 4 增至 6，最后两条分别为 request 与无 error 的 response。没有打印 token 或日志正文，也没有访问旧 K8S。前两次准备命令分别因 Cargo 工作目录和测试环境变量缺失而在登录前退出；其未消费的 wrapping token 由 OpenBao 的 120 秒 TTL 失效，不能算成功的撤销演练。该验证不覆盖 Core 正常 serving 后的外部 SIGKILL，也不证明 OpenBao 不可达时的撤销结果。

受限 BuildKit 构建本地 Core，首个镜像 manifest 为 `sha256:ee3e6dfd5a12c77854bfda6c812d684058d39792c5bc67c61171fdfeb0aa78b6`；`start-core.sh` 重新投递两份一次性凭据并重建 `core-bff`。该镜像上的 `core/verify/run-integration.sh` 退出码 0：真实 OpenBao、Buzz、SpiceDB、Temporal、Core/Worker 集成套件通过；标为 ignored 的 Relay 故障与 Approval continue-as-new 演练未计入。

Docker 的停服信号是 SIGTERM。Core 增加该信号的优雅退出处理后，第二个镜像 manifest 为 `sha256:ef5f05b21f16ea367b2a0ccb5faaa760b91b3bae09b64221b1149645b1677411`。对运行中容器发送 SIGTERM 前，OpenBao audit 的 `auth/token/revoke-self` 记录数为 8；容器退出码 0 后记录数为 12，新增的两组 request/response 均无 error。随后 `start-core.sh` 重新投递一次性凭据并恢复 Core；同一镜像运行中，`/healthz` 返回 HTTP 200。SIGKILL、OpenBao 不可达和容器在撤销中途崩溃仍没有确认撤销的证据，只能依赖短 TTL 与审计对账。

最终 `./tools/check.sh --full` 十组通过；其中实际迁移演练因本次未传隔离 `DATABASE_URL` 为 SKIP，独立隔离库实演证据见 `task-terminal-repair.md`。
