// Generated from client-kit/ts/platform/src/i18n.ts by tools/gen-platform-i18n.py.
// Do not edit. Message keys and translations have one TypeScript source.
import 'dart:io' show Platform;

import '../contracts/contracts.dart';

enum PlatformMessageKey {
  platformTitle,
  platformWorkspace,
  platformWorkspaces,
  workspaceCreateTitle,
  workspaceCreateName,
  workspaceCreateSlug,
  workspaceCreateSlugHint,
  workspaceCreateRecorded,
  workspaceCreateUnknown,
  workspaceCreateRetry,
  workspaceCreateInFlight,
  workspaceCreateInFlightItem,
  workspaceCreateInFlightUnavailable,
  workspaceLifecycleSuspend,
  workspaceLifecycleRestore,
  workspaceLifecycleConfirmSuspend,
  workspaceLifecycleConfirmRestore,
  workspaceLifecycleRecorded,
  workspaceLifecycleUnknown,
  workspaceLifecycleAborted,
  workspaceLifecycleRejected,
  workspaceLifecycleRetry,
  tenantsTitle,
  tenantsNone,
  tenantsName,
  tenantsSlug,
  tenantsSuspend,
  tenantsRestore,
  tenantsConfirmSuspend,
  tenantsConfirmRestore,
  platformTabMembers,
  platformTabAgents,
  agentsNone,
  agentsDefinitionOnly,
  agentsName,
  agentsSlug,
  agentsOwner,
  agentsResourceVersion,
  agentsPublishedVersion,
  agentsNoPublishedVersion,
  agentsDefinitionReady,
  agentsOpen,
  agentsCreate,
  agentsUpdate,
  agentsTransfer,
  agentsNewOwner,
  agentsOwnerHint,
  agentsReview,
  agentsConfirm,
  agentsCancel,
  agentsRetry,
  agentsPreviewCreate,
  agentsPreviewUpdate,
  agentsPreviewTransfer,
  agentsAdmission,
  agentsRecorded,
  agentsUnknown,
  agentsInFlight,
  agentsInFlightUnavailable,
  agentsVersionPublished,
  agentsVersionOrdinal,
  agentsVersionRuntimeProfile,
  agentsInstallationTitle,
  agentsInstallationReadOnly,
  agentsInstallationNone,
  agentsInstallationNoWorkspace,
  agentsInstallationId,
  agentsInstallationDefinition,
  agentsInstallationVersion,
  agentsInstallationPrincipal,
  agentsInstallationOpen,
  agentsInstallationProjection,
  agentsInstallationGeneration,
  agentsInstallationActiveGeneration,
  agentsInstallationNotRecorded,
  agentsInstallationChannel,
  agentsInstallationTriggers,
  agentsInstallationTriggerMention,
  agentsInstallationTriggerManual,
  agentsInstallationStateProvisioning,
  agentsInstallationStateActive,
  agentsInstallationStateDraining,
  agentsInstallationStateDisabled,
  agentsInstallationStateError,
  agentsInstallationProjectionPending,
  agentsInstallationProjectionActive,
  agentsInstallationProjectionError,
  agentsInstallationProjectionRevoked,
  agentsInstallationPrincipalActive,
  agentsInstallationPrincipalDisabled,
  agentsInstallationChannelActive,
  agentsInstallationChannelDisabled,
  agentsInstallationChannelError,
  agentsInstallationResourceProvisioning,
  agentsInstallationResourceActive,
  agentsInstallationResourceUnknown,
  agentsInstallationResourceFailed,
  agentsInstallationResourceRetained,
  agentsInstallationResourceDeleting,
  agentsInstallationResourceDeleted,
  agentsVersionModelRoute,
  agentsVersionInstructions,
  agentsVersionHash,
  platformTabAudit,
  platformTabDevices,
  platformTabTasks,
  platformTabApprovals,
  platformSignOut,
  platformSessionUnavailable,
  platformLoading,
  platformLoadingWorkspaces,
  platformNoWorkspace,
  platformLoadFailed,
  platformRetry,
  platformMember,
  platformState,
  platformProtocolIdentity,
  platformTime,
  platformTimeUnavailable,
  platformTimeNow,
  platformTimeAbsolute,
  platformTimePastSecondOne,
  platformTimePastSecondOther,
  platformTimeFutureSecondOne,
  platformTimeFutureSecondOther,
  platformTimePastMinuteOne,
  platformTimePastMinuteOther,
  platformTimeFutureMinuteOne,
  platformTimeFutureMinuteOther,
  platformTimePastHourOne,
  platformTimePastHourOther,
  platformTimeFutureHourOne,
  platformTimeFutureHourOther,
  platformTimePastDayOne,
  platformTimePastDayOther,
  platformTimeFutureDayOne,
  platformTimeFutureDayOther,
  platformTimePastMonthOne,
  platformTimePastMonthOther,
  platformTimeFutureMonthOne,
  platformTimeFutureMonthOther,
  chatTimeToday,
  chatTimeYesterday,
  chatTimeJustNow,
  chatTimeAt,
  chatTimeWeekdayDate,
  chatTimeOn,
  chatTimeLastReply,
  chatThreadReplyCountOne,
  chatThreadReplyCountOther,
  chatThreadUnreadCount,
  chatThreadView,
  chatThreadAriaOpen,
  chatThreadAriaOpenLast,
  platformType,
  platformAction,
  platformResult,
  platformAuditNone,
  platformAuditMyTitle,
  platformAuditScopeTitle,
  platformAuditScopeExplain,
  platformAuditScopeSelect,
  platformAuditScopeTenant,
  platformAuditScopeTenantDenied,
  platformAuditScopeChooseWorkspace,
  platformAuditScopeWorkspacesFailed,
  platformAuditScopeDenied,
  platformAuditScopeNone,
  platformAuditScopeLoadMore,
  platformAuditScopeEvidence,
  platformAuditScopeTenantLevel,
  platformAuditScopeUnrecognizedKind,
  platformAuditScopeRestricted,
  platformAuditScopeVersion,
  platformAuditScopeUnavailable,
  platformAuditScopeNotFound,
  platformAuditScopeUnavailableUnknown,
  platformMembersNone,
  platformMembersCountOne,
  platformMembersCountOther,
  platformMembersKeyCountOne,
  platformMembersKeyCountOther,
  rolesTitle,
  rolesNone,
  rolesTenant,
  rolesWorkspace,
  rolesGrant,
  rolesRevoke,
  rolesLastAdmin,
  rolesSubmitted,
  rolesUnknown,
  rolesRejected,
  rolesConfirm,
  rolesScopeTenantOnly,
  rolesNext,
  rolesPrevious,
  secretRehomeTitle,
  secretRehomeExplain,
  secretRehomeNone,
  secretRehomeKind,
  secretRehomePubkey,
  secretRehomeMove,
  secretRehomeConfirm,
  secretRehomeSubmitted,
  secretRehomeUnknown,
  secretRehomeRejected,
  platformDevicesNone,
  platformDevicesExplain,
  platformDevicesAdded,
  platformDevicesThisDevice,
  platformDevicesRevoke,
  platformDevicesMyTitle,
  platformDevicesRegistered,
  platformDevicesRegisteredAt,
  platformDevicesRevokeTitle,
  platformDevicesRevokeThisConfirm,
  platformDevicesRevokeOtherConfirm,
  platformDevicesStateAfterRevoke,
  platformDevicesRevokeUnknown,
  platformDevicesRevokeRejected,
  platformNotMember,
  platformRefresh,
  platformBack,
  platformConfirm,
  platformCancel,
  platformSettingsOrganization,
  platformSettingsClose,
  platformSettingsAppearance,
  platformSettingsTheme,
  platformThemeAppearanceDescription,
  platformThemeStyleDescription,
  platformThemeModeLight,
  platformThemeModeDark,
  platformThemeModeSystem,
  platformThemeAccentColor,
  platformThemeAccentNeutral,
  platformThemeAccentBlue,
  platformThemeAccentCyan,
  platformThemeAccentGreen,
  platformThemeAccentOrange,
  platformThemeAccentRed,
  platformThemeAccentPink,
  platformThemeAccentLilac,
  platformThemeAccentPurple,
  platformThemeAccentIndigo,
  platformThemeHomePreview,
  platformThemeChatPreview,
  platformThemeClosePreview,
  platformThemeApply,
  platformThemeAppearanceCycle,
  platformThemeScrubber,
  platformThemeCommunitySample,
  platformSettingsConnection,
  platformSettingsCopyDeviceKey,
  platformSettingsIdentityUnavailable,
  platformSettingsDeviceKey,
  platformSettingsKeyCopied,
  platformSettingsSignOutConfirm,
  platformReasonWithCode,
  tasksNone,
  tasksTitle,
  tasksMyTitle,
  tasksCreated,
  tasksOperation,
  tasksExecution,
  tasksTarget,
  tasksWorkflow,
  tasksWaitingReason,
  tasksReason,
  tasksApproval,
  tasksCancelRequest,
  tasksConfirmCancel,
  tasksCancelSubmitted,
  tasksCancelUnknown,
  tasksCancelSendAgain,
  tasksCancelRejected,
  tasksRerunRequest,
  tasksConfirmRerun,
  tasksRerunSubmitted,
  tasksRerunUnknown,
  tasksRerunRejected,
  tasksStatusEvaluating,
  tasksStatusWaitingApproval,
  tasksStatusDenied,
  tasksStatusRevoked,
  tasksStatusExpired,
  tasksStatusNotStarted,
  tasksStatusAborted,
  tasksStatusStarted,
  tasksStatusApplied,
  tasksStatusCancelRequestAccepted,
  tasksStatusRunning,
  tasksStatusCompleted,
  tasksStatusFailed,
  tasksStatusCanceled,
  tasksStatusTerminated,
  tasksStatusTimedOut,
  tasksStatusUnknown,
  tasksStatusDelayed,
  approvalsNone,
  approvalsPendingTitle,
  approvalsMobileReadOnly,
  approvalsExpiresAt,
  approvalsStatus,
  approvalsExpires,
  approvalsInitiator,
  approvalsRequirements,
  approvalsRequirement,
  approvalsDecisions,
  approvalsNoDecisions,
  approvalsApprove,
  approvalsDeny,
  approvalsConfirmDecision,
  approvalsDecided,
  approvalsDecisionUnknown,
  approvalsSendAgain,
  approvalsDecisionRejected,
  approvalsWithdraw,
  approvalsConfirmWithdraw,
  approvalsWithdrawn,
  approvalsWithdrawUnknown,
  approvalsWithdrawRejected,
  invitationsTitle,
  invitationsExplain,
  invitationsInviteeLabel,
  invitationsInviteeHint,
  invitationsIssue,
  invitationsIssued,
  invitationsCopy,
  invitationsCopied,
  invitationsNoLink,
  invitationsIssueUnknown,
  invitationsIssueRejected,
  invitationsNone,
  invitationsInvitee,
  invitationsRedeemer,
  invitationsConfirmation,
  invitationsWithdraw,
  invitationsConfirmWithdraw,
  invitationsWithdrawUnknown,
  invitationsWithdrawRejected,
  invitationsForApproval,
  redeemTitle,
  redeemExplain,
  redeemDisplayName,
  redeemSubmit,
  redeemNoCredential,
  redeemUnknown,
  redeemAgain,
  redeemRejected,
  redeemMine,
  redeemWaiting,
  redeemEvaluating,
  redeemProvisioning,
  redeemActive,
  redeemEnded,
  redeemOther,
  redeemContinue,
  redeemNativeHint,
  nativeConfigTitle,
  nativeConfigExplain,
  nativeConfigNativeApiUrl,
  nativeConfigOidcIssuer,
  nativeConfigOidcClientId,
  nativeConfigServer,
  nativeConfigInvalidUrl,
  nativeConfigInvalidScheme,
  nativeConfigInvalidExtras,
  nativeConfigInvalidUserInfo,
  nativeConfigClientIdRequired,
  nativeConfigSave,
  nativeConfigSaving,
  nativeConfigEdit,
  nativeConfigRejected,
  nativeSignInTitle,
  nativeSignInTitleNamed,
  nativeSignInExplain,
  nativeSignInStart,
  nativeSignInWaiting,
  nativeSignInCancel,
  nativeSignInFailed,
  nativeStatusUnconfigured,
  nativeStatusSignedOut,
  nativeStatusAwaitingActivation,
  nativeStatusLinked,
  nativeRelayConnected,
  nativeRelayWaiting,
  nativeRelayConnecting,
  nativeRelayHelperPrompt,
  nativeRelayReconnecting,
  nativeRelayConnect,
  nativeRelayClickToConnect,
  nativeRelayDismissNotification,
  nativeRelayUnreachable,
  nativeStatusFailed,
  nativeStatusOutcomeUnknown,
  nativeErrorHttpOutcomeUnknown,
  nativeErrorUnavailable,
  nativeErrorContract,
  nativeErrorSessionEnded,
  nativeErrorSignInAgain,
  nativeUnavailableTitle,
  nativeDeviceRegistering,
  nativeDevicePending,
  nativeDeviceUnknown,
  nativeDeviceRejected,
  nativeDeviceRevoked,
  nativeDeviceCheck,
  nativeCommunityLoading,
  nativeCommunityFailed,
  nativeConnectFailed,
}

