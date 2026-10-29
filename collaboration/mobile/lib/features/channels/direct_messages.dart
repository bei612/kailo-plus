import 'dart:convert';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../shared/auth/auth.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';
import '../../shared/utils/string_utils.dart';
import 'channel.dart';
import 'channels_provider.dart';

part 'direct_message_actions.dart';
part 'direct_message_visibility.dart';
part 'direct_message_preferences.dart';
part 'channel_sections/channel_sections_provider.dart';
part 'channel_sort/channel_sort_provider.dart';

/// The BFF's current HUMAN directory, not a second identity registry. Limits
/// and people come from the existing generated contracts and tenant authority.
class ConversationDirectory {
  const ConversationDirectory(this.people, this.maxParticipants);
  final List<ConversationParticipant> people;
  final int maxParticipants;
}

String conversationParticipantLabel(ConversationParticipant person) =>
    person.displayName.trim().isEmpty
    ? shortPubkey(person.pubkeys.first)
    : person.displayName;

class DirectMessagePending implements Exception {
  const DirectMessagePending(this.submission);
  final ActionSubmission? submission;
}

class DirectMessageEnded implements Exception {
  const DirectMessageEnded(this.task);
  final TaskView task;
}

/// Native adapter for Buzz's original New DM consumer. Core owns conversation
/// admission/projection; local CLIENT keys still read/write the native DM.
class DirectMessages {
  DirectMessages(
    this._ref,
    this._config,
    this._actor,
    this._pubkey,
    this._prefs,
    this._current,
  );
  final Ref _ref;
  final PlatformConfig _config;
  final PlatformSessionView _actor;
  final String _pubkey;
  final SharedPreferences _prefs;
  final bool Function() _current;
  ActionCommand? _command;
  ActionSubmission? _submission;
  NostrEvent? _reopen;
  bool _busy = false;

  String get principalId => _actor.tenantPrincipalId;
  ActionCommand? get pendingCommand => _command;
  ActionSubmission? get submission => _submission;

  void _fence() {
    if (!_current()) {
      throw const PlatformUnavailable('The platform session changed');
    }
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
    if (!response.isSuccess) throw PlatformApiError(response);
    return response;
  }

  Future<void> _checkActor() async {
    final response = await _send(PlatformMethod.get, '/api/v1/session');
    final actor = PlatformSessionView.fromJson(
      response.body! as Map<String, dynamic>,
    );
    if (actor.platformSessionId != _actor.platformSessionId ||
        actor.tenantId != _actor.tenantId ||
        actor.tenantPrincipalId != principalId ||
        actor.accessMode != PlatformSessionAccessMode.FULL) {
      throw const PlatformUnavailable('The platform session changed');
    }
  }

  Future<ConversationDirectory> directory() async {
    final people = <ConversationParticipant>[];
    final principals = <String>{};
    final pubkeys = <String>{};
    final cursors = <String>{};
    String? cursor;
    int? maximum;
    do {
      final response = await _send(
        PlatformMethod.get,
        '/api/v1/conversation-participants${cursor == null ? '' : '?cursor=${Uri.encodeComponent(cursor)}'}',
      );
      final page = ConversationParticipantPage.fromJson(
        response.body! as Map<String, dynamic>,
      );
      if (page.maxParticipants < 2 ||
          (maximum != null && maximum != page.maxParticipants)) {
        throw const FormatException('Invalid conversation participant limit');
      }
      maximum = page.maxParticipants;
      for (final row in page.items) {
        final person = ConversationParticipant.fromJson(row.toJson());
        if (person.principalId.isEmpty ||
            !principals.add(person.principalId) ||
            person.pubkeys.isEmpty ||
            person.pubkeys.any(
              (key) =>
                  !RegExp(r'^[0-9a-f]{64}$').hasMatch(key) || !pubkeys.add(key),
            )) {
          throw const FormatException('Ambiguous conversation participant');
        }
        people.add(person);
      }
      cursor = page.nextCursor;
      if (cursor != null && (cursor.isEmpty || !cursors.add(cursor))) {
        throw const FormatException('Repeated conversation participant cursor');
      }
    } while (cursor != null);
    final mine = people.where((person) => person.principalId == principalId);
    if (mine.length != 1 || !mine.single.pubkeys.contains(_pubkey)) {
      throw const PlatformUnavailable(
        'Current CLIENT identity is not projected',
      );
    }
    return ConversationDirectory(List.unmodifiable(people), maximum);
  }

