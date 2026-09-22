// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()
//
//    errorBody, err := UnmarshalErrorBody(bytes)
//    bytes, err = errorBody.Marshal()
//
//    resolvedIdentity, err := UnmarshalResolvedIdentity(bytes)
//    bytes, err = resolvedIdentity.Marshal()
//
//    workflowRef, err := UnmarshalWorkflowRef(bytes)
//    bytes, err = workflowRef.Marshal()

package generated

import "encoding/json"

func UnmarshalCanary(data []byte) (Canary, error) {
	var r Canary
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *Canary) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalErrorBody(data []byte) (ErrorBody, error) {
	var r ErrorBody
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ErrorBody) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResolvedIdentity(data []byte) (ResolvedIdentity, error) {
	var r ResolvedIdentity
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResolvedIdentity) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkflowRef(data []byte) (WorkflowRef, error) {
	var r WorkflowRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkflowRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

// 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
// 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
type Canary struct {
	// 可选的枚举引用
	CapabilityState *CapabilityState `json:"capabilityState,omitempty"`
	// 基础 integer
	Count int64 `json:"count"`
	// 基础 boolean
	Enabled bool `json:"enabled"`
	// 跨文件 $ref 引用封闭枚举
	ErrorClass ErrorClass `json:"errorClass"`
	// format: uuid
	ID string `json:"id"`
	// 基础 string
	Name string `json:"name"`
	// 内联对象，同样显式关闭 additionalProperties
	Nested Nested `json:"nested"`
	// RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
	// 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
	OccurredAt *string `json:"occurredAt,omitempty"`
	// 基础 number
	Ratio float64 `json:"ratio"`
	// 同构数组
	Tags []string `json:"tags"`
	// 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
	Variants []Variant `json:"variants,omitempty"`
}

// 内联对象，同样显式关闭 additionalProperties
type Nested struct {
	Label   string    `json:"label"`
	Weights []float64 `json:"weights,omitempty"`
}

type Variant struct {
	FileDigest  *string `json:"fileDigest,omitempty"`
	Kind        Kind    `json:"kind"`
	MessageBody *string `json:"messageBody,omitempty"`
	TaskAttempt *int64  `json:"taskAttempt,omitempty"`
}

// 统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
type ErrorBody struct {
	Class ErrorClass `json:"class"`
	// 贯穿 Core、Worker、adapter 与组件的关联键
	OperationID *string    `json:"operationId,omitempty"`
	Reason      ReasonCode `json:"reason"`
}

// BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
type ResolvedIdentity struct {
	// 当前选定的 Workspace；未选定时缺省
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	HumanIdentityID    string  `json:"humanIdentityId"`
	TenantID           string  `json:"tenantId"`
	TenantMembershipID string  `json:"tenantMembershipId"`
	TenantPrincipalID  string  `json:"tenantPrincipalId"`
}

// Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
// kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
type WorkflowRef struct {
	// RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
	CreatedAt       string       `json:"createdAt"`
	EntityVersion   int64        `json:"entityVersion"`
	Kind            WorkflowKind `json:"kind"`
	PrimaryEntityID string       `json:"primaryEntityId"`
	// Start 成功后回填；未知时缺省
	RunID    *string `json:"runId,omitempty"`
	TenantID string  `json:"tenantId"`
	// 固定格式的业务 workflow ID
	WorkflowID string `json:"workflowId"`
}

// 可选的枚举引用
//
// 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
type CapabilityState string

const (
	AdapterRequired        CapabilityState = "ADAPTER_REQUIRED"
	CapabilityStateBLOCKED CapabilityState = "BLOCKED"
	DesignDefined          CapabilityState = "DESIGN_DEFINED"
	Excluded               CapabilityState = "EXCLUDED"
	UpstreamSupported      CapabilityState = "UPSTREAM_SUPPORTED"
)

// 跨文件 $ref 引用封闭枚举
//
// 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
// 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
type ErrorClass string

const (
	Conflict          ErrorClass = "CONFLICT"
	Denied            ErrorClass = "DENIED"
	ErrorClassBLOCKED ErrorClass = "BLOCKED"
	Limit             ErrorClass = "LIMIT"
	Precondition      ErrorClass = "PRECONDITION"
	Unknown           ErrorClass = "UNKNOWN"
)

type Kind string

const (
	File    Kind = "FILE"
	Message Kind = "MESSAGE"
	Task    Kind = "TASK"
)

// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
type ReasonCode string

const (
	IdentityHeaderMissing     ReasonCode = "IDENTITY_HEADER_MISSING"
	IdentityUnknown           ReasonCode = "IDENTITY_UNKNOWN"
	SessionNotActive          ReasonCode = "SESSION_NOT_ACTIVE"
	TenantMembershipNotActive ReasonCode = "TENANT_MEMBERSHIP_NOT_ACTIVE"
)

// ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
// 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件当前只含 Stage 1 已实现的四个。
type WorkflowKind string

const (
	MembershipProjection WorkflowKind = "MEMBERSHIP_PROJECTION"
	MembershipRevocation WorkflowKind = "MEMBERSHIP_REVOCATION"
	TenantLifecycle      WorkflowKind = "TENANT_LIFECYCLE"
	WorkspaceLifecycle   WorkflowKind = "WORKSPACE_LIFECYCLE"
)
