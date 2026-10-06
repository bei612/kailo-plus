# 计量服务的 Core-only 认证接缝

## 范围与权威

本增量归属 Stage 4 的 `SS-OMT-AUTH`，依据 `SF-OMT-06` 与 `DD-38`；
`DD-37` 是 Stage 1 已有的 Core-only 调用身份边界，不将其决策归属移到 Stage 4。
本增量不是新的计费权威。
2026-10-01 从 OpenMeter 固定 commit
`6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 导入完整 4519 文件源码到 `metering/`，
没有上游 `.git`，没有修改或执行 `.references` 中的文件。
`OpenMeterBinding`、Customer、entitlement、usage 与 billing 的权威仍由设计规定；
本增量只改原生 API 认证，未开放额度或账单入口。

固定源码实际核对命令：

```bash
git -C ../.references/openmeter show 6d76d8a6fa90fbbab2d41035d31df2acec7ad3af:app/common/server.go
git -C ../.references/openmeter show 6d76d8a6fa90fbbab2d41035d31df2acec7ad3af:openmeter/server/server.go
git -C ../.references/openmeter grep -n NewRouterHooks 6d76d8a6fa90fbbab2d41035d31df2acec7ad3af -- app cmd
```

`NewRouterHooks` 原本只有 telemetry hook；`NewServer` 物化同一组 hook 后同时用于
v1/v3 路由组。唯一原生构造调用在 `cmd/server/wire_gen.go`，由 Wire 生成。
导入时的 apps 图谱对新导入目标的 upstream impact 返回 `UNKNOWN`、target not found；
不把没有索引的调用集解释为没有使用方，调用与路由包装范围以上述固定源码复核为准。

## 已写入的实现与影响面

- `app/config/server.go` 增加 `server.coreServiceTokenFile`，配置中只保存受控投递文件路径。
- `app/common/server.go::NewRouterHooks` 读取独立 Core service bearer credential；
  未配置、不可读、空值或含内部 ASCII 空格、制表、回车、换行时构造失败，
  不创建无认证 API。
- 同一 hook 在 telemetry、body validation 和业务 handler 前认证，覆盖 v1/v3。
  无 Authorization、重复 header、错误 scheme 或不匹配 credential 均返回原生 401；
  OPTIONS 没有豁免。比较对象是 SHA-256 固定长度摘要，并使用 constant-time compare。
- 成功只证明 service caller 身份，不决定 Tenant、Workspace、角色、权限或 Quota；
  这些仍由 Core 的既有准入链固定。没有 namespace claim 或默认 Tenant 回退。
- credential 在 API 启动时读取；更改投递文件必须重建进程才能生效。
  文件不进入源码、业务数据库、history、审计 payload 或构建上下文。
- `cmd/server/wire_gen.go` 的构造接线由上游已有 Wire 生成入口同步，不能手改生成物
  或保留旧签名来绕开认证构造失败。

三端只经 Core/BFF 消费计量能力，不取得此 credential，不直接访问计量 API。
无 schema、数据库迁移或已注册 Workflow 变化，也不修改现有 `quota_policy=NONE`。
拒绝请求没有进入业务 handler，没有外部副作用或结果不明；配置失败对应
`PRECONDITION`，服务认证失败对应 `DENIED`。其他四类平台业务错误保持原有边界。

## 实际验证与发布边界

2026-10-01 08:32 UTC 启动的这一轮镜像内验证已完整结束；
主执行者的原命令链实际退出码为 `0`，不是用容器运行中的 `ExitCode=0` 推断通过。
使用现有不可变检查镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
原生 Go `1.27.1` 来自固定上游 Dockerfile 的工具链版本，不在宿主安装或运行 SDK。
启动前回读实际执行容器为 2 CPU、4 GiB memory、4 GiB memory+swap；
运行期间同一容器出现接近 4 GiB 上限的内存回收压力，实查 `oom_kill=0`。
主执行者随后将该容器 memory 与 memory+swap 同时调整为 8 GiB，CPU 保持 2；
实际回读 `Memory=8589934592`、`MemorySwap=8589934592`、
`NanoCpus=2000000000`，`StartedAt` 保持 `2026-10-01T08:32:25.856210847Z`，
没有重启容器或重复运行构建。这是 4 GiB 启动、8 GiB 完成的验证，不是 4 GiB 完成的证明。

实际挂载为：

- `/volumes/kailo/apps/metering` → `/workspace/metering`；
- `/volumes/data/kailo/check-cache/metering-go` → `/cache`；
- `/volumes/data/kailo/tmp/codex-metering-verify-20261001.t9YIEP` → `/tmp`。

缓存、临时文件和日志均在 `/volumes/data` 的已核实目录。
原始记录：`/volumes/data/kailo/tmp/codex-metering-native-auth-20261001.log`。

容器中实际执行的是同一个 `set -euo pipefail` 命令链：

```bash
go version
gofmt -w app/common/server.go app/config/server.go
go run -mod=readonly github.com/google/wire/cmd/wire ./cmd/server
go test -mod=readonly ./app/config ./app/common ./openmeter/server
go build -mod=readonly -o /tmp/openmeter ./cmd/server
```

实际输出：

```text
go version go1.27.1 linux/amd64
wire: github.com/openmeterio/openmeter/cmd/server: wrote /workspace/metering/cmd/server/wire_gen.go
ok  	github.com/openmeterio/openmeter/app/config	0.044s
ok  	github.com/openmeterio/openmeter/app/common	0.051s
ok  	github.com/openmeterio/openmeter/openmeter/server	1.473s
```

最后的原生服务编译实际完成，无编译诊断。
Wire 同步了构造参数和错误清理路径；原生产品源码差异为
`app/common/server.go`、`app/config/server.go`、`cmd/server/wire_gen.go` 三个文件。
这是源码格式化、生成接线、既有测试包与原生服务编译的证据。
`app/common/server_test.go` 的既有测试针对 Client IP middleware，
`openmeter/server/server_test.go::getTestServer` 使用空 `RouterHooks`；
上述包测试不直接覆盖新增认证分支，不能作为认证 HTTP 正负路径的证明。

上述源码验证结束时，实际 local Compose 没有原生 OpenMeter 业务服务，未建立其原生 PostgreSQL、
ClickHouse、Kafka 运行拓扑；没有可供本项验收使用的真实应用 HTTP 入口。
原生 HTTP 正负路径、破坏核验、registry 发布产物、供应链与运行拓扑尚无通过证明；
没有新建认证 harness、mock handler、夹具或检查脚本来替代真实应用。
当时 `fork/upstream.yaml` 的 artifact/source digest 同为 `none`，没有新 Compose 服务、
公开路由、菜单、Action 或 Workflow。不能据源码写入宣布接缝闭合、Stage 4 通过
或已部署 OpenMeter。

## 原生正式镜像产物（2026-10-01）

11:47 UTC 启动的唯一正式构建经现有 `tools/build-upstream.sh metering` 完整结束，
原执行 session 的实际退出码为 `0`，服务结果为 `success`、`code=exited/status=0`，
耗时 `13min 42.184s`。没有重启构建、改动 Dockerfile、裁剪原生 binary 或调用宿主 Go。
此前的 Gateway、主线索引增量和 Web 构建已完成并交接同一 builder；启动前回读
builder 内仅有 init 与 buildkitd，没有活动编译。

实际执行身份为既有 root Docker `default` context，builder 为 `kailo-core-data`。
原共享校验器回读其容器 `CPUQuota=800000`、`CpuPeriod=100000`（8 CPU），
`Memory=MemorySwap=17179869184`（16 GiB、无额外 swap）；BuildKit 数据卷真实绑定
`/volumes/data/kailo/buildkit-core-state`。启动前 `MemAvailable=19516472 kB`、
memory PSI `avg10=0.00`。外层服务 `codex-metering-official-release-20261001.service`
另受 2 CPU、2 GiB、swap 0 限制；外层限制不替代实际编译所在的 BuildKit 限制。
临时源码上下文、模块及编译缓存、日志均由原工具放在 `/volumes/data`。

Dockerfile 与固定上游提交的文件逐字一致，SHA-256 为
`38ea1731408c92ab3accd5a2419dc902e8a956914c96f0b35ab7a5c220b04ad7`。
固定的 Go、xx 与 Alpine 镜像均保留。六个原生 binary 的编译与对应 `xx-verify`
均有真实 `DONE`，没有以只构建 server 替代完整镜像：

| binary | 原生编译路径 | 编译实际耗时 |
|---|---|---|
| `openmeter` | `./cmd/server` | 210.3s |
| `openmeter-sink-worker` | `./cmd/sink-worker` | 94.2s |
| `openmeter-balance-worker` | `./cmd/balance-worker` | 7.6s |
| `openmeter-notification-service` | `./cmd/notification-service` | 9.2s |
| `openmeter-billing-worker` | `./cmd/billing-worker` | 9.3s |
| `openmeter-jobs` | `./cmd/jobs` | 14.6s |

原工具按 Git 可见输入 `stage` 当前源码，再完成 build、load、tag、push、`record`。
4484 个构建输入文件按现有 Git 忽略规则选取；物理导入的 `.agents/`、`.claude/`、
`.codex/`、`.vscode/` 指引和编辑器文件不进入正式输入，不把该输入数称为全部 4519
文件的逐文件发布证明。上游对照中的生产改动仍只有原认证配置、hook 与 Wire 三文件。

实际本地 registry 引用为
`127.0.0.1:55000/metering:6d76d8a6fa90@sha256:4ae62517c624eb0b9be2d5a95a955c2f440278e10b26b72cf7be46436f400b14`。
地址取自现有部署 `REGISTRY_HOST` 的完整 authority，没有重复拼接 `REGISTRY_PORT`。
随后独立回读 registry manifest 为 HTTP 200，其 `Docker-Content-Digest` 与本地
`RepoDigests`、官方写回的 artifact digest 一致。官方记录为：

```text
evidence_commit=6d76d8a6fa90fbbab2d41035d31df2acec7ad3af
implementation_base_commit=6d76d8a6fa90fbbab2d41035d31df2acec7ad3af
source_digest=sha256:68710eb9ac5dd9677b23ee1d4de6c772a7b182e95ecd011a440370da74eabf93
artifact_digest=sha256:4ae62517c624eb0b9be2d5a95a955c2f440278e10b26b72cf7be46436f400b14
manifest_problems=[]
```

构建前、构建后重算与官方 `record` 的 source digest 三者一致。
构建开始时工程 HEAD 为 `14fa7833d6bfd6d089c805899002b869fadebe86`，
`metering/` 尚未提交；这不是该目录已入库或 Git push 的来源证明，实际源码由上述
工作树摘要追溯。本轮只由原工具写回来源记录的两项摘要，再补本节事后证据，
未执行 Git 提交或 push，也未增加 Compose 服务或部署镜像。

完整原始记录为
`/volumes/data/kailo/tmp/codex-metering-official-release-20261001.AmUyEl.log`，
原工具的 BuildKit 日志为 `/volumes/data/kailo/tmp/build-metering.cjDVjG.log`。
六个 binary 构建和 registry 发布成功不证明 Core-only 认证 HTTP 正负路径、破坏核验、
端到端计量、供应链全量门禁或运行拓扑已经验收；该构建批次未执行这些验收，`SS-OMT-AUTH`
未据此宣布闭合，Stage 4 未宣布通过。构建结束后回读 builder 仅有 init 与 buildkitd，
没有活动编译，资源已交回主线。

## 原生 HTTP 认证核验（2026-10-01）

12:24:41 UTC 对上述固定镜像
`sha256:4ae62517c624eb0b9be2d5a95a955c2f440278e10b26b72cf7be46436f400b14`
执行真实 HTTP 核验，命令实际退出码 `0`，结果 `native_http_authentication_pass=10/10`。
这份运行证明只对应该镜像。它的正式输入是前节记录的 4484 文件，不作为随后完整
4519 文件来源发布的证明；本次没有修改来源记录、认证源码或重新构建镜像。

依赖直接复用 `metering/docker-compose.base.yaml` 的原生 Kafka、ClickHouse、PostgreSQL
服务及其固定 digest。唯一隔离 project 为 `codex-metering-native-http-piokz9`，临时
执行 overlay 只投递资源限制、Data 数据卷与独立随机数据库口令，保留上游的命令、
健康检查及其余配置。三个固定依赖镜像的拉取真实退出 `0`，耗时 `3min 32.838s`。
没有借用 Kailo 业务数据库、修改正式 Compose、启动其他服务或接触旧 K8S。

四个容器均先 create、经现有 `tools/container-safety.sh::container_verify_limits`
回读真实 HostConfig 后才启动；运行中再回读，全部 `OOMKilled=false`，无 host 端口映射：

| 容器 | CPU | Memory = MemorySwap |
|---|---|---|
| 原生 Kafka | 2 | 1 GiB |
| 原生 ClickHouse | 2 | 2 GiB |
| 原生 PostgreSQL | 1 | 512 MiB |
| 固定镜像 API | 1 | 1 GiB |

总运行内存上限 4.5 GiB，无额外 swap。数据、日志及受控凭据均位于唯一目录
`/volumes/data/kailo/tmp/codex-metering-native-http.pIOkZ9/`。直到主线图谱真实结束且
明确释放资源后才启动；当时可用内存约 19 GiB、memory PSI `avg10=0.00`。
API 使用原生 Viper 环境配置接入私网 Kafka/ClickHouse/PostgreSQL；专用认证凭据由
`server.coreServiceTokenFile` 的只读文件投递，不加载 quickstart 的样例 meter，
不创建测试业务对象。HTTP 客户端仅在内存读取凭据，经 curl 的 stdin 配置发送，
凭据不进入参数、响应记录或正式文档。

原生 API 在 12:21:21 开始数据库迁移，12:23:40 启动业务与遥测 HTTP server。
真实 PostgreSQL `public` 下有 94 张表，`meters` 为 0 条；原生 Kafka CLI 实连成功，
列出 `om_default_events` 与 `om_sys.api_events`。两套已注册的原生列表端点返回如下：

| 请求 | `/api/v1/meters` | `/api/v3/openmeter/meters` |
|---|---|---|
| GET，缺少 Authorization | 401 + Bearer challenge | 401 + Bearer challenge |
| GET，错误 Bearer 值 | 401 + Bearer challenge | 401 + Bearer challenge |
| GET，两条相同且有效的 Authorization | 401 + Bearer challenge | 401 + Bearer challenge |
| OPTIONS，带 Origin 和 Access-Control-Request-Method、无凭据 | 401 + Bearer challenge | 401 + Bearer challenge |
| GET，唯一有效 Bearer 值 | 200，`[]` | 200，`data=[]`、分页 total=0 |

八条拒绝响应均为原生 `application/problem+json`、`WWW-Authenticate: Bearer`、
`{"type":"about:blank","title":"Unauthorized","status":401}`。
重复凭据通过两条独立 header 实际发送，不以逗号拼接值代替。有效请求进入原生
列表处理器并读取真实后端；没有 mock server、认证 harness、夹具、检查脚本或新增测试。
错误凭据和重复凭据的实际拒绝不能由有效请求的 200 替代。

启动过程中保留三项真实非通过事实：Compose 2.40.3 的 `start --wait` 返回
`unknown flag: --wait`、退出 `1`，随后使用原生文档的 `up --detach --wait --no-build
--pull never` 真正启动三服务并退出 `0`；原生 Kafka CLI 首次继承服务的 JMX 9997
导致端口冲突、退出 `1`，只清除该客户端的 `JMX_PORT`/`KAFKA_JMX_OPTS` 后实连退出 `0`，
没有修改 Kafka 服务；迁移尚未完成时 curl 返回连接拒绝、退出 `7`，该结果不是认证
失败或成功。最终矩阵只在真实业务端口可用后执行，十次 curl 均退出 `0`。

完整无凭据 HTTP 响应保留于 `http-authentication.log`；固定依赖拉取日志为
`deps-pull.log`，API 原生启动记录为 `api-startup.log`，运行限额为 `running-limits.log`，
均在上述唯一 Data 目录。该核验覆盖两套注册面的认证正负路径；没有按凭据文件缺失、
不可读或空白启动 API 进程。不证明 Core 客户端集成、CloudEvent ingest、
sink/余额/计费 worker、webhook、额度结算、完整来源发布或
Stage 4 退出门禁通过。未向正式 Kailo 拓扑部署 OpenMeter，未开放产品入口。

核验后 API 优雅停止，实际 `exit=0`、`OOMKilled=false`；仅删除本次 API 容器，
再对上述唯一 project 执行原 Compose `down --volumes`，实际退出 `0`。
随后容器与网络的精确名称过滤均无输出，四容器和私网均已删除；三份临时随机凭据
文件已删除，Data 核验证据保留，现有 Kailo 与其他应用未被停止或改动。

## 完整来源正式产物（2026-10-01）

此前 Git 忽略规则遗漏 Metering 的四个上游控制/编辑目录例外，正式 `stage` 只选取
4484 文件。主线按其他既有二开项目的相同规则补齐 `.agents/`、`.claude/`、`.codex/`、
`.vscode/` 例外，没有删除、裁剪或改写这些上游文件。独立复用原
`tools/upstream_manifest.py::source_files/source_digest` 核得输入 4519 文件，旧 source
record 与当前输入不一致；没有直接改摘要或沿用旧镜像宣称完整来源发布。

12:31 UTC 再经同一 `tools/build-upstream.sh metering` 执行完整输入的正式构建。
唯一服务 `codex-metering-complete-source-release-20261001.service`、原 session 实际
退出 `0`，结果 `success`、`code=exited/status=0`，耗时 `18min 36.143s`。
启动前 builder 内无活动编译，`MemAvailable=19465192 kB`、memory PSI `avg10=0.00`。
继续使用原 `kailo-core-data` 的实际 8 CPU、16 GiB、MemorySwap 同 16 GiB、Data
绑定缓存；外层 2 CPU、2 GiB、swap 0。未重启构建、减并行度、修改 Dockerfile、
调用宿主 Go 或改认证源码。

原生六个 binary 及其六次 `xx-verify` 再次全部真实完成：

| binary | 编译实际耗时 | 对应 `xx-verify` 实际耗时 |
|---|---|---|
| `openmeter` | 197.6s | 16.5s |
| `openmeter-sink-worker` | 84.3s | 0.9s |
| `openmeter-balance-worker` | 9.2s | 0.9s |
| `openmeter-notification-service` | 7.8s | 0.9s |
| `openmeter-billing-worker` | 10.0s | 0.9s |
| `openmeter-jobs` | 15.1s | 1.2s |

原工具完成完整 `stage`、build、load、tag、registry push 和 `record`，唯一算法重算
source 与官方记录一致；本地 `RepoDigests` 与随后 registry manifest 的 HTTP 200、
`Docker-Content-Digest` 均与官方 artifact 一致：

```text
source_files=4519
evidence_commit=6d76d8a6fa90fbbab2d41035d31df2acec7ad3af
implementation_base_commit=6d76d8a6fa90fbbab2d41035d31df2acec7ad3af
source_digest=sha256:ed9e0dd5081c05f5dd51544879df7292668a49e889b32d7d304b786106c939ea
artifact_digest=sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783
registry_source_artifact_match=true
```

实际发布引用为
`127.0.0.1:55000/metering:6d76d8a6fa90@sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783`。
再次执行原来源工具的 `diff metering --check` 退出 `0`：`remove_paths` 与实际一致、
0 项删除；`--name-status` 只列 `app/common/server.go`、`app/config/server.go`、
`cmd/server/wire_gen.go` 三个原认证生产改动。完整 BuildKit 原始日志为
`/volumes/data/kailo/tmp/build-metering.BepuNQ.log`。

新镜像完整来源发布与前节旧 `4ae625…` 镜像的 HTTP 10/10 是两份独立证明；没有将
旧镜像的运行核验改标为新镜像已验收。构建批次未执行新镜像 HTTP；随后对新固定
镜像的独立运行证明见下一节。Core 客户端集成、Quota 与计量端到端链仍未交付，
发布 gate 未通过，Stage 4 总退出门禁未据此宣布通过，也未向正式拓扑部署 OpenMeter。
工程仍处于工作树变更，registry push 不是 Git 提交或 push；本线未 stage、提交或
push。构建后实际 builder 内仅 init 与 buildkitd，无活动编译，资源已交回主线。

## 完整来源镜像的 HTTP 认证核验（2026-10-01）

13:46:49 UTC 对完整来源的固定镜像
`sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783`
重新执行原生 v1/v3 十项 HTTP 检查，实际退出码 `0`，
`native_http_authentication_pass=10/10`，十次 curl 均退出 `0`。
这次实际运行只对应新镜像，不由旧镜像的结果或可执行文件字节相同比较推导。

继续复用原 `metering/docker-compose.base.yaml` 的三个固定依赖及原核验步骤，
仅使用唯一隔离 project `codex-metering-final-http-y5mmox` 和 Data 目录
`/volumes/data/kailo/tmp/codex-metering-final-http.y5MMox/`。
临时 overlay 仍只投递原 4.5 GiB 总上限、Data 卷和独立随机 PostgreSQL/ClickHouse
口令；凭据文件权限 `0600`，服务凭据只读投递到 `/run/secrets/core-token`，
curl 通过 stdin 配置取得内存中的凭据，不进入参数或证据日志。
没有新增业务 seed、harness、夹具、检查脚本、编译或正式部署。

直到并行 16 GiB 全量门禁真实退出并清理其容器后才启动。
13:40:46 的实际 preflight 为 `MemAvailable=19436736 kB`、memory PSI `avg10=0.00`。
四容器 create 后、start 前及运行中均回读 HostConfig，与前节的四项 CPU/内存限额
逐项一致，MemorySwap 等于 Memory，总上限 4.5 GiB、无额外 swap、无宿主端口映射；
四容器均 `OOMKilled=false`。三个原生依赖健康检查通过，启动命令退出 `0`。
API 在 13:42:26 开始原生迁移、13:44:39 启动业务与遥测 server；实际命令为
`openmeter --address 0.0.0.0:8888`，没有额外配置文件或 quickstart meter。
真实 PostgreSQL 有 94 张 public 表、0 条 meters；Kafka 原生 CLI 实连读到
`om_default_events` 与 `om_sys.api_events`。

`/api/v1/meters` 与 `/api/v3/openmeter/meters` 分别执行缺少凭据、错误 Bearer、
两条独立且有效的 Authorization、带 Origin 和 Access-Control-Request-Method 的
未认证 OPTIONS、唯一有效 Bearer 五项请求。前四项全部返回原生
`401`、`WWW-Authenticate: Bearer` 与 `application/problem+json`；
有效请求分别返回 `200` 的 `[]` 与 `data=[]`、分页 total=0。
首次启动这组客户端时 shell 引用错误导致 SyntaxError、退出 `1`，当时未发出 HTTP；
改为正常 stdin heredoc 后执行的上述十项才是实际认证结果，不把启动错误当作认证失败。

13:49:09 清理完成，清理命令退出 `0`：API 优雅退出 `0`、`OOMKilled=false`，
精确删除本次四个容器与唯一私网；容器、网络及三份临时凭据的残留计数全部为 `0`。
真实凭据未出现在保留日志中，现有 Kailo 与其他应用未被重启或改动。
原始 HTTP 矩阵为 `http-authentication.log`，完整原生启动为 `api-startup.log`，
限额为 `created-limits.log`、`running-limits.log`，后端事实为
`backend-final-receipt.log`、`backend-table-count.log`，清理为 `cleanup.log`，
均保留在上述 Data 目录。

本节只证明完整来源固定镜像的两套原生 API 认证与真实列表处理路径；没有执行凭据
文件缺失、不可读或空白的启动反验。Core consumer、Quota、CloudEvent ingest、
sink/余额/计费 worker、webhook 与端到端结算未交付，发布 gate 仍未通过。
不据此宣布 `SS-OMT-AUTH` 全范围闭合、Stage 4 总验收完成或产品入口已开放。

## Core Customer 消费与隔离迁移核验（2026-10-01）

本增量遵循 `.design/03` §8、`.design/11` 与 `DD-38/99`，复用当前 Tenant
生命周期和销毁工作流，没有新建 Quota 服务、计费账本、意图表或公共路由。
基线 HEAD 为 `14fa7833d6bfd6d089c805899002b869fadebe86`，下述业务源码仍是
该 HEAD 之上的未提交工作树内容；原生 `metering` 来源与镜像仍是上一节的固定记录。

### 已写入的实际调用链

- `core/crates/platform-core/src/openmeter.rs` 的 `OpenMeter` 通过独立 Core credential
  访问原生 Customer API，必填 URL、namespace、timeout 与 token file；
  `customer_by_key` 核对完整分页与稳定 Tenant UUID key，`customer_by_id` 核对原生 ID/key。
- `tenant_lifecycle.rs::provision_tenant_buzz` 与 `verify_tenant_buzz` 已调用
  `reconcile_metering_customer`。消费者持 Tenant 行锁核对 `PROVISIONING` 和版本，
  使用同一生命周期 WorkflowRef 与获准 ActionExecution，不取任意最新动作。
  首次 POST 之前持久化同 operation 的 DISPATCH；未知结果先查 exact key，
  未查明时保持 UNKNOWN，不自动再 POST。ACTIVE binding 缺失 native Customer 时不重建。
- `projection.openmeter_binding` 只保存 Tenant、namespace、customer ID、subject prefix、
  status 与 version 六字段；原生 ID/key/active 状态查明后才写 ACTIVE，
  不保存 Customer 正文、用量或账单副本。已 DISPATCH 后的观察失败按 UNKNOWN 返回，
  不因后续传输错误把可能已发生的副作用投影成 FAILED。
- `governance.rs` 冻结同一 binding，`tenant_delete.rs::retire_openmeter` 消费该快照，
  查证原生逻辑退役后在一个事务中写 REVOKED、保留 ID 墓碑和最小 provider evidence。
  空 binding 不代表 native 不存在，准入拒绝；这不是物理清除 billing/usage 的处理器。

上述原生边界亲核固定 commit `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`：
`openmeter/customer/service/customer.go::Service.DeleteCustomer` 调用删除并回读；
`openmeter/customer/adapter/customer.go::adapter.DeleteCustomer` 在 Customer、subject
及 app association 上写同一 `deleted_at`，不是物理删除。
同文件 `adapter.GetCustomer` 的 ID 查询保留墓碑、key 查询只返回 active 对象；
`WithSubjects` 对已删除 Customer 仍可返回同时间退役的历史 subjects。
`api/v3/handlers/customers/upsert.go::handler.UpsertCustomer` 拒绝更新已删除 Customer。
因此 `retire_customer` 不单认 DELETE `204`：还需 exact ID 墓碑和 active exact-key 不再出现，
不能要求历史 subject 数组为空。账单、Usage 与墓碑引用的保留遵循原有 `DD-43`。

### 镜像内源码检查

既有 `tools/check.sh verify` 在固定检查镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
中实际退出 `0`，原输出为 `cargo test`、`go test`、`node --test（TypeScript）`、
`dart test` 四项 PASS。实际 create 后回读为 8 CPU、8 GiB memory/memory+swap，
启动前检查已有构建进程与资源压力，缓存与临时源码 export 位于 Data。
镜像实际版本是 Cargo/Rust 1.90.0、Go 1.25.14、Node 24.21.0、Dart 3.9.4。
原始日志为 `/volumes/data/kailo/tmp/codex-openmeter-current-verify-20261001.wnroy3.log`，
内侧日志为 `/volumes/data/kailo/tmp/tmp.FJPMuqLIYm.check.log`。
该快照之后的一行 Clippy 修正已由随后原入口 `tools/check.sh lint` 重新核验，实际退出 `0`，
输出为 cargo fmt/clippy、gofmt/go vet、tsc、dart analyze 六项 PASS。
原始日志为 `/volumes/data/kailo/tmp/codex-openmeter-core-lint-20261001.CxrrU4.log`，
内侧日志为 `/volumes/data/kailo/tmp/tmp.rLv2u79jVw.check.log`。
上述两个独立步骤不等于 full、最新产物部署或 Core Customer 真实 HTTP 验收。

Compose、`.env.example`、bootstrap 和初始化调用已接入同一客户地址、namespace、
token file 与显式资源投递；bootstrap 与 `docker compose config --quiet` 实际退出 `0`。
记录为 `/volumes/data/kailo/tmp/codex-openmeter-compose-bootstrap-20261001.g2mfbi.log`。
配置解析与凭据文件生成不是正式服务启动、迁移部署或 Core Customer 端到端通过。

### 真实空库迁移与离线查询检查的边界

本次只创建唯一私网 `codex-omt-migrate-z9gtfn` 和空 PostgreSQL，未借用、清空或
修改任何现有业务数据库。数据库镜像取自真实 Compose 的 `core-db.image`：
`postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`。
数据库实际限额 1 CPU/512 MiB、SQLx 检查容器 1 CPU/1 GiB，均在 create 后、start 前核对，
memory+swap 等于 memory；无宿主端口发布，凭据由自有随机文件投递，不回显。

同一固定检查镜像内 SQLx 0.8.6 实际执行既有迁移命令
`sqlx migrate run --source /workspace/core/migrations` → `revert` → `run`，退出 `0`。
空库前进应用 37 条迁移，最大版本 `20261001020000`；回退实际执行
`20261001020000_openmeter_binding.down.sql`，catalog 确认该表已移除；再前进重建该表。
六列类型与 NOT NULL、Tenant FK、namespace/customer ID 唯一、ACTIVE|REVOKED CHECK
及 version 正值约束逐项核对，业务行数为 `0`。这只证明空表回退路径，不证明有业务引用时
可回退。原始输出保留于
`/volumes/data/kailo/tmp/codex-openmeter-migrate-20261001.z9gtFN/migrate.log`。

`cargo sqlx prepare --check --workspace` 没有完成，不能用上述 catalog 核对替代：
首次自有 launcher 使用 login shell 导致 `rustc: command not found`，退出 `127`。
纠正为非 login 后，SQLx 因源码只读不能更新 mtime，自动 fallback 清理编译缓存，
实际输出 `Removed 11124 files, 3.5GiB total`；随即停止该检查，退出 `137`。
被清理的是 Data 中可重建的 Rust target，不是源码、registry/git 缓存或业务数据。
两个真实失败分别留在同目录 `prepare.log` 与 `prepare-corrected.log`。

随后改走唯一原入口 `tools/check.sh migrate` 的可写私有源码 export，
实际检查镜像仍相同，限额回读为 8 CPU/16 GiB、无额外 swap。
首次被 sudo 移除 TMPDIR 而拒绝启动；只对非敏 TMPDIR 纠正投递后，原入口在
统一依赖安装阶段因内部私网无法解析 npm registry 返回 `EAI_AGAIN`，实际退出 `2`，
没有进入其迁移或 prepare 步骤，也没有重启本轮。
记录为 `standard-migrate.log`、`standard-migrate-corrected.log`，内侧原日志为
`/volumes/data/kailo/tmp/tmp.R2sXs3x6UY.check.log`；这不是产品 migration 失败。

19:22 UTC 精确清理本次三个自有容器、唯一网络、临时数据库目录和凭据，
清理实际退出 `0`，容器、网络、凭据与数据残留均为 `0`；非敏日志仍保留。
清理记录为同目录 `cleanup.log`，现有 Compose、其他应用与 K8S 未被本核验操作。

本节记录结束时不证明 Core→Customer 创建/恢复/退役真实 HTTP、撤销并发、UNKNOWN 破坏核验、
Quota 准入、CloudEvent ingest、usage commit 或账单链通过，当时没有正式 Compose
部署证据。能力记录保持 `in_progress`、`exposure: none` 与原关闭 gate，
不宣布 Stage 3/4 总退出门禁或 `SS-OMT-AUTH` 全范围闭合。

## 正式 Compose 运行与本轮门禁（2026-10-01）

随后只对 `platform-local` 的四个 OpenMeter 服务使用已有配置和固定镜像执行
`docker compose create --no-build` 与 `up -d --wait --no-build --no-recreate`，
两条真实命令均退出 `0`；没有编译、重启 Core/Worker 或重建其他项目服务。
固定 API 镜像为 `sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783`。
API、PostgreSQL、Kafka、ClickHouse 的真实 memory/memory+swap 分别为
1 GiB、512 MiB、1 GiB、2 GiB，CPU 分别为 1、1、2、2，总内存上限 4.5 GiB，
无额外 swap、无宿主端口绑定；四服务 healthy、`OOMKilled=false`。
三依赖只在其私有数据网络，API 另接既有 app 网络，数据卷和正式服务保留运行。
38 个既有容器的 ID、StartedAt、status 逐一核对全部不变。

这次对正式运行 API 重做 v1/v3 的缺失、错误、重复 Authorization、无认证 OPTIONS
与唯一有效 Bearer 五项请求，结果分别为 401/401/401/401/200，真实矩阵 10/10。
有效凭据只在容器内读挂载文件，不打印正文或放入客户端 argv。
`GET /api/v3/openmeter/customers` 返回 `200`、空 data、分页 total=0；原生 PG
Customer 总数为 `0`。没有创建 Customer、subject、meter 或业务种子。
配置 namespace 与原生 API default namespace 一致，但运行中的旧 Core 没有
`OPENMETER_NAMESPACE`；本次没有重启它，零 Customer 不证明映射或退役消费者执行过。
原始记录目录为 `/volumes/data/kailo/tmp/codex-openmeter-compose-runtime-20261001.F4B39C/`，
总回执为 `runtime-receipt.md`，部署、限额、HTTP、PG、baseline 分别见该目录
`create.log`、`start.log`、`created-limits.log`、`final-receipt.log`、
`http-authentication.log`、`native-db-readonly.log`、`baseline-scoped-receipt.log`。

早期诊断错误地把全机新增容器限定为本 lane 四个，因并行临时容器而退出 `1`；
后一次回执只核本 lane 与真实 38 个 baseline，没有重做部署或覆盖先前失败。
父代理已确认 `/hopeful_shaw`（ID 前缀 `da1f505`）是其负向 SDK 检查临时容器，
不是据未知归属推断的第三方服务；本 lane 未停止或删除它。

正式 ClickHouse 固定镜像
`sha256:74da41cd61db84f652c6364fd30d59e19b7276d34f7c82515f5f0e70d6f325da`
的入口脚本只读核对退出 `0`，证据为同目录 `clickhouse-entrypoint-argv.log`：
第 46–48 行支持 `CLICKHOUSE_PASSWORD_FILE`，第 206 行仍通过内部
`clickhouse-client --password` argv 使用读取的值。这是原生脚本的真实限制，
没有打印口令或宣称全过程 argv 保密。

未部署的配置破坏核验把 Compose `NAMESPACE_DEFAULT` 来源从
`OPENMETER_NAMESPACE` 改为 `OPENMETER_HOST`，原 `tools/check.sh security`
实际退出 `1`，报 `openmeter.NAMESPACE_DEFAULT: 必须从公共配置派生，不得独立维护`。
立即还原后同一入口实际退出 `0`；未用错误配置重建或重启任何服务。
两次日志为 `/volumes/data/kailo/tmp/codex-openmeter-namespace-break-20261001.AW0d9V.log`
与 `/volumes/data/kailo/tmp/codex-openmeter-namespace-restored-20261001.TCkGGf.log`。

同批原 `tools/check.sh --full` 会话 43340 实际退出 `0`，使用前述固定 10ad 检查镜像，
真实限额为 8 CPU/16 GiB、无额外 swap；原始日志为
`/volumes/data/kailo/tmp/codex-openmeter-batch-full-20261001.vcPz0t.log`，
内侧为 `/volumes/data/kailo/tmp/tmp.cS4LJgxieW.check.log`。
该次未提供 DATABASE_URL，实际迁移/SQLx prepare 跳过；没有向 SDK export 投递实际
`deploy/local/.env`，部署配置预检也明确 SKIP。gitleaks 未安装，只运行内建扫描；
Mobile upload keystore 未提供，签名仍阻断。独立空库 37 条迁移演练结果仍只对应前节，
不能补记为 full 的迁移步骤或 SQLx prepare 已通过。

上述源码与运行证据不证明 Core Customer 创建/恢复/退役端到端、Quota、CloudEvent、
usage commit 或账单链完成。GitNexus 变更结果的 103999 符号列表受 1000 硬上限截断，
无官方分页，仍为 truncated，不能视为完整提交前门禁；本批没有 commit/push。
能力状态、产品 exposure 与关闭 gate 不变，不宣布 Stage 3/4 总退出门禁完成。

## 新 Core 开发部署与真实适用对象（2026-10-01）

随后使用既有 Compose `build core-bff` 与原 `start-core.sh --no-build`，仅替换 Core。
真实 BuildKit 仍为 8 CPU、16 GiB memory/memory+swap、Data 绑定缓存，未减 Cargo
并行度；固定 Rust 1.90 镜像内 release 编译实际退出 `0`、耗时 4 分 2.262 秒。
172 个实际 Docker COPY 输入和配方/allowlist 的构建前后摘要一致：
`e3a1e647beb919f5667127c52d4222baaf6de94078893d016e4a87b019b22d88`。
HEAD 为 `14fa7833d6bfd6d089c805899002b869fadebe86`，该输入来自冻结脏工作树，
不能冒充该提交的 clean tree 或正式 release/provenance。

实际 image ID 为
`sha256:03c24669bc20e2e27f0c2d254cfc73f681c5902cca10d5568e8cb0136fe4c776`。
启动脚本重新取得三份一次性 wrapped credential，原启动会话退出 `0`；新容器
running、RestartCount=0、OOMKilled=false，`/healthz` 实测 `200`。
Compose 没有 Core Docker Healthcheck，不将 running 称为 Docker healthy。
Core 的四项 OpenMeter 投递存在，实际 namespace 与原生 API 同为 default。

部署前业务库为 36 条迁移；现有不可变 10ad 检查镜像内 SQLx 0.8.6 仅执行
`sqlx migrate run`，实际退出 `0`，前进到 37 条、最大版本 `20261001020000`、
全部 success=true，新增 projection 存在。该迁移容器实际为 2 CPU/2 GiB、无额外
swap，只连现有 core-data，受控连接串仅通过 stdin 使用，结束后准确移除。
没有对业务库运行 revert，也没有据此前进结果宣布 SQLx prepare 已完成。

对现有 Core `/service/v1/task-projections` 使用缺失凭据、错误凭据和真实 Worker
IdP client_credentials 身份分别得到 `401`、`401`、非法空体 `400`，三项检查退出
`0`、3/3。第三项只证明服务身份认证后仍拒绝无效业务载荷，未创建投影，不是
Core→OpenMeter 客户映射的 HTTP 验收。
42 个部署前容器中只改变 Core 的 ID、image 与 StartedAt；其余 41 个全部原样，
Worker、Web、Relay、Gateway、OpenMeter 四服务和其他项目均未重建。

只读适用性查询实际退出 `0`：现有三个 Tenant 全为 ACTIVE、PROVISIONING=0、
OpenMeter binding=0；配置的业务 bootstrap Tenant 已为 ACTIVE/version=2。
首读误用 `tenant.status` 字段退出 `3`，只纠正查询为真实 `tenant.state` 后重读，
没有修改库状态。这次没有现存客户创建链适用对象；未执行 `init-local.sh` 或
`--fresh`，没有把 ACTIVE 改回 PROVISIONING，也未创建测试 Tenant/Customer。
映射、结果不明恢复与逻辑退役端到端仍未实测，零对象不是这些场景的 PASS。

完整原始输出和恢复边界保留于
`/volumes/data/kailo/tmp/codex-core-deploy-20261001.38qKQu/deployment-receipt.md`。
旧镜像只保留为恢复 tag；恢复未执行，恢复时仍须重新 wrapping，不能 restart 旧
一次性投递。没有 registry push、Git commit/push、正式发布或产品入口开放。

## 同批初始化入口与集中门禁（2026-10-01）

既有 `deploy/local/init-local.sh` 不再要求或执行宿主 SQLx，直接消费 bootstrap
生成的同一受控连接文件，以 stdin 交给现有检查镜像内 SQLx；实际私网从 Core
数据库容器读取，不维护第二连接串或新增迁移服务。其资源与 Data 目录边界复用
`tools/container-safety.sh`，SDK 镜像按现有配方 SHA 查找、按实际 image ID 执行。
源码复核纠正了可用内存拒绝前提丢失和 attach 失败未查询终态两处回归；没有通过
调低 Cargo 并行度、猜测 builder 名或新增安全检查脚本替代现有边界。

最终入口源码 SHA-256 为
`fbff223746c22348e18fd1454b7690e7902683b69266a5d025c0882bb7d998d3`。
`bash -n`、`git diff --check` 与原初始化顺序静态检查均退出 `0`；主动注释实际
`bootstrap.sh --validate-config` 后，同一检查报错、退出 `1`，立即还原后退出 `0`。
本次没有执行 initializer、`--fresh` 或新的迁移容器启动，不宣称新增 attach/wait
路径、从零环境初始化或客户生命周期已经端到端通过。

随后对冻结工作树运行原 `tools/check.sh --full`，会话 61758 实际退出 `0`。
SDK 仍为前述固定 `10ad51a2…` 镜像，启动前实际回读 8 CPU、16 GiB memory 与
memory+swap；缓存、临时源码与日志位于 Data，未调用宿主项目工具链或重建 Core。
Rust/Go/TypeScript/Dart 静态与既有检查、四侧生成、90 个 schema 兼容比对、
Workflow replay、16 条追溯与 18 个封闭 kind、18 项产物来源及现有安全/文档门禁
通过。未提供演练库 DATABASE_URL，实际迁移与 SQLx prepare 明确跳过；未投递
实际 `.env`，部署配置预检跳过。gitleaks 未安装，只运行内建扫描；Mobile 签名
仍阻断。全量退出码不替代这些运行或发布证据。

原始外侧日志为
`/volumes/data/kailo/tmp/codex-init-container-batch-full-20261001.Fx9c81.log`，
内侧日志为 `/volumes/data/kailo/tmp/tmp.rKmTEHXI76.check.log`。
图谱 fresh/impact 是上述源编辑之前的回执，不冒充编辑后的 fresh 状态；
原生变更检测截断的提交阻断未解除，本批仍无 Git commit/push。

## 原生双阶段去重与 sink 消费者（2026-10-01）

本增量只接入现有计量底座的真实消费者：`deploy/local/compose.yaml` 中 API 与
`openmeter-sink-worker` 共用一份 `configs.content` 原生 YAML，ingress 与 sink 均为
`enabled: true`、`driver: redis`、`mode: rawkey`。两阶段的逻辑库不同，由唯一
`.env` 投递；不是两份独立配置或 Core 的第二份额度、用量账本。
固定 OpenMeter 镜像仍为前述 `98817216…6783`，没有改上游去重源码或重建镜像。
独立 Redis 固定为
`redis@sha256:c6e4a82ce60b829a72a21cc4ad4c1c274fa6962eb0d6ac698e8157cbc3fe16a4`，
只接 `openmeter-data`、使用自己的持久卷、没有宿主发布端口。
其原生 AOF `always` 与 `noeviction` 不做可关闭的绕行开关；资源值是部署预算，
不是用户数、事件数或商业额度上限。当前本地 expiration 为原生 `0`，不自动过期。

固定上游 `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的实际消费证据为：