const _messages = <PlatformMessageKey, (String, String)>{
  PlatformMessageKey.platformTitle: ('Platform', '平台'),
  PlatformMessageKey.platformWorkspace: ('Workspace', '工作区'),
  PlatformMessageKey.platformWorkspaces: ('Workspaces', '工作区'),
  PlatformMessageKey.workspaceCreateTitle: ('Create workspace', '创建工作区'),
  PlatformMessageKey.workspaceCreateName: ('Workspace name', '工作区名称'),
  PlatformMessageKey.workspaceCreateSlug: ('Workspace identifier', '工作区标识'),
  PlatformMessageKey.workspaceCreateSlugHint: (
    'Use lowercase English letters, digits and hyphens; start with a letter or digit.',
    '使用小写英文字母、数字和连字符，以字母或数字开头。',
  ),
  PlatformMessageKey.workspaceCreateRecorded: (
    'Request recorded, not confirmed complete. Check Tasks for the outcome, then refresh your workspace list. Execution: {execution}; operation: {operation}; admission: {gate}; dispatch: {dispatch}.',
    '请求已登记，不代表创建完成。请到任务页查看结果，完成后刷新工作区列表。执行：{execution}；操作：{operation}；准入：{gate}；派发：{dispatch}。',
  ),
  PlatformMessageKey.workspaceCreateUnknown: (
    'The result is unknown. Retry only this same request; do not start a new creation. Operation: {operation}.',
    '结果不明。只能重查原请求，不要另发一笔创建。操作：{operation}。',
  ),
  PlatformMessageKey.workspaceCreateRetry: ('Retry same request', '重查原请求'),
  PlatformMessageKey.workspaceCreateInFlight: (
    'Creations still in progress',
    '进行中的创建',
  ),
  PlatformMessageKey.workspaceCreateInFlightItem: (
    '{status} · operation {operation}',
    '{status} · 操作 {operation}',
  ),
  PlatformMessageKey.workspaceCreateInFlightUnavailable: (
    'Could not check creations in progress. Check Tasks before creating again.',
    '无法读取进行中的创建。再次创建前请先到任务页确认。',
  ),
  PlatformMessageKey.workspaceLifecycleSuspend: ('Suspend', '暂停'),
  PlatformMessageKey.workspaceLifecycleRestore: ('Restore', '恢复'),
  PlatformMessageKey.workspaceLifecycleConfirmSuspend: (
    'Suspend workspace {name}? Members cannot enter it until it is restored; its content, owners and permissions are kept. The final result is shown in Tasks.',
    '暂停工作区 {name}？恢复前成员无法进入，其中的内容、所有者与权限都保留。最终结果请到任务页查看。',
  ),
  PlatformMessageKey.workspaceLifecycleConfirmRestore: (
    'Restore workspace {name}? It reopens only after reconciliation completes. The final result is shown in Tasks.',
    '恢复工作区 {name}？对账完成后才重新开放。最终结果请到任务页查看。',
  ),
  PlatformMessageKey.workspaceLifecycleRecorded: (
    'Request recorded; this does not mean it has finished. Check Tasks for the result. Operation: {operation}.',
    '请求已登记，不代表已完成。请到任务页查看结果。操作：{operation}。',
  ),
  PlatformMessageKey.workspaceLifecycleUnknown: (
    'Result unknown. Only re-check the same request; do not submit another. Operation: {operation}.',
    '结果不明。只能重查原请求，不要另发一笔。操作：{operation}。',
  ),
  PlatformMessageKey.workspaceLifecycleAborted: (
    'Request recorded but not carried out ({reason}). Operation: {operation}.',
    '请求已登记但未执行（{reason}）。操作：{operation}。',
  ),
  PlatformMessageKey.workspaceLifecycleRejected: (
    'Request rejected: {reason}',
    '请求被拒绝：{reason}',
  ),
  PlatformMessageKey.workspaceLifecycleRetry: ('Retry same request', '重查原请求'),
  PlatformMessageKey.tenantsTitle: ('Organizations', '组织'),
  PlatformMessageKey.tenantsNone: ('No organizations on this page.', '本页没有组织。'),
  PlatformMessageKey.tenantsName: ('Organization', '组织'),
  PlatformMessageKey.tenantsSlug: ('Identifier', '标识'),
  PlatformMessageKey.tenantsSuspend: ('Suspend', '暂停'),
  PlatformMessageKey.tenantsRestore: ('Restore', '恢复'),
  PlatformMessageKey.tenantsConfirmSuspend: (
    'Suspend organization {name} ({slug})? All its members lose access at once and every connection to its collaboration space is closed; its content, owners, permissions and keys are kept. The final result is shown in Tasks.',
    '暂停组织 {name}（{slug}）？其全部成员立即失去访问，协作空间的全部连接被断开；内容、所有者、权限与密钥都保留。最终结果请到任务页查看。',
  ),
  PlatformMessageKey.tenantsConfirmRestore: (
    'Restore organization {name} ({slug})? It reopens only after reconciliation completes. The final result is shown in Tasks.',
    '恢复组织 {name}（{slug}）？对账完成后才重新开放。最终结果请到任务页查看。',
  ),
  PlatformMessageKey.platformTabMembers: ('Members', '成员'),
  PlatformMessageKey.platformTabAgents: ('Agents', 'Agent'),
  PlatformMessageKey.agentsNone: (
    'No definitions visible on this page.',
    '本页没有可见的定义。',
  ),
  PlatformMessageKey.agentsDefinitionOnly: (
    'Manage stable definitions and read published versions here. Creating a definition does not publish, install or run an agent.',
    '此处管理稳定定义并读取已发布版本。创建定义不等于发布、安装或运行 Agent。',
  ),
  PlatformMessageKey.agentsName: ('Display name', '显示名'),
  PlatformMessageKey.agentsSlug: ('Stable identifier', '稳定标识'),
  PlatformMessageKey.agentsOwner: ('Owner', '所有者'),
  PlatformMessageKey.agentsResourceVersion: ('Resource version', '资源版本'),
  PlatformMessageKey.agentsPublishedVersion: ('Published version', '已发布版本'),
  PlatformMessageKey.agentsNoPublishedVersion: (
    'No published version.',
    '尚无已发布版本。',
  ),
  PlatformMessageKey.agentsDefinitionReady: ('Definition ready', '定义就绪'),
  PlatformMessageKey.agentsOpen: ('View definition', '查看定义'),
  PlatformMessageKey.agentsCreate: ('Create definition', '创建定义'),
  PlatformMessageKey.agentsUpdate: ('Change display name', '修改显示名'),
  PlatformMessageKey.agentsTransfer: ('Transfer ownership', '转移所有权'),
  PlatformMessageKey.agentsNewOwner: (
    'New owner\'s principal ID',
    '新所有者的 Principal ID',
  ),
  PlatformMessageKey.agentsOwnerHint: (
    'Select an active human member of this organization. Core checks membership and permission again; ownership transfer requires another organization administrator\'s approval.',
    '请选择本组织的有效 HUMAN 成员。Core 会重新核对成员资格与权限；所有权转移需要另一位组织管理员审批。',
  ),
  PlatformMessageKey.agentsReview: ('Review request', '核对请求'),
  PlatformMessageKey.agentsConfirm: ('Submit governed request', '提交受治理请求'),
  PlatformMessageKey.agentsCancel: ('Cancel request', '取消请求'),
  PlatformMessageKey.agentsRetry: ('Re-check same request', '重查原请求'),
  PlatformMessageKey.agentsPreviewCreate: (
    'Create the stable definition {name} ({slug}) owned by your current human identity. No version, installation, permission grant or runtime is created.',
    '创建稳定定义 {name}（{slug}），由当前 HUMAN 身份负责。不创建版本、安装、授权或运行时。',
  ),
  PlatformMessageKey.agentsPreviewUpdate: (
    'Change only the display name of {resource} at resource version {version} to {name}. Published version content and installations are unchanged.',
    '仅将资源 {resource} 的版本 {version} 的显示名改为 {name}。已发布版本正文与安装均不改变。',
  ),
  PlatformMessageKey.agentsPreviewTransfer: (
    'Transfer definition {resource} at resource version {version} from {owner} to {next}. Approval is required. No agent version or installation is created.',
    '将定义 {resource} 的资源版本 {version} 的所有者从 {owner} 转给 {next}。需要审批，不创建 Agent 版本或安装。',
  ),
  PlatformMessageKey.agentsAdmission: (
    'Core rechecks scope, permission, approval, quota and capacity according to the registered action policy. A request is not a runtime authorization.',
    'Core 按登记的动作策略重查 scope、权限、审批、额度与容量。提交请求不构成运行授权。',
  ),
  PlatformMessageKey.agentsRecorded: (
    'Request recorded. Check Tasks for its outcome and Approvals for ownership transfer. Execution: {execution}; operation: {operation}.',
    '请求已登记。请到任务页查看结果；所有权转移可到审批页查看。执行：{execution}；操作：{operation}。',
  ),
  PlatformMessageKey.agentsUnknown: (
    'Outcome is not confirmed. Re-check only this same request or inspect Tasks; do not submit a replacement. Operation: {operation}.',
    '结果尚未确认。只能重查原请求或到任务页查证，不要另发一笔。操作：{operation}。',
  ),
  PlatformMessageKey.agentsInFlight: (
    'Existing definition requests in progress',
    '仍在进行的定义请求',
  ),
  PlatformMessageKey.agentsInFlightUnavailable: (
    'Could not confirm existing requests. Refresh this view or inspect Tasks; new requests remain blocked until confirmation.',
    '无法确认已有请求。请刷新本页或到任务页查证；完成查证前不能另发请求。',
  ),
  PlatformMessageKey.agentsVersionPublished: ('Published', '已发布'),
  PlatformMessageKey.agentsVersionOrdinal: ('Version number', '版本序号'),
  PlatformMessageKey.agentsVersionRuntimeProfile: (
    'Requested runtime profile',
    '声明的运行配置',
  ),
  PlatformMessageKey.agentsInstallationTitle: (
    'Workspace installations',
    '工作区安装',
  ),
  PlatformMessageKey.agentsInstallationReadOnly: (
    'Read-only installation records. An active record or projection is not proof that a process is currently healthy or that an invocation is authorized.',
    '只读安装记录。安装或投影处于 ACTIVE 不证明进程此刻健康，也不代表某次调用已获授权。',
  ),
  PlatformMessageKey.agentsInstallationNone: (
    'No installations you may read on this page.',
    '本页没有你可读取的安装。',
  ),
  PlatformMessageKey.agentsInstallationNoWorkspace: (
    'No active workspace is available to this identity.',
    '当前身份没有可进入的 ACTIVE 工作区。',
  ),
  PlatformMessageKey.agentsInstallationId: ('Installation', '安装'),
  PlatformMessageKey.agentsInstallationDefinition: (
    'Definition reference',
    '定义引用',
  ),
  PlatformMessageKey.agentsInstallationVersion: (
    'Exact version reference',
    '精确版本引用',
  ),
  PlatformMessageKey.agentsInstallationPrincipal: (
    'Agent identity',
    'Agent 身份',
  ),
  PlatformMessageKey.agentsInstallationOpen: ('View installation', '查看安装'),
  PlatformMessageKey.agentsInstallationProjection: (
    'Recorded runtime projection',
    '已记录的运行投影',
  ),
  PlatformMessageKey.agentsInstallationGeneration: (
    'Projection generation',
    '投影代数',
  ),
  PlatformMessageKey.agentsInstallationActiveGeneration: (
    'Active generation pointer',
    'ACTIVE 代数指针',
  ),
  PlatformMessageKey.agentsInstallationNotRecorded: (
    'Not recorded; readiness is not confirmed.',
    '尚未记录，未确认就绪。',
  ),
  PlatformMessageKey.agentsInstallationChannel: ('Channel binding', '频道绑定'),
  PlatformMessageKey.agentsInstallationTriggers: (
    'Configured triggers',
    '已配置的触发方式',
  ),
  PlatformMessageKey.agentsInstallationTriggerMention: ('Mention', '提及'),
  PlatformMessageKey.agentsInstallationTriggerManual: (
    'Manual assignment',
    '手工指派',
  ),
  PlatformMessageKey.agentsInstallationStateProvisioning: (
    'Being installed',
    '正在安装',
  ),
  PlatformMessageKey.agentsInstallationStateActive: (
    'Active installation record',
    '安装记录为 ACTIVE',
  ),
  PlatformMessageKey.agentsInstallationStateDraining: ('Draining', '正在排空'),
  PlatformMessageKey.agentsInstallationStateDisabled: ('Disabled', '已停用'),
  PlatformMessageKey.agentsInstallationStateError: ('Needs attention', '需要处理'),
  PlatformMessageKey.agentsInstallationProjectionPending: (
    'Projection pending',
    '投影待收敛',
  ),
  PlatformMessageKey.agentsInstallationProjectionActive: (
    'Active projection record',
    '投影记录为 ACTIVE',
  ),
  PlatformMessageKey.agentsInstallationProjectionError: (
    'Projection needs attention',
    '投影需要处理',
  ),
  PlatformMessageKey.agentsInstallationProjectionRevoked: (
    'Projection revoked',
    '投影已撤销',
  ),
  PlatformMessageKey.agentsInstallationPrincipalActive: (
    'Active identity',
    '身份已启用',
  ),
  PlatformMessageKey.agentsInstallationPrincipalDisabled: (
    'Disabled identity',
    '身份已停用',
  ),
  PlatformMessageKey.agentsInstallationChannelActive: (
    'Enabled channel binding',
    '频道绑定已启用',
  ),
  PlatformMessageKey.agentsInstallationChannelDisabled: (
    'Disabled channel binding',
    '频道绑定已停用',
  ),
  PlatformMessageKey.agentsInstallationChannelError: (
    'Channel binding needs attention',
    '频道绑定需要处理',
  ),
  PlatformMessageKey.agentsInstallationResourceProvisioning: (
    'Resource being provisioned',
    '资源正在建立',
  ),
  PlatformMessageKey.agentsInstallationResourceActive: (
    'Active resource',
    '资源已启用',
  ),
  PlatformMessageKey.agentsInstallationResourceUnknown: (
    'Resource outcome unknown',
    '资源结果不明',
  ),
  PlatformMessageKey.agentsInstallationResourceFailed: (
    'Resource failed',
    '资源失败',
  ),
  PlatformMessageKey.agentsInstallationResourceRetained: (
    'Retained read-only resource',
    '保留的只读资源',
  ),
  PlatformMessageKey.agentsInstallationResourceDeleting: (
    'Resource being deleted',
    '资源正在删除',
  ),
  PlatformMessageKey.agentsInstallationResourceDeleted: (
    'Deleted resource',
    '资源已删除',
  ),
  PlatformMessageKey.agentsVersionModelRoute: (
    'Requested model route',
    '声明的模型路由',
  ),
  PlatformMessageKey.agentsVersionInstructions: ('Instructions', '指令'),
  PlatformMessageKey.agentsVersionHash: ('Configuration hash', '配置摘要'),
  PlatformMessageKey.platformTabAudit: ('Audit', '审计'),
  PlatformMessageKey.platformTabDevices: ('Devices', '设备'),
  PlatformMessageKey.platformTabTasks: ('Tasks', '任务'),
  PlatformMessageKey.platformTabApprovals: ('Approvals', '审批'),
  PlatformMessageKey.platformSignOut: ('Sign out', '退出'),
  PlatformMessageKey.platformSessionUnavailable: (
    'Session unavailable',
    '会话不可用',
  ),
  PlatformMessageKey.platformLoading: ('Loading…', '载入中…'),
  PlatformMessageKey.platformLoadingWorkspaces: (
    'Loading workspaces…',
    '正在载入工作区…',
  ),
  PlatformMessageKey.platformNoWorkspace: (
    'You have no workspace you can enter in this tenant',
    '你在该 Tenant 下还没有可进入的工作区',
  ),
  PlatformMessageKey.platformLoadFailed: (
    'Couldn\'t load this — the result is unknown.',
    '未能载入，结果不明。',
  ),
  PlatformMessageKey.platformRetry: ('Try again', '重试'),
  PlatformMessageKey.platformMember: ('Member', '成员'),
  PlatformMessageKey.platformState: ('State', '状态'),
  PlatformMessageKey.platformProtocolIdentity: ('Protocol identity', '协议身份'),
  PlatformMessageKey.platformTime: ('Time', '时间'),
  PlatformMessageKey.platformTimeUnavailable: ('Time unavailable', '时间不可用'),
  PlatformMessageKey.platformTimeNow: ('now', '现在'),
  PlatformMessageKey.platformTimeAbsolute: (
    '{month}/{day}/{year} {hour}:{minute}',
    '{year}年{month}月{day}日 {hour}:{minute}',
  ),
  PlatformMessageKey.platformTimePastSecondOne: (
    '{count} second ago',
    '{count} 秒前',
  ),
  PlatformMessageKey.platformTimePastSecondOther: (
    '{count} seconds ago',
    '{count} 秒前',
  ),
  PlatformMessageKey.platformTimeFutureSecondOne: (
    'in {count} second',
    '{count} 秒后',
  ),
  PlatformMessageKey.platformTimeFutureSecondOther: (
    'in {count} seconds',
    '{count} 秒后',
  ),
  PlatformMessageKey.platformTimePastMinuteOne: (
    '{count} minute ago',
    '{count} 分钟前',
  ),
  PlatformMessageKey.platformTimePastMinuteOther: (
    '{count} minutes ago',
    '{count} 分钟前',
  ),
  PlatformMessageKey.platformTimeFutureMinuteOne: (
    'in {count} minute',
    '{count} 分钟后',
  ),
  PlatformMessageKey.platformTimeFutureMinuteOther: (
    'in {count} minutes',
    '{count} 分钟后',
  ),
  PlatformMessageKey.platformTimePastHourOne: (
    '{count} hour ago',
    '{count} 小时前',
  ),
  PlatformMessageKey.platformTimePastHourOther: (
    '{count} hours ago',
    '{count} 小时前',
  ),
  PlatformMessageKey.platformTimeFutureHourOne: (
    'in {count} hour',
    '{count} 小时后',
  ),
  PlatformMessageKey.platformTimeFutureHourOther: (
    'in {count} hours',
    '{count} 小时后',
  ),
  PlatformMessageKey.platformTimePastDayOne: ('yesterday', '昨天'),
  PlatformMessageKey.platformTimePastDayOther: (
    '{count} days ago',
    '{count} 天前',
  ),
  PlatformMessageKey.platformTimeFutureDayOne: ('tomorrow', '明天'),
  PlatformMessageKey.platformTimeFutureDayOther: (
    'in {count} days',
    '{count} 天后',
  ),
  PlatformMessageKey.platformTimePastMonthOne: ('last month', '上个月'),
  PlatformMessageKey.platformTimePastMonthOther: (
    '{count} months ago',
    '{count} 个月前',
  ),
  PlatformMessageKey.platformTimeFutureMonthOne: ('next month', '下个月'),
  PlatformMessageKey.platformTimeFutureMonthOther: (
    'in {count} months',
    '{count} 个月后',
  ),
  PlatformMessageKey.chatTimeToday: ('Today', '今天'),
  PlatformMessageKey.chatTimeYesterday: ('Yesterday', '昨天'),
  PlatformMessageKey.chatTimeJustNow: ('just now', '刚刚'),
  PlatformMessageKey.chatTimeAt: ('{day} at {time}', '{day} {time}'),
  PlatformMessageKey.chatTimeWeekdayDate: (
    '{weekday}, {date}',
    '{weekday}，{date}',
  ),
  PlatformMessageKey.chatTimeOn: ('on {date}', '{date}'),
  PlatformMessageKey.chatTimeLastReply: ('last reply {time}', '上次回复{time}'),
  PlatformMessageKey.chatThreadReplyCountOne: ('{count} reply', '{count} 条回复'),
  PlatformMessageKey.chatThreadReplyCountOther: (
    '{count} replies',
    '{count} 条回复',
  ),
  PlatformMessageKey.chatThreadUnreadCount: ('{count} new', '新增 {count} 条'),
  PlatformMessageKey.chatThreadView: ('View thread', '查看话题'),
  PlatformMessageKey.chatThreadAriaOpen: (
    'View thread with {replies}',
    '查看有{replies}的话题',
  ),
  PlatformMessageKey.chatThreadAriaOpenLast: (
    'View thread with {replies}, {lastReply}',
    '查看有{replies}的话题，{lastReply}',
  ),
  PlatformMessageKey.platformType: ('Type', '类型'),
  PlatformMessageKey.platformAction: ('Action', '动作'),
  PlatformMessageKey.platformResult: ('Result', '结果'),
  PlatformMessageKey.platformAuditNone: (
    'No actions recorded yet.',
    '还没有记录到动作。',
  ),
  PlatformMessageKey.platformAuditMyTitle: ('My activity log', '我的活动记录'),
  PlatformMessageKey.platformAuditScopeTitle: ('Scope audit', '范围审计'),
  PlatformMessageKey.platformAuditScopeExplain: (
    'Events in the organization or one workspace. Evidence shows only its kind; open an item to look up its ID.',
    '组织或单个工作区内的审计事件。证据只列种类，点开一项才查询其 ID。',
  ),
  PlatformMessageKey.platformAuditScopeSelect: ('Audit scope', '审计范围'),
  PlatformMessageKey.platformAuditScopeTenant: ('Whole organization', '整个组织'),
  PlatformMessageKey.platformAuditScopeTenantDenied: (
    'You do not have audit permission for the whole organization. Choose a workspace.',
    '你没有整个组织的审计权限，可选择一个工作区。',
  ),
  PlatformMessageKey.platformAuditScopeChooseWorkspace: (
    'Choose a workspace',
    '选择工作区',
  ),
  PlatformMessageKey.platformAuditScopeWorkspacesFailed: (
    'Couldn\'t load workspaces — the list is unknown.',
    '未能载入工作区列表，结果不明。',
  ),
  PlatformMessageKey.platformAuditScopeDenied: (
    'You do not have audit permission for this scope.',
    '你没有该范围的审计权限。',
  ),
  PlatformMessageKey.platformAuditScopeNone: (
    'No events recorded in this scope.',
    '该范围内还没有审计事件。',
  ),
  PlatformMessageKey.platformAuditScopeLoadMore: ('Load more', '加载更多'),
  PlatformMessageKey.platformAuditScopeEvidence: ('Evidence', '证据'),
  PlatformMessageKey.platformAuditScopeTenantLevel: ('Organization', '组织'),
  PlatformMessageKey.platformAuditScopeUnrecognizedKind: (
    'Unrecognized evidence',
    '无法识别的证据',
  ),
  PlatformMessageKey.platformAuditScopeRestricted: ('Restricted', '受限'),
  PlatformMessageKey.platformAuditScopeVersion: (
    'version {version}',
    '版本 {version}',
  ),
  PlatformMessageKey.platformAuditScopeUnavailable: (
    'Unavailable: {reason}',
    '不可用：{reason}',
  ),
  PlatformMessageKey.platformAuditScopeNotFound: (
    'Unavailable: the original record no longer exists.',
    '不可用：原记录已不存在。',
  ),
  PlatformMessageKey.platformAuditScopeUnavailableUnknown: (
    'This evidence is unavailable.',
    '该证据不可用。',
  ),
  PlatformMessageKey.platformMembersNone: (
    'This workspace has no members.',
    '该工作区没有成员。',
  ),
  PlatformMessageKey.platformMembersCountOne: ('{count} member', '{count} 位成员'),
  PlatformMessageKey.platformMembersCountOther: (
    '{count} members',
    '{count} 位成员',
  ),
  PlatformMessageKey.platformMembersKeyCountOne: ('{count} key', '{count} 把密钥'),
  PlatformMessageKey.platformMembersKeyCountOther: (
    '{count} keys',
    '{count} 把密钥',
  ),
  PlatformMessageKey.rolesTitle: ('Administrator roles', '管理员角色'),
  PlatformMessageKey.rolesNone: (
    'No eligible members on this page.',
    '本页没有符合条件的成员。',
  ),
  PlatformMessageKey.rolesTenant: ('Tenant admin', '租户管理员'),
  PlatformMessageKey.rolesWorkspace: ('Workspace admin', '工作区管理员'),
  PlatformMessageKey.rolesGrant: ('Grant', '授予'),
  PlatformMessageKey.rolesRevoke: ('Revoke', '撤销'),
  PlatformMessageKey.rolesLastAdmin: (
    'Cannot revoke the last effective tenant admin (LAST_TENANT_ADMIN).',
    '不能撤销最后一位有效租户管理员（LAST_TENANT_ADMIN）。',
  ),
  PlatformMessageKey.rolesSubmitted: (
    'Action {action} was submitted (execution {execution}). Check Tasks for its final result.',
    '动作 {action} 已提交（执行 {execution}）。请到任务页确认最终结果。',
  ),
  PlatformMessageKey.rolesUnknown: (
    'Whether the action was accepted is unknown (operation {operation}). Check Tasks before trying again.',
    '动作是否被接受尚不明确（操作 {operation}）。重试前请先查看任务页。',
  ),
  PlatformMessageKey.rolesRejected: (
    'Role change rejected: {reason}',
    '角色变更被拒绝：{reason}',
  ),
  PlatformMessageKey.rolesConfirm: (
    'Submit {action} for {member}? The final result is shown in Tasks.',
    '为 {member} 提交 {action}？最终结果请到任务页查看。',
  ),
  PlatformMessageKey.rolesScopeTenantOnly: (
    'Current scope: whole organization. Workspace {name} is not active, so its roles cannot be managed now.',
    '当前作用域：整个组织。工作区 {name} 未处于正常状态，暂不能管理其角色。',
  ),
  PlatformMessageKey.rolesNext: ('Next page', '下一页'),
  PlatformMessageKey.rolesPrevious: ('Previous page', '上一页'),
  PlatformMessageKey.secretRehomeTitle: ('Legacy identity keys', '旧身份密钥归位'),
  PlatformMessageKey.secretRehomeExplain: (
    'Move the existing key reference into this tenant\'s vault. The public identity and channel history stay unchanged.',
    '将现有密钥引用归入本租户的密钥库；公钥身份和频道历史不变。',
  ),
  PlatformMessageKey.secretRehomeNone: (
    'No legacy identity references on this page.',
    '本页没有旧身份引用。',
  ),
  PlatformMessageKey.secretRehomeKind: ('Identity kind', '身份类型'),
  PlatformMessageKey.secretRehomePubkey: ('Public key', '公钥'),
  PlatformMessageKey.secretRehomeMove: ('Move reference', '归位引用'),
  PlatformMessageKey.secretRehomeConfirm: (
    'Move the key reference for {pubkey}? This does not rotate the key. Confirm explicitly; the final result is shown in Tasks.',
    '归位公钥 {pubkey} 的密钥引用？这不会轮换密钥。请明确确认；最终结果在任务页查看。',
  ),
  PlatformMessageKey.secretRehomeSubmitted: (
    'Migration submitted (execution {execution}). Check Tasks for the final result.',
    '归位任务已提交（执行 {execution}）。请到任务页确认最终结果。',
  ),
  PlatformMessageKey.secretRehomeUnknown: (
    'Submission outcome unknown (operation {operation}). Check Tasks or retry the same intent; no new key will be created.',
    '提交结果不明（操作 {operation}）。请查看任务或重试同一意图；不会生成新的幂等键。',
  ),
  PlatformMessageKey.secretRehomeRejected: (
    'Migration rejected: {reason}',
    '归位被拒绝：{reason}',
  ),
  PlatformMessageKey.platformDevicesNone: (
    'No devices yet. Sign in on a desktop or mobile device to add one.',
    '还没有设备。在桌面端或移动端登录即可添加。',
  ),
  PlatformMessageKey.platformDevicesExplain: (
    'Each device holds its own key. Revoking one stops only that device.',
    '每台设备各持自己的密钥。撤销只停用那一台设备。',
  ),
  PlatformMessageKey.platformDevicesAdded: ('Added', '添加于'),
  PlatformMessageKey.platformDevicesThisDevice: ('This device', '本机'),
  PlatformMessageKey.platformDevicesRevoke: ('Revoke', '撤销'),
  PlatformMessageKey.platformDevicesMyTitle: ('My devices', '我的设备'),
  PlatformMessageKey.platformDevicesRegistered: ('Registered devices', '已登记设备'),
  PlatformMessageKey.platformDevicesRegisteredAt: (
    '{state} · registered {time}',
    '{state} · 登记于 {time}',
  ),
  PlatformMessageKey.platformDevicesRevokeTitle: ('Revoke device', '撤销设备'),
  PlatformMessageKey.platformDevicesRevokeThisConfirm: (
    'This device will lose access to your workspaces and be signed out.',
    '本机将失去工作区访问权限，并退出登录。',
  ),
  PlatformMessageKey.platformDevicesRevokeOtherConfirm: (
    'That device will lose access to your workspaces.',
    '该设备将失去工作区访问权限。',
  ),
  PlatformMessageKey.platformDevicesStateAfterRevoke: (
    'Device status: {state}.',
    '设备状态：{state}。',
  ),
  PlatformMessageKey.platformDevicesRevokeUnknown: (
    'The revocation result is unknown (operation {operation}). Reload to check.',
    '撤销结果不明（操作 {operation}）。请刷新后确认。',
  ),
  PlatformMessageKey.platformDevicesRevokeRejected: (
    'The revocation was rejected: {reason}',
    '撤销被拒绝：{reason}',
  ),
  PlatformMessageKey.platformNotMember: (
    'Your account is not a member of any organization yet. If you were invited, open your invitation link.',
    '你的账号还不是任何组织的成员。如果你收到了邀请，请打开邀请链接。',
  ),
  PlatformMessageKey.platformRefresh: ('Refresh', '刷新'),
  PlatformMessageKey.platformBack: ('Back', '返回'),
  PlatformMessageKey.platformConfirm: ('Confirm', '确认'),
  PlatformMessageKey.platformCancel: ('Cancel', '取消'),
  PlatformMessageKey.platformSettingsOrganization: ('Organization', '组织'),
  PlatformMessageKey.platformSettingsClose: ('Close settings', '关闭设置'),
  PlatformMessageKey.platformSettingsAppearance: ('Appearance', '外观'),
  PlatformMessageKey.platformSettingsTheme: ('Theme', '主题'),
  PlatformMessageKey.platformThemeAppearanceDescription: (
    'Choose how {name} looks and feels.',
    '选择{name}的界面外观。',
  ),
  PlatformMessageKey.platformThemeStyleDescription: (
    'Choose the colors used throughout {name}.',
    '选择{name}使用的配色。',
  ),
  PlatformMessageKey.platformThemeModeLight: ('Light', '浅色'),
  PlatformMessageKey.platformThemeModeDark: ('Dark', '深色'),
  PlatformMessageKey.platformThemeModeSystem: ('System', '跟随系统'),
  PlatformMessageKey.platformThemeAccentColor: ('Accent color', '强调色'),
  PlatformMessageKey.platformThemeAccentNeutral: (
    'Neutral accent color',
    '中性强调色',
  ),
  PlatformMessageKey.platformThemeAccentBlue: ('Blue accent color', '蓝色强调色'),
  PlatformMessageKey.platformThemeAccentCyan: ('Cyan accent color', '青色强调色'),
  PlatformMessageKey.platformThemeAccentGreen: ('Green accent color', '绿色强调色'),
  PlatformMessageKey.platformThemeAccentOrange: (
    'Orange accent color',
    '橙色强调色',
  ),
  PlatformMessageKey.platformThemeAccentRed: ('Red accent color', '红色强调色'),
  PlatformMessageKey.platformThemeAccentPink: ('Pink accent color', '粉色强调色'),
  PlatformMessageKey.platformThemeAccentLilac: ('Lilac accent color', '淡紫色强调色'),
  PlatformMessageKey.platformThemeAccentPurple: (
    'Purple accent color',
    '紫色强调色',
  ),
  PlatformMessageKey.platformThemeAccentIndigo: (
    'Indigo accent color',
    '靛蓝色强调色',
  ),
  PlatformMessageKey.platformThemeHomePreview: ('Home preview', '首页预览'),
  PlatformMessageKey.platformThemeChatPreview: ('Chat preview', '聊天预览'),
  PlatformMessageKey.platformThemeClosePreview: ('Close preview', '关闭预览'),
  PlatformMessageKey.platformThemeApply: ('Set', '应用'),
  PlatformMessageKey.platformThemeAppearanceCycle: (
    '{mode} appearance. Double tap to change.',
    '{mode}外观。双击切换。',
  ),
  PlatformMessageKey.platformThemeScrubber: (
    'Theme {index} of {count}',
    '第 {index} 个主题，共 {count} 个',
  ),
  PlatformMessageKey.platformThemeCommunitySample: ('Community', '社区'),
  PlatformMessageKey.platformSettingsConnection: ('Server connection', '服务器连接'),
  PlatformMessageKey.platformSettingsCopyDeviceKey: (
    'Copy device public key',
    '复制设备公钥',
  ),
  PlatformMessageKey.platformSettingsIdentityUnavailable: (
    'Identity unavailable',
    '身份不可用',
  ),
  PlatformMessageKey.platformSettingsDeviceKey: ('Device key', '设备密钥'),
  PlatformMessageKey.platformSettingsKeyCopied: ('Pubkey copied', '公钥已复制'),
  PlatformMessageKey.platformSettingsSignOutConfirm: (
    'This disconnects this device from your workspaces. The device stays registered; signing in again reconnects it.',
    '这会断开本机与工作区的连接。设备仍保持登记，再次登录即可重新连接。',
  ),
  PlatformMessageKey.platformReasonWithCode: (
    '{text} ({code})',
    '{text}（{code}）',
  ),
  PlatformMessageKey.tasksNone: (
    'You have not started any governed action yet.',
    '你还没有发起过受治理的动作。',
  ),
  PlatformMessageKey.tasksTitle: ('Task', '任务'),
  PlatformMessageKey.tasksMyTitle: ('My tasks', '我的任务'),
  PlatformMessageKey.tasksCreated: ('Started', '发起于'),
  PlatformMessageKey.tasksOperation: ('Operation', '操作'),
  PlatformMessageKey.tasksExecution: ('Action execution', '动作执行'),
  PlatformMessageKey.tasksTarget: ('Target', '目标'),
  PlatformMessageKey.tasksWorkflow: ('Workflow', 'Workflow'),
  PlatformMessageKey.tasksWaitingReason: ('Waiting for', '正在等待'),
  PlatformMessageKey.tasksReason: ('Reason', '原因'),
  PlatformMessageKey.tasksApproval: ('Approval', '审批'),
  PlatformMessageKey.tasksCancelRequest: ('Request cancellation', '请求取消'),
  PlatformMessageKey.tasksConfirmCancel: (
    'Request cancellation of this running task? A submitted request is not a canceled task; wait for its final status.',
    '请求取消这项运行中的任务？请求已提交不等于任务已取消，仍须等待最终状态。',
  ),
  PlatformMessageKey.tasksCancelSubmitted: (
    'Cancellation control recorded under operation {operation}; the original task is not yet confirmed canceled.',
    '取消控制已记录为操作 {operation}；原任务尚未确认取消。',
  ),
  PlatformMessageKey.tasksCancelUnknown: (
    'Cancellation request outcome is unknown (operation {operation}). Check the control task, or resend the same intent.',
    '取消请求结果不明（操作 {operation}）。请检查控制任务，或原样重发同一次意图。',
  ),
  PlatformMessageKey.tasksCancelSendAgain: ('Resend same request', '重发同一次请求'),
  PlatformMessageKey.tasksCancelRejected: (
    'Cancellation request rejected: {reason}',
    '取消请求被拒绝：{reason}',
  ),
  PlatformMessageKey.tasksRerunRequest: ('Run again', '重新运行'),
  PlatformMessageKey.tasksConfirmRerun: (
    'Start a new governed run of this closed task? It receives a new action and workflow; any required approval must be granted again.',
    '为这项已结束的任务发起一次新的受治理执行？它会取得新的动作与 Workflow；原任务要求的审批必须重新完成。',
  ),
  PlatformMessageKey.tasksRerunSubmitted: (
    'Rerun control recorded under operation {operation}. Open the new task for approval and final status:',
    '重跑控制已记录为操作 {operation}。请打开新任务查看审批与最终状态：',
  ),
  PlatformMessageKey.tasksRerunUnknown: (
    'Rerun request outcome is unknown (operation {operation}). Check the control task, or resend the same intent.',
    '重跑请求结果不明（操作 {operation}）。请检查控制任务，或原样重发同一次意图。',
  ),
  PlatformMessageKey.tasksRerunRejected: (
    'Rerun request rejected: {reason}',
    '重跑请求被拒绝：{reason}',
  ),
  PlatformMessageKey.tasksStatusEvaluating: ('Being evaluated', '正在判定'),
  PlatformMessageKey.tasksStatusWaitingApproval: (
    'Waiting for approval',
    '等待审批',
  ),
  PlatformMessageKey.tasksStatusDenied: ('Not allowed', '未获准'),
  PlatformMessageKey.tasksStatusRevoked: (
    'Withdrawn or no longer allowed',
    '已撤回或不再获准',
  ),
  PlatformMessageKey.tasksStatusExpired: ('Expired', '已过期'),
  PlatformMessageKey.tasksStatusNotStarted: (
    'Allowed, not started yet',
    '已获准，尚未开始',
  ),
  PlatformMessageKey.tasksStatusAborted: (
    'Stopped before it took effect',
    '生效前已中止',
  ),
  PlatformMessageKey.tasksStatusStarted: ('Started', '已开始'),
  PlatformMessageKey.tasksStatusApplied: ('Applied', '已生效'),
  PlatformMessageKey.tasksStatusCancelRequestAccepted: (
    'Cancellation request accepted; awaiting task outcome',
    '取消请求已接收，等待任务终态',
  ),
  PlatformMessageKey.tasksStatusRunning: ('Running', '进行中'),
  PlatformMessageKey.tasksStatusCompleted: ('Completed', '已完成'),
  PlatformMessageKey.tasksStatusFailed: ('Failed', '失败'),
  PlatformMessageKey.tasksStatusCanceled: ('Canceled', '已取消'),
  PlatformMessageKey.tasksStatusTerminated: ('Terminated', '已终止'),
  PlatformMessageKey.tasksStatusTimedOut: ('Timed out', '已超时'),
  PlatformMessageKey.tasksStatusUnknown: (
    'Outcome not known yet — waiting for reconciliation',
    '结果尚不明确，等待对账',
  ),
  PlatformMessageKey.tasksStatusDelayed: (
    'Status may be out of date — waiting for reconciliation',
    '状态可能尚未更新，等待对账',
  ),
  PlatformMessageKey.approvalsNone: (
    'Nothing is waiting for your approval.',
    '没有等待你审批的请求。',
  ),
  PlatformMessageKey.approvalsPendingTitle: (
    'Waiting for my approval',
    '等待我审批',
  ),
  PlatformMessageKey.approvalsMobileReadOnly: (
    'To approve, deny or withdraw, use the web or desktop app.',
    '请在网页端或桌面端批准、拒绝或撤回。',
  ),
  PlatformMessageKey.approvalsExpiresAt: ('Expires {time}', '{time} 到期'),
  PlatformMessageKey.approvalsStatus: ('Approval state', '审批状态'),
  PlatformMessageKey.approvalsExpires: ('Expires', '到期'),
  PlatformMessageKey.approvalsInitiator: ('Requested by', '发起者'),
  PlatformMessageKey.approvalsRequirements: ('Required approvals', '所需批准'),
  PlatformMessageKey.approvalsRequirement: (
    '{selector}: at least {count}',
    '{selector}：至少 {count} 人',
  ),
  PlatformMessageKey.approvalsDecisions: ('Decisions', '已有决定'),
  PlatformMessageKey.approvalsNoDecisions: ('No decisions yet.', '还没有人决定。'),
  PlatformMessageKey.approvalsApprove: ('Approve', '批准'),
  PlatformMessageKey.approvalsDeny: ('Deny', '拒绝'),
  PlatformMessageKey.approvalsConfirmDecision: (
    'Record your decision “{decision}”? It cannot be changed afterwards.',
    '记录你的决定「{decision}」？记录后不能更改。',
  ),
  PlatformMessageKey.approvalsDecided: (
    'Your decision “{decision}” is recorded. The approval is now: {status}.',
    '你的决定「{decision}」已记录。审批当前状态：{status}。',
  ),
  PlatformMessageKey.approvalsDecisionUnknown: (
    'Whether your decision was recorded is not known (operation {operation}). Sending the same decision again is safe.',
    '你的决定是否已记录尚不明确（操作 {operation}）。再次提交同一决定是安全的。',
  ),
  PlatformMessageKey.approvalsSendAgain: (
    'Send the same decision again',
    '再次提交同一决定',
  ),
  PlatformMessageKey.approvalsDecisionRejected: (
    'Your decision was not accepted: {reason}',
    '你的决定未被接受：{reason}',
  ),
  PlatformMessageKey.approvalsWithdraw: ('Withdraw request', '撤回请求'),
  PlatformMessageKey.approvalsConfirmWithdraw: (
    'Withdraw this approval request? The action will not be carried out.',
    '撤回这项审批请求？该动作将不会执行。',
  ),
  PlatformMessageKey.approvalsWithdrawn: (
    'The request is now: {status}.',
    '请求当前状态：{status}。',
  ),
  PlatformMessageKey.approvalsWithdrawUnknown: (
    'Whether the request was withdrawn is not known (operation {operation}). Refresh to check.',
    '请求是否已撤回尚不明确（操作 {operation}）。请刷新确认。',
  ),
  PlatformMessageKey.approvalsWithdrawRejected: (
    'The request could not be withdrawn: {reason}',
    '请求未能撤回：{reason}',
  ),
  PlatformMessageKey.invitationsTitle: ('Invitations', '邀请'),
  PlatformMessageKey.invitationsExplain: (
    'An invitation link lets one person ask to join this organization. After they use it, an admin confirms it is really them (in Approvals).',
    '一条邀请链接让一个人申请加入本组织。对方使用后，由管理员在「审批」中确认确实是本人。',
  ),
  PlatformMessageKey.invitationsInviteeLabel: ('Who is this for?', '邀请谁？'),
  PlatformMessageKey.invitationsInviteeHint: (
    'A name you will recognize when confirming. It is not checked.',
    '确认时你能认出的称呼，不做校验。',
  ),
  PlatformMessageKey.invitationsIssue: ('Create invitation link', '生成邀请链接'),
  PlatformMessageKey.invitationsIssued: (
    'Invitation link for {label} (expires {expires}). It is shown only this once — copy it now. If it is lost, withdraw this invitation and create a new one.',
    '给 {label} 的邀请链接（{expires}到期）。它只显示这一次，请立即复制；丢失即撤回并重新生成。',
  ),
  PlatformMessageKey.invitationsCopy: ('Copy link', '复制链接'),
  PlatformMessageKey.invitationsCopied: ('Copied', '已复制'),
  PlatformMessageKey.invitationsNoLink: (
    'The invitation exists, but its link can no longer be shown. Withdraw it and create a new one.',
    '邀请已存在，但链接无法再显示。请撤回后重新生成。',
  ),
  PlatformMessageKey.invitationsIssueUnknown: (
    'Whether the invitation was created is not known (operation {operation}). Refresh the list; if it appears without a link you have, withdraw it and create a new one.',
    '邀请是否已生成尚不明确（操作 {operation}）。请刷新列表；若出现了你没拿到链接的邀请，撤回后重新生成。',
  ),
  PlatformMessageKey.invitationsIssueRejected: (
    'The invitation was not created: {reason}',
    '邀请未生成：{reason}',
  ),
  PlatformMessageKey.invitationsNone: ('No invitations yet.', '还没有邀请。'),
  PlatformMessageKey.invitationsInvitee: ('For', '邀请对象'),
  PlatformMessageKey.invitationsRedeemer: (
    'Used by (self-reported)',
    '使用者（自报）',
  ),
  PlatformMessageKey.invitationsConfirmation: ('Confirmation', '确认'),
  PlatformMessageKey.invitationsWithdraw: ('Withdraw', '撤回'),
  PlatformMessageKey.invitationsConfirmWithdraw: (
    'Withdraw the invitation for {label}? Its link will stop working.',
    '撤回给 {label} 的邀请？该链接将失效。',
  ),
  PlatformMessageKey.invitationsWithdrawUnknown: (
    'Whether the invitation was withdrawn is not known (operation {operation}). Refresh to check.',
    '邀请是否已撤回尚不明确（操作 {operation}）。请刷新确认。',
  ),
  PlatformMessageKey.invitationsWithdrawRejected: (
    'The invitation was not withdrawn: {reason}',
    '邀请未撤回：{reason}',
  ),
  PlatformMessageKey.invitationsForApproval: (
    'Invitation for “{label}”, used by someone who calls themselves “{name}”. Confirm it is really them before approving.',
    '给「{label}」的邀请，使用者自称「{name}」。批准前请以其他方式确认确实是本人。',
  ),
  PlatformMessageKey.redeemTitle: ('Join an organization', '加入组织'),
  PlatformMessageKey.redeemExplain: (
    'You were sent an invitation. Tell the admin who you are; they will confirm it before you get access.',
    '你收到了一份邀请。告诉管理员你是谁，管理员确认后你才会获得访问权限。',
  ),
  PlatformMessageKey.redeemDisplayName: ('Your name', '你的名字'),
  PlatformMessageKey.redeemSubmit: ('Use this invitation', '使用邀请'),
  PlatformMessageKey.redeemNoCredential: (
    'This page did not receive an invitation. If you came from an invitation link, open the link again now that you are signed in.',
    '本页没有收到邀请。如果你是从邀请链接来的，请在登录后再打开一次该链接。',
  ),
  PlatformMessageKey.redeemUnknown: (
    'Whether the invitation was used is not known. Submitting again is safe.',
    '邀请是否已使用尚不明确。再次提交是安全的。',
  ),
  PlatformMessageKey.redeemAgain: ('Submit again', '再次提交'),
  PlatformMessageKey.redeemRejected: (
    'The invitation could not be used: {reason}',
    '邀请无法使用：{reason}',
  ),
  PlatformMessageKey.redeemMine: ('My invitations', '我的邀请'),
  PlatformMessageKey.redeemWaiting: (
    'Waiting for an admin of {tenant} to confirm it is you. You can close this page and come back later.',
    '等待 {tenant} 的管理员确认是你本人。你可以先关闭本页，稍后再来。',
  ),
  PlatformMessageKey.redeemEvaluating: (
    'Your request to join {tenant} is being evaluated.',
    '加入 {tenant} 的请求正在判定。',
  ),
  PlatformMessageKey.redeemProvisioning: (
    'Confirmed. Your access to {tenant} is being set up.',
    '已确认，正在开通你在 {tenant} 的访问权限。',
  ),
  PlatformMessageKey.redeemActive: (
    'You are a member of {tenant}.',
    '你已是 {tenant} 的成员。',
  ),
  PlatformMessageKey.redeemEnded: (
    'Your invitation to {tenant} has ended: {reason}',
    '你加入 {tenant} 的邀请已终结：{reason}',
  ),
  PlatformMessageKey.redeemOther: ('{tenant}: {state}', '{tenant}：{state}'),
  PlatformMessageKey.redeemContinue: ('Continue', '继续'),
  PlatformMessageKey.redeemNativeHint: (
    'If you were invited, open your invitation link in the browser and sign in there. Once an admin confirms it, check again here.',
    '如果你收到了邀请，请在浏览器中打开邀请链接并登录；管理员确认后，回到这里重新确认。',
  ),
  PlatformMessageKey.nativeConfigTitle: ('Connect to your server', '连接服务器'),
  PlatformMessageKey.nativeConfigExplain: (
    'Enter the addresses your administrator gave you. Nothing is filled in for you: a guessed address would receive your sign-in and device key.',
    '填写管理员提供的地址。这里不预填任何值：猜测的地址会拿到你的登录与设备密钥。',
  ),
  PlatformMessageKey.nativeConfigNativeApiUrl: ('Native entry URL', '原生入口地址'),
  PlatformMessageKey.nativeConfigOidcIssuer: (
    'Sign-in issuer (OIDC)',
    '登录 issuer（OIDC）',
  ),
  PlatformMessageKey.nativeConfigOidcClientId: ('Client ID', '客户端 ID'),
  PlatformMessageKey.nativeConfigServer: ('Server: {host}', '服务器：{host}'),
  PlatformMessageKey.nativeConfigInvalidUrl: (
    '{field} is not a valid URL.',
    '{field} 不是有效的网址。',
  ),
  PlatformMessageKey.nativeConfigInvalidScheme: (
    '{field} must use HTTP or HTTPS.',
    '{field} 必须使用 HTTP 或 HTTPS。',
  ),
  PlatformMessageKey.nativeConfigInvalidExtras: (
    '{field} must not include a query or fragment.',
    '{field} 不能包含查询参数或片段。',
  ),
  PlatformMessageKey.nativeConfigInvalidUserInfo: (
    '{field} must not include user information.',
    '{field} 不能包含用户信息。',
  ),
  PlatformMessageKey.nativeConfigClientIdRequired: (
    'Client ID is required.',
    '必须填写客户端 ID。',
  ),
  PlatformMessageKey.nativeConfigSave: ('Save and continue', '保存并继续'),
  PlatformMessageKey.nativeConfigSaving: ('Saving…', '正在保存…'),
  PlatformMessageKey.nativeConfigEdit: ('Change connection settings', '修改连接设置'),
  PlatformMessageKey.nativeConfigRejected: (
    'These settings were not accepted: {message}',
    '设置未被接受：{message}',
  ),
  PlatformMessageKey.nativeSignInTitle: ('Sign in', '登录'),
  PlatformMessageKey.nativeSignInTitleNamed: ('Sign in to {name}', '登录{name}'),
  PlatformMessageKey.nativeSignInExplain: (
    'Sign-in opens in your system browser. Come back here when it is done.',
    '登录会在系统浏览器中打开，完成后回到这里。',
  ),
  PlatformMessageKey.nativeSignInStart: ('Sign in', '登录'),
  PlatformMessageKey.nativeSignInWaiting: (
    'Waiting for sign-in to finish in your browser…',
    '正在等待浏览器中的登录完成…',
  ),
  PlatformMessageKey.nativeSignInCancel: ('Cancel', '取消'),
  PlatformMessageKey.nativeSignInFailed: (
    'Sign-in did not complete: {message}',
    '登录未完成：{message}',
  ),
  PlatformMessageKey.nativeStatusUnconfigured: (
    'The server is not set up on this device.',
    '本机尚未配置服务器连接。',
  ),
  PlatformMessageKey.nativeStatusSignedOut: ('Signed out.', '已退出登录。'),
  PlatformMessageKey.nativeStatusAwaitingActivation: (
    'Waiting for this device to be added to your workspaces…',
    '正在等待本机加入你的工作区…',
  ),
  PlatformMessageKey.nativeStatusLinked: ('Connected.', '已连接。'),
  PlatformMessageKey.nativeRelayConnected: ('Connected', '已连接'),
  PlatformMessageKey.nativeRelayWaiting: ('Waiting to reconnect', '等待重新连接'),
  PlatformMessageKey.nativeRelayConnecting: ('Connecting', '正在连接'),
  PlatformMessageKey.nativeRelayHelperPrompt: (
    'Complete any prompts opened by the reconnect helper to continue.',
    '请完成重新连接助手打开的提示以继续。',
  ),
  PlatformMessageKey.nativeRelayReconnecting: ('Reconnecting', '正在重新连接'),
  PlatformMessageKey.nativeRelayConnect: ('Connect to relay', '连接 Relay'),
  PlatformMessageKey.nativeRelayClickToConnect: ('Click to connect', '点击连接'),
  PlatformMessageKey.nativeRelayDismissNotification: (
    'Dismiss relay notification',
    '关闭 Relay 通知',
  ),
  PlatformMessageKey.nativeRelayUnreachable: (
    'Can\'t reach the relay',
    '无法连接 Relay',
  ),
  PlatformMessageKey.nativeStatusFailed: ('Could not connect.', '未能连接。'),
  PlatformMessageKey.nativeStatusOutcomeUnknown: (
    'The outcome is not known yet.',
    '结果尚不明确。',
  ),
  PlatformMessageKey.nativeErrorHttpOutcomeUnknown: (
    'The server answered HTTP {status}; the outcome is not known.',
    '服务器返回 HTTP {status}；结果尚不明确。',
  ),
  PlatformMessageKey.nativeErrorUnavailable: (
    'The server could not be reached; the outcome is not known.',
    '无法连接服务器；结果尚不明确。',
  ),
  PlatformMessageKey.nativeErrorContract: (
    'The server answered outside the contract; the outcome is not known.',
    '服务器的响应不符合契约；结果尚不明确。',
  ),
  PlatformMessageKey.nativeErrorSessionEnded: (
    'Your sign-in has ended.',
    '你的登录已失效。',
  ),
  PlatformMessageKey.nativeErrorSignInAgain: ('Sign in again', '重新登录'),
  PlatformMessageKey.nativeUnavailableTitle: ('Not available here', '此处不可用'),
  PlatformMessageKey.nativeDeviceRegistering: (
    'Registering this device…',
    '正在登记本机…',
  ),
  PlatformMessageKey.nativeDevicePending: (
    'This device is being added ({state}). This usually takes a moment; check again to continue.',
    '正在添加本机（{state}），通常片刻即可完成；完成后点「重新确认」继续。',
  ),
  PlatformMessageKey.nativeDeviceUnknown: (
    'The registration result is unknown{operation}. Check again before doing anything else.',
    '登记结果不明{operation}。请先重新确认，再做其他操作。',
  ),
  PlatformMessageKey.nativeDeviceRejected: (
    'This device could not be registered ({reason}).',
    '本机无法登记（{reason}）。',
  ),
  PlatformMessageKey.nativeDeviceRevoked: (
    'This device\'s key has been revoked. It cannot be used again; ask your administrator.',
    '本机密钥已被撤销，不能再次使用；请联系管理员。',
  ),
  PlatformMessageKey.nativeDeviceCheck: ('Check again', '重新确认'),
  PlatformMessageKey.nativeCommunityLoading: (
    'Finding your community…',
    '正在获取 Community 连接信息…',
  ),
  PlatformMessageKey.nativeCommunityFailed: (
    'Couldn\'t get your community\'s connection details{reason}.',
    '未能取得 Community 连接信息{reason}。',
  ),
  PlatformMessageKey.nativeConnectFailed: (
    'Couldn\'t connect to your community: {message}',
    '未能连接 Community：{message}',
  ),
};

