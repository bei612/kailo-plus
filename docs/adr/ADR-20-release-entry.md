# ADR-20：统一发布入口

- 状态：已接受
- 日期：2026-10-20
- 决策者：Kailo 实施工程负责人

## 背景

一次版本发布此前由操作者在开发机与 CI 节点之间逐步手工完成：按 `tools/upstream_manifest.py` 的算法比对
`source_digest` 找出要重建的产物；逐个 `kailo-ci submit … build`，从任务状态取 `generated_metadata_diff`
补尾换行后 `git apply`，Core/Worker 的 digest 从 CI 产物目录的文件名抄出；再以全文替换把旧 digest 换成新值
（`deploy/local/compose.yaml`、`tools/traceability/*.yaml`）并提交；然后 full 检查；在 CI 节点手工 `pg_dump`；
执行仓库外的 `~/kailo-deploy/core-release.sh`；Relay 有变化时手写 `docker compose up`；Web 经
`kailo-ci submit … deploy buzz-web` 部署，并为此反复 unlink/link 发布树里的 `.env`、`secrets`、`data`；生产
`.env` 的键用一次性脚本替换。

这条路径有四个结构性问题：

1. 每一步的输入（重建哪些产物、改哪些位置、部署哪些服务、备份哪些库）由人从登记数据里抄出，抄漏或抄错没有任何一步会发现；
2. Core/Worker 的发布逻辑在仓库之外，不随源码 commit 版本化，也没有评审；
3. 发布树（`/volumes/kailo/ci/sources/<commit>/apps`）既被当作代码来源，又被放进运行投递的软链接：软链接使树变脏，
   Web 部署要求干净树，于是来回 unlink/link；而 core-bff 的 bind source 指向软链接路径，链接被移走后容器重启即挂载失败；
4. CI worker 的 `UMask=0077` 使发布树文件为 0600、目录为 0700，以非 root 运行并 bind 发布树文件的容器（automation-egress、
   Wren gateway）读不到配置，此前只能对单个文件临时 chmod。

`03-验证发布与验收门禁.md` §7 规定的发布顺序、§8 的停止条件，以及 [ADR-06](ADR-06-artifact-supply-chain.md)
的 digest 与来源证明要求都不变；本 ADR 只把既有步骤收拢为一个可复用、可恢复的入口，**不新增门禁**。

## 决策

### 1. 入口与阶段

入口是 `tools/release/kailo-release.sh`（薄 shell）→ `tools/release/orchestrator.py`。在开发机以 root 运行
（持有 CI 节点的 SSH 身份）；Git 操作以工作树属主（`kailo-dev`）身份执行。命令：

```text
kailo-release.sh plan   [--commit SHA] [--json]          # 只读：输出完整计划
kailo-release.sh run    [--commit SHA] [--until STAGE] [--dry-run] [--retry-failed] [--trailer T]
kailo-release.sh status [--commit SHA]                   # 读日志（journal）
```

一次发布以**源 commit**（必须已在 `origin/main`）为标识，依次经过八个阶段：

| 阶段 | 执行处 | 动作 | 已完成的判定（幂等） |
|---|---|---|---|
| plan | 开发机 + 节点只读探针 | 推导重建单元、固定位置、部署对象、备份库、待迁移、`.env` 差异 | 每次重算 |
| build | CI worker | 对每个过期单元 `kailo-ci submit <源> build <单元>`，等待终态 | 日志里该单元已有 SUCCEEDED 任务；或同一输入摘要已有成功构建 |
| record | 开发机 | 二开产物：取任务的 `generated_metadata_diff`，以 `upstream_manifest.py record` 写回并复核源码摘要一致；自建单元：读产物目录中的 provenance，核对源 commit | 记录已等于构建输出 |
| pin | 开发机 | 按结构替换 compose 镜像 pin 与追溯记录 `release.artifacts[].digest`；断言 `deploy/`、`tools/` 不再残留旧 digest；提交并快进 push | 远端 main 已含该 pin 提交 |
| check | CI worker | `kailo-ci submit <pin> check`（原 full） | 该 commit 的 full 任务 SUCCEEDED |
| backup | 节点（发布树内代码） | 对受影响服务直接依赖的 Postgres 做 `pg_dump -Fc`，`pg_restore --list` 校验，连同 `.env` 快照写 manifest | 该 pin commit 的 manifest 存在且文件摘要一致 |
| deploy | 节点（发布树内代码） | 规范发布树权限 → 声明式 `.env` → 迁移 → 配置一次性服务 → IdP 声明式配置（§8）→ 按序替换服务 → 回读 | 运行镜像 digest 已等于 pin 的服务跳过；配置一次性服务（`restart: "no"`、消费发布树内 compose configs，例如 SpiceDB schema 写入）按其配置文件内容 digest 判定，与上次成功应用的 digest 相同则跳过；IdP 声明按 §8 的配置摘要判定 |
| verify | 节点（发布树内代码） | 回读全部受管服务的镜像、健康、Web build-info 与无关容器；IdP 声明只读回读（§8） | 每次重算 |

