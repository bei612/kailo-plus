// DD-119/DD-41/DD-82 channel management for the restored Mobile channel details, members, add
// members and manage-channel sheets (Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_management_provider.dart::ChannelActions.{updateChannel,
// joinChannel,leaveChannel,archiveChannel,unarchiveChannel,addMembers,removeMember,
// changeMemberRole}). Mobile's native key cannot change a channel or its roster (DD-80), so every
// entry is an existing governed ActionCommand sent through the BFF, the same flow as client-kit's
// channel-management-actions.ts and roles.tsx useMemberAction:
//
// - entries appear only for the BFF's action hints (discoverable-workspaces update/join/leave,
//   role-workspaces lifecycle and delete (DD-150), role-members add/remove/admin); Core re-admits
//   every submission;
// - a new intent is frozen with its idempotency key before it is sent; an unknown outcome keeps
//   it and only that same command can be resent; a definite answer settles it (DD-81);
// - recorded or approval-pending is not done: the sheet says so and the views are reread.
import 'dart:async';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../shared/auth/auth.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_views.dart';
import '../platform/platform_async_view.dart';
import 'channels_provider.dart';

/// The answer to one governed channel submission.
sealed class ChannelActionOutcome {
  const ChannelActionOutcome();
}

/// Admitted and dispatched; the change still has to be read back.
class ChannelActionRecorded extends ChannelActionOutcome {
  const ChannelActionRecorded(this.operation);
  final String operation;
}

/// Waiting for an approval; the result is in Tasks.
class ChannelActionWaiting extends ChannelActionOutcome {
  const ChannelActionWaiting(this.operation);
  final String operation;
}

/// Recorded but not carried out.
class ChannelActionAborted extends ChannelActionOutcome {
  const ChannelActionAborted(this.operation, this.reason);
  final String operation;
  final ReasonCode? reason;
}

/// Not known whether Core accepted it; only the same command may be resent.
class ChannelActionUnknown extends ChannelActionOutcome {
  const ChannelActionUnknown(this.operation);
  final String? operation;
}

/// A definite refusal: [reason] from the admission receipt, or [error] from the request.
class ChannelActionRejected extends ChannelActionOutcome {
  const ChannelActionRejected({this.reason, this.error});
  final ReasonCode? reason;
  final Object? error;
}

/// The original sheet's status line for [outcome] (client-kit channelActionOutcomeText).
String channelActionOutcomeText(
  ChannelActionOutcome outcome, {
  String? locale,
}) => switch (outcome) {
  ChannelActionRecorded(:final operation) => platformText(
    PlatformMessageKey.channelManagementActionRecorded,
    locale: locale,
    variables: {'operation': operation},
  ),
  ChannelActionWaiting(:final operation) => platformText(
    PlatformMessageKey.channelManagementActionWaiting,
    locale: locale,
    variables: {'operation': operation},
  ),
  ChannelActionUnknown(:final operation) => platformText(
    PlatformMessageKey.workspaceLifecycleUnknown,
    locale: locale,
    variables: {'operation': operation ?? '—'},
  ),
  ChannelActionAborted(:final operation, :final reason) => platformText(
    PlatformMessageKey.workspaceLifecycleAborted,
    locale: locale,
    variables: {
      'operation': operation,
      'reason': reason == null
          ? actionDispatchStateValues.reverse[ActionDispatchState.ABORTED]!
          : platformReasonText(reason, locale: locale),
    },
  ),
  ChannelActionRejected(:final reason, :final error) => platformText(
    PlatformMessageKey.workspaceLifecycleRejected,
    locale: locale,
    variables: {
      'reason': reason != null
          ? platformReasonText(reason, locale: locale)
          : platformErrorText(
              error ?? const PlatformUnavailable(''),
              locale: locale,
            ),
    },
  ),
};

/// Frozen governed intents for the current platform session, one per slot (an action on one
/// channel or member). Reopening a sheet finds the same unknown intent; a new session drops them.
class ChannelGovernedActions {
  ChannelGovernedActions(this._ref, this._config, this._current);

  final Ref _ref;
  final PlatformConfig _config;
  final bool Function() _current;
  final Map<String, ActionCommand> _retained = {};
  final Map<String, String> _retainedOperation = {};
  final Set<String> _inFlight = {};

  /// The retained command for [slot] after an unknown outcome.
  ActionCommand? retained(String slot) => _retained[slot];

