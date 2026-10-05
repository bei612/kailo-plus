# Cells 独立原生部署接缝

## 当前结果

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
