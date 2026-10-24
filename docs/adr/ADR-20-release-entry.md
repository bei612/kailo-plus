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
| plan | 开发机 + 节点只读探针 | 推导重建单元、固定位置、部署对象、配置漂移、备份库、待迁移、`.env` 差异 | 每次重算 |
| build | CI worker | 对每个过期单元 `kailo-ci submit <源> build <单元>`，等待终态 | 日志里该单元已有 SUCCEEDED 任务；或同一输入摘要已有成功构建 |
| record | 开发机 | 二开产物：取任务的 `generated_metadata_diff`，以 `upstream_manifest.py record` 写回并复核源码摘要一致；自建单元：读产物目录中的 provenance，核对源 commit | 记录已等于构建输出 |
| pin | 开发机 | 按结构替换 compose 镜像 pin 与追溯记录 `release.artifacts[].digest`；断言 `deploy/`、`tools/` 不再残留旧 digest；提交并快进 push | 远端 main 已含该 pin 提交 |
| check | CI worker | `kailo-ci submit <pin> check`（原 full） | 该 commit 的 full 任务 SUCCEEDED |
| backup | 节点（发布树内代码） | 对受影响服务直接依赖的 Postgres 做 `pg_dump -Fc`，`pg_restore --list` 校验，连同 `.env` 快照写 manifest | 该 pin commit 的 manifest 存在且文件摘要一致 |
| deploy | 节点（发布树内代码） | 规范发布树权限 → 声明式 `.env` → 渲染运维域投递（§10）→ 迁移 → 配置一次性服务 → 创建缺失的运维域运行体（§10）→ 重建配置漂移的基础服务（§9）→ IdP 声明式配置（§8）→ 按序替换服务（含投递摘要变化时的 core-bff，§10）→ 重建依赖替换对象的漂移服务（§9）→ 回读 | 运行镜像 digest 已等于 pin 的服务跳过；配置一次性服务（`restart: "no"`、消费发布树内 compose configs，例如 SpiceDB schema 写入）按其配置文件内容 digest 判定，与上次成功应用的 digest 相同则跳过；IdP 声明按 §8 的配置摘要判定；长期运行服务的配置与现场一致则跳过（§9）；运维域运行体已运行则不创建，投递摘要等于已生效摘要则不重建 core-bff（§10） |
| verify | 节点（发布树内代码） | 回读全部受管服务的镜像、健康、Web build-info 与无关容器；IdP 声明只读回读（§8）；长期运行服务无配置漂移且健康（§9）；运维域运行体与投递（§10） | 每次重算 |

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
| 配置漂移 | 发布树以 deploy 同一套 Compose 参数渲染的服务哈希、configs 内容、secret 路径，与运行容器的 `com.docker.compose.config-hash` 标签、容器内文件、挂载来源比较（§9） |
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
backup 先于 deploy 推导漂移与需备份的库，此时声明尚未落盘：它按声明后的 `.env` 在运行目录同目录写 0600 预览、
用后即删，使新声明的 `${NAME:?…}` 键可插值、预判与 deploy 落盘后的渲染一致；运行 `.env` 在 deploy 之前不变。

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

### 6A. 部署附带损伤的比较范围

deploy 前后比较「不属于本次替换、却不再运行」的容器，只比较有重启策略（always、unless-stopped、
on-failure）的长期运行容器，并排除 `release.yaml` `deploy.disposable_projects` 声明的一次性 Compose
项目（一致性与接收方演练按命名约定独立建拆）。无重启策略的容器是一次性任务或测试容器，会自行结束，
它们结束不是部署造成的；把它们算进来曾使发布在代理测试容器自行退出时误判失败（2026-10-23/24 两次）。

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
  verify 如实报告 `UNDECLARED`；值无效、平台 client 被声明为组件 client、back-channel 地址不在组件 origin 或路径不是
  `.design/07` §4.7.5 的固定接收路径、组件 client 不存在（不创建）、已有同名而不一致的 mapper 或资料属性时拒绝，不覆写。
  已有组件 client 的四项退出属性（`frontchannelLogout=false`、`backchannel.logout.url`、`backchannel.logout.session.required=true`、
  `backchannel.logout.revoke.offline.tokens=false`）完全由声明决定，不一致即以声明值收敛并回读确认（§4.7.5）。任一命令非零退出即
  deploy 失败，不记录摘要。
