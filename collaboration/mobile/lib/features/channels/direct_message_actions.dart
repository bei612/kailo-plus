part of 'direct_messages.dart';

extension _DirectMessageActions on DirectMessages {
  String get _storageKey =>
      'platform.conversation-open.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:$principalId';

  void _restore() {
    final saved = _prefs.getString(_storageKey);
    if (saved == null) return;
    final json = jsonDecode(saved) as Map<String, dynamic>;
    final command = ActionCommand.fromJson(json['command']);
    final ids = command.conversationOpen?.participantPrincipalIds;
    if (command.actionKey != 'conversation.open' ||
        command.idempotencyKey.isEmpty ||
        ids == null ||
        ids.length < 2 ||
        !ids.contains(principalId) ||
        ids.toSet().length != ids.length ||
        !listEquals(ids, [...ids]..sort())) {
      throw const FormatException('Invalid original conversation intent');
    }
    _command = command;
    if (json['submission'] != null) {
      _submission = ActionSubmission.fromJson(json['submission']);
      _validateSubmission(_submission!);
    }
    if (json['reopen'] != null) {
      _reopen = NostrEvent.fromJson(json['reopen']);
      _validateReopen(_reopen!);
    }
  }

  Future<void> _persist() async {
    _fence();
    final stored = _command == null
        ? await _prefs.remove(_storageKey)
        : await _prefs.setString(
            _storageKey,
            jsonEncode({
              'command': _command!.toJson(),
              if (_submission != null) 'submission': _submission!.toJson(),
              if (_reopen != null) 'reopen': _reopen!.toJson(),
            }),
          );
    _fence();
    if (!stored) {
      throw const PlatformUnavailable(
        'Original conversation intent not stored',
      );
    }
  }

  Future<void> _clear() async {
    final command = _command;
    final submission = _submission;
    final reopen = _reopen;
    _command = null;
    _submission = null;
    _reopen = null;
    try {
      await _persist();
    } on Object {
      _command = command;
      _submission = submission;
      _reopen = reopen;
      rethrow;
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
      throw const FormatException('Invalid conversation submission');
    }
  }

  Future<Channel> _submitOriginal({bool firstSubmission = false}) async {
    PlatformResponse response;
    try {
      response = await _send(
        PlatformMethod.post,
        '/api/v1/actions',
        body: _command!.toJson(),
      );
    } on PlatformApiError catch (error) {
      if (firstSubmission &&
          error.response.error != null &&
          error.response.error!.errorBodyClass != ErrorClass.UNKNOWN) {
        await _clear();
      }
      rethrow;
    }
    final receipt = ActionSubmission.fromJson(
      response.body! as Map<String, dynamic>,
    );
    _validateSubmission(receipt);
    _submission = receipt;
    await _persist();
    return _observe();
  }

