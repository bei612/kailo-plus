// The original agent activity sheet over Core's audited reads (DD-125(6)): the running turn of
// this Installation, then its AgentSession's Codex items in ascending pages; a refusal says the
// activity is no longer readable instead of showing an empty transcript.
import 'package:buzz/features/channels/agent_activity/agent_activity_sheet.dart';
import 'package:buzz/features/channels/channel_governed_actions.dart';
import 'package:buzz/features/channels/agent_activity/working_agents_provider.dart';
import 'package:buzz/shared/platform/agent_activity_api.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../helpers/widget_helpers.dart';
import '../../shared/platform/platform_test_support.dart';

const _workspace = '11111111-1111-4111-8111-111111111111';
final _agentKey = 'a' * 64;

/// Records governed submissions; an unknown answer keeps the frozen command like the real one.
class _Actions extends ChannelGovernedActions {
  _Actions(Ref ref, this.answer) : super(ref, testPlatformConfig, () => true);

  ChannelActionOutcome answer;
  final sent = <ActionCommand>[];
  ActionCommand? _kept;

  @override
  ActionCommand? retained(String slot) => _kept;

  @override
  Future<ChannelActionOutcome?> submit(
    String slot,
    ActionCommand Function(String idempotencyKey) build,
  ) async {
    final command = _kept ?? build('frozen-key-${sent.length}');
    sent.add(command);
    _kept = answer is ChannelActionUnknown ? command : null;
    return answer;
  }
}

class _Profiles extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {};

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}

AgentActiveTurnView _turn({
  String installationId = 'install-1',
  String? cancelActionKey,
}) => AgentActiveTurnView(
  agentPubkey: _agentKey,
  cancelActionKey: cancelActionKey,
  installationId: installationId,
  invocationId: 'invocation-1',
  originalActionExecutionId: 'execution-1',
  projectionGeneration: 3,
  rootEventId: 'root-1',
  startedAt: DateTime.now()
      .subtract(const Duration(seconds: 65))
      .toUtc()
      .toIso8601String(),
);

AgentTranscriptItem _item(
  String id,
  AgentTranscriptItemKind kind, {
  String? text,
  String? command,
  String? output,
  AgentTranscriptItemStatus? status,
}) => AgentTranscriptItem(
  itemId: id,
  kind: kind,
  nativeType: kind.name,
  turnId: 'turn-1',
  text: text,
  command: command,
  aggregatedOutput: output,
  status: status,
);

AgentTranscriptPage _page(
  List<AgentTranscriptItem> items, {
  String? nextCursor,
  int generation = 3,
}) => AgentTranscriptPage(
  installationId: 'install-1',
  items: items,
  nextCursor: nextCursor,
  projectionGeneration: generation,
  rootEventId: 'root-1',
);

Future<List<String?>> _pump(
  WidgetTester tester, {
  required List<AgentActiveTurnView> turns,
  required Future<AgentTranscriptPage> Function(String? cursor) pages,
  bool working = true,
  ChannelActionOutcome answer = const ChannelActionRecorded('op-1'),
  void Function(_Actions actions)? onActions,
}) async {
  final cursors = <String?>[];
  await tester.pumpWidget(
    WidgetHelpers.testable(
      overrides: [
        userCacheProvider.overrideWith(_Profiles.new),
        workingAgentPubkeysProvider(
          _workspace,
        ).overrideWith((ref) => working ? {_agentKey} : const <String>{}),
        platformAgentActiveTurnsProvider(_workspace).overrideWith(
          (ref) async =>
              AgentActiveTurnPage(turns: turns, workspaceId: _workspace),
        ),
        channelGovernedActionsProvider.overrideWith((ref) {
          final actions = _Actions(ref, answer);
          onActions?.call(actions);
          return actions;
        }),
        agentTranscriptReaderProvider.overrideWithValue((turn, {cursor}) {
          cursors.add(cursor);
          return pages(cursor);
        }),
      ],
      child: AgentActivitySheet(
        channelId: _workspace,
        installationId: 'install-1',
        agentPubkey: _agentKey,
        agentName: 'Scout',
      ),
    ),
  );
  await tester.pumpAndSettle();
  return cursors;
}

