// To parse this JSON data, do
//
//     final canary = canaryFromJson(jsonString);
//     final actionCommand = actionCommandFromJson(jsonString);
//     final actionSubmission = actionSubmissionFromJson(jsonString);
//     final approvalDecisionRequest = approvalDecisionRequestFromJson(jsonString);
//     final approvalView = approvalViewFromJson(jsonString);
//     final clientKeyView = clientKeyViewFromJson(jsonString);
//     final clientKeyStatus = clientKeyStatusFromJson(jsonString);
//     final invitationRedemptionView = invitationRedemptionViewFromJson(jsonString);
//     final invitationRedemptionRequest = invitationRedemptionRequestFromJson(jsonString);
//     final issuedInvitation = issuedInvitationFromJson(jsonString);
//     final nativeCommunityFacts = nativeCommunityFactsFromJson(jsonString);
//     final ownAuditEntry = ownAuditEntryFromJson(jsonString);
//     final readMarkRequest = readMarkRequestFromJson(jsonString);
//     final platformSessionView = platformSessionViewFromJson(jsonString);
//     final taskView = taskViewFromJson(jsonString);
//     final tenantInvitationView = tenantInvitationViewFromJson(jsonString);
//     final userStateVersion = userStateVersionFromJson(jsonString);
//     final workspaceView = workspaceViewFromJson(jsonString);
//     final workspaceMemberView = workspaceMemberViewFromJson(jsonString);
//     final workspacePreferenceRequest = workspacePreferenceRequestFromJson(jsonString);
//     final errorBody = errorBodyFromJson(jsonString);
//     final resolvedIdentity = resolvedIdentityFromJson(jsonString);
//     final taskStateReport = taskStateReportFromJson(jsonString);
//     final workflowRef = workflowRefFromJson(jsonString);
//     final affectedOwnerRef = affectedOwnerRefFromJson(jsonString);
//     final approvalControlOutcome = approvalControlOutcomeFromJson(jsonString);
//     final approvalDecisionOutcome = approvalDecisionOutcomeFromJson(jsonString);
//     final approvalDecisionRecord = approvalDecisionRecordFromJson(jsonString);
//     final approvalDecisionUpdate = approvalDecisionUpdateFromJson(jsonString);
//     final approvalWorkflowInput = approvalWorkflowInputFromJson(jsonString);
//     final approvalInvalidateUpdate = approvalInvalidateUpdateFromJson(jsonString);
//     final approvalRefusal = approvalRefusalFromJson(jsonString);
//     final approvalResume = approvalResumeFromJson(jsonString);
//     final approvalRoleRequirement = approvalRoleRequirementFromJson(jsonString);
//     final approvalStateReport = approvalStateReportFromJson(jsonString);
//     final freshApprovalAdmissionRequest = freshApprovalAdmissionRequestFromJson(jsonString);
//     final freshApprovalAdmissionResult = freshApprovalAdmissionResultFromJson(jsonString);

import 'dart:convert';

Canary canaryFromJson(String str) => Canary.fromJson(json.decode(str));

String canaryToJson(Canary data) => json.encode(data.toJson());

ActionCommand actionCommandFromJson(String str) =>
    ActionCommand.fromJson(json.decode(str));

String actionCommandToJson(ActionCommand data) => json.encode(data.toJson());

ActionSubmission actionSubmissionFromJson(String str) =>
    ActionSubmission.fromJson(json.decode(str));

String actionSubmissionToJson(ActionSubmission data) =>
    json.encode(data.toJson());

ApprovalDecisionRequest approvalDecisionRequestFromJson(String str) =>
    ApprovalDecisionRequest.fromJson(json.decode(str));

String approvalDecisionRequestToJson(ApprovalDecisionRequest data) =>
    json.encode(data.toJson());

ApprovalView approvalViewFromJson(String str) =>
    ApprovalView.fromJson(json.decode(str));

String approvalViewToJson(ApprovalView data) => json.encode(data.toJson());

ClientKeyView clientKeyViewFromJson(String str) =>
    ClientKeyView.fromJson(json.decode(str));

String clientKeyViewToJson(ClientKeyView data) => json.encode(data.toJson());

ClientKeyStatus clientKeyStatusFromJson(String str) =>
    ClientKeyStatus.fromJson(json.decode(str));

String clientKeyStatusToJson(ClientKeyStatus data) =>
    json.encode(data.toJson());

InvitationRedemptionView invitationRedemptionViewFromJson(String str) =>
    InvitationRedemptionView.fromJson(json.decode(str));

String invitationRedemptionViewToJson(InvitationRedemptionView data) =>
    json.encode(data.toJson());

InvitationRedemptionRequest invitationRedemptionRequestFromJson(String str) =>
    InvitationRedemptionRequest.fromJson(json.decode(str));

String invitationRedemptionRequestToJson(InvitationRedemptionRequest data) =>
    json.encode(data.toJson());

IssuedInvitation issuedInvitationFromJson(String str) =>
    IssuedInvitation.fromJson(json.decode(str));

String issuedInvitationToJson(IssuedInvitation data) =>
    json.encode(data.toJson());

NativeCommunityFacts nativeCommunityFactsFromJson(String str) =>
    NativeCommunityFacts.fromJson(json.decode(str));

String nativeCommunityFactsToJson(NativeCommunityFacts data) =>
    json.encode(data.toJson());

OwnAuditEntry ownAuditEntryFromJson(String str) =>
    OwnAuditEntry.fromJson(json.decode(str));

String ownAuditEntryToJson(OwnAuditEntry data) => json.encode(data.toJson());

ReadMarkRequest readMarkRequestFromJson(String str) =>
    ReadMarkRequest.fromJson(json.decode(str));

String readMarkRequestToJson(ReadMarkRequest data) =>
    json.encode(data.toJson());

PlatformSessionView platformSessionViewFromJson(String str) =>
    PlatformSessionView.fromJson(json.decode(str));

String platformSessionViewToJson(PlatformSessionView data) =>
    json.encode(data.toJson());

TaskView taskViewFromJson(String str) => TaskView.fromJson(json.decode(str));

String taskViewToJson(TaskView data) => json.encode(data.toJson());

TenantInvitationView tenantInvitationViewFromJson(String str) =>
    TenantInvitationView.fromJson(json.decode(str));

String tenantInvitationViewToJson(TenantInvitationView data) =>
    json.encode(data.toJson());

UserStateVersion userStateVersionFromJson(String str) =>
    UserStateVersion.fromJson(json.decode(str));

String userStateVersionToJson(UserStateVersion data) =>
    json.encode(data.toJson());

WorkspaceView workspaceViewFromJson(String str) =>
    WorkspaceView.fromJson(json.decode(str));

String workspaceViewToJson(WorkspaceView data) => json.encode(data.toJson());

WorkspaceMemberView workspaceMemberViewFromJson(String str) =>
    WorkspaceMemberView.fromJson(json.decode(str));

String workspaceMemberViewToJson(WorkspaceMemberView data) =>
    json.encode(data.toJson());

WorkspacePreferenceRequest workspacePreferenceRequestFromJson(String str) =>
    WorkspacePreferenceRequest.fromJson(json.decode(str));

String workspacePreferenceRequestToJson(WorkspacePreferenceRequest data) =>
    json.encode(data.toJson());

ErrorBody errorBodyFromJson(String str) => ErrorBody.fromJson(json.decode(str));

String errorBodyToJson(ErrorBody data) => json.encode(data.toJson());

ResolvedIdentity resolvedIdentityFromJson(String str) =>
    ResolvedIdentity.fromJson(json.decode(str));

String resolvedIdentityToJson(ResolvedIdentity data) =>
    json.encode(data.toJson());

TaskStateReport taskStateReportFromJson(String str) =>
    TaskStateReport.fromJson(json.decode(str));

String taskStateReportToJson(TaskStateReport data) =>
    json.encode(data.toJson());

WorkflowRef workflowRefFromJson(String str) =>
    WorkflowRef.fromJson(json.decode(str));

String workflowRefToJson(WorkflowRef data) => json.encode(data.toJson());

AffectedOwnerRef affectedOwnerRefFromJson(String str) =>
    AffectedOwnerRef.fromJson(json.decode(str));

String affectedOwnerRefToJson(AffectedOwnerRef data) =>
    json.encode(data.toJson());

ApprovalControlOutcome approvalControlOutcomeFromJson(String str) =>
    ApprovalControlOutcome.fromJson(json.decode(str));

String approvalControlOutcomeToJson(ApprovalControlOutcome data) =>
    json.encode(data.toJson());

ApprovalDecisionOutcome approvalDecisionOutcomeFromJson(String str) =>
    ApprovalDecisionOutcome.fromJson(json.decode(str));

String approvalDecisionOutcomeToJson(ApprovalDecisionOutcome data) =>
    json.encode(data.toJson());

ApprovalDecisionRecord approvalDecisionRecordFromJson(String str) =>
    ApprovalDecisionRecord.fromJson(json.decode(str));

