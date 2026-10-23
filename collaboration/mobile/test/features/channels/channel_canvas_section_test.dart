// DD-150(4): the Mobile Canvas is the BFF-adopted CONTROL body, edited only by the governed
// workspace.canvas.set with the BFF's hint; a recorded request is not a saved Canvas.
import 'package:buzz/features/channels/channel_canvas_section.dart';
import 'package:buzz/features/channels/channel_governed_actions.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../helpers/widget_helpers.dart';
import '../../shared/platform/platform_test_support.dart';

const _workspace = '11111111-1111-4111-8111-111111111111';

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

Future<_Actions> _pump(
  WidgetTester tester, {
  required WebChannelCanvasView view,
  ChannelActionOutcome answer = const ChannelActionRecorded('op-1'),
}) async {
  late _Actions actions;
  var reads = 0;
  await tester.pumpWidget(
    WidgetHelpers.testable(
      overrides: [
        channelCanvasProvider(_workspace).overrideWith((ref) async {
          reads++;
          return reads == 1
              ? view
              : WebChannelCanvasView(
                  workspaceId: _workspace,
                  content: 'adopted',
                  setActionKey: view.setActionKey,
                );
        }),
        channelGovernedActionsProvider.overrideWith(
          (ref) => actions = _Actions(ref, answer),
        ),
      ],
      child: const Scaffold(
        body: SingleChildScrollView(
          child: ChannelCanvasSection(workspaceId: _workspace, isArchived: false),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return actions;
}

void main() {
  testWidgets('members read the Canvas but get no edit entry without the hint', (
    tester,
  ) async {
    await _pump(
      tester,
      view: WebChannelCanvasView(workspaceId: _workspace, content: '# Plan'),
    );
    expect(find.text('# Plan'), findsOneWidget);
    expect(find.byKey(const ValueKey('channel-canvas-edit')), findsNothing);
  });

  testWidgets('an empty Canvas says so', (tester) async {
    await _pump(tester, view: WebChannelCanvasView(workspaceId: _workspace));
    expect(find.byKey(const ValueKey('channel-canvas-empty')), findsOneWidget);
  });

  testWidgets(
    'save submits one governed workspace.canvas.set and rereads the adopted body',
    (tester) async {
      final actions = await _pump(
        tester,
        view: WebChannelCanvasView(
          workspaceId: _workspace,
          content: 'old',
          setActionKey: 'workspace.canvas.set',
        ),
      );
      await tester.tap(find.byKey(const ValueKey('channel-canvas-edit')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('channel-canvas-editor')),
        'new plan',
      );
      await tester.tap(find.byKey(const ValueKey('channel-canvas-save')));
      await tester.pumpAndSettle();
      final command = actions.sent.single;
      expect(command.actionKey, 'workspace.canvas.set');
      expect(command.workspaceId, _workspace);
      expect(command.explicitConfirmation, true);
      expect(command.workspaceCanvas?.content, 'new plan');
      expect(find.byKey(const ValueKey('channel-canvas-editor')), findsNothing);
      expect(find.text('adopted'), findsOneWidget, reason: 'Core readback');
      expect(find.byKey(const ValueKey('channel-canvas-outcome')), findsOneWidget);
    },
  );

  testWidgets('an unknown save keeps the editor and resends the same command', (
    tester,
  ) async {
    final actions = await _pump(
      tester,
      view: WebChannelCanvasView(
        workspaceId: _workspace,
        content: 'old',
        setActionKey: 'workspace.canvas.set',
      ),
      answer: const ChannelActionUnknown('op-1'),
    );
    await tester.tap(find.byKey(const ValueKey('channel-canvas-edit')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('channel-canvas-editor')),
      'new plan',
    );
    await tester.tap(find.byKey(const ValueKey('channel-canvas-save')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('channel-canvas-editor')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('channel-canvas-save')));
    await tester.pumpAndSettle();
    expect(actions.sent, hasLength(2));
    expect(identical(actions.sent.first, actions.sent.last), true);
  });

  testWidgets('a Canvas over 64 KiB cannot be saved', (tester) async {
    final actions = await _pump(
      tester,
      view: WebChannelCanvasView(
        workspaceId: _workspace,
        setActionKey: 'workspace.canvas.set',
      ),
    );
    await tester.tap(find.byKey(const ValueKey('channel-canvas-edit')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('channel-canvas-editor')),
      'x' * (maxChannelCanvasBytes + 1),
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('channel-canvas-save')));
    await tester.pump();
    expect(actions.sent, isEmpty);
  });
}
