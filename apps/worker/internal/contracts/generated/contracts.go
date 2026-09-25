// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()
//
//    actionCommand, err := UnmarshalActionCommand(bytes)
//    bytes, err = actionCommand.Marshal()
//
//    actionSubmission, err := UnmarshalActionSubmission(bytes)
//    bytes, err = actionSubmission.Marshal()
//
//    approvalDecisionRequest, err := UnmarshalApprovalDecisionRequest(bytes)
//    bytes, err = approvalDecisionRequest.Marshal()
//
//    approvalView, err := UnmarshalApprovalView(bytes)
//    bytes, err = approvalView.Marshal()
//
//    clientKeyView, err := UnmarshalClientKeyView(bytes)
//    bytes, err = clientKeyView.Marshal()
//
//    clientKeyStatus, err := UnmarshalClientKeyStatus(bytes)
//    bytes, err = clientKeyStatus.Marshal()
//
//    invitationRedemptionView, err := UnmarshalInvitationRedemptionView(bytes)
//    bytes, err = invitationRedemptionView.Marshal()
//
//    invitationRedemptionRequest, err := UnmarshalInvitationRedemptionRequest(bytes)
//    bytes, err = invitationRedemptionRequest.Marshal()
//
//    issuedInvitation, err := UnmarshalIssuedInvitation(bytes)
//    bytes, err = issuedInvitation.Marshal()
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
//    taskView, err := UnmarshalTaskView(bytes)
//    bytes, err = taskView.Marshal()
//
//    tenantInvitationView, err := UnmarshalTenantInvitationView(bytes)
//    bytes, err = tenantInvitationView.Marshal()
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
//
//    affectedOwnerRef, err := UnmarshalAffectedOwnerRef(bytes)
//    bytes, err = affectedOwnerRef.Marshal()
//
//    approvalControlOutcome, err := UnmarshalApprovalControlOutcome(bytes)
//    bytes, err = approvalControlOutcome.Marshal()
//
//    approvalDecisionOutcome, err := UnmarshalApprovalDecisionOutcome(bytes)
//    bytes, err = approvalDecisionOutcome.Marshal()
//
//    approvalDecisionRecord, err := UnmarshalApprovalDecisionRecord(bytes)
//    bytes, err = approvalDecisionRecord.Marshal()
//
//    approvalDecisionUpdate, err := UnmarshalApprovalDecisionUpdate(bytes)
//    bytes, err = approvalDecisionUpdate.Marshal()
//
//    approvalWorkflowInput, err := UnmarshalApprovalWorkflowInput(bytes)
//    bytes, err = approvalWorkflowInput.Marshal()
//
//    approvalInvalidateUpdate, err := UnmarshalApprovalInvalidateUpdate(bytes)
//    bytes, err = approvalInvalidateUpdate.Marshal()
//
//    approvalRefusal, err := UnmarshalApprovalRefusal(bytes)
//    bytes, err = approvalRefusal.Marshal()
//
//    approvalResume, err := UnmarshalApprovalResume(bytes)
//    bytes, err = approvalResume.Marshal()
//
//    approvalRoleRequirement, err := UnmarshalApprovalRoleRequirement(bytes)
//    bytes, err = approvalRoleRequirement.Marshal()
//
//    approvalStateReport, err := UnmarshalApprovalStateReport(bytes)
//    bytes, err = approvalStateReport.Marshal()
//
//    freshApprovalAdmissionRequest, err := UnmarshalFreshApprovalAdmissionRequest(bytes)
//    bytes, err = freshApprovalAdmissionRequest.Marshal()
//
//    freshApprovalAdmissionResult, err := UnmarshalFreshApprovalAdmissionResult(bytes)
//    bytes, err = freshApprovalAdmissionResult.Marshal()

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

