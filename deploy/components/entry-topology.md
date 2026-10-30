# 入口拓扑：组件 origin 只经 Kailo 网关（DD-164(10)）

设计：`.design/02` DD-164(10)，`.design/07` §4.6「入口拓扑」。本文件是该设计在本仓库的实施与迁移步骤，
与 `component-deploy.sh`、`deploy/local/edge-overlay.py`、`platform-config-check.sh` 同步维护。

## 目标拓扑

| 对外入口 | 宿主发布者 | 说明 |
|---|---|---|
| Kailo Web / BFF（`AGENTGATEWAY_PORT`）、原生端（`AGENTGATEWAY_NATIVE_PORT`）、webhook（`AGENTGATEWAY_WEBHOOK_PORT`） | `agentgateway` | 不变 |
| IdP（`KEYCLOAK_PORT`）、Relay（`BUZZ_RELAY_PORT`，DD-75） | `keycloak`、`buzz-relay` | 不变 |
| 云盘 58092、知识库 58094、问数 58095、文档编辑 58096 | `agentgateway` 的 `component-edge-*` listener | 由 `.env` `KAILO_EDGE_COMPONENTS` 声明、`edge-overlay.py` 渲染运行目录叠加 `data/edge/agentgateway.compose.json` |
| 组件容器本身 | 只在回环地址（127.0.0.1:58112/58114/58115/58116） | 运维探测与 `document-editor` 回读；`component-deploy.sh` 与各 `start.sh` 拒绝非回环地址 |

组件 origin、IdP 回调、back-channel 地址、`NATIVE_PAGE_ORIGINS`、`frame-ancestors` 与组件 OIDC client 均不变：
浏览器与 IdP 访问的仍是同一个 `http://<主机>:<端口>`，只是该端口由 Kailo 网关监听并转发到组件在平台 edge
网络上的固定别名（`kailo-edge-file-storage:8080`、`kailo-edge-knowledge:80`、`kailo-edge-data-query:8080`、
`kailo-edge-document-editor:80`；组件以各自的 `compose.kailo-edge.yaml` / `kailo-edge.yaml` 叠加加入）。

网关组件 listener 的规则（`deploy/local/model-gateway-config.yaml`，`tools/check.sh` 安全步骤逐条核对）：

- `Sec-Fetch-Dest: document` 的顶层导航 `302` 到 `<PUBLIC_ORIGIN>/app/applications/open?origin=<组件 origin>&path=<原路径与查询>`，
  由 Kailo 在内容区打开；文件类路径（云盘 `/io/ /a/ /wopi/ /dav/`、知识库 `/api/ /files/`、问数 `/api/`、
  文档编辑 `/downloadfile/ /printfile/ /cache/files/`）的顶层请求照常转发，下载与打印不被打断。
- 其余请求（iframe 导航、子资源、XHR、WebSocket、IdP 服务端 back-channel `POST`、文档编辑服务与云盘之间的
  WOPI 与 discovery 服务端请求）以原 Host 转发，组件自己的 cookie 与 `Authorization` 原样保留；只移除平台身份
  header 与 `proxy-authorization`。
- 文档编辑 origin 的运维与服务端接口（`/healthcheck`、`/info`、`/example`、`/welcome`、`/internal`、`/command`、
  `/coauthoring/CommandService.ashx`、`/ConvertService.ashx`、`/converter`、`/docbuilder`、`/lool`、`/cool`、
  `/hosting/capabilities`、`/hosting/wopi/convert-and-edit*`、`/wopi/files`、`/dummyCallback`、`/ai-proxy`、`/metrics`，
  大小写不敏感）对外一律 `404`。云盘只以服务端身份读取 `/hosting/discovery`（未被拒绝），不调用上述接口。

## 迁移（07 §4.6 ①–④）

前提：包含本实现的提交已合并并按发布入口发布（网关配置含四个组件 listener，此时它们只是容器内的空闲端口，
运行目录没有 `data/edge/agentgateway.compose.json`，网关只发布 Kailo 自己的入口——①）。每一步只经部署入口，
先备份（`component-deploy.sh` 自带数据库/卷备份；平台 `.env` 先 `cp -p .env .env.bak-<UTC>`）。

逐个组件（建议顺序：document-editor → file-storage → knowledge → data-query），在维护窗口内：

1. 改组件受控 env（`/volumes/data/kailo/components/...`，0600）：发布地址改为 `127.0.0.1`、端口改为 581xx
   （见上表），加 `<前缀>_EDGE_NETWORK=<平台 PLATFORM_EDGE_NETWORK>`（问数由入口自动传入）。值与
   `deploy/components/<组件>.env.template` 一致。
2. `component-deploy.sh <组件> <commit> --check`：入口拓扑检查必须报告「只在回环地址发布，origin 由 Kailo 网关提供」。
3. `component-deploy.sh <组件> <commit>`：组件以不公开端口的声明重建（②）。此刻到第 5 步完成前该组件对浏览器不可达。
4. 平台 `.env` 的 `KAILO_EDGE_COMPONENTS` 加入该组件（`<组件>=<origin 端口>`），在发布树 `deploy/local` 下执行
   `KAILO_RUNTIME_DIR=<运行目录> ./edge-overlay.py render`：仍有其他容器发布该端口时拒绝。
5. 以发布入口重建网关：`kailo-release.sh run --until deploy`（漂移收敛按登记叠加 `data/edge/agentgateway.compose.json`
   重建 `agentgateway`），或在发布树 `deploy/local` 下以 `node.py` 同一 Compose 参数
   `docker compose --env-file <运行目录>/.env -f compose.yaml -f <运行目录>/secrets/agentgateway-service.compose.json -f <运行目录>/data/edge/agentgateway.compose.json up -d --no-deps --no-build agentgateway`。
6. 逐项验证（③）：
   - `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Sec-Fetch-Dest: document' http://192.168.0.193:<端口>/` → `302 http://192.168.0.193:58090/app/applications/open?origin=...`
   - `curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.193:58096/healthcheck` → `404`；`/hosting/discovery` → `200`
   - `deploy/components/platform-config-check.sh <commit>` 第 7 节无 FAIL
   - qa 账号在 Kailo 内打开该组件：静默登录、上传下载、（云盘）打开并协同编辑文档、退出后组件会话失效（back-channel）。

全部四个组件迁移后，把 `KAILO_EDGE_COMPONENTS=file-storage=58092,knowledge=58094,data-query=58095,document-editor=58096`
登记进 `tools/release/release.yaml` 的 `env.set`（代码变更、普通发布），此后由发布入口保证。

## 回退（④）

对一个组件：从 `KAILO_EDGE_COMPONENTS` 去掉它，`edge-overlay.py render`，按第 5 步重建网关（释放该端口）；
再把组件受控 env 的发布地址与端口改回（例如 `0.0.0.0:58092`，同时去掉 `_EDGE_NETWORK`）——这需要临时还原
本实现之前的 `start.sh`/`component-deploy.sh`，因为现行入口拒绝非回环地址；更快的回退是保持组件不公开端口、
只修网关 listener。origin、IdP client 与 frame-ancestors 不需要任何变更。

## 证据

- 网关规则在 CI 节点以固定 `model-gateway` 镜像与假组件后端实测（顶层 302、iframe/XHR/WebSocket/大上传/back-channel
  透传、Host 保持、文档编辑运维接口 404），记录见分支提交说明。
- 安全不变式：`tools/check.sh` 安全步骤的 `component-edge-*` 规则。