String approvalDecisionRecordToJson(ApprovalDecisionRecord data) =>
    json.encode(data.toJson());

ApprovalDecisionUpdate approvalDecisionUpdateFromJson(String str) =>
    ApprovalDecisionUpdate.fromJson(json.decode(str));

String approvalDecisionUpdateToJson(ApprovalDecisionUpdate data) =>
    json.encode(data.toJson());

ApprovalWorkflowInput approvalWorkflowInputFromJson(String str) =>
    ApprovalWorkflowInput.fromJson(json.decode(str));

String approvalWorkflowInputToJson(ApprovalWorkflowInput data) =>
    json.encode(data.toJson());

ApprovalInvalidateUpdate approvalInvalidateUpdateFromJson(String str) =>
    ApprovalInvalidateUpdate.fromJson(json.decode(str));

String approvalInvalidateUpdateToJson(ApprovalInvalidateUpdate data) =>
    json.encode(data.toJson());

ApprovalRefusal approvalRefusalFromJson(String str) =>
    ApprovalRefusal.fromJson(json.decode(str));

String approvalRefusalToJson(ApprovalRefusal data) =>
    json.encode(data.toJson());

ApprovalResume approvalResumeFromJson(String str) =>
    ApprovalResume.fromJson(json.decode(str));

String approvalResumeToJson(ApprovalResume data) => json.encode(data.toJson());

ApprovalRoleRequirement approvalRoleRequirementFromJson(String str) =>
    ApprovalRoleRequirement.fromJson(json.decode(str));

String approvalRoleRequirementToJson(ApprovalRoleRequirement data) =>
    json.encode(data.toJson());

ApprovalStateReport approvalStateReportFromJson(String str) =>
    ApprovalStateReport.fromJson(json.decode(str));

String approvalStateReportToJson(ApprovalStateReport data) =>
    json.encode(data.toJson());

FreshApprovalAdmissionRequest freshApprovalAdmissionRequestFromJson(
  String str,
) => FreshApprovalAdmissionRequest.fromJson(json.decode(str));

String freshApprovalAdmissionRequestToJson(
  FreshApprovalAdmissionRequest data,
) => json.encode(data.toJson());

FreshApprovalAdmissionResult freshApprovalAdmissionResultFromJson(String str) =>
    FreshApprovalAdmissionResult.fromJson(json.decode(str));

String freshApprovalAdmissionResultToJson(FreshApprovalAdmissionResult data) =>
    json.encode(data.toJson());

///可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
///节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
class Canary {
  ///可选的枚举引用
  final CapabilityState? capabilityState;

  ///基础 integer
  final int count;

  ///基础 boolean
  final bool enabled;

  ///跨文件 $ref 引用封闭枚举
  final ErrorClass errorClass;

  ///format: uuid
  final String id;

  ///基础 string
  final String name;

  ///内联对象，同样显式关闭 additionalProperties
  final Nested nested;

  ///RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
  ///强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
  final String? occurredAt;

  ///基础 number
  final double ratio;

  ///同构数组
  final List<String> tags;

  ///变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
  final List<Variant>? variants;

  Canary({
    this.capabilityState,
    required this.count,
    required this.enabled,
    required this.errorClass,
    required this.id,
    required this.name,
    required this.nested,
    this.occurredAt,
    required this.ratio,
    required this.tags,
    this.variants,
  });

  factory Canary.fromJson(Map<String, dynamic> json) => Canary(
    capabilityState: json["capabilityState"] == null
        ? null
        : capabilityStateValues.map[json["capabilityState"]]!,
    count: json["count"],
    enabled: json["enabled"],
    errorClass: errorClassValues.map[json["errorClass"]]!,
    id: json["id"],
    name: json["name"],
    nested: Nested.fromJson(json["nested"]),
    occurredAt: json["occurredAt"],
    ratio: json["ratio"]?.toDouble(),
    tags: List<String>.from(json["tags"].map((x) => x)),
    variants: json["variants"] == null
        ? []
        : List<Variant>.from(json["variants"]!.map((x) => Variant.fromJson(x))),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityState": capabilityStateValues.reverse[capabilityState],
    "count": count,
    "enabled": enabled,
    "errorClass": errorClassValues.reverse[errorClass],
    "id": id,
    "name": name,
    "nested": nested.toJson(),
    "occurredAt": occurredAt,
    "ratio": ratio,
    "tags": List<dynamic>.from(tags.map((x) => x)),
    "variants": variants == null
        ? []
        : List<dynamic>.from(variants!.map((x) => x.toJson())),
  });
}

///可选的枚举引用
///
///能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
enum CapabilityState {
  ADAPTER_REQUIRED,
  BLOCKED,
  DESIGN_DEFINED,
  EXCLUDED,
  UPSTREAM_SUPPORTED,
}

final capabilityStateValues = EnumValues({
  "ADAPTER_REQUIRED": CapabilityState.ADAPTER_REQUIRED,
  "BLOCKED": CapabilityState.BLOCKED,
  "DESIGN_DEFINED": CapabilityState.DESIGN_DEFINED,
  "EXCLUDED": CapabilityState.EXCLUDED,
  "UPSTREAM_SUPPORTED": CapabilityState.UPSTREAM_SUPPORTED,
});

///跨文件 $ref 引用封闭枚举
///
///错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
///表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
enum ErrorClass { BLOCKED, CONFLICT, DENIED, LIMIT, PRECONDITION, UNKNOWN }

final errorClassValues = EnumValues({
  "BLOCKED": ErrorClass.BLOCKED,
  "CONFLICT": ErrorClass.CONFLICT,
  "DENIED": ErrorClass.DENIED,
  "LIMIT": ErrorClass.LIMIT,
  "PRECONDITION": ErrorClass.PRECONDITION,
  "UNKNOWN": ErrorClass.UNKNOWN,
});

///内联对象，同样显式关闭 additionalProperties
class Nested {
  final String label;
  final List<double>? weights;

  Nested({required this.label, this.weights});

  factory Nested.fromJson(Map<String, dynamic> json) => Nested(
    label: json["label"],
    weights: json["weights"] == null
        ? []
        : List<double>.from(json["weights"]!.map((x) => x?.toDouble())),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "label": label,
    "weights": weights == null
        ? []
        : List<dynamic>.from(weights!.map((x) => x)),
  });
}

class Variant {
  final String? fileDigest;
  final Kind kind;
  final String? messageBody;
  final int? taskAttempt;

  Variant({
    this.fileDigest,
    required this.kind,
    this.messageBody,
    this.taskAttempt,
  });

  factory Variant.fromJson(Map<String, dynamic> json) => Variant(
    fileDigest: json["fileDigest"],
    kind: kindValues.map[json["kind"]]!,
    messageBody: json["messageBody"],
    taskAttempt: json["taskAttempt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "fileDigest": fileDigest,
    "kind": kindValues.reverse[kind],
    "messageBody": messageBody,
    "taskAttempt": taskAttempt,
  });
}

enum Kind { FILE, MESSAGE, TASK }

final kindValues = EnumValues({
  "FILE": Kind.FILE,
  "MESSAGE": Kind.MESSAGE,
  "TASK": Kind.TASK,
});

///POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
///actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
class ActionCommand {
  final String actionKey;

  ///调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
  final String idempotencyKey;

  ///tenant.member.invite.revoke 的目标邀请
  final String? invitationId;

  ///workspace.create 的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
  final String? name;

  ///成员动作的目标 Principal
  final String? principalId;

  ///workspace.create 的 slug
  final String? slug;

  ///Workspace 内动作的执行 Workspace
  final String? workspaceId;

  ActionCommand({
    required this.actionKey,
    required this.idempotencyKey,
    this.invitationId,
    this.name,
    this.principalId,
    this.slug,
    this.workspaceId,
  });

  factory ActionCommand.fromJson(Map<String, dynamic> json) => ActionCommand(
    actionKey: json["actionKey"],
    idempotencyKey: json["idempotencyKey"],
    invitationId: json["invitationId"],
    name: json["name"],
    principalId: json["principalId"],
    slug: json["slug"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "idempotencyKey": idempotencyKey,
    "invitationId": invitationId,
    "name": name,
    "principalId": principalId,
    "slug": slug,
    "workspaceId": workspaceId,
  });
}

///POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
///必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。
class ActionSubmission {
  final String actionExecutionId;
  final String actionKey;
  final String? approvalWorkflowId;
  final ActionDispatchState dispatchState;
  final ActionGateState gateState;
  final InvitationClass? invitation;
  final String operationId;
  final ReasonCode? reason;
  final String? workflowId;

  ActionSubmission({
    required this.actionExecutionId,
    required this.actionKey,
    this.approvalWorkflowId,
    required this.dispatchState,
    required this.gateState,
    this.invitation,
    required this.operationId,
    this.reason,
    this.workflowId,
  });