- `app/config/dedupe.go::ConfigureDedupe` 与 `app/config/sink.go::ConfigureSink`
  默认分别关闭 ingress、sink 去重；`DedupeConfiguration.DecodeMap` 读取真正的 YAML bool。
- `app/common/openmeter_server.go::NewIngestCollector` 与
  `app/common/openmeter_sinkworker.go::NewSinkDeduplicator` 消费对应配置并构造原生 driver。
- `openmeter/dedupe/redisdedupe/redisdedupe.go::Deduplicator.IsUnique` 以
  namespace、source、event ID 生成同一索引键；共用逻辑库会让 sink 看到 ingress 的键。

`bootstrap.sh` 复用原预检拒绝缺输入、同逻辑库、索引越界、未知或溢出的原生
duration、配置文件覆盖 token 挂载与 Redis 容量超过其容器预算。
实际同库错误投递返回 `1`：`OpenMeter ingress 与 sink 去重不可共用逻辑库`；
未知 expiration 返回 `1`：`OPENMETER_DEDUPE_EXPIRATION 必须是非负的原生 Go duration`。
两次立即还原后原预检均返回 `0`，bootstrap 前后 SHA-256 同为
`bdc6d01b22198bfb56df63740ff55e4e6d4e1049d19cfdeb0d7de71e917ca81d`。
父代理对实际 `.env` 再运行同一预检退出 `0`，日志为
`/volumes/data/kailo/tmp/codex-dedupe-parent-preflight-20261001.a9iwWG.log`。
`init-local.sh` 既有启动行已加入真实 sink，并保留原 `--wait --no-build`；未运行
initializer 或 `--fresh`。该入口当前 SHA-256 为
`dfea94e18c2538db15c519cdedc9d7c2f5ddee83edec494497cd945fa13d2649`。

