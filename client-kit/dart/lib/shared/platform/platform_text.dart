// Generated from client-kit/ts/platform/src/i18n.ts by tools/gen-platform-i18n.py.
// Do not edit. Message keys and translations have one TypeScript source.
import 'dart:io' show Platform;

import '../contracts/contracts.dart';

enum PlatformMessageKey {
  inboxTitle,
  inboxAll,
  inboxMention,
  inboxThread,
  inboxEmpty,
  inboxScope,
  inboxUnreadOnly,
  inboxMentionedIn,
  inboxThreadIn,
  inboxOpen,
  inboxOpenItem,
  inboxMarkRead,
  inboxMarkUnread,
  inboxUnreadCount,
  inboxReadUnavailable,
  inboxReadUnknown,
  capabilitiesTitle,
  componentsTitle,
  componentsBoundary,
  componentsRegistered,
  componentsApproved,
  componentsRejected,
  componentsRevoked,
  componentsManifest,
  componentsPackage,
  componentsBindingSchema,
  componentsDocumentHelp,
  componentsInvalid,
  componentsRegister,
  componentsRegisterWarning,
  componentsRequestApproval,
  componentsApprovalTask,
  componentsApproveWarning,
  componentsWorkflow,
  componentsRecorded,
  componentsViewTask,
  componentsNone,
  componentsRelease,
  componentsArtifact,
  capabilitiesBoundary,
  capabilitiesDocument,
  capabilitiesDocumentHelp,
  capabilitiesInvalid,
  capabilitiesRegister,
  capabilitiesApprove,
  capabilitiesDeprecate,
  capabilitiesRegisterWarning,
  capabilitiesApproveWarning,
  capabilitiesDeprecateWarning,
  capabilitiesNone,
  capabilitiesKey,
  capabilitiesSchemaDigest,
  capabilitiesSuiteDigest,
  capabilitiesDraft,
  capabilitiesActive,
  capabilitiesDeprecated,
  capabilitiesRetired,
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
  platformTabWorkflows,
  workflowsHistory,
  workflowsNoRuns,
  workflowsProgress,
  workflowsUsage,
  agentsNone,
  agentsMemoryTitle,
  agentsMemoryReadOnly,
  agentsMemoryGoverned,
  agentsMemoryNewEntry,
  agentsMemoryReplace,
  agentsMemorySet,
  agentsMemoryPatch,
  agentsMemoryRemove,
  agentsMemoryValue,
  agentsMemoryPatchText,
  agentsMemoryBaseHash,
  agentsMemoryTombstoneWarning,
  agentsMemoryReview,
  agentsMemoryRecorded,
  agentsMemoryInFlight,
  agentsMemoryOpen,
  agentsMemoryClose,
  agentsMemoryCore,
  agentsMemoryCold,
  agentsMemoryNewSessions,
  agentsMemorySlug,
  agentsMemoryHead,
  agentsMemoryFound,
  agentsMemoryAbsent,
  agentsMemoryUnreadable,
  agentsMemoryTombstone,
  agentsMemoryNone,
  agentsMemoryUnknown,
  agentsMemoryBoundExceeded,
  agentsMemoryReadEntry,
  agentsDefinitionOnly,
  agentsName,
  agentsSlug,
  agentsOwner,
  agentsResourceVersion,
  agentsPublishedVersion,
  agentsNoPublishedVersion,
  agentsInstallationCandidates,
  agentsInstallationCandidatesReadOnly,
  agentsDelegationReadOnly,
  agentsDelegationScopes,
  agentsDelegationTargetsReadOnly,
  agentsDelegationExposure,
  agentsDelegationOutputSchemaHash,
  agentsDelegationRedaction,
  agentsVersionAssetVersion,
  agentsDelegationVersion,
  agentsDelegationNoMaximumUses,
  agentsDelegationExposureConsumeOnly,
  agentsDelegationExposureRead,
  agentsDelegationExposureExport,
  agentsDelegationTool,
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
  agentsVersionDraft,
  agentsVersionRetired,
  agentsVersionHistory,
  agentsVersionConfigurationPages,
  agentsVersionNone,
  agentsVersionBoundary,
  agentsVersionCreate,
  agentsVersionEdit,
  agentsVersionPublish,
  agentsVersionRetire,
  agentsVersionCreateUnavailable,
  agentsVersionCurrentHumanOwner,
  agentsVersionAvatar,
  agentsVersionDescription,
  agentsVersionReplyPolicy,
  agentsVersionParallelism,
  agentsVersionIdleTimeout,
  agentsVersionMaxDuration,
  agentsVersionCoreWrite,
  agentsVersionColdWrite,
  agentsVersionCoreHumanOnly,
  agentsVersionCoreApproval,
  agentsVersionColdDisabled,
  agentsVersionColdInvocation,
  agentsVersionTriggers,
  agentsVersionManualAssignment,
  agentsVersionCapabilities,
  agentsVersionToolsUnavailable,
  agentsToolsTitle,
  agentsToolsBoundary,
  agentsToolsNone,
  agentsToolsProvisioning,
  agentsToolsAvailable,
  agentsToolsUnavailable,
  agentsToolsSelected,
  agentsToolsRemove,
  agentsVersionSaveReview,
  agentsVersionPublishReview,
  agentsVersionRetireReview,
  agentsVersionInFlight,
  agentsVersionOrdinal,
  agentsVersionRuntimeProfile,
  agentsInstallationTitle,
  agentsInstallationReadOnly,
  agentsInstallationManagement,
  agentsInstallationCreate,
  agentsInstallationNoPublished,
  agentsInstallationCreateUnavailable,
  agentsInstallationNotReady,
  agentsDelegationOpen,
  agentsExecuteTitle,
  agentsReadTitle,
  agentsReadBoundary,
  agentsReadEffective,
  agentsReadNotEffective,
  agentsReadUnverified,
  agentsReadGrant,
  agentsReadRevoke,
  agentsReadApproval,
  agentsReadRevokeWarning,
  agentsExecuteOpen,
  agentsExecuteBoundary,
  agentsExecuteEffective,
  agentsExecuteNotEffective,
  agentsExecuteUnverified,
  agentsExecuteGrant,
  agentsExecuteRevoke,
  agentsExecuteApproval,
  agentsExecuteRevokeWarning,
  agentsDelegationTitle,
  agentsDelegationNone,
  agentsDelegationNoTarget,
  agentsDelegationTarget,
  agentsDelegationValidFrom,
  agentsDelegationExpiresAt,
  agentsDelegationLocalTime,
  agentsDelegationInvalidPeriod,
  agentsDelegationMaxUses,
  agentsDelegationNoUseLimit,
  agentsDelegationUses,
  agentsDelegationGrantor,
  agentsDelegationRevoke,
  agentsDelegationAdmission,
  agentsDelegationStateActive,
  agentsDelegationStateRevoking,
  agentsDelegationStateRevoked,
  agentsDelegationStateExpired,
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
  agentsAutomationTitle,
  agentsAutomationScope,
  agentsAutomationNone,
  agentsAutomationStateDraft,
  agentsAutomationStateEnabled,
  agentsAutomationStatePaused,
  agentsAutomationStateDisabled,
  agentsAutomationVersionRetired,
  agentsAutomationCreate,
  agentsAutomationPublish,
  agentsAutomationEnable,
  agentsAutomationPause,
  agentsAutomationDisable,
  agentsAutomationExecutor,
  agentsAutomationNoExecutor,
  agentsAutomationSelect,
  agentsAutomationTrigger,
  agentsAutomationChannelMessage,
  agentsAutomationSchedule,
  agentsAutomationEverySeconds,
  agentsAutomationOffsetSeconds,
  agentsAutomationCatchupWindowSeconds,
  agentsAutomationScheduleRules,
  agentsAutomationChannel,
  agentsAutomationScheduleUnavailable,
  agentsAutomationPrefix,
  agentsAutomationTemplate,
  agentsAutomationAction,
  agentsAutomationAgentTurn,
  agentsAutomationPostMessage,
  agentsAutomationApprovalPolicy,
  agentsAutomationNoApproval,
  agentsAutomationApprovalUnavailable,
  agentsAutomationResultTarget,
  agentsAutomationThread,
  agentsAutomationPinned,
  agentsAutomationGrant,
  agentsAutomationNoVersion,
  agentsAutomationNoGrant,
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
  nativeSendRejected,
  nativeSendRateLimited,
  nativeSendRateLimitedNoHint,
  nativeSendNotConnected,
  nativeSendOutcomeUnknown,
  nativeSyncReconnecting,
  nativeSyncRejected,
  nativeSignOutServerUnconfirmed,
}

