// The original profile card's status line and "Message" action. Message is the governed
// `conversation.open` for a person of the trusted DM directory: offered for others only, the
// opened conversation is returned to the caller, and a refusal is told apart from an
// unconfirmed submission instead of failing silently.
import 'dart:async';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/direct_messages.dart';
import 'package:buzz/features/profile/presence_cache_provider.dart';
import 'package:buzz/features/profile/user_profile_sheet.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_cache_provider.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/widgets/modal_presentation.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/widget_helpers.dart';

final _alice = 'a' * 64;
final _me = 'c' * 64;
const _myPrincipal = '00000000-0000-4000-8000-000000000004';

final _sessionView = PlatformSessionView(
  accessMode: PlatformSessionAccessMode.FULL,
  humanIdentityId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Tester',
  tenantId: '00000000-0000-4000-8000-000000000002',
  tenantMembershipId: '00000000-0000-4000-8000-000000000003',
  tenantPrincipalId: _myPrincipal,
  platformSessionId: '00000000-0000-4000-8000-000000000005',
);

final _dm = Channel(
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Alice',
  channelType: 'dm',
  visibility: 'private',
  description: '',
  createdBy: '',
  createdAt: DateTime.utc(2026),
  memberCount: 2,
);

class _Profiles extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => {
    _alice: UserProfile(pubkey: _alice, displayName: 'Alice'),
  };

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}

class _Presence extends PresenceCacheNotifier {
  @override
  Map<String, String> build() => const {};

  @override
  void track(List<String> pubkeys) {}
}

class _Statuses extends UserStatusCacheNotifier {
  _Statuses(this._statuses);
  final Map<String, UserStatus?> _statuses;
  final tracked = <String>[];

  @override
  Map<String, UserStatus?> build() => _statuses;

  @override
  void track(List<String> pubkeys) => tracked.addAll(pubkeys);
}

class _Relay extends RelaySessionNotifier {
  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async => const [];
}

Future<({_Statuses statuses, List<String> opened, Completer<Channel?> result})>
_pump(
  WidgetTester tester, {
  String pubkey = '',
  Map<String, UserStatus?> statuses = const {},
  Future<Channel> Function(String principalId)? open,
}) async {
  final statusCache = _Statuses(statuses);
  final opened = <String>[];
  final result = Completer<Channel?>();
  await tester.pumpWidget(
    WidgetHelpers.testable(
      overrides: [
        userCacheProvider.overrideWith(_Profiles.new),
        presenceCacheProvider.overrideWith(_Presence.new),
        userStatusCacheProvider.overrideWith(() => statusCache),
        relaySessionProvider.overrideWith(_Relay.new),
        myPubkeyProvider.overrideWithValue(_me),
        platformSessionViewProvider.overrideWith((ref) => _sessionView),
        conversationDirectoryProvider.overrideWith(
          (ref) async => ConversationDirectory([
            ConversationParticipant(
              displayName: 'Tester',
              principalId: _myPrincipal,
              pubkeys: [_me],
            ),
            ConversationParticipant(
              displayName: 'Alice',
              principalId: 'alice-principal',
              pubkeys: [_alice.toUpperCase()],
            ),
          ], 8),
        ),
        profileDirectMessageOpenerProvider.overrideWithValue((principalId) {
          opened.add(principalId);
          return open?.call(principalId) ?? Future.value(_dm);
        }),
      ],
      child: Builder(
        builder: (context) => TextButton(
          onPressed: () => showBuzzModalBottomSheet<Channel>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                UserProfileSheet(pubkey: pubkey.isEmpty ? _alice : pubkey),
          ).then(result.complete),
          child: const Text('Open profile'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open profile'));
  await tester.pumpAndSettle();
  return (statuses: statusCache, opened: opened, result: result);
}

void main() {
  testWidgets('shows the person\'s status under the name and tracks it', (
    tester,
  ) async {
    final harness = await _pump(
      tester,
      statuses: {
        _alice: const UserStatus(
          text: 'In a meeting',
          emoji: '\u{1F5E3}\u{FE0F}',
          updatedAt: 1,
        ),
      },
    );

    expect(find.byKey(const ValueKey('user-profile-status')), findsOneWidget);
    expect(harness.statuses.tracked, contains(_alice));
  });

  testWidgets('no status means no status line', (tester) async {
    await _pump(tester);
    expect(find.byKey(const ValueKey('user-profile-status')), findsNothing);
  });

  testWidgets('Message opens the governed DM and returns it to the caller', (
    tester,
  ) async {
    final harness = await _pump(tester);

    expect(find.text('Message'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('user-profile-message')));
    await tester.pumpAndSettle();

    expect(harness.opened, ['alice-principal']);
    expect(find.byType(UserProfileSheet), findsNothing);
    expect(await harness.result.future, same(_dm));
  });

  testWidgets('no Message action on one\'s own profile', (tester) async {
    await _pump(tester, pubkey: _me);
    expect(find.byKey(const ValueKey('user-profile-message')), findsNothing);
  });

  testWidgets('no Message action for a key outside the DM directory', (
    tester,
  ) async {
    await _pump(tester, pubkey: 'd' * 64);
    expect(find.byKey(const ValueKey('user-profile-message')), findsNothing);
  });

  testWidgets('a refusal is said and the card stays open', (tester) async {
    final harness = await _pump(
      tester,
      open: (_) async => throw const PlatformApiError(
        PlatformResponse(403, {
          'class': 'DENIED',
          'reason': 'SCOPE_GUARD_FAILED',
        }),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('user-profile-message')));
    await tester.pumpAndSettle();

    expect(harness.opened, ['alice-principal']);
    expect(find.byType(UserProfileSheet), findsOneWidget);
    expect(
      find.byKey(const ValueKey('user-profile-message-error')),
      findsOneWidget,
    );
    expect(find.textContaining('SCOPE_GUARD_FAILED'), findsOneWidget);
  });

  testWidgets('a pending submission is not reported as a failure', (
    tester,
  ) async {
    await _pump(
      tester,
      open: (_) async => throw const DirectMessagePending(null),
    );

    await tester.tap(find.byKey(const ValueKey('user-profile-message')));
    await tester.pumpAndSettle();

    expect(find.byType(UserProfileSheet), findsOneWidget);
    expect(
      find.byKey(const ValueKey('user-profile-message-error')),
      findsOneWidget,
    );
    expect(find.text("Couldn't open the direct message."), findsNothing);
  });
}
