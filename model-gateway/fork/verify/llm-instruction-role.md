# 只接受 `system` 的 OpenAI 兼容端点：纯配置适配

角色转换复用上游配置，不另写代理。2026-10-04 的原生终态序列化修正见末节。
依据：`crates/agentgateway/src/llm/mod.rs` 在请求转换为 provider 格式之后调用
`Policy::apply_final_transformations`（`llm/policy/mod.rs`）；`llm.models[].finalTransformation` 在
`types/local.rs` 中映射为同一个 `policies.ai.finalTransformations`。每个键独立地对**转换后的原始请求体**
（CEL 变量 `llmRequest`）求值，结果整体替换该顶层字段；**求值失败时该字段被删除**
（`apply_final_transformations` 的 `map.remove`），所以表达式必须对所有输入形态都成立。

## 可复用片段（llm_route，Responses 路由）

```yaml
llm:
  models:
  - name: <对外模型名>
    provider: openAI
    params:
      model: <端点上的模型名>
      apiKey: <SecretRef 投递的值>
      baseUrl: <端点 base URL，含 /v1>
    finalTransformation:
      # 系统指令只放在最前面的一条：把 input 中 developer/system 消息移出，
      # 与原 instructions 按顺序合并进 instructions。function_call 等无 role 条目原样保留。
      input: >-
        type(llmRequest.input) == string ? llmRequest.input :
        llmRequest.input.filter(i, !(has(i.role) && (i.role == "developer" || i.role == "system")))
      instructions: >-
        ((has(llmRequest.instructions) ? [llmRequest.instructions] : []) +
        (type(llmRequest.input) == string ? [] :
        llmRequest.input.filter(i, has(i.role) && (i.role == "developer" || i.role == "system"))
        .map(i, type(i.content) == string ? i.content : i.content.filter(p, has(p.text)).map(p, p.text).join("\n"))))
        .join("\n\n")
```

用 `routes/backends` 写法时，同样两个键放在 `policies.ai.finalTransformations`（注意复数）下。

### 为什么不是只改角色

只把 `developer` 改成 `system`（`input.map(i, … i.merge({"role": "system"}) …)`）对单条 developer 消息有效，
但端点的 chat template 要求 system 消息只能在第一条：请求同时带 `instructions`（Codex 每次都带）或
带两条以上 developer 消息时，实测返回 400 `System message must be at the beginning.`。因此采用合并写法。

## 实测（2026-09-29）

环境：本源树构建的 `agentgateway`（含 0001/0002，与本项无关），`llm.models` 两个条目：一个直连
`https://vision-27b-uat.geniusafc.com/v1`（模型 `qwen`，vLLM），一个经本机抓包转发器到同一端点，
用于看到网关实际发出的请求体。请求打 `POST /v1/responses`。

| 场景 | 配置 | 结果 |
|---|---|---|
| 直连端点，input 含 developer 消息 | — | 400 `Unexpected message role.` |
| 直连端点，同一请求改为 system | — | 200 |
| ① developer 消息 + `function_call`/`function_call_output`（无 role） | 只改角色（协调者给的表达式，加字符串保护） | 200；发出的 input 角色序列为 `system,user,<function_call>,<function_call_output>`，两条函数条目与原请求逐字段相等 |
| ② 同一请求，去掉 `finalTransformation` | 无 | 400 `Unexpected message role.`（破坏核验） |
| 同上再加 `instructions`（Codex 形态） | 只改角色 | 400 `System message must be at the beginning.` |
| 两条 developer 消息、无 `instructions` | 只改角色 | 400 同上 |
| Codex 形态：`instructions` + 两条 developer（一条为 `input_text` 分段数组）+ 函数条目 | 合并写法 | 200；发出的 `instructions` 为三段按原顺序合并，input 只剩 user 与两条函数条目（原样） |
| 同上，`stream: true` | 合并写法 | 200，SSE 以 `response.completed` 结束 |
| 两条 developer、无 `instructions` | 合并写法 | 200 |

### ③ input 为字符串

确定结论：

- 不加 `type(llmRequest.input) == string` 保护时，`llmRequest.input.map(...)`/`filter(...)` 对字符串求值失败，
  网关按上述规则**删除 `input` 字段**，端点返回 400（`body.input: Field required`）。抓包确认发出的请求体没有 `input`；
