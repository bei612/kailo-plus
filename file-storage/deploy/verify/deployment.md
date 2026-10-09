# Cells 独立原生部署接缝

## 2026-10-08 适配器实际打包与可选启动

本批解决已有 `adapter/src/main.mjs` 无镜像配方和部署消费者的问题；不恢复原版
无治理调用、不更改 Cells 页面。`tools/build-upstream.sh file-storage-adapter`
现消费本工程 adapter、锁定的 XML 解析依赖及 `client-kit/adapter` 实际跨目录
imports。构建上下文为 apps，专属 dockerignore 不带原生数据、密钥或 node_modules。
Node digest 复用 `tools/check.Dockerfile`，npm 使用 lockfile、BuildKit 缓存及
`--ignore-scripts`，不在镜像层渲染凭据。

正常独立 Cells 启动命令不变。已投递组件专属 OpenBao Agent 的目录、Unix
proxy 与绑定配置后，使用 `bash file-storage/deploy/start.sh --check
--platform-adapter CONTROLLED_ENV_FILE` 核对投递，再移除 `--check` 启动。
可选模式只 create/up `cells-adapter`，不重建 Cells 或数据库；镜像须已存在
且固定 digest，`--pull never` 不重复联网取镜像。独立 Agent 仍由原受控
AppRole 投递负责：无 cache、`api_proxy.use_auto_auth_token="force"`、专属
Unix socket，不能拿共享管理 token 或伪造审计文件替代。

四步结论：

