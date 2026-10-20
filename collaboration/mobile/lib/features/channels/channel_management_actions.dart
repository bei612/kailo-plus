import 'dart:convert';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../shared/auth/auth.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';
import 'channel.dart';
import 'channel_management_provider.dart' show currentPubkeyProvider;
import 'channels_provider.dart';

/// A recorded creation is not a created channel. Only its exact task and native
/// membership read-back can complete the original sheet (DD-48/75/80).
class ChannelCreationPending implements Exception {
  const ChannelCreationPending(this.submission);
  final ActionSubmission? submission;
}

/// A definitive original action outcome, not a failed observation request.
class ChannelCreationEnded implements Exception {
  const ChannelCreationEnded(this.task);
  final TaskView task;
}

/// Restores only the upstream create-channel consumer. Management travels through
/// NativeSession/BFF; channel content and roster are still read with local keys.
class ChannelActions {
  ChannelActions(
    this._ref,
    this._config,
    this._actor,
    this._prefs,
    this._current,
  );

  final Ref _ref;
  final PlatformConfig _config;
  final PlatformSessionView _actor;
  final SharedPreferences _prefs;
  final bool Function() _current;
  ActionCommand? _command;
  ActionSubmission? _submission;
  bool _busy = false;

  /// The original local intent survives sheet dismissal and process restart.
  /// It contains no credential or independently invented execution status.
  ActionCommand? get pendingCommand => _command;
  ActionSubmission? get submission => _submission;

  String get _storageKey =>
      'platform.channel-create.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:${_actor.tenantPrincipalId}';

  void _fence() {
    if (!_current()) {
      throw const PlatformUnavailable('The platform session changed');
    }
  }

  void _restore() {
    final saved = _prefs.getString(_storageKey);
    if (saved == null) return;
    final json = jsonDecode(saved) as Map<String, dynamic>;
    final command = ActionCommand.fromJson(json['command']);
    if (command.actionKey !=
            roleWorkspacePageCreateActionKeyValues
                .reverse[RoleWorkspacePageCreateActionKey.WORKSPACE_CREATE] ||
        command.idempotencyKey.isEmpty ||
        command.slug != command.idempotencyKey ||
        command.name?.trim().isNotEmpty != true ||
        command.workspaceVisibility == null ||
        command.workspaceChannel?.channelType !=
            WorkspaceChannelCreateChannelType.STREAM) {
      throw const FormatException('Invalid original channel creation intent');
    }
    _command = command;
    if (json['submission'] != null) {
      _submission = ActionSubmission.fromJson(json['submission']);
      _validateSubmission(_submission!);
    }
  }

  Future<void> _persist() async {
    _fence();
    final command = _command;
    final stored = command == null
        ? await _prefs.remove(_storageKey)
        : await _prefs.setString(
            _storageKey,
            jsonEncode({
              'command': command.toJson(),
              if (_submission != null) 'submission': _submission!.toJson(),
            }),
          );
    _fence();
    if (!stored) throw const PlatformUnavailable('Original intent not stored');
  }

  Future<PlatformResponse> _send(
    PlatformMethod method,
    String path, {
    Object? body,
  }) async {
    _fence();
    final response = await _ref
        .read(nativeSessionProvider)
        .send(_config, method, path, body: body);
    _fence();
    return response;
  }

  Future<void> _checkActor() async {
    final response = await _send(PlatformMethod.get, '/api/v1/session');
    if (response.status != 200) throw PlatformApiError(response);
    final actor = PlatformSessionView.fromJson(
      response.body! as Map<String, dynamic>,
    );
    if (actor.platformSessionId != _actor.platformSessionId ||
        actor.tenantId != _actor.tenantId ||
        actor.tenantPrincipalId != _actor.tenantPrincipalId ||
        actor.accessMode != PlatformSessionAccessMode.FULL) {
      throw const PlatformUnavailable('The platform session changed');
    }
  }