实际原生配置校验记录保留在
`/volumes/data/kailo/tmp/codex-metering-dedupe-runtime-20261001.pG7Xxz/`。
首次直接 `docker start` API 校验退出 `1`，真实报错为
`open /etc/openmeter/config.yaml: no such file or directory`：内联配置由 Compose
启动入口投递，不能以裸 Docker start 代替。随后一次 sink 校验退出 `0`，但其
限额只在退出后回读，不计作本轮合规验收。最终两个独立校验容器均先在 created
状态回读实际 1 CPU/1 GiB memory 与 memory+swap，再由原 Compose start 投递配置；
API 与 sink 原生 `--validate` 均退出 `0`、无 OOM，准确移除两容器及其私网。
完整输出为 `native-validate-created-corrected-limits.log`、
`native-validate-corrected-results.log` 与 `native-validation-cleanup.log`。

需求对照与工程红线分别复核了四个部署文件，未发现本增量的硬违规；配置图节点
UNKNOWN/缺失不冒充完整调用覆盖。此处只证明原生配置、投递与消费入口，尚不能
证明事件去重、202 后 commit 对账、credit 吸收或端到端结算；没有造 meter、
Customer、事件或模型调用充当适用对象。Redis 无认证是明确记录的运行期私网
边界，不能冒充身份认证。原生 Redis/Kafka/ClickHouse 之间的崩溃窗口仍存在，
AOF 与双侧去重不构成跨系统 exactly-once 证明。