String platformText(
  PlatformMessageKey key, {
  String? locale,
  Map<String, Object>? variables,
}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  final pair = _messages[key]!;
  final template = language.startsWith('zh') ? pair.$2 : pair.$1;
  return template.replaceAllMapped(
    RegExp(r'\{(\w+)\}'),
    (match) => variables?[match.group(1)]?.toString() ?? '',
  );
}

String platformApprovalStatusText(ApprovalStatus value, {String? locale}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      ApprovalStatus.REQUESTED => '已请求',
      ApprovalStatus.WAITING => '等待决定',
      ApprovalStatus.APPROVED => '已批准，尚未执行',
      ApprovalStatus.DENIED => '已拒绝',
      ApprovalStatus.EXPIRED => '已过期',
      ApprovalStatus.CANCELLED => '已撤回',
      ApprovalStatus.CONSUMED => '已批准并执行',
      ApprovalStatus.INVALIDATED => '已失效',
    };
  }
  return switch (value) {
    ApprovalStatus.REQUESTED => 'Requested',
    ApprovalStatus.WAITING => 'Waiting for decisions',
    ApprovalStatus.APPROVED => 'Approved, not carried out yet',
    ApprovalStatus.DENIED => 'Denied',
    ApprovalStatus.EXPIRED => 'Expired',
    ApprovalStatus.CANCELLED => 'Withdrawn',
    ApprovalStatus.CONSUMED => 'Approved and carried out',
    ApprovalStatus.INVALIDATED => 'No longer valid',
  };
}

