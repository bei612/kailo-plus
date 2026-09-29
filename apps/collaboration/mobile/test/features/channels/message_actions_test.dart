import 'dart:ui' as ui;

import 'package:buzz/features/channels/message_actions.dart';
import 'package:buzz/features/channels/message_long_press_region.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/features/channels/thread_follows/thread_follows_provider.dart';
import 'package:buzz/features/channels/timeline_message.dart';
import 'package:buzz/shared/emoji/native_emoji_glyph.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _channelId = 'chan-1';

TimelineMessage _message({
  String id = 'msg-1',
  String pubkey = 'alice',
  int createdAt = 1000,
  bool isSystem = false,
  String? rootId,
}) => TimelineMessage(
  id: id,
  pubkey: pubkey,
  createdAt: createdAt,
  content: 'hello world',
  isSystem: isSystem,
  rootId: rootId,
);

class _FakeReadStateNotifier extends ReadStateNotifier {
  final ReadStateState _initialState;
  final Map<String, int> markedRead = {};
  final List<String> markedUnread = [];

  _FakeReadStateNotifier(this._initialState);

  @override
  ReadStateState build() => _initialState;

  @override
  void markContextRead(
    String contextId,
    int unixTimestamp, {
    bool clearForcedMessages = false,
  }) {
    markedRead[contextId] = unixTimestamp;
    var forced = {
      for (final entry in state.forcedUnreadContexts.entries)
        if (entry.key != contextId) entry.key: entry.value,
    };
    if (clearForcedMessages) {
      forced = {
        for (final entry in forced.entries)
          if (entry.value != contextId) entry.key: entry.value,
      };
    }
    state = _withForced(forced).copyWithContext(contextId, unixTimestamp);
  }

  @override
  void markContextUnread(String contextId, {required String channelId}) {
    markedUnread.add(contextId);
    state = _withForced({...state.forcedUnreadContexts, contextId: channelId});
  }

  ReadStateState _withForced(Map<String, String> forced) => ReadStateState(
    isReady: state.isReady,
    pubkey: state.pubkey,
    contexts: state.contexts,
    version: state.version + 1,
    forcedUnreadContexts: Map.unmodifiable(forced),
  );
}

ReadStateState _readState(Map<String, int> contexts, {bool isReady = true}) =>
    ReadStateState(
      isReady: isReady,
      pubkey: 'self',
      contexts: contexts,
      version: 1,
    );

Future<SharedPreferences> _mockPrefs() async {
  SharedPreferences.setMockInitialValues({});
  return SharedPreferences.getInstance();
}

