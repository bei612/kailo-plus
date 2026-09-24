// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()
//
//    clientKeyView, err := UnmarshalClientKeyView(bytes)
//    bytes, err = clientKeyView.Marshal()
//
//    clientKeyStatus, err := UnmarshalClientKeyStatus(bytes)
//    bytes, err = clientKeyStatus.Marshal()
//
//    nativeCommunityFacts, err := UnmarshalNativeCommunityFacts(bytes)
//    bytes, err = nativeCommunityFacts.Marshal()
//
//    ownAuditEntry, err := UnmarshalOwnAuditEntry(bytes)
//    bytes, err = ownAuditEntry.Marshal()
//
//    readMarkRequest, err := UnmarshalReadMarkRequest(bytes)
//    bytes, err = readMarkRequest.Marshal()
//
//    platformSessionView, err := UnmarshalPlatformSessionView(bytes)
//    bytes, err = platformSessionView.Marshal()
//
//    userStateVersion, err := UnmarshalUserStateVersion(bytes)
//    bytes, err = userStateVersion.Marshal()
//
//    workspaceView, err := UnmarshalWorkspaceView(bytes)
//    bytes, err = workspaceView.Marshal()
//
//    workspaceMemberView, err := UnmarshalWorkspaceMemberView(bytes)
//    bytes, err = workspaceMemberView.Marshal()
//
//    workspacePreferenceRequest, err := UnmarshalWorkspacePreferenceRequest(bytes)
//    bytes, err = workspacePreferenceRequest.Marshal()
//
//    errorBody, err := UnmarshalErrorBody(bytes)
//    bytes, err = errorBody.Marshal()
//
//    resolvedIdentity, err := UnmarshalResolvedIdentity(bytes)
//    bytes, err = resolvedIdentity.Marshal()
//
//    taskStateReport, err := UnmarshalTaskStateReport(bytes)
//    bytes, err = taskStateReport.Marshal()
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