- **成员目录 client（2026-10-23 增补，DD-133(4)、`.design/07` §4.7.4）**：`COMPONENT_DIRECTORY_CLIENTS`（`<组件>=<clientId>`，组件为
  `file-storage`、`knowledge`、`data-query`，由 `release.yaml` 的 `env.set` 声明）列出每个组件部署单元的目录 client。
  `--declare-directory-clients` 对不存在者创建只有 service account 的机密 client（不开授权码、隐式、口令、设备与 CIBA 流程，
  无回调与来源，`fullScopeAllowed=false`），唯一 mapper `kailo-directory-core-audience` 把 Core service audience
  （`OIDC_SERVICE_CLIENT_ID`）写入访问令牌 `aud`；已有同名 client 的流程属性、回调、mapper 或 service account 角色与声明不一致即拒绝，
  不覆写。凭据以 IdP 为准，写入运行目录 `secrets/component-directory/<组件>/client_secret`（目录 0700、文件 0600、同目录临时文件
  fsync 后原子替换），由组件部署以只读文件挂载；文件缺失或与 IdP 不一致时以 IdP 值替换。`--verify-directory-clients` 只读核对
  client、mapper、角色与文件（不一致计为问题，不写）。clientId 不得是平台 client、受众或组件 browser client；空值即未声明
  （`UNDECLARED`，不联系 IdP）。Core 只以 binding `directoryClientId` 核对 `azp`，不接触该凭据。
- **回读**：verify 执行各条只读回读（包装层拒绝任何写请求），并核对记录的摘要等于本次输入；回调字段、默认 scope、mapper、
  退出属性、资料属性或任一用户 `picture` 不一致，或摘要不符，verify 失败。在两次 deploy 之间新加入的用户在下一次 deploy
  才补 `picture`，期间的 verify 如实失败。
- **凭据与输出**：命令以 `KAILO_RUNTIME_DIR=<运行目录>` 在发布树 `deploy/local` 下执行，管理口令只从运行目录
  `secrets/keycloak_admin_password` 读入内存，管理令牌不经跳转与代理转发；标准输出只有一行状态与计数，消息只写角色
  （「平台浏览器客户端」「组件专属客户端第 N 项」），不输出 client id、URL、口令或令牌。plan/`--dry-run` 只报告摘要状态
  （从未记录/已变化/未变）与是否声明了组件专属客户端。

### 9. 运行中服务的配置漂移收敛

部署对象原本只由镜像 digest 决定。长期运行的服务镜像不变、只改了 compose 配置（environment、挂载、
`configs`、挂载的配置文件）时，发布不会重建它，改动永远不生效。例如 `openmeter_clickhouse_system_logs`
关闭 ClickHouse 诊断表的配置，合并后不会自己生效。因此 plan、deploy、verify 对发布树中每个长期运行服务，
用同一实现（`node.py config_drift`）比较「发布树渲染出的配置」与「运行容器」：

1. **Compose 配置哈希**：期望值用 deploy 同一套 Compose 参数求得（发布树 `compose.yaml`、运行目录 `.env`、
   登记叠加、`KAILO_RUNTIME_DIR=<运行目录>`），再与容器的 `com.docker.compose.config-hash` 标签比较。
   这里不直接用 `docker compose config --hash`。compose 2.40.3 的 `runHash` 以 `WithoutEnvironmentResolution`
   加载项目，而 `up` 写标签时已经把 `env_file` 并入 environment。所以凡是用 `env_file` 的服务，两者必然不同。
   CI 节点实测：12 个这样的服务里有 8 个在运行，全部误报。实际做法是先用 `config --format json` 得到已解析
   `env_file` 的完整模型，再经标准输入交给 `config --hash '*'`。节点实测时，这样求出的哈希与现有容器的标签
   逐一相等。模型只在内存和管道中传递。
