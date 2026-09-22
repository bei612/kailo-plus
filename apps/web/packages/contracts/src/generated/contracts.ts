/**
 * 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
 * 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
 */
export interface Canary {
    /**
     * 可选的枚举引用
     */
    capabilityState?: CapabilityState;
    /**
     * 基础 integer
     */
    count: number;
    /**
     * 基础 boolean
     */
    enabled: boolean;
    /**
     * 跨文件 $ref 引用封闭枚举
     */
    errorClass: ErrorClass;
    /**
     * format: uuid
     */
    id: string;
    /**
     * 基础 string
     */
    name: string;
    /**
     * 内联对象，同样显式关闭 additionalProperties
     */
    nested: Nested;
    /**
     * RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
     * 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
     */
    occurredAt?: string;
    /**
     * 基础 number
     */
    ratio: number;
    /**
     * 同构数组
     */
    tags: string[];
    /**
     * 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
     */
    variants?: Variant[];
}

/**
 * 可选的枚举引用
 *
 * 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
 */
export enum CapabilityState {
    AdapterRequired = "ADAPTER_REQUIRED",
    Blocked = "BLOCKED",
    DesignDefined = "DESIGN_DEFINED",
    Excluded = "EXCLUDED",
    UpstreamSupported = "UPSTREAM_SUPPORTED",
}

/**
 * 跨文件 $ref 引用封闭枚举
 *
 * 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
 * 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
 */
export enum ErrorClass {
    Blocked = "BLOCKED",
    Conflict = "CONFLICT",
    Denied = "DENIED",
    Limit = "LIMIT",
    Precondition = "PRECONDITION",
    Unknown = "UNKNOWN",
}

/**
 * 内联对象，同样显式关闭 additionalProperties
 */
export interface Nested {
    label:    string;
    weights?: number[];
}

export interface Variant {
    fileDigest?:  string;
    kind:         Kind;
    messageBody?: string;
    taskAttempt?: number;
}

export enum Kind {
    File = "FILE",
    Message = "MESSAGE",
    Task = "TASK",
}

/**
 * Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
 * kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
 */
export interface WorkflowRef {
    /**
     * RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
     */
    createdAt:       string;
    entityVersion:   number;
    kind:            WorkflowKind;
    primaryEntityId: string;
    /**
     * Start 成功后回填；未知时缺省
     */
    runId?:   string;
    tenantId: string;
    /**
     * 固定格式的业务 workflow ID
     */
    workflowId: string;
}

/**
 * ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
 * 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件当前只含 Stage 1 已实现的四个。
 */
export enum WorkflowKind {
    MembershipProjection = "MEMBERSHIP_PROJECTION",
    MembershipRevocation = "MEMBERSHIP_REVOCATION",
    TenantLifecycle = "TENANT_LIFECYCLE",
    WorkspaceLifecycle = "WORKSPACE_LIFECYCLE",
}
