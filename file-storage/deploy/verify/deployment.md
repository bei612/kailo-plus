# Cells 独立原生部署接缝

## 当前结果

2026-10-05 22:30 UTC 的原生 OIDC 投递记录存在错误判断：Compose 将受控
`CELLS_OAUTH_CONNECTORS` 送进容器，但上游对应生产者实际没有有效调用；独立 client secret
挂到 connector 实际读取的 `/run/secrets/cells_oidc_client_secret`。此前只有
HTTP handler，没有这两项运行输入，构建成功也不能据此完成原生登录。
launcher 复用原 secret 文件检查，核对 connector 引用与实际 mount 一致；
不生成用户、管理员、密钥或新身份权威。2026-10-06 的真实服务验证已纠正此结论，见末节；环境变量存在不能证明原生配置已生效。

2026-10-05 原生身份源码进入完整 c57f fork 后，当前 Compose 已改为必填 `CELLS_IMAGE` immutable digest，不再投递下文旧 5.0.2 baseline。历史只读 registry/配置检查证据保留，不能代表新 fork 产物。新源码未构建/部署，实际原生 OIDC 配置仍未投递。

已实现独立 `file-storage/deploy/compose.yaml` 和 `start.sh`：直接运行官方 Cells UI/API 与独立 PostgreSQL；没有 Core 数据库、ApplicationBinding、Resource.create 或模型权限启动依赖。原生身份和服务数据仍归 Cells，不复制到 Core。

2026-10-05 本机未发现 Cells/WeKnora/Wren 运行容器，Core Catalog 的 ComponentRelease 数量为零，ApplicationBinding 表尚不存在。没有已投递的 Cells 原生安装文件、管理员凭据或独立数据库密码文件；因此本批没有启动实例、没有创建凭据、没有创建业务 binding，也没有浏览器嵌入/SSO/工具验收。配置通过不能增加这些完成度。

## 固定上游与实际符号

固定源码证据 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的 `tools/docker/compose/basic/docker-compose.yml` 使用可变 `pydio/cells:unstable-v5-dev`；对应 `install-conf.yml` 带示例 `admin/admin`。本接缝没有复制这些默认值。

部署使用官方发布 `5.0.2`，源码 tag 对应完整 commit `1fc874469656deec2677ff6d2f487cf5c31dc3fd`。2026-10-05 从 Docker Hub tag API 与原 OCI Registry 读取的事实：

| 对象 | 确切摘要 |
|---|---|
| 官方 `pydio/cells:5.0.2` OCI index，Compose 固定引用 | `sha256:26452e0953caee46b859833f681e83c8bf21562a3f07509be32f8d80543ba20f` |
| linux/amd64 manifest | `sha256:c369274786b51fd28e7fd8258433660ad817a0767fcb9a05308d3636bcf4b8a8` |
| 该 manifest 的 image config | `sha256:c35d46de25c8c9c1a845e343b63a03873589b286cb8bde38e6b5068e9d27814a` |

OCI config 的 version label 为 `5.0.2`，revision label 为空；这里不把 release tag 对应关系冒称可验证的 commit 构建证明，更不把该镜像说成 `c57f02f4` 的产物。PostgreSQL 使用项目 `deploy/local/compose.yaml` 已固定的 `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`，但单独启动实例、私有网络、数据目录与凭据，不复用 Core 的数据库。

在 `1fc874469656deec2677ff6d2f487cf5c31dc3fd` 重新核验：

