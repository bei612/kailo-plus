# ADR-19：组件一致性证据复用受信 Worker 执行边界

- 状态：已接受
- 日期：2026-10-04
- 决策者：Kailo 实施工程负责人

`.design/07` §8A 要求在隔离开发环境模拟 binding/presentation，并以实际线协议
套件作为 Release 登记前置；生产 binding 只在 Release 准入后生效，不能反过来
要求候选组件先有生产 ACTIVE binding。ADR-12 的生产认证边界不因此放宽。

选择现有受信 Worker 执行隔离套件。Core 只接受该服务身份实际执行的结果，
证据附着原冻结 ActionExecution、Operation、WorkflowRef 与审计，并精确关联候选 artifact、
能力契约和 suite digest；不建立另一套报告注册表或签名权威。上传报告、用户
声明 pass、HTTP 成功、仅通过向量 schema 校验均不是套件执行事实。

隔离环境的模拟身份、端点与测试凭据由受控执行配置投递，只在该环境生效，
不使用生产凭据、不回退默认 Tenant、不扩大生产管理 API。向量是平台解释的
JSON 数据，不是 shell、脚本、表达式或由用户上传的可执行物。此选择把实际
执行与取证信任放在已有 Worker 边界；不宣称 Worker 身份认证能证明用户提交
的任意内容真实，也不让 Worker 单独决定 Release 批准。

每次线协议调用前，Worker 经原私网 service 身份向 Core 提交原冻结 probe 与
前一步实际取得的 typed 引用。Core 重核原 Catalog HUMAN/manage、AE、Temporal
当前 run 与计划，再用 OpenBao `platform/` 下独立 KV v2 版本的 ES256 私钥
签名；该版本同时必须带 `COMPONENT_CONFORMANCE` 用途，公钥须已存在于 Agent
投递的 JWKS 文件，`kid` 是 KV 版本。Worker 仅在 Activity 内存使用返回 token，
不保存到 Temporal history；不再支持静态 token 文件。能力 execute 与生产
APPLICATION 路径使用同一 `{idempotencyKey, actionKey, arguments:{target,input}}`
报文和 `arguments` 参数 hash；其余协议操作保留 `{operation, arguments}` 的域分离。
前序实际 ContentReference 仅填入 `arguments.input`，不另加测试专用报文字段。
隔离配置同时投递模拟 PEP 的授权 revision 与 execute 的模拟 native 执行引用，
以生产 HUMAN claims 的相同字段编码；这些引用不在生产库创建实体，也不能被生产
PEP 认可。独立 issuer/audience/JWKS 与真实 scope 碰撞拒绝继续生效。

`.design/03` §8 的结构化摘要继续由既有 Core `canonical_digest` 唯一解释。
Core 返回它实际散列的 canonical requestJson，Worker 发出这些原字节，不以 Go
数值格式重编码。实际候选响应经同一原 AE/step 的受信服务瞬时核验与规范化后，
仅返回请求、响应及原生结果摘要；响应正文不进入数据库、Temporal 输入/输出或
日志。此接缝不接受用户任意摘要、不提供通用 JSON 规范化接口，也不自行声明
套件通过。最终登记仍核验完整原计划、原生终态和契约摘要。

模拟 actor、scope 与 policy refs 固定于隔离配置，配置摘要进入原计划及 suite
digest；它们不写生产 Catalog/Delegation，不采用真实 Catalog Tenant/actor，
audience 不得等于 release 声明的生产 adapter audience。登记管理动作的结果
`NONE` 没有被映射为 `CONSUME_ONLY`；模拟 policy 只由隔离环境解释，不能作为
真实业务 execute 的授权。生产执行必须另外读取原真实 ResultExposurePolicy、
Delegation 与 ACTIVE binding，缺少事实时入口不开放。

登记前尚不存在可引用的生产 release/binding/generation，因此不为套件伪造
ExternalExecution；该实体只承接生产 binding 固定后的真实调用。模拟 binding
与测试副作用只存在于隔离环境，其报告仍由原 ActionExecution 承接。

若将来接入第三方执行者或跨运维域的套件服务，必须重新评估证据来源与认证，
再改变本边界；本期不实现这些执行路径。本决策不改变 `.design` 的实体、状态、
审批、权限或隔离要求，也不代表套件、ComponentRelease 或业务组件已交付。