const _messages = <PlatformMessageKey, (String, String)>{
  PlatformMessageKey.inboxTitle: ('Inbox', '收件箱'),
  PlatformMessageKey.inboxAll: ('All', '全部'),
  PlatformMessageKey.inboxMention: ('Mentions', '提及'),
  PlatformMessageKey.inboxThread: ('Threads', '线程'),
  PlatformMessageKey.inboxEmpty: (
    'No activity in the available message pages',
    '可读取的消息页中暂无相关活动',
  ),
  PlatformMessageKey.inboxScope: (
    'Mentions and replies in your threads, from each currently accessible Workspace\'s bounded message page.',
    '逐个读取当前可访问 Workspace 的有界消息页，显示对你的提及及你参与的线程回复。',
  ),
  PlatformMessageKey.inboxUnreadOnly: ('Show unread only', '仅显示未读'),
  PlatformMessageKey.inboxMentionedIn: ('Mentioned in', '提及于'),
  PlatformMessageKey.inboxThreadIn: ('Thread in', '线程于'),
  PlatformMessageKey.inboxOpen: ('Open in channel', '在频道中打开'),
  PlatformMessageKey.inboxOpenItem: (
    'Open inbox item from {sender}',
    '打开来自 {sender} 的收件箱消息',
  ),
  PlatformMessageKey.inboxMarkRead: ('Mark as read', '标为已读'),
  PlatformMessageKey.inboxMarkUnread: ('Mark unread', '标为未读'),
  PlatformMessageKey.inboxUnreadCount: ('{count} unread', '{count} 条未读'),
  PlatformMessageKey.inboxReadUnavailable: (
    'Core read state is unavailable.',
    'Core 已读状态暂不可查证。',
  ),
  PlatformMessageKey.inboxReadUnknown: (
    'Read position is unconfirmed. Recheck before making another change.',
    '已读位置的写入结果不明，请重新查证后再更改。',
  ),
  PlatformMessageKey.capabilitiesTitle: ('Capability contracts', '能力契约'),
  PlatformMessageKey.componentsTitle: ('Component releases', '组件发行版本'),
  PlatformMessageKey.componentsBoundary: (
    'Registration runs the isolated conformance suite. A registered release is not approved and does not activate a business component.',
    '登记会实际运行隔离一致性套件。已登记不等于已批准，也不会启用业务组件。',
  ),
  PlatformMessageKey.componentsRegistered: ('Registered', '已登记'),
  PlatformMessageKey.componentsApproved: ('Approved', '已批准'),
  PlatformMessageKey.componentsRejected: ('Rejected', '已拒绝'),
  PlatformMessageKey.componentsRevoked: ('Revoked', '已撤销'),
  PlatformMessageKey.componentsManifest: (
    'Release manifest (JSON)',
    '发行清单（JSON）',
  ),
  PlatformMessageKey.componentsPackage: (
    'Component package (JSON)',
    '组件包清单（JSON）',
  ),
  PlatformMessageKey.componentsBindingSchema: (
    'Binding configuration schema (JSON)',
    '绑定配置 Schema（JSON）',
  ),
  PlatformMessageKey.componentsDocumentHelp: (
    'Provide the complete immutable documents. The deployed isolated candidate must match the artifact digest. Credentials, endpoints and passing reports are not accepted here.',
    '提交完整且不可变的清单。已部署的隔离候选必须匹配制品摘要；此处不接收凭据、执行端点或自报通过报告。',
  ),
  PlatformMessageKey.componentsInvalid: (
    'The manifest, package or binding schema is not valid JSON of the required shape.',
    '发行清单、组件包清单或绑定 Schema 不是形状正确的 JSON。',
  ),
  PlatformMessageKey.componentsRegister: (
    'Review release registration',
    '预览发行登记',
  ),
  PlatformMessageKey.componentsRegisterWarning: (
    'Confirm these exact documents and start the isolated suite. Registration is recorded only after every required check has native evidence; submitting a task is not registration success.',
    '确认这些原始清单并启动隔离套件。全部必需检查取得原生证据后才会登记；任务提交不表示登记成功。',
  ),
  PlatformMessageKey.componentsRequestApproval: ('Request approval', '申请批准'),
  PlatformMessageKey.componentsApprovalTask: ('Approval task', '批准任务'),
  PlatformMessageKey.componentsApproveWarning: (
    'Request Catalog approval for this exact release. The registrar and requester cannot approve it. Approval also requires the current deployed platform capabilities; no business binding will be activated.',
    '为这个确切版本申请 Catalog 批准。登记人和申请人不能审批；批准还必须通过当前部署能力兼容核验，不会启用业务 binding。',
  ),
  PlatformMessageKey.componentsWorkflow: (
    'Release workflow: {workflow}',
    '发行工作流：{workflow}',
  ),
  PlatformMessageKey.componentsRecorded: (
    'Release request recorded. Check the task for its outcome. Execution: {execution}; operation: {operation}.',
    '发行请求已记录，请在任务中查看实际结果。执行：{execution}；操作：{operation}。',
  ),
  PlatformMessageKey.componentsViewTask: ('View registration task', '查看登记任务'),
  PlatformMessageKey.componentsNone: (
    'No registered component releases in this Catalog scope.',
    '此 Catalog 作用域尚无已登记的组件发行版本。',
  ),
  PlatformMessageKey.componentsRelease: ('Component / version', '组件 / 版本'),
  PlatformMessageKey.componentsArtifact: (
    'Adapter artifact digest',
    'Adapter 制品摘要',
  ),
  PlatformMessageKey.capabilitiesBoundary: (
    'Catalog contracts define replaceable component capabilities. An active contract does not activate a component, binding or Tool permission.',
    'Catalog 契约定义可替换的组件能力。契约生效不代表组件、binding 或 Tool 权限已启用。',
  ),
  PlatformMessageKey.capabilitiesDocument: (
    'Registration document (JSON)',
    '登记文档（JSON）',
  ),
  PlatformMessageKey.capabilitiesDocumentHelp: (
    'Provide the complete registration document, including actual schemaDocuments and testVectorsJson. Core validates and fixes their digests; supplying hashes alone is insufficient.',
    '提交完整登记文档，包含实际 schemaDocuments 和 testVectorsJson。Core 校验并固定摘要，不能只提供摘要。',
  ),
  PlatformMessageKey.capabilitiesInvalid: (
    'The registration document is not valid JSON or lacks required contract fields.',
    '登记文档不是有效 JSON，或缺少必需的契约字段。',
  ),
  PlatformMessageKey.capabilitiesRegister: (
    'Review contract registration',
    '预览契约登记',
  ),
  PlatformMessageKey.capabilitiesApprove: (
    'Request contract approval',
    '申请批准契约',
  ),
  PlatformMessageKey.capabilitiesDeprecate: (
    'Review contract deprecation',
    '预览弃用契约',
  ),
  PlatformMessageKey.capabilitiesRegisterWarning: (
    'Registration creates a draft only. It does not activate a capability or install a component.',
    '登记只创建草稿，不激活能力，也不安装组件。',
  ),
  PlatformMessageKey.capabilitiesApproveWarning: (
    'Another Catalog tenant administrator must approve. Submission is not approval; an active contract is immutable.',
    '必须由另一位 Catalog Tenant 管理员批准。提交不构成批准；生效后的契约不可变。',
  ),
  PlatformMessageKey.capabilitiesDeprecateWarning: (
    'Reject new releases using this contract. Existing bindings remain available; their data is not deleted.',
    '拒绝新 release 使用此契约；已有 binding 继续可用，不删除其数据。',
  ),
  PlatformMessageKey.capabilitiesNone: (
    'No capability contracts on this page.',
    '本页没有能力契约。',
  ),
  PlatformMessageKey.capabilitiesKey: ('Category / version', '能力类别／版本'),
  PlatformMessageKey.capabilitiesSchemaDigest: (
    'Schema set digest',
    'Schema 集合摘要',
  ),
  PlatformMessageKey.capabilitiesSuiteDigest: (
    'Conformance suite digest',
    '一致性套件摘要',
  ),
  PlatformMessageKey.capabilitiesDraft: ('Draft', '草稿'),
  PlatformMessageKey.capabilitiesActive: ('Active contract', '契约已生效'),
  PlatformMessageKey.capabilitiesDeprecated: ('Deprecated', '已弃用'),
  PlatformMessageKey.capabilitiesRetired: ('Retired', '已退役'),
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
  PlatformMessageKey.platformTabWorkflows: ('Workflows', '工作流'),
  PlatformMessageKey.workflowsHistory: ('My run history', '我的运行历史'),
  PlatformMessageKey.workflowsNoRuns: (
    'No visible runs on this page.',
    '本页没有可见运行。',
  ),
  PlatformMessageKey.workflowsProgress: ('Progress', '进度'),
  PlatformMessageKey.workflowsUsage: ('Usage references', '用量引用'),
  PlatformMessageKey.agentsNone: (
    'No definitions visible on this page.',
    '本页没有可见的定义。',
  ),
  PlatformMessageKey.agentsMemoryTitle: ('Agent memory', 'Agent 记忆'),
  PlatformMessageKey.agentsMemoryReadOnly: (
    'Read through Core authorization. This page cannot write memory or grant runtime permissions.',
    '经 Core 授权读取。本页不写入记忆，也不授予运行权限。',
  ),
  PlatformMessageKey.agentsMemoryGoverned: (
    'Read through Core authorization. Only the current human owner can submit governed memory updates; memory never grants runtime permissions.',
    '经 Core 授权读取。仅当前 HUMAN 所有者可提交受治理的记忆更新；记忆不授予运行权限。',
  ),
  PlatformMessageKey.agentsMemoryNewEntry: (
    'Read a cold entry before editing (mem/...)',
    '编辑前读取冷条目（mem/...）',
  ),
  PlatformMessageKey.agentsMemoryReplace: ('Replace core memory', '替换核心记忆'),
  PlatformMessageKey.agentsMemorySet: ('Set entry value', '设置条目内容'),
  PlatformMessageKey.agentsMemoryPatch: ('Apply strict patch', '应用严格补丁'),
  PlatformMessageKey.agentsMemoryRemove: ('Write tombstone', '写入墓碑'),
  PlatformMessageKey.agentsMemoryValue: ('Memory value', '记忆内容'),
  PlatformMessageKey.agentsMemoryPatchText: (
    'Unified diff against the displayed native value',
    '针对已展示原生内容的 unified diff',
  ),
  PlatformMessageKey.agentsMemoryBaseHash: ('Native base hash', '原生内容基底 hash'),
  PlatformMessageKey.agentsMemoryTombstoneWarning: (
    'Publish value:null for this exact head. Archival history is not physically deleted.',
    '针对这个精确 head 发布 value:null；不会物理删除历史存档。',
  ),
  PlatformMessageKey.agentsMemoryReview: (
    'Submit this frozen value and head once. An unknown result can only re-check the same request, never sign or publish a replacement.',
    '仅提交本次冻结的内容与 head。结果不明只能查证同一请求，不会重新签名或发布替代事件。',
  ),
  PlatformMessageKey.agentsMemoryRecorded: (
    'Core returned this request\'s governed outcome. Inspect Tasks and Audit for its evidence. Execution: {execution}; operation: {operation}.',
    'Core 已返回本请求的治理结果。请到任务和审计页查证。执行：{execution}；操作：{operation}。',
  ),
  PlatformMessageKey.agentsMemoryInFlight: (
    'Existing memory request still needs reconciliation; no replacement is available.',
    '已有记忆请求仍待对账，不能另发替代请求。',
  ),
  PlatformMessageKey.agentsMemoryOpen: ('Read memory', '读取记忆'),
  PlatformMessageKey.agentsMemoryClose: ('Close memory', '关闭记忆'),
  PlatformMessageKey.agentsMemoryCore: ('Core memory', '核心记忆'),
  PlatformMessageKey.agentsMemoryCold: ('Cold memory', '冷记忆'),
  PlatformMessageKey.agentsMemoryNewSessions: (
    'Only new sessions read the current core head. Existing sessions keep their fixed event.',
    '仅新 Session 读取当前 core head；已有 Session 保留原固定事件。',
  ),
  PlatformMessageKey.agentsMemorySlug: ('Entry', '条目'),
  PlatformMessageKey.agentsMemoryHead: ('Native head', '原生 head'),
  PlatformMessageKey.agentsMemoryFound: ('Found', '已找到'),
  PlatformMessageKey.agentsMemoryAbsent: ('Confirmed absent', '确认缺失'),
  PlatformMessageKey.agentsMemoryUnreadable: (
    'Unreadable; absence is not confirmed',
    '不可读；尚未确认缺失',
  ),
  PlatformMessageKey.agentsMemoryTombstone: ('Tombstone', '墓碑'),
  PlatformMessageKey.agentsMemoryNone: (
    'Complete snapshot contains no cold entries.',
    '完整快照中没有冷记忆条目。',
  ),
  PlatformMessageKey.agentsMemoryUnknown: (
    'Listing is unknown; this is not an empty inventory.',
    '列表结果不明，不代表空库存。',
  ),
  PlatformMessageKey.agentsMemoryBoundExceeded: (
    'Native enumeration bound exceeded; completeness is not confirmed.',
    '原生枚举超过上界，未确认完整性。',
  ),
  PlatformMessageKey.agentsMemoryReadEntry: ('Read entry', '读取条目'),
  PlatformMessageKey.agentsDefinitionOnly: (
    'Manage stable definitions and exact versions here. Creating a definition or saving a draft does not publish, install or run an agent.',
    '此处管理稳定定义与精确版本。创建定义或保存草稿不等于发布、安装或运行 Agent。',
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
  PlatformMessageKey.agentsInstallationCandidates: (
    'Published installation sources',
    '已发布安装来源',
  ),
  PlatformMessageKey.agentsInstallationCandidatesReadOnly: (
    'Read-only exact published versions authorized on this page. This directory does not create an installation or authorize execution.',
    '只读展示本页受权的精确已发布版本。目录不创建安装，也不授予执行权限。',
  ),
  PlatformMessageKey.agentsDelegationReadOnly: (
    'Read-only delegation records and exact scopes. Recorded state, expiry and uses do not prove current invocation authorization.',
    '只读委托记录与精确 Scope。记录状态、期限和次数不证明当前 Invocation 已获授权。',
  ),
  PlatformMessageKey.agentsDelegationScopes: ('Exact scopes', '精确 Scope'),
  PlatformMessageKey.agentsDelegationTargetsReadOnly: (
    'Authorized scope directory',
    '受权 Scope 目录',
  ),
  PlatformMessageKey.agentsDelegationExposure: ('Result exposure', '结果暴露'),
  PlatformMessageKey.agentsDelegationOutputSchemaHash: (
    'Output schema hash',
    '输出契约摘要',
  ),
  PlatformMessageKey.agentsDelegationRedaction: ('Redaction policy', '裁剪策略'),
  PlatformMessageKey.agentsVersionAssetVersion: ('Asset version', 'Asset 版本'),
  PlatformMessageKey.agentsDelegationVersion: ('Grant version', 'Grant 版本'),
  PlatformMessageKey.agentsDelegationNoMaximumUses: (
    'No explicit use-count limit; expiry still applies.',
    '无显式次数上限，到期时间仍生效。',
  ),
  PlatformMessageKey.agentsDelegationExposureConsumeOnly: (
    'Consume only',
    '仅消费',
  ),
  PlatformMessageKey.agentsDelegationExposureRead: ('Read', '读取'),
  PlatformMessageKey.agentsDelegationExposureExport: ('Export', '导出'),
  PlatformMessageKey.agentsDelegationTool: ('Tool reference', 'Tool 引用'),
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
  PlatformMessageKey.agentsVersionDraft: ('Draft', '草稿'),
  PlatformMessageKey.agentsVersionRetired: ('Retired', '已退役'),
  PlatformMessageKey.agentsVersionHistory: ('Version history', '版本历史'),
  PlatformMessageKey.agentsVersionConfigurationPages: (
    'Authorized configuration pages',
    '受权配置分页',
  ),
  PlatformMessageKey.agentsVersionNone: (
    'No authorized versions on this page.',
    '本页没有受权可见的版本。',
  ),
  PlatformMessageKey.agentsVersionBoundary: (
    'Drafts are editable; published versions are immutable. Saving or publishing does not install an agent, change existing installations, or authorize execution.',
    '草稿可编辑，已发布版本不可变。保存或发布不会安装 Agent、改变已有安装或授予执行权限。',
  ),
  PlatformMessageKey.agentsVersionCreate: ('Create version draft', '创建版本草稿'),
  PlatformMessageKey.agentsVersionEdit: ('Edit draft', '编辑草稿'),
  PlatformMessageKey.agentsVersionPublish: ('Publish exact draft', '发布精确草稿'),
  PlatformMessageKey.agentsVersionRetire: (
    'Retire exact published version',
    '退役精确已发布版本',
  ),
  PlatformMessageKey.agentsVersionCreateUnavailable: (
    'This action has no authorized configuration source or registered permission. No default profile or route is supplied.',
    '此动作缺少受权配置来源或已登记权限。不提供默认运行配置或路由。',
  ),
  PlatformMessageKey.agentsVersionCurrentHumanOwner: (
    'Current active human identity',
    '当前有效 HUMAN 身份',
  ),
  PlatformMessageKey.agentsVersionAvatar: (
    'Avatar URL (optional metadata)',
    '头像 URL（可选元数据）',
  ),
  PlatformMessageKey.agentsVersionDescription: (
    'Persona description (optional)',
    'Persona 说明（可选）',
  ),
  PlatformMessageKey.agentsVersionReplyPolicy: (
    'Reply policy declared by this runtime profile',
    '此运行配置声明的回复策略',
  ),
  PlatformMessageKey.agentsVersionParallelism: (
    'Requested parallelism',
    '声明的并行度',
  ),
  PlatformMessageKey.agentsVersionIdleTimeout: (
    'Idle timeout (seconds)',
    '空闲超时（秒）',
  ),
  PlatformMessageKey.agentsVersionMaxDuration: (
    'Maximum turn duration (seconds)',
    '回合最长时限（秒）',
  ),
  PlatformMessageKey.agentsVersionCoreWrite: (
    'Requested core memory write policy',
    '声明的核心记忆写入策略',
  ),
  PlatformMessageKey.agentsVersionColdWrite: (
    'Requested cold memory write policy',
    '声明的冷记忆写入策略',
  ),
  PlatformMessageKey.agentsVersionCoreHumanOnly: ('Human only', '仅 HUMAN'),
  PlatformMessageKey.agentsVersionCoreApproval: (
    'Agent with approval',
    'Agent 须经审批',
  ),
  PlatformMessageKey.agentsVersionColdDisabled: (
    'Agent writes disabled',
    '禁用 Agent 写入',
  ),
  PlatformMessageKey.agentsVersionColdInvocation: (
    'Invocation scoped',
    '限定 Invocation',
  ),
  PlatformMessageKey.agentsVersionTriggers: (
    'Requested trigger defaults (not enabled channel bindings)',
    '声明的触发默认值（不启用频道绑定）',
  ),
  PlatformMessageKey.agentsVersionManualAssignment: (
    'Manual assignment',
    '人工分派',
  ),
  PlatformMessageKey.agentsVersionCapabilities: (
    'Requested capability contracts',
    '声明的能力合同',
  ),
  PlatformMessageKey.agentsVersionToolsUnavailable: (
    'Skill publication is unavailable. Tool references request capabilities; they do not grant permissions, bind an installation or authorize execution.',
    'Skill 发布尚不可用。Tool 引用仅声明需求，不授予权限、不建立安装绑定，也不授权执行。',
  ),
  PlatformMessageKey.agentsToolsTitle: ('Platform tools', '平台原生工具'),
  PlatformMessageKey.agentsToolsBoundary: (
    'Read-only tool catalog. A version reference grants no memory access, ToolBinding or delegation. Every invocation is admitted separately.',
    '只读工具目录。版本引用不授予记忆读取权限、ToolBinding 或委托。每次调用仍须单独准入。',
  ),
  PlatformMessageKey.agentsToolsNone: (
    'No visible registered tools on this page.',
    '本页没有可见的已登记工具。',
  ),
  PlatformMessageKey.agentsToolsProvisioning: (
    'Registration awaiting verification',
    '登记等待查证',
  ),
  PlatformMessageKey.agentsToolsAvailable: (
    'May be requested in a version',
    '可在版本中声明需求',
  ),
  PlatformMessageKey.agentsToolsUnavailable: (
    'Unavailable for this version; remove the reference or verify its permission and registration.',
    '此版本当前无法使用该引用；请移除，或查证其权限与登记状态。',
  ),
  PlatformMessageKey.agentsToolsSelected: ('Requested tools', '声明的工具需求'),
  PlatformMessageKey.agentsToolsRemove: ('Remove reference', '移除引用'),
  PlatformMessageKey.agentsVersionSaveReview: (
    'Save only this draft content. Core validates the declared sources and freezes its hash; installations and runtime projections are unchanged. Management quota/capacity is NONE; scope and permission are rechecked.',
    '仅保存此草稿正文。Core 查证声明来源并固定摘要；已有安装和运行投影不变。管理额度/容量为 NONE，scope 与权限仍重查。',
  ),
  PlatformMessageKey.agentsVersionPublishReview: (
    'Explicitly publish this exact draft and hash. The request contains no replacement content. The definition\'s published pointer changes; existing installations remain pinned. No approval workflow, quota or capacity is required by this registered management action.',
    '显式发布这个精确草稿与摘要。请求不携带替代正文，仅改变定义的已发布指针；已有安装仍固定原版本。此已登记管理动作无审批 Workflow、额度或容量要求。',
  ),
  PlatformMessageKey.agentsVersionRetireReview: (
    'Explicitly retire only this published version to prohibit new installations. Existing installations and in-flight invocations keep their exact immutable version; history, usage and audit remain. If this is the definition\'s published pointer, it is cleared without selecting a replacement. This Asset manage action has no approval workflow, quota or capacity requirement; Core rechecks scope and permission.',
    '显式退役这个已发布版本，禁止新安装。已有安装和在途 Invocation 保留精确不可变版本，历史、用量和审计不删除。若定义的已发布指针指向此版，仅清空而不选择替代版本。此 Asset manage 动作无审批 Workflow、额度或容量要求，Core 仍重查 scope 与权限。',
  ),
  PlatformMessageKey.agentsVersionInFlight: (
    'Existing version requests still require reconciliation',
    '已有版本请求仍待对账',
  ),
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
  PlatformMessageKey.agentsInstallationManagement: (
    'Create an installation from an exact published version. Recorded installation and projection states do not prove runtime health or authorize an invocation.',
    '选择精确已发布版本创建安装。安装与投影的记录状态不证明运行时健康，也不授权某次调用。',
  ),
  PlatformMessageKey.agentsInstallationCreate: (
    'Install published Agent version',
    '安装已发布 Agent 版本',
  ),
  PlatformMessageKey.agentsInstallationNoPublished: (
    'No authorized published Agent version on this page.',
    '本页没有已获安装来源授权的已发布 Agent 版本。',
  ),
  PlatformMessageKey.agentsInstallationCreateUnavailable: (
    'Installation creation is not available to this identity in this workspace.',
    '当前身份在此工作区没有可用的安装创建动作。',
  ),
  PlatformMessageKey.agentsInstallationNotReady: (
    'This request creates an installation pinned to the displayed version. Provisioning, authorization and runtime readiness are separate; dispatch does not mean the Agent is ready to run.',
    '此请求创建固定到所示版本的安装。建立投影、授权与运行时就绪是独立事实；请求已派发不等于 Agent 可运行。',
  ),
  PlatformMessageKey.agentsDelegationOpen: ('View delegation grants', '查看委托授权'),
  PlatformMessageKey.agentsExecuteTitle: (
    'Agent self-installation execute permission',
    'Agent 自身安装执行权限',
  ),
  PlatformMessageKey.agentsReadTitle: (
    'Agent self-installation memory read permission',
    'Agent 自身安装记忆读取权限',
  ),
  PlatformMessageKey.agentsReadBoundary: (
    'This grants this agent read access only to its own installation memory. It grants no Tool consume permission, delegation or access to another installation.',
    '仅授予此 Agent 读取自身安装记忆的权限，不授予 Tool consume、委托或其他安装的访问权限。',
  ),
  PlatformMessageKey.agentsReadEffective: (
    'Fresh memory read check passed for this installation',
    '自身安装记忆 fresh read 已通过',
  ),
  PlatformMessageKey.agentsReadNotEffective: (
    'Self-installation memory read is not effective',
    '自身安装记忆读取权限未生效',
  ),
  PlatformMessageKey.agentsReadUnverified: (
    'Memory read permission cannot be verified. No permission action is offered.',
    '记忆读取权限不可查证，不提供权限操作。',
  ),
  PlatformMessageKey.agentsReadGrant: (
    'Review memory read grant',
    '预览授予记忆读取权限',
  ),
  PlatformMessageKey.agentsReadRevoke: (
    'Review memory read revocation',
    '预览撤销记忆读取权限',
  ),
  PlatformMessageKey.agentsReadApproval: (
    'The exact installation owner must approve. Submission does not grant memory read permission.',
    '须由此安装的确切 owner 审批，提交不构成记忆读取授权。',
  ),
  PlatformMessageKey.agentsReadRevokeWarning: (
    'Revoke only this agent\'s self-installation reader relationship. Pending grants are invalidated; each subsequent memory read must pass a fresh permission check.',
    '仅撤销此 Agent 自身安装的 reader 关系。待处理授予会失效；后续每次记忆读取必须重新通过权限校验。',
  ),
  PlatformMessageKey.agentsExecuteOpen: (
    'View self-installation permission',
    '查看自身安装权限',
  ),
  PlatformMessageKey.agentsExecuteBoundary: (
    'This permission applies only to this installation. It grants no model, tool or other resource access. Delegation, human permissions, quota and runtime readiness remain separate requirements.',
    '此权限仅适用于自身安装，不授予模型、工具或其他资源权限。委托、HUMAN 权限、额度与运行就绪仍是独立条件。',
  ),
  PlatformMessageKey.agentsExecuteEffective: (
    'Fresh execute check passed for this installation',
    '自身安装 fresh execute 已通过',
  ),
  PlatformMessageKey.agentsExecuteNotEffective: (
    'Self-installation execute is not effective',
    '自身安装执行权限未生效',
  ),
  PlatformMessageKey.agentsExecuteUnverified: (
    'Execute permission cannot be verified. No permission action is offered.',
    '执行权限不可查证，不提供权限操作。',
  ),
  PlatformMessageKey.agentsExecuteGrant: ('Review execute grant', '预览授予执行权限'),
  PlatformMessageKey.agentsExecuteRevoke: (
    'Review execute revocation',
    '预览撤销执行权限',
  ),
  PlatformMessageKey.agentsExecuteApproval: (
    'The exact installation owner must approve. Submission does not grant execution permission.',
    '须由此安装的确切 owner 审批，提交不构成执行授权。',
  ),
  PlatformMessageKey.agentsExecuteRevokeWarning: (
    'Revoke only this agent\'s self-installation executor relationship. Pending grants are invalidated and existing ordinary invocations receive cancellation requests; cancellation is not a terminal result.',
    '仅撤销此 Agent 自身安装的 executor 关系。待处理授予会失效，已有普通 Invocation 记录取消请求；取消请求不是终态。',
  ),
  PlatformMessageKey.agentsDelegationTitle: (
    'Installation delegation grants',
    '安装的委托授权',
  ),
  PlatformMessageKey.agentsDelegationNone: (
    'No delegation grants on this page.',
    '本页没有委托授权记录。',
  ),
  PlatformMessageKey.agentsDelegationNoTarget: (
    'No authorized action target on this page. No default scope is granted.',
    '本页没有已获授权的动作目标，不授予默认范围。',
  ),
  PlatformMessageKey.agentsDelegationTarget: (
    'Exact governed action and target',
    '确切受治理动作与目标',
  ),
  PlatformMessageKey.agentsDelegationValidFrom: ('Valid from', '生效时间'),
  PlatformMessageKey.agentsDelegationExpiresAt: ('Expires at', '到期时间'),
  PlatformMessageKey.agentsDelegationLocalTime: (
    'Enter this device\'s local time. The confirmation displays the exact UTC times.',
    '按此设备的本地时间填写，确认时展示精确 UTC 时间。',
  ),
  PlatformMessageKey.agentsDelegationInvalidPeriod: (
    'Expiry must be later than the valid-from time.',
    '到期时间必须晚于生效时间。',
  ),
  PlatformMessageKey.agentsDelegationMaxUses: ('Maximum uses', '最多使用次数'),
  PlatformMessageKey.agentsDelegationNoUseLimit: (
    'No explicit use-count limit (blank); expiry still applies.',
    '留空表示无显式次数上限，到期时间仍生效。',
  ),
  PlatformMessageKey.agentsDelegationUses: ('Recorded uses', '已记录使用次数'),
  PlatformMessageKey.agentsDelegationGrantor: ('Human grantor', 'HUMAN 授权人'),
  PlatformMessageKey.agentsDelegationRevoke: ('Review revocation', '预览撤销'),
  PlatformMessageKey.agentsDelegationAdmission: (
    'This exact grant does not add permissions or start a turn. Core rechecks this installation, action, target, expiry and result exposure before effects. An unknown result keeps the same grant and request IDs.',
    '此精确委托不增加权限，也不启动回合。Core 在副作用前重查安装、动作、目标、有效期与结果暴露。结果不明时保留原授权与请求 ID。',
  ),
  PlatformMessageKey.agentsDelegationStateActive: (
    'Active grant record',
    '授权记录为 ACTIVE',
  ),
  PlatformMessageKey.agentsDelegationStateRevoking: ('Revoking', '撤销中'),
  PlatformMessageKey.agentsDelegationStateRevoked: ('Revoked', '已撤销'),
  PlatformMessageKey.agentsDelegationStateExpired: ('Expired', '已到期'),
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
  PlatformMessageKey.agentsAutomationTitle: ('Automations', '自动化'),
  PlatformMessageKey.agentsAutomationScope: (
    'Manage immutable versions and governed state. No manual run or external-trigger controls.',
    '管理不可变版本与受治理状态；不提供手动运行或外部触发入口。',
  ),
  PlatformMessageKey.agentsAutomationNone: (
    'No readable, materialized automation in this workspace',
    '该工作区没有可读取且已物化的自动化',
  ),
  PlatformMessageKey.agentsAutomationStateDraft: ('Draft', '草稿'),
  PlatformMessageKey.agentsAutomationStateEnabled: ('Enabled', '已启用'),
  PlatformMessageKey.agentsAutomationStatePaused: ('Paused', '已暂停'),
  PlatformMessageKey.agentsAutomationStateDisabled: ('Disabled', '已停用'),
  PlatformMessageKey.agentsAutomationVersionRetired: ('Retired', '已退役'),
  PlatformMessageKey.agentsAutomationCreate: ('Create automation', '创建自动化'),
  PlatformMessageKey.agentsAutomationPublish: (
    'Publish a new version',
    '发布新版本',
  ),
  PlatformMessageKey.agentsAutomationEnable: ('Enable', '启用'),
  PlatformMessageKey.agentsAutomationPause: ('Pause', '暂停'),
  PlatformMessageKey.agentsAutomationDisable: ('Disable', '停用'),
  PlatformMessageKey.agentsAutomationExecutor: (
    'Executor installation',
    '执行器安装',
  ),
  PlatformMessageKey.agentsAutomationNoExecutor: (
    'No active executor on this page',
    '本页没有有效执行器',
  ),
  PlatformMessageKey.agentsAutomationSelect: (
    'Choose a verified record',
    '选择已查证的记录',
  ),
  PlatformMessageKey.agentsAutomationTrigger: ('Trigger', '触发方式'),
  PlatformMessageKey.agentsAutomationChannelMessage: (
    'Channel message',
    '频道消息',
  ),
  PlatformMessageKey.agentsAutomationSchedule: (
    'Temporal schedule',
    'Temporal 定时触发',
  ),
  PlatformMessageKey.agentsAutomationEverySeconds: (
    'Interval (seconds)',
    '间隔（秒）',
  ),
  PlatformMessageKey.agentsAutomationOffsetSeconds: (
    'Offset (seconds)',
    '偏移（秒）',
  ),
  PlatformMessageKey.agentsAutomationCatchupWindowSeconds: (
    'Catch-up window (seconds)',
    '补偿窗口（秒）',
  ),
  PlatformMessageKey.agentsAutomationScheduleRules: (
    'Enter all three values explicitly: a positive interval, an offset below the interval, and a catch-up window of at least 10 seconds. Overlapping runs are skipped.',
    '请显式填写三项：正数间隔、小于间隔的非负偏移、至少 10 秒的补偿窗口；重叠运行将被跳过。',
  ),
  PlatformMessageKey.agentsAutomationChannel: ('Workspace channel', '工作区频道'),
  PlatformMessageKey.agentsAutomationScheduleUnavailable: (
    'This executor has no verified channel reply capability. Scheduling is unavailable.',
    '该执行器没有已查证的频道回复能力，无法定时运行。',
  ),
  PlatformMessageKey.agentsAutomationPrefix: (
    'Optional text prefix',
    '文本前缀（可选）',
  ),
  PlatformMessageKey.agentsAutomationTemplate: ('Instruction template', '指令模板'),
  PlatformMessageKey.agentsAutomationAction: ('Action', '执行动作'),
  PlatformMessageKey.agentsAutomationAgentTurn: ('Agent turn', 'Agent 回合'),
  PlatformMessageKey.agentsAutomationPostMessage: (
    'Post template message',
    '发布模板消息',
  ),
  PlatformMessageKey.agentsAutomationApprovalPolicy: (
    'Approval before execution',
    '执行前审批策略',
  ),
  PlatformMessageKey.agentsAutomationNoApproval: (
    'No step approval',
    '不设置步骤审批',
  ),
  PlatformMessageKey.agentsAutomationApprovalUnavailable: (
    'The selected approval policy cannot be verified. Refresh the policy list.',
    '无法核验已选审批策略，请刷新策略目录。',
  ),
  PlatformMessageKey.agentsAutomationResultTarget: ('Result target', '结果目标'),
  PlatformMessageKey.agentsAutomationThread: ('Trigger thread', '触发线程'),
  PlatformMessageKey.agentsAutomationPinned: ('Pinned version', '固定版本'),
  PlatformMessageKey.agentsAutomationGrant: ('Verified delegation', '已查证委托'),
  PlatformMessageKey.agentsAutomationNoVersion: (
    'No readable version on this page',
    '本页没有可读取的版本',
  ),
  PlatformMessageKey.agentsAutomationNoGrant: (
    'No valid delegation on this page; enable is unavailable',
    '本页没有有效委托，不提供启用入口',
  ),
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
    'These settings were not accepted.',
    '设置未被接受。',
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
    'Sign-in did not complete.',
    '登录未完成。',
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
    'Couldn\'t connect to your community.',
    '未能连接 Community。',
  ),
  PlatformMessageKey.nativeSendRejected: (
    'Not sent: the server refused this message. Your text is kept.',
    '未发送：服务器拒绝了这条消息。内容已保留。',
  ),
  PlatformMessageKey.nativeSendRateLimited: (
    'Not sent: you are sending too fast. Try again in {seconds} s. Your text is kept.',
    '未发送：发送过于频繁，请 {seconds} 秒后再试。内容已保留。',
  ),
  PlatformMessageKey.nativeSendRateLimitedNoHint: (
    'Not sent: you are sending too fast. Try again shortly. Your text is kept.',
    '未发送：发送过于频繁，请稍后再试。内容已保留。',
  ),
  PlatformMessageKey.nativeSendNotConnected: (
    'Not sent: this device is not connected to the server. Your text is kept.',
    '未发送：本机尚未连接服务器。内容已保留。',
  ),
  PlatformMessageKey.nativeSendOutcomeUnknown: (
    'Delivery not confirmed. Your text is kept; sending it again unchanged will not post it twice.',
    '未确认送达。内容已保留；原样再次发送不会重复发出。',
  ),
  PlatformMessageKey.nativeSyncReconnecting: (
    'Not synced: reconnecting to the server. Messages shown may be out of date.',
    '未同步：正在重新连接服务器，显示的消息可能不是最新。',
  ),
  PlatformMessageKey.nativeSyncRejected: (
    'Not synced: the server no longer accepts this device.',
    '未同步：服务器已不再接受本机。',
  ),
  PlatformMessageKey.nativeSignOutServerUnconfirmed: (
    'Signed out on this device. The server did not confirm that your sign-in was ended; it will expire on its own.',
    '本机已退出。服务器未确认结束登录，它将按有效期自行失效。',
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