`run` 从第一个未完成的阶段继续；中断后再次执行同一命令即恢复。恢复依据两层：开发机日志
`$XDG_STATE_HOME/kailo-release/<源commit>.json` 记录任务 ID、构建输出与 pin commit，避免重复提交 CI 任务；
每个阶段执行前再按真实状态判断是否已完成（远端 ref、任务终态、运行镜像、备份 manifest），日志与现场不一致时以现场为准并报告。
`UNKNOWN` 一律停下，不自动重试（`kailo-ci` 本身也拒绝 retry UNKNOWN）；`FAILED` 只有显式 `--retry-failed` 才重新提交。

`--dry-run` 执行 plan 并逐阶段列出将要提交的任务、将改写的文件与位置、将在节点执行的命令，不产生任何写入。

### 2. 推导，而不是清单

`tools/release/release.yaml` 只声明现有登记推不出的事实；其余全部从既有登记数据推导：

| 需要的事实 | 来源 |
|---|---|
| 二开产物、输入范围、记录的 `source_digest`/`artifact_digest`、是否阻断 | `*/fork/upstream.yaml`（`upstream_manifest.records/load/source_digest`） |
| 二开产物是否过期 | 当前 `source_digest` 与记录比较（与 `check.sh seam` 同一算法） |
| 自建单元（core-worker）是否过期 | compose 中 `core`/`worker` 的 pin → CI 持久证明库 `<镜像>.<digest>.provenance.json` 的 `gitCommit` → 该 commit 与目标 commit 在单元输入上的 `git diff` |
| 自建单元的输入 | `release.yaml` 的 `units.core-worker.inputs`；`tools/release.sh` 从同一处读取导出集合，不再各写一份 |
| 产物 → 服务 | compose 中 `image: ${REGISTRY_HOST}/<产物>@sha256:…` |
| 需要改写的 pin | 同上的镜像行 + 追溯记录 `release.artifacts[]` 中同名项 |
| 一次性前置 | 被部署服务的 `depends_on` 中 `service_completed_successfully`、`restart: "no"` 且使用同一产物镜像的服务（如 buzz-schema 先于 buzz-relay 执行迁移） |
| 要备份的库 | 被部署服务及其一次性前置直接依赖的 Postgres 服务；有待执行迁移的库 |
| 待执行迁移 | `release.yaml` 声明的迁移目录与 `_sqlx_migrations` 已成功版本之差 |
| 部署顺序 | `03` §7：迁移 → `order.first`（Core、Worker）→ 其余产物 → `order.last`（Web），同组按 compose 定义顺序 |
| 节点路径、Compose 项目、Web build-info 位置 | CI 节点 `ci/config.json`（`runtime`、`sources`、`release_proofs`、`compose_project`、`web_build_info_path`），不在仓库复制 |

`release.yaml` 的声明只有：自建单元的构建入口与输入；默认部署方式不适用的服务（core-bff 每次启动需要新的
一次性 OpenBao 投递，`DD-70`，因此走 `start-core.sh --no-build`）；迁移目录；运行目录中持久派生的 Compose 叠加文件；
声明式 `.env`；节点 SSH 名与 CI 配置位置。部署对象是「受管服务中运行 digest 不等于 pin 的服务」，因此上次 pin 了但未部署的服务也会被补上，已经一致的不会被重启。

### 3. 发布树只读，运行目录显式

发布树是固定 commit 的代码与配置，运行目录（CI 节点 `ci/config.json` 的 `runtime`）是 `.env`、`secrets/`、`data/`
的唯一位置。二者用变量显式区分，不再在发布树里建软链接：

- `deploy/local/compose.yaml` 中运行投递与数据的引用写作 `${KAILO_RUNTIME_DIR:-.}/secrets/…`、`${KAILO_RUNTIME_DIR:-.}/data/…`；
  未设置时等于原 `./`，开发机与 `init-local.sh` 的本地拓扑不变。
