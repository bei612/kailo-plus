# 问数：协作与 AI 只有 Kailo 一套（DD-163）

## 权威

设计：DD-163、`.design/07` §4.8.8 裁定表、V-SCN-271/272，design-authority
`5db45c5fdae541e68cc6422423bc560d004d8587`。扩展 DD-138(7)（帮助只由 Kailo 提供）与
DD-128（平台模型路由）。

## 逐项裁定（问数）

| 原生功能 | 裁定 | 本组件内的落实 |
|---|---|---|
| 对话：问答线程、追问、推荐问题、图表与解释 | (c) 核心业务 | 不改。模型只经 AgentGateway：`docker/config.template.yaml` 的 `litellm_llm` 与 `litellm_embedder` 均以 `api_base: ${AGENTGATEWAY_MODEL_BASE_URL}`、`api_key_name: ${WREN_MODEL_API_KEY_NAME}` 指向 Core 投影的 `PLATFORM_LLM_ROUTE` key，由 `deploy/components/native-config.py` 渲染并经 `wren_check` 校验（DD-128）；组件内没有模型设置界面，用量计入 `component_model_tokens` |
| “知识”：SQL 问答对与指令 | (c) 核心业务 | 不改。它们是 Text-to-SQL 的检索上下文（`wren-ai-service/src/web/v1/services/ask.py` 中 `sql_pairs_retrieval`、`instructions_retrieval` 的结果进入意图分类与 SQL 生成），属语义层，不是 Agent 记忆；写入沿用 `manage` 判定（`wren-ui/src/apollo/server/resolvers.ts`） |
| 看板、固定到看板与定时刷新 | (c) 核心业务 | 不改；通知已经 `07` §4.8.3 投递到 Kailo 收件箱（`kailoNotifications.ts`） |
| 产品使用指南问答（意图 `USER_GUIDE`） | (a) 关闭 | 本次实现，见下 |

问数没有聊天、评论、提及、IM、嵌入或自有 Agent，DD-163 的其余条目不适用于本组件。

## 实现

- `wren-ai-service/src/config.py`：新增设置 `allow_user_guide`，缺省 `true`（上游行为不变，独立运行不受影响）。
- `wren-ai-service/src/web/v1/services/ask.py`：`AskService(allow_user_guide=...)`；为假时意图分类返回的 `USER_GUIDE` 改按原 `MISLEADING_QUERY` 路径作答（原 `misleading_assistance` 管线，引导用户提出数据问题），`user_guide_assistance` 不被调用。`USER_GUIDE` 的唯一调用点就在此处（`get_ask_streaming_result` 按 `general_type` 取管线，改写后为 `misleading_assistance`）。
- `wren-ai-service/src/globals.py`：`allow_user_guide` 为假时 `create_service_container` 不调用 `fetch_wren_ai_docs`，AI Service 启动时不再访问上游文档站；同一设置传入 `AskService`。
- `docker/config.template.yaml`：Kailo 部署模板 `settings.allow_user_guide: false`。模板由 `native-config.py` 原样渲染（`settings` 文档逐键透传），不需要改部署脚本。

部署顺序：先换 `data-query-ai-service` 镜像，再以新模板渲染配置；旧镜像读到未知键只告警，不改变行为。

## 验证

测试 `wren-ai-service/tests/pytest/services/test_kailo_user_guide.py`（原 `AskService` 与
`create_service_container`，无模型、无文档库、无网络）：

- 关闭时 `USER_GUIDE` 走 `misleading_assistance`、`general_type=MISLEADING_QUERY`，`user_guide_assistance` 未被调用；
- 缺省（允许）时原 `USER_GUIDE` 行为不变；
- 数据类问题（`GENERAL`）不受影响；
- 关闭时 `fetch_wren_ai_docs` 未被调用，`AskService` 收到 `allow_user_guide=False`；允许时原拉取保留；
- Kailo 部署模板经 `Settings.override` 读入后 `allow_user_guide` 为假。

CI 节点执行（`~/scratch/converge/wren-test.sh`：分支源码由 GitHub 经 `git archive` 取出，在已部署的
AI Service 镜像 `sha256:b116b0bb…` 中只用其依赖运行，`--network none`、只读根文件系统、非 root）：

```text
python -m unittest -v tests.pytest.services.test_kailo_user_guide \
  tests.pytest.providers.test_native_human_asking tests.pytest.providers.test_native_sql_answer_stream
分支 9ecf9910：Ran 46 tests，OK，RC 0
反证（私有副本中去掉 USER_GUIDE 改写与拉取开关）：FAILED (failures=2)，RC 1——
  test_closed_user_guide_is_answered_as_a_non_data_question、
  test_closed_user_guide_fetches_no_upstream_documentation
```

截图（已部署产物，问数界面未因本条改变）：CI 节点
`~/kailo-acceptance/converge-native/data/{light,dark}/wren-0{1,2,3}-*.png`，Kailo 内问数“问答”与“知识”页，明暗各一套。
部署中的问数仍是 DD-138 第三阶段之前的版本（页头有“建模”），以 DD-138 交付为准。

## 发布影响

需要重建 `data-query-ai-service`（输入 `data-query/wren-ai-service/` 变化），并以新模板重新渲染问数原生配置。
`data-query-ui` 与 `data-query-engine` 不受影响。