  factory ActionSubmission.fromJson(Map<String, dynamic> json) =>
      ActionSubmission(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        approvalWorkflowId: json["approvalWorkflowId"],
        dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
        gateState: actionGateStateValues.map[json["gateState"]]!,
        invitation: json["invitation"] == null
            ? null
            : InvitationClass.fromJson(json["invitation"]),
        operationId: json["operationId"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "approvalWorkflowId": approvalWorkflowId,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "gateState": actionGateStateValues.reverse[gateState],
    "invitation": invitation?.toJson(),
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
    "workflowId": workflowId,
  });
}

///ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
///seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
enum ActionDispatchState { ABORTED, DISPATCHED, NOT_DISPATCHED, UNKNOWN }

final actionDispatchStateValues = EnumValues({
  "ABORTED": ActionDispatchState.ABORTED,
  "DISPATCHED": ActionDispatchState.DISPATCHED,
  "NOT_DISPATCHED": ActionDispatchState.NOT_DISPATCHED,
  "UNKNOWN": ActionDispatchState.UNKNOWN,
});

///ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
///是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
enum ActionGateState { ALLOWED, DENIED, EVALUATING, EXPIRED, REVOKED, WAITING }

final actionGateStateValues = EnumValues({
  "ALLOWED": ActionGateState.ALLOWED,
  "DENIED": ActionGateState.DENIED,
  "EVALUATING": ActionGateState.EVALUATING,
  "EXPIRED": ActionGateState.EXPIRED,
  "REVOKED": ActionGateState.REVOKED,
  "WAITING": ActionGateState.WAITING,
});

///tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
///里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
class InvitationClass {
  ///RFC3339，UTC
  final String expiresAt;
  final String invitationId;

  ///部署登记的链接基址 + '#' + 一次性凭据
  final String link;

  InvitationClass({
    required this.expiresAt,
    required this.invitationId,
    required this.link,
  });

  factory InvitationClass.fromJson(Map<String, dynamic> json) =>
      InvitationClass(
        expiresAt: json["expiresAt"],
        invitationId: json["invitationId"],
        link: json["link"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expiresAt": expiresAt,
    "invitationId": invitationId,
    "link": link,
  });
}

///稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
///字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
///
///admitted=false 时的拒绝原因
///
///INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
enum ReasonCode {
  ADMISSION_ABANDONED,
  APPROVAL_CONSUME_WINDOW_CLOSED,
  APPROVAL_DENIED,
  APPROVAL_EXPIRED,
  APPROVAL_INVALIDATED,
  APPROVAL_NOT_OPEN,
  APPROVAL_SELECTOR_UNRESOLVABLE,
  APPROVAL_WITHDRAWN,
  APPROVER_NOT_ELIGIBLE,
  CAPABILITY_BLOCKED,
  CLIENT_KEY_ALREADY_BOUND,
  CLIENT_KEY_LIMIT_REACHED,
  CLIENT_KEY_NOT_FOUND,
  CLIENT_KEY_PROOF_INVALID,
  DEPENDENCY_UNAVAILABLE,
  DISPATCH_RESULT_UNKNOWN,
  DUPLICATE_DECISION,
  EXTERNAL_RESULT_UNKNOWN,
  IDEMPOTENCY_KEY_REUSED,
  IDENTITY_HEADER_MISSING,
  IDENTITY_UNKNOWN,
  INVALID_PARAMETERS,
  INVITATION_ALREADY_REDEEMED,
  INVITATION_EXPIRED,
  INVITATION_NOT_FOUND,
  INVITATION_REVOKED,
  INVITEE_ALREADY_MEMBER,
  LAST_TENANT_ADMIN,
  NATIVE_SURFACE_REQUIRED,
  PERMISSION_DENIED,
  PROJECTION_DELAYED,
  PUBLISH_REJECTED,
  PUBLISH_RESULT_UNKNOWN,
  SCOPE_GUARD_FAILED,
  SELF_APPROVAL_DENIED,
  SESSION_NOT_ACTIVE,
  SURFACE_CAPABILITY_UNAVAILABLE,
  TARGET_NOT_FOUND,
  TARGET_STATE_CONFLICT,
  TENANT_MEMBERSHIP_NOT_ACTIVE,
  TENANT_SELECTION_NOT_AVAILABLE,
  WAITING_APPROVAL,
}

final reasonCodeValues = EnumValues({
  "ADMISSION_ABANDONED": ReasonCode.ADMISSION_ABANDONED,
  "APPROVAL_CONSUME_WINDOW_CLOSED": ReasonCode.APPROVAL_CONSUME_WINDOW_CLOSED,
  "APPROVAL_DENIED": ReasonCode.APPROVAL_DENIED,
  "APPROVAL_EXPIRED": ReasonCode.APPROVAL_EXPIRED,
  "APPROVAL_INVALIDATED": ReasonCode.APPROVAL_INVALIDATED,
  "APPROVAL_NOT_OPEN": ReasonCode.APPROVAL_NOT_OPEN,
  "APPROVAL_SELECTOR_UNRESOLVABLE": ReasonCode.APPROVAL_SELECTOR_UNRESOLVABLE,
  "APPROVAL_WITHDRAWN": ReasonCode.APPROVAL_WITHDRAWN,
  "APPROVER_NOT_ELIGIBLE": ReasonCode.APPROVER_NOT_ELIGIBLE,
  "CAPABILITY_BLOCKED": ReasonCode.CAPABILITY_BLOCKED,
  "CLIENT_KEY_ALREADY_BOUND": ReasonCode.CLIENT_KEY_ALREADY_BOUND,
  "CLIENT_KEY_LIMIT_REACHED": ReasonCode.CLIENT_KEY_LIMIT_REACHED,
  "CLIENT_KEY_NOT_FOUND": ReasonCode.CLIENT_KEY_NOT_FOUND,
  "CLIENT_KEY_PROOF_INVALID": ReasonCode.CLIENT_KEY_PROOF_INVALID,
  "DEPENDENCY_UNAVAILABLE": ReasonCode.DEPENDENCY_UNAVAILABLE,
  "DISPATCH_RESULT_UNKNOWN": ReasonCode.DISPATCH_RESULT_UNKNOWN,
  "DUPLICATE_DECISION": ReasonCode.DUPLICATE_DECISION,
  "EXTERNAL_RESULT_UNKNOWN": ReasonCode.EXTERNAL_RESULT_UNKNOWN,
  "IDEMPOTENCY_KEY_REUSED": ReasonCode.IDEMPOTENCY_KEY_REUSED,
  "IDENTITY_HEADER_MISSING": ReasonCode.IDENTITY_HEADER_MISSING,
  "IDENTITY_UNKNOWN": ReasonCode.IDENTITY_UNKNOWN,
  "INVALID_PARAMETERS": ReasonCode.INVALID_PARAMETERS,
  "INVITATION_ALREADY_REDEEMED": ReasonCode.INVITATION_ALREADY_REDEEMED,
  "INVITATION_EXPIRED": ReasonCode.INVITATION_EXPIRED,
  "INVITATION_NOT_FOUND": ReasonCode.INVITATION_NOT_FOUND,
  "INVITATION_REVOKED": ReasonCode.INVITATION_REVOKED,
  "INVITEE_ALREADY_MEMBER": ReasonCode.INVITEE_ALREADY_MEMBER,
  "LAST_TENANT_ADMIN": ReasonCode.LAST_TENANT_ADMIN,
  "NATIVE_SURFACE_REQUIRED": ReasonCode.NATIVE_SURFACE_REQUIRED,
  "PERMISSION_DENIED": ReasonCode.PERMISSION_DENIED,
  "PROJECTION_DELAYED": ReasonCode.PROJECTION_DELAYED,
  "PUBLISH_REJECTED": ReasonCode.PUBLISH_REJECTED,
  "PUBLISH_RESULT_UNKNOWN": ReasonCode.PUBLISH_RESULT_UNKNOWN,
  "SCOPE_GUARD_FAILED": ReasonCode.SCOPE_GUARD_FAILED,
  "SELF_APPROVAL_DENIED": ReasonCode.SELF_APPROVAL_DENIED,
  "SESSION_NOT_ACTIVE": ReasonCode.SESSION_NOT_ACTIVE,
  "SURFACE_CAPABILITY_UNAVAILABLE": ReasonCode.SURFACE_CAPABILITY_UNAVAILABLE,
  "TARGET_NOT_FOUND": ReasonCode.TARGET_NOT_FOUND,
  "TARGET_STATE_CONFLICT": ReasonCode.TARGET_STATE_CONFLICT,
  "TENANT_MEMBERSHIP_NOT_ACTIVE": ReasonCode.TENANT_MEMBERSHIP_NOT_ACTIVE,
  "TENANT_SELECTION_NOT_AVAILABLE": ReasonCode.TENANT_SELECTION_NOT_AVAILABLE,
  "WAITING_APPROVAL": ReasonCode.WAITING_APPROVAL,
});

///POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
///ApprovalDecisionOutcome。
class ApprovalDecisionRequest {
  final ApprovalDecision decision;

  ApprovalDecisionRequest({required this.decision});

  factory ApprovalDecisionRequest.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionRequest(
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"decision": approvalDecisionValues.reverse[decision]});
}