String platformTenantInvitationStatusText(
  TenantInvitationStatus value, {
  String? locale,
}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      TenantInvitationStatus.ISSUED => '尚未使用',
      TenantInvitationStatus.EXPIRED => '已过期',
      TenantInvitationStatus.REDEEMED => '已使用',
      TenantInvitationStatus.REVOKED => '已撤回',
    };
  }
  return switch (value) {
    TenantInvitationStatus.ISSUED => 'Not used yet',
    TenantInvitationStatus.EXPIRED => 'Expired',
    TenantInvitationStatus.REDEEMED => 'Used',
    TenantInvitationStatus.REVOKED => 'Withdrawn',
  };
}

String platformTenantMembershipStateText(
  TenantMembershipState value, {
  String? locale,
}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      TenantMembershipState.INVITED => '待确认',
      TenantMembershipState.PROVISIONING => '正在开通',
      TenantMembershipState.ACTIVE => '成员',
      TenantMembershipState.REVOKING => '正在移除',
      TenantMembershipState.REVOKED => '非成员',
      TenantMembershipState.ERROR => '需要处理',
    };
  }
  return switch (value) {
    TenantMembershipState.INVITED => 'Awaiting confirmation',
    TenantMembershipState.PROVISIONING => 'Being set up',
    TenantMembershipState.ACTIVE => 'Member',
    TenantMembershipState.REVOKING => 'Being removed',
    TenantMembershipState.REVOKED => 'Not a member',
    TenantMembershipState.ERROR => 'Needs attention',
  };
}