2. **configs 内容**：Compose 的服务哈希不包含 `configs` 的 `content` 和 `file` 内容。2.40.3 实测：只改内容，
   哈希不变，`up` 也不会重建。因此用 `docker cp <容器>:<target> -` 读回容器内的文件（只读，容器内不需要 shell），
   与渲染出的内容比较。
3. **文件型 secrets 的挂载来源**：secret 的文件路径同样不在哈希里。这里只比较挂载来源是否等于渲染路径，
   不读 secret 内容。软链接时期从旧发布树或临时目录挂载的投递（背景第 3 条），只有这样才看得出来。

**排除**（不参与比较）：

- `restart: "no"` 的服务：一次性服务由配置一次性服务机制（`apply_config_oneoffs`）和一次性前置负责，
  重复启动它们没有「收敛」的含义。
- 不在本 compose 文件中的服务：组件（`deploy/components`）各有 Compose 项目和部署入口，本入口不触碰它们
  （见「不改变的事」）。比较只遍历本文件的服务，只看本项目标签的容器。
- 没有唯一运行中容器的服务：不判为漂移，列为「未运行」。受管服务按镜像判定创建，其余由 bootstrap 负责。

**只比较内容、不比较哈希**（由现场推出，不需要声明）：如果容器的 `com.docker.compose.project.config_files`
标签里含有发布树 `compose.yaml` 和登记叠加之外的文件，例如 `start-core.sh` 以 mktemp 生成、投递 DD-70
一次性凭据的叠加，那么它的哈希包含发布树渲染不出的内容，无法比较。这类容器只比较 configs 内容和 secret 来源；
它的 compose 定义变化在其启动命令下次运行时生效（core-bff 随每次 Core 发布重建）。

**只报告**：`release.yaml` 中 `services.<服务>.drift: report` 的服务只列出漂移，不重建。目前只有 `openbao`：
本拓扑没有 auto-unseal，重建即封存；解封要经 `secret-store-init.sh` 使用 `secrets/openbao_init.json` 中的分片，
`up --wait` 也会因健康检查超时（封存时返回 503）。封存期间所有 SecretRef 不可读，Core 与组件的凭据投递中断。
这不是服务替换能完成的动作，由运维窗口处理。

**收敛**：

- 漂移的受管服务并入替换对象，走同一条路径（声明的命令、一次性前置、镜像回读），按 `03` §7 排序。
- 其余漂移服务分两组：不依赖任何替换对象的，在替换之前重建；依赖替换对象的（按 depends_on 传递闭包），
  在替换之后重建。组内依赖在前，其余按 compose 定义顺序。
- deploy 中的位置（与 §8 的 IdP 声明统一）：迁移 → 配置一次性服务 → **重建「替换前」组的漂移服务** →
  **等待 keycloak 就绪后执行 IdP 声明** → 按序替换服务（含并入的漂移受管服务）→ **重建「替换后」组的漂移服务** → 回读。
  漂移的基础服务（含 keycloak 本身或其数据库发生漂移的情形）先于 IdP 声明收敛，于是声明作用于重建后的实例，§8 的就绪等待
  也覆盖了这次重建；IdP 声明仍在替换任何服务之前（§8 的兼容顺序不变）。「替换后」组依赖新替换的服务，放在最后。
- journal：漂移相关字段为 `deploy.json` 的 `config_drift`、`config_converge`、`config_recreated`、`history`，verify 结果为
  `config_drift_reported`、`not_running`；与 §8 的 `idp` 字段和 `releases/idp-declarations.json` 互不重叠。