本批未改变 Core 的 `quota_not_yet_enforced` 约束、Quota 入口或策略。固定同一
上游的 `openmeter/entitlementaccess/entitlementaccess.go::QueryInput` 明确将
`IncludeCredits` 标为未实现；不能仅发送 `include_credits: true` 就宣称完成 credit
检查。Core Quota、UsageEvent/outbox、commit 与 reservation 终结机制未据本增量交付，
不能宣布 Stage 4 总退出门禁或生产就绪。

### 正式限定部署与本批全量门禁

随后原 Compose 对 API、sink、Redis 三个目标实际 create，分别在 created 状态
核验 CPU、memory/memory+swap，才执行原 `up --wait --no-deps --no-build`。
会话 48037 实际退出 `0`，三个目标 healthy、RestartCount=0、OOMKilled=false；
API 与 sink 各 1 CPU/1 GiB，Redis 1 CPU/512 MiB，无额外 swap。
两容器实际载入配置的 SHA-256 同为
`c66358804d842bf981bc87829ddbf4f62f7dedd6148a90d731fbe318cd5de54d`。
实际 Redis 查询确认 databases=2、DB 投递分别 0/1、maxmemory=268435456、
appendonly=yes、appendfsync=always、maxmemory-policy=noeviction、
aof_last_write_status=ok；`/data` 使用专属 named volume。