  bool busy(String slot) => _inFlight.contains(slot);

  /// Sends a new intent built by [build], or the retained intent unchanged.
  Future<ChannelActionOutcome?> submit(
    String slot,
    ActionCommand Function(String idempotencyKey) build,
  ) async {
    if (!_inFlight.add(slot)) return null;
    final retained = _retained[slot];
    final command = retained ?? build(const Uuid().v4());
    final priorOperation = retained == null ? null : _retainedOperation[slot];
    _retained[slot] = command;
    try {
      final outcome = await _send(
        command,
        priorOperation,
        retried: retained != null,
      );
      if (outcome is ChannelActionUnknown) {
        final operation = outcome.operation;
        if (operation != null) _retainedOperation[slot] = operation;
      } else {
        _retained.remove(slot);
        _retainedOperation.remove(slot);
      }
      return outcome;
    } finally {
      _inFlight.remove(slot);
    }
  }

  Future<ChannelActionOutcome> _send(
    ActionCommand command,
    String? priorOperation, {
    required bool retried,
  }) async {
    final PlatformResponse response;
    try {
      if (!_current()) throw const PlatformUnavailable('session changed');
      response = await _ref
          .read(nativeSessionProvider)
          .send(
            _config,
            PlatformMethod.post,
            '/api/v1/actions',
            body: command.toJson(),
          );
    } on PlatformNotSignedIn catch (error) {
      // Refused before admission; a re-check refusal says nothing about the first write.
      return retried
          ? ChannelActionUnknown(priorOperation)
          : ChannelActionRejected(error: error);
    } on Exception {
      return ChannelActionUnknown(priorOperation);
    }
    if (!response.isSuccess) {
      final error = response.error;
      if (error == null ||
          error.errorBodyClass == ErrorClass.UNKNOWN ||
          retried) {
        return ChannelActionUnknown(priorOperation);
      }
      return ChannelActionRejected(error: PlatformApiError(response));
    }
    final ActionSubmission receipt;
    try {
      receipt = ActionSubmission.fromJson(
        response.body! as Map<String, dynamic>,
      );
    } on Object {
      return ChannelActionUnknown(priorOperation);
    }
    if (receipt.actionKey != command.actionKey ||
        receipt.actionExecutionId.isEmpty ||
        receipt.operationId.isEmpty ||
        (priorOperation != null && receipt.operationId != priorOperation)) {
      return ChannelActionUnknown(priorOperation);
    }
    final gate = receipt.gateState;
    final dispatch = receipt.dispatchState;
    if (dispatch == ActionDispatchState.UNKNOWN ||
        gate == ActionGateState.EVALUATING ||
        (gate == ActionGateState.ALLOWED &&
            dispatch == ActionDispatchState.NOT_DISPATCHED)) {
      return ChannelActionUnknown(receipt.operationId);
    }
    if (dispatch == ActionDispatchState.ABORTED) {
      return ChannelActionAborted(receipt.operationId, receipt.reason);
    }
    if (gate == ActionGateState.ALLOWED) {
      _readBack(command.workspaceId);
      return ChannelActionRecorded(receipt.operationId);
    }
    if (gate == ActionGateState.WAITING) {
      _readBack(command.workspaceId);
      return ChannelActionWaiting(receipt.operationId);
    }
    return ChannelActionRejected(reason: receipt.reason);
  }

  /// Reread the views the change shows up in; reads only, never a resend.
  void _readBack(String? workspaceId) {
    if (!_current()) return;
    _ref.invalidate(platformWorkspacesProvider);
    if (workspaceId != null) {
      _ref.invalidate(platformWorkspaceMembersProvider(workspaceId));
      _ref.invalidate(channelManagementHintsProvider(workspaceId));
      _ref.invalidate(channelRoleMembersProvider(workspaceId));
    }
    unawaited(_ref.read(channelsProvider.notifier).refresh());
  }

  // The original channel management entry points, each one governed action.

  Future<ChannelActionOutcome?> updateChannel({
    required String workspaceId,
    String? name,
    String? description,
  }) => submit(
    'update:$workspaceId',
    (key) => ActionCommand(
      actionKey: _update,
      idempotencyKey: key,
      workspaceId: workspaceId,
      workspaceUpdate: WorkspaceUpdate(name: name, description: description),
    ),
  );