  /// Creates one frozen intent; a second submission cannot replace a pending one.
  Future<Channel> createChannel({
    required String name,
    required String channelType,
    required String visibility,
    String? description,
    int? ttlSeconds,
  }) async {
    if (_busy || _command != null) throw ChannelCreationPending(_submission);
    if (name.trim().isEmpty ||
        channelType != 'stream' ||
        !workspaceVisibilityValues.map.containsKey(visibility)) {
      throw const FormatException('Invalid channel creation');
    }
    _busy = true;
    try {
      await _checkActor();
      final response = await _send(
        PlatformMethod.get,
        '/api/v1/role-workspaces',
      );
      if (response.status != 200) throw PlatformApiError(response);
      final page = RoleWorkspacePage.fromJson(
        response.body! as Map<String, dynamic>,
      );
      if (page.createActionKey !=
          RoleWorkspacePageCreateActionKey.WORKSPACE_CREATE) {
        throw const PlatformApiError(PlatformResponse(403, null));
      }
      final key = const Uuid().v4();
      _command = ActionCommand(
        actionKey: roleWorkspacePageCreateActionKeyValues
            .reverse[page.createActionKey]!,
        idempotencyKey: key,
        name: name.trim(),
        slug: key,
        workspaceVisibility: workspaceVisibilityValues.map[visibility]!,
        workspaceChannel: WorkspaceChannelCreate(
          channelType: WorkspaceChannelCreateChannelType.STREAM,
          description: description?.trim().isNotEmpty == true
              ? description!.trim()
              : null,
          ttlSeconds: ttlSeconds,
        ),
      );
      // Persist before crossing the POST seam. A crash cannot lose the key and
      // silently create another business intent on the next sheet mount.
      await _persist();
      return await _submitOriginal(firstSubmission: true);
    } finally {
      _busy = false;
    }
  }

  /// User-triggered reconciliation only. Once a submission reference is known,
  /// no POST is made; an unacknowledged POST reuses its exact original bytes/key.
  Future<Channel> recheckCreation() async {
    if (_busy || _command == null) throw ChannelCreationPending(_submission);
    _busy = true;
    try {
      await _checkActor();
      return _submission == null ? await _submitOriginal() : await _observe();
    } finally {
      _busy = false;
    }
  }

  void _validateSubmission(ActionSubmission submission) {
    if (submission.actionKey != _command?.actionKey ||
        submission.actionExecutionId.isEmpty ||
        submission.operationId.isEmpty ||
        (submission.gateState == ActionGateState.DENIED &&
            submission.reason == null) ||
        (submission.gateState == ActionGateState.WAITING &&
            submission.approvalWorkflowId == null)) {
      throw const FormatException('Invalid channel creation submission');
    }
  }

  Future<Channel> _submitOriginal({bool firstSubmission = false}) async {
    final response = await _send(
      PlatformMethod.post,
      '/api/v1/actions',
      body: _command!.toJson(),
    );
    if (!response.isSuccess) {
      final error = response.error;
      if (firstSubmission &&
          error != null &&
          error.errorBodyClass != ErrorClass.UNKNOWN) {
        await _clear();
      }
      throw PlatformApiError(response);
    }
    final submission = ActionSubmission.fromJson(
      response.body! as Map<String, dynamic>,
    );
    _validateSubmission(submission);
    _submission = submission;
    await _persist();
    return _observe();
  }