///approver 的不可变决定（.design/03 §6）。
///
///已形成的决定；admitted=false 时缺省
enum ApprovalDecision { APPROVE, DENY }

final approvalDecisionValues = EnumValues({
  "APPROVE": ApprovalDecision.APPROVE,
  "DENY": ApprovalDecision.DENY,
});

///GET /api/v1/approvals（待我审批）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history
///的投影。
class ApprovalView {
  final String actionExecutionId;
  final String actionKey;

  ///RFC3339，UTC
  final String? consumeDeadline;
  final List<DecisionElement> decisions;

  ///RFC3339，UTC
  final String expiresAt;
  final String initiatorPrincipalId;
  final ReasonCode? observation;
  final ReasonCode? reason;
  final List<RoleRequirementElement> roleRequirements;
  final ApprovalStatus status;
  final String targetId;
  final String targetType;
  final String workflowId;
  final String? workspaceId;

  ApprovalView({
    required this.actionExecutionId,
    required this.actionKey,
    this.consumeDeadline,
    required this.decisions,
    required this.expiresAt,
    required this.initiatorPrincipalId,
    this.observation,
    this.reason,
    required this.roleRequirements,
    required this.status,
    required this.targetId,
    required this.targetType,
    required this.workflowId,
    this.workspaceId,
  });

  factory ApprovalView.fromJson(Map<String, dynamic> json) => ApprovalView(
    actionExecutionId: json["actionExecutionId"],
    actionKey: json["actionKey"],
    consumeDeadline: json["consumeDeadline"],
    decisions: List<DecisionElement>.from(
      json["decisions"].map((x) => DecisionElement.fromJson(x)),
    ),
    expiresAt: json["expiresAt"],
    initiatorPrincipalId: json["initiatorPrincipalId"],
    observation: json["observation"] == null
        ? null
        : reasonCodeValues.map[json["observation"]]!,
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    roleRequirements: List<RoleRequirementElement>.from(
      json["roleRequirements"].map((x) => RoleRequirementElement.fromJson(x)),
    ),
    status: approvalStatusValues.map[json["status"]]!,
    targetId: json["targetId"],
    targetType: json["targetType"],
    workflowId: json["workflowId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "expiresAt": expiresAt,
    "initiatorPrincipalId": initiatorPrincipalId,
    "observation": reasonCodeValues.reverse[observation],
    "reason": reasonCodeValues.reverse[reason],
    "roleRequirements": List<dynamic>.from(
      roleRequirements.map((x) => x.toJson()),
    ),
    "status": approvalStatusValues.reverse[status],
    "targetId": targetId,
    "targetType": targetType,
    "workflowId": workflowId,
    "workspaceId": workspaceId,
  });
}

///一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
class DecisionElement {
  final String approverPrincipalId;

  ///RFC3339，UTC
  final String decidedAt;
  final ApprovalDecision decision;

  ///该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
  final List<ApprovalSelector> satisfiedSelectors;

  DecisionElement({
    required this.approverPrincipalId,
    required this.decidedAt,
    required this.decision,
    required this.satisfiedSelectors,
  });

  factory DecisionElement.fromJson(Map<String, dynamic> json) =>
      DecisionElement(
        approverPrincipalId: json["approverPrincipalId"],
        decidedAt: json["decidedAt"],
        decision: approvalDecisionValues.map[json["decision"]]!,
        satisfiedSelectors: List<ApprovalSelector>.from(
          json["satisfiedSelectors"].map((x) => approvalSelectorValues.map[x]!),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "decidedAt": decidedAt,
    "decision": approvalDecisionValues.reverse[decision],
    "satisfiedSelectors": List<dynamic>.from(
      satisfiedSelectors.map((x) => approvalSelectorValues.reverse[x]),
    ),
  });
}

///ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
///对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
///Tenant 做 manage。
enum ApprovalSelector { RESOURCE_APPROVER, TENANT_ADMIN, WORKSPACE_ADMIN }

final approvalSelectorValues = EnumValues({
  "RESOURCE_APPROVER": ApprovalSelector.RESOURCE_APPROVER,
  "TENANT_ADMIN": ApprovalSelector.TENANT_ADMIN,
  "WORKSPACE_ADMIN": ApprovalSelector.WORKSPACE_ADMIN,
});

///ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
///§4）。
class RoleRequirementElement {
  final int minDistinct;
  final ApprovalSelector selector;

  RoleRequirementElement({required this.minDistinct, required this.selector});

  factory RoleRequirementElement.fromJson(Map<String, dynamic> json) =>
      RoleRequirementElement(
        minDistinct: json["minDistinct"],
        selector: approvalSelectorValues.map[json["selector"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "minDistinct": minDistinct,
    "selector": approvalSelectorValues.reverse[selector],
  });
}

///ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
///CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
enum ApprovalStatus {
  APPROVED,
  CANCELLED,
  CONSUMED,
  DENIED,
  EXPIRED,
  INVALIDATED,
  REQUESTED,
  WAITING,
}

final approvalStatusValues = EnumValues({
  "APPROVED": ApprovalStatus.APPROVED,
  "CANCELLED": ApprovalStatus.CANCELLED,
  "CONSUMED": ApprovalStatus.CONSUMED,
  "DENIED": ApprovalStatus.DENIED,
  "EXPIRED": ApprovalStatus.EXPIRED,
  "INVALIDATED": ApprovalStatus.INVALIDATED,
  "REQUESTED": ApprovalStatus.REQUESTED,
  "WAITING": ApprovalStatus.WAITING,
});

///GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
class ClientKeyView {
  ///RFC3339
  final String createdAt;
  final String pubkey;
  final BuzzIdentityState state;

  ClientKeyView({
    required this.createdAt,
    required this.pubkey,
    required this.state,
  });

  factory ClientKeyView.fromJson(Map<String, dynamic> json) => ClientKeyView(
    createdAt: json["createdAt"],
    pubkey: json["pubkey"],
    state: buzzIdentityStateValues.map[json["state"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "pubkey": pubkey,
    "state": buzzIdentityStateValues.reverse[state],
  });
}

///BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
enum BuzzIdentityState {
  ACTIVE,
  PENDING_SECRET,
  RECONCILING,
  REVOKED,
  REVOKING,
}

final buzzIdentityStateValues = EnumValues({
  "ACTIVE": BuzzIdentityState.ACTIVE,
  "PENDING_SECRET": BuzzIdentityState.PENDING_SECRET,
  "RECONCILING": BuzzIdentityState.RECONCILING,
  "REVOKED": BuzzIdentityState.REVOKED,
  "REVOKING": BuzzIdentityState.REVOKING,
});

///设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
////api/v1/identity/client-keys/{pubkey}）的回应。
class ClientKeyStatus {
  final String pubkey;
  final BuzzIdentityState state;

  ///推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
  final String? workflowId;

  ClientKeyStatus({required this.pubkey, required this.state, this.workflowId});

  factory ClientKeyStatus.fromJson(Map<String, dynamic> json) =>
      ClientKeyStatus(
        pubkey: json["pubkey"],
        state: buzzIdentityStateValues.map[json["state"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "pubkey": pubkey,
    "state": buzzIdentityStateValues.reverse[state],
    "workflowId": workflowId,
  });
}

///POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
///的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
///admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
class InvitationRedemptionView {
  final ActionGateState admissionGateState;
  final String invitationId;
  final TenantMembershipState membershipState;
  final ReasonCode? reason;

  ///RFC3339，UTC
  final String redeemedAt;
  final String tenantId;
  final String tenantName;

  InvitationRedemptionView({
    required this.admissionGateState,
    required this.invitationId,
    required this.membershipState,
    this.reason,
    required this.redeemedAt,
    required this.tenantId,
    required this.tenantName,
  });

  factory InvitationRedemptionView.fromJson(
    Map<String, dynamic> json,
  ) => InvitationRedemptionView(
    admissionGateState: actionGateStateValues.map[json["admissionGateState"]]!,
    invitationId: json["invitationId"],
    membershipState: tenantMembershipStateValues.map[json["membershipState"]]!,
    reason: reasonCodeValues.map[json["reason"]]!,
    redeemedAt: json["redeemedAt"],
    tenantId: json["tenantId"],
    tenantName: json["tenantName"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "admissionGateState": actionGateStateValues.reverse[admissionGateState],
    "invitationId": invitationId,
    "membershipState": tenantMembershipStateValues.reverse[membershipState],
    "reason": reasonCodeValues.reverse[reason],
    "redeemedAt": redeemedAt,
    "tenantId": tenantId,
    "tenantName": tenantName,
  });
}

///TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
enum TenantMembershipState {
  ACTIVE,
  ERROR,
  INVITED,
  PROVISIONING,
  REVOKED,
  REVOKING,
}

final tenantMembershipStateValues = EnumValues({
  "ACTIVE": TenantMembershipState.ACTIVE,
  "ERROR": TenantMembershipState.ERROR,
  "INVITED": TenantMembershipState.INVITED,
  "PROVISIONING": TenantMembershipState.PROVISIONING,
  "REVOKED": TenantMembershipState.REVOKED,
  "REVOKING": TenantMembershipState.REVOKING,
});

///POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
class InvitationRedemptionRequest {
  ///邀请链接 fragment 里的一次性凭据
  final String credential;