  Future<ChannelActionOutcome?> reopenChannel(String workspaceId) => submit(
    'reopen:$workspaceId',
    (key) => ActionCommand(
      actionKey: _update,
      idempotencyKey: key,
      workspaceId: workspaceId,
      workspaceUpdate: WorkspaceUpdate(reopen: true),
    ),
  );

  Future<ChannelActionOutcome?> joinChannel(String workspaceId) => submit(
    'join:$workspaceId',
    (key) => ActionCommand(
      actionKey: discoverableWorkspaceJoinActionKeyValues
          .reverse[DiscoverableWorkspaceJoinActionKey.WORKSPACE_JOIN]!,
      idempotencyKey: key,
      workspaceId: workspaceId,
    ),
  );

  Future<ChannelActionOutcome?> leaveChannel(String workspaceId) => submit(
    'leave:$workspaceId',
    (key) => ActionCommand(
      actionKey: discoverableWorkspaceLeaveActionKeyValues
          .reverse[DiscoverableWorkspaceLeaveActionKey.WORKSPACE_LEAVE]!,
      idempotencyKey: key,
      workspaceId: workspaceId,
    ),
  );

  /// Archive is `workspace.suspend`, unarchive `workspace.restore` (DD-119).
  Future<ChannelActionOutcome?> changeLifecycle(
    String workspaceId,
    WorkspaceLifecycleActionKey action,
  ) => submit(
    'lifecycle:$workspaceId',
    (key) => ActionCommand(
      actionKey: workspaceLifecycleActionKeyValues.reverse[action]!,
      idempotencyKey: key,
      workspaceId: workspaceId,
    ),
  );

  /// The original deleteChannel is the governed `workspace.delete` (DD-150) with explicit
  /// confirmation; a recorded delete is not done until Core confirms every step.
  Future<ChannelActionOutcome?> deleteChannel(String workspaceId) => submit(
    'delete:$workspaceId',
    (key) => ActionCommand(
      actionKey: workspaceDeleteAction,
      idempotencyKey: key,
      workspaceId: workspaceId,
      explicitConfirmation: true,
    ),
  );

  /// `workspace.member.add`, `workspace.member.revoke`, `workspace.admin.grant` or
  /// `workspace.admin.revoke` for one person.
  Future<ChannelActionOutcome?> changeMember({
    required String workspaceId,
    required String principalId,
    required String actionKey,
  }) => submit(
    '$actionKey:$workspaceId:$principalId',
    (key) => ActionCommand(
      actionKey: actionKey,
      idempotencyKey: key,
      workspaceId: workspaceId,
      principalId: principalId,
    ),
  );

  static final _update = discoverableWorkspaceUpdateActionKeyValues
      .reverse[DiscoverableWorkspaceUpdateActionKey.WORKSPACE_UPDATE]!;
}

const workspaceDeleteAction = 'workspace.delete';
const workspaceMemberAddAction = 'workspace.member.add';
const workspaceMemberRevokeAction = 'workspace.member.revoke';
const workspaceAdminGrantAction = 'workspace.admin.grant';
const workspaceAdminRevokeAction = 'workspace.admin.revoke';

final channelGovernedActionsProvider = Provider<ChannelGovernedActions>((ref) {
  final community = ref.watch(
    authProvider.select((auth) => auth.value?.community?.id),
  );
  final config = ref.watch(platformConfigProvider);
  if (config == null || community == null) throw const PlatformNotSignedIn();
  var active = true;
  ref.onDispose(() => active = false);
  return ChannelGovernedActions(
    ref,
    config,
    () =>
        active &&
        ref.read(platformConfigProvider) == config &&
        ref.read(authProvider).value?.community?.id == community,
  );
});

/// BFF action hints for one Workspace channel; a missing key means no entry is shown.
class ChannelManagementHints {
  const ChannelManagementHints({
    this.updateActionKey,
    this.canReopen = false,
    this.leaveActionKey,
    this.joinActionKey,
    this.lifecycleActionKey,
    this.deleteActionKey,
    this.deleting = false,
  });

  final DiscoverableWorkspaceUpdateActionKey? updateActionKey;

  /// With [updateActionKey]: archived by the TTL reaper, only reopen is offered.
  final bool canReopen;
  final DiscoverableWorkspaceLeaveActionKey? leaveActionKey;