String platformWorkspaceMembershipStateText(
  WorkspaceMembershipState value, {
  String? locale,
}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      WorkspaceMembershipState.PROVISIONING => '正在开通',
      WorkspaceMembershipState.ACTIVE => '成员',
      WorkspaceMembershipState.REVOKING => '正在移除',
      WorkspaceMembershipState.REVOKED => '非成员',
      WorkspaceMembershipState.ERROR => '需要处理',
    };
  }
  return switch (value) {
    WorkspaceMembershipState.PROVISIONING => 'Being set up',
    WorkspaceMembershipState.ACTIVE => 'Member',
    WorkspaceMembershipState.REVOKING => 'Being removed',
    WorkspaceMembershipState.REVOKED => 'Not a member',
    WorkspaceMembershipState.ERROR => 'Needs attention',
  };
}

String platformBuzzIdentityStateText(
  BuzzIdentityState value, {
  String? locale,
}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      BuzzIdentityState.PENDING_SECRET => '正在准备密钥',
      BuzzIdentityState.RECONCILING => '正在接入',
      BuzzIdentityState.ACTIVE => '有效',
      BuzzIdentityState.REVOKING => '正在撤销',
      BuzzIdentityState.REVOKED => '已撤销',
    };
  }
  return switch (value) {
    BuzzIdentityState.PENDING_SECRET => 'Preparing key',
    BuzzIdentityState.RECONCILING => 'Being added',
    BuzzIdentityState.ACTIVE => 'Active',
    BuzzIdentityState.REVOKING => 'Being removed',
    BuzzIdentityState.REVOKED => 'Revoked',
  };
}