- 入口在节点以 `-f <发布树>/deploy/local/compose.yaml`（项目目录即发布树，配置文件取自固定 commit）和
  `KAILO_RUNTIME_DIR=<运行目录>` 调用 Compose；容器的 bind source 因此是运行目录的绝对路径，与发布树的存废无关。

运行目录的定位只有一条规则，所有部署入口共用：

- **值的来源**：本地拓扑不设置，缺省即 `deploy/local` 本目录。CI 节点上唯一来源是 CI 配置的 `runtime`：发布入口
  `tools/release/node.py` 与组件入口 `deploy/components/component-deploy.sh`（及只读的 `platform-config-check.sh`）
  自行从该配置读取并导出（组件入口经 `node.py runtime --commit <commit>`，与发布入口同一实现）；调用方已设置
  `KAILO_RUNTIME_DIR` 而与配置不同时拒绝，不允许第二个来源。在节点上手工调用 `deploy/local` 的脚本（如续跑
  `bootstrap.sh --native-model-delivery`）时由调用方显式给出 `KAILO_RUNTIME_DIR=<runtime>`；固定发布树里没有 `.env`，
  漏给时当场拒绝，而不是误用发布树。仓库外的 `~/kailo-deploy/core-release.sh` 已被本入口取代，不再使用。
- **解析与校验**：shell 侧唯一解析器是 `deploy/local/runtime-dir.sh`——`realpath -e` 规范化，`.env` 必须是文件，
  `.env`、`secrets`、`data` 不得是软链接（软链接正是发布树冒充运行目录的方式），然后导出，并提供
  `runtime_compose`（`sudo -n --preserve-env=KAILO_RUNTIME_DIR docker compose --env-file "$KAILO_RUNTIME_DIR/.env" -f compose.yaml`）。
  `deploy/local` 下每个脚本（`bootstrap.sh`、`start-core.sh`、`secret-store-init.sh`、`secret-store-audit-dir.sh`、`dr-*.sh`、
  `token.sh`、`automation-egress-firewall.sh`、`init-local.sh`）都先 `. ./runtime-dir.sh`，再以 `$KAILO_RUNTIME_DIR/…`
  读写运行投递；`init-local.sh` 会清空 `secrets/` 与 `data/`，另要求运行目录就是本目录。
- **Python 侧同一规则**：`native-model-delivery.py`、`model-reader.py` 不另设缺省，只接受上述解析器导出的规范绝对路径
  （并重复链接与 `.env` 校验），平台 secret（如 `secrets/openbao_init.json`）在运行目录中定位；既有的属主、0600、
  canonical 校验作用于运行目录里的真实文件。`node.py` 对 CI 配置值做同样的规范化与校验。经 sudo 调用 Compose 时一律
  `--preserve-env=KAILO_RUNTIME_DIR`，否则 `${KAILO_RUNTIME_DIR:-.}` 会退回发布树。
- 任何部署脚本都不在发布树里建 `.env`、`secrets`、`data` 软链接，也不按当前目录定位它们
  （`deploy/components/test_native_model_delivery.py` 的 `RuntimeDirectorySeparation` 覆盖解析器、Python 消费者与该约束）。
- 部署前把发布树已跟踪文件的权限规范为 Git 语义（目录与可执行文件 0755、其余 0644），`sources/` 与
  `sources/<commit>/` 只开放遍历（0711）；`.git` 不动。这与 `upstream_manifest.py stage` 对构建输入的处理同一规则，
  `git status` 前后均须为空。入口从不写入发布树。

### 4. 声明式 `.env`

`release.yaml` 的 `env.set`（键 → 值）与 `env.unset`（键）声明由发布保证的生产非密配置。键必须是同一 commit 的
`deploy/local/.env.example` 中登记的公共输入（`.env` 只放非密配置，凭据在 `secrets/` 与 OpenBao）；值限定为单行、
无空白与引号、只允许 `${NAME}` 形式的引用，保证 Compose 与 bash `.` 读取语义一致、不会执行命令。节点在 backup 之后、
渲染 Compose 之前比对：只报告「键 + 新增/修改/删除/不变」，不输出任何值；有变化时在运行目录内写临时文件、fsync、
原子替换，权限与属主不变，并追加 `releases/env-journal.jsonl`（键、动作、commit、时间）。替换前的 `.env` 快照已在 backup 中。
plan 同时列出目标 commit 的 compose 以 `${NAME:?…}` 要求、而运行 `.env` 缺少且未声明的键名，deploy 遇到即拒绝。

