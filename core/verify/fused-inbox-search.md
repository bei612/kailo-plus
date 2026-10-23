# DD-138 第二阶段：组件通知并入收件箱、组件内容作为搜索来源（验证记录）

设计依据：design-authority `95ee06dca`（`.design/03` ComponentNotification、ExecutionConnector.search_source；
`.design/07` §4.8.3、§4.8.4、§5.2；`02` DD-138(9)；`16` V-SCN-227、V-SCN-228）。
能力记录：`tools/traceability/component.fused_inbox_search.yaml`。

## 源码范围（Core）

- `identity.component_notification`（迁移 `20261026010000_component_notification`，down 删表；
  回滚须与停用投递入口的 Core 一同发布，旧条目只是提醒，组件仍持有业务事实）。
- 服务面投递 `POST /service/v1/component-notifications/bindings/{binding}/notifications`：
  与成员目录同一认证（`component_directory::authorize`），另要求 `KAILO_EMBED`；接收人/触发者按目录范围
  解析（Workspace binding 再做 SpiceDB `discover`）；同 binding 咨询锁内做幂等（同摘要 200、异摘要 409）
  与 60 秒限流（`COMPONENT_NOTIFICATION_RATE_PER_MINUTE`，默认 600，超限 429）；不建 ActionExecution。
- BFF：`GET /api/v1/inbox/component-notifications`（只列 binding 仍 ACTIVE 且本人仍可 discover 的条目，
  90 天内，倒序分页与未读数）、`POST /api/v1/inbox/component-notifications/read`（本人已读）、
  `POST /api/v1/search/components`（`searchSource=SUPPORTED` 的 REMOTE_ADAPTER 扇出，逐 Resource
  fresh `read`，60 秒 Search Token，5 秒超时，来源整体采信或标为 UNAVAILABLE）。
- 发行登记：`executionConnector.searchSource` 可选，`SUPPORTED` 只接受 REMOTE_ADAPTER。
- 保留：发布对账节拍内按批删除 90 天前条目；Tenant 删除同删。

## 验证结果

见下文「CI 记录」。尚未部署，未做生产业务验收。