String platformAuditEventTypeText(AuditEventType value, {String? locale}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      AuditEventType.AUTHENTICATION => '认证',
      AuditEventType.SESSION => '会话',
      AuditEventType.INTENT => '意图',
      AuditEventType.DECISION => '决策',
      AuditEventType.APPROVAL => '审批',
      AuditEventType.DISPATCH => '派发',
      AuditEventType.OUTCOME => '结果',
      AuditEventType.REVOCATION => '撤权',
      AuditEventType.RECONCILIATION => '对账',
      AuditEventType.ACCESS => '访问',
    };
  }
  return switch (value) {
    AuditEventType.AUTHENTICATION => 'Authentication',
    AuditEventType.SESSION => 'Session',
    AuditEventType.INTENT => 'Intent',
    AuditEventType.DECISION => 'Decision',
    AuditEventType.APPROVAL => 'Approval',
    AuditEventType.DISPATCH => 'Dispatch',
    AuditEventType.OUTCOME => 'Outcome',
    AuditEventType.REVOCATION => 'Revocation',
    AuditEventType.RECONCILIATION => 'Reconciliation',
    AuditEventType.ACCESS => 'Access',
  };
}

String platformApprovalDecisionText(ApprovalDecision value, {String? locale}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      ApprovalDecision.APPROVE => '批准',
      ApprovalDecision.DENY => '拒绝',
    };
  }
  return switch (value) {
    ApprovalDecision.APPROVE => 'Approve',
    ApprovalDecision.DENY => 'Deny',
  };
}