  Future<List<ConversationView>> conversations() async {
    final conversations = <ConversationView>[];
    final ids = <String>{};
    final channels = <String>{};
    final cursors = <String>{};
    String? cursor;
    do {
      final response = await _send(
        PlatformMethod.get,
        '/api/v1/conversations${cursor == null ? '' : '?cursor=${Uri.encodeComponent(cursor)}'}',
      );
      final page = ConversationPage.fromJson(
        response.body! as Map<String, dynamic>,
      );
      for (final item in page.items) {
        final row = ConversationView.fromJson(item.toJson());
        if (row.id.isEmpty ||
            row.channelId != row.id ||
            row.version <= 0 ||
            row.operationId.isEmpty ||
            !ids.add(row.id) ||
            !channels.add(row.channelId) ||
            !row.participantPrincipalIds.contains(principalId) ||
            row.participantPrincipalIds.length < 2 ||
            row.participantPrincipalIds.toSet().length !=
                row.participantPrincipalIds.length) {
          throw const FormatException('Invalid conversation binding');
        }
        conversations.add(row);
      }
      cursor = page.nextCursor;
      if (cursor != null && (cursor.isEmpty || !cursors.add(cursor))) {
        throw const FormatException('Repeated conversation cursor');
      }
    } while (cursor != null);
    return conversations;
  }

  /// Resolve native keys to HUMAN labels only after exact active binding and
  /// roster equality. Multiple CLIENT/SERVER keys never become extra people.
  Future<List<Channel>> hydrate(List<Channel> native) async {
    if (!native.any((channel) => channel.isDm)) return native;
    final directory = await this.directory();
    final conversations = await this.conversations();
    final byPrincipal = {
      for (final person in directory.people) person.principalId: person,
    };
    final byChannel = {for (final row in conversations) row.channelId: row};
    final hiddenByRelay = <String, Set<String>>{};
    final result = <Channel>[];
    for (final channel in native) {
      if (!channel.isDm) {
        result.add(channel);
        continue;
      }
      final binding = byChannel[channel.id];
      if (binding == null || binding.state != ConversationViewState.ACTIVE) {
        continue;
      }
      final people = <ConversationParticipant>[];
      for (final id in binding.participantPrincipalIds) {
        final person = byPrincipal[id];
        if (person == null) {
          throw const PlatformUnavailable(
            'Conversation identity projection is stale',
          );
        }
        people.add(person);
      }
      final expected = {for (final person in people) ...person.pubkeys};
      final roster = _ref
          .read(channelsProvider.notifier)
          .cachedMembersForChannel(channel.id);
      if (!channel.isMember ||
          !channel.isPrivate ||
          channel.isArchived ||
          !setEquals(expected, channel.participantPubkeys.toSet()) ||
          !setEquals(
            expected,
            roster.map((member) => member.pubkey.toLowerCase()).toSet(),
          ) ||
          !expected.contains(_pubkey)) {
        throw const PlatformUnavailable(
          'Conversation native projection is stale',
        );
      }
      final hidden = hiddenByRelay[channel.createdBy] ??= await _hidden(
        channel,
      );
      if (hidden.contains(channel.id)) continue;
      _fence();
      final cache = _ref.read(userCacheProvider.notifier);
      for (final person in people) {
        for (final key in person.pubkeys) {
          cache.put(UserProfile(pubkey: key, displayName: person.displayName));
        }
      }
      result.add(
        channel.copyWith(
          participants: [
            for (final person in people) conversationParticipantLabel(person),
          ],
          participantPubkeys: [
            for (final person in people)
              person.principalId == principalId
                  ? _pubkey
                  : person.pubkeys.first,
          ],
          participantPrincipalIds: binding.participantPrincipalIds,
          memberCount: people.length,
        ),
      );
    }
    return result;
  }
}

final directMessagesProvider = FutureProvider<DirectMessages>((ref) async {
  final community = ref.watch(
    authProvider.select((auth) => auth.value?.community?.id),
  );
  final config = ref.watch(platformConfigProvider);
  final pubkey = ref.watch(myPubkeyProvider)?.toLowerCase();
  final actor = await ref.watch(platformSessionViewProvider.future);
  if (community == null ||
      config == null ||
      pubkey == null ||
      actor.accessMode != PlatformSessionAccessMode.FULL) {
    throw const PlatformNotSignedIn();
  }
  var active = true;
  ref.onDispose(() => active = false);
  final consumer = DirectMessages(
    ref,
    config,
    actor,
    pubkey,
    ref.read(savedPrefsProvider),
    () =>
        active &&
        ref.read(platformConfigProvider) == config &&
        ref.read(authProvider).value?.community?.id == community &&
        ref.read(myPubkeyProvider)?.toLowerCase() == pubkey,
  );
  consumer._restore();
  return consumer;
}, retry: (count, error) => null);

final conversationDirectoryProvider = FutureProvider<ConversationDirectory>((
  ref,
) async {
  final consumer = await ref.watch(directMessagesProvider.future);
  return consumer.directory();
}, retry: (count, error) => null);