  ///兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
  final String displayName;

  InvitationRedemptionRequest({
    required this.credential,
    required this.displayName,
  });

  factory InvitationRedemptionRequest.fromJson(Map<String, dynamic> json) =>
      InvitationRedemptionRequest(
        credential: json["credential"],
        displayName: json["displayName"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"credential": credential, "displayName": displayName});
}

///tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
///里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
class IssuedInvitation {
  ///RFC3339，UTC
  final String expiresAt;
  final String invitationId;

  ///部署登记的链接基址 + '#' + 一次性凭据
  final String link;

  IssuedInvitation({
    required this.expiresAt,
    required this.invitationId,
    required this.link,
  });

  factory IssuedInvitation.fromJson(Map<String, dynamic> json) =>
      IssuedInvitation(
        expiresAt: json["expiresAt"],
        invitationId: json["invitationId"],
        link: json["link"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expiresAt": expiresAt,
    "invitationId": invitationId,
    "link": link,
  });
}

///GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
///communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
class NativeCommunityFacts {
  ///该 Tenant 的 Community host，可能带非默认端口
  final String communityHost;

  ///原生端直连的 Relay 地址
  final String relayUrl;

  NativeCommunityFacts({required this.communityHost, required this.relayUrl});

  factory NativeCommunityFacts.fromJson(Map<String, dynamic> json) =>
      NativeCommunityFacts(
        communityHost: json["communityHost"],
        relayUrl: json["relayUrl"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"communityHost": communityHost, "relayUrl": relayUrl});
}

///GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
class OwnAuditEntry {
  final String actionKey;
  final String decision;
  final AuditEventType eventType;

  ///RFC3339
  final String occurredAt;
  final String resultCode;

  ///动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
  final String? workspaceId;

  OwnAuditEntry({
    required this.actionKey,
    required this.decision,
    required this.eventType,
    required this.occurredAt,
    required this.resultCode,
    this.workspaceId,
  });

  factory OwnAuditEntry.fromJson(Map<String, dynamic> json) => OwnAuditEntry(
    actionKey: json["actionKey"],
    decision: json["decision"],
    eventType: auditEventTypeValues.map[json["eventType"]]!,
    occurredAt: json["occurredAt"],
    resultCode: json["resultCode"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "decision": decision,
    "eventType": auditEventTypeValues.reverse[eventType],
    "occurredAt": occurredAt,
    "resultCode": resultCode,
    "workspaceId": workspaceId,
  });
}

///AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
///OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
enum AuditEventType {
  ACCESS,
  APPROVAL,
  AUTHENTICATION,
  DECISION,
  DISPATCH,
  INTENT,
  OUTCOME,
  RECONCILIATION,
  REVOCATION,
  SESSION,
}

final auditEventTypeValues = EnumValues({
  "ACCESS": AuditEventType.ACCESS,
  "APPROVAL": AuditEventType.APPROVAL,
  "AUTHENTICATION": AuditEventType.AUTHENTICATION,
  "DECISION": AuditEventType.DECISION,
  "DISPATCH": AuditEventType.DISPATCH,
  "INTENT": AuditEventType.INTENT,
  "OUTCOME": AuditEventType.OUTCOME,
  "RECONCILIATION": AuditEventType.RECONCILIATION,
  "REVOCATION": AuditEventType.REVOCATION,
  "SESSION": AuditEventType.SESSION,
});

///PUT /api/v1/user-state/read 的请求体（DD-40）。contextKey 只接受调用方可读 Workspace 内的 Channel ID 或
///msg:<Buzz event id>；version 是读到的 CollaborationUserState 版本，不符即 409。
class ReadMarkRequest {
  final String contextKey;

  ///RFC3339，Core 统一存成 UTC
  final String lastReadAt;
  final int version;

  ReadMarkRequest({
    required this.contextKey,
    required this.lastReadAt,
    required this.version,
  });

  factory ReadMarkRequest.fromJson(Map<String, dynamic> json) =>
      ReadMarkRequest(
        contextKey: json["contextKey"],
        lastReadAt: json["lastReadAt"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contextKey": contextKey,
    "lastReadAt": lastReadAt,
    "version": version,
  });
}

///GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
///绑定设备持钥证明（DD-79）。
class PlatformSessionView {
  ///当前选定的 Workspace；未选定时缺省
  final String? currentWorkspaceId;

  ///HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
  final String displayName;
  final String humanIdentityId;
  final String platformSessionId;
  final String tenantId;
  final String tenantMembershipId;
  final String tenantPrincipalId;

  PlatformSessionView({
    this.currentWorkspaceId,
    required this.displayName,
    required this.humanIdentityId,
    required this.platformSessionId,
    required this.tenantId,
    required this.tenantMembershipId,
    required this.tenantPrincipalId,
  });

  factory PlatformSessionView.fromJson(Map<String, dynamic> json) =>
      PlatformSessionView(
        currentWorkspaceId: json["currentWorkspaceId"],
        displayName: json["displayName"],
        humanIdentityId: json["humanIdentityId"],
        platformSessionId: json["platformSessionId"],
        tenantId: json["tenantId"],
        tenantMembershipId: json["tenantMembershipId"],
        tenantPrincipalId: json["tenantPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "currentWorkspaceId": currentWorkspaceId,
    "displayName": displayName,
    "humanIdentityId": humanIdentityId,
    "platformSessionId": platformSessionId,
    "tenantId": tenantId,
    "tenantMembershipId": tenantMembershipId,
    "tenantPrincipalId": tenantPrincipalId,
  });
}

///GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
///非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
class TaskView {
  final String actionExecutionId;
  final String actionKey;
  final int actionVersion;
  final ApprovalStatus? approvalStatus;
  final String? approvalWorkflowId;

  ///RFC3339，UTC
  final String createdAt;
  final ActionDispatchState dispatchState;
  final ActionGateState gateState;
  final ReasonCode? observation;
  final String operationId;
  final ReasonCode? reason;
  final String targetId;
  final TaskStatus? taskStatus;
  final String? waitingReason;
  final String? workflowId;
  final WorkflowKind? workflowKind;
  final String? workspaceId;

  TaskView({
    required this.actionExecutionId,
    required this.actionKey,
    required this.actionVersion,
    this.approvalStatus,
    this.approvalWorkflowId,
    required this.createdAt,
    required this.dispatchState,
    required this.gateState,
    this.observation,
    required this.operationId,
    this.reason,
    required this.targetId,
    this.taskStatus,
    this.waitingReason,
    this.workflowId,
    this.workflowKind,
    this.workspaceId,
  });

  factory TaskView.fromJson(Map<String, dynamic> json) => TaskView(
    actionExecutionId: json["actionExecutionId"],
    actionKey: json["actionKey"],
    actionVersion: json["actionVersion"],
    approvalStatus: json["approvalStatus"] == null
        ? null
        : approvalStatusValues.map[json["approvalStatus"]]!,
    approvalWorkflowId: json["approvalWorkflowId"],
    createdAt: json["createdAt"],
    dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
    gateState: actionGateStateValues.map[json["gateState"]]!,
    observation: json["observation"] == null
        ? null
        : reasonCodeValues.map[json["observation"]]!,
    operationId: json["operationId"],
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    targetId: json["targetId"],
    taskStatus: json["taskStatus"] == null
        ? null
        : taskStatusValues.map[json["taskStatus"]]!,
    waitingReason: json["waitingReason"],
    workflowId: json["workflowId"],
    workflowKind: json["workflowKind"] == null
        ? null
        : workflowKindValues.map[json["workflowKind"]]!,
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "approvalStatus": approvalStatusValues.reverse[approvalStatus],
    "approvalWorkflowId": approvalWorkflowId,
    "createdAt": createdAt,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "gateState": actionGateStateValues.reverse[gateState],
    "observation": reasonCodeValues.reverse[observation],
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
    "targetId": targetId,
    "taskStatus": taskStatusValues.reverse[taskStatus],
    "waitingReason": waitingReason,
    "workflowId": workflowId,
    "workflowKind": workflowKindValues.reverse[workflowKind],
    "workspaceId": workspaceId,
  });
}

///TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
///status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
///WorkflowRef 进入 TERMINAL。
enum TaskStatus { CANCELED, COMPLETED, FAILED, RUNNING, TERMINATED, TIMED_OUT }

final taskStatusValues = EnumValues({
  "CANCELED": TaskStatus.CANCELED,
  "COMPLETED": TaskStatus.COMPLETED,
  "FAILED": TaskStatus.FAILED,
  "RUNNING": TaskStatus.RUNNING,
  "TERMINATED": TaskStatus.TERMINATED,
  "TIMED_OUT": TaskStatus.TIMED_OUT,
});

///ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
///必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
enum WorkflowKind {
  BUZZ_IDENTITY_PROJECTION,
  MEMBERSHIP_PROJECTION,
  MEMBERSHIP_REVOCATION,
  TENANT_LIFECYCLE,
  WORKSPACE_LIFECYCLE,
}

final workflowKindValues = EnumValues({
  "BUZZ_IDENTITY_PROJECTION": WorkflowKind.BUZZ_IDENTITY_PROJECTION,
  "MEMBERSHIP_PROJECTION": WorkflowKind.MEMBERSHIP_PROJECTION,
  "MEMBERSHIP_REVOCATION": WorkflowKind.MEMBERSHIP_REVOCATION,
  "TENANT_LIFECYCLE": WorkflowKind.TENANT_LIFECYCLE,
  "WORKSPACE_LIFECYCLE": WorkflowKind.WORKSPACE_LIFECYCLE,
});

///GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
///的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
class TenantInvitationView {
  final String? admitActionExecutionId;
  final ApprovalStatus? approvalStatus;
  final String? approvalWorkflowId;