v1/v3 原生 HTTP 认证再次通过 10/10；v3 meter/customer 列表实际为 `200`、
data=[]、total=0，不制造业务数据进行验收。部署前 42 项基线中 API 是唯一
替换项，其余 41/41 的 ID、image、StartedAt 与状态不变，PG/Kafka/ClickHouse
三个后端逐项相同。数据网络六项成员均属于 OpenMeter；API 唯一跨接 app，
sink、Redis 及三个后端只接所有者数据网络，无宿主发布端口。真实网络属性为
`Internal=false`，没有将 owner-only/无端口发布写成 Docker internal=true 或无外连。

完整真实回执为同一 Data 目录的 `runtime-receipt.md`，原始配置、限制、认证、
只读对象、基线对比与精确临时资源清理日志均在该目录。额外保留了 HTTP 外层
shell quoting 展开未设变量的退出 `1`、基线 JSON 读取格式错误的退出 `1`；
两者均只纠正原调用后重验，没有据失败步骤宣布通过或重做部署。

本批唯一集中原 `tools/check.sh --full` 会话 62047 实际退出 `0`。不可变 SDK
image ID 为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际启动前回读 8 CPU/16 GiB memory 与 memory+swap；Data 缓存、源码导出与日志，
没有调用宿主项目工具链、重建 SDK/Core 或重跑索引。格式、静态检查、四侧既有
验证、90 schema 兼容、replay、16 追溯与 18 封闭 workflow kind、18 产物来源、
30 服务安全和文档门禁通过。未提供 DATABASE_URL，迁移演练与 SQLx prepare
明确跳过；SDK 不导出 ignored 的实际 `.env`，其部署配置预检 SKIP，真实输入已
由原 bootstrap 与两个原生 CLI 分别验证。gitleaks 未安装，只运行内建扫描，
Mobile 签名仍阻断。外侧日志为
`/volumes/data/kailo/tmp/codex-dedupe-batch-full-20261001.ZFfgyY.log`，
内侧为 `/volumes/data/kailo/tmp/tmp.yH1t2cNczc.check.log`。
全量退出码不证明用量、Quota、结算或客户生命周期已端到端完成。

四文件与五文档的前置 impact 使用本批编辑前 fresh 基线；本节未将编辑后的
整树描述为 current。原生变更检测的硬截断仍未解除、门禁例外未获确认，本批
没有暂存、Git commit/push 或生产 release。

## 原生列表截断的授权处置（2026-10-02）

用户已批准以后同类问题沿用限定处置，唯一规则入口为
[工程守则](../../../AGENTS.md)「代码检索与影响门禁」。此前未获批准、未提交的
记录是对应时点的事实，不改写为历史门禁通过。

已读当前安装的 GitNexus 1.6.12 原生 `local-backend.js`：
`DETECT_CHANGES_MAX_LISTED_SYMBOLS` 只在返回时截取 `changed_symbols`；
`summary.changed_count` 读取完整 Map 的大小，流程查询分批消费完整 Map 的键。
`partial` 独立反映查询失败，不能由列表截断处置豁免。原生 CLI `--limit`
只是结果返回后的再次切片，CLI 与 MCP 都没有该列表的分页或上限配置。
源码和原始输出保留于
`/volumes/data/kailo/tmp/codex-gitnexus-detect-native-cap-20261001.RkXVOV.log`。

该授权解除的是纯列表截断的审批阻断，不是计量业务或发布验收。
本节写入前实际 `status --json` 退出 `0`，runner schema 4/current、
`incompleteReasons=[]`，但 `contentDrift` 为八个路径、总状态 `stale`；
因此没有把旧检测结果当作本次提交门禁，尚未据本节提交或 push。

## CHECK 准入源码与核验（2026-10-02）

### 权威、影响与执行边界

依据 `.design/05` §1、§6、`.design/11` §3、`DD-07/38/51`、ADR-14 决策3
与 `apps/02` §6，额度事实只由 OpenMeter entitlement/credit 决定。
实现位于 `core/crates/platform-core/src/openmeter.rs::OpenMeterClient::check_quota`、
`governance.rs::Governance::check_quota`、同文件确认后与审批后准入调用点；
`main.rs` 共享一个既有 OpenMeter 实例，结果存既有 ActionDecision，不建第二账本。
meter key 先解为原生 ID，按该 ID 列举全部 feature 分页，再读取真实 Customer 的
entitlement-access 与展开的 value。credit Numeric 保留原生十进制语义，不转为
浮点余额、不以自定余额阈值覆盖 soft-limit；缺失、歧义和未知响应均拒绝。

固定上游为 `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`：
`api/v3/client/models_shared.go::Feature`、`api/v3/client/models_entitlements.go::EntitlementAccessResult` 与
`api/v3/handlers/customers/entitlementaccess/convert.go::mapEntitlementAccessToAPI`
定义 meter 关联、access/value 与 NoAccess 的实际 wire 语义。
复核以该版本源码为准，没有调用标为未实现的 IncludeCredits 充当 credit 证据。

编辑前 impact 已明确告警：evaluate、record_decision、Evaluation、close_gate
为 CRITICAL，allow_in_tx、Tenant lifecycle、取消/重跑为 HIGH；UNKNOWN 的
main/schema 消费者另按实际 Arc 接线、SQL 约束和四侧生成检查，不冒充零风险。
原始结果在 `/volumes/data/kailo/tmp/codex-core-quota-preimpact-20261002.raw.jsonl`、
`codex-core-quota-symbol-impact-20261002.raw.jsonl` 与
`codex-core-quota-main-impact-20261002.raw.jsonl`。

源码边界（不是端到端 PASS）：

- 认证、scope、fresh permission、确认及审批仍先由原治理链处理，DENIED 不短路。
- NONE+空 meter 立即返回 NOT_APPLICABLE，无计量查询；CHECK 缺 ACTIVE binding
  为 PRECONDITION。异步查询前后再次比对 binding/customer，防止沿用失效引用。
- 原生无 access 为 LIMIT/QUOTA_EXHAUSTED；依赖不可得、未知枚举或结果不可查证
  为 UNKNOWN，不写成额度耗尽或成功；不记录用量正文或凭据。
- CHECK 与 STRICT 正向派发继续 BLOCKED；本刀没有 producer、副作用、UsageEvent、
  reservation 或新重放路径，不声称解决额度查询后到执行前的并发耗尽。
- 确认/审批重入、幂等与 CONFLICT 沿用原 ActionDecision/事务边界；并发、撤权、
  暂停、投影落后、超时和崩溃恢复未因源码复核变为已运行验收。

新 `20261002000000_quota_check` up/down 迁移只允许 NONE+空 meter 或结构有效
的非空 CHECK，STRICT 不开放，不创建或改写动作。存在 CHECK 定义时 down 的
旧 NONE 约束明确失败、停止回退，不能默默降成 NONE。该新迁移尚未在数据库执行。
Web/Desktop 继续共用 TS 文案；Dart 由同一目录生成；管理面都经 BFF，未加 Mobile
写入口、Web 私钥或 Relay 直连。既有动作仍为 NONE，不制造对象作为验证适用对象。

### 已执行结果与尚未验收范围

同一不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
在启动前核实资源限额。生成容器为 4 CPU/6 GiB、缓存与临时数据在 Data；
`tools/gen.sh`、`cargo fmt --all`、`tools/gen.sh --check` 退出 0，四侧契约与
TS/Dart 同源原因码一致。完整输出为
`/volumes/data/kailo/tmp/codex-quota-generate-final-20261002.log`。
第一次错误使用 login shell 覆盖 SDK PATH，Dart/rustfmt 不可得、文案比对退出1；
修正容器调用为保留 SDK PATH 的 shell 后重跑通过，未放宽生成器或检查器。
失败原文保留在 `codex-quota-generate-20261002.log`。

原 `tools/check.sh lint` 在 8 CPU/12 GiB 检查容器中实际退出 0：cargo fmt、
全 targets clippy（warnings 为错误）、gofmt、go vet、TS typecheck、Dart analyze
通过。外层日志为 `/volumes/data/kailo/tmp/codex-quota-lint-20261002.log`，
内层为 `/volumes/data/kailo/tmp/tmp.lc8XIpIS0q.check.log`。
合同与工程红线两轴事后复核未发现本刀确定可达缺陷；历史 File.content 只用于
区分继承改动，不作 fresh 提交门禁。未新增测试、夹具或检查脚本。

以上不证明真实拒绝链、审批后额度变化、迁移、契约双向 round-trip、CHECK
业务副作用或 Stage 4 已验收；未构建/部署新 Core，不修改原生计量产物 digest。

## CHECK 批次后续验证与提交边界（2026-10-02）

本节追加上述记录写入后的实际结果；此前“尚未执行”“未提交”的描述保留为
对应时点的事实，不将后来的验证倒填为历史通过。当前额度查询的实际符号为
`core/crates/platform-core/src/openmeter.rs::OpenMeter::check_quota`。

### 当前工作区检查

以下命令均实际退出 0，日志位于 `/volumes/data/kailo/tmp/`。SDK 仍为上述
不可变 image ID，启动前有资源预检与实际 cgroup 限额；没有使用宿主机语言
工具链，没有因这些检查重建上游产物。

| 入口 | 已执行结果 | 外层日志 |
| --- | --- | --- |
| `tools/gen.sh`、`cargo fmt --all`、`tools/gen.sh --check` | 四侧生成与 TS/Dart 文案同源检查通过 | `codex-quota-generate-final-20261002.log` |
| `tools/check.sh lint` | Cargo/Go/TS/Dart 六项通过 | `codex-quota-lint-20261002.log` |
| `tools/check.sh verify` | Cargo/Go/TS/Dart 四侧既有验证通过 | `codex-quota-verify-20261002.log` |
| `tools/check.sh contract` | 四侧生成同步；90 个 schema 比对，匹配 3 个历史 schema，无破坏性变更 | `codex-quota-contract-20261002.log` |
| `tools/check-docs.sh` | 272 个引用闭合；86 实体、115 DD、27 SS 全部归属；87 场景中 86 映射、1 明确排除；markdownlint 0 issues | `codex-quota-docs-20261002.log` |
| `tools/check.sh trace` | 17 条追溯记录与能力注册表一致；18 个封闭 workflow kind 参与校验 | `codex-quota-trace-20261002.log` |
| `tools/gen-registry.py` | 注册表按既有追溯重新生成；17 条能力与 18 个 workflow kind 的一致性由上述 trace 步骤校验 | `codex-quota-registry-20261002.log` |

生成容器 4 CPU/6 GiB；lint、verify、contract 各 8 CPU/12 GiB；docs、trace、
registry 各 2 CPU/2 GiB，memory 与 swap 限额相等。内层原文分别为
`tmp.lc8XIpIS0q.check.log`、`tmp.hbN2qVLehs.check.log`、
`tmp.W5i3YlawkM.check.log`、`tmp.lIQxsv4YFY.check.log`、
`tmp.jFFzd7cPz9.check.log`。
verify 未提供 `DATABASE_URL`，其通过不等于真实数据库集成或 CHECK 业务链
通过；四侧既有 round-trip 证据也不代替真实额度变化与副作用验收。
上述 docs 检查在本节追加前执行，不将其当作本节追加后的文档门禁。

### 全新一次性数据库迁移

仅为已实现迁移执行原有 `tools/check.sh migrate`。使用确切归属本次演练的
全新 Postgres，不连接旧业务库或旧 K8S；没有新建检查脚本、测试或夹具，
没有人为创建 ActionDefinition、Tenant、meter 或 Customer。
随机凭据只从受保护文件与环境传递，不记录凭据值。实际调用为：