void main() {
  testWidgets(
    'reads the audited session in ascending pages and keeps the latest item state',
    (tester) async {
      final cursors = await _pump(
        tester,
        turns: [
          _turn(installationId: 'other'),
          _turn(),
        ],
        pages: (cursor) async => cursor == null
            ? _page([
                _item(
                  'u1',
                  AgentTranscriptItemKind.USER_MESSAGE,
                  text: 'Summarize the incident',
                ),
                _item(
                  'c1',
                  AgentTranscriptItemKind.COMMAND_EXECUTION,
                  command: 'grep error app.log',
                  status: AgentTranscriptItemStatus.IN_PROGRESS,
                ),
              ], nextCursor: 'p2')
            : _page([
                _item(
                  'c1',
                  AgentTranscriptItemKind.COMMAND_EXECUTION,
                  command: 'grep error app.log',
                  output: '3 matches',
                  status: AgentTranscriptItemStatus.COMPLETED,
                ),
                _item(
                  'a1',
                  AgentTranscriptItemKind.AGENT_MESSAGE,
                  text: 'Three errors, all from the cache.',
                ),
              ]),
      );

      expect(cursors, [null, 'p2']);
      expect(find.text('Working'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('agent-activity-started')),
        findsOneWidget,
      );
      expect(find.text('User prompt'), findsOneWidget);
      expect(find.text('Summarize the incident'), findsOneWidget);
      expect(find.text('Ran command'), findsOneWidget);
      expect(find.text('\$ grep error app.log\n3 matches'), findsOneWidget);
      expect(find.text('Three errors, all from the cache.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('agent-transcript-item-c1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('agent-activity-load-more')),
        findsNothing,
      );
    },
  );

  testWidgets('a refused transcript read says the activity is not readable', (
    tester,
  ) async {
    await _pump(
      tester,
      turns: [_turn()],
      pages: (_) async =>
          throw const PlatformApiError(PlatformResponse(403, null)),
    );

    expect(
      find.text("You can no longer read this agent's activity."),
      findsOneWidget,
    );
    expect(find.text('User prompt'), findsNothing);
  });

  test('a transcript page for another session is not this turn\'s page', () {
    final turn = _turn();
    expect(transcriptPageBelongsTo(_page(const []), turn), isTrue);
    expect(
      transcriptPageBelongsTo(_page(const [], generation: 2), turn),
      isFalse,
    );
    expect(
      transcriptPageBelongsTo(
        AgentTranscriptPage(
          installationId: 'other',
          items: const [],
          projectionGeneration: 3,
          rootEventId: 'root-1',
        ),
        turn,
      ),
      isFalse,
    );
  });

  testWidgets('an idle Agent without a turn says how to start one', (
    tester,
  ) async {
    final cursors = await _pump(
      tester,
      working: false,
      turns: const [],
      pages: (_) async => _page(const []),
    );

    expect(cursors, isEmpty);
    expect(
      find.text('Mention Scout in the channel to see its work here.'),
      findsOneWidget,
    );
  });

  testWidgets('no stop entry unless Core offers the turn cancel control', (
    tester,
  ) async {
    await _pump(tester, turns: [_turn()], pages: (_) async => _page(const []));
    expect(find.byKey(const ValueKey('agent-activity-stop')), findsNothing);
  });

  testWidgets(
    'stop submits the governed turn cancel for the original execution once',
    (tester) async {
      late _Actions actions;
      await _pump(
        tester,
        turns: [_turn(cancelActionKey: 'task.cancel.agent.invoke.v1')],
        pages: (_) async => _page(const []),
        onActions: (value) => actions = value,
      );
      await tester.tap(find.byKey(const ValueKey('agent-activity-stop')));
      await tester.pumpAndSettle();
      expect(actions.sent, hasLength(1));
      expect(actions.sent.single.actionKey, 'task.cancel.agent.invoke.v1');
      expect(actions.sent.single.originalActionExecutionId, 'execution-1');
      expect(find.textContaining('Stop signal sent to Scout'), findsOneWidget);
    },
  );

  testWidgets('an unknown stop keeps the same request for the retry', (
    tester,
  ) async {
    late _Actions actions;
    await _pump(
      tester,
      turns: [_turn(cancelActionKey: 'task.cancel.agent.invoke.v1')],
      pages: (_) async => _page(const []),
      answer: const ChannelActionUnknown('op-9'),
      onActions: (value) => actions = value,
    );
    await tester.tap(find.byKey(const ValueKey('agent-activity-stop')));
    await tester.pumpAndSettle();
    expect(find.textContaining('op-9'), findsOneWidget);
    expect(find.text('Retry stop request'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('agent-activity-stop')));
    await tester.pumpAndSettle();
    expect(actions.sent, hasLength(2));
    expect(actions.sent[1].idempotencyKey, actions.sent[0].idempotencyKey);
  });
}