func UnmarshalClientKeyView(data []byte) (ClientKeyView, error) {
	var r ClientKeyView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ClientKeyView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalClientKeyStatus(data []byte) (ClientKeyStatus, error) {
	var r ClientKeyStatus
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ClientKeyStatus) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeCommunityFacts(data []byte) (NativeCommunityFacts, error) {
	var r NativeCommunityFacts
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeCommunityFacts) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalOwnAuditEntry(data []byte) (OwnAuditEntry, error) {
	var r OwnAuditEntry
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *OwnAuditEntry) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalReadMarkRequest(data []byte) (ReadMarkRequest, error) {
	var r ReadMarkRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ReadMarkRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformSessionView(data []byte) (PlatformSessionView, error) {
	var r PlatformSessionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformSessionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalUserStateVersion(data []byte) (UserStateVersion, error) {
	var r UserStateVersion
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *UserStateVersion) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceView(data []byte) (WorkspaceView, error) {
	var r WorkspaceView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceMemberView(data []byte) (WorkspaceMemberView, error) {
	var r WorkspaceMemberView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceMemberView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspacePreferenceRequest(data []byte) (WorkspacePreferenceRequest, error) {
	var r WorkspacePreferenceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspacePreferenceRequest) Marshal() ([]byte, error) {
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

func UnmarshalTaskStateReport(data []byte) (TaskStateReport, error) {
	var r TaskStateReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TaskStateReport) Marshal() ([]byte, error) {
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

// GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
type ClientKeyView struct {
	// RFC3339
	CreatedAt string            `json:"createdAt"`
	Pubkey    string            `json:"pubkey"`
	State     BuzzIdentityState `json:"state"`
}

// 设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
// /api/v1/identity/client-keys/{pubkey}）的回应。
type ClientKeyStatus struct {
	Pubkey string            `json:"pubkey"`
	State  BuzzIdentityState `json:"state"`
	// 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
	WorkflowID *string `json:"workflowId,omitempty"`
}

// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
type NativeCommunityFacts struct {
	// 该 Tenant 的 Community host，可能带非默认端口
	CommunityHost string `json:"communityHost"`
	// 原生端直连的 Relay 地址
	RelayURL string `json:"relayUrl"`
}

// GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
type OwnAuditEntry struct {
	ActionKey string         `json:"actionKey"`
	Decision  string         `json:"decision"`
	EventType AuditEventType `json:"eventType"`
	// RFC3339
	OccurredAt string `json:"occurredAt"`
	ResultCode string `json:"resultCode"`
	// 动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// PUT /api/v1/user-state/read 的请求体（DD-40）。contextKey 只接受调用方可读 Workspace 内的 Channel ID 或
// msg:<Buzz event id>；version 是读到的 CollaborationUserState 版本，不符即 409。
type ReadMarkRequest struct {
	ContextKey string `json:"contextKey"`
	// RFC3339，Core 统一存成 UTC
	LastReadAt string `json:"lastReadAt"`
	Version    int64  `json:"version"`
}

// GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
// 绑定设备持钥证明（DD-79）。
type PlatformSessionView struct {
	// 当前选定的 Workspace；未选定时缺省
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	// HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
	DisplayName        string `json:"displayName"`
	HumanIdentityID    string `json:"humanIdentityId"`
	PlatformSessionID  string `json:"platformSessionId"`
	TenantID           string `json:"tenantId"`
	TenantMembershipID string `json:"tenantMembershipId"`
	TenantPrincipalID  string `json:"tenantPrincipalId"`
}

// CollaborationUserState 写入成功后的新版本（PUT /api/v1/user-state/read 与 PUT
// /api/v1/user-state/workspaces/{workspaceId} 的 200 回应）。
type UserStateVersion struct {
	Version int64 `json:"version"`
}

// GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 且两侧 binding 都 ACTIVE 的
// Workspace。Workspace id 同时是其 Channel id（DD-80）。
type WorkspaceView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
type WorkspaceMemberView struct {
	DisplayName string `json:"displayName"`
	PrincipalID string `json:"principalId"`
	// 此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
	Pubkeys []string                 `json:"pubkeys"`
	State   WorkspaceMembershipState `json:"state"`
}

// PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
// 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
type WorkspacePreferenceRequest struct {
	Muted   bool  `json:"muted"`
	Starred bool  `json:"starred"`
	Version int64 `json:"version"`
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

// Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
// 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
type TaskStateReport struct {
	// 报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
	EventID       int64      `json:"eventId"`
	Progress      *string    `json:"progress,omitempty"`
	RunID         string     `json:"runId"`
	Status        TaskStatus `json:"status"`
	WaitingReason *string    `json:"waitingReason,omitempty"`
	// 固定格式的业务 workflow ID
	WorkflowID string `json:"workflowId"`
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

// BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
type BuzzIdentityState string

const (
	BuzzIdentityStateACTIVE   BuzzIdentityState = "ACTIVE"
	BuzzIdentityStateREVOKED  BuzzIdentityState = "REVOKED"
	BuzzIdentityStateREVOKING BuzzIdentityState = "REVOKING"
	PendingSecret             BuzzIdentityState = "PENDING_SECRET"
	Reconciling               BuzzIdentityState = "RECONCILING"
)

// AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
// OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
type AuditEventType string

const (
	Access         AuditEventType = "ACCESS"
	Approval       AuditEventType = "APPROVAL"
	Authentication AuditEventType = "AUTHENTICATION"
	Decision       AuditEventType = "DECISION"
	Dispatch       AuditEventType = "DISPATCH"
	Intent         AuditEventType = "INTENT"
	Outcome        AuditEventType = "OUTCOME"
	Reconciliation AuditEventType = "RECONCILIATION"
	Revocation     AuditEventType = "REVOCATION"
	Session        AuditEventType = "SESSION"
)

// WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
type WorkspaceMembershipState string

const (
	Error                            WorkspaceMembershipState = "ERROR"
	Provisioning                     WorkspaceMembershipState = "PROVISIONING"
	WorkspaceMembershipStateACTIVE   WorkspaceMembershipState = "ACTIVE"
	WorkspaceMembershipStateREVOKED  WorkspaceMembershipState = "REVOKED"
	WorkspaceMembershipStateREVOKING WorkspaceMembershipState = "REVOKING"
)

// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
type ReasonCode string

const (
	ClientKeyAlreadyBound        ReasonCode = "CLIENT_KEY_ALREADY_BOUND"
	ClientKeyLimitReached        ReasonCode = "CLIENT_KEY_LIMIT_REACHED"
	ClientKeyNotFound            ReasonCode = "CLIENT_KEY_NOT_FOUND"
	ClientKeyProofInvalid        ReasonCode = "CLIENT_KEY_PROOF_INVALID"
	DependencyUnavailable        ReasonCode = "DEPENDENCY_UNAVAILABLE"
	IdentityHeaderMissing        ReasonCode = "IDENTITY_HEADER_MISSING"
	IdentityUnknown              ReasonCode = "IDENTITY_UNKNOWN"
	NativeSurfaceRequired        ReasonCode = "NATIVE_SURFACE_REQUIRED"
	PublishRejected              ReasonCode = "PUBLISH_REJECTED"
	PublishResultUnknown         ReasonCode = "PUBLISH_RESULT_UNKNOWN"
	SessionNotActive             ReasonCode = "SESSION_NOT_ACTIVE"
	SurfaceCapabilityUnavailable ReasonCode = "SURFACE_CAPABILITY_UNAVAILABLE"
	TenantMembershipNotActive    ReasonCode = "TENANT_MEMBERSHIP_NOT_ACTIVE"
	TenantSelectionNotAvailable  ReasonCode = "TENANT_SELECTION_NOT_AVAILABLE"
)

// TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
// status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
// WorkflowRef 进入 TERMINAL。
type TaskStatus string

const (
	Canceled   TaskStatus = "CANCELED"
	Completed  TaskStatus = "COMPLETED"
	Failed     TaskStatus = "FAILED"
	Running    TaskStatus = "RUNNING"
	Terminated TaskStatus = "TERMINATED"
	TimedOut   TaskStatus = "TIMED_OUT"
)

// ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
// 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
type WorkflowKind string

const (
	BuzzIdentityProjection WorkflowKind = "BUZZ_IDENTITY_PROJECTION"
	MembershipProjection   WorkflowKind = "MEMBERSHIP_PROJECTION"
	MembershipRevocation   WorkflowKind = "MEMBERSHIP_REVOCATION"
	TenantLifecycle        WorkflowKind = "TENANT_LIFECYCLE"
	WorkspaceLifecycle     WorkflowKind = "WORKSPACE_LIFECYCLE"
)