- 加保护后字符串原样透传，200。字符串 input 没有角色，不需要改写；
- 合并写法下，没有任何指令来源时 `instructions` 被设为空串 `""`，端点接受（200）。

## 注意

- 表达式里任何对可能缺失字段的访问都必须先 `has()`；否则该请求的对应字段会被静默删除；
- 该写法是否必要取决于端点的 chat template：只拒绝 `developer`、允许多条 system 的端点，只改角色也可以。
  这是按 binding 配置的兼容声明，不对任何厂商或模型硬编码。

## 2026-10-04：Chat 转 Responses 的终态兼容修正

四步影响结论：

1. **权威**：DD-110 允许固定 AgentGateway 原生协议转换；Codex 入站仍是 Responses。
   不重新实现代理、模型调用器或用量权威。本次复用现有 Responses 非流式 wire 类型。
2. **影响面**：原 `typed::ResponseStreamEvent` 的 completed/incomplete/failed 三类序列化；
   调用方为原生 Chat、Bedrock、Anthropic 等转换器，原样 Responses 透传不变。
   仅 ModelGateway 产物需要重建；无 Core/Worker/契约/迁移/客户端变化。
3. **副作用**：缺失的可选 cache-write 计数省略，而非输出 null；真实 input/output/total
   不改写、不默认填零。状态、错误、incomplete_details、工具及 metadata 仍用原类型保留。
   失败不升级为成功，不修改已失败 Invocation，不重放历史回合。
4. **边界**：usage 缺失仍缺失，显式零值保留；completed/incomplete/failed 与缺省/0/19
   缓存写计数组合实际检查。新验证 Route/Version/Installation 不代表旧安装已可用；
   旧对象升级仍须原治理链。三端由同一运行时接缝受益，不新增 UI 或 Mobile 宿主能力。

固定源码证据（均已重新读取符号）：

- AgentGateway `1f7ebbf87cbdbe9517f6f181221879d04dc50692`，
  `crates/llm/src/conversion/openai_compat.rs::to_responses::translate_stream` / `flush_end`：
  缺失 cache-write 计数保持 None，但原 typed SSE 将其序列化为 null。
  同文件 `to_responses::translate_response` 已使用
  `crates/llm/src/types/responses.rs::Response`，其中 `UsageInputDetails.cache_write_tokens`
  有 `skip_serializing_if = "Option::is_none"`。修正使三个 typed 终态复用这个既有 wire 表示，
  不是递归清洗任意 JSON。依赖 async-openai 固定为
  `2e3e2ddf0d3f3ed4249354b3c668b076bfbef08a`（原 Cargo.lock）。
- Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84`，
  `codex-rs/codex-api/src/sse/responses.rs::ResponseCompletedInputTokensDetails` 与
  `process_responses_event`：cache_write_tokens 是带 serde default 的 i64，缺失可接受，null 拒绝。

真实兼容验证使用原 ConfigResource→HUMAN `llm_route.create`→新 Version→Installation→
execute grant 审批→一次 Delegation 的正常链。新 route
`5c57957c-e7dd-4173-b286-1722af88209a`、Installation
`2989b1ec-f3fa-468d-89c5-4a8be226c97c`；原路由/安装未改。
原生 provider formats 仅 `completions`，finalTransformation 合并全体 developer/system 到首个
system，其余消息及 tool 字段不动。原 CEL 四组正向验证通过；没有合法 ToolBinding，因此
没有远端工具调用验收。原 ConfigResource 哈希为 provider
`b06617ad61b0727fbfa0abf2084c2d713840cc3c7e22a9c6ee0cea708347c9fd`、model
`9ca3630d9a9aab4514efe021253e638e22a40ddcbf77666b0cd2de34fed43a02`，均 revision 1。

Invocation `2f6ee2f1-b0a9-424d-9c11-d49a3a0c9ac8` 的原生记录已有 assistant output_text，
但终态错误为 `failed to parse ResponseCompleted: invalid type: null, expected i64`。
Codex 内部重复六次模型 stream，不是六次用户触发；每次 HTTP 200 并不证明原生 turn 成功。
真实最终 Invocation/Task 为 FAILED，六个用量事件均 COMMITTED/stored_at 齐全：
input 52515 + output 660 = total 53175。没有把短暂 BILLING 等待解释成永久卡住。
每次 output 均不超过 512，不能根据约 8.8k 的总量推断输出上限失效；实际出站请求正文
未留存，不能声称已验证上游收到的 max_tokens/max_completion_tokens 优先级。
此失败回合不重放，不据本地修正写成线上验收成功。

本地事后证据在 `/volumes/data/kailo/tmp/codex-chat-usage-fix-20261004.WWrfPy/`：

- 原生固定 SDK image `sha256:17a2ffedc7792a8dc0bfb17f34d6dd928db5efff67d5698d3c449cb6ffb94936`，
  实际 Rust 1.98.0，4 CPU/8 GiB/swap 0，Data 源及缓存，network none；无产品全 binary 编译。
- `cargo test --locked --offline --profile ci -p agent-llm --lib golden_tests::responses -- --nocapture`
  最终退出 0，17 passed；包含原 streaming golden。七个原快照仅终态字段排序及可选 null 省略，
  工具 namespace/arguments/call_id 和用量未丢失。首次新增测试漏写 Body 限定路径的编译失败
  退出 101 留在 `gateway-target.log`；修正后的最窄目标退出 0，不隐去首次失败。
- 删除生产三处 serializer 接入后，原目标实际断言 `Some(Null) != None`，退出 101；
  恢复后 17 passed。`gateway-mutation.log` SHA-256
  `55b4435e0ab6be6971402d650a4199bc4460644274938ef3eb5df7587bf0105d`；
  `gateway-restored.log` SHA-256 `f8d4603f54b9c182b211d63989da8428cd4a78fed8342a6d7bb03ef6ac55b7fd`。
- 网关真实转换生成的入库 snapshot 交给已发布 Codex app-server，通过隔离 loopback SSE 消费。
  binary SHA-256 `be14b6a4245d2e416727c0afc6f28bc8c953c2cb054ff84b39c8877d06116265`，
  与原 agent-runtime artifact `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`
  内原 binary 实际相同；来源登记 source `sha256:3215869e5d6e235259485458bcfedaeb65494fb3dcae461616f3eae358b9d544`。
  本地 fixture 显式关闭 native stream/request retry，且容器 network none，不修改生产配置。
  正向与还原均一次请求、assistant=true、completed、用量 8715/246/8961；把该真实 payload 的
  cache_write_tokens 改回 null 后，原 binary 精确复现同一错误，failed、usage=null。
  `native-fixed.log` 与 `native-restored.log` SHA-256 均为
  `fc29c72a0db903a66521935e28b8903887c574820f4e4f2b1f2b0a29f632bd0c`；
  `native-null.log` SHA-256 `68d926bf888356e92fc6ec0767a8351c07fa58a81f149e6645f812400d8c66c8`。

原受控 Core provider 配置尚未投递 Codex 的 stream_max_retries/request_max_retries；
不能把本地 fixture 的显式零重试当作已上线策略，不直接修改物化 config.toml。
本节只证明本地生产转换与已发布原生消费者的兼容；产品构建、部署、一次新的授权真实回合
及旧安装升级均需各自证据，不互相替代。原付费验证对象/额度元数据原件在
`/volumes/data/kailo/tmp/codex-chat-compat-20261004.eJYuhu/`，不保存提示或密钥正文到工程。

本批 ModelGateway 原 `tools/build-upstream.sh model-gateway` 仅执行一次，实际退出 0。
复用 `kailo-core-data` 8 CPU/16 GiB/swap 0 的既有受限 BuildKit 和 Data 缓存，
未改配方或 Cargo 并行度；原 release 编译 19m53s，原 version 自检为上述固定 commit/Rust 1.98.0。
构建前后原 manifest plan 逐字一致，Cargo.lock、pnpm-lock.yaml 校验均为 OK。
source `sha256:59c75732f7b5b230a98d45d0f78b88455acb6f1832996d6236b9d5e8a44de345`；
registry artifact `sha256:b7e3d559ffd7840d73e278de656879ebe12e925b3766536f9e9952d1fd7a4fff`。
原件 `/volumes/data/kailo/tmp/codex-shared-settings-delivery-20261004.ci5cp1/gateway-build.log`，
SHA-256 `72fc32ca1521c7a03258bfd985b374a90418b6a54c285754a7f0d673288113f1`。
此处记录已构建并推入 registry，部署和真实模型复验仍不据此声称通过。
