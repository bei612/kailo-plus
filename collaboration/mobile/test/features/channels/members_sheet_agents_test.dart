// The original members sheet's Agents section, restored over the DD-147 member-readable Agent
// author directory: one row per governed installation with its owner line, nothing granted.
import 'dart:async';

import 'package:buzz/features/channels/agent_activity/agent_activity_sheet.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_typing_provider.dart';
import 'package:buzz/features/channels/channel_governed_actions.dart';
import 'package:buzz/features/channels/members_sheet.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_cache_provider.dart';
import 'package:buzz/shared/platform/agent_activity_api.dart';
import 'package:buzz/shared/platform/agent_author_directory.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/widgets/modal_presentation.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/widget_helpers.dart';

const _workspace = '11111111-1111-4111-8111-111111111111';
final _agentKey = 'a' * 64;

final _channel = Channel(
  id: _workspace,
  name: 'general',
  channelType: 'stream',
  visibility: 'open',
  description: '',
  createdBy: '',
  createdAt: DateTime.utc(2026),
  memberCount: 1,
);

class _Profiles extends UserCacheNotifier {
  _Profiles(this._profiles);
  final Map<String, UserProfile> _profiles;

  @override
  Map<String, UserProfile> build() => _profiles;

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}

class _Statuses extends UserStatusCacheNotifier {
  final tracked = <String>[];

  @override
  Map<String, UserStatus?> build() => const {};

  @override
  void track(List<String> pubkeys) => tracked.addAll(pubkeys);
}

class _Typing extends ChannelTypingNotifier {
  _Typing(this._entries) : super(_workspace);
  final List<TypingEntry> _entries;

  @override
  List<TypingEntry> build() => _entries;
}

Future<_Statuses> _pump(
  WidgetTester tester, {
  required FutureOr<List<AgentAuthorView>> Function() agents,
  Map<String, UserProfile> profiles = const {},
  List<TypingEntry> typing = const [],
  bool asSheet = false,
}) async {
  final statuses = _Statuses();
  await tester.pumpWidget(
    WidgetHelpers.testable(
      overrides: [
        channelTypingProvider(_workspace).overrideWith(() => _Typing(typing)),
        platformAgentActiveTurnsProvider(_workspace).overrideWith(
          (ref) async =>
              AgentActiveTurnPage(turns: const [], workspaceId: _workspace),
        ),
        platformWorkspaceMembersProvider(_workspace).overrideWith(
          (ref) async => [
            WorkspaceMemberView(
              displayName: 'Alice',
              principalId: 'alice',
              pubkeys: ['b' * 64],
              state: WorkspaceMembershipState.ACTIVE,
            ),
          ],
        ),
        channelRoleMembersProvider(
          _workspace,
        ).overrideWith((ref) async => null),
        platformSessionViewProvider.overrideWith(
          (ref) => Completer<PlatformSessionView>().future,
        ),
        platformAgentAuthorsProvider(
          _workspace,
        ).overrideWith((ref) async => agents()),
        userCacheProvider.overrideWith(() => _Profiles(profiles)),
        userStatusCacheProvider.overrideWith(() => statuses),
      ],
      child: asSheet
          ? Builder(
              builder: (context) => TextButton(
                onPressed: () => showBuzzModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) =>
                      MembersSheet(channel: _channel, currentPubkey: null),
                ),
                child: const Text('Open members'),
              ),
            )
          : MembersSheet(channel: _channel, currentPubkey: null),
    ),
  );
  // A working Agent row shows the original spinner, which never settles.
  Future<void> settle() async {
    if (typing.isEmpty) {
      await tester.pumpAndSettle();
      return;
    }
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  await settle();
  if (asSheet) {
    await tester.tap(find.text('Open members'));
    await settle();
  }
  return statuses;
}

AgentAuthorView _scout() => AgentAuthorView(
  agentDisplayName: 'Scout',
  agentPubkey: _agentKey,
  installationResourceId: 'install-1',
  ownerDisplayName: 'Bob',
  ownerPrincipalId: 'bob',
);