### 5. 执行位置与代码来源

- 构建与 full 检查只经已登记的 CI worker 任务；开发机不构建、不编译。
- 节点上所有改变现场的阶段（backup、deploy、verify）执行的是 `sources/<pin commit>/apps/tools/release/node.py`，
  即 worker 从 GitHub 取出的固定发布树内的代码；节点先核对发布树 HEAD、干净、`ready.json` 与 full 回执
  （`sources/<commit>/check.json`，与 worker 部署 Web 所用同一回执），任一不符即拒绝。
- plan 的节点事实（运行镜像、`.env` 键状态、已执行迁移、证明库中的 provenance、回执）由同一 `node.py` 的只读
  `inspect` 子命令经 SSH 标准输入执行；该模式只允许 `inspect`，不写任何文件。源码仍只经 GitHub 流转。
- 节点部署持有 `releases/.deploy.lock`，并在 CI 队列存在进行中的 deploy 任务时拒绝执行，保持部署串行。

### 6. 失败报告

每个阶段失败即停止，退出码非零，并给出：阶段名、对象（单元/服务/库）、CI 任务 ID 与日志尾部中的失败行、
或节点命令的退出码与 stderr 末行；同时写入日志，下一次 `run` 从该阶段继续。节点 deploy 的每个服务记录
`替换前镜像 → 目标镜像 → 回读镜像 ID/健康`，失败时保留已完成服务的回读与未开始服务清单；不自动回滚
（回滚条件与做法按 `03` §8，由操作者依据日志与备份 manifest 决定），也不把结果不明写成成功或失败。
业务验收不属于入口的判定范围，verify 只做运行层回读。
回读判定对两种镜像存储都成立（`node.py judge_image`）：容器 `Config.Image` 的 digest 必须等于 pin；本节点对该引用的解析
（名称记录缺失时按同一 digest 拉取恢复）必须得到容器正在运行的镜像——containerd 存储下 image ID 即 manifest digest，
graph driver 下是 config digest，所以不拿 image ID 直接比 pin；pin 的 manifest 必须由其 registry 以同一 digest 提供
（`HEAD /v2/<repo>/manifests/<digest>`），404 判“产物不在 registry，不可复现”，无法确认同样判失败。

### 7. Web 部署结果为 UNKNOWN 的根因

CI worker 的 Web 部署在 `up` 之后用 `docker ps -q`（12 位截断 ID）减去 `docker compose ps -q buzz-web`（64 位完整 ID），
旧 buzz-web 永远减不掉，重建后它的短 ID 不在新列表里，于是必然抛出「an unrelated preexisting container is no longer running」；
此时状态已是 DEPLOYING，结果记为 UNKNOWN。修正是三处都使用完整 ID（`docker ps -q --no-trunc`），并在异常路径同样清理本任务创建的
运行投递软链接（其 Compose 已以 `--project-directory <runtime>` 解析相对路径，软链接并不被使用）。该修正属于 CI 运维文件
`ci/worker.py`，单独提交审批；入口自身的部署以完整 ID 比较，不依赖该任务。按 §3 的同一规则，worker 的 Web 部署应改为
以 `KAILO_RUNTIME_DIR=<runtime>` 调用 Compose（项目目录仍是发布树），并删去建链接与清理链接两段，同属该运维文件。

### 8. IdP 声明式配置

持久化 realm 不会再次导入 `identity-provider/realm.json`，模板与 `.env` 的后续变化（平台浏览器/原生客户端的回调与
`post.logout.redirect.uris`，DD-133(6)、SS-AGW-END-SESSION；组件专属 browser client 的 profile/email 默认 scope、
`kailo-picture`/`kailo-locale` mapper、back-channel 退出属性、realm 用户资料 `picture` 属性与全部用户的 `picture`，
DD-133(3)、`.design/07` §4.7.3/§4.7.5）只能经管理 API 收敛。此前它们由操作者手工执行 `bootstrap.sh` 的对应模式；
现在由 deploy 自动执行，`release.yaml` 的 `idp` 段声明等待的服务、期望值定义文件与命令：