- 每个服务执行 `up -d --no-deps --force-recreate --no-build --wait <服务>`。`--force-recreate` 是必须的：
  内容与 secret 路径不在哈希里，不强制时 `up` 会认为无需重建。随后回读哈希、内容、secret 来源与健康，
  再写入 `deploy.json` 的 `config_recreated`。
- backup：本身因漂移被重建的 Postgres 也加入备份对象。数据在卷中保留，重建前照例先备份。
- 幂等：每次 deploy 都从现场重算。已收敛的服务哈希与内容一致，不会再出现。`deploy.json` 重写时，
  之前各次的摘要保留在 `history`。
- verify：全部长期运行服务（`drift: report` 的除外）必须无漂移且健康。`drift: report` 的服务与未运行的服务
  列入结果，不判为失败。

**不设阈值，不因数量或有状态服务停下**：

1. 漂移意味着运行的不是该 commit 声明的配置。发布的定义就是让现场等于 commit。按数量设阈值是门禁的变体：
   数量与正确性无关，还会让旧漂移一直积压，下一次只会更多。
2. 审阅由 plan 提供：run 之前逐个列出漂移服务、原因和重建顺序，`--dry-run` 也一样。
3. 风险由既有机制约束：串行、每个服务等健康、第一个失败即停并保留日志（§6）、Postgres 先备份；
   数据库重建不动卷中数据。
4. 确实不能靠服务替换完成的情况，用声明一次写明理由（`drift: report`），而不是每次运行时由人临场判断。

### 10. 运维域运行体与投递（2026-10-22 增补，DD-136）

`DD-134(5)` 的外部 MCP 服务器注册需要两类运维域事实：一个按固定 digest 运行的 MCP 运行体，以及 Core 读取的交付目录
`protocolPeers` 与 `PROTOCOL_PEER` 一致性环境。此前它们没有声明来源，只能由人到节点手写文件、改 `.env` 再手工重建 Core。
本节把它们并入同一入口，仍不新增门禁：

- **operated**：`release.yaml` 的 `operated` 列出 compose 中按 digest 固定的上游镜像常驻服务（当前为 `protocol-peer-reference`）。
  它们不是构建单元，不参与 build/record/pin。§9 的漂移收敛只处理已运行的服务（未运行列为「未运行」），而这些运行体首次发布时
  并不存在，因此 deploy 创建没有唯一运行中容器的 operated 服务并回读运行、本地解析与健康；已运行者的镜像引用或配置与发布树
  不同即是 §9 的配置漂移（镜像在 Compose 配置哈希内），由漂移收敛重建，本节不重复处理。verify 每次回读其镜像引用、本地解析与
  健康。上游镜像来自原 registry，不做本仓库产物的 registry 复现核对。
- **delivery.protocol_peers**：仓库内的 `deploy/local/protocol-peers/directory.json`（只含 `protocolPeers`）与一致性环境，由 deploy
  渲染到运行目录 `data/protocol-peers/` 下的真实规范文件（0644，同目录临时文件 + fsync + 原子替换，内容不变不改写）。交付目录中
  `adapters` 保留运行文件已有条目（组件入口以 `adapter-directory.mjs --existing` 维护同一文件），`adapterServiceRef` 两类唯一。
  `.env` 的 `APPLICATION_ADAPTER_DIRECTORY_FILE` 与 `COMPONENT_CONFORMANCE_ENVIRONMENT_FILE` 由 `env.set` 以 `${KAILO_RUNTIME_DIR}`
  引用指向这两个文件；一致性套件同一时间只有一个候选，HTTP adapter 才有的另两项由 `env.unset` 删除。
- **生效**：start-core.sh 以原路径只读挂载这些文件，替换文件不会进入已运行的 Core/Worker，只有新的一次性投递（`DD-70`）重建后生效。
  因此入口记录声明摘要（发布 journal 目录的 `deliveries.json`），摘要与上次经 `restart`（core-bff）启动入口生效的不同时把 core-bff
  加入部署目标（并入 §9 的 `converge_plan` 替换对象，backup 随之覆盖 core-db），回读成功后才记下新摘要；摘要相同不重建。plan 列出运行体状态与投递是否待生效。