1. 权威为 DD-87/89/93、原 FILE_STORAGE 接入合同与现有绑定校验。固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/restv2/api.go::Handler.TreeNodeToNode`、`Handler.ContextWorkspace`
   已用 git grep 重新核验；没有另立服务、身份、资源或授权权威。
2. 影响为适配器镜像输入、已有 start.sh 的显式可选消费者与环境模板；配置
   继续由 `query-revision.mjs::configuration` 解释。无合同、数据库、Workflow
   格式变化及迁移；原两服务配置回读保持相同，Web/Desktop/Mobile 传输边界不变。
3. 所有投递文件与 socket 必须位于该组件独占的 owner-only 目录，非 root
   adapter 同 UID/GID 只读挂载，且与原生/数据库目录互不包含。没有宿主发布
   adapter 端口。启动回执不充当 Core 的 release/binding 验证和 ACTIVE 证据。
4. 缺配置、权限不符、目录逃逸、非 socket 或缺本地镜像拒绝启动；实际原生
   超时、撤权、用量与绑定验证仍由已实现调用链处理，不重放副作用。没有新
   持久状态；本批不增加在途任务或改变 UNKNOWN 的处置。

实际验证：既有 4 CPU/8 GiB SDK 内，`npm ci --offline --ignore-scripts
--no-audit --no-fund --cache /cache/npm` 退出 0，3 个锁定依赖安装成功；既有
`node --test test/*.test.mjs` 为 126/126。实际 import 共享 protocol 和 xml2js
退出 0；未投递配置运行 `node src/main.mjs` 退出 1，原文
`file storage adapter configuration unavailable`。验证源码与当前源逐文件 cmp
一致；旧候选缺 main/native-reference 文件已补入，未把缺文件当完整输入。

`bash -n`、原 launcher 独立模式及 adapter `--check` 均退出 0；实际 Compose
回读确认原两服务不变、adapter 无公开端口、有限 CPU/内存及同绝对路径只读
mount。将投递 SERVICE 文件权限改为 0644，原 launcher 退出 2；恢复 0600 后
退出 0。主动把生产 overlay 的 mount 改为可写，回读断言退出 1；还原后
退出 0。实现后交叉复核发现符号链接祖先可能让宿主解析成功而容器字面路径
不可达，已要求目录及每个投递文件/socket 使用真实绝对路径；把配置改为
符号链接祖先路径，原 launcher 退出 2，还原后退出 0。
首轮观察脚本误把 Compose 省略的 false 属性视为必有 key，曾报
`KeyError: create_host_path`；按实际序列化语义修正后才取得上述正反结果。
旧 OIDC fixture 缺当前 native OAuth/subnet 输入，首次原 launcher 退出 2；
新 fixture 只作配置读取，无真实凭据、binding 或容器启动。
实际 `docker compose create --help` 核对不支持 `--no-deps`，启动命令已移除
该参数；adapter 本身没有 depends_on，仍以明确服务名限定 create。up 的
`--no-deps` 保留，不把仅通过 config 解析当作所有启动参数已验证。

证据目录 `/volumes/data/kailo/tmp/cells-adapter.L8MUbo`；锁依赖与 126 项输出为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/read-receipts-20261007/cells-packaged-dependencies.log`。
Data 剩余约 1.2 GiB，未运行镜像构建、完整检查、实际部署、三端业务或 binding
激活，artifact/source digest 均如实为 none；本批不是 Cells 集成全部完成。

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

## 2026-10-06 原生 OAuth 回调与原 UI 接缝

apps `3309938e3d5f7665fde398d8b95c1e4f6da7a1ca` 经原受限 builder 构建及推送退出 0，
产物为 `sha256:3a569d2f0595dec838c137bdec4f238951f29846e9e4c21e2a464ac4b6234a00`；
版本自检显示 `5.0.3-dev`、正确构建时间与该完整 commit。原独立 launcher 退出 0，
保留数据库，只替换 Cells 容器。原配置回读确认 OAuth secret 等于受控文件，
保留 `pydio` 与 `kailo-oidc` 两类 connector，以及三个不同原生 UUID 映射。
这些结果仍不代表 SSO 完成。

第一人的真实浏览器授权已完成外部 IdP 校验及原生单次 code 签发，但被送到
`/auth/callback` 后原页面仍是登录框，未发出原 `/a/frontend/session` 请求。
固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`idm/oauth/grpc/handler.go::Exchange` 以 `/auth/callback` 作为内部 OAuth
`redirect_uri`；同版本 `frontend/assets/gui.ajax/res/js/ui/ReactUI/router/Router.js::getRoutes`
把真正的 UI `LoginCallbackRouter` 挂在 `/login/callback`，其
`frontend/assets/gui.ajax/res/js/ui/ReactUI/router/LoginCallbackRouter.js::LoginCallbackRouterWrapper`
调用原 `RestClient.sessionLoginWithAuthCode`。此前接缝错误混用了两种地址。

诊断仅将同次未消费的原生 code 送到这个既有 UI 路由，原 session 交换与用户状态
读取均实际成功，首页显示原新手引导。页面身份为 `kailo-bootstrap-admin`，UUID
`1860170d-e93e-499d-8140-ce54011c29ab`，profile 为 `standard`、`isAdmin=false`。
实际截图 `01-native-identity-diagnostic.png` 已打开复核；这一手动定位只证明后半链，
不作为正常登录完成或其他两人验收。

本次修正只在 `nativeFrontendCallback` 验证内部注册回调后，将最终浏览器落点改为
原 UI `/login/callback`，保留同源、原 client、单次 code、state、fresh native policy
及 `LoginSuccessWrapper`，不修改内部 Exchange、注册 URI、账号、权限或密钥。
跨源／未知 client／畸形回调继续拒绝；没有新增页面、第二 session 权威或认证绕行。
旧 IdP callback `/auth/kailo/callback` 与 native code 格式不变，无数据迁移。

本节构建、部署及截图原件在
`/volumes/data/kailo/tmp/cells-oauth-release-20261006.sXLzLf/`；浏览器诊断不替代修正版
产物的正常三人登录、平台 binding、资源与工具调用验收。

实现后复用原 4 CPU / 8 GiB Go SDK，执行
`go test -mod=readonly ./frontend/web -run TestKailoOIDC -count=1 -v`。
首轮 SDK 没有同步已提交的 `common/auth/native-oidc-user.go`，因此编译报两个
undefined symbol（`native-callback-tests.log`）；从同一固定 3309938 源补齐该文件后，
八个顶层目标与九个 HTTP 子例全部通过（`native-callback-baseline.log`，退出 0）。
私有 SDK 删除新增的 UI 路由映射后，两个正向 HTTP 子例及 callback 用例真实失败，
其余拒绝分支保持通过（`native-callback-mutation.log`，退出 1）。按正式源原字节
还原且 `cmp` 退出 0 后，原全部目标恢复通过（`native-callback-restored.log`，
退出 0，`ok github.com/pydio/cells/v5/frontend/web 1.041s`）。未运行 full。

## 2026-10-08 原生当前 actor 配置的真实投递消费者

本批补的是已有 `gateway/restv2/native-actor.go::Handler.nativeActor` 的启动配置生产者，
不是创建账号或批准 binding。此前 adapter 可携带经过验签和 fresh PEP 的当前
HUMAN/AGENT 证明，但原 launcher/entrypoint 没有向其实际读取的
`services/pydio.rest.n/platform` 投递配置、callback SecretRef 文件和私网连接。
无投递时仍保留独立原生页面与原 ACL，不借用 SERVICE 或 initiating HUMAN。

四步影响说明：

1. 权威为 DD-89、`.design/07` §5.2/8A 及既有 native actor/ACL 接缝。重新核验固定
   Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `cmd/admin-config-set.go::updateConfigCmd`、
   `gateway/restv2/api.go::NewHandler`、
   `gateway/restv2/api-lookup.go::Handler.GetByUuid`、
   `gateway/restv2/api-versions.go::Handler.NodeVersions` 和
   `tools/docker/images/cells/docker-entrypoint.sh`，复用原命令、config store、原生读取
   与监听顺序；`tools/upstream_manifest.py status file-storage` 退出 0，固定版本与证据
   HEAD 一致。没有运行上游证据目录的代码。
2. 写入范围为原 config-set 命令/原检查、原镜像 entrypoint、独立 launcher/.env 示例及
   一份 opt-in Compose overlay。新增 `--value-file` 在原 RunE 内读取 JSON，继续走原
   `config.Set`/`config.Save`；值不经 argv，文件读取/JSON/Set/Save 失败均不打印值。
   file 模式错误固定脱敏，原 inline JSON 类型与错误关联保留。没有 schema、数据库、
   Core、工作流或权限模型迁移，没有修改页面。既有 dirty `deploy/compose.yaml` 不属于
   本批写入，不能随本批提交。
3. launcher 只接受成对的 `CELLS_NATIVE_ACTION_DELIVERY_DIR` 与
   `CELLS_NATIVE_ACTION_CONFIG_FILE`。真实绝对目录须 owner-only、与数据/adapter
   投递目录分离；配置及 callback 凭据须同 owner、0400/0600、无 symlink/目录逃逸。
   配置字段精确匹配现有 native actor 消费者，绑定/租户/native UUID、非空受控边界、
   唯一 HUMAN/AGENT→已有 native User UUID 映射逐项检查，不能映射 SERVICE UUID。
   overlay 只挂只读目录并复用现有 `CELLS_ADAPTER_PLATFORM_NETWORK`，数据库不接该网。
   原 OAuth secret 同步改走本地文件参数，不再将其内容展开到 argv。没有 JSON 执行、
   shell eval、远端启动脚本或第二份身份/授权目录。
4. 原 entrypoint 在原 `cells start` 监听前调用原配置命令。缺文件/不可读/畸形内容、
   写入或持久化失败停止启动；Save 失败可能已有部分原配置变更，不宣称回滚或成功。
   重复启动仅设定同一原配置，不执行文件业务动作。首次安装仍沿原 configure，无配置
   仍沿原独立启动。运行期仍由原 nativeActor 每次读取配置、原 Core PEP 校验当前
   actor/scope/AE/binding/generation/资源及原 User 锁定/ACL；静态目录不证明这些运行事实。

实现后使用现存 `kailo-cells-native-check-lftow7`，UID 1000:1000，4 CPU / 8 GiB，
MemorySwap 同为 8 GiB，无额外 swap。复用 `/cache/mod`、`/cache/build`，没有新镜像、
依赖下载或数据库。检查前确认 SDK 无在途编译；终态 cgroup lifetime memory.peak 为
2,538,696,704 bytes，全部 memory.events/OOM 为 0；这不是本批独立采样峰值。
实际原四包命令为：

```sh
sudo -n docker exec -e GOCACHE=/cache/build -e GOMODCACHE=/cache/mod -e GOPROXY=off \
  -e CELLS_WORKING_DIR=/tmp/cells-native-actor-check \
  -e CELLS_DATA_DIR=/tmp/cells-native-actor-check \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  /usr/local/go/bin/go test -mod=readonly \
  ./cmd ./common/auth ./common/auth/protocol ./gateway/restv2 \
  -run 'TestConfigSet|TestNativeEntrypoint|TestAuthorizeActionUsesOriginalBindingPEP|TestNativeActorUsesExactControlledUser|TestNativeIndependentReadDoesNotImpersonate|TestNativeActorPolicyDoesNotBorrowTransportProfile|TestResolveNativeActorUserRejectsMissingChangedAndLockedUsers' \
  -count=1 -v
```

首轮正向 handle 56240 退出 0：10 顶层 +38 子项通过。随后补入 file 模式 Set/Save
错误脱敏及 Save 失败检查，首轮 48 项不能作为最终字节的验收。最终私有候选实际移除
JSON 拒绝、移除 Set/Save 脱敏并跳过原 entrypoint 配置命令，handle 35824 退出 1：
3 顶层 +5 子项失败，另 7 顶层 +34 子项通过。正式源没有破坏。按正式源原字节还原
后 handle 26331 退出 0：10 顶层 +39 子项全部通过，0 skip；原 CLI/config-store 检查与
原 native actor/PEP/锁定用户检查均实跑。entrypoint 进程 fixture 只证明原脚本的
命令/argv/监听顺序，不冒充真实数据库持久化或 native 服务启动。

Go 原件目录为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/`：

- `cells-native-action-delivery-positive.log` SHA-256
  `b070e7b530a1ac9344bbead704df9ec1c690399a11b22eb7aeb336148b443d4a`；
- `cells-native-action-delivery-mutation.log` SHA-256
  `8402c320b27f59d015934c306aef3fce4fb6e8f0563cd17c0161f7159d29ef9e`；
- `cells-native-action-delivery-restored.log` SHA-256
  `60bcd3d6426c5ffb3babfbd2ab4543bd4c5fdb825482fe3a20a02e12b55bdb73`。

原 `deploy/start.sh --check` 的独立无投递 fixture 退出 0；新增私有完整投递 fixture
退出 0。缺字段、重复 principal、凭据权限 0644、配置 symlink 四次实际退出 2，恢复
0400/0600 与原字节后同命令退出 0。fixture 的凭据为明确非真实值，没有启动容器或
创建平台事实。真实 `docker compose ... config --format json` 回读确认目录只读挂载、
不自动建宿主目录、现有 callback 私网以及数据库网络不变，退出 0。私有 overlay 将
`read_only` 改为 false 后同一实际 JSON 断言退出 1，恢复原 overlay 后退出 0。
这些 launcher/Compose 原件为
`/volumes/data/kailo/tmp/cells-native-action-delivery.gJxSPm/` 中
`check-{positive,missing,ambiguous,permissions,symlink,restored}.log` 与
`render-{positive,mutation,restored}.log`。最终六个自有源码/配置输入及六个直接依赖
与 SDK 候选逐字节 `cmp` 为 0，`bash -n`、`sh -n`、范围 `git diff --check` 退出 0。

本批未构建镜像、未部署、未跑 full、未交付真实 actor 配置/SecretRef，也没有真实
Core PEP→原 User→PolicyEngine/tree ACL→文件读取或 Cells→WeKnora E2E/浏览器验收。
必须将新原命令与 entrypoint 一起构建投递；旧运行镜像不证明这些新字节。正常 native
启动才应用配置，`--platform-adapter` 单独启动不会重建 Cells/数据库。移除投递环境项
不自动擦除已持久原配置，撤权仍走原 binding 生命周期/fresh PEP，不能据此声称停用。
原生独立完整 UI 保留；generic write/share、原子条件删除、按 key 终态/usage、完整
FILE_STORAGE 七项及其批准 catalog 仍有缺口，不能以这次配置窄验启用不完整 release。

## 2026-10-09 受控 Read.nativeJobId 的原生启动生产者

已有启动投递能保存 `services/pydio.rest.n/platform.Read.nativeJobId`，但原
`InitDefaults` 只生产 `GetDefaultJobs` 中的 Job；实际 `CopyNativeRead` 经原
JobService 读取投递的 ID 后因没有 Job 拒绝。这是缺失需恢复的真实生产者，不是
另建注册表或批准 FILE_STORAGE 子集。本批在原 Job store 启动路径创建纯持久化
Job，原 GET/Lookup/NodeVersions 才执行读取；不派发自动任务或生成授权事实。

四步影响说明：

1. 权威为 DD-89、DD-93、`.design/07` §5.2/8A 与既有 native-read/Task 接缝。
   固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 已只读核验
   `scheduler/jobs/grpc/service/service.go::InitDefaults`、
   `scheduler/jobs/grpc/defaults.go::GetDefaultJobs`、
   `scheduler/jobs/grpc/handler.go::JobsHandler.GetJob/PutJob`、
   `scheduler/jobs/dao/bolt/bolt.go::boltStore.GetJob/PutJob` 和
   `scheduler/jobs/dao/mongo/mongo.go::mongoImpl.GetJob/PutJob`。
   原默认 Job、原独立页面与 ACL 原样保留；新增原启动/DAO 消费者属于已授权治理
   改造，补齐该缺失接缝。没有页面共享迁移适用对象，不声明原版百分之百一致。
2. 实际调用为原 `InitDefaults` 及 `WithGRPC` 注册回调 →
   `JobsHandler.EnsureNativeReadJob` → 原 DAO `GetJob/ClaimJob` → 原存储。
   运行期 `CopyNativeRead` 再核对该 Job 的完整语义，不能借相同 ID 的别类任务。
   `NativeReadDelivery.Validate` 同时被真实授权消费者和启动消费者调用。
   私有配置字段、Job protobuf、公共契约未改变；不涉及四侧生成。
   Bolt 在原事务内 create-only，Mongo 在原 collection insert-only 并为 `jobs.id`
   增加唯一索引。历史重复 ID 使迁移失败，不自动删除、选择或覆盖。字段旧读者可读，
   但旧启动生产者不会应用本次 bootstrap；运行仍须构建投递新源码。
3. 创建的 Job 只有原 ID/label/system owner 与 silent Task 更新属性；system owner
   是原 Job 元数据，不是执行 actor。不含 actions/events/schedule/AutoStart、Task 或
   run parameters。没有权限、quota、binding、正文或第二任务权威。读取仍逐次消费
   原 ActionToken、scope、generation、fresh PEP、native 当前用户及 ACL。
   同 ID 漂移拒绝，冲突只回读；写入 ACK 丢失直接阻断启动，不重写，后续启动只读
   原持久 Job 确认。只有原明确 `JobNotFound` 允许首次创建。
4. 没有平台配置或没有 Read 时不生成 Job，保留独立启动；空 ID、缺失/null meters、
   未知或重复 meter、缺失/非法 deadline 拒绝。NONE 仅显式空数组成立，不补默认零。
   使用原投递的正 `RequestTimeout`，没有新增默认值/阈值。配置缺失映射前置条件，
   Job 漂移映射冲突；存储/超时未知仍失败关闭，不成为业务成功或确定失败。
   启动回调错误阻止 JobService 注册/服务 ready；不宣称整个网络 listener 尚未创建。
   原 DAO `GetJob` 没有 context 参数且 Mongo 使用 background，本批不宣称该读取已
   全程有界。空 Job 生命周期沿原 JobService，claimed Task 的安全退休与期限仍缺
   确认协议，保留发布阻断，不发明 TTL 或墓碑表。

实现后复用 `kailo-cells-native-check-lftow7`，UID 1000:1000，实际 4 CPU / 8 GiB，
`cpu.max=400000 100000`、`memory.max=8589934592`、`memory.swap.max=0`。
复用原 `/cache/mod`、`/cache/build` 和 Data 私有临时目录，无新镜像、依赖、数据库或
SDK。最终恢复前宿主 MemAvailable 29,610,808 kB、memory PSI 为 0；root 原 BuildKit
及两个 Java 进程仍在，共享 Data I/O 高，不伪称独占。终态 cgroup lifetime peak
2,632,499,200 bytes，全部 memory.events/OOM 为 0；不是本批独立峰值。

实际原五包命令（原目标串行正向、私有生产破坏、还原各一次）：

```sh
sudo -n docker exec -e GOCACHE=/cache/build -e GOMODCACHE=/cache/mod -e GOPROXY=off \
  -e TMPDIR=/workspace/file-storage/native-read-job-tmp.rY97lf \
  -e CELLS_WORKING_DIR=/workspace/file-storage/native-read-job-tmp.rY97lf \
  -e CELLS_DATA_DIR=/workspace/file-storage/native-read-job-tmp.rY97lf \
  -w /workspace/file-storage kailo-cells-native-check-lftow7 \
  /usr/local/go/bin/go test -mod=readonly \
  ./common/auth ./scheduler/jobs/grpc ./scheduler/jobs/grpc/service \
  ./scheduler/jobs/dao/bolt ./scheduler/jobs/dao/mongo \
  -run 'TestNativeReadJobStartupConsumesOriginalDelivery|TestNativeReadTaskRecordsActualStreamOnce|TestNativeReadAuthorityConsumesExactActorAndOriginalOperation' \
  -count=1 -v
```

原始失败全部保留：`positive.log` 的原 config stub 合并触发 typed-nil panic，且首轮
未指定 Data TMPDIR，不作为最终合规验收；`positive-corrected.log` 将模块根错误用作
TMPDIR，Go 忽略 go.mod，未进入检查。`positive-final-input.log` 的 DAO fixture
每次 Resolve 重置故障/计数，修为原数据库共用 fixture 状态；
`positive-final-fixture.log` 的 fixture 2s deadline 遇共享 I/O 超时；
`positive-delivery-window.log` 用投递 1m 仍有四个并发请求明确超时。最终并发断言
允许原明确 DeadlineExceeded 拒绝，同时仍要求唯一完整 Job、零 PutJob/Task/事件；
没有扩大生产 deadline，也没有吞其他错误。以上五轮实际退出 1，不算通过。

最终 `positive-delivery-final.log`（handle 55327）退出 0：3 顶层 +80 子项 PASS，
0 fail/skip。随后仅私有候选将真实 `NativeReadJobMatches` 语义比较改为恒真，并移除
真实 Bolt `ClaimJob` 同 key 拒绝，`mutation-final.log`（13413）编译成功后退出 1：
1 顶层 +11 子项失败，2 顶层 +69 子项通过；实际捕获十种 Job 漂移与覆盖同 ID。
正式源未破坏。精确恢复两生产文件后，同一原命令 `restored-final.log`（37521）
退出 0：3 顶层 +80 子项 PASS，0 fail/skip，grpc `ok ... 240.045s`。
顶层/子项是层级统计，不相加成独立验收数。service/Bolt/Mongo 三包显示
`[no test files]`，仅编译；真实 Bolt DAO 在原 grpc fixture 中调用，Mongo 实库与
唯一索引迁移因无受控 fixture 明确 SKIP。最终八源码及 go.mod/go.sum 与 SDK
逐字节 `cmp` 均为 0，八源码 `gofmt -l` 无输出。

原件目录 `/volumes/data/kailo/tmp/cells-native-read-job-startup-20261009.qSbdg9/`：

- `positive-delivery-final.log` SHA-256
  `4ea4e24d716560451e584dc8c2651eed5b9176ed3d1bed78820f9f90b701d962`；
- `mutation-final.log` SHA-256
  `a9205e9439eba4b5f0cb83e6dff0b84b6ba101b5840b25ce222fffa1fe9e78af`；
- `restored-final.log` SHA-256
  `e563399ba005eda654996fd6af1e52ad6eb0b4ac2aff88194b9fe8732eefcba8`。

本批未部署、未构建镜像、未跑 full，没有投递真实 native actor/SecretRef、批准或
激活 release/binding。没有 native HTTP/S3、完整登录页面、实际人类正文交付、
Cells→WeKnora E2E、Windows/Mobile 验收。原 native Task/IO fixture 不证明用户已
收到文件。完整 FILE_STORAGE 七项、write/delete/share、Task 退休与 HUMAN 结果消费
仍有门禁，不因启动 Job 可生产而开放这些能力。继承 `deploy/compose.yaml` 不在本批。