  ///RFC3339，UTC
  final String createdAt;

  ///RFC3339，UTC
  final String expiresAt;
  final String invitationId;

  ///邀请人写给审批人看的称呼，不参与寻址与判定
  final String inviteeLabel;
  final String inviterPrincipalId;
  final String? membershipId;
  final TenantMembershipState? membershipState;

  ///RFC3339，UTC；只在 REDEEMED 时出现
  final String? redeemedAt;

  ///兑换者自报的显示名，只作展示
  final String? redeemerDisplayName;
  final TenantInvitationStatus status;

  TenantInvitationView({
    this.admitActionExecutionId,
    this.approvalStatus,
    this.approvalWorkflowId,
    required this.createdAt,
    required this.expiresAt,
    required this.invitationId,
    required this.inviteeLabel,
    required this.inviterPrincipalId,
    this.membershipId,
    this.membershipState,
    this.redeemedAt,
    this.redeemerDisplayName,
    required this.status,
  });

  factory TenantInvitationView.fromJson(Map<String, dynamic> json) =>
      TenantInvitationView(
        admitActionExecutionId: json["admitActionExecutionId"],
        approvalStatus: approvalStatusValues.map[json["approvalStatus"]]!,
        approvalWorkflowId: json["approvalWorkflowId"],
        createdAt: json["createdAt"],
        expiresAt: json["expiresAt"],
        invitationId: json["invitationId"],
        inviteeLabel: json["inviteeLabel"],
        inviterPrincipalId: json["inviterPrincipalId"],
        membershipId: json["membershipId"],
        membershipState:
            tenantMembershipStateValues.map[json["membershipState"]]!,
        redeemedAt: json["redeemedAt"],
        redeemerDisplayName: json["redeemerDisplayName"],
        status: tenantInvitationStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitActionExecutionId": admitActionExecutionId,
    "approvalStatus": approvalStatusValues.reverse[approvalStatus],
    "approvalWorkflowId": approvalWorkflowId,
    "createdAt": createdAt,
    "expiresAt": expiresAt,
    "invitationId": invitationId,
    "inviteeLabel": inviteeLabel,
    "inviterPrincipalId": inviterPrincipalId,
    "membershipId": membershipId,
    "membershipState": tenantMembershipStateValues.reverse[membershipState],
    "redeemedAt": redeemedAt,
    "redeemerDisplayName": redeemerDisplayName,
    "status": tenantInvitationStatusValues.reverse[status],
  });
}

///TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
///已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
enum TenantInvitationStatus { EXPIRED, ISSUED, REDEEMED, REVOKED }

final tenantInvitationStatusValues = EnumValues({
  "EXPIRED": TenantInvitationStatus.EXPIRED,
  "ISSUED": TenantInvitationStatus.ISSUED,
  "REDEEMED": TenantInvitationStatus.REDEEMED,
  "REVOKED": TenantInvitationStatus.REVOKED,
});

///CollaborationUserState 写入成功后的新版本（PUT /api/v1/user-state/read 与 PUT
////api/v1/user-state/workspaces/{workspaceId} 的 200 回应）。
class UserStateVersion {
  final int version;

  UserStateVersion({required this.version});

  factory UserStateVersion.fromJson(Map<String, dynamic> json) =>
      UserStateVersion(version: json["version"]);

  Map<String, dynamic> toJson() => _stripNulls({"version": version});
}

///GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 且两侧 binding 都 ACTIVE 的
///Workspace。Workspace id 同时是其 Channel id（DD-80）。
class WorkspaceView {
  final String id;
  final String name;
  final String slug;

  WorkspaceView({required this.id, required this.name, required this.slug});

  factory WorkspaceView.fromJson(Map<String, dynamic> json) =>
      WorkspaceView(id: json["id"], name: json["name"], slug: json["slug"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"id": id, "name": name, "slug": slug});
}

///GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
class WorkspaceMemberView {
  final String displayName;
  final String principalId;

  ///此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
  final List<String> pubkeys;
  final WorkspaceMembershipState state;

  WorkspaceMemberView({
    required this.displayName,
    required this.principalId,
    required this.pubkeys,
    required this.state,
  });

  factory WorkspaceMemberView.fromJson(Map<String, dynamic> json) =>
      WorkspaceMemberView(
        displayName: json["displayName"],
        principalId: json["principalId"],
        pubkeys: List<String>.from(json["pubkeys"].map((x) => x)),
        state: workspaceMembershipStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "principalId": principalId,
    "pubkeys": List<dynamic>.from(pubkeys.map((x) => x)),
    "state": workspaceMembershipStateValues.reverse[state],
  });
}

///WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
enum WorkspaceMembershipState { ACTIVE, ERROR, PROVISIONING, REVOKED, REVOKING }

final workspaceMembershipStateValues = EnumValues({
  "ACTIVE": WorkspaceMembershipState.ACTIVE,
  "ERROR": WorkspaceMembershipState.ERROR,
  "PROVISIONING": WorkspaceMembershipState.PROVISIONING,
  "REVOKED": WorkspaceMembershipState.REVOKED,
  "REVOKING": WorkspaceMembershipState.REVOKING,
});

///PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
///是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
class WorkspacePreferenceRequest {
  final bool muted;
  final bool starred;
  final int version;

  WorkspacePreferenceRequest({
    required this.muted,
    required this.starred,
    required this.version,
  });

  factory WorkspacePreferenceRequest.fromJson(Map<String, dynamic> json) =>
      WorkspacePreferenceRequest(
        muted: json["muted"],
        starred: json["starred"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"muted": muted, "starred": starred, "version": version});
}

///统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
class ErrorBody {
  final ErrorClass errorBodyClass;

  ///贯穿 Core、Worker、adapter 与组件的关联键
  final String? operationId;
  final ReasonCode reason;

  ErrorBody({
    required this.errorBodyClass,
    this.operationId,
    required this.reason,
  });

  factory ErrorBody.fromJson(Map<String, dynamic> json) => ErrorBody(
    errorBodyClass: errorClassValues.map[json["class"]]!,
    operationId: json["operationId"],
    reason: reasonCodeValues.map[json["reason"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "class": errorClassValues.reverse[errorBodyClass],
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
  });
}

///BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
class ResolvedIdentity {
  ///当前选定的 Workspace；未选定时缺省
  final String? currentWorkspaceId;
  final String humanIdentityId;
  final String tenantId;
  final String tenantMembershipId;
  final String tenantPrincipalId;

  ResolvedIdentity({
    this.currentWorkspaceId,
    required this.humanIdentityId,
    required this.tenantId,
    required this.tenantMembershipId,
    required this.tenantPrincipalId,
  });

  factory ResolvedIdentity.fromJson(Map<String, dynamic> json) =>
      ResolvedIdentity(
        currentWorkspaceId: json["currentWorkspaceId"],
        humanIdentityId: json["humanIdentityId"],
        tenantId: json["tenantId"],
        tenantMembershipId: json["tenantMembershipId"],
        tenantPrincipalId: json["tenantPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "currentWorkspaceId": currentWorkspaceId,
    "humanIdentityId": humanIdentityId,
    "tenantId": tenantId,
    "tenantMembershipId": tenantMembershipId,
    "tenantPrincipalId": tenantPrincipalId,
  });
}

///Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
///单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
class TaskStateReport {
  ///报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
  final int eventId;
  final String? progress;
  final String runId;
  final TaskStatus status;
  final String? waitingReason;

  ///固定格式的业务 workflow ID
  final String workflowId;

  TaskStateReport({
    required this.eventId,
    this.progress,
    required this.runId,
    required this.status,
    this.waitingReason,
    required this.workflowId,
  });

  factory TaskStateReport.fromJson(Map<String, dynamic> json) =>
      TaskStateReport(
        eventId: json["eventId"],
        progress: json["progress"],
        runId: json["runId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "eventId": eventId,
    "progress": progress,
    "runId": runId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
    "workflowId": workflowId,
  });
}

///Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
///kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
class WorkflowRef {
  ///RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
  final String createdAt;
  final int entityVersion;
  final WorkflowKind kind;
  final String primaryEntityId;