- `cmd/configure.go::ConfigureCmd/init`：原生 `CELLS_INSTALL_JSON` 投递入口；缺 frontendLogin 会进入浏览器安装，本 launcher 先拒绝该情况。
- `cmd/install-ni.go::{NiInstallConfig,unmarshallConf,installFromConf}`：读取原生 JSON；native `dbConnectionType=manual` 与 `dbManualDSN`，不新建安装数据契约。
- `common/proto/install/cells-install.proto::InstallConfig`：原生 `frontendLogin/frontendPassword/dbConnectionType/dbManualDSN` 字段。
- `tools/docker/images/cells/docker-entrypoint.sh`：检查是否已安装；首次执行原 `cells configure`，以后执行原 `cells start`。原 native 安装成功退出后 Compose 按原容器 restart policy 重启，不新增安装状态机。
- `tools/docker/images/cells/buildx-dockerfile`：原工作目录 `/var/cells`、入口 `tini → docker-entrypoint.sh` 与原 native HTTP readiness 路径。本接缝使用配置投递端口，并不复制其固定端口或跳过 HTTPS 校验的健康探针。
- `common/auth/connector-pydio.go::{init,pydioconnector.Login,DefaultConnectorScanner}`、`common/auth/connectors.go::RegisterConnectorType`：已注册的是原生 `pydio` 用户密码 connector；配置 connector 清单本身不等于已实现外部 Keycloak OIDC 登录。本批没有伪造 SSO 或共享 Kailo 身份。

## 四步影响与运行边界

1. 权威：`.design/07` 独立数据服务边界及 `.design/18` 原生管理后台；只接原生部署入口，不接管 Cells 内部业务或服务生命周期。固定发布 install schema 决定安装字段。
2. 影响：三个部署文件及 `apps/07` 的运行期安全说明。没有 Core/Worker/四侧合同更改，无数据迁移；Cells 与 DB state 必须是已存在且互不重叠的 Data 目录。数据库只在此 Compose 的 internal 网络，未发布宿主端口。
3. 副作用：唯一正常启动命令 `bash file-storage/deploy/start.sh CONTROLLED_ENV_FILE`；先验证受控文件/DSN/资源与地址，再固定镜像 pull/create，复用 `tools/container-safety.sh` 检查实际容器限额，再原 Compose up。`--check` 只读取文件并执行原 `docker compose config --quiet`，不 pull/create/start。未声明就绪即不宣称身份或工具可用。
4. 异常：凭据缺失、示例密码、交叉数据库、目录重叠、发布端口与原生监听不一致、TLS/健康端点不一致均先拒绝；不生成密码、不回退默认租户/管理员。启动等待上限取部署配置，超时保留原容器事实供原生观察，不清库重建或盲目重试安装。原生 TLS 自签名不被此健康检查信任；生产需先按 Cells 原生部署配置投递可信证书，不能为通过 readiness 加 `--no-check-certificate`。

`.env.example` 不包含地址、容量、密码或假的可用默认值；唯一配置由运维提供 mode `0600` 文件。安装 JSON 与 DB password 文件也是 `0600`。安装 JSON 使用原 camelCase 字段，DB DSN 必须精确指向此私网内 `cells-db` 的已配置端口、库名、用户与同一密码；DSN query 保留原 upstream prefix/policies/singular 模板。安装文件会包含原生凭据，禁止提交或在日志输出。

## 实际验证与未运行项

验证目录 `/volumes/data/kailo/tmp/cells-deploy-check.XqXdz3`，仅使用标明 `NOT-A-REAL-CREDENTIAL` 的配置 fixture；没有投递到任何服务。复用原 `tools/container-safety.sh`，没有新增检查脚本或运行 `.references` 内文件。

- `bash -n file-storage/deploy/start.sh`：exit 0。
- 原 `bash start.sh --check .../fixture.env`：exit 0，输出 `Cells native delivery validated; no credential values emitted`；其中实际 `docker compose config --quiet` exit 0。
- 实现后主动把 fixture 的原生密码改成上游示例 `admin`：exit 2，输出 `Cells configuration refused: missing, unsafe, or inconsistent native delivery; no services started`。
- 把真实被校验 DSN host 改为 `core-db`：exit 2，同样拒绝，不把跨服务数据库当独立实例。
- 恢复原 fixture 后同命令 exit 0。`docker ps --all --filter label=com.docker.compose.project=kailo-cells-fixture` 返回零容器，未发生启动。