void main() {
  testWidgets('lists governed agents with the persona name and owner line', (
    tester,
  ) async {
    final statuses = await _pump(
      tester,
      agents: () => [
        AgentAuthorView(
          agentDisplayName: ' Scout ',
          agentPubkey: _agentKey,
          installationResourceId: 'install-1',
          ownerDisplayName: 'Bob',
          ownerPrincipalId: 'bob',
        ),
      ],
    );

    expect(find.text('Agents · 1'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('channel-agent-install-1')),
      findsOneWidget,
    );
    expect(find.text('Scout'), findsOneWidget);
    expect(find.text('Added by Bob'), findsOneWidget);
    // Agents are not people: their NIP-38 status is not tracked.
    expect(statuses.tracked, isNot(contains(_agentKey)));
  });

  testWidgets(
    'falls back to the kind:0 name and says when the owner is unavailable',
    (tester) async {
      await _pump(
        tester,
        agents: () => [
          AgentAuthorView(
            agentPubkey: _agentKey,
            installationResourceId: 'install-2',
            ownerPrincipalId: 'gone',
          ),
        ],
        profiles: {
          _agentKey: UserProfile(pubkey: _agentKey, displayName: 'Profiled'),
        },
      );

      expect(find.text('Profiled'), findsOneWidget);
      expect(find.text('Agent; owner unavailable'), findsOneWidget);
    },
  );

  testWidgets(
    'no agents means no Agents section; a refusal is said, not hidden',
    (tester) async {
      await _pump(tester, agents: () => const []);
      expect(find.textContaining('Agents ·'), findsNothing);

      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(tester, agents: () => throw StateError('refused'));
      expect(
        find.byKey(const ValueKey('channel-agents-error')),
        findsOneWidget,
      );
      expect(find.text('Alice'), findsOneWidget);
    },
  );

  testWidgets(
    'an Agent typing in the channel is Working and its row opens the activity sheet',
    (tester) async {
      await _pump(
        tester,
        asSheet: true,
        agents: () => [_scout()],
        typing: [
          TypingEntry(
            pubkey: _agentKey.toUpperCase(),
            threadHeadId: 'root',
            expiresAtMs: DateTime.now().millisecondsSinceEpoch + 8000,
          ),
          TypingEntry(
            pubkey: 'b' * 64,
            expiresAtMs: DateTime.now().millisecondsSinceEpoch + 8000,
          ),
        ],
      );

      expect(
        find.byKey(const ValueKey('channel-agent-working')),
        findsOneWidget,
      );
      expect(find.text('Working\u2026'), findsOneWidget);
      expect(find.text('Added by Bob'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('channel-agent-install-1')));
      await tester.pumpAndSettle();

      expect(find.byType(MembersSheet), findsNothing);
      expect(find.byType(AgentActivitySheet), findsOneWidget);
      expect(find.text('Scout'), findsOneWidget);
      // A member without `audit` has no turn row: the detail is said to be audit-only.
      expect(
        find.byKey(const ValueKey('agent-activity-audit-only')),
        findsOneWidget,
      );
    },
  );

  testWidgets('an idle Agent keeps its owner line and still offers activity', (
    tester,
  ) async {
    await _pump(tester, asSheet: true, agents: () => [_scout()]);

    expect(find.byKey(const ValueKey('channel-agent-working')), findsNothing);
    expect(find.text('Added by Bob'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('channel-agent-install-1')));
    await tester.pumpAndSettle();
    expect(find.byType(AgentActivitySheet), findsNothing);

    await tester.tap(
      find.byKey(const ValueKey('channel-agent-activity-install-1')),
    );
    await tester.pumpAndSettle();
    expect(find.byType(AgentActivitySheet), findsOneWidget);
    expect(find.byKey(const ValueKey('agent-activity-idle')), findsOneWidget);
  });
}