  Future<Channel> _observe() async {
    final submission = _submission!;
    final response = await _send(
      PlatformMethod.get,
      '/api/v1/tasks/${Uri.encodeComponent(submission.actionExecutionId)}',
    );
    if (response.status != 200) throw PlatformApiError(response);
    final task = TaskView.fromJson(response.body! as Map<String, dynamic>);
    if (task.actionExecutionId != submission.actionExecutionId ||
        task.operationId != submission.operationId ||
        task.actionKey != submission.actionKey ||
        task.actionVersion <= 0 ||
        (submission.workflowId != null &&
            task.workflowId != submission.workflowId)) {
      throw const FormatException('Channel creation observation mismatch');
    }
    if (task.observation != null ||
        task.dispatchState == ActionDispatchState.UNKNOWN) {
      throw ChannelCreationPending(submission);
    }
    if (task.gateState == ActionGateState.DENIED ||
        task.gateState == ActionGateState.REVOKED ||
        task.gateState == ActionGateState.EXPIRED ||
        task.dispatchState == ActionDispatchState.ABORTED ||
        (task.taskStatus != null &&
            task.taskStatus != TaskStatus.RUNNING &&
            task.taskStatus != TaskStatus.COMPLETED)) {
      await _clear();
      throw ChannelCreationEnded(task);
    }
    if (task.gateState != ActionGateState.ALLOWED ||
        task.dispatchState != ActionDispatchState.DISPATCHED ||
        task.taskStatus != TaskStatus.COMPLETED ||
        task.workflowKind != WorkflowKind.WORKSPACE_LIFECYCLE ||
        task.workflowId?.isNotEmpty != true ||
        task.targetId.isEmpty ||
        (task.workspaceId != null && task.workspaceId != task.targetId)) {
      throw ChannelCreationPending(submission);
    }
    final workspaces = await _send(PlatformMethod.get, '/api/v1/workspaces');
    if (workspaces.status != 200) throw PlatformApiError(workspaces);
    final matches = [
      for (final row in workspaces.body! as List<dynamic>)
        WorkspaceView.fromJson(row as Map<String, dynamic>),
    ].where((row) => row.id == task.targetId).toList();
    if (matches.length != 1 ||
        matches.single.isMember != true ||
        matches.single.slug != _command!.slug ||
        _ref.read(relaySessionProvider).status != SessionStatus.connected) {
      throw ChannelCreationPending(submission);
    }
    await _ref.read(channelsProvider.notifier).refresh();
    _fence();
    final channels = await _ref.read(channelsProvider.future);
    _fence();
    final native = channels
        .where(
          (channel) =>
              channel.id == task.targetId &&
              channel.isMember &&
              !channel.isArchived,
        )
        .toList();
    if (native.length != 1) throw ChannelCreationPending(submission);
    final channel = native.single;
    await _clear();
    _ref.invalidate(platformWorkspacesProvider);
    return channel;
  }

  Future<void> _clear() async {
    // Removal must succeed before a new intent is allowed. Keep the original
    // snapshot if local persistence fails after a confirmed server outcome.
    final command = _command;
    final submission = _submission;
    _command = null;
    _submission = null;
    try {
      await _persist();
    } on Object {
      _command = command;
      _submission = submission;
      rethrow;
    }
  }
}

/// Fresh create hint only; it is not permission authority for action submission.
final channelCreateRoleProvider = FutureProvider<RoleWorkspacePage>((
  ref,
) async {
  ref.watch(authProvider.select((auth) => auth.value?.community?.id));
  final config = ref.watch(platformConfigProvider);
  if (config == null) throw const PlatformNotSignedIn();
  final response = await ref
      .read(nativeSessionProvider)
      .send(config, PlatformMethod.get, '/api/v1/role-workspaces');
  if (response.status != 200) throw PlatformApiError(response);
  return RoleWorkspacePage.fromJson(response.body! as Map<String, dynamic>);
}, retry: (count, error) => null);

/// Scope-local holder of the persisted upstream creation intent, not a second
/// workflow/identity registry. All execution facts are reread from Core.
final channelActionsProvider = FutureProvider<ChannelActions>((ref) async {
  final community = ref.watch(
    authProvider.select((auth) => auth.value?.community?.id),
  );
  final config = ref.watch(platformConfigProvider);
  final pubkey = ref.watch(currentPubkeyProvider);
  final actor = await ref.watch(platformSessionViewProvider.future);
  if (config == null || community == null || pubkey == null) {
    throw const PlatformNotSignedIn();
  }
  var active = true;
  ref.onDispose(() => active = false);
  final actions = ChannelActions(
    ref,
    config,
    actor,
    ref.read(savedPrefsProvider),
    () =>
        active &&
        ref.read(platformConfigProvider) == config &&
        ref.read(authProvider).value?.community?.id == community &&
        ref.read(currentPubkeyProvider) == pubkey,
  );
  actions._restore();
  return actions;
}, retry: (count, error) => null);