  Future<Channel> _observe() async {
    final receipt = _submission!;
    final response = await _send(
      PlatformMethod.get,
      '/api/v1/tasks/${Uri.encodeComponent(receipt.actionExecutionId)}',
    );
    final task = TaskView.fromJson(response.body! as Map<String, dynamic>);
    if (task.actionExecutionId != receipt.actionExecutionId ||
        task.operationId != receipt.operationId ||
        task.actionKey != receipt.actionKey ||
        task.actionVersion <= 0 ||
        (receipt.workflowId != null && task.workflowId != receipt.workflowId)) {
      throw const FormatException('Conversation observation mismatch');
    }
    if (task.observation != null ||
        task.dispatchState == ActionDispatchState.UNKNOWN) {
      throw DirectMessagePending(receipt);
    }
    if (task.gateState == ActionGateState.DENIED ||
        task.gateState == ActionGateState.REVOKED ||
        task.gateState == ActionGateState.EXPIRED ||
        task.dispatchState == ActionDispatchState.ABORTED ||
        (task.taskStatus != null &&
            task.taskStatus != TaskStatus.RUNNING &&
            task.taskStatus != TaskStatus.COMPLETED)) {
      await _clear();
      throw DirectMessageEnded(task);
    }
    if (task.gateState != ActionGateState.ALLOWED ||
        task.dispatchState != ActionDispatchState.DISPATCHED ||
        task.taskStatus != TaskStatus.COMPLETED ||
        task.workflowKind != WorkflowKind.CONVERSATION_PROJECTION ||
        task.workflowId?.isNotEmpty != true ||
        task.targetId.isEmpty ||
        task.workspaceId != null) {
      throw DirectMessagePending(receipt);
    }
    final bindings = await conversations();
    final matches = bindings.where((row) => row.id == task.targetId).toList();
    if (matches.length != 1 ||
        matches.single.state != ItemState.ACTIVE ||
        !setEquals(
          matches.single.participantPrincipalIds.toSet(),
          _command!.conversationOpen!.participantPrincipalIds.toSet(),
        ) ||
        _ref.read(relaySessionProvider).status != SessionStatus.connected) {
      throw DirectMessagePending(receipt);
    }
    // Reopening an existing participant set targets the original binding. Its
    // operationId legitimately predates this AE; task/receipt own this action.
    final binding = matches.single;
    final session = _ref.read(relaySessionProvider.notifier);
    final metadata = await session.fetchHistory(
      NostrFilters.channelMetadata([binding.channelId]),
    );
    _fence();
    final event = metadata
        .where(
          (row) =>
              row.kind == 39000 && row.getTagValue('d') == binding.channelId,
        )
        .singleOrNull;
    if (event == null) throw DirectMessagePending(receipt);
    nostr.Event.fromMap(event.toJson());
    final data = ChannelData.fromEvent(event);
    if (data.channelType != 'dm' ||
        data.visibility != 'private' ||
        data.isArchived) {
      throw DirectMessagePending(receipt);
    }
    final people = await directory();
    final expected = <String>{};
    for (final id in binding.participantPrincipalIds) {
      final person = people.people
          .where((row) => row.principalId == id)
          .singleOrNull;
      if (person == null) throw DirectMessagePending(receipt);
      expected.addAll(person.pubkeys);
    }
    final members = await session.fetchHistory(
      NostrFilters.channelMembers(binding.channelId),
    );
    _fence();
    final roster = members
        .where(
          (row) =>
              row.kind == 39002 && row.getTagValue('d') == binding.channelId,
        )
        .singleOrNull;
    if (roster == null) throw DirectMessagePending(receipt);
    nostr.Event.fromMap(roster.toJson());
    if (!setEquals(expected, data.participantPubkeys.toSet()) ||
        !setEquals(
          expected,
          membersFromEvent(roster).map((member) => member.pubkey).toSet(),
        ) ||
        roster.pubkey != event.pubkey ||
        !expected.contains(_pubkey)) {
      throw DirectMessagePending(receipt);
    }
    final probe = Channel(
      id: data.id,
      name: data.name,
      channelType: data.channelType,
      visibility: data.visibility,
      description: data.description,
      createdBy: event.pubkey,
      createdAt: DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000),
      memberCount: 0,
      isMember: true,
      participantPubkeys: data.participantPubkeys,
    );
    final hidden = await _hidden(probe);
    if (hidden.contains(binding.channelId)) {
      final relay = SignedEventRelay(
        session: session,
        nsec: _ref.read(relayConfigProvider).nsec,
      );
      _reopen ??= relay.prepare(
        kind: 41010,
        content: '',
        tags: [
          ['h', binding.channelId],
        ],
      );
      _validateReopen(_reopen!);
      if (_reopen!.channelId != binding.channelId) {
        throw const FormatException('Conversation reopen target mismatch');
      }
      // Persist the exact signed personal-visibility event before publishing.
      // A lost OK can only replay this id, never create another DM or hide.
      await _persist();
      await relay.resubmit(_reopen!);
      _fence();
      if ((await _hidden(probe)).contains(binding.channelId)) {
        throw DirectMessagePending(receipt);
      }
    }
    await _ref.read(channelsProvider.notifier).refresh();
    _fence();
    final native = (await _ref.read(channelsProvider.future))
        .where(
          (channel) =>
              channel.id == binding.channelId &&
              channel.isDm &&
              channel.isPrivate &&
              channel.isMember &&
              !channel.isArchived &&
              setEquals(
                channel.participantPrincipalIds.toSet(),
                binding.participantPrincipalIds.toSet(),
              ),
        )
        .toList();
    _fence();
    if (native.length != 1) throw DirectMessagePending(receipt);
    final channel = native.single;
    await _clear();
    return channel;
  }
}

extension DirectMessageSubmission on DirectMessages {
  Future<Channel> openDm({required List<String> principalIds}) async {
    if (_busy || _command != null) throw DirectMessagePending(_submission);
    _busy = true;
    try {
      await _checkActor();
      final people = await directory();
      final ids = [...principalIds, principalId]..sort();
      if (principalIds.isEmpty ||
          ids.length > people.maxParticipants ||
          ids.toSet().length != ids.length ||
          ids.any(
            (id) => !people.people.any((person) => person.principalId == id),
          )) {
        throw const FormatException('Invalid conversation participants');
      }
      _command = ActionCommand(
        actionKey: 'conversation.open',
        idempotencyKey: const Uuid().v4(),
        conversationOpen: ConversationOpenClass(participantPrincipalIds: ids),
      );
      await _persist();
      return await _submitOriginal(firstSubmission: true);
    } finally {
      _busy = false;
    }
  }

  /// Explicit user reconciliation. Known AE => GET only; lost POST => exact
  /// original command/key. Core dedupe may advance that AE, never a new one.
  Future<Channel> recheck() async {
    if (_busy || _command == null) throw DirectMessagePending(_submission);
    _busy = true;
    try {
      await _checkActor();
      return _submission == null ? await _submitOriginal() : await _observe();
    } finally {
      _busy = false;
    }
  }
}