原件分别为该目录 `valid.log`、`default-admin-rejected.log`、`cross-database-rejected.log`、`restored.log`。检查本机原 Compose 帮助时确认 `start` 不支持 `--wait`，实现已使用其实际支持的 `up --no-build --no-recreate --pull never --wait --wait-timeout`，不是假定 CLI 功能。

未执行 full、产品编译、镜像构建、生产配置投递、服务启动、Core binding、模型或工具调用。联合批次由主线统一验证；本回执不声称部署已完成。

## OIDC 投递补齐的影响与实测

权威仍为 `.design/07` §4.6 和上述独立原生管理边界。重新核对只读 Cells
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`idm/oauth/grpc/service/service.go::initDefaults`，原生生产者直接消费
`CELLS_OAUTH_CONNECTORS`；`upstream_manifest.py status file-storage` 退出 0，
HEAD 即基准，无新提交。新增投递只连接该生产者与已有
`frontend/web/kailo-oidc.go::loadKailoOIDC/readNativeOIDCSecret`，不改变 UI、
Core、四语言契约、数据库格式、Workflow 或权限判断。Web/Desktop 继续使用
服务自己的登录，Mobile 不新增原生管理入口。

变更为 `compose.yaml`、`start.sh` 和原 `.env.example`：配置中唯一的
`kailo-oidc` connector 必须引用已挂载的同一 client secret；缺失、空文件、
权限不合规或挂载错位在启动前拒绝，不回退共享凭据。这是 `PRECONDITION`
类运行输入问题，不写新的 API reason code。原 native handler 继续负责
OIDC 配置语义、超时、state/nonce/PKCE 与撤权。此刀没有外部请求、在途任务、
重放、新状态或持久迁移；原调用幂等、UNKNOWN 和并发边界不变。

本次原件目录 `codex-cells-oidc-delivery-20261005.u69qeA` 位于 Data tmp。
原 `start.sh --check fixture.env` 退出 0；原 Compose JSON 实际读回两项
投递对应关系，输出 `PASS native connector and matching secret mount reach Cells`。
临时删除生产 Compose 的 connector 环境字段后，同一读回检查因
`KeyError: CELLS_OAUTH_CONNECTORS` 退出 1；原行还原后退出 0。
将隔离 fixture secret 权限改为 0644，原 launcher 退出 2；恢复 0600 后
原 `--check` 退出 0。项目标签 `kailo-cells-fixture` 的容器数量为零。

最终配置检查日志 `check-final.log` SHA-256 为
`5c6031aa55784577465989342a94c5c1049139d472fabf96a6bc57c8d6d002fb`；
生产变异 `render-mutation-exit.log` 为
`7bbec8d1ea752e1a30fe64902ca2beea7e1b7f039200a743ab455f00364144d2`；
恢复 `render-restored-exit.log` 为
`9fdad3035d1f9342febf5e5bcf7b01d53a5a0796b6e35c0044cb9bdb1864ac45`。
第一次 fixture 使用 Compose 不支持的 shell source 行，原配置检查退出 1；
修正为 dotenv 原字段后通过。第一次读回断言误以为 target 不含
`/run/secrets/`，实际 Compose 已规范化为绝对路径，修正观察后通过。
首次变异包装命令提前展开 shell 退出码，不能据其 exit 0 计通过，已用
同一生产变异和正确 pipefail 重跑得到上述真实 exit 1。没有修改产品迎合
这些执行器错误。启动脚本 Bash/Python 只做既有运行输入与容器元数据检查，
未编译、未运行宿主项目 SDK、未启动任何业务实例；整批 full 仍由联合批次执行。

## 2026-10-06 首次真实原生投递与修正