```bash
sudo -n -H --preserve-env=DATABASE_URL,CARGO_BUILD_JOBS \
  -u ubuntu -g docker env \
  TMPDIR=/volumes/data/kailo/tmp \
  CHECK_CPUS=8 CHECK_MEMORY=16g CHECK_NETWORK=host \
  CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache \
  bash tools/check.sh migrate
```

检查 SDK 为 8 CPU/16 GiB；数据库为 1 CPU/512 MiB，memory 与 swap 限额
相等，数据仅存 tmpfs。数据库镜像来自当前 Compose 的不可变引用
`postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`。
实际命令与外层演练均退出 0，无迁移 SKIP，原文包括：

```text
PASS 每个迁移都有配对的回退脚本
PASS 前进、回退、再前进三步演练通过
PASS sqlx 离线数据与迁移后的库和查询同步
PASS 39 个命名约束与 contracts/enums/ 逐值相等
全部通过。
```

真实 catalog 显示 38 个成功迁移，最新为 `20261002000000`；
`action_quota_policy_enum` 与 `quota_check_supported` 均已 validated。
后者只接受 NONE 且 `cardinality(meters)=0`，或 CHECK 且非空一维数组、
无 NULL/空字符串；因此枚举虽包含 `STRICT_RESERVATION`，支持约束仍拒绝它。
字段 `meters` 和 `quota_policy` 均 NOT NULL；迁移自然登记的 28 条动作均为
NONE，Tenant 为 0。这是运行后约束 catalog 核对，不冒充真实业务行写入的
破坏验收，也没有验收“已存在 CHECK 定义时回退”的拒绝分支。

成功原件目录为
`/volumes/data/kailo/tmp/codex-quota-migrate-final-20261002.cJoITK/`：
`standard-migrate.log`、`exit.log`、`quota-catalog.log`、`migration-catalog.log`、
`postgres-limits.log`、`postgres-storage.log`、`remaining-containers.log` 与
`cleanup.log`；内层原文为 `/volumes/data/kailo/tmp/tmp.XocnZYONv2.check.log`。
演练结束只移除本次一次性数据库容器与随机凭据，真实查询确认其不再存在；
tmpfs 数据不保留，证据日志保留，没有删除历史业务数据。

前两次失败不计入通过：
`codex-quota-migrate-20261002.6syQVJ/standard-migrate.log` 中 sudo 回退路径未
传入 `DATABASE_URL`，原入口实际 SKIP，后续 catalog 查询也失败；
`codex-quota-migrate-corrected-20261002.UQiQFK/standard-migrate.log` 中 sudo
清理 `TMPDIR`，入口退出 2、未启动 SDK。两次外层演练均退出 1，均清理了
各自一次性容器与凭据。最终调用显式传递非密执行配置与必要环境后才通过，
没有修改全局用户组、Docker daemon 或迁移检查逻辑。

### 本地提交、push 与发布状态

本地提交 `c478169a07376f3a7271ed8b857d06c307b87fa2` 仅收口原生计量变更，
不包含本批 Quota/UI。普通 push 实际退出 1，pre-push 的 `--full` 在 8/10
上游 seam diff 拒绝以下四个既有产物的源码摘要不匹配：
`collaboration-relay`、`desktop-client`、`model-gateway`、`web-client`。
原文为 `/volumes/data/kailo/tmp/codex-native-metering-push-20261002.log`，
内层为 `/volumes/data/kailo/tmp/tmp.bWnwSfBMQI.check.log`；没有绕过该门禁。

随后只读核对发现四个已暂存产物确实存在：冻结源码快照
`/volumes/data/kailo/candidate-release20261001.Raj4qb/apps` 对应 Git tree
`6851698a9cb0f90a72b7776b36d8aebb4af3b95b`，其中 collaboration、
model-gateway、web-client、client-kit 源码与本地 HEAD
比较无差异；三个 registry 请求为 HTTP 200，Docker-Content-Digest 与产物
登记逐字相同，Desktop deb 的 SHA-256 也相同。失败源于来源登记没有纳入
此次独立原生提交，不是据此判定产物需要重建；本节不把后续登记提交或 push
描述为已经完成。

该 push 全量检查的真实迁移因未提供 `DATABASE_URL` 而 SKIP，部署配置预检
因导出树无 `deploy/local/.env` 而 SKIP；未安装 gitleaks，只是内置扫描通过。
这次全量导出为 15 条追溯记录，与上述当前工作区 17 条不同；它不是上述
一次性数据库演练，也不能合并成一次“全量通过”。

本节写入时 Quota/UI 仍未提交、未构建部署。本轮只完成 CHECK 额度准入源码
及上述已有门禁，没有首个真实 producer、UsageEvent 或 fresh 权限保护下的
业务副作用验收；CHECK/STRICT 正向执行仍关闭，NONE+空 meter 不依赖
OpenMeter。没有据此宣布任何 Stage 完成、用户端功能可用或一期生产就绪。

### 来源引用的阶段性关联（2026-10-02）

三份来源清单实际单独提交为
`6d2bb152bad7106bd99d0274162e637d2fbecf83`，只有八对 source/artifact
摘要值的替换，没有重新构建、业务源码、schema、API、Workflow 或部署变化。
提交前原生 schema-4 reader 确认 apps 源根、当前内容、runner 与空 incomplete
列表；隔离候选的 `detect_changes` 实际退出 0，三个文件、零代码符号、LOW。
完整原件在
`/volumes/data/kailo/tmp/codex-native-provenance-20261002.t0nmJk/`。

第二次普通 push 仍实际退出 1。全量检查的格式、四语言已有验证、契约、
replay、供应链与 seam 通过；追溯和部署静态检查拒绝相同四个产物的旧引用。
原文在 `/volumes/data/kailo/tmp/codex-native-provenance-push-20261002.log`。
本地来源清单并不等于完整发布关联；Compose 与十四份追溯记录需要与同一
真实 artifact 保持一致，不能靠省略它们或绕过 pre-push 宣称 push 完成。
真实数据库演练和 SDK 内部署 `.env` 预检仍分别 SKIP，保留这一边界。

随后从原暂存 blob 只读制作十五文件隔离候选，基于上述本地提交，tree 为
`59d1dd0e636ae25d4e09313e5b1e695ef5890a7f`，仅二十三对摘要替换；
没有引入当前工作区的新功能或改变 gate、网络、端口、凭据与配置字段。
完整 diff 在
`/volumes/data/kailo/tmp/codex-release-reference-candidate-20261002.3B5CAF/`。
该候选通过原 `check.sh trace` 与 `check.sh security`，二者实际退出 0：

```text
PASS 15 条追溯记录通过 06 §1 的七条硬规则
PASS 能力注册表与追溯记录一致，四个构建期拒绝条件全部通过
PASS 24 个服务：network 显式、边界不越层、私有数据网络按所有者隔离、镜像按 digest、无端口字面量、公共配置单源投影；SpiceDB schema 与 .design/03 §5 逐字相等
```

执行使用上述不可变 SDK，各 4 CPU/4 GiB memory=swap，导出候选及其固定
设计版本，未执行新构建。原件为
`codex-release-reference-trace-20261002.log` 与
`codex-release-reference-security-20261002.log`，均在同一 Data tmp 目录。
部署配置预检因该导出树没有 `.env` 明确 SKIP，不是实际环境预检通过。
写入本节时这十五文件候选尚未提交；独立远端查询 main 仍为
`14fa7833d6bfd6d089c805899002b869fadebe86`。不将两个本地提交或窄检查
当作已 push、已部署或 Stage 完成。

### 后续正常 push 收口（2026-10-02）

本节追加该候选记录之后的实际结果，不撤销上述两次 push 的失败。
`e4c544fdb63d5e54fe775d58e684249166c89543` 收口 Worker 冻结 owner 审批与
既有发布引用，共 17 个路径；原生计量与来源清单仍分别属于上述 `c478169a…`
和 `6d2bb152…`，不混入当前工作区的 CHECK、AgentDefinition 或后续 UI 增量。
共享 pre-push 在不可变受限 SDK 中检查实际提交树，没有关闭钩子或绕过门禁。

最终普通 push 的完整原文为
`/volumes/data/kailo/tmp/codex-final-owner-push-keepalive-20261002.log`。
`tools/check.sh --full` 与 push 实际退出 0，末尾输出为：

```text
全部通过。
To github.com:bei612/kailo-plus.git
   14fa7833..e4c544fd  main -> main
```

该提交树的格式、静态检查、四语言既有验证、90 个 schema 与三份历史契约兼容、
Workflow replay、15 条追溯与 18 个 workflow kind、18 个产物来源、六份上游来源
记录及 24 服务部署静态检查通过。实际数据库迁移未提供 `DATABASE_URL`、
部署配置预检未提供 `.env`，分别明确 SKIP；内置秘密扫描通过但未安装 gitleaks。
Mobile 签名 upload keystore 仍未提供，不将其发布阻断改写为通过。

成功前还发生共享派生缓存的权限失败及全量检查通过后的 SSH 连接失败；保留
`codex-final-owner-push-20261002.log` 与 `codex-final-owner-push-retry-20261002.log`
中的原始结果。仅核对并纠正本项目派生缓存的 UID 归属，最终连接使用 SSH
keepalive，没有更改产品逻辑、清空全部缓存、强推或改写远端历史。
本地 HEAD、origin/main 与独立 `ls-remote` 随后均确认上述完整 commit。

这证明这三个提交已入库并 push，不证明新 Worker 已构建部署、CHECK 正向
producer 已存在、owner 正向业务链已验收或一期生产就绪。

### 原生 Customer HTTP 412 分类修正（2026-10-02）

本次修正 `core/crates/platform-core/src/openmeter.rs::status_error` 的既有
错误分类：HTTP 412 原来落入 `Error::Unknown`，现与 400、422 同归已有
`Error::Precondition`。没有增加枚举、接口、账本或重试路径，也没有修改
CHECK 审计、契约或迁移。主代理随后只将该错误分类 delta 纳入既有 Customer
消费者的 37 迁移集成候选，不混入独立 CHECK 实现。

