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
