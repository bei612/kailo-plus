# 问数：空 SQL 与已完成会话的持续轮询（2026-10-30）

分支 `fix/data-modeling-ask`。关联 DD-127(7)、DD-128（Wren 原生配置模板、平台模型路由投影），
原问数任务与推荐问题观察（`native-integration.md`、`recommendation-observation-receipt.json`）。
生产 de21965c 验收发现的两个缺陷；生产只读诊断，未改动生产。

## 1. 新提问没有结果，约 7–10 分钟后报 "Internal server error"

### 证据（生产，只读）

UI SQLite `asking_task` id 12（query `a1c5c074…`，2026-10-29 21:33:24 创建，21:40:30 FAILED）：
`{"code":"OTHERS","message":"Native SQL response was not confirmed; query outcome is unavailable","shortMessage":"Internal server error"}`。

同一时段 `platform-local-agentgateway-1` 的 llm listener 访问日志（只取计量字段）：

| 时间 | 阶段 | 输入 / 输出 tokens | 耗时 |
|---|---|---|---|
| 21:33:39 | intent_classification | 7823 / 281 | 14.9 s |
| 21:35:16 | sql_generation_reasoning（流式） | 1933 / 2132 | 96.4 s |
| 21:40:29 | sql_generation | 12925 / **8192 = max_tokens** | **313.2 s** |

随后 ibis `rewriter`：`No SQL statements were provided`，engine `/v2/mdl/dry-plan`：
`ParsingException: line 1:1: mismatched input '<EOF>'`，UI `IbisAdaptor` dry run 422，
ai-service 抛 `NativeSQLResponseUnavailable`，任务按 OTHERS 结束。

排除项：MDL 已部署（`deploy_log` id 2 SUCCESS，6 个模型、5 个关系），检索上下文不为空
（sql_generation 输入 12925 tokens）；网关返回 200、非流式 JSON，格式正常；超时
（`timeout: 600`）没有触发；提示词模板渲染正常（隔离复现中同一模板在关闭思考后正常出 SQL）。

### 根因

平台 chat 路由（`gen_ai.request.model=qwen`）是默认开启思考的混合推理模型。直连探针
（同一网关，非密日志）：回答前先输出单独的 `reasoning` 字段，`max_tokens=200` 时
`finish_reason=length`、**message 没有 content**；`chat_template_kwargs.enable_thinking=false`
时 38 tokens 直接给出 JSON。思考 token 计入 `max_tokens`：Wren 的 SQL 生成在隐藏思考上
花光 8192 tokens（约 26 tok/s，5 分钟以上），content 为空，`build_message` 得到 `""`，
`SQLGenPostProcessor` 把空语句送进引擎。Wren 自身已有显式推理阶段
（`sql_generation_reasoning`），只读取 content。

### 隔离复现（CI 节点）

同一生产 ai-service 镜像、同一 `config.yaml`、同一 MDL（`deploy_log` id 2 只读导出），
独立 Qdrant 与 ibis 容器、桩引擎（不访问生产 UI/引擎/Qdrant），模型调用走同一网关路由。
问题 `[验收5] 按月统计订单数量，并画出趋势图`：

| 代码 / 配置 | sql_generation | 结果 |
|---|---|---|
| 生产代码，生产配置 | `length`，3136 in / 8192 out，content 0 字符，322.6 s | 引擎收到 `''` |
| 本分支代码，生产配置 | `length`，3175 in / 8192 out，`reasoning_only=True`，315.9 s | `SQLGenerationEmpty`，引擎调用 0 次 |
| 本分支代码，本分支模板（关闭思考） | `stop`，3762 in / 107 out，5.2 s | 有效 SQL |
| 生产代码，关闭思考 | `stop`，3744 in / 78 out，5.0 s | 有效 SQL |

（思考开启时 SQL 生成并非每次都超限：另一次 217.8 s 后给出了 SQL。推理阶段也从 81–145 s
降到 37–41 s。）

### 修复

- 根因：`data-query/docker/config.template.yaml` 的 chat 模型 kwargs 增加
  `extra_body.chat_template_kwargs.enable_thinking: false`；不支持该开关的 chat 模板会忽略它。
  `deploy/components/test_native_config.py` 同步渲染结果。