权威依据是 DD-38 的唯一 Tenant Customer 关联及 `06` §4 的六类错误合同。
固定 OpenMeter commit `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的
`openmeter/entitlement/service/api.go::getActiveCustomer` 对已删除 Customer
返回 `GenericPreConditionFailedError`；同版本
`pkg/framework/commonhttp/encoder.go::GenericErrorEncoder` 明确将该错误编码
为 HTTP 412。Customer 在初次读取后、权益读取前退役，是确定的前置条件
不成立，不是无法判断的外部结果。两处原生符号均通过该完整 commit 的
`git show` 只读核验，没有执行 `.references` 中的内容。

修改前的实际 native context/upstream impact 原件为
`/volumes/data/kailo/tmp/codex-openmeter-412-impact-20261002.1zLtok.log`，
reader 实际退出 0。`apps-source` 的源根和存储均在 `apps`，indexedAt 为
`2026-10-02T10:30:37.680Z`，commit 为
`8ec78ed43e4a3e1fdc3f3243719cb7c1673eded6`；structured status、typed
context、schema-4 runner 官方比较及 contentDrift 均为 current，
`incompleteReasons` 与 forbidden paths 均为空。实际 reader cgroup 为
2 CPU、6 GiB memory、5 GiB memory.high、swap 0。

精确目标 `Function:core/crates/platform-core/src/openmeter.rs:status_error`
的上游影响为 HIGH（shared axes MEDIUM）：五个直接调用方
`create_customer/customer_by_id/customer_by_key/read/retire_customer`，
两个间接调用方 `check_quota/collection`。HIGH 已在编辑前报告；图中零
process 不作为跨领域零风险的证据。源码补证确认
`tenant_lifecycle.rs::metering_error` 及现有
`governance.rs::check_quota` 已将 `Precondition` 消费为
`BINDING_NOT_ACTIVE`，本次没有改动这两个消费者。

影响面与副作用边界：仅调整已知原生状态码的错误标签，不改变写读字段、
数据库格式、Workflow、三端接口或兼容窗口。认证拒绝仍为 `Denied`，429
仍为 `Limit`，未识别状态及原有传输、解析失败仍不构造成功结果；现有
UNKNOWN/不可用消费路径不变。未增加本地额度权威或正文复制，未开放
CHECK/STRICT 正向执行入口；NONE 加空 meter 的既有行为不变。

首次写入发生在共享写入窗口放行之前，随后只用 `apply_patch` 还原本人
这一 hunk；整文件与修改前快照 `cmp` 实际退出 0。主代理在还原后核验
current 实际退出 0，原件为
`/volumes/data/kailo/tmp/codex-batch15-fresh-20261002.log`。收到同批前置
impact 完成及统一 GO 后才重做该修正，没有自行刷新图谱或写入 Git 索引。
本次精确 before 在
`/volumes/data/kailo/tmp/codex-openmeter-412-before-20261002.sPLduF/openmeter.rs`，
SHA-256 为 `6e43cab8b495a09de51b18ddc16813a6667c0670bdafb15c3dcffcf81e4e7167`；
修正后为 `e785168183ee69f6c4536631608c19a5cb7263f3268a914ab1bef2953b30c596`，
逻辑 delta 仅三行增加、一行删除。

本节写入时未运行 SDK、文档门禁或全量检查，也未做真实 Customer 退役与
权益读取竞争的业务运行验收；集中验证由主代理后续收口。本次没有新增
测试、夹具或检查脚本，未提交、未 push、未部署，不能据此宣布 Stage 完成
或一期生产就绪。

随后只读核对主代理实际选择树
`254e071fe529f565bb854e4483390c1087f5ef7e`，不以完整脏工作树代替该输入。
该树的 `openmeter.rs::status_error` 位于 266–275 行；与先前候选
`77d02501a6a2503550c20600a6d2aec0eeedf4c7` 比较，此文件只有上述
HTTP 412 的三行增加、一行删除。401/403 到 `Denied`、429 到 `Limit`、
其他未识别状态到 `Unknown` 的分支逐字未变。这里是实际源码比对结果，
不是这些状态已通过业务请求运行的结论。

选择树的 `tenant_lifecycle.rs::metering_error`（685–701 行）确有
`Precondition` 到 `BINDING_NOT_ACTIVE` 的消费；其中
`metering_observation_error`（461–487 行）在已有 DISPATCH、原生结果尚未
查明时仍持久化 UNKNOWN 并返回 `EXTERNAL_RESULT_UNKNOWN`，不能因新的
412 分类把在途创建误记为确定失败。另一消费者
`governance.rs::check_quota` 仅存在于未选入的 CHECK 工作树增量，本选择树
没有这个函数；前述两个消费者的工作树核对不作为两者都已纳入候选的证据。
固定版本原生两处符号再次通过 `git show` 核验，结果与上述 412 依据相同。

针对 Rust `status_error` 分类的既有可直接执行断言：**无适用对象**。
该选择树的 `openmeter.rs` 没有测试模块；`git grep` 在现有 Platform Core
集成测试中查询 `openmeter/metering_error/status_error` 返回 1，即没有引用。
原生 `metering/openmeter/entitlement/service/api_test.go` 已有删除 Customer
后 Get/List 返回 `GenericPreConditionFailedError` 的断言，但它不执行 Rust
分类或其消费者，本轮未运行它，也未创建 Customer。没有拿编译通过冒充
分类断言，没有为破坏核验新增测试、夹具或脚本；本轮未修改、破坏或还原
任何源码，因此没有新取得“破坏后失败、还原后通过”的运行证据。
本轮仅只读复核和本记录追加，不重跑 SDK/full、刷新图谱或写入 Git 索引。

随后集中运行固定树 `254e071fe529f565bb854e4483390c1087f5ef7e` 的原
`tools/check.sh --full`，实际退出 0；不可变 SDK、4 CPU、8 GiB、swap 0，
原日志为 `/volumes/data/kailo/tmp/codex-core-functional-closure-254e-full-20261002.37trEJ.log`。
本刀已被编译与既有检查消费，不再写为尚无 SDK 验证；上述分类断言和业务
闭环仍未取得，不外推为通过。迁移演练与真实 `.env` 部署预检均 SKIP，
本次不包含独立 CHECK 或 AgentVersion，也未构建部署该树。

### Installation Customer subject 物化与原生回读（2026-10-02）

本节记录已经写入的独立源码窗口，不修改上述历史结果，也不将前一批 SDK
结果移用到本刀。唯一实现路径为 Platform Core 的 `openmeter.rs`、
`model_route.rs` 与本记录；未修改契约、迁移、计量原生源码、公开路由或发布登记。

权威与影响面：DD-38、`.design/03` §8、`11` §3–4 要求固定 namespace 中的
唯一 Tenant Customer，Agent subject 带 Tenant 前缀且实际归属于该 Customer。
现有 `agent_installation::provision_runtime` 消费 `model_route::provision`，
本刀在后者已有 Tenant/Workspace/Resource/HUMAN 生命周期锁内物化
`<tenant_id>:<installation_resource_id>`；来源只是真实 Installation、已准入
AE、已启动的 AGENT_INSTALLATION Workflow 与 ACTIVE OpenMeterBinding。
没有构造 Invocation 或模型请求，没有复制商业余额、Customer 或账单正文。
`gateway_usage::prepare_turn/dispatch_guard` 既有 `gateway_meters` 消费则在每次
取用时重新核验原生 subject 归属；它没有因此取得合法 Invocation 生产入口。
没有改变四侧 JSON 字段、API 或 Temporal Input，历史数据兼容在本刀无新增
格式迁移对象；已有脏工作树差异不计为本次实现。

固定上游重新核验到完整 commit
`6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`，仅使用只读 `git show/git grep`：

- `openmeter/customer/httpdriver/customer.go::handler.UpdateCustomer` 读取原生
  v1 Customer，消费 CustomerReplaceUpdate；
- `openmeter/customer/httpdriver/apimapping.go::MapCustomerReplaceUpdate` 与
  `openmeter/customer/adapter/customer.go::adapter.UpdateCustomer` 是 replace
  而非增量追加或 CAS。后者会清除未提供的 metadata、annotations、billing
  address，并按集合差更新 subject；
- `api/v3/handlers/customers/convert.go::FromAPIUpsertCustomerRequest` 明确忽略
  Annotation，`api/v3/labels/convert.go::FromMetadataAnnotations` 还可能过滤
  不能转换的原生 annotation。不能以仅含 subject 的 v3 PUT 或有损 labels
  回写覆盖这些事实；
- `openmeter/customer/adapter/entitymapping.go::CustomerFromDBEntity` 在零
  subject 时省略 UsageAttribution，保留原生可写字段与系统 annotations；
- `openmeter/customer/service/customer.go::resolveCustomersByKeyWithPrecedence`
  规定 customer.key 优先于 subject key。`api/v3/handlers/customers/list.go::handler.ListCustomers`
  提供精确 key 与 usage_attribution_subject_key 的过滤读回。

已经实现的副作用边界：适配器只在内存读取原生 v1 完整 Customer、保留全部
可无损回写字段与原 subject 集合，追加这个真实 Installation subject。非空
annotations、未知字段、不能表达的地址或 metadata、跨 Tenant/重复 subject、
退役 Customer 都拒绝，不发送 destructive replace。管理身份仍为现有
Core-only credential；v1 协议路径由唯一 Customer URL 的 origin/部署前缀
派生，不新增地址、超时、凭据或配置副本。

写入前沿同一 AE/operation 的已有 AuditEvent 提交 DISPATCH 阶段引用；阶段
键绑定 Customer、Installation 与完整期望投影 SHA256，正文只在该次调用内存
中存在，不进入 Core 数据库、审计、Workflow 或客户端。Tenant 锁使现有
Core 管理写者串行，但这不是原生 CAS，不能在有绕过 Core 的 Customer
管理写者时声称具备无损并发保证。一次 PUT 后无论回应是成功还是传输失败，
都回读原生 v1 全部可写字段及完整 subject 集合，再核 v3 同 Tenant/customer
归属、完整 subject 集合、唯一 subject-owner 且没有 key-owner 遮蔽；仅返回
200 或只发现新 subject 都不能终结。

边界与收敛：已 DISPATCH 但未 VERIFIED 的尝试只按持久摘要查证，不重 PUT；
Customer 缺失、字段变化、回应未知或分页不完整时记录原 operation 的 UNKNOWN。
未对账的 replace 阻止同 Customer 的后续 subject 写者覆盖其恢复证据。
已 VERIFIED 的旧 generation 可消费后续合法 Installation 新增 subject 的
当前事实，但 subject 丢失不靠重放旧 PUT 修复。写前确定拒绝分别落到既有
DENIED/PRECONDITION/CONFLICT/LIMIT，依赖不可查证为 UNKNOWN；写后不能证明
结果时一律 UNKNOWN，现有 Installation projection 对账继续负责恢复或告警。
本刀没有新增未终结状态、第二份计量权威或默认成功分支。

这是模型 runtime projection 物化期所需的 Customer 归属依赖，不是
`quota_policy=NONE` 管理动作查询 entitlement/credit/reservation：NONE 准入的
既有免额度查询边界不变。模型 runtime 准备缺真实 Customer 归属便保持关闭，
不能把所有 NONE 生命周期动作描述为完全没有 OpenMeter 外部引用。

精确 before 为
`/volumes/data/kailo/tmp/codex-openmeter-subject-before-20261002.5NwcW7/`
中的三份字节快照；写入后 scoped `git diff --check` 实际退出 0。
本刀未运行 SDK、格式/静态检查、全量门禁、真实 Customer PUT/回读、业务
并发或破坏还原验证；未创建 Customer、meter、Installation 或业务种子。
尚未生成、构建、提交、push 或部署，实际运行证据留待批次集中验证，
不宣称本 subject 链、SS-OMT-AUTH、Stage 4/5 或生产门禁已验收。

## 已运行双阶段去重配置的提交边界收口（2026-10-03）

本次核对基线为 apps HEAD
`4dca2f355dcee8df1c563ee6d4871fd81eea474c`，只收口既有
`deploy/local/compose.yaml`、`bootstrap.sh`、`init-local.sh` 的原生
去重与 sink 接线。HEAD 已含相应 `.env.example` 输入；双侧去重运行期开关
说明仍仅在既有工作树 07 §1，该 HEAD Compose 也尚未声明实际运行的
sink、Redis；限定 Web 部署已观察到
这两个 orphan。本次不是新增部署能力，也没有清理、重启或重新部署它们。
历史 2026-10-01 失败、校验及全量结果保留，不改记为当前提交验收。

四步影响结论：

1. 权威为 DD-08、`.design/11` §4。固定上游
   `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的
   `app/config/dedupe.go::ConfigureDedupe/DecodeMap`、
   `app/config/sink.go::ConfigureSink` 分别定义两阶段配置；
   `app/common/openmeter_server.go::NewIngestCollector` 与
   `app/common/openmeter_sinkworker.go::NewSinkDeduplicator` 消费原生 driver。
   `openmeter/dedupe/dedupe.go::Item.Key` 与
   `openmeter/dedupe/redisdedupe/redisdedupe.go::Deduplicator.IsUnique`
   绑定 namespace/source/event.id；两阶段必须分库，不增加 Core 计量权威。
2. 调用面为原 bootstrap 预检→原 Compose 同一 YAML 的 API/sink→原
   init-local 的 `up --wait --no-build`。独立选择保留原 Kafka heap 校验，
   排除工作树 PUBLIC_BIND 校验、BFF 注释、依赖排序及无关空行变化；
   没有新入口、业务对象、凭据或镜像。工作树和 clean HEAD 加所选窗口的
   `bash deploy/local/bootstrap.sh --validate-config` 均实际退出 0。
