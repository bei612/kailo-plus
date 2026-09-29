# 只接受 `system` 的 OpenAI 兼容端点：纯配置适配

不改上游代码。依据：`crates/agentgateway/src/llm/mod.rs` 在请求转换为 provider 格式之后调用
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