Future<void> _pumpSheet(
  WidgetTester tester, {
  required TimelineMessage message,
  required SharedPreferences prefs,
  ReadStateNotifier Function()? readStateOverride,
  List<TimelineMessage>? allMessages,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        myPubkeyProvider.overrideWithValue('self'),
        readStateProvider.overrideWith(
          readStateOverride ??
              () => _FakeReadStateNotifier(
                _readState(const {_channelId: 100000}),
              ),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: Consumer(
            builder: (context, ref, _) => TextButton(
              onPressed: () => showMessageActions(
                context: context,
                ref: ref,
                message: message,
                channelId: _channelId,
                allMessages: allMessages,
                currentPubkey: 'self',
                isMember: true,
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

Future<void> _pumpImageSheet(
  WidgetTester tester, {
  required TimelineMessage message,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: Consumer(
            builder: (context, ref, _) => TextButton(
              onPressed: () => showImageActions(
                context: context,
                ref: ref,
                message: message,
                channelId: _channelId,
                imageUrl: 'https://example.com/photo.png',
              ),
              child: const Text('open image actions'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open image actions'));
  await tester.pumpAndSettle();
}

Future<ui.Image> _testMessageSnapshot() async {
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  canvas.drawRect(
    const Rect.fromLTWH(0, 0, 300, 72),
    ui.Paint()..color = const Color(0xffeeeeee),
  );
  return recorder.endRecording().toImage(300, 72);
}

class _MessageActionsPopoverHarness {
  final ProviderContainer container;
  final ValueNotifier<bool> sourceHidden;

  const _MessageActionsPopoverHarness({
    required this.container,
    required this.sourceHidden,
  });
}

Future<_MessageActionsPopoverHarness> _pumpMessageActionsPopover(
  WidgetTester tester, {
  required TimelineMessage message,
  required SharedPreferences prefs,
  ReadStateNotifier Function()? readStateOverride,
  List<TimelineMessage>? allMessages,
  bool disableAnimations = false,
  EdgeInsets viewInsets = EdgeInsets.zero,
  TextScaler textScaler = TextScaler.noScaling,
  Future<ui.Image> Function()? captureAnchorSnapshot,
  FocusNode? composerFocusNode,
  bool composerInitiallyFocused = false,
  bool launcherOnNestedRoute = false,
  Rect anchorRect = const Rect.fromLTWH(32, 260, 300, 72),
}) async {
  final sourceHidden = ValueNotifier(false);

  Widget launcherPage() => Scaffold(
    key: const ValueKey('message-actions-underlying-page'),
    body: Consumer(
      builder: (context, ref, _) => Column(
        children: [
          if (composerFocusNode != null)
            TextField(focusNode: composerFocusNode),
          TextButton(
            key: const ValueKey('open-message-actions-popover'),
            onPressed: () => showMessageActions(
              context: context,
              ref: ref,
              message: message,
              channelId: _channelId,
              allMessages: allMessages,
              currentPubkey: 'self',
              isMember: true,
              anchorRect: anchorRect,
              captureAnchorSnapshot:
                  captureAnchorSnapshot ?? _testMessageSnapshot,
              onPopoverPreviewVisibilityChanged: (visible) =>
                  sourceHidden.value = visible,
              onPopoverDismissed: () => sourceHidden.value = false,
              composerFocusNode: composerFocusNode,
              restoreComposerFocus: composerFocusNode?.requestFocus,
            ),
            child: const Text('open message actions'),
          ),
        ],
      ),
    ),
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        myPubkeyProvider.overrideWithValue('self'),
        readStateProvider.overrideWith(
          readStateOverride ??
              () => _FakeReadStateNotifier(
                _readState(const {_channelId: 100000}),
              ),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: disableAnimations,
            viewInsets: viewInsets,
            textScaler: textScaler,
          ),
          child: child!,
        ),
        home: launcherOnNestedRoute
            ? Builder(
                builder: (context) => Scaffold(
                  key: const ValueKey('message-actions-root-page'),
                  body: TextButton(
                    key: const ValueKey('push-message-actions-launcher'),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => launcherPage()),
                    ),
                    child: const Text('push launcher'),
                  ),
                ),
              )
            : launcherPage(),
      ),
    ),
  );
  if (launcherOnNestedRoute) {
    await tester.tap(
      find.byKey(const ValueKey('push-message-actions-launcher')),
    );
    await tester.pumpAndSettle();
  }
  if (composerInitiallyFocused) {
    composerFocusNode!.requestFocus();
    await tester.pump();
  }
  await tester.tap(find.byKey(const ValueKey('open-message-actions-popover')));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(
    tester.element(find.byKey(const ValueKey('open-message-actions-popover'))),
  );
  return _MessageActionsPopoverHarness(
    container: container,
    sourceHidden: sourceHidden,
  );
}

Future<void> _dismissMessageActionsPopover(WidgetTester tester) async {
  Navigator.of(
    tester.element(find.byKey(const ValueKey('message-action-surface'))),
  ).pop();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'message long press keeps taps and scrolling while repeated holds win',
    (tester) async {
      var parentTaps = 0;
      var nestedTaps = 0;
      var longPresses = 0;
      final scrollController = ScrollController();
      addTearDown(scrollController.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              controller: scrollController,
              child: Column(
                children: [
                  Material(
                    child: MessageLongPressInkWell(
                      key: const ValueKey('parent-gesture-target'),
                      onTap: () => parentTaps += 1,
                      onLongPress: (_) => longPresses += 1,
                      child: const SizedBox(height: 80, width: 300),
                    ),
                  ),
                  Material(
                    child: MessageLongPressInkWell(
                      onLongPress: (_) => longPresses += 1,
                      child: GestureDetector(
                        key: const ValueKey('nested-gesture-target'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () => nestedTaps += 1,
                        child: const SizedBox(height: 80, width: 300),
                      ),
                    ),
                  ),
                  const SizedBox(height: 900),
                ],
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const ValueKey('parent-gesture-target')));
      await tester.tap(find.byKey(const ValueKey('nested-gesture-target')));
      await tester.pump();
      expect(parentTaps, 1);
      expect(nestedTaps, 1);

      for (var index = 0; index < 5; index++) {
        await tester.longPress(
          find.byKey(const ValueKey('nested-gesture-target')),
        );
        await tester.pump();
        expect(longPresses, index + 1);
        expect(nestedTaps, 1);
      }

      final drag = await tester.startGesture(
        tester.getCenter(find.byKey(const ValueKey('parent-gesture-target'))),
      );
      await drag.moveBy(const Offset(0, -30));
      await tester.pump();
      await drag.moveBy(const Offset(0, -70));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      await drag.up();
      await tester.pumpAndSettle();

      expect(longPresses, 5);
      expect(scrollController.offset, greaterThan(0));
    },
  );

  testWidgets('iOS message long press recognizes at 200 ms', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      var longPresses = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Material(
              child: MessageLongPressInkWell(
                key: const ValueKey('ios-long-press-target'),
                onLongPress: (_) => longPresses += 1,
                child: const SizedBox(width: 240, height: 80),
              ),
            ),
          ),
        ),
      );

      final gesture = await tester.startGesture(
        tester.getCenter(find.byKey(const ValueKey('ios-long-press-target'))),
      );
      await tester.pump(const Duration(milliseconds: 199));
      expect(longPresses, 0);
      await tester.pump(const Duration(milliseconds: 2));
      expect(longPresses, 1);
      await gesture.up();
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets(
    'message long press captures the content inside the ink surface',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetDevicePixelRatio);
      MessageLongPressDetails? longPressDetails;
      ui.Image? snapshot;
      addTearDown(() => snapshot?.dispose());

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Material(
              child: MessageLongPressInkWell(
                key: const ValueKey('snapshot-gesture-target'),
                onLongPressDetails: (details) => longPressDetails = details,
                child: const SizedBox(width: 240, height: 80),
              ),
            ),
          ),
        ),
      );

      await tester.longPress(
        find.byKey(const ValueKey('snapshot-gesture-target')),
      );
      expect(longPressDetails, isNotNull);

      final capture = longPressDetails!.captureSnapshot();
      await tester.pump();
      snapshot = await capture;

      expect(snapshot.width, 240);
      expect(snapshot.height, 80);
    },
  );

  testWidgets('message snapshot bounds very tall raster dimensions', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(800, 5000);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    MessageLongPressDetails? longPressDetails;
    ui.Image? snapshot;
    addTearDown(() => snapshot?.dispose());

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Material(
            child: MessageLongPressInkWell(
              key: const ValueKey('tall-snapshot-gesture-target'),
              onLongPressDetails: (details) => longPressDetails = details,
              child: const SizedBox(width: 240, height: 4096),
            ),
          ),
        ),
      ),
    );

    await tester.longPress(
      find.byKey(const ValueKey('tall-snapshot-gesture-target')),
    );
    expect(longPressDetails, isNotNull);

    final capture = longPressDetails!.captureSnapshot();
    await tester.pump();
    snapshot = await capture;

    expect(snapshot.width, 120);
    expect(snapshot.height, 2048);
  });

  group('Mobile message actions', () {
    testWidgets('offer no reactions, edits, deletions or reminders', (
      tester,
    ) async {
      await _pumpSheet(
        tester,
        message: _message(pubkey: 'self'),
        prefs: await _mockPrefs(),
        allMessages: [_message(pubkey: 'self')],
      );

      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Copy link'), findsOneWidget);
      expect(find.text('Copy text'), findsOneWidget);
      for (final removed in ['Edit message', 'Delete message', 'Remind me']) {
        expect(find.text(removed), findsNothing);
      }
      // 上游在这里放一排快捷表情回应
      expect(find.byType(NativeEmojiGlyph), findsNothing);
    });

    testWidgets('image actions never offer deletion', (tester) async {
      await _pumpImageSheet(tester, message: _message(pubkey: 'self'));

      expect(find.text('Save image'), findsOneWidget);
      expect(find.text('Share image'), findsOneWidget);
      expect(find.text('Copy image link'), findsOneWidget);
      expect(find.text('Delete message'), findsNothing);
    });

    testWidgets('system rows carry no actions', (tester) async {
      await _pumpSheet(
        tester,
        message: _message(isSystem: true),
        prefs: await _mockPrefs(),
      );

      expect(find.byType(BottomSheet), findsNothing);
    });
  });

  group('showMessageActions', () {
    testWidgets('restores composer focus only after a dismissed popover', (
      tester,
    ) async {
      final focusNode = FocusNode();
      addTearDown(focusNode.dispose);
      final prefs = await _mockPrefs();

      await _pumpMessageActionsPopover(
        tester,
        message: _message(),
        prefs: prefs,
        composerFocusNode: focusNode,
        composerInitiallyFocused: true,
      );

      expect(focusNode.hasFocus, isFalse);
      await _dismissMessageActionsPopover(tester);
      expect(focusNode.hasFocus, isTrue);
    });

    testWidgets('leaves an initially unfocused composer unfocused', (
      tester,
    ) async {
      final focusNode = FocusNode();
      addTearDown(focusNode.dispose);
      final prefs = await _mockPrefs();

      await _pumpMessageActionsPopover(
        tester,
        message: _message(),
        prefs: prefs,
        composerFocusNode: focusNode,
      );

      expect(focusNode.hasFocus, isFalse);
      await _dismissMessageActionsPopover(tester);
      expect(focusNode.hasFocus, isFalse);
    });

    testWidgets('does not restore composer focus after selecting an action', (
      tester,
    ) async {
      final focusNode = FocusNode();
      addTearDown(focusNode.dispose);
      final prefs = await _mockPrefs();

      await _pumpMessageActionsPopover(
        tester,
        message: _message(rootId: 'root-9'),
        prefs: prefs,
        composerFocusNode: focusNode,
        composerInitiallyFocused: true,
      );

      await tester.tap(
        find.byKey(const ValueKey('message-action-followThread')),
      );
      await tester.pumpAndSettle();
      expect(focusNode.hasFocus, isFalse);
    });

    testWidgets('runs an action after dismissal and can reopen', (
      tester,
    ) async {
      final prefs = await _mockPrefs();
      final harness = await _pumpMessageActionsPopover(
        tester,
        message: _message(rootId: 'root-9'),
        prefs: prefs,
      );

      await tester.tap(
        find.byKey(const ValueKey('message-action-followThread')),
      );
      await tester.pumpAndSettle();

      expect(harness.sourceHidden.value, isFalse);
      expect(harness.container.read(threadFollowsProvider).followedRootIds, {
        'root-9',
      });

      await tester.tap(
        find.byKey(const ValueKey('open-message-actions-popover')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('message-action-surface')),
        findsOneWidget,
      );
      await _dismissMessageActionsPopover(tester);
    });

    testWidgets('ignores repeat action taps once dismissal starts', (
      tester,
    ) async {
      final prefs = await _mockPrefs();
      final harness = await _pumpMessageActionsPopover(
        tester,
        message: _message(rootId: 'root-9'),
        prefs: prefs,
        launcherOnNestedRoute: true,
      );
      final action = find.byKey(const ValueKey('message-action-followThread'));
      final actionWidget = tester.widget<InkWell>(action);

      actionWidget.onTap!.call();
      actionWidget.onTap!.call();
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('message-actions-underlying-page')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-actions-root-page')),
        findsNothing,
      );
      expect(harness.container.read(threadFollowsProvider).followedRootIds, {
        'root-9',
      });
      expect(tester.takeException(), isNull);
    });

    testWidgets('ignores repeat backdrop taps once dismissal starts', (
      tester,
    ) async {
      final prefs = await _mockPrefs();
      await _pumpMessageActionsPopover(
        tester,
        message: _message(),
        prefs: prefs,
        launcherOnNestedRoute: true,
      );
      final backdrop = tester.widget<GestureDetector>(
        find.byKey(const ValueKey('message-actions-backdrop')),
      );

      backdrop.onTap!.call();
      backdrop.onTap!.call();
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('message-actions-underlying-page')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-actions-root-page')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('fallback action rows grow with accessibility text', (
      tester,
    ) async {
      final prefs = await _mockPrefs();
      await _pumpMessageActionsPopover(
        tester,
        message: _message(rootId: 'root-9'),
        prefs: prefs,
        textScaler: const TextScaler.linear(3),
      );

      final rowFinder = find.byKey(
        const ValueKey('message-action-followThread'),
      );
      expect(tester.getSize(rowFinder).height, greaterThan(48));
      expect(tester.takeException(), isNull);

      await _dismissMessageActionsPopover(tester);
    });

    testWidgets('keeps the snapshot alive through the reverse transition', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      ui.Image? snapshot;
      try {
        final prefs = await _mockPrefs();
        await _pumpMessageActionsPopover(
          tester,
          message: _message(),
          prefs: prefs,
          captureAnchorSnapshot: () async {
            snapshot = await _testMessageSnapshot();
            return snapshot!;
          },
        );

        final image = snapshot!;
        expect(image.debugDisposed, isFalse);
        Navigator.of(
          tester.element(find.byKey(const ValueKey('message-action-surface'))),
        ).pop();
        await tester.pump();

        expect(
          find.byKey(const ValueKey('message-action-preview')),
          findsOneWidget,
        );
        expect(image.debugDisposed, isFalse);
        await tester.pump(const Duration(milliseconds: 110));
        expect(image.debugDisposed, isFalse);

        await tester.pumpAndSettle();
        expect(image.debugDisposed, isTrue);
        expect(tester.takeException(), isNull);
      } finally {
        final image = snapshot;
        if (image != null && !image.debugDisposed) image.dispose();
        debugDefaultTargetPlatformOverride = null;
      }
    });

    testWidgets('Mark read appears for unread messages and advances the '
        'message marker', (tester) async {
      final prefs = await _mockPrefs();
      final notifier = _FakeReadStateNotifier(
        _readState(const {_channelId: 500}),
      );
      await _pumpSheet(
        tester,
        message: _message(createdAt: 900),
        prefs: prefs,
        readStateOverride: () => notifier,
      );

      expect(find.text('Mark read'), findsOneWidget);
      await tester.tap(find.text('Mark read'));
      await tester.pumpAndSettle();

      expect(notifier.markedRead, {'msg:msg-1': 900});
    });

    testWidgets('Mark unread forces the message unread', (tester) async {
      final prefs = await _mockPrefs();
      final notifier = _FakeReadStateNotifier(
        _readState(const {_channelId: 2000}),
      );
      await _pumpSheet(
        tester,
        message: _message(createdAt: 900),
        prefs: prefs,
        readStateOverride: () => notifier,
      );

      expect(find.text('Mark unread'), findsOneWidget);
      await tester.tap(find.text('Mark unread'));
      await tester.pumpAndSettle();

      // The force flag is message-scoped, mapped to its channel so tiles and
      // badges surface it.
      expect(notifier.markedUnread, ['msg:msg-1']);
      expect(notifier.state.forcedUnreadContexts, {'msg:msg-1': _channelId});
      expect(notifier.state.locallyForcedChannelIds, {_channelId});
    });

    testWidgets('Mark read after a forced unread clears the force flag so '
        'the toggle round-trips', (tester) async {
      final prefs = await _mockPrefs();
      final notifier = _FakeReadStateNotifier(
        _readState(const {_channelId: 2000}),
      );
      await _pumpSheet(
        tester,
        message: _message(createdAt: 900),
        prefs: prefs,
        readStateOverride: () => notifier,
      );

      // Force the message unread; the row flips to Mark read.
      await tester.tap(find.text('Mark unread'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Mark read'), findsOneWidget);

      // Mark read must clear the message's own force flag — otherwise the
      // row sticks on "Mark read".
      await tester.tap(find.text('Mark read'));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.text('open')),
      );
      expect(container.read(readStateProvider).forcedUnreadContexts, isEmpty);

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Mark unread'), findsOneWidget);
      expect(find.text('Mark read'), findsNothing);
    });

    testWidgets('message-level Mark read leaves a channel-level forced '
        'unread untouched', (tester) async {
      final prefs = await _mockPrefs();
      final notifier = _FakeReadStateNotifier(
        ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: const {_channelId: 2000},
          version: 1,
          // Channel forced unread from the channel tile, message forced
          // unread from this sheet.
          forcedUnreadContexts: const {
            _channelId: _channelId,
            'msg:msg-1': _channelId,
          },
        ),
      );
      await _pumpSheet(
        tester,
        message: _message(createdAt: 900),
        prefs: prefs,
        readStateOverride: () => notifier,
      );

      expect(find.text('Mark read'), findsOneWidget);
      await tester.tap(find.text('Mark read'));
      await tester.pumpAndSettle();

      // The message's flag is gone; the user's channel-level choice stays.
      final readState = notifier.state;
      expect(readState.forcedUnreadContexts, {_channelId: _channelId});
      expect(readState.locallyForcedChannelIds, {_channelId});
    });

    testWidgets('hides read-state row while read state is not ready', (
      tester,
    ) async {
      final prefs = await _mockPrefs();
      await _pumpSheet(
        tester,
        message: _message(),
        prefs: prefs,
        readStateOverride: () =>
            _FakeReadStateNotifier(_readState(const {}, isReady: false)),
      );

      expect(find.text('Mark unread'), findsNothing);
      expect(find.text('Mark read'), findsNothing);
    });

    testWidgets('Follow thread toggles the effective root id', (tester) async {
      final prefs = await _mockPrefs();
      await _pumpSheet(
        tester,
        message: _message(rootId: 'root-9'),
        prefs: prefs,
      );

      await tester.tap(find.text('Follow thread'));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.text('open')),
      );
      expect(container.read(threadFollowsProvider).followedRootIds, {'root-9'});

      // Re-open: the row now offers Unfollow.
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Unfollow thread'), findsOneWidget);

      await tester.tap(find.text('Unfollow thread'));
      await tester.pumpAndSettle();
      expect(container.read(threadFollowsProvider).followedRootIds, isEmpty);
    });
  });

  group('showImageActions', () {});

  group('downloadedImageFilename', () {
    test('preserves gif file extensions', () {
      expect(
        downloadedImageFilename('https://example.com/animation.gif', null),
        'animation.gif',
      );
    });

    test('uses gif extension for gif content types', () {
      expect(
        downloadedImageFilename(
          'https://example.com/download',
          'image/gif; charset=binary',
        ),
        matches(RegExp(r'^buzz-\d+\.gif$')),
      );
    });
  });

  group('messageLinkFor', () {
    test('builds a canonical link with thread context', () {
      expect(
        messageLinkFor(
          message: _message(rootId: 'root-1'),
          channelId: _channelId,
        ),
        'buzz://message?channel=chan-1&id=msg-1&thread=root-1',
      );
    });

    test('omits thread for top-level messages', () {
      expect(
        messageLinkFor(message: _message(), channelId: _channelId),
        'buzz://message?channel=chan-1&id=msg-1',
      );
    });
  });
}