3. 2026-10-03 22:48 UTC 只读回执：API/sink 同为
   `sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783`，
   各 1 CPU/1 GiB，Redis 为 1 CPU/512 MiB；四目标均 healthy、无 OOM，
   Kafka 保持已提交 heap 修复后的 2 CPU/2 GiB。API/sink 实际配置摘要同为
   `c66358804d842bf981bc87829ddbf4f62f7dedd6148a90d731fbe318cd5de54d`，
   原生 bool 均 true、driver=redis、DB=0/1、expiration=0。
   Redis 回读 databases=2、maxmemory=268435456、noeviction、AOF always、
   aof_last_write_status=ok；只接 openmeter-data、无宿主端口，专属卷为
   `platform-local_openmeter-dedupe-data`。原生 Kafka consumer-group 只读命令
   退出 0，`openmeter-sink-worker` 已分配 `om_default_events` 的 partition 0，
   log-end-offset=0；没有把尚无已消费事件的分配证据当作用量结算。
4. 未发现需要新增生产修复的接线缺陷。原 YAML 配置摘要与 2026-10-01
   回执相同，只证明配置投递及实际消费者存在；不证明真实重复事件、
   202→stored_at、credit、Quota、账单或 Agent E2E 已通过。
   本轮没有 SDK/full、镜像构建、业务写入、Git index/commit/push 或服务变更。
   原生 Redis/Kafka/ClickHouse 跨系统崩溃窗口仍保留，不宣称 exactly-once。

精确独立源码与本次回执保留于
`/volumes/data/kailo/tmp/codex-openmeter-dedupe-close-20261003.qCSHTp/`；
该私有窗口仅选择上述三份部署文件及本节，不混入其他 inherited 差异。


### 本批健康检查配置收束（2026-10-03）

选择既有部署窗口后，复核确认 Redis/sink 的 interval/timeout/retries
仍含本项目固定数值。现有 Compose 两个检查已改为读取唯一部署输入，
`.env.example` 增加六个空字段，原 bootstrap 对缺失、零、负数、非整数
统一拒绝；没有更改上游协议或扩张额度策略。
2026-10-03 实际 `Config.Healthcheck` 逐项读回 Redis 为 5 秒/3 秒/30 次，
sink 为 5 秒/10 秒/40 次，已原样显式投递唯一 ignored `.env`。
正式与私有候选原 `--validate-config` 均退出 0；未重启服务，现有运行
调度与镜像、数据卷保持原样。sink 的 HTTP 超时和调度重试独立取值，
不把 HTTP deadline 当成次数。上述非密配置不进业务对象或第二份计量权威。

本批选择新增 `.env.example`，并纳入根已选 README/native-identity 两段
部署事实及 07 §1 已有双侧去重/Redis 两行；不纳入 07 的其他 inherited
修订。检查仅使用该固定 8 路径候选；真实事件去重、Agent 首轮、用量/账单
和客户端设备验收仍不据本批配置收束宣称通过。
健康输入实际破坏/还原使用私有投递对象与原 bootstrap：正向 0，缺项 1、
零超时 1、畸形 retries 1，逐字还原后 0；未破坏真实 `.env`。
完整回执为 `/volumes/data/kailo/tmp/codex-openmeter-dedupe-close-20261003.qCSHTp/health-preflight-mutations.log`，
SHA-256 `8c1ee3b36493a3e9c4f7f51ae20cb3ba57730cc8a9c3ed882064b630b5856058`。

### 本批固定输入全量回执（2026-10-03 23:10 UTC）

固定检查输入为 tree `d16970e72e035f8c1b03230e66b0dfd6b9908fcd`，
不是新增 commit；相对上述 HEAD 仅 8 路径、+313/-13。
从 apps 根执行原 `./tools/check.sh --full`，显式投递
`CHECK_SOURCE_REF=d16970e72e035f8c1b03230e66b0dfd6b9908fcd`、
`TMPDIR=/volumes/data/kailo/tmp`、`CHECK_CPUS=4`、`CHECK_MEMORY=8g`、
`CHECK_NETWORK=host`、`CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache`、
`CARGO_BUILD_JOBS=16` 与既有 `BUILDX_BUILDER=kailo-core-data`。
原 launcher 选中 immutable SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
真实 UID/GID=1000:1000、cpu.max=400000/100000、memory.max=8589934592、
memory.swap.max=0，OOM/oom_kill=0，实际 Config.Env 的 Cargo jobs=16。

session 10539 原 full 实际退出 0，末行“全部通过”；完整输出
`/volumes/data/kailo/tmp/codex-openmeter-dedupe-close-20261003.qCSHTp/full.log`，
SHA-256 `ccdf21cb85603f092b57065c429258f48d89ec05af3a6352cd7dc11f9e648cd3`。
原 launcher 日志 `/volumes/data/kailo/tmp/tmp.Rhzvaj2VTF.check.log`，
SHA-256 `6f2fdc442228b933de115690c96777e7095d2c5670951fa86cdf78d57e02f851`。
检查前后 8 路径 SHA 全部一致；结束后自有 SDK 已由原 launcher 清理。

未提供 DATABASE_URL，实际迁移演练明确 SKIP；未投递 ignored `.env`，
实际部署配置预检明确 SKIP。四个需显式数据库/运维条件的 Rust 演练保持
ignored；未安装 gitleaks，运行的是原内置扫描。格式、静态、四侧契约、
原测试、Workflow replay、18 条追溯、28 份产物摘要/证明及 30 个服务的
配置边界静态检查均通过，但不替代真实重复事件、用量/账单 commit、
Agent 首轮、真实业务 E2E、签名或设备验收；本轮未构建镜像或变更服务。
以下仅补本回执并跑原文档快路径，不为证据文字重跑 full。

### 原生 ingress 投递回执与永久去重阻断（2026-10-06）

本批关联 `DD-08`、`SF-OMT-02/03/04`、`V-SCN-44` 与 `.design/11` §4。
先实际执行一条新的纯回复频道消息，同时提及两个原有 Agent；两个 Action 均为
ALLOWED/DISPATCHED。其中一个被原 UNKNOWN Invocation 占用的安装并行度阻塞；
另一个 native completed，但用量一直 ACCEPTED、没有 stored_at，因而没有最终回帖。
没有重放模型、直接更新业务状态、扩大授权或修改额度。

四项影响结论：

- 权威：OpenMeter 原生存储仍是 committed usage 权威，Kafka delivery 只证明 broker
  接收，不是 stored_at 或账单终态；Core 原 outbox 与不可变 CloudEvent 不变。
- 影响：只改 `openmeter/ingest/dedupe.go::DeduplicatingCollector.Ingest` 与
  `openmeter/ingest/kafkaingest/collector.go::Collector.Ingest`。调用链仍是
  `app/common/openmeter_server.go::NewIngestCollector` 和原 Kafka collector；
  不改 HTTP schema、配置、数据库或三端调用。三端统一等待原 Core 用量闭环。
- 副作用：先 `CheckUnique`，原 collector 获得真实 broker delivery 后才 `Set`。
  失败、取消或结果不明不提前记入口键；可能迟到的回执使用缓冲 channel，不能关闭
  仍被 native producer 持有的 channel。网络重试保持同一事件，绝不重跑模型。
- 并发/旧数据：并发首次投递可能都进入 Kafka；原 JSONSerializer 的非空 key 与
  sink 的 `(namespace, source, id)` 一致，因此使用同一 partition 和已有 sink
  同批/跨批去重，不新造锁、collector 或账本。原 sink 存储、offset、Redis 的崩溃
  窗口没有因此消失，不宣称跨系统原子恰一次。旧提前记入的永久 ingress key
  不会被新代码自动删除，必须按下述精确受控维护收敛，不保留假成功读路径。

上游证据重新用 `git show` 核验固定
`6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`：
`openmeter/ingest/dedupe.go::DeduplicatingCollector.Ingest` 先调用 IsUnique；
`openmeter/dedupe/redisdedupe/redisdedupe.go::Deduplicator.IsUnique/setKey`
执行 SET NX；`openmeter/ingest/kafkaingest/collector.go::Collector.Ingest`
仅 Produce(msg,nil) 后返回。`app/config/ingest.go::KafkaConfiguration.CreateKafkaConfig`
与 `app/common/kafka.go::NewKafkaProducer` 没有关闭 delivery reports；
`openmeter/ingest/kafkaingest/serializer/json.go::JSONSerializer.SerializeKey`
复用 `openmeter/dedupe/dedupe.go::Item.Key`；原 sink 的
`openmeter/sink/sink.go::Sink.deduplicateAndResolveMeters/flush` 在存储前筛除
同批与已处理身份，存储后才更新 sink 去重索引。

运行事实：既有 Kafka 于 2026-10-05 18:53:29 UTC OOMKilled、exit 137。
10-06 14:07:47 沿原 Compose 仅 `up -d --no-build --no-deps --pull never
openmeter-kafka`，退出 0；原镜像、两个 named volumes、2 CPU/2 GiB 不变。
Kafka 恢复 healthy，sink 自动恢复分区，CURRENT-OFFSET=LOG-END-OFFSET=27、LAG=0。
原精确 UsageEvent `314ab896-17fc-5fa6-93f7-ecc0d4246f84` 的入口 Redis DB0
EXISTS=1、TTL=-1，sink DB1 EXISTS=0；只读消费原 topic 唯一分区全部 27 条记录，
该事件命中 0。最终 outbox 仍 ACCEPTED，不能把 Kafka healthy 写成计量完成。

原生修复后的旧键收敛边界：部署新 API 时先终止旧 producer 形成在途 fence；再
重新查证原 exact event 的 Kafka 全分区、原 stored_at 与 sink key，并确认 consumer
已到末端。均无投递/存储记录才允许精确清除该一个 ingress 缓存键，由原 outbox
重投同一冻结事件。证据缺失或不一致时保持 UNKNOWN；不清理整个 Redis、sink
索引或业务账本。维护负责人为本次发布批次负责人，关闭条件为原事件 stored_at
可核验及原任务回帖读回；本记录时尚未执行键删除或修复镜像投递。

窄验在原限额 SDK `kailo-agent-receipt-xvkujx`、UID 1000、4 CPU/8 GiB 中使用
已有 Go 1.27.1 与 `/cache/metering-go`；独立快照位于
`/evidence/metering-delivery.irol5K/metering`。实现后原 ingest 测试补失败/超时不
提前记键场景，Kafka 用例使用 librdkafka 自带 MockCluster，实际验证成功回执、
broker 不可用时拒绝假成功、请求取消；同时运行原 sink 去重用例。命令：

```sh
go test -mod=readonly ./openmeter/ingest ./openmeter/ingest/kafkaingest ./openmeter/sink \
  -run 'TestDeduplicatingCollector|TestCollectorRequiresBrokerDelivery|TestDeduplicateAndResolveMeters|TestParseMessageDoesNotCheckRedis' -count=1
```

最后恢复后退出 0：ingest 0.003s、kafkaingest 1.817s、sink 0.021s。
私有快照中恢复原 IsUnique 提前记键及跳过 delivery 等待，两个包实际退出 1：
失败/超时子例报 `unconfirmed delivery must not poison the ingress index`，Kafka
子例报 `An error is expected but got nil`。原字节恢复 cmp 0 后重跑上述命令通过。
gofmt 结果已同步正式四个 Go 文件，`git diff --check -- metering` 退出 0。

边界如实保留：首次扩展的同一 producer 故障后重连子步骤发生 message timeout /
context deadline，额外窄回归未通过；没有调产品超时来掩盖，也不声称同进程重连
已验收。最终窄用例限于本修复的三种回执行为；失败原件一并保留。
本批未运行 full、未构建修复镜像、未交付新 OpenMeter、未产生真实 Agent 最终
回复；三 HUMAN 独立账号已读到同一新 HUMAN 事件，不等于 3 人 2 Agent 完成协作。
原始记录在 Data 的 `buzz-dm-worker-release-20261006.85FUKC/`，包括
`metering-delivery-tests.log`、`metering-delivery-tests-final.log`、
`metering-delivery-tests-restored.log`、`metering-broker-recovery.log`（额外重连失败），
`metering-delivery-mutation.log`（破坏失败）、`metering-delivery-restored-final.log`
（恢复通过）、`kafka-recovery.log` 与 `deployment-receipt.md`。