- **期望值只有一份**：`deploy/local/idp-declarations.py` 定义全部期望与读取的 `.env` 键（`INPUT_ENV`）及摘要覆盖的文件
  （`INPUT_FILES`：它自身与 realm 模板）；`bootstrap.sh` 的 `--sync-client-redirects`、`--declare-native-client-profiles`、
  `--declare-native-user-pictures` 与只读的 `--verify-client-redirects`、`--verify-native-client-profiles` 都调用它，
  声明与回读不会各写一份。回调同步的期望值取自目标 commit 的模板、只代入非密 `.env` 键（两条回调由 `PUBLIC_ORIGIN`
  派生）；不再读取运行目录里 `bootstrap.sh` 初始化时渲染的 `secrets/idp-import/realm.json`——发布从不重渲染那份含 secret
  的导入文件，按它同步会把旧模板写回；模板回调字段出现非 `.env` 占位符即拒绝，不读取 secret 补齐。
- **触发与幂等**：deploy 在配置一次性服务之后、替换任何服务之前，等待 `keycloak` 就绪后计算配置摘要 =
  `INPUT_FILES` 内容 + `INPUT_ENV` 键及其 `${NAME}` 引用闭包在运行 `.env` 中原始值的 SHA-256（只保留摘要）。与
  `releases/idp-declarations.json` 记录的上次成功摘要不同（或从未记录）时依次执行 `apply`，全部成功后才记录；相同则跳过。
  `always`（`--declare-native-user-pictures`）每次 deploy 执行：只给新用户补 `picture`，客户端与资料属性只读核对，发现漂移即
  拒绝并作废已记录的摘要，使下一次 deploy 重新执行完整声明。各命令本身先读后写、回读确认，重复执行无副作用。
- **顺序理由**：新增回调、mapper 与退出属性对仍在运行的旧服务是兼容增量，而新网关的 end-session 回跳、组件的 claim
  依赖它们已登记（`03` §7 的兼容顺序：先放宽依赖，再替换消费者），因此先于 Core/Worker 与其余服务。
- **拒绝**：`NATIVE_OIDC_CLIENTS` 为空时组件专属客户端未声明——命令输出 `UNDECLARED`、不联系 IdP、不失败，摘要照常记录，
  verify 如实报告 `UNDECLARED`；值无效、平台 client 被声明为组件 client、back-channel 地址不在组件 origin、已有同名而不一致的
  mapper 或资料属性时拒绝，不覆写。任一命令非零退出即 deploy 失败，不记录摘要。
- **回读**：verify 执行两条只读回读（包装层拒绝任何写请求），并核对记录的摘要等于本次输入；回调字段、默认 scope、mapper、
  退出属性、资料属性或任一用户 `picture` 不一致，或摘要不符，verify 失败。在两次 deploy 之间新加入的用户在下一次 deploy
  才补 `picture`，期间的 verify 如实失败。
- **凭据与输出**：命令以 `KAILO_RUNTIME_DIR=<运行目录>` 在发布树 `deploy/local` 下执行，管理口令只从运行目录
  `secrets/keycloak_admin_password` 读入内存，管理令牌不经跳转与代理转发；标准输出只有一行状态与计数，消息只写角色
  （「平台浏览器客户端」「组件专属客户端第 N 项」），不输出 client id、URL、口令或令牌。plan/`--dry-run` 只报告摘要状态
  （从未记录/已变化/未变）与是否声明了组件专属客户端。

## 后果

正面：一条命令覆盖从规划到回读的全部步骤，所有输入由登记数据推出，改错位置或漏改会在 pin 阶段以残留 digest 断言当场失败；
Core/Worker 发布逻辑进入仓库并随 commit 版本化；发布树保持干净只读，容器挂载不再依赖软链接；中断后可从原阶段继续而不重复提交 CI 任务。

负面：compose 中运行投递路径多了一层变量，直接阅读不如 `./secrets` 直观；入口在 root 下运行并以工作树属主执行 Git，依赖两机现有身份分工；
`.env` 的声明值进入版本库，修改它需要提交与 full。

## 替换边界

CI worker 若登记通用 deploy 阶段，可直接调用发布树内的 `node.py deploy`，入口的 deploy 阶段随之改为提交该任务；推导规则、
声明文件与节点代码不变。迁往其他编排器时，替换的是 `node.py` 的服务替换实现，阶段、日志与推导保持不变。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态，不改变 `03-验证发布与验收门禁.md` §5 的门禁内容、§7 的发布顺序与 §8 的停止条件，
不改变 [ADR-06](ADR-06-artifact-supply-chain.md) 的 digest、SBOM 与 provenance 要求，也不改变 [ADR-07](ADR-07-ci-and-branch-protection.md)
中 full 门禁的定义。组件参考实现（`deploy/components/component-deploy.sh`）的部署单元不在本入口范围内，plan 只列出其过期产物。