本批关联 DD-87/93 及 `07` 原生管理页面合同。实际用
`572aa25d6afb485b092cc5160b2ea672233545c6` 的独立源码 clone 运行原
`tools/build-upstream.sh file-storage-service`，不是原版下载镜像。
构建前回读现有 builder 为 8 CPU / 16 GiB memory+swap，缓存实际位于
`/volumes/data/kailo/buildkit-core-state`；Data 起始剩余约 22 GiB，未清缓存。
固定 Go/Alpine 基础层与一部分 Go 模块首次补下载，随后源码编译并推送退出 0。
首次镜像摘要为 `sha256:458ef5cf1d24f8712e1f661063f6dcc5d93e3f925d67514f9538cd8cdb6d6058`；
下述启动失败意味着它不是可运行交付，不据此填写正式可用产物。

首次原 launcher 的网络创建报 `all predefined address pools have been fully subnetted`。
只读核对现有 Docker 网络与宿主路由后，为本独立组件配置两个不重叠的 IPv4
子网；Compose 从 `CELLS_DATA_SUBNET` / `CELLS_UI_SUBNET` 读取，数据网络仍
internal，不删除或共享其他项目网络。既有 `start.sh --check` 同时拒绝两个
子网重叠。实现后将私有配置的 UI 子网改成数据子网，原检查退出 2；按原字节
还原后检查退出 0。实际独立 PostgreSQL 启动 healthy，未写 Core 数据库。

随后 Cells 原进程在 `common/config/sample.go::SampleConfig` 初始化 panic：
通用构建入口把 `VERSION` 覆盖为 commit 前缀，而原
`common/naming.go::Version` 调 `hashiversion.NewVersion` 要求语义版本。
固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的 `Makefile::CELLS_VERSION`
已提供原值来源 `DEV_VERSION`。因此 Dockerfile 和来源登记直接复用
`CELLS_VERSION`，不改上游版本解析、不包默认回退、不修改通用构建工具；
原编译 RUN 后实际执行 `/out/cells version`，避免再次把不可启动二进制当产物。
仅停止失败的 Cells 容器，保留已创建的独立数据库。

本批已有受控配置创建并回读组件专属 OIDC client，只允许自己的 callback、
授权码与 PKCE S256；未开启 password grant、隐式流或 service account。
已有租户的 ACTIVE human 身份只读查询后逐个向 IdP 回查，实际为 3 人。
原生用户创建与 UUID 回查前，不生成 connector 用户映射，更不将三人映射到
原生管理员。独立文件只保存本组件凭据，mode 0600，不复制平台管理凭据。

影响仅为本组件构建参数、运行期网络配置和既有原生启动流程；无 Core schema、
权限、工作流、额度或审计权威变更。旧实例若已有数据库与身份，入口仍保留原
文件和数据库，不重装或重建。SSO、当前 scope、原生管理页及工具资源仍需真实
回执，数据库 healthy 或容器创建不代表这些能力完成。

原件位于 `/volumes/data/kailo/tmp/cells-native-release-20261006.WqLHxk/`：
`build.log`、`deploy.log`（默认地址池失败）、`deploy-subnet.log`（原生启动失败）、
`subnet-mutation.log`（退出 2）与 `subnet-restored.log`（退出 0）。
本节记录的是首次实际失败及对应修正，修正后的镜像和登录不借用首次构建结果验收。

## 2026-10-06 原生启动与配置消费实测

固定 apps `8e6aa4bb7a12ea43fe250db32398b8e7dd24396b` 的原构建命令退出 0，
生成 `file-storage-service@sha256:a1c229f039bd4214874f307568283b0450ad5156de8a8b0dfd89f1a9bdb8010e`。
同一次构建实际执行 `cells version`，输出 `5.0.3-dev` 与该完整 apps commit，
修正了前次版本解析崩溃。构建仍实际下载部分固定基础层及缺失模块，不能称全离线；
`BUILD_STAMP` 当次带尾随 Z，而原 `common/naming.go::MakeCellsVersion` 只解析无 Z
格式，因此版本页的 Built 显示零时间，不能拿该展示当正确构建时间证据。