func UnmarshalActionCommand(data []byte) (ActionCommand, error) {
	var r ActionCommand
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ActionCommand) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalActionSubmission(data []byte) (ActionSubmission, error) {
	var r ActionSubmission
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ActionSubmission) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionRequest(data []byte) (ApprovalDecisionRequest, error) {
	var r ApprovalDecisionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalView(data []byte) (ApprovalView, error) {
	var r ApprovalView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalView) Marshal() ([]byte, error) {
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

func UnmarshalInvitationRedemptionView(data []byte) (InvitationRedemptionView, error) {
	var r InvitationRedemptionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *InvitationRedemptionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalInvitationRedemptionRequest(data []byte) (InvitationRedemptionRequest, error) {
	var r InvitationRedemptionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *InvitationRedemptionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalIssuedInvitation(data []byte) (IssuedInvitation, error) {
	var r IssuedInvitation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *IssuedInvitation) Marshal() ([]byte, error) {
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

func UnmarshalTaskView(data []byte) (TaskView, error) {
	var r TaskView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TaskView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantInvitationView(data []byte) (TenantInvitationView, error) {
	var r TenantInvitationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantInvitationView) Marshal() ([]byte, error) {
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

func UnmarshalAffectedOwnerRef(data []byte) (AffectedOwnerRef, error) {
	var r AffectedOwnerRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AffectedOwnerRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalControlOutcome(data []byte) (ApprovalControlOutcome, error) {
	var r ApprovalControlOutcome
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalControlOutcome) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionOutcome(data []byte) (ApprovalDecisionOutcome, error) {
	var r ApprovalDecisionOutcome
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionOutcome) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionRecord(data []byte) (ApprovalDecisionRecord, error) {
	var r ApprovalDecisionRecord
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionRecord) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionUpdate(data []byte) (ApprovalDecisionUpdate, error) {
	var r ApprovalDecisionUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalWorkflowInput(data []byte) (ApprovalWorkflowInput, error) {
	var r ApprovalWorkflowInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalWorkflowInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalInvalidateUpdate(data []byte) (ApprovalInvalidateUpdate, error) {
	var r ApprovalInvalidateUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalInvalidateUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalRefusal(data []byte) (ApprovalRefusal, error) {
	var r ApprovalRefusal
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalRefusal) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalResume(data []byte) (ApprovalResume, error) {
	var r ApprovalResume
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalResume) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalRoleRequirement(data []byte) (ApprovalRoleRequirement, error) {
	var r ApprovalRoleRequirement
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalRoleRequirement) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalStateReport(data []byte) (ApprovalStateReport, error) {
	var r ApprovalStateReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalStateReport) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFreshApprovalAdmissionRequest(data []byte) (FreshApprovalAdmissionRequest, error) {
	var r FreshApprovalAdmissionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FreshApprovalAdmissionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFreshApprovalAdmissionResult(data []byte) (FreshApprovalAdmissionResult, error) {
	var r FreshApprovalAdmissionResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FreshApprovalAdmissionResult) Marshal() ([]byte, error) {
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

// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
type ActionCommand struct {
	ActionKey string `json:"actionKey"`
	// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
	IdempotencyKey string `json:"idempotencyKey"`
	// tenant.member.invite.revoke 的目标邀请
	InvitationID *string `json:"invitationId,omitempty"`
	// workspace.create 的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
	Name *string `json:"name,omitempty"`
	// 成员动作的目标 Principal
	PrincipalID *string `json:"principalId,omitempty"`
	// workspace.create 的 slug
	Slug *string `json:"slug,omitempty"`
	// Workspace 内动作的执行 Workspace
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
// 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。
type ActionSubmission struct {
	ActionExecutionID  string              `json:"actionExecutionId"`
	ActionKey          string              `json:"actionKey"`
	ApprovalWorkflowID *string             `json:"approvalWorkflowId,omitempty"`
	DispatchState      ActionDispatchState `json:"dispatchState"`
	GateState          ActionGateState     `json:"gateState"`
	Invitation         *InvitationClass    `json:"invitation,omitempty"`
	OperationID        string              `json:"operationId"`
	Reason             *ReasonCode         `json:"reason,omitempty"`
	WorkflowID         *string             `json:"workflowId,omitempty"`
}

// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
type InvitationClass struct {
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 部署登记的链接基址 + '#' + 一次性凭据
	Link string `json:"link"`
}

// POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
// ApprovalDecisionOutcome。
type ApprovalDecisionRequest struct {
	Decision ApprovalDecision `json:"decision"`
}

// GET /api/v1/approvals（待我审批）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history
// 的投影。
type ApprovalView struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ActionKey         string `json:"actionKey"`
	// RFC3339，UTC
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// RFC3339，UTC
	ExpiresAt            string                   `json:"expiresAt"`
	InitiatorPrincipalID string                   `json:"initiatorPrincipalId"`
	Observation          *ReasonCode              `json:"observation,omitempty"`
	Reason               *ReasonCode              `json:"reason,omitempty"`
	RoleRequirements     []RoleRequirementElement `json:"roleRequirements"`
	Status               ApprovalStatus           `json:"status"`
	TargetID             string                   `json:"targetId"`
	TargetType           string                   `json:"targetType"`
	WorkflowID           string                   `json:"workflowId"`
	WorkspaceID          *string                  `json:"workspaceId,omitempty"`
}

// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
type DecisionElement struct {
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// RFC3339，UTC
	DecidedAt string           `json:"decidedAt"`
	Decision  ApprovalDecision `json:"decision"`
	// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
}

// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
// §4）。
type RoleRequirementElement struct {
	MinDistinct int64            `json:"minDistinct"`
	Selector    ApprovalSelector `json:"selector"`
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
	Pubkey string `json:"pubkey"`
	// 状态仍在收敛时，客户端再次读取设备状态前至少等待的毫秒数；确定终态时缺省
	RecheckAfterMillis *int64            `json:"recheckAfterMillis,omitempty"`
	State              BuzzIdentityState `json:"state"`
	// 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
	WorkflowID *string `json:"workflowId,omitempty"`
}

// POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
// 的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
// admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
type InvitationRedemptionView struct {
	AdmissionGateState ActionGateState       `json:"admissionGateState"`
	InvitationID       string                `json:"invitationId"`
	MembershipState    TenantMembershipState `json:"membershipState"`
	Reason             *ReasonCode           `json:"reason,omitempty"`
	// RFC3339，UTC
	RedeemedAt string `json:"redeemedAt"`
	TenantID   string `json:"tenantId"`
	TenantName string `json:"tenantName"`
}

// POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
type InvitationRedemptionRequest struct {
	// 邀请链接 fragment 里的一次性凭据
	Credential string `json:"credential"`
	// 兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
	DisplayName string `json:"displayName"`
}

// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
type IssuedInvitation struct {
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 部署登记的链接基址 + '#' + 一次性凭据
	Link string `json:"link"`
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

// GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
// 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
type TaskView struct {
	ActionExecutionID  string          `json:"actionExecutionId"`
	ActionKey          string          `json:"actionKey"`
	ActionVersion      int64           `json:"actionVersion"`
	ApprovalStatus     *ApprovalStatus `json:"approvalStatus,omitempty"`
	ApprovalWorkflowID *string         `json:"approvalWorkflowId,omitempty"`
	// RFC3339，UTC
	CreatedAt     string              `json:"createdAt"`
	DispatchState ActionDispatchState `json:"dispatchState"`
	GateState     ActionGateState     `json:"gateState"`
	Observation   *ReasonCode         `json:"observation,omitempty"`
	OperationID   string              `json:"operationId"`
	Reason        *ReasonCode         `json:"reason,omitempty"`
	TargetID      string              `json:"targetId"`
	TaskStatus    *TaskStatus         `json:"taskStatus,omitempty"`
	WaitingReason *string             `json:"waitingReason,omitempty"`
	WorkflowID    *string             `json:"workflowId,omitempty"`
	WorkflowKind  *WorkflowKind       `json:"workflowKind,omitempty"`
	WorkspaceID   *string             `json:"workspaceId,omitempty"`
}

// GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
// 的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
type TenantInvitationView struct {
	AdmitActionExecutionID *string         `json:"admitActionExecutionId,omitempty"`
	ApprovalStatus         *ApprovalStatus `json:"approvalStatus,omitempty"`
	ApprovalWorkflowID     *string         `json:"approvalWorkflowId,omitempty"`
	// RFC3339，UTC
	CreatedAt string `json:"createdAt"`
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 邀请人写给审批人看的称呼，不参与寻址与判定
	InviteeLabel       string                 `json:"inviteeLabel"`
	InviterPrincipalID string                 `json:"inviterPrincipalId"`
	MembershipID       *string                `json:"membershipId,omitempty"`
	MembershipState    *TenantMembershipState `json:"membershipState,omitempty"`
	// RFC3339，UTC；只在 REDEEMED 时出现
	RedeemedAt *string `json:"redeemedAt,omitempty"`
	// 兑换者自报的显示名，只作展示
	RedeemerDisplayName *string                `json:"redeemerDisplayName,omitempty"`
	Status              TenantInvitationStatus `json:"status"`
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

// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
type AffectedOwnerRef struct {
	OwnerPrincipalID string `json:"ownerPrincipalId"`
	TargetID         string `json:"targetId"`
	TargetType       string `json:"targetType"`
	TargetVersion    int64  `json:"targetVersion"`
}

// consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
type ApprovalControlOutcome struct {
	Status ApprovalStatus `json:"status"`
}

// decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
// 是该 approver 已记录的决定（重复同值时即原决定）。
type ApprovalDecisionOutcome struct {
	Admitted            bool   `json:"admitted"`
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// 已形成的决定；admitted=false 时缺省
	Decision *ApprovalDecision `json:"decision,omitempty"`
	// admitted=false 时的拒绝原因
	Reason *ReasonCode    `json:"reason,omitempty"`
	Status ApprovalStatus `json:"status"`
}

// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
type ApprovalDecisionRecord struct {
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// RFC3339，UTC
	DecidedAt string           `json:"decidedAt"`
	Decision  ApprovalDecision `json:"decision"`
	// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
}

// decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
// 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
type ApprovalDecisionUpdate struct {
	ApproverPrincipalID string           `json:"approverPrincipalId"`
	Decision            ApprovalDecision `json:"decision"`
}

// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
// ActionExecution。
type ApprovalWorkflowInput struct {
	ActionDefinitionVersion int64                     `json:"actionDefinitionVersion"`
	ActionExecutionID       string                    `json:"actionExecutionId"`
	ActionKey               string                    `json:"actionKey"`
	AffectedOwnerRefs       []AffectedOwnerRefElement `json:"affectedOwnerRefs"`
	// APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
	ConsumeWindowSeconds int64 `json:"consumeWindowSeconds"`
	// RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
	ExpiresAt            string                   `json:"expiresAt"`
	InitiatorPrincipalID string                   `json:"initiatorPrincipalId"`
	OperationID          string                   `json:"operationId"`
	OwnerRequirement     ApprovalOwnerRequirement `json:"ownerRequirement"`
	ParameterHash        string                   `json:"parameterHash"`
	PolicyID             string                   `json:"policyId"`
	PolicyVersion        int64                    `json:"policyVersion"`
	Resume               *ResumeClass             `json:"resume,omitempty"`
	RoleRequirements     []RoleRequirementElement `json:"roleRequirements"`
	SelfApproval         ApprovalSelfApproval     `json:"selfApproval"`
	TargetID             string                   `json:"targetId"`
	TargetType           string                   `json:"targetType"`
	TenantID             string                   `json:"tenantId"`
	// TENANT_ONLY 动作缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
type AffectedOwnerRefElement struct {
	OwnerPrincipalID string `json:"ownerPrincipalId"`
	TargetID         string `json:"targetId"`
	TargetType       string `json:"targetType"`
	TargetVersion    int64  `json:"targetVersion"`
}

// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
type ResumeClass struct {
	// RFC3339，UTC
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
	// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
	EventBase int64            `json:"eventBase"`
	Reason    *ReasonCode      `json:"reason,omitempty"`
	Refusals  []RefusalElement `json:"refusals"`
	Status    ApprovalStatus   `json:"status"`
}

// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
// §4）。
type RefusalElement struct {
	ApproverPrincipalID string     `json:"approverPrincipalId"`
	Reason              ReasonCode `json:"reason"`
}

// invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
// <action_execution_id>:invalidate。
type ApprovalInvalidateUpdate struct {
	Reason ReasonCode `json:"reason"`
}

// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
// §4）。
type ApprovalRefusal struct {
	ApproverPrincipalID string     `json:"approverPrincipalId"`
	Reason              ReasonCode `json:"reason"`
}

// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
type ApprovalResume struct {
	// RFC3339，UTC
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
	// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
	EventBase int64            `json:"eventBase"`
	Reason    *ReasonCode      `json:"reason,omitempty"`
	Refusals  []RefusalElement `json:"refusals"`
	Status    ApprovalStatus   `json:"status"`
}

// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
// §4）。
type ApprovalRoleRequirement struct {
	MinDistinct int64            `json:"minDistinct"`
	Selector    ApprovalSelector `json:"selector"`
}

// ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
// eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
type ApprovalStateReport struct {
	// RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 报告时跨 run 累计的 history 长度
	EventID int64 `json:"eventId"`
	// RFC3339，UTC
	ExpiresAt string `json:"expiresAt"`
	// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
	Reason     *ReasonCode    `json:"reason,omitempty"`
	RunID      string         `json:"runId"`
	Status     ApprovalStatus `json:"status"`
	WorkflowID string         `json:"workflowId"`
}

// FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
// 选择器 permission、owner 对账与职责分离由 Core 判定。
type FreshApprovalAdmissionRequest struct {
	ApprovalWorkflowID  string           `json:"approvalWorkflowId"`
	ApproverPrincipalID string           `json:"approverPrincipalId"`
	Decision            ApprovalDecision `json:"decision"`
}

// FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
// pre-history 拒绝。
type FreshApprovalAdmissionResult struct {
	Admitted           bool               `json:"admitted"`
	Reason             *ReasonCode        `json:"reason,omitempty"`
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
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
	ErrorClassBLOCKED ErrorClass = "BLOCKED"
	ErrorClassDENIED  ErrorClass = "DENIED"
	ErrorClassUNKNOWN ErrorClass = "UNKNOWN"
	Limit             ErrorClass = "LIMIT"
	Precondition      ErrorClass = "PRECONDITION"
)

type Kind string

const (
	File    Kind = "FILE"
	Message Kind = "MESSAGE"
	Task    Kind = "TASK"
)

// ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
// seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
type ActionDispatchState string

const (
	Aborted                    ActionDispatchState = "ABORTED"
	ActionDispatchStateUNKNOWN ActionDispatchState = "UNKNOWN"
	Dispatched                 ActionDispatchState = "DISPATCHED"
	NotDispatched              ActionDispatchState = "NOT_DISPATCHED"
)

// ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
// 是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
type ActionGateState string

const (
	ActionGateStateDENIED  ActionGateState = "DENIED"
	ActionGateStateEXPIRED ActionGateState = "EXPIRED"
	ActionGateStateREVOKED ActionGateState = "REVOKED"
	ActionGateStateWAITING ActionGateState = "WAITING"
	Allowed                ActionGateState = "ALLOWED"
	Evaluating             ActionGateState = "EVALUATING"
)

// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
//
// admitted=false 时的拒绝原因
//
// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
type ReasonCode string

const (
	AdmissionAbandoned           ReasonCode = "ADMISSION_ABANDONED"
	ApprovalConsumeWindowClosed  ReasonCode = "APPROVAL_CONSUME_WINDOW_CLOSED"
	ApprovalDenied               ReasonCode = "APPROVAL_DENIED"
	ApprovalExpired              ReasonCode = "APPROVAL_EXPIRED"
	ApprovalInvalidated          ReasonCode = "APPROVAL_INVALIDATED"
	ApprovalNotOpen              ReasonCode = "APPROVAL_NOT_OPEN"
	ApprovalSelectorUnresolvable ReasonCode = "APPROVAL_SELECTOR_UNRESOLVABLE"
	ApprovalWithdrawn            ReasonCode = "APPROVAL_WITHDRAWN"
	ApproverNotEligible          ReasonCode = "APPROVER_NOT_ELIGIBLE"
	CapabilityBlocked            ReasonCode = "CAPABILITY_BLOCKED"
	ClientKeyAlreadyBound        ReasonCode = "CLIENT_KEY_ALREADY_BOUND"
	ClientKeyLimitReached        ReasonCode = "CLIENT_KEY_LIMIT_REACHED"
	ClientKeyNotFound            ReasonCode = "CLIENT_KEY_NOT_FOUND"
	ClientKeyProofInvalid        ReasonCode = "CLIENT_KEY_PROOF_INVALID"
	DependencyUnavailable        ReasonCode = "DEPENDENCY_UNAVAILABLE"
	DispatchResultUnknown        ReasonCode = "DISPATCH_RESULT_UNKNOWN"
	DuplicateDecision            ReasonCode = "DUPLICATE_DECISION"
	ExternalResultUnknown        ReasonCode = "EXTERNAL_RESULT_UNKNOWN"
	IdempotencyKeyReused         ReasonCode = "IDEMPOTENCY_KEY_REUSED"
	IdentityHeaderMissing        ReasonCode = "IDENTITY_HEADER_MISSING"
	IdentityUnknown              ReasonCode = "IDENTITY_UNKNOWN"
	InvalidParameters            ReasonCode = "INVALID_PARAMETERS"
	InvitationAlreadyRedeemed    ReasonCode = "INVITATION_ALREADY_REDEEMED"
	InvitationExpired            ReasonCode = "INVITATION_EXPIRED"
	InvitationNotFound           ReasonCode = "INVITATION_NOT_FOUND"
	InvitationRevoked            ReasonCode = "INVITATION_REVOKED"
	InviteeAlreadyMember         ReasonCode = "INVITEE_ALREADY_MEMBER"
	LastTenantAdmin              ReasonCode = "LAST_TENANT_ADMIN"
	NativeSurfaceRequired        ReasonCode = "NATIVE_SURFACE_REQUIRED"
	PermissionDenied             ReasonCode = "PERMISSION_DENIED"
	ProjectionDelayed            ReasonCode = "PROJECTION_DELAYED"
	PublishRejected              ReasonCode = "PUBLISH_REJECTED"
	PublishResultUnknown         ReasonCode = "PUBLISH_RESULT_UNKNOWN"
	ScopeGuardFailed             ReasonCode = "SCOPE_GUARD_FAILED"
	SelfApprovalDenied           ReasonCode = "SELF_APPROVAL_DENIED"
	SessionNotActive             ReasonCode = "SESSION_NOT_ACTIVE"
	SurfaceCapabilityUnavailable ReasonCode = "SURFACE_CAPABILITY_UNAVAILABLE"
	TargetNotFound               ReasonCode = "TARGET_NOT_FOUND"
	TargetStateConflict          ReasonCode = "TARGET_STATE_CONFLICT"
	TenantMembershipNotActive    ReasonCode = "TENANT_MEMBERSHIP_NOT_ACTIVE"
	TenantSelectionNotAvailable  ReasonCode = "TENANT_SELECTION_NOT_AVAILABLE"
	WaitingApproval              ReasonCode = "WAITING_APPROVAL"
)

// approver 的不可变决定（.design/03 §6）。
//
// 已形成的决定；admitted=false 时缺省
type ApprovalDecision string

const (
	ApprovalDecisionDENY ApprovalDecision = "DENY"
	Approve              ApprovalDecision = "APPROVE"
)

// ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
// 对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
// Tenant 做 manage。
type ApprovalSelector string

const (
	ResourceApprover ApprovalSelector = "RESOURCE_APPROVER"
	TenantAdmin      ApprovalSelector = "TENANT_ADMIN"
	WorkspaceAdmin   ApprovalSelector = "WORKSPACE_ADMIN"
)

// ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
// CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
type ApprovalStatus string

const (
	ApprovalStatusDENIED  ApprovalStatus = "DENIED"
	ApprovalStatusEXPIRED ApprovalStatus = "EXPIRED"
	ApprovalStatusWAITING ApprovalStatus = "WAITING"
	Approved              ApprovalStatus = "APPROVED"
	Cancelled             ApprovalStatus = "CANCELLED"
	Consumed              ApprovalStatus = "CONSUMED"
	Invalidated           ApprovalStatus = "INVALIDATED"
	Requested             ApprovalStatus = "REQUESTED"
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

// TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
type TenantMembershipState string

const (
	Invited                           TenantMembershipState = "INVITED"
	TenantMembershipStateACTIVE       TenantMembershipState = "ACTIVE"
	TenantMembershipStateERROR        TenantMembershipState = "ERROR"
	TenantMembershipStatePROVISIONING TenantMembershipState = "PROVISIONING"
	TenantMembershipStateREVOKED      TenantMembershipState = "REVOKED"
	TenantMembershipStateREVOKING     TenantMembershipState = "REVOKING"
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

// TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
// 已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
type TenantInvitationStatus string

const (
	Issued                        TenantInvitationStatus = "ISSUED"
	Redeemed                      TenantInvitationStatus = "REDEEMED"
	TenantInvitationStatusEXPIRED TenantInvitationStatus = "EXPIRED"
	TenantInvitationStatusREVOKED TenantInvitationStatus = "REVOKED"
)

// WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
type WorkspaceMembershipState string

const (
	WorkspaceMembershipStateACTIVE       WorkspaceMembershipState = "ACTIVE"
	WorkspaceMembershipStateERROR        WorkspaceMembershipState = "ERROR"
	WorkspaceMembershipStatePROVISIONING WorkspaceMembershipState = "PROVISIONING"
	WorkspaceMembershipStateREVOKED      WorkspaceMembershipState = "REVOKED"
	WorkspaceMembershipStateREVOKING     WorkspaceMembershipState = "REVOKING"
)

// ApprovalPolicy.owner_requirement（.design/03 §4）。
type ApprovalOwnerRequirement string

const (
	AllAffectedOwners ApprovalOwnerRequirement = "ALL_AFFECTED_OWNERS"
	None              ApprovalOwnerRequirement = "NONE"
	TargetOwner       ApprovalOwnerRequirement = "TARGET_OWNER"
)

// ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
type ApprovalSelfApproval string

const (
	Allow                    ApprovalSelfApproval = "ALLOW"
	ApprovalSelfApprovalDENY ApprovalSelfApproval = "DENY"
)