- 快速失败：`build_message` 记录 `reasoning_only`；`SQLGenPostProcessor` 遇到空 SQL，或因
  `length` 截断而无法解析的 JSON，直接抛 `SQLGenerationEmpty`，不调用引擎、不进入修正循环。
  `AskService` 将其记为 `failed` / `NO_SQL_GENERATED`，消息写明原因（如“输出上限耗尽在隐藏推理上”）。
- 展示：wren-ui 新增 `NO_SQL_GENERATED` 服务端错误码与中英文提示（`home.noSqlGenerated*`），
  不再显示 "Internal server error"。

## 2. 已完成的会话每秒轮询一次

`pages/home/[id].tsx` 的推荐问题观察只有在 `acceptRecommendation(task)` 采纳该任务且状态为
终态时才停止。服务端对没有派发过推荐的会话返回 `queryId=null, status=NOT_STARTED`；
对旧会话，`questions_source_response_id` 为 null（记录来源回答之前的数据），而页面要求来源
等于最新回答。两种情况都不会被采纳，`terminal` 一直是 false，每 1 s 再读一次，永不停止。
生产 `thread` 表 7 条：2、3、7 无 queryId；1、4、5、6 有 queryId 但来源为 null，因此全部命中。

修复：只要本会话的读取成功且状态不是 `GENERATING`，就停止观察（`utils/recommendationObservation.ts`）。
推荐只能由本页面的生成请求认领（`claimRecommendation`），该路径结束后会重新观察，因此
停止读取已结束的任务不会漏掉进行中的生成。

## 测试

- `wren-ai-service/tests/pytest/providers/test_ask_empty_sql.py`（7 项）：思考耗尽标记、
  空 SQL 不进引擎、截断 JSON、有 SQL 照常、`NO_SQL_GENERATED` 且不调用诊断/修正、
  模板 kwargs 经 `LitellmLLMProvider` 原样发出。
- `wren-ui/src/askFailureAndPolling.test.ts`：生产 7 条会话的读取形状都会停止、
  `GENERATING` 继续、页面观察器使用该停止条件、错误码与中英文文案。

CI 节点实际结果（`kailo-ci check-step` 只接受 main 可达提交，分支提交 exit 128；因此在 CI 节点
按 worker 同一方式重放：GitHub 固定提交、固定设计树、`CHECK_*` 同值、临时 PostgreSQL）：

| 检查 | 提交 | 结果 |
|---|---|---|
| `tools/check.sh lint` | d9b95b21 | exit 0（含 wren-ui prettier、next lint、next build 范围 tsc） |
| wren-ui `tsc --noEmit`（含测试文件） | d9b95b21 | exit 0 |
| `tools/check.sh verify`（先 migrate） | d9b95b21 | exit 0 |
| `tools/check.sh trace` | d9b95b21 | exit 0 |
| `tools/check.sh supply` | d9b95b21 | exit 0 |
| ai-service pytest（排除 eval） | ea5a71a5 | 193 passed / 20 failed / 14 errors；基线 dcdbacb2 为 186 / 20 / 14，失败集合逐条相同（离线、真实 IdP/服务依赖） |
| `test_ask_empty_sql.py` | ea5a71a5 | 7 passed |
| wren-ui jest（Node 18，`-w 1`） | d9b95b21 | 2250 passed / 117 failed / 2531；基线 dcdbacb2 为 2239 / 119 / 2522。新增 `askFailureAndPolling.test.ts` 通过；失败集合除网络时序项外相同（见下） |

wren-ui jest 的既有失败（基线同样失败）：native instance identity boundary 108 项、MDLBuilder、
kailoAdminSurface、nativeProjectScope、nativeQuery 等，与本改动无关。lint 缓存按
`--mode=skip-build` 安装，jest 需另行编译 better-sqlite3 原生绑定；并发 worker 在 CI 内存压力下
被 SIGKILL，故用 `-w 1`。只在一侧失败的项均为 `fetch failed / ECONNRESET`（分支：
nativeHumanQuery 2 项，该套件在负载 450+ 时运行 2675 s；基线：shared native error mapping 4 项）。
分支单独重跑 nativeHumanQuery 时 CI 节点负载升至 700+ 失联，重跑未完成；合并前需在空闲时以
`ci-slot.sh` 重跑该套件确认。

## 合并后需要重建/重新部署

- `data-query-ai-service`、`data-query-ui` 镜像重建并部署。
- `component-deploy.sh data-query` 重新渲染 `WREN_PROJECT_DIR/config.yaml`（模板变更），
  ai-service 重启后生效。engine、ibis、qdrant、AgentGateway 不变。
