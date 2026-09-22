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