String platformApprovalSelectorText(ApprovalSelector value, {String? locale}) {
  final language = (locale ?? Platform.localeName).toLowerCase();
  if (language.startsWith('zh')) {
    return switch (value) {
      ApprovalSelector.TENANT_ADMIN => '组织管理员',
      ApprovalSelector.WORKSPACE_ADMIN => '工作区管理员',
      ApprovalSelector.RESOURCE_APPROVER => '资源审批人',
    };
  }
  return switch (value) {
    ApprovalSelector.TENANT_ADMIN => 'Organization admin',
    ApprovalSelector.WORKSPACE_ADMIN => 'Workspace admin',
    ApprovalSelector.RESOURCE_APPROVER => 'Resource approver',
  };
}

enum PlatformThemeMode { light, dark, system }

PlatformMessageKey platformThemeModeKey(PlatformThemeMode mode) =>
    switch (mode) {
      PlatformThemeMode.light => PlatformMessageKey.platformThemeModeLight,
      PlatformThemeMode.dark => PlatformMessageKey.platformThemeModeDark,
      PlatformThemeMode.system => PlatformMessageKey.platformThemeModeSystem,
    };

String _platformLanguage(String? locale) =>
    (locale ?? Platform.localeName).toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en';

const platformCalendarWeekdayBandDays = 7;
const platformTimeSecondsDay = 86400;