- **校验**：`model.peer_delivery` 在 plan 即拒绝不合规的声明——端点不是 operated 运行体、`artifactDigest` 不等于其固定 digest、
  binding 归属事实或一致性环境不符合契约、期望应答未记录、`.env` 键与渲染位置不一致；拒绝时不改动现场。
- **期望应答**：一致性环境的 `initializeResultJson`/`listResultJson` 由 `deploy/local/protocol-peers/record-conformance.py` 在 CI 节点
  隔离网络中经与生产同一 Gateway 构建记录（DD-136(3)），随源码提交；peer 或 Gateway 的 digest 变化后重新记录。
- **binding 归属事实**（`DD-98`）：Tenant 管理员在网关管理区生成草稿后，把草稿给出的条目登记进 `directory.json` 的 `bindings` 并发布；
  下一次 deploy 因摘要变化重建 Core，向导读到条目后才放行 `application_binding.create`。
- **deploy 中的位置**（与 §8、§9 统一）：规范发布树权限 → 声明式 `.env` → **渲染运维域投递到运行目录** → 迁移 → 配置一次性服务 →
  **创建缺失的运维域运行体** → 重建「替换前」组的漂移服务 → IdP 声明 → 按序替换服务（含因投递摘要变化并入的 core-bff）→
  重建「替换后」组的漂移服务 → 回读。投递先落盘、运行体先于 Core 重建，Core 经启动入口重建后交付目录中的端点即可达；
  journal 字段为 `deploy.json` 的 `operated`、`delivery`，已生效摘要在 `releases/deliveries.json`，与 §8、§9 的字段互不重叠。

### 11. 发布树与代理暂存保留（2026-10-23 增补）

CI worker 每次 fetch、检查、构建与发布都在 `<sources>/<commit>` 留下一棵约 3.5 GiB 的发布树，此前从不回收；连同 Docker
镜像与各代理的 `~/scratch` 暂存，NVMe 根分区一再写满，作业以 `insufficient CI workspace disk space` 拒绝启动。保留逻辑只有
一份，在 `node.py retention`（`run_retention`），三处调用：

- **规则**（`retention_decision`，纯推导）：保留 ① 任一容器（含已停止的）以挂载来源、挂载来源经软链接解析的位置、Compose
  项目目录或 Compose 文件引用的树（例如 OpenBao 以发布树内的链接挂载运行目录）；② 链接扫描根（缺省运行目录，深度 6，不跟随
  目录链接）下指向发布树的软链接；③ 当前 pin（journal 中最近一次 `SUCCEEDED` 的 deploy）与最近 `keep_releases`（3）次发布；
  ④ CI 队列中未结束的任务与尚未领取的请求；⑤ `origin/main`；⑥ 调用方指定的 commit；⑦ 2 小时内活动过的树（树根、`ready.json`、
  `check.json` 的 mtime）。其余删除，删除前把树根的 `*.json` 回执归档到 `<receipts>/<commit>/`（内容相同跳过，不同加时间后缀）。
  `~/scratch/<名字>` 自身与直接子项 24 小时无变化即删除（`07` §2.1）；只读的 go module cache 先 `chmod -R u+w`，本用户无权删除
  的条目经 `sudo -n` 删除。
- **安全**：Docker 或 journal 读不全、链接扫描根缺失即停止且不删除；根下由容器 uid 持有、不可读的数据目录列入 `unscanned`
  （其中的链接只在容器内解析，宿主上消费发布树的路径都已出现在容器挂载与 Compose 标签里）。实际删除在 `<queue>/source.lock`
  下重新取事实后执行，与 worker 准备发布树互斥。删除量按独占块计，与 Git 对象库硬链接共享的部分不计为释放。