原 `deploy/start.sh` 实际启动独立 PostgreSQL 与 Cells，两个服务均 healthy。
Playwright 访问原生页面取得完整原版登录表单，不是平台重写或 iframe。
但 `/auth/kailo/login` 返回 `503 Native OIDC is unavailable`，没有成功 SSO。
原生管理命令实际创建并回读 3 个 `standard` 用户，逐一对应既有 ACTIVE human，
没有映射原生 admin。映射只写进本组件受控 connector 配置，尚未证明登录。

四步依据与修正：

1. 权威为 DD-87/93、原生独立身份配置及上游 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `cmd/admin-config-set.go::updateConfigCmd`、
   `idm/oauth/grpc/service/service.go::initDefaults` 与
   `idm/oauth/web/service/service.go::init`。前者未解析 JSON 且忽略 `config.Set`
   错误，后者环境变量生产者的唯一挂接被注释；原 OAuth 首次迁移包含不安全默认 secret。
2. 影响仅为原配置命令、原镜像 entrypoint、现有独立 Compose/launcher 与组件私有
   secret 文件；无 Core 数据、成员、权限或工作流迁移。原 JSON 参数被实际解码，
   Set/Save 任一失败返回错误而不显示成功。原 password connector 与完整 UI 保留。
3. 同一 entrypoint 在原安装流程完成后、原 `cells start` 开放监听前，调用同一原命令
   投递组件自己的 OAuth secret 与 connector；不引入初始化容器、第二配置权威或共享
   平台密钥。secret 是 owner-only JSON 字符串文件，与外部 IdP client secret 分离。
4. 畸形 JSON、配置写入失败、缺失/默认/复用 secret 均拒绝；不吞异常，不回退管理员。
   真实回读发现旧默认 OAuth secret 后已停止此次新建 Cells 容器，保留独立数据库，
   没有清库重装或宣称就绪。同一密钥文件在后续重启保持，不随启动生成新值。

现有 `start.sh --check` 的受控配置验证退出 0；私有副本改成原默认 secret 后退出 2，
原字节恢复且 `cmp` 退出 0 后，原检查恢复退出 0。Bash/sh 语法检查退出 0。
本轮镜像与运行日志位于
`/volumes/data/kailo/tmp/cells-native-fixed-20261006.F1fLT8/`：
`build.log`、`deploy.log`、`oauth-secret-mutation.log`、`oauth-secret-restored.log`。
原配置命令窄验证复用受限 `kailo-cells-native-check-lftow7`（4 CPU / 8 GiB），
执行 `go test -mod=readonly ./cmd -run "TestConfigSet|TestDisplayMap" -count=1 -v`。
首次编译实际下载缺失的固定模块，随后原包初始化因默认工作目录不可写而退出 1，
日志为 `native-config-command.log`；改用原 `CELLS_WORKING_DIR` 指向缓存内独立临时
目录后，原展示用例及三个配置用例全部通过，退出 0（`native-config-command-restored.log`）。
没有为验证修改产品的工作目录规则。

实现后的私有副本将配置写入故意恢复为原字符串且忽略 Set 错误，实际得到
`TestConfigSetKeepsJSONConnectorValues` 与 `TestConfigSetPropagatesWriteFailure`
两项失败、另外两项通过，退出 1（`native-config-command-mutation.log`）。
按正式源原字节还原且 `cmp` 退出 0 后，同命令四项全部通过，退出 0，
`ok github.com/pydio/cells/v5/cmd 0.023s`（`native-config-command-final.log`）。
原 CLI help 同步明确字符串需要保留 JSON 双引号，布尔、数字、数组和对象保留各自
类型；全文调用检索仅现有 entrypoint 两处，两者均传入 JSON。

修正后的新镜像启动、真实 SSO callback、本人身份回读及平台 binding 尚未通过；
不借用上述旧镜像 healthy、原账号准备或源码窄验声称完成。