  ///Start 成功后回填；未知时缺省
  final String? runId;
  final String tenantId;

  ///固定格式的业务 workflow ID
  final String workflowId;

  WorkflowRef({
    required this.createdAt,
    required this.entityVersion,
    required this.kind,
    required this.primaryEntityId,
    this.runId,
    required this.tenantId,
    required this.workflowId,
  });

  factory WorkflowRef.fromJson(Map<String, dynamic> json) => WorkflowRef(
    createdAt: json["createdAt"],
    entityVersion: json["entityVersion"],
    kind: workflowKindValues.map[json["kind"]]!,
    primaryEntityId: json["primaryEntityId"],
    runId: json["runId"],
    tenantId: json["tenantId"],
    workflowId: json["workflowId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "entityVersion": entityVersion,
    "kind": workflowKindValues.reverse[kind],
    "primaryEntityId": primaryEntityId,
    "runId": runId,
    "tenantId": tenantId,
    "workflowId": workflowId,
  });
}

///请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
class AffectedOwnerRef {
  final String ownerPrincipalId;
  final String targetId;
  final String targetType;
  final int targetVersion;

  AffectedOwnerRef({
    required this.ownerPrincipalId,
    required this.targetId,
    required this.targetType,
    required this.targetVersion,
  });

  factory AffectedOwnerRef.fromJson(Map<String, dynamic> json) =>
      AffectedOwnerRef(
        ownerPrincipalId: json["ownerPrincipalId"],
        targetId: json["targetId"],
        targetType: json["targetType"],
        targetVersion: json["targetVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "ownerPrincipalId": ownerPrincipalId,
    "targetId": targetId,
    "targetType": targetType,
    "targetVersion": targetVersion,
  });
}

///consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
class ApprovalControlOutcome {
  final ApprovalStatus status;

  ApprovalControlOutcome({required this.status});

  factory ApprovalControlOutcome.fromJson(Map<String, dynamic> json) =>
      ApprovalControlOutcome(status: approvalStatusValues.map[json["status"]]!);

  Map<String, dynamic> toJson() =>
      _stripNulls({"status": approvalStatusValues.reverse[status]});
}

///decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
///是该 approver 已记录的决定（重复同值时即原决定）。
class ApprovalDecisionOutcome {
  final bool admitted;
  final String approverPrincipalId;

  ///已形成的决定；admitted=false 时缺省
  final ApprovalDecision? decision;

  ///admitted=false 时的拒绝原因
  final ReasonCode? reason;
  final ApprovalStatus status;

  ApprovalDecisionOutcome({
    required this.admitted,
    required this.approverPrincipalId,
    this.decision,
    this.reason,
    required this.status,
  });

  factory ApprovalDecisionOutcome.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionOutcome(
        admitted: json["admitted"],
        approverPrincipalId: json["approverPrincipalId"],
        decision: json["decision"] == null
            ? null
            : approvalDecisionValues.map[json["decision"]]!,
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        status: approvalStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitted": admitted,
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
    "reason": reasonCodeValues.reverse[reason],
    "status": approvalStatusValues.reverse[status],
  });
}

///一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
class ApprovalDecisionRecord {
  final String approverPrincipalId;

  ///RFC3339，UTC
  final String decidedAt;
  final ApprovalDecision decision;

  ///该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
  final List<ApprovalSelector> satisfiedSelectors;

  ApprovalDecisionRecord({
    required this.approverPrincipalId,
    required this.decidedAt,
    required this.decision,
    required this.satisfiedSelectors,
  });

  factory ApprovalDecisionRecord.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionRecord(
        approverPrincipalId: json["approverPrincipalId"],
        decidedAt: json["decidedAt"],
        decision: approvalDecisionValues.map[json["decision"]]!,
        satisfiedSelectors: List<ApprovalSelector>.from(
          json["satisfiedSelectors"].map((x) => approvalSelectorValues.map[x]!),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "decidedAt": decidedAt,
    "decision": approvalDecisionValues.reverse[decision],
    "satisfiedSelectors": List<dynamic>.from(
      satisfiedSelectors.map((x) => approvalSelectorValues.reverse[x]),
    ),
  });
}

///decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
///侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
class ApprovalDecisionUpdate {
  final String approverPrincipalId;
  final ApprovalDecision decision;

  ApprovalDecisionUpdate({
    required this.approverPrincipalId,
    required this.decision,
  });

  factory ApprovalDecisionUpdate.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionUpdate(
        approverPrincipalId: json["approverPrincipalId"],
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
  });
}

///ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
///ActionExecution。
class ApprovalWorkflowInput {
  final int actionDefinitionVersion;
  final String actionExecutionId;
  final String actionKey;
  final List<AffectedOwnerRefElement> affectedOwnerRefs;

  ///APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
  final int consumeWindowSeconds;

  ///RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
  final String expiresAt;
  final String initiatorPrincipalId;
  final String operationId;
  final ApprovalOwnerRequirement ownerRequirement;
  final String parameterHash;
  final String policyId;
  final int policyVersion;
  final ResumeClass? resume;
  final List<RoleRequirementElement> roleRequirements;
  final ApprovalSelfApproval selfApproval;
  final String targetId;
  final String targetType;
  final String tenantId;

  ///TENANT_ONLY 动作缺省
  final String? workspaceId;

  ApprovalWorkflowInput({
    required this.actionDefinitionVersion,
    required this.actionExecutionId,
    required this.actionKey,
    required this.affectedOwnerRefs,
    required this.consumeWindowSeconds,
    required this.expiresAt,
    required this.initiatorPrincipalId,
    required this.operationId,
    required this.ownerRequirement,
    required this.parameterHash,
    required this.policyId,
    required this.policyVersion,
    this.resume,
    required this.roleRequirements,
    required this.selfApproval,
    required this.targetId,
    required this.targetType,
    required this.tenantId,
    this.workspaceId,
  });