- **配置**：策略缺省值随代码版本化；节点路径只在 CI 配置的 `retention` 段（`journal`、`receipts`、`scratch`、`link_roots`，可覆盖
  `keep_releases`、`grace_seconds`、`scratch_max_age_seconds`、`link_depth`）。节点 deploy 核对其 `journal` 等于 `release.yaml`
  的 `node.journal`。
- **发布入口**：plan 经 inspect 以只读方式推算并列出将删除的树、独占大小与每棵保留树的原因（本次源 commit 视为保留）；deploy 成功
  回读后（无关容器未停止）以届时现场重算并执行，结果写入 `deploy.json` 的 `retention`。发布本身已成功，保留失败只记录，不改变 deploy 结果。
- **CI worker 准入自愈**：构建类阶段可用空间低于准入值时，worker 取本次 checkout 刚 fetch 的 main（`FETCH_HEAD`）上的
  `tools/release/node.py`，执行 `retention --prune-docker --keep <本任务 commit>`——即上述保留，再 `docker image prune -a --filter until=72h`
  （只删未被任何容器使用的镜像）与 `docker builder prune --filter until=72h`——然后重新检查空间，仍不足才失败。规则在仓库内随 main
  演进，worker 只有调用与重检两步；main 尚无该步骤或执行失败时只记录日志，行为与此前相同。
- **检查镜像保护**：检查镜像按配方命名（`local/kailo-check:<sha256(tools/check.Dockerfile)>`），重建一次很贵。origin/main、当前 pin
  与 `--keep` commit 的配方（经 `git show <commit>:tools/check.Dockerfile` 从 CI 源仓库读取）对应的镜像在 `image prune` 期间各由一个
  从不启动的 created 容器（`--network none`，标签 `io.kailo.retention.hold`）占用，prune 结束（含失败）即删除；上次异常遗留的占位容器
  在下次 prune 前清理。读不到任一配方或缺少 `source_repository` 时不执行 prune（保留树与暂存照常），不在无保护时删除镜像。其他配方的
  检查镜像不受保护，由下次检查按配方重建。
- **只读核对**：`node.py retention --dry-run [--prune-docker]` 不删除、不建目录，列出将删除的树与暂存及大小；`--prune-docker` 时只回报
  `docker system df` 的可回收上界与受保护的检查镜像。

## 后果

正面：一条命令覆盖从规划到回读的全部步骤，所有输入由登记数据推出，改错位置或漏改会在 pin 阶段以残留 digest 断言当场失败；
Core/Worker 发布逻辑进入仓库并随 commit 版本化；发布树保持干净只读，容器挂载不再依赖软链接；中断后可从原阶段继续而不重复提交 CI 任务。

负面：compose 中运行投递路径多了一层变量，直接阅读不如 `./secrets` 直观；入口在 root 下运行并以工作树属主执行 Git，依赖两机现有身份分工；
`.env` 的声明值进入版本库，修改它需要提交与 full。配置漂移判定依赖 Compose 的服务哈希实现（`up` 写标签与 `config --hash`
的差异只在 env_file 解析，已以渲染模型回送消除）；升级 Compose 后若哈希算法改变，第一次发布会把全部长期运行服务列为漂移，
plan 会如实列出，届时应先核对再执行。

## 替换边界

CI worker 若登记通用 deploy 阶段，可直接调用发布树内的 `node.py deploy`，入口的 deploy 阶段随之改为提交该任务；推导规则、
声明文件与节点代码不变。迁往其他编排器时，替换的是 `node.py` 的服务替换实现，阶段、日志与推导保持不变。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态，不改变 `03-验证发布与验收门禁.md` §5 的门禁内容、§7 的发布顺序与 §8 的停止条件，
不改变 [ADR-06](ADR-06-artifact-supply-chain.md) 的 digest、SBOM 与 provenance 要求，也不改变 [ADR-07](ADR-07-ci-and-branch-protection.md)
中 full 门禁的定义。组件参考实现（`deploy/components/component-deploy.sh`）的部署单元不在本入口范围内，plan 只列出其过期产物。
