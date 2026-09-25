// Generated from web/packages/platform/src/i18n.ts by tools/gen-platform-i18n.py.
// Do not edit. Message keys and translations have one TypeScript source.
import 'dart:io' show Platform;

import '../contracts/contracts.dart';

enum KailoMessageKey {
  platformTitle,
  platformWorkspace,
  platformWorkspaces,
  platformTabMembers,
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
  platformType,
  platformAction,
  platformResult,
  platformAuditNone,
  platformAuditMyTitle,
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
  rolesNext,
  rolesPrevious,
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
  tasksStatusEvaluating,
  tasksStatusWaitingApproval,
  tasksStatusDenied,
  tasksStatusRevoked,
  tasksStatusExpired,
  tasksStatusNotStarted,
  tasksStatusAborted,
  tasksStatusStarted,
  tasksStatusApplied,
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
  nativeSignInExplain,
  nativeSignInStart,
  nativeSignInWaiting,
  nativeSignInCancel,
  nativeSignInFailed,
  nativeStatusUnconfigured,
  nativeStatusSignedOut,
  nativeStatusAwaitingActivation,
  nativeStatusLinked,
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

const _messages = <KailoMessageKey, (String, String)>{
  KailoMessageKey.platformTitle: ('Kailo', 'Kailo'),
  KailoMessageKey.platformWorkspace: ('Workspace', '工作区'),
  KailoMessageKey.platformWorkspaces: ('Workspaces', '工作区'),
  KailoMessageKey.platformTabMembers: ('Members', '成员'),
  KailoMessageKey.platformTabAudit: ('Audit', '审计'),
  KailoMessageKey.platformTabDevices: ('Devices', '设备'),
  KailoMessageKey.platformTabTasks: ('Tasks', '任务'),
  KailoMessageKey.platformTabApprovals: ('Approvals', '审批'),
  KailoMessageKey.platformSignOut: ('Sign out', '退出'),
  KailoMessageKey.platformSessionUnavailable: ('Session unavailable', '会话不可用'),
  KailoMessageKey.platformLoading: ('Loading…', '载入中…'),
  KailoMessageKey.platformLoadingWorkspaces: (
    'Loading workspaces…',
    '正在载入工作区…',
  ),
  KailoMessageKey.platformNoWorkspace: (
    'You have no workspace you can enter in this tenant',
    '你在该 Tenant 下还没有可进入的工作区',
  ),
  KailoMessageKey.platformLoadFailed: (
    'Couldn\'t load this — the result is unknown.',
    '未能载入，结果不明。',
  ),
  KailoMessageKey.platformRetry: ('Try again', '重试'),
  KailoMessageKey.platformMember: ('Member', '成员'),
  KailoMessageKey.platformState: ('State', '状态'),
  KailoMessageKey.platformProtocolIdentity: ('Protocol identity', '协议身份'),
  KailoMessageKey.platformTime: ('Time', '时间'),
  KailoMessageKey.platformType: ('Type', '类型'),
  KailoMessageKey.platformAction: ('Action', '动作'),
  KailoMessageKey.platformResult: ('Result', '结果'),
  KailoMessageKey.platformAuditNone: ('No actions recorded yet.', '还没有记录到动作。'),
  KailoMessageKey.platformAuditMyTitle: ('My activity log', '我的活动记录'),
  KailoMessageKey.platformMembersNone: (
    'This workspace has no members.',
    '该工作区没有成员。',
  ),
  KailoMessageKey.platformMembersCountOne: ('{count} member', '{count} 位成员'),
  KailoMessageKey.platformMembersCountOther: ('{count} members', '{count} 位成员'),
  KailoMessageKey.platformMembersKeyCountOne: ('{count} key', '{count} 把密钥'),
  KailoMessageKey.platformMembersKeyCountOther: ('{count} keys', '{count} 把密钥'),
  KailoMessageKey.rolesTitle: ('Administrator roles', '管理员角色'),
  KailoMessageKey.rolesNone: (
    'No eligible members on this page.',
    '本页没有符合条件的成员。',
  ),
  KailoMessageKey.rolesTenant: ('Tenant admin', '租户管理员'),
  KailoMessageKey.rolesWorkspace: ('Workspace admin', '工作区管理员'),
  KailoMessageKey.rolesGrant: ('Grant', '授予'),
  KailoMessageKey.rolesRevoke: ('Revoke', '撤销'),
  KailoMessageKey.rolesLastAdmin: (
    'Cannot revoke the last effective tenant admin (LAST_TENANT_ADMIN).',
    '不能撤销最后一位有效租户管理员（LAST_TENANT_ADMIN）。',
  ),
  KailoMessageKey.rolesSubmitted: (
    'Action {action} was submitted (execution {execution}). Check Tasks for its final result.',
    '动作 {action} 已提交（执行 {execution}）。请到任务页确认最终结果。',
  ),
  KailoMessageKey.rolesUnknown: (
    'Whether the action was accepted is unknown (operation {operation}). Check Tasks before trying again.',
    '动作是否被接受尚不明确（操作 {operation}）。重试前请先查看任务页。',
  ),
  KailoMessageKey.rolesRejected: (
    'Role change rejected: {reason}',
    '角色变更被拒绝：{reason}',
  ),
  KailoMessageKey.rolesConfirm: (
    'Submit {action} for {member}? The final result is shown in Tasks.',
    '为 {member} 提交 {action}？最终结果请到任务页查看。',
  ),
  KailoMessageKey.rolesNext: ('Next page', '下一页'),
  KailoMessageKey.rolesPrevious: ('Previous page', '上一页'),
  KailoMessageKey.platformDevicesNone: (
    'No devices yet. Sign in to Kailo Desktop or Mobile to add one.',
    '还没有设备。在 Kailo Desktop 或 Mobile 上登录即可添加。',
  ),
  KailoMessageKey.platformDevicesExplain: (
    'Each device holds its own key. Revoking one stops only that device.',
    '每台设备各持自己的密钥。撤销只停用那一台设备。',
  ),
  KailoMessageKey.platformDevicesAdded: ('Added', '添加于'),
  KailoMessageKey.platformDevicesThisDevice: ('This device', '本机'),
  KailoMessageKey.platformDevicesRevoke: ('Revoke', '撤销'),
  KailoMessageKey.platformDevicesMyTitle: ('My devices', '我的设备'),
  KailoMessageKey.platformDevicesRegistered: ('Registered devices', '已登记设备'),
  KailoMessageKey.platformDevicesRegisteredAt: (
    '{state} · registered {time}',
    '{state} · 登记于 {time}',
  ),
  KailoMessageKey.platformDevicesRevokeTitle: ('Revoke device', '撤销设备'),
  KailoMessageKey.platformDevicesRevokeThisConfirm: (
    'This device will lose access to your workspaces and be signed out.',
    '本机将失去工作区访问权限，并退出登录。',
  ),
  KailoMessageKey.platformDevicesRevokeOtherConfirm: (
    'That device will lose access to your workspaces.',
    '该设备将失去工作区访问权限。',
  ),
  KailoMessageKey.platformDevicesStateAfterRevoke: (
    'Device status: {state}.',
    '设备状态：{state}。',
  ),
  KailoMessageKey.platformDevicesRevokeUnknown: (
    'The revocation result is unknown (operation {operation}). Reload to check.',
    '撤销结果不明（操作 {operation}）。请刷新后确认。',
  ),
  KailoMessageKey.platformDevicesRevokeRejected: (
    'The revocation was rejected: {reason}',
    '撤销被拒绝：{reason}',
  ),
  KailoMessageKey.platformNotMember: (
    'Your account is not a member of any organization yet. If you were invited, open your invitation link.',
    '你的账号还不是任何组织的成员。如果你收到了邀请，请打开邀请链接。',
  ),
  KailoMessageKey.platformRefresh: ('Refresh', '刷新'),
  KailoMessageKey.platformBack: ('Back', '返回'),
  KailoMessageKey.platformConfirm: ('Confirm', '确认'),
  KailoMessageKey.platformCancel: ('Cancel', '取消'),
  KailoMessageKey.platformSettingsOrganization: ('Organization', '组织'),
  KailoMessageKey.platformSettingsClose: ('Close settings', '关闭设置'),
  KailoMessageKey.platformSettingsAppearance: ('Appearance', '外观'),
  KailoMessageKey.platformSettingsTheme: ('Theme', '主题'),
  KailoMessageKey.platformThemeModeLight: ('Light', '浅色'),
  KailoMessageKey.platformThemeModeDark: ('Dark', '深色'),
  KailoMessageKey.platformThemeModeSystem: ('System', '跟随系统'),
  KailoMessageKey.platformThemeAccentColor: ('Accent color', '强调色'),
  KailoMessageKey.platformThemeAccentNeutral: ('Neutral accent color', '中性强调色'),
  KailoMessageKey.platformThemeAccentBlue: ('Blue accent color', '蓝色强调色'),
  KailoMessageKey.platformThemeAccentCyan: ('Cyan accent color', '青色强调色'),
  KailoMessageKey.platformThemeAccentGreen: ('Green accent color', '绿色强调色'),
  KailoMessageKey.platformThemeAccentOrange: ('Orange accent color', '橙色强调色'),
  KailoMessageKey.platformThemeAccentRed: ('Red accent color', '红色强调色'),
  KailoMessageKey.platformThemeAccentPink: ('Pink accent color', '粉色强调色'),
  KailoMessageKey.platformThemeAccentLilac: ('Lilac accent color', '淡紫色强调色'),
  KailoMessageKey.platformThemeAccentPurple: ('Purple accent color', '紫色强调色'),
  KailoMessageKey.platformThemeAccentIndigo: ('Indigo accent color', '靛蓝色强调色'),
  KailoMessageKey.platformThemeHomePreview: ('Home preview', '首页预览'),
  KailoMessageKey.platformThemeChatPreview: ('Chat preview', '聊天预览'),
  KailoMessageKey.platformThemeClosePreview: ('Close preview', '关闭预览'),
  KailoMessageKey.platformThemeApply: ('Set', '应用'),
  KailoMessageKey.platformThemeAppearanceCycle: (
    '{mode} appearance. Double tap to change.',
    '{mode}外观。双击切换。',
  ),
  KailoMessageKey.platformThemeScrubber: (
    'Theme {index} of {count}',
    '第 {index} 个主题，共 {count} 个',
  ),
  KailoMessageKey.platformThemeCommunitySample: ('Community', '社区'),
  KailoMessageKey.platformSettingsConnection: ('Kailo connection', 'Kailo 连接'),
  KailoMessageKey.platformSettingsCopyDeviceKey: (
    'Copy device public key',
    '复制设备公钥',
  ),
  KailoMessageKey.platformSettingsIdentityUnavailable: (
    'Identity unavailable',
    '身份不可用',
  ),
  KailoMessageKey.platformSettingsDeviceKey: ('Device key', '设备密钥'),
  KailoMessageKey.platformSettingsKeyCopied: ('Pubkey copied', '公钥已复制'),
  KailoMessageKey.platformSettingsSignOutConfirm: (
    'This disconnects this device from your workspaces. The device stays registered; signing in again reconnects it.',
    '这会断开本机与工作区的连接。设备仍保持登记，再次登录即可重新连接。',
  ),
  KailoMessageKey.platformReasonWithCode: ('{text} ({code})', '{text}（{code}）'),
  KailoMessageKey.tasksNone: (
    'You have not started any governed action yet.',
    '你还没有发起过受治理的动作。',
  ),
  KailoMessageKey.tasksTitle: ('Task', '任务'),
  KailoMessageKey.tasksMyTitle: ('My tasks', '我的任务'),
  KailoMessageKey.tasksCreated: ('Started', '发起于'),
  KailoMessageKey.tasksOperation: ('Operation', '操作'),
  KailoMessageKey.tasksExecution: ('Action execution', '动作执行'),
  KailoMessageKey.tasksTarget: ('Target', '目标'),
  KailoMessageKey.tasksWorkflow: ('Workflow', 'Workflow'),
  KailoMessageKey.tasksWaitingReason: ('Waiting for', '正在等待'),
  KailoMessageKey.tasksReason: ('Reason', '原因'),
  KailoMessageKey.tasksApproval: ('Approval', '审批'),
  KailoMessageKey.tasksStatusEvaluating: ('Being evaluated', '正在判定'),
  KailoMessageKey.tasksStatusWaitingApproval: ('Waiting for approval', '等待审批'),
  KailoMessageKey.tasksStatusDenied: ('Not allowed', '未获准'),
  KailoMessageKey.tasksStatusRevoked: (
    'Withdrawn or no longer allowed',
    '已撤回或不再获准',
  ),
  KailoMessageKey.tasksStatusExpired: ('Expired', '已过期'),
  KailoMessageKey.tasksStatusNotStarted: (
    'Allowed, not started yet',
    '已获准，尚未开始',
  ),
  KailoMessageKey.tasksStatusAborted: (
    'Stopped before it took effect',
    '生效前已中止',
  ),
  KailoMessageKey.tasksStatusStarted: ('Started', '已开始'),
  KailoMessageKey.tasksStatusApplied: ('Applied', '已生效'),
  KailoMessageKey.tasksStatusRunning: ('Running', '进行中'),
  KailoMessageKey.tasksStatusCompleted: ('Completed', '已完成'),
  KailoMessageKey.tasksStatusFailed: ('Failed', '失败'),
  KailoMessageKey.tasksStatusCanceled: ('Canceled', '已取消'),
  KailoMessageKey.tasksStatusTerminated: ('Terminated', '已终止'),
  KailoMessageKey.tasksStatusTimedOut: ('Timed out', '已超时'),
  KailoMessageKey.tasksStatusUnknown: (
    'Outcome not known yet — waiting for reconciliation',
    '结果尚不明确，等待对账',
  ),
  KailoMessageKey.tasksStatusDelayed: (
    'Status may be out of date — waiting for reconciliation',
    '状态可能尚未更新，等待对账',
  ),
  KailoMessageKey.approvalsNone: (
    'Nothing is waiting for your approval.',
    '没有等待你审批的请求。',
  ),
  KailoMessageKey.approvalsPendingTitle: ('Waiting for my approval', '等待我审批'),
  KailoMessageKey.approvalsMobileReadOnly: (
    'To approve, deny or withdraw, open Kailo on the web or desktop.',
    '请在 Kailo Web 或 Desktop 上批准、拒绝或撤回。',
  ),
  KailoMessageKey.approvalsExpiresAt: ('Expires {time}', '{time} 到期'),
  KailoMessageKey.approvalsStatus: ('Approval state', '审批状态'),
  KailoMessageKey.approvalsExpires: ('Expires', '到期'),
  KailoMessageKey.approvalsInitiator: ('Requested by', '发起者'),
  KailoMessageKey.approvalsRequirements: ('Required approvals', '所需批准'),
  KailoMessageKey.approvalsRequirement: (
    '{selector}: at least {count}',
    '{selector}：至少 {count} 人',
  ),
  KailoMessageKey.approvalsDecisions: ('Decisions', '已有决定'),
  KailoMessageKey.approvalsNoDecisions: ('No decisions yet.', '还没有人决定。'),
  KailoMessageKey.approvalsApprove: ('Approve', '批准'),
  KailoMessageKey.approvalsDeny: ('Deny', '拒绝'),
  KailoMessageKey.approvalsConfirmDecision: (
    'Record your decision “{decision}”? It cannot be changed afterwards.',
    '记录你的决定「{decision}」？记录后不能更改。',
  ),
  KailoMessageKey.approvalsDecided: (
    'Your decision “{decision}” is recorded. The approval is now: {status}.',
    '你的决定「{decision}」已记录。审批当前状态：{status}。',
  ),
  KailoMessageKey.approvalsDecisionUnknown: (
    'Whether your decision was recorded is not known (operation {operation}). Sending the same decision again is safe.',
    '你的决定是否已记录尚不明确（操作 {operation}）。再次提交同一决定是安全的。',
  ),
  KailoMessageKey.approvalsSendAgain: (
    'Send the same decision again',
    '再次提交同一决定',
  ),
  KailoMessageKey.approvalsDecisionRejected: (
    'Your decision was not accepted: {reason}',
    '你的决定未被接受：{reason}',
  ),
  KailoMessageKey.approvalsWithdraw: ('Withdraw request', '撤回请求'),
  KailoMessageKey.approvalsConfirmWithdraw: (
    'Withdraw this approval request? The action will not be carried out.',
    '撤回这项审批请求？该动作将不会执行。',
  ),
  KailoMessageKey.approvalsWithdrawn: (
    'The request is now: {status}.',
    '请求当前状态：{status}。',
  ),
  KailoMessageKey.approvalsWithdrawUnknown: (
    'Whether the request was withdrawn is not known (operation {operation}). Refresh to check.',
    '请求是否已撤回尚不明确（操作 {operation}）。请刷新确认。',
  ),
  KailoMessageKey.approvalsWithdrawRejected: (
    'The request could not be withdrawn: {reason}',
    '请求未能撤回：{reason}',
  ),
  KailoMessageKey.invitationsTitle: ('Invitations', '邀请'),
  KailoMessageKey.invitationsExplain: (
    'An invitation link lets one person ask to join this organization. After they use it, an admin confirms it is really them (in Approvals).',
    '一条邀请链接让一个人申请加入本组织。对方使用后，由管理员在「审批」中确认确实是本人。',
  ),
  KailoMessageKey.invitationsInviteeLabel: ('Who is this for?', '邀请谁？'),
  KailoMessageKey.invitationsInviteeHint: (
    'A name you will recognize when confirming. It is not checked.',
    '确认时你能认出的称呼，不做校验。',
  ),
  KailoMessageKey.invitationsIssue: ('Create invitation link', '生成邀请链接'),
  KailoMessageKey.invitationsIssued: (
    'Invitation link for {label} (expires {expires}). It is shown only this once — copy it now. If it is lost, withdraw this invitation and create a new one.',
    '给 {label} 的邀请链接（{expires}到期）。它只显示这一次，请立即复制；丢失即撤回并重新生成。',
  ),
  KailoMessageKey.invitationsCopy: ('Copy link', '复制链接'),
  KailoMessageKey.invitationsCopied: ('Copied', '已复制'),
  KailoMessageKey.invitationsNoLink: (
    'The invitation exists, but its link can no longer be shown. Withdraw it and create a new one.',
    '邀请已存在，但链接无法再显示。请撤回后重新生成。',
  ),
  KailoMessageKey.invitationsIssueUnknown: (
    'Whether the invitation was created is not known (operation {operation}). Refresh the list; if it appears without a link you have, withdraw it and create a new one.',
    '邀请是否已生成尚不明确（操作 {operation}）。请刷新列表；若出现了你没拿到链接的邀请，撤回后重新生成。',
  ),
  KailoMessageKey.invitationsIssueRejected: (
    'The invitation was not created: {reason}',
    '邀请未生成：{reason}',
  ),
  KailoMessageKey.invitationsNone: ('No invitations yet.', '还没有邀请。'),
  KailoMessageKey.invitationsInvitee: ('For', '邀请对象'),
  KailoMessageKey.invitationsRedeemer: ('Used by (self-reported)', '使用者（自报）'),
  KailoMessageKey.invitationsConfirmation: ('Confirmation', '确认'),
  KailoMessageKey.invitationsWithdraw: ('Withdraw', '撤回'),
  KailoMessageKey.invitationsConfirmWithdraw: (
    'Withdraw the invitation for {label}? Its link will stop working.',
    '撤回给 {label} 的邀请？该链接将失效。',
  ),
  KailoMessageKey.invitationsWithdrawUnknown: (
    'Whether the invitation was withdrawn is not known (operation {operation}). Refresh to check.',
    '邀请是否已撤回尚不明确（操作 {operation}）。请刷新确认。',
  ),
  KailoMessageKey.invitationsWithdrawRejected: (
    'The invitation was not withdrawn: {reason}',
    '邀请未撤回：{reason}',
  ),
  KailoMessageKey.invitationsForApproval: (
    'Invitation for “{label}”, used by someone who calls themselves “{name}”. Confirm it is really them before approving.',
    '给「{label}」的邀请，使用者自称「{name}」。批准前请以其他方式确认确实是本人。',
  ),
  KailoMessageKey.redeemTitle: ('Join an organization', '加入组织'),
  KailoMessageKey.redeemExplain: (
    'You were sent an invitation. Tell the admin who you are; they will confirm it before you get access.',
    '你收到了一份邀请。告诉管理员你是谁，管理员确认后你才会获得访问权限。',
  ),
  KailoMessageKey.redeemDisplayName: ('Your name', '你的名字'),
  KailoMessageKey.redeemSubmit: ('Use this invitation', '使用邀请'),
  KailoMessageKey.redeemNoCredential: (
    'This page did not receive an invitation. If you came from an invitation link, open the link again now that you are signed in.',
    '本页没有收到邀请。如果你是从邀请链接来的，请在登录后再打开一次该链接。',
  ),
  KailoMessageKey.redeemUnknown: (
    'Whether the invitation was used is not known. Submitting again is safe.',
    '邀请是否已使用尚不明确。再次提交是安全的。',
  ),
  KailoMessageKey.redeemAgain: ('Submit again', '再次提交'),
  KailoMessageKey.redeemRejected: (
    'The invitation could not be used: {reason}',
    '邀请无法使用：{reason}',
  ),
  KailoMessageKey.redeemMine: ('My invitations', '我的邀请'),
  KailoMessageKey.redeemWaiting: (
    'Waiting for an admin of {tenant} to confirm it is you. You can close this page and come back later.',
    '等待 {tenant} 的管理员确认是你本人。你可以先关闭本页，稍后再来。',
  ),
  KailoMessageKey.redeemEvaluating: (
    'Your request to join {tenant} is being evaluated.',
    '加入 {tenant} 的请求正在判定。',
  ),
  KailoMessageKey.redeemProvisioning: (
    'Confirmed. Your access to {tenant} is being set up.',
    '已确认，正在开通你在 {tenant} 的访问权限。',
  ),
  KailoMessageKey.redeemActive: (
    'You are a member of {tenant}.',
    '你已是 {tenant} 的成员。',
  ),
  KailoMessageKey.redeemEnded: (
    'Your invitation to {tenant} has ended: {reason}',
    '你加入 {tenant} 的邀请已终结：{reason}',
  ),
  KailoMessageKey.redeemOther: ('{tenant}: {state}', '{tenant}：{state}'),
  KailoMessageKey.redeemContinue: ('Continue', '继续'),
  KailoMessageKey.redeemNativeHint: (
    'If you were invited, open your invitation link in the browser and sign in there. Once an admin confirms it, check again here.',
    '如果你收到了邀请，请在浏览器中打开邀请链接并登录；管理员确认后，回到这里重新确认。',
  ),
  KailoMessageKey.nativeConfigTitle: ('Connect to Kailo', '连接 Kailo'),
  KailoMessageKey.nativeConfigExplain: (
    'Enter the addresses your administrator gave you. Nothing is filled in for you: a guessed address would receive your sign-in and device key.',
    '填写管理员提供的地址。这里不预填任何值：猜测的地址会拿到你的登录与设备密钥。',
  ),
  KailoMessageKey.nativeConfigNativeApiUrl: (
    'Kailo native entry URL',
    'Kailo 原生入口地址',
  ),
  KailoMessageKey.nativeConfigOidcIssuer: (
    'Sign-in issuer (OIDC)',
    '登录 issuer（OIDC）',
  ),
  KailoMessageKey.nativeConfigOidcClientId: ('Client ID', '客户端 ID'),
  KailoMessageKey.nativeConfigServer: ('Server: {host}', '服务器：{host}'),
  KailoMessageKey.nativeConfigInvalidUrl: (
    '{field} is not a valid URL.',
    '{field} 不是有效的网址。',
  ),
  KailoMessageKey.nativeConfigInvalidScheme: (
    '{field} must use HTTP or HTTPS.',
    '{field} 必须使用 HTTP 或 HTTPS。',
  ),
  KailoMessageKey.nativeConfigInvalidExtras: (
    '{field} must not include a query or fragment.',
    '{field} 不能包含查询参数或片段。',
  ),
  KailoMessageKey.nativeConfigInvalidUserInfo: (
    '{field} must not include user information.',
    '{field} 不能包含用户信息。',
  ),
  KailoMessageKey.nativeConfigClientIdRequired: (
    'Client ID is required.',
    '必须填写客户端 ID。',
  ),
  KailoMessageKey.nativeConfigSave: ('Save and continue', '保存并继续'),
  KailoMessageKey.nativeConfigSaving: ('Saving…', '正在保存…'),
  KailoMessageKey.nativeConfigEdit: ('Change connection settings', '修改连接设置'),
  KailoMessageKey.nativeConfigRejected: (
    'These settings were not accepted: {message}',
    '设置未被接受：{message}',
  ),
  KailoMessageKey.nativeSignInTitle: ('Sign in to Kailo', '登录 Kailo'),
  KailoMessageKey.nativeSignInExplain: (
    'Sign-in opens in your system browser. Come back here when it is done.',
    '登录会在系统浏览器中打开，完成后回到这里。',
  ),
  KailoMessageKey.nativeSignInStart: ('Sign in', '登录'),
  KailoMessageKey.nativeSignInWaiting: (
    'Waiting for sign-in to finish in your browser…',
    '正在等待浏览器中的登录完成…',
  ),
  KailoMessageKey.nativeSignInCancel: ('Cancel', '取消'),
  KailoMessageKey.nativeSignInFailed: (
    'Sign-in did not complete: {message}',
    '登录未完成：{message}',
  ),
  KailoMessageKey.nativeStatusUnconfigured: (
    'Kailo is not set up on this device.',
    '本机尚未配置 Kailo。',
  ),
  KailoMessageKey.nativeStatusSignedOut: ('Signed out.', '已退出登录。'),
  KailoMessageKey.nativeStatusAwaitingActivation: (
    'Waiting for this device to be added to your workspaces…',
    '正在等待本机加入你的工作区…',
  ),
  KailoMessageKey.nativeStatusLinked: ('Connected.', '已连接。'),
  KailoMessageKey.nativeStatusFailed: ('Could not connect.', '未能连接。'),
  KailoMessageKey.nativeStatusOutcomeUnknown: (
    'The outcome is not known yet.',
    '结果尚不明确。',
  ),
  KailoMessageKey.nativeErrorHttpOutcomeUnknown: (
    'Kailo answered HTTP {status}; the outcome is not known.',
    'Kailo 返回 HTTP {status}；结果尚不明确。',
  ),
  KailoMessageKey.nativeErrorUnavailable: (
    'Kailo could not be reached; the outcome is not known.',
    '无法连接 Kailo；结果尚不明确。',
  ),
  KailoMessageKey.nativeErrorContract: (
    'Kailo answered outside the contract; the outcome is not known.',
    'Kailo 的响应不符合契约；结果尚不明确。',
  ),
  KailoMessageKey.nativeErrorSessionEnded: (
    'Your Kailo sign-in has ended.',
    '你的 Kailo 登录已失效。',
  ),
  KailoMessageKey.nativeErrorSignInAgain: ('Sign in again', '重新登录'),
  KailoMessageKey.nativeUnavailableTitle: ('Not available here', '此处不可用'),
  KailoMessageKey.nativeDeviceRegistering: (
    'Registering this device…',
    '正在登记本机…',
  ),
  KailoMessageKey.nativeDevicePending: (
    'This device is being added ({state}). This usually takes a moment; check again to continue.',
    '正在添加本机（{state}），通常片刻即可完成；完成后点「重新确认」继续。',
  ),
  KailoMessageKey.nativeDeviceUnknown: (
    'The registration result is unknown{operation}. Check again before doing anything else.',
    '登记结果不明{operation}。请先重新确认，再做其他操作。',
  ),
  KailoMessageKey.nativeDeviceRejected: (
    'This device could not be registered ({reason}).',
    '本机无法登记（{reason}）。',
  ),
  KailoMessageKey.nativeDeviceRevoked: (
    'This device\'s key has been revoked. It cannot be used again; ask your administrator.',
    '本机密钥已被撤销，不能再次使用；请联系管理员。',
  ),
  KailoMessageKey.nativeDeviceCheck: ('Check again', '重新确认'),
  KailoMessageKey.nativeCommunityLoading: (
    'Finding your community…',
    '正在获取 Community 连接信息…',
  ),
  KailoMessageKey.nativeCommunityFailed: (
    'Couldn\'t get your community\'s connection details{reason}.',
    '未能取得 Community 连接信息{reason}。',
  ),
  KailoMessageKey.nativeConnectFailed: (
    'Couldn\'t connect to your community: {message}',
    '未能连接 Community：{message}',
  ),
};

String kailoText(
  KailoMessageKey key, {
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

String kailoApprovalStatusText(ApprovalStatus value, {String? locale}) {
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

String kailoTenantInvitationStatusText(
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

String kailoTenantMembershipStateText(
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

String kailoWorkspaceMembershipStateText(
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

String kailoBuzzIdentityStateText(BuzzIdentityState value, {String? locale}) {
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

String kailoAuditEventTypeText(AuditEventType value, {String? locale}) {
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

String kailoApprovalDecisionText(ApprovalDecision value, {String? locale}) {
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

String kailoApprovalSelectorText(ApprovalSelector value, {String? locale}) {
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