  /// Original canJoin: a non-member of an open, unarchived channel.
  final DiscoverableWorkspaceJoinActionKey? joinActionKey;
  final WorkspaceLifecycleActionKey? lifecycleActionKey;

  /// DD-150: the role projection offers `workspace.delete`.
  final String? deleteActionKey;

  /// DD-150: an admitted delete is still converging (role row state DELETING).
  final bool deleting;
}

const _maxHintPages = 50;

Future<Map<String, dynamic>> _readPage(Ref ref, String path) async {
  final config = ref.read(platformConfigProvider);
  if (config == null) throw const PlatformNotSignedIn();
  final response = await ref
      .read(nativeSessionProvider)
      .send(config, PlatformMethod.get, path);
  if (response.status != 200) throw PlatformApiError(response);
  return response.body! as Map<String, dynamic>;
}

/// The discoverable-directory row and role-projection lifecycle hint for one channel.
final channelManagementHintsProvider = FutureProvider.autoDispose
    .family<ChannelManagementHints, String>((ref, workspaceId) async {
      ref.watch(platformConfigProvider);
      DiscoverableWorkspace? row;
      String? cursor;
      for (var page = 0; page < _maxHintPages && row == null; page++) {
        final query = {'channelId': workspaceId, 'cursor': ?cursor};
        final body = await _readPage(
          ref,
          '/api/v1/discoverable-workspaces?${Uri(queryParameters: query).query}',
        );
        final result = DiscoverableWorkspacePage.fromJson(body);
        row = result.items.where((item) => item.id == workspaceId).firstOrNull;
        if (result.nextCursor == null || result.nextCursor == cursor) break;
        cursor = result.nextCursor;
      }
      WorkspaceLifecycleActionKey? lifecycle;
      String? delete;
      var deleting = false;
      try {
        int? offset;
        for (var page = 0; page < _maxHintPages; page++) {
          final body = await _readPage(
            ref,
            '/api/v1/role-workspaces${offset == null ? '' : '?offset=$offset'}',
          );
          final result = RoleWorkspacePage.fromJson(body);
          final match = result.workspaces
              .where((item) => item.id == workspaceId)
              .firstOrNull;
          if (match != null) {
            lifecycle = match.lifecycleActionKey;
            final offered = match.toJson()['deleteActionKey'];
            delete = offered == workspaceDeleteAction
                ? workspaceDeleteAction
                : null;
            deleting = match.state == WorkspaceState.DELETING;
            break;
          }
          final next = result.nextOffset;
          if (next == null || next <= (offset ?? 0)) break;
          offset = next;
        }
      } on PlatformApiError catch (error) {
        // No Tenant manage permission only removes the archive and delete entries.
        if (error.response.status != 403) rethrow;
      }
      if (row == null) {
        return ChannelManagementHints(
          lifecycleActionKey: lifecycle,
          deleteActionKey: delete,
          deleting: deleting,
        );
      }
      return ChannelManagementHints(
        updateActionKey: row.updateActionKey,
        canReopen: row.updateActionKey != null && row.canReopen == true,
        leaveActionKey: row.leaveActionKey,
        joinActionKey: row.isMember || row.channel.archived
            ? null
            : row.joinActionKey,
        lifecycleActionKey: lifecycle,
        deleteActionKey: delete,
        deleting: deleting,
      );
    }, retry: (count, error) => null);

/// The role projection for one channel: who may be added, removed or made admin. Null when
/// the caller holds no manage permission (403 only removes management entries).
final channelRoleMembersProvider = FutureProvider.autoDispose
    .family<Map<String, RoleMemberView>?, String>((ref, workspaceId) async {
      ref.watch(platformConfigProvider);
      final members = <String, RoleMemberView>{};
      String? cursor;
      try {
        for (var page = 0; page < _maxHintPages; page++) {
          final query = {'workspaceId': workspaceId, 'cursor': ?cursor};
          final body = await _readPage(
            ref,
            '/api/v1/role-members?${Uri(queryParameters: query).query}',
          );
          final result = RoleMemberPage.fromJson(body);
          for (final member in result.members) {
            members[member.principalId] = member;
          }
          if (result.nextCursor == null || result.nextCursor == cursor) break;
          cursor = result.nextCursor;
        }
      } on PlatformApiError catch (error) {
        if (error.response.status == 403) return null;
        rethrow;
      }
      return members;
    }, retry: (count, error) => null);