  factory ApprovalWorkflowInput.fromJson(
    Map<String, dynamic> json,
  ) => ApprovalWorkflowInput(
    actionDefinitionVersion: json["actionDefinitionVersion"],
    actionExecutionId: json["actionExecutionId"],
    actionKey: json["actionKey"],
    affectedOwnerRefs: List<AffectedOwnerRefElement>.from(
      json["affectedOwnerRefs"].map((x) => AffectedOwnerRefElement.fromJson(x)),
    ),
    consumeWindowSeconds: json["consumeWindowSeconds"],
    expiresAt: json["expiresAt"],
    initiatorPrincipalId: json["initiatorPrincipalId"],
    operationId: json["operationId"],
    ownerRequirement:
        approvalOwnerRequirementValues.map[json["ownerRequirement"]]!,
    parameterHash: json["parameterHash"],
    policyId: json["policyId"],
    policyVersion: json["policyVersion"],
    resume: json["resume"] == null
        ? null
        : ResumeClass.fromJson(json["resume"]),
    roleRequirements: List<RoleRequirementElement>.from(
      json["roleRequirements"].map((x) => RoleRequirementElement.fromJson(x)),
    ),
    selfApproval: approvalSelfApprovalValues.map[json["selfApproval"]]!,
    targetId: json["targetId"],
    targetType: json["targetType"],
    tenantId: json["tenantId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionDefinitionVersion": actionDefinitionVersion,
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "affectedOwnerRefs": List<dynamic>.from(
      affectedOwnerRefs.map((x) => x.toJson()),
    ),
    "consumeWindowSeconds": consumeWindowSeconds,
    "expiresAt": expiresAt,
    "initiatorPrincipalId": initiatorPrincipalId,
    "operationId": operationId,
    "ownerRequirement":
        approvalOwnerRequirementValues.reverse[ownerRequirement],
    "parameterHash": parameterHash,
    "policyId": policyId,
    "policyVersion": policyVersion,
    "resume": resume?.toJson(),
    "roleRequirements": List<dynamic>.from(
      roleRequirements.map((x) => x.toJson()),
    ),
    "selfApproval": approvalSelfApprovalValues.reverse[selfApproval],
    "targetId": targetId,
    "targetType": targetType,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

///请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
class AffectedOwnerRefElement {
  final String ownerPrincipalId;
  final String targetId;
  final String targetType;
  final int targetVersion;

  AffectedOwnerRefElement({
    required this.ownerPrincipalId,
    required this.targetId,
    required this.targetType,
    required this.targetVersion,
  });

  factory AffectedOwnerRefElement.fromJson(Map<String, dynamic> json) =>
      AffectedOwnerRefElement(
        ownerPrincipalId: json["ownerPrincipalId"],
        targetId: json["targetId"],
        targetType: json["targetType"],
        targetVersion: json["targetVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "ownerPrincipalId": ownerPrincipalId,
    "targetId": targetId,
    "targetType": targetType,
    "targetVersion": targetVersion,
  });
}

///ApprovalPolicy.owner_requirement（.design/03 §4）。
enum ApprovalOwnerRequirement { ALL_AFFECTED_OWNERS, NONE, TARGET_OWNER }

final approvalOwnerRequirementValues = EnumValues({
  "ALL_AFFECTED_OWNERS": ApprovalOwnerRequirement.ALL_AFFECTED_OWNERS,
  "NONE": ApprovalOwnerRequirement.NONE,
  "TARGET_OWNER": ApprovalOwnerRequirement.TARGET_OWNER,
});

///ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
///才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
class ResumeClass {
  ///RFC3339，UTC
  final String? consumedAt;

  ///RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
  final String? consumeDeadline;
  final List<DecisionElement> decisions;

  ///此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
  ///从零数起，不加上它续跑后的投影会被当成旧事件丢掉
  final int eventBase;
  final ReasonCode? reason;
  final List<RefusalElement> refusals;
  final ApprovalStatus status;

  ResumeClass({
    this.consumedAt,
    this.consumeDeadline,
    required this.decisions,
    required this.eventBase,
    this.reason,
    required this.refusals,
    required this.status,
  });

  factory ResumeClass.fromJson(Map<String, dynamic> json) => ResumeClass(
    consumedAt: json["consumedAt"],
    consumeDeadline: json["consumeDeadline"],
    decisions: List<DecisionElement>.from(
      json["decisions"].map((x) => DecisionElement.fromJson(x)),
    ),
    eventBase: json["eventBase"],
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    refusals: List<RefusalElement>.from(
      json["refusals"].map((x) => RefusalElement.fromJson(x)),
    ),
    status: approvalStatusValues.map[json["status"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "consumedAt": consumedAt,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "eventBase": eventBase,
    "reason": reasonCodeValues.reverse[reason],
    "refusals": List<dynamic>.from(refusals.map((x) => x.toJson())),
    "status": approvalStatusValues.reverse[status],
  });
}

///一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
///§4）。
class RefusalElement {
  final String approverPrincipalId;
  final ReasonCode reason;

  RefusalElement({required this.approverPrincipalId, required this.reason});

  factory RefusalElement.fromJson(Map<String, dynamic> json) => RefusalElement(
    approverPrincipalId: json["approverPrincipalId"],
    reason: reasonCodeValues.map[json["reason"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "reason": reasonCodeValues.reverse[reason],
  });
}

///ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
enum ApprovalSelfApproval { ALLOW, DENY }

final approvalSelfApprovalValues = EnumValues({
  "ALLOW": ApprovalSelfApproval.ALLOW,
  "DENY": ApprovalSelfApproval.DENY,
});

///invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
///<action_execution_id>:invalidate。
class ApprovalInvalidateUpdate {
  final ReasonCode reason;

  ApprovalInvalidateUpdate({required this.reason});

  factory ApprovalInvalidateUpdate.fromJson(Map<String, dynamic> json) =>
      ApprovalInvalidateUpdate(reason: reasonCodeValues.map[json["reason"]]!);

  Map<String, dynamic> toJson() =>
      _stripNulls({"reason": reasonCodeValues.reverse[reason]});
}

///一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
///§4）。
class ApprovalRefusal {
  final String approverPrincipalId;
  final ReasonCode reason;

  ApprovalRefusal({required this.approverPrincipalId, required this.reason});

  factory ApprovalRefusal.fromJson(Map<String, dynamic> json) =>
      ApprovalRefusal(
        approverPrincipalId: json["approverPrincipalId"],
        reason: reasonCodeValues.map[json["reason"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "reason": reasonCodeValues.reverse[reason],
  });
}

///ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
///才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
class ApprovalResume {
  ///RFC3339，UTC
  final String? consumedAt;

  ///RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
  final String? consumeDeadline;
  final List<DecisionElement> decisions;

  ///此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
  ///从零数起，不加上它续跑后的投影会被当成旧事件丢掉
  final int eventBase;
  final ReasonCode? reason;
  final List<RefusalElement> refusals;
  final ApprovalStatus status;

  ApprovalResume({
    this.consumedAt,
    this.consumeDeadline,
    required this.decisions,
    required this.eventBase,
    this.reason,
    required this.refusals,
    required this.status,
  });

  factory ApprovalResume.fromJson(Map<String, dynamic> json) => ApprovalResume(
    consumedAt: json["consumedAt"],
    consumeDeadline: json["consumeDeadline"],
    decisions: List<DecisionElement>.from(
      json["decisions"].map((x) => DecisionElement.fromJson(x)),
    ),
    eventBase: json["eventBase"],
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    refusals: List<RefusalElement>.from(
      json["refusals"].map((x) => RefusalElement.fromJson(x)),
    ),
    status: approvalStatusValues.map[json["status"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "consumedAt": consumedAt,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "eventBase": eventBase,
    "reason": reasonCodeValues.reverse[reason],
    "refusals": List<dynamic>.from(refusals.map((x) => x.toJson())),
    "status": approvalStatusValues.reverse[status],
  });
}

///ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
///§4）。
class ApprovalRoleRequirement {
  final int minDistinct;
  final ApprovalSelector selector;

  ApprovalRoleRequirement({required this.minDistinct, required this.selector});

  factory ApprovalRoleRequirement.fromJson(Map<String, dynamic> json) =>
      ApprovalRoleRequirement(
        minDistinct: json["minDistinct"],
        selector: approvalSelectorValues.map[json["selector"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "minDistinct": minDistinct,
    "selector": approvalSelectorValues.reverse[selector],
  });
}

///ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
///eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
class ApprovalStateReport {
  ///RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
  final String? consumedAt;

  ///RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
  final String? consumeDeadline;
  final List<DecisionElement> decisions;

  ///报告时跨 run 累计的 history 长度
  final int eventId;

  ///RFC3339，UTC
  final String expiresAt;

  ///INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
  final ReasonCode? reason;
  final String runId;
  final ApprovalStatus status;
  final String workflowId;

  ApprovalStateReport({
    this.consumedAt,
    this.consumeDeadline,
    required this.decisions,
    required this.eventId,
    required this.expiresAt,
    this.reason,
    required this.runId,
    required this.status,
    required this.workflowId,
  });

  factory ApprovalStateReport.fromJson(Map<String, dynamic> json) =>
      ApprovalStateReport(
        consumedAt: json["consumedAt"],
        consumeDeadline: json["consumeDeadline"],
        decisions: List<DecisionElement>.from(
          json["decisions"].map((x) => DecisionElement.fromJson(x)),
        ),
        eventId: json["eventId"],
        expiresAt: json["expiresAt"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        runId: json["runId"],
        status: approvalStatusValues.map[json["status"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "consumedAt": consumedAt,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "eventId": eventId,
    "expiresAt": expiresAt,
    "reason": reasonCodeValues.reverse[reason],
    "runId": runId,
    "status": approvalStatusValues.reverse[status],
    "workflowId": workflowId,
  });
}

///FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
///选择器 permission、owner 对账与职责分离由 Core 判定。
class FreshApprovalAdmissionRequest {
  final String approvalWorkflowId;
  final String approverPrincipalId;
  final ApprovalDecision decision;

  FreshApprovalAdmissionRequest({
    required this.approvalWorkflowId,
    required this.approverPrincipalId,
    required this.decision,
  });

  factory FreshApprovalAdmissionRequest.fromJson(Map<String, dynamic> json) =>
      FreshApprovalAdmissionRequest(
        approvalWorkflowId: json["approvalWorkflowId"],
        approverPrincipalId: json["approverPrincipalId"],
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approvalWorkflowId": approvalWorkflowId,
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
  });
}

///FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
///pre-history 拒绝。
class FreshApprovalAdmissionResult {
  final bool admitted;
  final ReasonCode? reason;
  final List<ApprovalSelector> satisfiedSelectors;

  FreshApprovalAdmissionResult({
    required this.admitted,
    this.reason,
    required this.satisfiedSelectors,
  });

  factory FreshApprovalAdmissionResult.fromJson(Map<String, dynamic> json) =>
      FreshApprovalAdmissionResult(
        admitted: json["admitted"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        satisfiedSelectors: List<ApprovalSelector>.from(
          json["satisfiedSelectors"].map((x) => approvalSelectorValues.map[x]!),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitted": admitted,
    "reason": reasonCodeValues.reverse[reason],
    "satisfiedSelectors": List<dynamic>.from(
      satisfiedSelectors.map((x) => approvalSelectorValues.reverse[x]),
    ),
  });
}

class EnumValues<T> {
  Map<String, T> map;
  late Map<T, String> reverseMap;

  EnumValues(this.map);

  Map<T, String> get reverse {
    reverseMap = map.map((k, v) => MapEntry(v, k));
    return reverseMap;
  }
}

/// 去掉值为 null 的键。缺省的可选字段必须在线格式中省略而不是写成 null——
/// schema 未把 null 列入这些字段的类型，且可用子集禁止联合类型。
/// 由 tools/gen.sh 在生成后注入，不手工编辑。
Map<String, dynamic> _stripNulls(Map<String, dynamic> m) =>
    Map<String, dynamic>.fromEntries(m.entries.where((e) => e.value != null));