String platformIntlLocale({String? locale}) =>
    _platformLanguage(locale) == 'zh-CN' ? 'zh_CN' : 'en_US';

const _platformPluralOneLocales = <String>{'en'};

bool platformPluralOne(int count, {String? locale}) =>
    count == 1 && _platformPluralOneLocales.contains(_platformLanguage(locale));

const _platformSpecialRelativeUnits = <String>{'day', 'month'};

String platformAbsoluteTime(String rfc3339, {String? locale}) {
  final at = DateTime.tryParse(rfc3339);
  if (at == null) {
    return platformText(
      PlatformMessageKey.platformTimeUnavailable,
      locale: locale,
    );
  }
  final local = at.toLocal();
  return platformText(
    PlatformMessageKey.platformTimeAbsolute,
    locale: locale,
    variables: {
      'year': local.year,
      'month': local.month,
      'day': local.day,
      'hour': local.hour.toString().padLeft(2, '0'),
      'minute': local.minute.toString().padLeft(2, '0'),
    },
  );
}

String platformRelativeTime(String rfc3339, {String? locale, DateTime? now}) {
  final at = DateTime.tryParse(rfc3339);
  if (at == null) {
    return platformText(
      PlatformMessageKey.platformTimeUnavailable,
      locale: locale,
    );
  }
  final current = now ?? DateTime.now();
  final elapsed =
      ((at.millisecondsSinceEpoch - current.millisecondsSinceEpoch).abs() /
              1000)
          .round();
  if (elapsed == 0) {
    return platformText(PlatformMessageKey.platformTimeNow, locale: locale);
  }
  var unit = 'second';
  var count = elapsed;
  if (elapsed >= 2592000) {
    unit = 'month';
    count = (elapsed / 2592000).round();
  } else if (elapsed >= 86400) {
    unit = 'day';
    count = (elapsed / 86400).round();
  } else if (elapsed >= 3600) {
    unit = 'hour';
    count = (elapsed / 3600).round();
  } else if (elapsed >= 60) {
    unit = 'minute';
    count = (elapsed / 60).round();
  }
  final direction = at.isAfter(current) ? 'future' : 'past';
  final form = count == 1 && _platformSpecialRelativeUnits.contains(unit)
      ? 'one'
      : (platformPluralOne(count, locale: locale) ? 'one' : 'other');
  final key = switch ('$direction.$unit.$form') {
    'past.second.one' => PlatformMessageKey.platformTimePastSecondOne,
    'past.second.other' => PlatformMessageKey.platformTimePastSecondOther,
    'past.minute.one' => PlatformMessageKey.platformTimePastMinuteOne,
    'past.minute.other' => PlatformMessageKey.platformTimePastMinuteOther,
    'past.hour.one' => PlatformMessageKey.platformTimePastHourOne,
    'past.hour.other' => PlatformMessageKey.platformTimePastHourOther,
    'past.day.one' => PlatformMessageKey.platformTimePastDayOne,
    'past.day.other' => PlatformMessageKey.platformTimePastDayOther,
    'past.month.one' => PlatformMessageKey.platformTimePastMonthOne,
    'past.month.other' => PlatformMessageKey.platformTimePastMonthOther,
    'future.second.one' => PlatformMessageKey.platformTimeFutureSecondOne,
    'future.second.other' => PlatformMessageKey.platformTimeFutureSecondOther,
    'future.minute.one' => PlatformMessageKey.platformTimeFutureMinuteOne,
    'future.minute.other' => PlatformMessageKey.platformTimeFutureMinuteOther,
    'future.hour.one' => PlatformMessageKey.platformTimeFutureHourOne,
    'future.hour.other' => PlatformMessageKey.platformTimeFutureHourOther,
    'future.day.one' => PlatformMessageKey.platformTimeFutureDayOne,
    'future.day.other' => PlatformMessageKey.platformTimeFutureDayOther,
    'future.month.one' => PlatformMessageKey.platformTimeFutureMonthOne,
    'future.month.other' => PlatformMessageKey.platformTimeFutureMonthOther,
    _ => PlatformMessageKey.platformTimeUnavailable,
  };
  return platformText(key, locale: locale, variables: {'count': count});
}
