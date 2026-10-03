import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderParagraph, ScrollDirection;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_detail_page.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/channel_messages_provider.dart';
import 'package:buzz/features/channels/composer_dock_size_reporter.dart';
import 'package:buzz/features/channels/date_formatters.dart';
import 'package:buzz/features/channels/day_divider.dart';
import 'package:buzz/features/channels/ime_metrics_settle_observer.dart';
import 'package:buzz/features/channels/local_message_send_animation_provider.dart';
import 'package:buzz/features/channels/thread_detail_page.dart';
import 'package:buzz/features/channels/thread_replies_provider.dart';
import 'package:buzz/features/channels/timeline_message.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/features/channels/unread_badge/observed_unread_event.dart';
import 'package:buzz/features/channels/small_avatar.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/features/profile/user_profile_sheet.dart';
import 'package:buzz/shared/mentions/agent_identity_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/avatar_image.dart';
import 'package:buzz/shared/widgets/frosted_app_bar.dart';
import 'package:buzz/shared/widgets/keyboard_dismiss_on_drag.dart';
import 'package:buzz/shared/widgets/ios_glass_navigation_button.dart';
import 'package:buzz/shared/widgets/skeleton.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _channelId = '11111111-2222-4333-8444-555555555555';

/// Shared mock prefs for providers that read [savedPrefsProvider]
/// (e.g. the compose bar's draft store). Initialized in [main].
late SharedPreferences _testPrefs;

final _testChannel = Channel(
  id: _channelId,
  name: 'general',
  channelType: 'stream',
  visibility: 'open',
  description: 'General discussion',
  createdBy: 'abc123',
  createdAt: DateTime(2025),
  memberCount: 5,
  isMember: true,
);

NostrEvent _textMsg({
  required String id,
  required String pubkey,
  required String content,
  int createdAt = 1000,
  List<List<String>> extraTags = const [],
}) => NostrEvent(
  id: id,
  pubkey: pubkey,
  createdAt: createdAt,
  kind: EventKind.streamMessage,
  tags: [
    ['h', _channelId],
    ...extraTags,
  ],
  content: content,
  sig: '',
);

NostrEvent _systemMsg({
  required String id,
  required Map<String, dynamic> payload,
  int createdAt = 1000,
}) => NostrEvent(
  id: id,
  pubkey: 'relay',
  createdAt: createdAt,
  kind: EventKind.systemMessage,
  tags: [
    ['h', _channelId],
  ],
  content: jsonEncode(payload),
  sig: '',
);

NostrEvent _deletion({
  required String id,
  required List<String> targetIds,
  int createdAt = 2000,
}) => NostrEvent(
  id: id,
  pubkey: 'abc123',
  createdAt: createdAt,
  kind: EventKind.deletion,
  tags: [
    ['h', _channelId],
    for (final t in targetIds) ['e', t],
  ],
  content: '',
  sig: '',
);

NostrEvent _edit({
  required String id,
  required String targetId,
  required String content,
  int createdAt = 2000,
}) => NostrEvent(
  id: id,
  pubkey: 'abc123',
  createdAt: createdAt,
  kind: EventKind.streamMessageEdit,
  tags: [
    ['h', _channelId],
    ['e', targetId],
  ],
  content: content,
  sig: '',
);

Widget _buildTestable({
  required List<NostrEvent> messages,
  Map<String, UserProfile> users = const {},
  Set<String>? knownAgentPubkeys,
  Future<Set<String>> Function()? loadChannelBotPubkeys,
  bool watchChannelMembershipUpdates = false,
  Future<List<AgentDirectoryEntry>> Function()? loadAgentDirectory,
  Future<Map<String, String>> Function()? loadAgentOwners,
  UserCacheNotifier? userCacheNotifier,
  List<ChannelMember> members = const [],
  List<WorkspaceMemberView>? platformMembers,
  Channel? channel,
  List<Channel>? channels,
  _FakeChannelsNotifier? channelsNotifier,
  List<NavigatorObserver> navigatorObservers = const [],
  Future<List<ChannelMember>> Function()? loadMembers,
  ReadStateNotifier? readStateNotifier,
  _FakeMessagesNotifier? messagesNotifier,
  String? initialMessageId,
  String? initialThreadRootId,
  InitialThreadRouteBehavior initialThreadRouteBehavior =
      InitialThreadRouteBehavior.push,
  Map<String, List<NostrEvent>> threadReplies = const {},
  Map<String, Future<List<NostrEvent>>> pendingThreadReplies = const {},
  Map<String, Future<List<NostrEvent>> Function()> threadReplyLoaders =
      const {},
  Map<String, List<NostrEvent>> localThreadReplies = const {},
  TextScaler textScaler = TextScaler.noScaling,
  bool disableAnimations = false,
  bool disableRetries = false,
  Duration? Function(int retryCount, Object error)? providerRetry,
  RelaySessionNotifier? relaySessionNotifier,
  RelayConfigNotifier? relayConfigNotifier,
  String? currentPubkey,
  http.Client? mediaClient,
  Widget? home,
}) {
  final resolvedChannel = channel ?? _testChannel;
  final navigatorKey = GlobalKey<NavigatorState>();
  final fakeChannelsNotifier =
      channelsNotifier ?? _FakeChannelsNotifier(channels ?? [resolvedChannel]);
  final fakeMessagesNotifier =
      messagesNotifier ?? _FakeMessagesNotifier(messages);
  return ProviderScope(
    retry: providerRetry ?? (disableRetries ? (_, _) => null : null),
    overrides: [
      channelMessagesProvider(
        _channelId,
      ).overrideWith(() => fakeMessagesNotifier),
      userCacheProvider.overrideWith(
        () => userCacheNotifier ?? _FakeUserCacheNotifier(users),
      ),
      channelsProvider.overrideWith(() => fakeChannelsNotifier),
      channelDetailsProvider(_channelId).overrideWith(
        (ref) async => ChannelDetails.fromChannel(resolvedChannel),
      ),
      channelMembersProvider(_channelId).overrideWith(
        (ref) async => loadMembers != null ? loadMembers() : members,
      ),
      if (platformMembers != null)
        platformWorkspaceMembersProvider(
          _channelId,
        ).overrideWith((ref) async => platformMembers),
      if (!watchChannelMembershipUpdates)
        channelBotPubkeysProvider(_channelId).overrideWith(
          (ref) async => loadChannelBotPubkeys?.call() ?? const <String>{},
        ),
      agentOwnersProvider.overrideWith(
        (ref) async => loadAgentOwners?.call() ?? const <String, String>{},
      ),
      agentDirectoryProvider.overrideWith(
        (ref) async => loadAgentDirectory?.call() ?? const [],
      ),
      if (knownAgentPubkeys != null)
        knownAgentPubkeysProvider.overrideWithValue(knownAgentPubkeys),
      if (readStateNotifier != null)
        readStateProvider.overrideWith(() => readStateNotifier),
      for (final entry in threadReplies.entries)
        threadRepliesProvider(
          ThreadRepliesArgs(channelId: _channelId, rootId: entry.key),
        ).overrideWith((ref) async => entry.value),
      for (final entry in pendingThreadReplies.entries)
        threadRepliesProvider(
          ThreadRepliesArgs(channelId: _channelId, rootId: entry.key),
        ).overrideWith((ref) => entry.value),
      for (final entry in threadReplyLoaders.entries)
        threadRepliesProvider(
          ThreadRepliesArgs(channelId: _channelId, rootId: entry.key),
        ).overrideWith((ref) => entry.value()),
      for (final entry in localThreadReplies.entries)
        threadLocalRepliesProvider(
          ThreadRepliesArgs(channelId: _channelId, rootId: entry.key),
        ).overrideWith(
          () => _FakeThreadLocalRepliesNotifier(
            ThreadRepliesArgs(channelId: _channelId, rootId: entry.key),
            entry.value,
          ),
        ),
      if (mediaClient != null) ...[
        mediaGetAuthServiceProvider.overrideWithValue(
          MediaGetAuthService(baseUrl: 'https://relay.example', nsec: null),
        ),
        mediaHttpClientProvider.overrideWithValue(mediaClient),
      ],
      if (relaySessionNotifier != null)
        relaySessionProvider.overrideWith(() => relaySessionNotifier),
      if (relayConfigNotifier != null)
        relayConfigProvider.overrideWith(() => relayConfigNotifier),
      currentPubkeyProvider.overrideWith((ref) => currentPubkey ?? 'self'),
      appLifecycleProvider.overrideWith(_TestAppLifecycleNotifier.new),
      // Compose bar drafts persist through SharedPreferences.
      savedPrefsProvider.overrideWithValue(_testPrefs),
    ],
    child: MaterialApp(
      navigatorKey: navigatorKey,
      theme: AppTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: textScaler,
          disableAnimations: disableAnimations,
        ),
        child: child!,
      ),
      navigatorObservers: navigatorObservers,
      home:
          home ??
          ChannelDetailPage(
            channel: resolvedChannel,
            initialMessageId: initialMessageId,
            initialThreadRootId: initialThreadRootId,
            initialThreadRouteBehavior: initialThreadRouteBehavior,
          ),
    ),
  );
}

Widget _buildNavigationTestable({
  required Channel channelA,
  required Channel channelB,
  required RelaySessionNotifier relaySession,
}) {
  return ProviderScope(
    overrides: [
      relaySessionProvider.overrideWith(() => relaySession),
      channelMessagesProvider(
        channelA.id,
      ).overrideWith(() => _FakeMessagesNotifier([], channelId: channelA.id)),
      channelMessagesProvider(
        channelB.id,
      ).overrideWith(() => _FakeMessagesNotifier([], channelId: channelB.id)),
      channelDetailsProvider(
        channelA.id,
      ).overrideWith((ref) async => ChannelDetails.fromChannel(channelA)),
      channelDetailsProvider(
        channelB.id,
      ).overrideWith((ref) async => ChannelDetails.fromChannel(channelB)),
      channelMembersProvider(
        channelA.id,
      ).overrideWith((ref) async => const <ChannelMember>[]),
      channelMembersProvider(
        channelB.id,
      ).overrideWith((ref) async => const <ChannelMember>[]),
      userCacheProvider.overrideWith(() => _FakeUserCacheNotifier({})),
      channelsProvider.overrideWith(
        () => _FakeChannelsNotifier([channelA, channelB]),
      ),
      savedPrefsProvider.overrideWithValue(_testPrefs),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      home: ChannelDetailPage(channel: channelA),
    ),
  );
}

/// Finder that searches for text within RichText spans. [find.text] only
/// matches the top-level text property; this also searches nested TextSpans.
Finder findRichText(String text) {
  return find.byWidgetPredicate((widget) {
    if (widget is RichText) {
      return widget.text.toPlainText().contains(text);
    }
    return false;
  }, description: 'RichText containing "$text"');
}

double? effectiveFontSizeForText(
  InlineSpan span,
  String text, [
  TextStyle? inheritedStyle,
]) {
  if (span is! TextSpan) return null;
  final effectiveStyle = inheritedStyle?.merge(span.style) ?? span.style;
  if ((span.text ?? '').contains(text)) return effectiveStyle?.fontSize;
  for (final child in span.children ?? const <InlineSpan>[]) {
    final size = effectiveFontSizeForText(child, text, effectiveStyle);
    if (size != null) return size;
  }
  return null;
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    _testPrefs = await SharedPreferences.getInstance();
  });

  for (final thread in [false, true]) {
    for (final reverse in [false, true]) {
      testWidgets('signed qualified caller thread=$thread reverse=$reverse', (
        tester,
      ) async {
        final first = 'a' * 64, second = 'b' * 64, sibling = 'c' * 64;
        Future<void> tapProfile(String label, String key) async {
          await tester.tap(find.text(label));
          await tester.pumpAndSettle();
          expect(
            tester
                .widget<UserProfileSheet>(find.byType(UserProfileSheet))
                .pubkey,
            key,
          );
          await tester.tap(find.byTooltip('Close sheet'));
          await tester.pumpAndSettle();
        }

        for (final firstName in ['Scout', 'Renamed Scout', first, null]) {
          for (final secondName in [null, 'Scout', 'Renamed Scout', second]) {
            for (final bystander in [null, 'Bob', 'Scout']) {
              final names = {
                first: ?firstName,
                second: ?secondName,
                sibling: 'Alice',
                'd' * 64: ?bystander,
              };
              final keys = [
                first,
                second.toUpperCase(),
                sibling,
                if (bystander != null) 'd' * 64,
              ];
              final event = _textMsg(
                id: 'qualified',
                pubkey: 'author',
                content: '@Scout @Scout ($second) @Alice @Other (${'e' * 64})',
                extraTags: [
                  for (final key in reverse ? keys.reversed : keys) ['p', key],
                ],
              );
              await tester.pumpWidget(
                _buildTestable(
                  messages: [event],
                  users: {
                    for (final e in names.entries)
                      e.key: UserProfile(pubkey: e.key, displayName: e.value),
                  },
                  threadReplies: const {'qualified': []},
                  initialThreadRootId: thread ? 'qualified' : null,
                ),
              );
              await tester.pumpAndSettle();
              await tapProfile('Scout (bbbbbbbb…bbbb)', second);
              expect(find.text('Scout'), findsNothing);
              expect(find.text('Bob'), findsNothing);
              if (firstName != null) expect(find.text(firstName), findsNothing);
              expect(find.text('Other (eeeeeeee…eeee)'), findsNothing);
              await tapProfile('Alice', sibling);
              expect(tester.takeException(), isNull);
              await tester.pumpWidget(const SizedBox.shrink());
              await tester.pumpAndSettle();
            }
          }
        }
      });
    }
  }

  group('ChannelDetailPage', () {
    testWidgets(
      'bot-role author avatars stay squircles in channel and thread',
      (tester) async {
        final message = _textMsg(
          id: 'bot-message',
          pubkey: 'bot',
          content: 'Bot message',
        );
        await tester.pumpWidget(
          _buildTestable(
            messages: [message],
            users: const {
              'bot': UserProfile(pubkey: 'bot', displayName: 'Bot'),
            },
            loadChannelBotPubkeys: () async => const {'bot'},
            threadReplies: const {'bot-message': []},
          ),
        );
        await tester.pumpAndSettle();

        AvatarImage avatarIn(Finder row) => tester.widget<AvatarImage>(
          find.descendant(of: row, matching: find.byType(AvatarImage)),
        );
        expect(
          avatarIn(
            find.byKey(const ValueKey('message-row-bot-message')),
          ).isAgent,
          isTrue,
        );

        await tester.tap(find.byKey(const ValueKey('message-row-bot-message')));
        await tester.pumpAndSettle();
        expect(
          avatarIn(
            find.byKey(const ValueKey('thread-message-row-bot-message')),
          ).isAgent,
          isTrue,
        );
      },
    );

    testWidgets(
      'restores the previous channel replay priority after a nested pop',
      (tester) async {
        final channelA = _channel(id: 'channel-a', name: 'channel A');
        final channelB = _channel(id: 'channel-b', name: 'channel B');
        final socket = _RecordingRelaySocket();
        final relaySession = RelaySessionNotifier();
        relaySession.debugAttachSocketForTest(socket);

        final subscribeB = relaySession.subscribe(
          _filterForChannel(channelB.id),
          (_) {},
        );
        relaySession.debugHandleMessage(['EOSE', 'l-1']);
        await subscribeB;
        final subscribeA = relaySession.subscribe(
          _filterForChannel(channelA.id),
          (_) {},
        );
        relaySession.debugHandleMessage(['EOSE', 'l-2']);
        await subscribeA;

        await tester.pumpWidget(
          _buildNavigationTestable(
            channelA: channelA,
            channelB: channelB,
            relaySession: relaySession,
          ),
        );
        await tester.pumpAndSettle();

        final navigator = Navigator.of(
          tester.element(find.byType(ChannelDetailPage)),
        );
        navigator.push(
          MaterialPageRoute<void>(
            builder: (_) => ChannelDetailPage(channel: channelB),
          ),
        );
        await tester.pumpAndSettle();
        navigator.pop();
        await tester.pumpAndSettle();

        socket.messages.clear();
        await relaySession.debugReplayLiveSubscriptions();

        expect(_replayedChannelIds(socket), [channelA.id, channelB.id]);
      },
    );

    testWidgets(
      'keeps replacement channel replay priority after old route disposal',
      (tester) async {
        final channelA = _channel(id: 'channel-a', name: 'channel A');
        final channelB = _channel(id: 'channel-b', name: 'channel B');
        final socket = _RecordingRelaySocket();
        final relaySession = RelaySessionNotifier();
        relaySession.debugAttachSocketForTest(socket);

        final subscribeA = relaySession.subscribe(
          _filterForChannel(channelA.id),
          (_) {},
        );
        relaySession.debugHandleMessage(['EOSE', 'l-1']);
        await subscribeA;
        final subscribeB = relaySession.subscribe(
          _filterForChannel(channelB.id),
          (_) {},
        );
        relaySession.debugHandleMessage(['EOSE', 'l-2']);
        await subscribeB;

        await tester.pumpWidget(
          _buildNavigationTestable(
            channelA: channelA,
            channelB: channelB,
            relaySession: relaySession,
          ),
        );
        await tester.pumpAndSettle();

        Navigator.of(
          tester.element(find.byType(ChannelDetailPage)),
        ).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => ChannelDetailPage(channel: channelB),
          ),
        );
        await tester.pumpAndSettle();

        socket.messages.clear();
        await relaySession.debugReplayLiveSubscriptions();

        expect(_replayedChannelIds(socket), [channelB.id, channelA.id]);
      },
    );

    testWidgets('debounces same-slot reconnect skeletons before revealing', (
      tester,
    ) async {
      final relaySession = _ReconnectingRelaySession();
      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(id: 'msg1', pubkey: 'alice', content: 'Existing message'),
          ],
          relaySessionNotifier: relaySession,
          readStateNotifier: _SynchronousReadStateNotifier(
            const ReadStateState(
              isReady: false,
              pubkey: 'self',
              contexts: {},
              version: 0,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Existing message'), findsOneWidget);
      // 重连期间如实说明未同步，而不是只换骨架屏
      final notSynced = find.byKey(
        const ValueKey('relay-sync-banner-nativeSyncReconnecting'),
      );
      expect(notSynced, findsOneWidget);
      expect(
        tester.widget<SkeletonReveal>(find.byType(SkeletonReveal)).loading,
        isFalse,
      );

      await tester.pump(const Duration(milliseconds: 1999));
      expect(
        tester.widget<SkeletonReveal>(find.byType(SkeletonReveal)).loading,
        isFalse,
      );

      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      final skeleton = find.byKey(
        const Key('channel-detail-connection-skeleton'),
      );
      expect(skeleton, findsOneWidget);
      expect(
        find.descendant(of: skeleton, matching: find.byType(SkeletonBar)),
        findsWidgets,
      );
      expect(find.text('Existing message'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(
        tester
            .widget<Opacity>(
              find.byKey(const Key('skeleton-reveal-placeholder')),
            )
            .opacity,
        1,
      );

      relaySession.connect();
      await tester.pump();
      await tester.pump();
      expect(notSynced, findsNothing);
      expect(
        tester.widget<SkeletonReveal>(find.byType(SkeletonReveal)).loading,
        isFalse,
      );
      await tester.pump(const Duration(milliseconds: 200));

      expect(
        tester
            .widget<Opacity>(
              find.byKey(const Key('skeleton-reveal-placeholder')),
            )
            .opacity,
        closeTo(0.5, 0.01),
      );
      expect(
        tester
            .widget<Opacity>(find.byKey(const Key('skeleton-reveal-content')))
            .opacity,
        closeTo(0.5, 0.01),
      );

      await tester.pump(const Duration(milliseconds: 200));
      expect(
        tester
            .widget<Opacity>(find.byKey(const Key('skeleton-reveal-content')))
            .opacity,
        1,
      );
    });

    testWidgets('shows the first-load connection skeleton immediately', (
      tester,
    ) async {
      final relaySession = _ReconnectingRelaySession();
      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: _FakeMessagesNotifier(
            const [],
            hasLoadedMessages: false,
          ),
          relaySessionNotifier: relaySession,
        ),
      );
      await tester.pump();

      expect(
        tester.widget<SkeletonReveal>(find.byType(SkeletonReveal)).loading,
        isTrue,
      );
      expect(
        tester
            .widget<Opacity>(
              find.byKey(const Key('skeleton-reveal-placeholder')),
            )
            .opacity,
        1,
      );
      expect(
        tester
            .widget<Semantics>(
              find.byKey(const Key('channel-detail-connection-skeleton')),
            )
            .properties
            .label,
        'Reconnecting',
      );
    });

    testWidgets('defers read-state mark until after build', (tester) async {
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'msg1',
              pubkey: 'alice',
              content: 'First',
              createdAt: 1100,
            ),
            _textMsg(
              id: 'msg2',
              pubkey: 'alice',
              content: 'Latest',
              createdAt: 1200,
            ),
          ],
          readStateNotifier: readState,
        ),
      );

      expect(tester.takeException(), isNull);
      await tester.pump();

      expect(readState.markedContexts, {_channelId: 1200});
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders video attachments from imeta tags in the timeline', (
      tester,
    ) async {
      const videoUrl = 'https://example.com/media/clip.mp4';

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'video-1',
              pubkey: 'alice',
              content: '![video]($videoUrl)',
              extraTags: const [
                [
                  'imeta',
                  'url https://example.com/media/clip.mp4',
                  'm video/mp4',
                  'image https://example.com/media/poster.jpg',
                ],
              ],
            ),
          ],
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(
          const ValueKey(
            'message-media-video-preview:https://example.com/media/clip.mp4',
          ),
        ),
        findsOneWidget,
      );
    });

    testWidgets('hides composer for archived channels', (tester) async {
      final archivedChannel = _testChannel.copyWith(
        archivedAt: DateTime.utc(2025, 1, 2),
      );

      await tester.pumpWidget(
        _buildTestable(messages: const [], channel: archivedChannel),
      );
      await tester.pumpAndSettle();

      expect(find.text('Message…'), findsNothing);
      expect(
        find.text('This channel is archived and read-only.'),
        findsOneWidget,
      );
    });

    testWidgets('clears the composer inset when membership is revoked', (
      tester,
    ) async {
      final channelsNotifier = _FakeChannelsNotifier([_testChannel]);
      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'msg1',
              pubkey: 'alice',
              content: 'Hello',
              createdAt: 1000,
            ),
          ],
          channelsNotifier: channelsNotifier,
        ),
      );
      await tester.pumpAndSettle();

      final messageListFinder = find.byKey(
        const ValueKey('channel-message-list'),
      );
      expect(
        tester
            .widget<ScrollablePositionedList>(messageListFinder)
            .padding!
            .bottom,
        greaterThan(0),
      );
      expect(
        find.byKey(const ValueKey('channel-composer-dock')),
        findsOneWidget,
      );

      channelsNotifier.setChannels([_testChannel.copyWith(isMember: false)]);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('channel-composer-dock')), findsNothing);
      expect(
        tester
            .widget<ScrollablePositionedList>(messageListFinder)
            .padding!
            .bottom,
        0,
      );
    });

    testWidgets('shows empty state when no messages', (tester) async {
      await tester.pumpWidget(_buildTestable(messages: []));
      await tester.pumpAndSettle();

      expect(find.text('No messages yet'), findsOneWidget);
      expect(find.text('Be the first to say something!'), findsOneWidget);
    });

    testWidgets('renders text messages with author and content', (
      tester,
    ) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Hello world!',
          createdAt: 1000,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'bob',
          content: 'Hey Alice!',
          createdAt: 1100,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(
              pubkey: 'alice',
              displayName: 'Alice',
              nip05Handle: 'alice@example.com',
            ),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Hello world!'), findsOneWidget);
      expect(findRichText('Hey Alice!'), findsOneWidget);
      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('alice@example.com'), findsOneWidget);
      expect(find.text('Bob'), findsOneWidget);
      final messageAvatars = find.byType(CircleAvatar);
      expect(messageAvatars, findsNWidgets(2));
      for (final avatar in messageAvatars.evaluate()) {
        expect(
          tester.getSize(find.byWidget(avatar.widget)),
          const Size.square(messageAvatarSize),
        );
      }
      final aliceName = find.text('Alice');
      final aliceText = tester.widget<Text>(aliceName);
      expect(aliceText.style?.fontSize, messageUsernameTextStyle.fontSize);
      expect(aliceText.style?.fontWeight, messageUsernameTextStyle.fontWeight);
      expect(aliceText.style?.height, messageUsernameTextStyle.height);
      final aliceUsername = tester.widget<Text>(
        find.byKey(const ValueKey('message-username-msg1')),
      );
      final aliceTimestamp = tester.widget<Text>(
        find.byKey(const ValueKey('message-timestamp-msg1')),
      );
      expect(aliceUsername.style?.fontSize, messageMetadataTextStyle.fontSize);
      expect(aliceUsername.style?.fontWeight, FontWeight.w400);
      expect(aliceUsername.style?.height, messageMetadataTextStyle.height);
      expect(
        aliceTimestamp.style?.fontSize,
        messageTimestampTextStyle.fontSize,
      );
      expect(aliceTimestamp.style?.fontWeight, FontWeight.w400);
      expect(
        aliceTimestamp.style?.fontSize,
        lessThan(aliceText.style!.fontSize!),
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('message-row-msg1')),
          matching: find.text('·'),
        ),
        findsNothing,
      );
      final helloContent = findRichText('Hello world!');
      final helloText = tester.widget<RichText>(helloContent);
      expect(
        effectiveFontSizeForText(helloText.text, 'Hello world!'),
        messageBodyTextStyle.fontSize,
      );
      final messageList = tester.widget<ScrollablePositionedList>(
        find.byKey(const ValueKey('channel-message-list')),
      );
      final composerDock = find.byKey(const ValueKey('channel-composer-dock'));
      final composerDockHeight = tester.getSize(composerDock).height;
      expect(messageList.padding!.bottom, composerDockHeight);
      expect(
        tester
            .getBottomLeft(find.byKey(const ValueKey('channel-message-list')))
            .dy,
        greaterThan(tester.getTopLeft(composerDock).dy),
      );
      final newestMessageGroup = tester.widget<Padding>(
        find.byKey(const ValueKey('channel-message-group-msg2')),
      );
      expect(
        newestMessageGroup.padding,
        const EdgeInsets.only(bottom: Grid.xs),
      );
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsNothing,
      );
      await tester.tap(find.text('Message #general'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsNothing,
      );
    });

    testWidgets('keeps animated message avatars static and transparent', (
      tester,
    ) async {
      const posterUrl = 'https://relay.example/media/alice-poster.png';
      const animationUrl = 'https://relay.example/media/alice-avatar.png';
      final profileUrl =
          '$posterUrl#buzz-anim=${Uri.encodeComponent(animationUrl)}';
      final mediaClient = http_testing.MockClient(
        (_) async => http.Response.bytes(_transparentPng, 200),
      );
      addTearDown(mediaClient.close);

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(id: 'animated-avatar', pubkey: 'alice', content: 'Hello'),
          ],
          users: {
            'alice': UserProfile(
              pubkey: 'alice',
              displayName: 'Alice',
              avatarUrl: profileUrl,
            ),
          },
          mediaClient: mediaClient,
        ),
      );
      await tester.pumpAndSettle();

      expect(
        tester.widget<CircleAvatar>(find.byType(CircleAvatar)).backgroundColor,
        Colors.transparent,
      );
      expect(tester.widget<MediaImage>(find.byType(MediaImage)).url, posterUrl);
      expect(
        find.byKey(const ValueKey('progressive-animated-avatar-animation')),
        findsNothing,
      );
    });

    testWidgets(
      'keeps image galleries body-aligned and flush with the trailing edge',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        const firstImage = 'https://example.com/media/first.png';
        const secondImage = 'https://example.com/media/second.png';
        await tester.pumpWidget(
          _buildTestable(
            messages: [
              _textMsg(
                id: 'gallery',
                pubkey: 'alice',
                content:
                    'Gallery\n'
                    '![First]($firstImage)\n'
                    '![Second]($secondImage)',
                extraTags: const [
                  ['imeta', 'url $firstImage', 'm image/png'],
                  ['imeta', 'url $secondImage', 'm image/png'],
                ],
              ),
            ],
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final carousel = find.byKey(const ValueKey('message-media-carousel'));
        final imageCount = find.byKey(
          const ValueKey('message-media-carousel-count'),
        );
        final carouselRect = tester.getRect(carousel);
        final imageCountRect = tester.getRect(imageCount);

        expect(carouselRect.left, imageCountRect.left);
        expect(carouselRect.right, tester.view.physicalSize.width);
        expect(carouselRect.top - imageCountRect.bottom, Grid.half + 2);

        final messageMaterial = find
            .ancestor(
              of: find.byKey(const ValueKey('message-row-gallery')),
              matching: find.byType(Material),
            )
            .first;
        expect(
          tester.widget<Material>(messageMaterial).clipBehavior,
          Clip.none,
        );
      },
    );

    testWidgets('uses larger participant avatars in reply summaries', (
      tester,
    ) async {
      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'root',
              pubkey: 'alice',
              content: 'Thread head',
              createdAt: 1000,
            ),
            _textMsg(
              id: 'reply-1',
              pubkey: 'bob',
              content: 'First reply',
              createdAt: 1100,
              extraTags: const [
                ['e', 'root', '', 'reply'],
              ],
            ),
            _textMsg(
              id: 'reply-2',
              pubkey: 'carol',
              content: 'Second reply',
              createdAt: 1200,
              extraTags: const [
                ['e', 'root', '', 'reply'],
              ],
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(
        findRichText(
          '2 replies · last reply '
          '${formatThreadSummaryLastReplyTime(1200)}',
        ),
        findsOneWidget,
      );
      expect(find.byIcon(LucideIcons.chevronRight), findsNothing);
      final replyAvatars = find.byType(SmallAvatar);
      expect(replyAvatars, findsNWidgets(2));
      for (final avatar in replyAvatars.evaluate()) {
        expect(
          tester.getSize(find.byWidget(avatar.widget)),
          const Size.square(32),
        );
      }
      final summaryPadding = tester.widget<Padding>(
        find.byKey(const ValueKey('thread-summary-root')),
      );
      expect(
        summaryPadding.padding,
        const EdgeInsets.only(
          left: messageAvatarSize + messageAvatarContentGap,
          top: Grid.half,
          bottom: Grid.xs,
        ),
      );
    });

    testWidgets('constrains reply summaries at accessibility text sizes', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final lastReplyAt =
          DateTime.now().millisecondsSinceEpoch ~/ 1000 - 59 * 60;
      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'root',
              pubkey: 'alice',
              content: 'Thread head',
              createdAt: lastReplyAt - 300,
            ),
            for (var i = 0; i < 3; i++)
              _textMsg(
                id: 'reply-$i',
                pubkey: 'participant-$i',
                content: 'Reply $i',
                createdAt: lastReplyAt - 2 + i,
                extraTags: const [
                  ['e', 'root', '', 'reply'],
                ],
              ),
          ],
          channel: _testChannel.copyWith(archivedAt: DateTime.now()),
          textScaler: const TextScaler.linear(2),
        ),
      );
      await tester.pumpAndSettle();

      final summaryText = tester.widget<RichText>(findRichText('3 replies'));
      expect(summaryText.maxLines, 2);
      expect(summaryText.overflow, TextOverflow.ellipsis);
      expect(tester.takeException(), isNull);
    });

    testWidgets('jumps to the oldest unread with compact inverse controls', (
      tester,
    ) async {
      final messages = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'msg21',
              createdAt: 1021,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final unreadButton = find.byKey(
        const ValueKey('channel-jump-to-oldest-unread'),
      );
      expect(unreadButton, findsOneWidget);
      expect(find.byTooltip('Jump to oldest unread message'), findsOneWidget);
      expect(
        find.descendant(
          of: unreadButton,
          matching: find.byIcon(LucideIcons.chevronUp),
        ),
        findsOneWidget,
      );
      expect(tester.getSize(unreadButton), const Size.square(48));
      final unreadRect = tester.getRect(unreadButton);
      expect(
        unreadRect.top,
        frostedAppBarHeight(
              tester.element(unreadButton),
              titleContentHeight: tester
                  .widget<FrostedAppBar>(find.byType(FrostedAppBar).first)
                  .titleContentHeight,
            ) +
            Grid.xs,
      );
      expect(find.text('Latest'), findsNothing);

      await tester.tap(unreadButton);
      await tester.pumpAndSettle();

      expect(findRichText('Message 21'), findsOneWidget);
      expect(unreadButton, findsNothing);
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsOneWidget,
      );
      expect(find.text('Latest'), findsNothing);
      expect(find.byIcon(LucideIcons.arrowDown), findsOneWidget);
      expect(find.byTooltip('Jump to latest message'), findsOneWidget);
    });

    testWidgets('loads history through the oldest unread boundary', (
      tester,
    ) async {
      final newestPage = [
        for (var i = 50; i < 100; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final olderPage = [
        for (var i = 0; i < 50; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(
        newestPage,
        olderPages: [olderPage],
      );
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'msg21',
              createdAt: 1021,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Message 21'), findsOneWidget);
      expect(findRichText('Message 50'), findsNothing);
      expect(messagesNotifier.fetchOlderCalls, 1);
    });

    testWidgets('does not load history for threaded-only unread events', (
      tester,
    ) async {
      final newestPage = [
        for (var i = 50; i < 100; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final olderPage = [
        for (var i = 0; i < 50; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(
        newestPage,
        olderPages: [olderPage],
      );
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'thread-reply',
              createdAt: 1021,
              rootId: 'thread-root',
              highPriority: true,
              isThreadedReply: true,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
        ),
      );
      await tester.pumpAndSettle();

      expect(messagesNotifier.fetchOlderCalls, 0);
      expect(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
        findsNothing,
      );
    });

    testWidgets('caps unread target history loading', (tester) async {
      final newestPage = [
        for (var i = 250; i < 300; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final olderPages = [
        for (var page = 4; page >= 0; page--)
          [
            for (var i = page * 50; i < (page + 1) * 50; i++)
              _textMsg(
                id: 'msg$i',
                pubkey: 'alice',
                content: 'Message $i',
                createdAt: 1000 + i,
              ),
          ],
      ];
      final messagesNotifier = _FakeMessagesNotifier(
        newestPage,
        olderPages: olderPages,
      );
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'missing-target',
              createdAt: 1001,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
            makeObservedUnreadEvent(
              id: 'msg275',
              createdAt: 1275,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
        ),
      );
      await tester.pumpAndSettle();

      // History requests are deliberately scheduled after the current frame.
      // Advance the test clock until the capped chain has settled.
      for (
        var frame = 0;
        frame < 8 && messagesNotifier.fetchOlderCalls < 4;
        frame++
      ) {
        await tester.pump(const Duration(milliseconds: 1));
      }

      expect(messagesNotifier.fetchOlderCalls, 4);
      final unreadButton = find.byKey(
        const ValueKey('channel-jump-to-oldest-unread'),
      );
      expect(unreadButton, findsOneWidget);
      await tester.tap(unreadButton);
      await tester.pumpAndSettle();
      expect(findRichText('Message 275'), findsOneWidget);
    });

    testWidgets('stops loading the unread boundary after a failed page', (
      tester,
    ) async {
      final messages = [
        for (var i = 50; i < 100; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(
        messages,
        failOlderFetch: true,
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
          forcedUnreadContexts: {_channelId: _channelId},
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          readStateNotifier: readState,
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
        findsNothing,
      );
      expect(find.bySemanticsLabel('Loading older messages'), findsNothing);
    });

    testWidgets('falls back when the oldest unread row is deleted', (
      tester,
    ) async {
      final messagesNotifier = _FakeMessagesNotifier([
        _textMsg(
          id: 'deleted-oldest',
          pubkey: 'alice',
          content: 'Deleted oldest',
          createdAt: 1021,
        ),
        _textMsg(
          id: 'reachable-unread',
          pubkey: 'alice',
          content: 'Reachable unread',
          createdAt: 1022,
        ),
        _deletion(
          id: 'delete-oldest',
          targetIds: ['deleted-oldest'],
          createdAt: 1023,
        ),
      ]);
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'deleted-oldest',
              createdAt: 1021,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
            makeObservedUnreadEvent(
              id: 'reachable-unread',
              createdAt: 1022,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final unreadButton = find.byKey(
        const ValueKey('channel-jump-to-oldest-unread'),
      );
      expect(unreadButton, findsOneWidget);
      await tester.tap(unreadButton);
      await tester.pumpAndSettle();
      expect(findRichText('Reachable unread'), findsOneWidget);
    });

    testWidgets('pages past a loaded forced unread for an older target', (
      tester,
    ) async {
      final newestPage = [
        for (var i = 50; i < 100; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final olderPage = [
        for (var i = 0; i < 50; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(
        newestPage,
        olderPages: [olderPage],
      );
      final channelsNotifier = _FakeChannelsNotifier(
        [_testChannel],
        observedUnread: {
          _channelId: [
            makeObservedUnreadEvent(
              id: 'msg21',
              createdAt: 1021,
              rootId: null,
              highPriority: false,
              isThreadedReply: false,
            ),
          ],
        },
      );
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1020},
          version: 0,
          forcedUnreadContexts: {'msg:msg75': _channelId},
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          channelsNotifier: channelsNotifier,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(messagesNotifier.fetchOlderCalls, 1);
      await tester.tap(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
      );
      await tester.pumpAndSettle();
      expect(findRichText('Message 21'), findsOneWidget);
      expect(findRichText('Message 75'), findsNothing);
    });

    testWidgets('targets the oldest message-level forced unread', (
      tester,
    ) async {
      final messages = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 2000},
          version: 0,
          forcedUnreadContexts: {
            'msg:msg20': _channelId,
            'msg:msg5': _channelId,
          },
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Message 5'), findsOneWidget);
      expect(findRichText('Message 20'), findsNothing);
    });

    testWidgets('ignores newer events absent from observed unread state', (
      tester,
    ) async {
      final messages = [
        _textMsg(
          id: 'read-message',
          pubkey: 'alice',
          content: 'Already read',
          createdAt: 1000,
        ),
        _textMsg(
          id: 'self-message',
          pubkey: 'self',
          content: 'My own newer message',
          createdAt: 1100,
        ),
        _systemMsg(
          id: 'system-message',
          payload: const {'type': 'channel_created'},
          createdAt: 1200,
        ),
      ];
      final readState = _SynchronousReadStateNotifier(
        const ReadStateState(
          isReady: true,
          pubkey: 'self',
          contexts: {_channelId: 1000},
          version: 0,
        ),
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          readStateNotifier: readState,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
        findsNothing,
      );
    });

    testWidgets(
      'keeps the followed tail anchored through composer and keyboard resize',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.reset);

        final messages = [
          for (var i = 0; i < 20; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: i.isEven ? 'alice' : 'bob',
              content: 'Message $i',
              createdAt: 1000 + i * 1000,
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: messages,
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final latestMessage = find.byKey(
          const ValueKey('channel-message-group-msg19'),
        );
        final composerDock = find.byKey(
          const ValueKey('channel-composer-dock'),
        );
        final compactDockHeight = tester.getSize(composerDock).height;

        expect(latestMessage, findsOneWidget);
        expect(
          tester.getBottomLeft(latestMessage).dy,
          closeTo(tester.getTopLeft(composerDock).dy, 1),
        );

        await tester.tap(find.text('Message #general'));
        for (var frame = 0; frame < 15; frame += 1) {
          await tester.pump(const Duration(milliseconds: 16));
          expect(
            find.byKey(const ValueKey('channel-jump-to-latest')),
            findsNothing,
            reason:
                'Composer expansion must not expose Latest while tail-follow '
                'layout catches up.',
          );
        }
        await tester.pumpAndSettle();

        expect(
          tester.getSize(composerDock).height,
          greaterThan(compactDockHeight),
        );
        expect(
          tester.getBottomLeft(latestMessage).dy,
          closeTo(tester.getTopLeft(composerDock).dy, 1),
        );
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsNothing,
        );

        for (final inset in const [80.0, 160.0, 240.0, 300.0]) {
          tester.view.viewInsets = FakeViewPadding(bottom: inset);
          await tester.pump(const Duration(milliseconds: 16));
          expect(
            find.byKey(const ValueKey('channel-jump-to-latest')),
            findsNothing,
            reason:
                'IME inset frames must not expose Latest while the followed '
                'tail is being realigned.',
          );
        }
        await tester.pump(androidImeMetricsSettleDelay);
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsNothing,
          reason:
              'Latest must stay hidden when settled IME padding is applied.',
        );
        await tester.pumpAndSettle();

        expect(latestMessage, findsOneWidget);
        expect(
          tester.getBottomLeft(latestMessage).dy,
          closeTo(tester.getTopLeft(composerDock).dy, 1),
        );
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'seeds an already-visible Android keyboard into the channel tail layout',
      (tester) async {
        final previousPlatform = debugDefaultTargetPlatformOverride;
        debugDefaultTargetPlatformOverride = TargetPlatform.android;
        try {
          tester.view.physicalSize = const Size(400, 800);
          tester.view.devicePixelRatio = 1;
          tester.view.viewPadding = const FakeViewPadding(bottom: 24);
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          addTearDown(tester.view.reset);

          final messages = [
            for (var i = 0; i < 20; i++)
              _textMsg(
                id: 'msg$i',
                pubkey: 'alice',
                content: i == 19
                    ? List.filled(8, 'Tall latest message').join('\n')
                    : 'Message $i',
                createdAt: 1000 + i,
              ),
          ];

          await tester.pumpWidget(
            _buildTestable(
              messages: messages,
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              },
            ),
          );
          await tester.pumpAndSettle();

          final latestMessage = find.byKey(
            const ValueKey('channel-message-group-msg19'),
          );
          final composerDock = find.byKey(
            const ValueKey('channel-composer-dock'),
          );
          expect(latestMessage, findsOneWidget);
          expect(
            tester.getBottomLeft(latestMessage).dy,
            closeTo(tester.getTopLeft(composerDock).dy, 1),
          );
          expect(
            find.byKey(const ValueKey('channel-jump-to-latest')),
            findsNothing,
          );
        } finally {
          debugDefaultTargetPlatformOverride = previousPlatform;
        }
      },
    );

    testWidgets('keeps a short followed tail flush through composer resize', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.reset);

      final messages = [
        for (var i = 0; i < 3; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final latestMessage = find.byKey(
        const ValueKey('channel-message-group-msg2'),
      );
      final composerDock = find.byKey(const ValueKey('channel-composer-dock'));

      await tester.tap(find.text('Message #general'));
      await tester.pumpAndSettle();

      expect(
        tester.getBottomLeft(latestMessage).dy,
        closeTo(tester.getTopLeft(composerDock).dy, 1),
      );
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsNothing,
      );
    });

    testWidgets(
      'does not realign a user-detached timeline on keyboard resize',
      (tester) async {
        tester.view.physicalSize = const Size(400, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.reset);

        final messages = [
          for (var i = 0; i < 40; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: 'alice',
              content: 'Message $i',
              createdAt: 1000 + i,
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: messages,
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final messageList = find.byKey(const ValueKey('channel-message-list'));
        await tester.drag(messageList, const Offset(0, 300));
        await tester.pumpAndSettle();

        expect(findRichText('Message 39'), findsNothing);
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsOneWidget,
        );

        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(findRichText('Message 39'), findsNothing);
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsOneWidget,
        );
        final positions = tester
            .widget<ScrollablePositionedList>(messageList)
            .itemPositionsNotifier!
            .itemPositions
            .value;
        expect(
          positions.any(
            (position) =>
                position.index == 0 && position.itemLeadingEdge.abs() < 0.01,
          ),
          isFalse,
        );
      },
    );

    testWidgets('can jump back to latest after a non-drag user scroll', (
      tester,
    ) async {
      final initialMessages = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(initialMessages);

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final messageList = find.byKey(const ValueKey('channel-message-list'));
      final messageListElement = tester.element(messageList);
      UserScrollNotification(
        metrics: FixedScrollMetrics(
          minScrollExtent: 0,
          maxScrollExtent: 100,
          pixels: 0,
          viewportDimension: 100,
          axisDirection: AxisDirection.down,
          devicePixelRatio: 1,
        ),
        context: messageListElement,
        direction: ScrollDirection.reverse,
      ).dispatch(messageListElement);
      final listView = tester.widget<ScrollablePositionedList>(messageList);
      listView.itemScrollController!.jumpTo(index: 39);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsOneWidget,
      );
      final latestSurfaceFinder = find.byKey(
        const ValueKey('channel-jump-to-latest-surface'),
      );
      final latestSurface = tester.widget<Container>(latestSurfaceFinder);
      final latestDecoration = latestSurface.decoration! as BoxDecoration;
      expect(latestDecoration.shape, BoxShape.circle);
      expect(
        latestDecoration.color,
        AppTheme.light().colorScheme.surface.withValues(alpha: 0.72),
      );
      expect(
        (latestDecoration.border! as Border).top.color,
        AppTheme.light().colorScheme.onSurface.withValues(alpha: 0.08),
      );
      expect(
        tester.getSize(find.byKey(const ValueKey('channel-jump-to-latest'))),
        const Size.square(Grid.xl),
      );
      expect(
        tester
            .getCenter(find.byKey(const ValueKey('channel-jump-to-latest')))
            .dx,
        closeTo(tester.getCenter(messageList).dx, 0.1),
      );
      expect(
        tester
                .getTopLeft(find.byKey(const ValueKey('channel-composer-dock')))
                .dy -
            tester
                .getBottomRight(
                  find.byKey(const ValueKey('channel-jump-to-latest')),
                )
                .dy,
        closeTo(Grid.xs, 0.1),
      );
      final latestSwitcher = tester.widget<AnimatedSwitcher>(
        find.byKey(const ValueKey('channel-jump-to-latest-switcher')),
      );
      expect(latestSwitcher.duration, const Duration(milliseconds: 180));
      expect(latestSwitcher.reverseDuration, const Duration(milliseconds: 160));
      expect(latestSwitcher.switchInCurve, Curves.easeOutCubic);
      expect(latestSwitcher.switchOutCurve, Curves.easeInCubic);
      final latestScaleTransition = tester.widget<ScaleTransition>(
        find.descendant(
          of: find.byKey(const ValueKey('channel-jump-to-latest-switcher')),
          matching: find.byType(ScaleTransition),
        ),
      );
      expect(latestScaleTransition.alignment, Alignment.bottomCenter);
      final visualAnchor = tester.widget<Align>(
        find.byKey(const ValueKey('channel-jump-to-latest-visual-anchor')),
      );
      expect(visualAnchor.alignment, Alignment.bottomCenter);
      expect(tester.getSize(latestSurfaceFinder), const Size.square(Grid.lg));
      expect(
        tester.getBottomRight(latestSurfaceFinder).dy,
        closeTo(
          tester
              .getBottomRight(
                find.byKey(const ValueKey('channel-jump-to-latest')),
              )
              .dy,
          0.1,
        ),
      );
      expect(find.text('Latest'), findsNothing);
      expect(find.byIcon(LucideIcons.arrowDown), findsOneWidget);
      for (final container in tester.widgetList<Container>(
        find.descendant(
          of: find.byKey(const ValueKey('channel-jump-to-latest')),
          matching: find.byType(Container),
        ),
      )) {
        if (container.decoration case final BoxDecoration decoration) {
          expect(decoration.boxShadow, anyOf(isNull, isEmpty));
        }
      }
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('channel-jump-to-latest')),
          matching: find.byType(BackdropFilter),
        ),
        findsOneWidget,
      );

      messagesNotifier.setMessages([
        ...initialMessages,
        _textMsg(
          id: 'newest',
          pubkey: 'alice',
          content: 'Newest live update',
          createdAt: 2000,
        ),
      ]);
      await tester.pump();

      expect(findRichText('Newest live update'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('channel-jump-to-latest')));
      await tester.pump();

      ScaleTransition exitingScaleTransition() {
        return tester.widget<ScaleTransition>(
          find.ancestor(
            of: find.byKey(const ValueKey('channel-jump-to-latest')),
            matching: find.byType(ScaleTransition),
          ),
        );
      }

      for (var frame = 0; frame < 60; frame += 1) {
        await tester.pump(const Duration(milliseconds: 16));
        if (exitingScaleTransition().scale.status == AnimationStatus.reverse) {
          break;
        }
      }
      expect(exitingScaleTransition().scale.status, AnimationStatus.reverse);
      await tester.pump(const Duration(milliseconds: 120));

      final collapsedScaleTransition = exitingScaleTransition();
      expect(collapsedScaleTransition.alignment, Alignment.bottomCenter);
      expect(collapsedScaleTransition.scale.value, lessThan(0.1));

      await tester.pumpAndSettle();

      expect(findRichText('Newest live update'), findsOneWidget);
      final latestMessage = find.byKey(
        const ValueKey('channel-message-group-newest'),
      );
      final composerDock = find.byKey(const ValueKey('channel-composer-dock'));
      expect(
        tester.getBottomLeft(latestMessage).dy,
        closeTo(tester.getTopLeft(composerDock).dy, 1),
      );
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsNothing,
      );
    });

    testWidgets(
      'a same-second local send follows its inserted row when the tail ID stays unchanged',
      (tester) async {
        tester.view.physicalSize = const Size(400, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final initialMessages = [
          for (var i = 0; i < 39; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: 'alice',
              content: 'Message $i',
              createdAt: 1000 + i,
            ),
          _textMsg(
            id: 'z-final',
            pubkey: 'alice',
            content: List.filled(20, 'Tall final message').join('\n'),
            createdAt: 2000,
          ),
        ];
        final messagesNotifier = _FakeMessagesNotifier(initialMessages);

        await tester.pumpWidget(
          _buildTestable(
            messages: const [],
            messagesNotifier: messagesNotifier,
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'self': UserProfile(pubkey: 'self', displayName: 'Self'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final messageList = find.byKey(const ValueKey('channel-message-list'));
        await tester.drag(messageList, const Offset(0, 300));
        await tester.pumpAndSettle();
        expect(findRichText('My same-second send'), findsNothing);

        final localSend = _textMsg(
          id: 'a-local',
          pubkey: 'self',
          content: 'My same-second send',
          createdAt: 2000,
        );
        final container = ProviderScope.containerOf(
          tester.element(find.byType(ChannelDetailPage)),
        );
        container
            .read(localMessageSendAnimationProvider(_channelId).notifier)
            .mark(localSend.id);
        messagesNotifier.setMessages([...initialMessages, localSend]);
        await tester.pumpAndSettle();

        expect(findRichText('My same-second send'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'Latest reveals the channel tail while the Android keyboard stays open',
      (tester) async {
        final previousPlatform = debugDefaultTargetPlatformOverride;
        debugDefaultTargetPlatformOverride = TargetPlatform.android;
        try {
          tester.view.physicalSize = const Size(400, 800);
          tester.view.devicePixelRatio = 1;
          tester.view.viewPadding = const FakeViewPadding(bottom: 24);
          addTearDown(tester.view.reset);

          final messages = [
            for (var i = 0; i < 40; i++)
              _textMsg(
                id: 'msg$i',
                pubkey: 'alice',
                content: 'Message $i',
                createdAt: 1000 + i,
              ),
          ];

          await tester.pumpWidget(
            _buildTestable(
              messages: messages,
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              },
            ),
          );
          await tester.pumpAndSettle();

          await tester.tap(find.text('Message #general'));
          await tester.pump();
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          await tester.pump();
          await tester.pump(androidImeMetricsSettleDelay);
          await tester.pumpAndSettle();

          final textField = tester.widget<TextField>(find.byType(TextField));
          expect(textField.focusNode?.hasFocus, isTrue);

          final messageList = find.byKey(
            const ValueKey('channel-message-list'),
          );
          final messageListElement = tester.element(messageList);
          UserScrollNotification(
            metrics: FixedScrollMetrics(
              minScrollExtent: 0,
              maxScrollExtent: 100,
              pixels: 0,
              viewportDimension: 100,
              axisDirection: AxisDirection.down,
              devicePixelRatio: 1,
            ),
            context: messageListElement,
            direction: ScrollDirection.reverse,
          ).dispatch(messageListElement);
          tester
              .widget<ScrollablePositionedList>(messageList)
              .itemScrollController!
              .jumpTo(index: 39);
          await tester.pumpAndSettle();

          expect(
            find.byKey(const ValueKey('channel-jump-to-latest')),
            findsOneWidget,
          );

          await tester.tap(
            find.byKey(const ValueKey('channel-jump-to-latest')),
          );
          await tester.pumpAndSettle();

          final latestMessage = find.byKey(
            const ValueKey('channel-message-group-msg39'),
          );
          final composerDock = find.byKey(
            const ValueKey('channel-composer-dock'),
          );
          expect(latestMessage, findsOneWidget);
          expect(textField.focusNode?.hasFocus, isTrue);
          expect(
            tester.getBottomLeft(latestMessage).dy,
            closeTo(tester.getTopLeft(composerDock).dy, 1),
          );
          expect(
            find.byKey(const ValueKey('channel-jump-to-latest')),
            findsNothing,
          );
        } finally {
          debugDefaultTargetPlatformOverride = previousPlatform;
        }
      },
    );

    testWidgets(
      'keeps the Latest gap stable above the Android composer and keyboard',
      (tester) async {
        final previousPlatform = debugDefaultTargetPlatformOverride;
        debugDefaultTargetPlatformOverride = TargetPlatform.android;
        try {
          tester.view.physicalSize = const Size(400, 800);
          tester.view.devicePixelRatio = 1;
          tester.view.viewPadding = const FakeViewPadding(bottom: 24);
          addTearDown(tester.view.reset);

          final initialMessages = [
            for (var i = 0; i < 40; i++)
              _textMsg(
                id: 'msg$i',
                pubkey: 'alice',
                content: 'Message $i',
                createdAt: 1000 + i,
              ),
          ];
          await tester.pumpWidget(
            _buildTestable(
              messages: initialMessages,
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              },
            ),
          );
          await tester.pumpAndSettle();

          final messageList = find.byKey(
            const ValueKey('channel-message-list'),
          );
          final messageListElement = tester.element(messageList);
          UserScrollNotification(
            metrics: FixedScrollMetrics(
              minScrollExtent: 0,
              maxScrollExtent: 100,
              pixels: 0,
              viewportDimension: 100,
              axisDirection: AxisDirection.down,
              devicePixelRatio: 1,
            ),
            context: messageListElement,
            direction: ScrollDirection.reverse,
          ).dispatch(messageListElement);
          tester
              .widget<ScrollablePositionedList>(messageList)
              .itemScrollController!
              .jumpTo(index: 39);
          await tester.pumpAndSettle();

          final latestSurface = find.byKey(
            const ValueKey('channel-jump-to-latest-surface'),
          );
          final composerDock = find.byKey(
            const ValueKey('channel-composer-dock'),
          );
          double latestGap() =>
              tester.getTopLeft(composerDock).dy -
              tester.getBottomLeft(latestSurface).dy;

          final collapsedGap = latestGap();
          expect(collapsedGap, closeTo(Grid.xs, 0.5));

          await tester.tap(find.text('Message #general'));
          await tester.pump();
          await tester.pump();
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          await tester.pump();
          await tester.pump(androidImeMetricsSettleDelay);
          await tester.pumpAndSettle();

          expect(find.byType(TextField), findsOneWidget);
          expect(latestGap(), closeTo(collapsedGap, 0.5));
        } finally {
          debugDefaultTargetPlatformOverride = previousPlatform;
        }
      },
    );

    testWidgets(
      'pins the current day below the app bar after its divider scrolls away',
      (tester) async {
        tester.view.physicalSize = const Size(400, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final firstDay =
            DateTime(2025, 1, 1, 12).toUtc().millisecondsSinceEpoch ~/ 1000;
        final messages = [
          for (var day = 0; day < 3; day += 1)
            for (var index = 0; index < 10; index += 1)
              _textMsg(
                id: 'day-$day-message-$index',
                pubkey: 'alice',
                content: 'Day $day message $index',
                createdAt: firstDay + day * 86400 + index,
              ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: messages,
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final messageList = find.byKey(const ValueKey('channel-message-list'));
        final list = tester.widget<ScrollablePositionedList>(messageList);
        list.itemScrollController!.jumpTo(index: 14, alignment: 0.8);
        await tester.pumpAndSettle();

        final stickyHeader = find.byKey(
          const ValueKey('channel-sticky-date-header'),
        );
        final stickySurface = find.byKey(
          const ValueKey('channel-sticky-date-header-surface'),
        );
        expect(stickyHeader, findsOneWidget);
        expect(stickySurface, findsOneWidget);
        expect(
          find.descendant(
            of: stickyHeader,
            matching: find.text(formatDayHeading(firstDay + 86400)),
          ),
          findsOneWidget,
        );
        expect(
          tester.getTopLeft(stickySurface).dy,
          closeTo(
            frostedAppBarHeight(
                  tester.element(stickyHeader),
                  titleContentHeight: tester
                      .widget<FrostedAppBar>(find.byType(FrostedAppBar).first)
                      .titleContentHeight,
                ) +
                Grid.twelve,
            1,
          ),
        );
        expect(
          find.descendant(
            of: stickyHeader,
            matching: find.byType(BackdropFilter),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'keeps follow mode off while a tall newest message stays visible',
      (tester) async {
        tester.view.physicalSize = const Size(400, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final tallMessage = List.generate(
          12,
          (index) => 'Newest message line $index',
        ).join('\n');
        final initialMessages = [
          for (var i = 0; i < 12; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: i.isEven ? 'alice' : 'bob',
              content: 'Message $i',
              createdAt: 1000 + i * 1000,
            ),
          _textMsg(
            id: 'tall-newest',
            pubkey: 'alice',
            content: tallMessage,
            createdAt: 20_000,
          ),
        ];
        final messagesNotifier = _FakeMessagesNotifier(initialMessages);

        await tester.pumpWidget(
          _buildTestable(
            messages: const [],
            messagesNotifier: messagesNotifier,
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final messageList = find.byKey(const ValueKey('channel-message-list'));
        await tester.drag(messageList, const Offset(0, 120));
        await tester.pumpAndSettle();

        expect(findRichText('Newest message line 0'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsNothing,
        );

        messagesNotifier.setMessages([
          ...initialMessages,
          _textMsg(
            id: 'newest-live',
            pubkey: 'alice',
            content: 'Newest live update',
            createdAt: 30_000,
          ),
        ]);
        await tester.pumpAndSettle();

        // Cache-extent mounting varies by platform, so assert the reversed
        // list's semantic boundary rather than whether item 0 is mounted.
        final positions = tester
            .widget<ScrollablePositionedList>(messageList)
            .itemPositionsNotifier!
            .itemPositions
            .value;
        expect(
          positions.any(
            (position) =>
                position.index == 0 && position.itemLeadingEdge.abs() < 0.01,
          ),
          isFalse,
        );
        expect(
          find.byKey(const ValueKey('channel-jump-to-latest')),
          findsOneWidget,
        );
      },
    );

    testWidgets('preserves an initial message deep-link position', (
      tester,
    ) async {
      final initialMessages = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'msg$i',
            pubkey: 'alice',
            content: 'Message $i',
            createdAt: 1000 + i,
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier(initialMessages);

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          initialMessageId: 'msg5',
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Message 5'), findsOneWidget);
      expect(findRichText('Message 39'), findsNothing);
      expect(
        find.byKey(const ValueKey('channel-jump-to-latest')),
        findsOneWidget,
      );

      messagesNotifier.setMessages([
        ...initialMessages,
        _textMsg(
          id: 'newest',
          pubkey: 'alice',
          content: 'Newest live update',
          createdAt: 2000,
        ),
      ]);
      await tester.pumpAndSettle();

      expect(findRichText('Message 5'), findsOneWidget);
      expect(findRichText('Newest live update'), findsNothing);
    });

    testWidgets(
      'gives an initial deep link precedence over unread navigation',
      (tester) async {
        final initialMessages = [
          for (var i = 0; i < 40; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: 'alice',
              content: 'Message $i',
              createdAt: 1000 + i,
            ),
        ];
        final messagesNotifier = _FakeMessagesNotifier(initialMessages);
        final channelsNotifier = _FakeChannelsNotifier(
          [_testChannel],
          observedUnread: {
            _channelId: [
              makeObservedUnreadEvent(
                id: 'msg5',
                createdAt: 1005,
                rootId: null,
                highPriority: false,
                isThreadedReply: false,
              ),
            ],
          },
        );
        final readState = _SynchronousReadStateNotifier(
          const ReadStateState(
            isReady: true,
            pubkey: 'self',
            contexts: {_channelId: 1004},
            version: 0,
          ),
        );

        await tester.pumpWidget(
          _buildTestable(
            messages: const [],
            messagesNotifier: messagesNotifier,
            channelsNotifier: channelsNotifier,
            readStateNotifier: readState,
            initialMessageId: 'msg20',
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
          ),
        );
        await tester.pumpAndSettle();

        expect(findRichText('Message 20'), findsOneWidget);
        expect(findRichText('Message 5'), findsNothing);
        expect(
          find.byKey(const ValueKey('channel-jump-to-oldest-unread')),
          findsNothing,
        );
        expect(messagesNotifier.fetchOlderCalls, 0);
      },
    );

    testWidgets(
      'keeps a deep-linked message in view when its page arrives after a '
      'small scroll near the latest message',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        // The deep-link target lives in an older page that has not loaded yet.
        final messagesNotifier = _FakeMessagesNotifier([
          for (var i = 30; i < 60; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: 'alice',
              content: 'Message $i',
              createdAt: 1000 + i * 1000,
            ),
        ]);

        await tester.pumpWidget(
          _buildTestable(
            messages: const [],
            messagesNotifier: messagesNotifier,
            initialMessageId: 'msg3',
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
          ),
        );
        await tester.pumpAndSettle();

        // Small scrolls that keep the newest message visible, so isAtLatest
        // stays true while the scroll offset becomes non-zero. This lets a
        // later programmatic jumpTo dispatch ScrollEndNotification.
        //
        // Each drag must clear `kDragSlopDefault`; below it `tester.drag`
        // sends a single sub-slop move, which a message bubble now claims as
        // a tap and pushes the thread page over this list.
        for (final dy in const [30.0, 30.0, 30.0]) {
          await tester.drag(
            find.byKey(const ValueKey('channel-message-list')),
            Offset(0, dy),
          );
          await tester.pumpAndSettle();
        }

        // The older page containing the deep-link target arrives.
        messagesNotifier.setMessages([
          for (var i = 0; i < 60; i++)
            _textMsg(
              id: 'msg$i',
              pubkey: 'alice',
              content: 'Message $i',
              createdAt: 1000 + i * 1000,
            ),
        ]);
        await tester.pumpAndSettle();

        // The deep-link jump must stick rather than snapping back to newest.
        expect(findRichText('Message 3'), findsOneWidget);
        expect(findRichText('Message 59'), findsNothing);
      },
    );

    testWidgets('groups consecutive messages from same author', (tester) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'First message',
          createdAt: 1000,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'alice',
          content: 'Second message',
          createdAt: 1060, // within 5 min
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      // Author name should appear only once (grouped).
      expect(find.text('Alice'), findsOneWidget);
      expect(findRichText('First message'), findsOneWidget);
      expect(findRichText('Second message'), findsOneWidget);
    });

    testWidgets('shows author again after 5min gap', (tester) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'First',
          createdAt: 1000,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'alice',
          content: 'Second',
          createdAt: 1400, // 6+ min later
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      // Author name appears twice since messages are >5min apart.
      expect(find.text('Alice'), findsNWidgets(2));
    });

    testWidgets('shows compact npub fallback when no profile', (tester) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey:
              'abcdef0000000000000000000000000000000000000000000000000000000000',
          content: 'Hi',
          createdAt: 1000,
        ),
      ];

      await tester.pumpWidget(_buildTestable(messages: messages));
      await tester.pumpAndSettle();

      expect(findRichText('Hi'), findsOneWidget);
      // Should show the compact npub form of the author's public key
      expect(find.text('npub140x…etzk'), findsOneWidget);
    });
  });

  group('System messages', () {
    testWidgets('renders channel_created system event', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'channel_created', 'actor': 'alice'},
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Alice'), findsOneWidget);
      final createdAction = findRichText('created this channel');
      expect(createdAction, findsOneWidget);
      expect(
        tester.getSize(find.byType(CircleAvatar)),
        const Size.square(messageAvatarSize),
      );
      final nameRect = tester.getRect(find.text('Alice'));
      final nameText = tester.widget<Text>(find.text('Alice'));
      expect(nameText.style?.fontSize, systemMessageHeadingTextStyle.fontSize);
      expect(
        nameText.style?.fontWeight,
        systemMessageHeadingTextStyle.fontWeight,
      );
      expect(
        find.byKey(const ValueKey('system-message-username-alice')),
        findsNothing,
      );
      final timestampRect = tester.getRect(
        find.byKey(const ValueKey('system-message-timestamp-alice')),
      );
      expect(timestampRect.left, greaterThan(nameRect.right));
      final createdText = tester.widget<RichText>(createdAction);
      expect(
        effectiveFontSizeForText(createdText.text, 'created this channel'),
        systemMessageBodyTextStyle.fontSize,
      );
    });

    testWidgets('renders member_joined (self-join) system event', (
      tester,
    ) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'member_joined', 'actor': 'bob', 'target': 'bob'},
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob')},
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Bob'), findsOneWidget);
      expect(findRichText('joined the channel'), findsOneWidget);
      expect(
        tester.getSize(find.byType(CircleAvatar)),
        const Size.square(messageAvatarSize),
      );
    });

    testWidgets('opens a profile sheet from a membership system avatar', (
      tester,
    ) async {
      const alicePubkey =
          'a11ce00000000000000000000000000000000000000000000000000000000000';
      const bobPubkey =
          'b0b0000000000000000000000000000000000000000000000000000000000000';
      // Not a valid hex public key — the sheet must surface a neutral label
      // and refuse to copy it rather than leaking the raw string.
      const invalidPubkey = 'bob-not-a-real-pubkey';
      final clipboardTexts = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              clipboardTexts.add((call.arguments as Map)['text'] as String);
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );

      // Both scenarios share this sheet workflow — a keyed remount so the
      // second [ProviderScope] (and its user-cache override) is fresh.
      Widget sheetHost(
        String scenario,
        String target, {
        Map<String, UserProfile> users = const {},
      }) => KeyedSubtree(
        key: ValueKey('sheet-$scenario'),
        child: _buildTestable(
          messages: [
            _systemMsg(
              id: 'sys-membership-avatar-$scenario',
              payload: {
                'type': 'member_joined',
                'actor': alicePubkey,
                'target': target,
              },
            ),
          ],
          users: users,
        ),
      );

      // A valid identity: the sheet copies the full canonical npub.
      await tester.pumpWidget(
        sheetHost(
          'valid',
          bobPubkey,
          users: {
            alicePubkey: const UserProfile(
              pubkey: alicePubkey,
              displayName: 'Alice',
            ),
            bobPubkey: const UserProfile(pubkey: bobPubkey, displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(CircleAvatar));
      await tester.pumpAndSettle();

      expect(find.text('Copy public key'), findsOneWidget);
      // The full hex key is never rendered in the sheet.
      expect(find.text(alicePubkey), findsNothing);
      expect(find.text(bobPubkey), findsNothing);
      expect(find.byType(UserProfileSheet), findsOneWidget);

      await tester.ensureVisible(find.text('Copy public key'));
      await tester.pumpAndSettle();
      final copyAction = find
          .ancestor(
            of: find.text('Copy public key'),
            matching: find.byType(GestureDetector),
          )
          .last;
      tester.widget<GestureDetector>(copyAction).onTap!();
      await tester.pump();
      await tester.pump();
      expect(find.text('Public key copied'), findsOneWidget);
      // The clipboard receives the full canonical npub — never the raw hex.
      expect(clipboardTexts, [
        'npub1kzcqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0euyv8',
      ]);

      await tester.tap(find.byTooltip('Close sheet'));
      await tester.pumpAndSettle();

      // An invalid identity through the same workflow: neutral label,
      // disabled copy, and no second clipboard write.
      await tester.pumpWidget(
        sheetHost(
          'invalid',
          invalidPubkey,
          users: {
            alicePubkey: const UserProfile(
              pubkey: alicePubkey,
              displayName: 'Alice',
            ),
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(CircleAvatar));
      await tester.pumpAndSettle();

      expect(find.text('Copy public key'), findsOneWidget);
      // Malformed identity → neutral label, never truncated raw input.
      expect(
        find.descendant(
          of: find.byType(UserProfileSheet),
          matching: find.text('Unknown identity'),
        ),
        findsOneWidget,
      );
      expect(find.text(invalidPubkey), findsNothing);
      // The copy tile is disabled and exposes no tap handler.
      final disabledCopyAction = find
          .ancestor(
            of: find.text('Copy public key'),
            matching: find.byType(GestureDetector),
          )
          .last;
      expect(tester.widget<GestureDetector>(disabledCopyAction).onTap, isNull);
      final copySemantics = find
          .ancestor(
            of: find.text('Copy public key'),
            matching: find.byType(Semantics),
          )
          .first;
      expect(
        tester.widget<Semantics>(copySemantics).properties.enabled,
        isFalse,
      );

      await tester.tap(disabledCopyAction, warnIfMissed: false);
      await tester.pump();
      await tester.pump();
      expect(find.text('Public key copied'), findsNothing);
      // The valid scenario's npub is still the only clipboard write.
      expect(clipboardTexts, hasLength(1));

      await tester.tap(find.byTooltip('Close sheet'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 2));

      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'profile sheet heading falls back to the compact npub for blank cached names',
      (tester) async {
        const alicePubkey =
            'a11ce00000000000000000000000000000000000000000000000000000000000';
        const bobPubkey =
            'b0b0000000000000000000000000000000000000000000000000000000000000';

        // The membership row opens the sheet for the joined member (bob).
        // His cached display name is relay-valid but blank (empty and
        // whitespace-only), so the heading must resolve through the shared
        // nonblank-name label contract — the compact npub of the b0b key,
        // never a blank heading. Keyed remounts keep each ProviderScope
        // (and its user-cache override) fresh between scenarios.
        for (final blankName in const ['', '   ']) {
          await tester.pumpWidget(
            KeyedSubtree(
              key: ValueKey('blank-name-sheet-${blankName.length}'),
              child: _buildTestable(
                messages: [
                  _systemMsg(
                    id: 'sys-membership-blank-${blankName.length}',
                    payload: {
                      'type': 'member_joined',
                      'actor': alicePubkey,
                      'target': bobPubkey,
                    },
                  ),
                ],
                users: {
                  alicePubkey: const UserProfile(
                    pubkey: alicePubkey,
                    displayName: 'Alice',
                  ),
                  bobPubkey: UserProfile(
                    pubkey: bobPubkey,
                    displayName: blankName,
                  ),
                },
              ),
            ),
          );
          await tester.pumpAndSettle();

          await tester.tap(find.byType(CircleAvatar));
          await tester.pumpAndSettle();

          expect(find.byType(UserProfileSheet), findsOneWidget);
          expect(
            find.descendant(
              of: find.byType(UserProfileSheet),
              matching: find.text(blankName),
            ),
            findsNothing,
          );
          expect(
            find.descendant(
              of: find.byType(UserProfileSheet),
              matching: find.text('npub1kzc…uyv8'),
            ),
            findsOneWidget,
          );
          // The full hex key is never rendered either.
          expect(find.text(bobPubkey), findsNothing);

          await tester.tap(find.byTooltip('Close sheet'));
          await tester.pumpAndSettle();
        }

        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('opens a profile sheet from a generic system avatar', (
      tester,
    ) async {
      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _systemMsg(
              id: 'sys-removed-avatar',
              payload: {
                'type': 'member_removed',
                'actor': 'alice',
                'target': 'bob',
              },
            ),
          ],
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(CircleAvatar).first);
      await tester.pumpAndSettle();

      expect(find.text('Copy public key'), findsOneWidget);
      expect(find.byType(UserProfileSheet), findsOneWidget);
    });

    testWidgets('renders member_joined (added by other) system event', (
      tester,
    ) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'member_joined', 'actor': 'alice', 'target': 'bob'},
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Bob'), findsOneWidget);
      final addedAction = findRichText('added by Alice');
      expect(addedAction, findsOneWidget);
      expect(find.text('Alice added Bob to the channel'), findsNothing);
      expect(
        tester.getSize(find.byType(CircleAvatar)),
        const Size.square(messageAvatarSize),
      );
      final nameRect = tester.getRect(find.text('Bob'));
      expect(
        find.byKey(const ValueKey('system-message-username-bob')),
        findsNothing,
      );
      final timestampRect = tester.getRect(
        find.byKey(const ValueKey('system-message-timestamp-bob')),
      );
      expect(timestampRect.left, greaterThan(nameRect.right));
      final addedText = tester.widget<RichText>(addedAction);
      expect(
        effectiveFontSizeForText(addedText.text, 'added by Alice'),
        systemMessageBodyTextStyle.fontSize,
      );
    });

    testWidgets('groups member additions with tappable overflow names', (
      tester,
    ) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'member_joined', 'actor': 'alice', 'target': 'bob'},
          createdAt: 1000,
        ),
        _systemMsg(
          id: 'sys2',
          payload: {
            'type': 'member_joined',
            'actor': 'alice',
            'target': 'carol',
          },
          createdAt: 1060,
        ),
        _systemMsg(
          id: 'sys3',
          payload: {
            'type': 'member_joined',
            'actor': 'alice',
            'target': 'dave',
          },
          createdAt: 1120,
        ),
        _systemMsg(
          id: 'sys4',
          payload: {
            'type': 'member_joined',
            'actor': 'alice',
            'target': 'erin',
          },
          createdAt: 1180,
        ),
        _systemMsg(
          id: 'sys5',
          payload: {
            'type': 'member_joined',
            'actor': 'alice',
            'target': 'frank',
          },
          createdAt: 1240,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
            'carol': const UserProfile(pubkey: 'carol', displayName: 'Carol'),
            'dave': const UserProfile(pubkey: 'dave', displayName: 'Dave'),
            'erin': const UserProfile(pubkey: 'erin', displayName: 'Erin'),
            'frank': const UserProfile(pubkey: 'frank', displayName: 'Frank'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Bob'), findsOneWidget);
      expect(
        findRichText('added by Alice, along with Carol, Dave, Erin, and '),
        findsOneWidget,
      );
      expect(find.byKey(const Key('membership-overflow')), findsOneWidget);
      expect(find.text('1 others'), findsOneWidget);
      expect(find.byTooltip('Frank'), findsOneWidget);
    });

    testWidgets('an unreacted message keeps the timeline free of chrome', (
      tester,
    ) async {
      await tester.pumpWidget(
        _buildTestable(
          messages: [_textMsg(id: 'msg1', pubkey: 'alice', content: 'ship it')],
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      // No reactions, no row — the + only trails reactions that already exist.
      expect(find.byKey(const ValueKey('add-reaction-pill')), findsNothing);
    });

    testWidgets('renders member_left system event', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'member_left', 'actor': 'bob'},
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob')},
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Bob left the channel'), findsOneWidget);
    });

    testWidgets(
      'constrains generic system timestamps at accessibility text sizes',
      (tester) async {
        tester.view.physicalSize = const Size(240, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          _buildTestable(
            messages: [
              _systemMsg(
                id: 'sys-accessible',
                payload: {
                  'type': 'topic_changed',
                  'actor': 'alice',
                  'topic': 'Release planning',
                },
                createdAt:
                    DateTime(2026, 7, 28, 12, 34).millisecondsSinceEpoch ~/
                    1000,
              ),
            ],
            users: {
              'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
            textScaler: const TextScaler.linear(3),
          ),
        );
        await tester.pumpAndSettle();

        final timestampFinder = find.byKey(
          const ValueKey('system-message-timestamp-sys-accessible'),
        );
        final timestamp = tester.widget<Text>(timestampFinder);
        expect(timestamp.maxLines, 1);
        expect(timestamp.overflow, TextOverflow.ellipsis);
        expect(
          tester.getSize(timestampFinder).width,
          lessThanOrEqualTo(Grid.xxl),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('renders member_removed system event', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {
            'type': 'member_removed',
            'actor': 'alice',
            'target': 'bob',
          },
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Alice removed Bob from the channel'), findsOneWidget);
    });

    testWidgets('renders topic_changed system event', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {
            'type': 'topic_changed',
            'actor': 'alice',
            'topic': 'Release planning',
          },
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Alice changed the topic to "Release planning"'),
        findsOneWidget,
      );
    });

    testWidgets('renders purpose_changed system event', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {
            'type': 'purpose_changed',
            'actor': 'alice',
            'purpose': 'Team standup notes',
          },
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Alice changed the purpose to "Team standup notes"'),
        findsOneWidget,
      );
    });

    testWidgets('system message breaks author grouping', (tester) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Before',
          createdAt: 1000,
        ),
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'member_joined', 'actor': 'bob', 'target': 'bob'},
          createdAt: 1010,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'alice',
          content: 'After',
          createdAt: 1020,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      // Alice should appear twice — system message breaks grouping.
      expect(find.text('Alice'), findsNWidgets(2));
    });

    testWidgets('skips unknown system event types', (tester) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'unknown_future_type', 'actor': 'alice'},
        ),
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Hello',
          createdAt: 1100,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      // Only the text message should render, unknown system event is skipped.
      expect(findRichText('Hello'), findsOneWidget);
      // No system message row rendered for unknown type.
      expect(find.byIcon(LucideIcons.arrowLeftRight), findsNothing);
    });
  });

  group('Deletions', () {
    testWidgets('deleted messages are not shown', (tester) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Keep this',
          createdAt: 1000,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'bob',
          content: 'Delete this',
          createdAt: 1100,
        ),
        _deletion(id: 'del1', targetIds: ['msg2'], createdAt: 1200),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Keep this'), findsOneWidget);
      expect(findRichText('Delete this'), findsNothing);
    });

    testWidgets('deletion of multiple messages', (tester) async {
      final messages = [
        _textMsg(id: 'msg1', pubkey: 'a', content: 'One', createdAt: 1000),
        _textMsg(id: 'msg2', pubkey: 'a', content: 'Two', createdAt: 1100),
        _textMsg(id: 'msg3', pubkey: 'a', content: 'Three', createdAt: 1200),
        _deletion(id: 'del1', targetIds: ['msg1', 'msg3'], createdAt: 1300),
      ];

      await tester.pumpWidget(_buildTestable(messages: messages));
      await tester.pumpAndSettle();

      expect(findRichText('One'), findsNothing);
      expect(findRichText('Two'), findsOneWidget);
      expect(findRichText('Three'), findsNothing);
    });
  });

  group('Edits', () {
    testWidgets('edited message shows updated content and (edited) label', (
      tester,
    ) async {
      final messages = [
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Original text',
          createdAt: 1000,
        ),
        _edit(
          id: 'edit1',
          targetId: 'msg1',
          content: 'Edited text',
          createdAt: 1100,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(findRichText('Edited text'), findsOneWidget);
      expect(findRichText('Original text'), findsNothing);
      expect(find.text('(edited)'), findsOneWidget);
    });

    testWidgets('latest edit wins when multiple edits exist', (tester) async {
      final messages = [
        _textMsg(id: 'msg1', pubkey: 'alice', content: 'V1', createdAt: 1000),
        _edit(id: 'e1', targetId: 'msg1', content: 'V2', createdAt: 1100),
        _edit(id: 'e2', targetId: 'msg1', content: 'V3', createdAt: 1200),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(findRichText('V3'), findsOneWidget);
      expect(findRichText('V1'), findsNothing);
      expect(findRichText('V2'), findsNothing);
    });
  });

  group('Typing indicator', () {});

  group('Compose bar', () {
    testWidgets('expands from the channel hint into the composer controls', (
      tester,
    ) async {
      await tester.pumpWidget(_buildTestable(messages: []));
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsNothing);
      expect(find.byIcon(LucideIcons.arrowUp).hitTestable(), findsOneWidget);

      await tester.tap(find.text('Message #general'));
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
      expect(find.byIcon(LucideIcons.arrowUp).hitTestable(), findsOneWidget);
    });

    testWidgets('shows hint text', (tester) async {
      await tester.pumpWidget(_buildTestable(messages: []));
      await tester.pumpAndSettle();

      expect(find.text('Message #general'), findsOneWidget);
    });
  });

  group('App bar', () {
    testWidgets('matches the channel header placement on iOS', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      const nativeChannel = MethodChannel('buzz/navigation_glass/43');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        nativeChannel,
        (_) async => null,
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          nativeChannel,
          null,
        ),
      );

      final root = _textMsg(
        id: 'thread-header-root',
        pubkey: 'alice',
        content: 'Thread root',
      );
      final timelineMessages = formatTimeline([root]);

      await tester.pumpWidget(
        _buildTestable(
          messages: [root],
          textScaler: const TextScaler.linear(2),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ThreadDetailPage(
                      threadHead: timelineMessages.single,
                      allMessages: timelineMessages,
                      channelId: _testChannel.id,
                      currentPubkey: null,
                      isMember: true,
                      isArchived: false,
                    ),
                  ),
                ),
                child: const Text('Open thread'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open thread'));
      await tester.pumpAndSettle();

      final backFinder = find.byKey(const ValueKey('thread-ios-glass-back'));
      final nativeView = tester.widget<UiKitView>(
        find.descendant(of: backFinder, matching: find.byType(UiKitView)),
      );
      expect(nativeView.viewType, IosGlassNavigationButton.viewType);
      expect(
        (nativeView.creationParams as Map<String, Object>)['buttonCenterX'],
        iosGlassChannelHeaderButtonCenterX,
      );
      expect(
        (nativeView.creationParams as Map<String, Object>)['hitTargetWidth'],
        iosGlassChannelHeaderLeadingWidth,
      );
      expect(
        (nativeView.creationParams as Map<String, Object>)['hitTargetHeight'],
        48.0,
      );

      final backRect = tester.getRect(backFinder);
      final titleRect = tester.getRect(
        find.byKey(const ValueKey('thread-app-bar-title')),
      );
      expect(backRect.width, iosGlassChannelHeaderLeadingWidth);
      expect(
        titleRect.left - backRect.right,
        moreOrLessEquals(iosGlassChannelHeaderTitleSpacing),
      );
      expect(tester.takeException(), isNull);

      nativeView.onPlatformViewCreated!(43);
      await tester.pump();
      await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
        nativeChannel.name,
        nativeChannel.codec.encodeMethodCall(const MethodCall('pressed')),
        (_) {},
      );
      await tester.pumpAndSettle();

      expect(find.byType(ThreadDetailPage), findsNothing);
      expect(find.text('Open thread'), findsOneWidget);
      debugDefaultTargetPlatformOverride = null;
    });

    testWidgets(
      'keeps the native iOS glass header aligned at large text sizes',
      (tester) async {
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        addTearDown(() => debugDefaultTargetPlatformOverride = null);

        final message = _textMsg(
          id: 'avatar-alignment',
          pubkey: 'alice',
          content: 'Hello',
          createdAt: 1000,
        );

        await tester.pumpWidget(
          _buildTestable(
            messages: [message],
            textScaler: const TextScaler.linear(2),
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            },
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ChannelDetailPage(channel: _testChannel),
                    ),
                  ),
                  child: const Text('Open channel'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Open channel'));
        await tester.pumpAndSettle();

        final nativeViewFinder = find.descendant(
          of: find.byKey(const ValueKey('channel-ios-glass-back')),
          matching: find.byType(UiKitView),
        );
        final nativeView = tester.widget<UiKitView>(nativeViewFinder);
        expect(nativeView.viewType, 'buzz/navigation_glass');
        expect(
          (nativeView.creationParams as Map<String, Object>)['icon'],
          'back',
        );
        expect(
          (nativeView.creationParams as Map<String, Object>)['brightness'],
          'light',
        );
        expect(
          (nativeView.creationParams as Map<String, Object>)['buttonCenterX'],
          38.0,
        );
        final backButtonRect = tester.getRect(
          find.byKey(const ValueKey('channel-ios-glass-back')),
        );
        expect(backButtonRect.width, 58);
        final channelIconRect = tester.getRect(
          find.byKey(const ValueKey('channel-header-avatar')),
        );
        expect(
          channelIconRect.left - backButtonRect.right,
          moreOrLessEquals(Grid.xs),
        );
        expect(
          backButtonRect.center.dy,
          moreOrLessEquals(channelIconRect.center.dy),
        );
        expect(tester.takeException(), isNull);
        debugDefaultTargetPlatformOverride = null;
      },
    );

    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      testWidgets(
        'keeps a narrow long channel title aligned on ${platform.name}',
        (tester) async {
          final previousPlatform = debugDefaultTargetPlatformOverride;
          debugDefaultTargetPlatformOverride = platform;
          addTearDown(
            () => debugDefaultTargetPlatformOverride = previousPlatform,
          );
          tester.view.physicalSize = const Size(320, 700);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final channel = _testChannel.copyWith(
            name: 'a-very-long-channel-name-that-must-truncate',
          );

          await tester.pumpWidget(
            _buildTestable(
              messages: const [],
              channel: channel,
              home: Builder(
                builder: (context) => Scaffold(
                  body: TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ChannelDetailPage(channel: channel),
                      ),
                    ),
                    child: const Text('Open channel'),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();

          await tester.tap(find.text('Open channel'));
          await tester.pumpAndSettle();

          final backRect = platform == TargetPlatform.iOS
              ? tester.getRect(
                  find.byKey(const ValueKey('channel-ios-glass-back')),
                )
              : tester.getRect(find.byTooltip('Back'));
          final avatarRect = tester.getRect(
            find.byKey(const ValueKey('channel-header-avatar')),
          );
          final titleSpacing = avatarRect.left - backRect.right;
          final title = tester.renderObject<RenderParagraph>(
            find.byKey(const ValueKey('channel-header-name')),
          );
          final titleDidExceedMaxLines = title.didExceedMaxLines;
          debugDefaultTargetPlatformOverride = previousPlatform;

          expect(
            titleSpacing,
            moreOrLessEquals(
              platform == TargetPlatform.iOS
                  ? iosGlassChannelHeaderTitleSpacing
                  : 0,
            ),
          );
          expect(titleDidExceedMaxLines, isTrue);
          expect(tester.takeException(), isNull);
        },
      );
    }

    testWidgets('shows a tappable channel name and collective member count', (
      tester,
    ) async {
      await tester.pumpWidget(
        _buildTestable(
          messages: [],
          // 人数取自平台成员名单，按人计：一人两把公钥仍算一人（DD-77）
          platformMembers: List.generate(
            5,
            (index) => WorkspaceMemberView(
              principalId: '00000000-0000-4000-8000-00000000000$index',
              displayName: 'Member $index',
              pubkeys: ['member-$index-web', 'member-$index-device'],
              state: WorkspaceMembershipState.ACTIVE,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('general'), findsOneWidget);
      expect(find.text('5 members'), findsOneWidget);
      // The hash icon appears in the app bar and in the compose bar toolbar.
      expect(find.byIcon(LucideIcons.hash), findsAtLeastNWidgets(1));
      expect(
        tester.getSize(find.byKey(const ValueKey('channel-header-avatar'))),
        const Size.square(40),
      );
      final channelHeaderAvatarRect = tester.getRect(
        find.byKey(const ValueKey('channel-header-avatar')),
      );
      final channelHeaderTextStackRect = tester.getRect(
        find.byKey(const ValueKey('channel-header-text-stack')),
      );
      expect(channelHeaderTextStackRect.height, 40);
      expect(
        channelHeaderTextStackRect.center.dy,
        moreOrLessEquals(channelHeaderAvatarRect.center.dy),
      );
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('channel-header-name')))
            .style
            ?.fontSize,
        AppTheme.light().textTheme.titleSmall?.fontSize,
      );
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('channel-header-name')))
            .style
            ?.fontWeight,
        FontWeight.w600,
      );
      final channelHeaderAvatar = tester.widget<Container>(
        find.byKey(const ValueKey('channel-header-avatar')),
      );
      expect(
        (channelHeaderAvatar.decoration as BoxDecoration).color,
        AppTheme.light().colorScheme.surface,
      );
      final channelHeaderAvatarBorder =
          (channelHeaderAvatar.decoration as BoxDecoration).border! as Border;
      expect(
        channelHeaderAvatarBorder.top.color,
        AppTheme.light().colorScheme.inverseSurface.withValues(alpha: 0.07),
      );
      expect(channelHeaderAvatarBorder.top.width, 1);
      expect(
        channelHeaderAvatarBorder.top.strokeAlign,
        BorderSide.strokeAlignOutside,
      );
      expect(
        tester
            .widget<Icon>(
              find.descendant(
                of: find.byKey(const ValueKey('channel-header-avatar')),
                matching: find.byIcon(LucideIcons.hash),
              ),
            )
            .color,
        AppTheme.light().colorScheme.primary,
      );
      expect(
        tester.getRect(find.byKey(const ValueKey('channel-header-name'))).left -
            tester
                .getRect(find.byKey(const ValueKey('channel-header-avatar')))
                .right,
        moreOrLessEquals(Grid.twelve),
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('channel-header-member-count')),
            )
            .style
            ?.fontSize,
        AppTheme.light().textTheme.bodySmall?.fontSize,
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('channel-header-member-count')),
            )
            .style
            ?.color,
        AppTheme.light().colorScheme.onSurface.withValues(alpha: 0.65),
      );
      expect(find.byTooltip('View members'), findsNothing);
      expect(find.byTooltip('Channel actions'), findsOneWidget);

      // 点频道名看成员：数据来自平台 BFF 的成员视图
      await tester.tap(
        find.byKey(const ValueKey('channel-header-settings-trigger')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Member 0'), findsOneWidget);
      expect(find.text('5 members'), findsOneWidget);
      expect(find.text('Member · 2 keys'), findsNWidgets(5));
    });

    testWidgets('shows lock icon for private channel', (tester) async {
      final privateChannel = Channel(
        id: _channelId,
        name: 'secret',
        channelType: 'stream',
        visibility: 'private',
        description: 'Private channel',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 3,
        isMember: true,
      );

      await tester.pumpWidget(
        _buildTestable(messages: [], channel: privateChannel),
      );
      await tester.pumpAndSettle();

      expect(find.text('secret'), findsOneWidget);
      expect(find.byIcon(LucideIcons.lock), findsOneWidget);
    });
  });

  group('Error and loading states', () {});

  group('Mixed message timeline', () {
    testWidgets('interleaves text and system messages correctly', (
      tester,
    ) async {
      final messages = [
        _systemMsg(
          id: 'sys1',
          payload: {'type': 'channel_created', 'actor': 'alice'},
          createdAt: 900,
        ),
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Welcome everyone!',
          createdAt: 1000,
        ),
        _systemMsg(
          id: 'sys2',
          payload: {'type': 'member_joined', 'actor': 'bob', 'target': 'bob'},
          createdAt: 1100,
        ),
        _textMsg(
          id: 'msg2',
          pubkey: 'bob',
          content: 'Thanks for the invite!',
          createdAt: 1200,
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: messages,
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Alice'), findsNWidgets(2));
      expect(findRichText('created this channel'), findsOneWidget);
      expect(findRichText('Welcome everyone!'), findsOneWidget);
      expect(find.text('Bob'), findsNWidgets(2));
      expect(findRichText('joined the channel'), findsOneWidget);
      expect(findRichText('Thanks for the invite!'), findsOneWidget);
    });
  });

  group('Deep-link navigation', () {
    testWidgets('fades the target highlight in after the thread route lands', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final target = _textMsg(
        id: 'target',
        pubkey: 'bob',
        content: 'Target reply',
        createdAt: 1100,
        extraTags: const [
          ['e', 'root', '', 'reply'],
        ],
      );
      final timelineMessages = formatTimeline([root, target]);
      final threadHead = timelineMessages.firstWhere(
        (message) => message.id == root.id,
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: [root, target],
          threadReplies: {
            'root': [target],
          },
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ThreadDetailPage(
                        threadHead: threadHead,
                        allMessages: timelineMessages,
                        channelId: _testChannel.id,
                        currentPubkey: null,
                        isMember: true,
                        isArchived: false,
                        initialMessageId: 'target',
                      ),
                    ),
                  ),
                  child: const Text('Open highlighted thread'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open highlighted thread'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));

      final threadRoute =
          ModalRoute.of(tester.element(find.byType(ThreadDetailPage)))!
              as MaterialPageRoute<void>;
      expect(threadRoute.animation!.status, AnimationStatus.forward);
      final transitionDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(transitionDecoration.color, Colors.transparent);

      await tester.pump(threadRoute.transitionDuration);
      expect(threadRoute.animation!.status, AnimationStatus.completed);
      await tester.pump();
      await tester.pump();
      final landedDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(landedDecoration.color, Colors.transparent);

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 150));
      final enteringDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(enteringDecoration.color!.a, greaterThan(0));
      expect(enteringDecoration.color!.a, lessThan(0.12));

      await tester.pump(const Duration(milliseconds: 150));
      final visibleDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(visibleDecoration.color!.a, closeTo(0.12, 0.001));
    });

    testWidgets('waits for a delayed target jump before highlighting', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'root', '', 'reply'],
            ],
          ),
      ];
      final timelineMessages = formatTimeline([root, ...replies]);
      final threadHead = timelineMessages.first;
      final replyCompleter = Completer<List<NostrEvent>>();

      await tester.pumpWidget(
        _buildTestable(
          messages: [root],
          pendingThreadReplies: {'root': replyCompleter.future},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ThreadDetailPage(
                        threadHead: threadHead,
                        allMessages: timelineMessages,
                        channelId: _testChannel.id,
                        currentPubkey: null,
                        isMember: true,
                        isArchived: false,
                        initialMessageId: 'reply-30',
                      ),
                    ),
                  ),
                  child: const Text('Open delayed thread'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open delayed thread'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 4));

      expect(
        find.byKey(const ValueKey('thread-message-group-reply-30')),
        findsNothing,
      );

      replyCompleter.complete(replies);
      // Flush hydration, target placement, and the paint gate without
      // advancing the 50 ms highlight delay through the Latest control's own
      // entrance animation.
      for (var frame = 0; frame < 8; frame += 1) {
        await tester.pump();
      }

      final target = find.byKey(const ValueKey('thread-message-reply-30'));
      expect(target, findsOneWidget);
      final landedDecoration =
          tester.widget<DecoratedBox>(target).decoration as BoxDecoration;
      expect(landedDecoration.color, Colors.transparent);

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 150));
      final enteringDecoration =
          tester.widget<DecoratedBox>(target).decoration as BoxDecoration;
      expect(enteringDecoration.color!.a, greaterThan(0));
      expect(enteringDecoration.color!.a, lessThan(0.12));
    });

    testWidgets('waits for a retry before jumping to a hydrated target', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final target = _textMsg(
        id: 'target',
        pubkey: 'bob',
        content: 'Hydrated target',
        createdAt: 1400,
        extraTags: const [
          ['e', 'root', '', 'reply'],
        ],
      );
      final earlierReplies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'root', '', 'reply'],
            ],
          ),
      ];
      final timelineMessages = formatTimeline([root, target]);
      final firstAttempt = Completer<List<NostrEvent>>();
      var attempts = 0;

      await tester.pumpWidget(
        _buildTestable(
          messages: [root, target],
          providerRetry: (retryCount, _) =>
              retryCount == 0 ? const Duration(seconds: 30) : null,
          localThreadReplies: {
            'root': [target],
          },
          threadReplyLoaders: {
            'root': () {
              attempts++;
              if (attempts == 1) return firstAttempt.future;
              return Future.value([...earlierReplies, target]);
            },
          },
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: ThreadDetailPage(
            threadHead: timelineMessages.first,
            allMessages: timelineMessages,
            channelId: _testChannel.id,
            currentPubkey: null,
            isMember: true,
            isArchived: false,
            initialMessageId: 'target',
          ),
        ),
      );
      await tester.pump();
      firstAttempt.completeError(Exception('transient thread query failure'));
      await tester.pump();
      await tester.pump();

      final targetFinder = find.byKey(const ValueKey('thread-message-target'));
      expect(targetFinder, findsOneWidget);
      final retryingDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(retryingDecoration.color, Colors.transparent);
      expect(attempts, 1);

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 150));
      final stillRetryingDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(stillRetryingDecoration.color, Colors.transparent);

      await tester.pump(const Duration(milliseconds: 2800));
      expect(attempts, 1);
      final expiredJumpDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(expiredJumpDecoration.color, Colors.transparent);

      await tester.pump(const Duration(seconds: 30));
      // Settle the retry's microtasks without advancing the shared Latest
      // control's entrance animation past the highlight's 50 ms delay.
      for (var frame = 0; frame < 8; frame += 1) {
        await tester.pump();
      }

      expect(attempts, 2);
      expect(
        find.byKey(const ValueKey('thread-message-group-target')),
        findsOneWidget,
      );
      final landedDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(landedDecoration.color, Colors.transparent);

      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 150));
      final highlightedDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(highlightedDecoration.color!.a, greaterThan(0));
    });

    testWidgets('highlights a hydrated target after the thread query fails', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final target = _textMsg(
        id: 'target',
        pubkey: 'bob',
        content: 'Hydrated target',
        createdAt: 1100,
        extraTags: const [
          ['e', 'root', '', 'reply'],
        ],
      );
      final timelineMessages = formatTimeline([root, target]);
      final replyCompleter = Completer<List<NostrEvent>>();

      await tester.pumpWidget(
        _buildTestable(
          messages: [root, target],
          pendingThreadReplies: {'root': replyCompleter.future},
          disableRetries: true,
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: ThreadDetailPage(
            threadHead: timelineMessages.first,
            allMessages: timelineMessages,
            channelId: _testChannel.id,
            currentPubkey: null,
            isMember: true,
            isArchived: false,
            initialMessageId: 'target',
          ),
        ),
      );
      await tester.pumpAndSettle();

      final targetFinder = find.byKey(const ValueKey('thread-message-target'));
      expect(targetFinder, findsOneWidget);
      final loadingDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(loadingDecoration.color, Colors.transparent);

      replyCompleter.completeError(Exception('thread query failed'));
      for (var i = 0; i < 8; i++) {
        await tester.pump();
      }
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 150));

      final highlightedDecoration =
          tester.widget<DecoratedBox>(targetFinder).decoration as BoxDecoration;
      expect(highlightedDecoration.color!.a, greaterThan(0));
      expect(highlightedDecoration.color!.a, lessThan(0.12));
    });

    testWidgets('opens a nested reply in its direct-parent thread', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Outer root',
        createdAt: 1000,
      );
      final parent = _textMsg(
        id: 'parent',
        pubkey: 'bob',
        content: 'Nested thread head',
        createdAt: 1100,
        extraTags: const [
          ['e', 'root', '', 'reply'],
        ],
      );
      final target = _textMsg(
        id: 'target',
        pubkey: 'carol',
        content: 'Deeply nested target',
        createdAt: 1200,
        extraTags: const [
          ['e', 'root', '', 'root'],
          ['e', 'parent', '', 'reply'],
        ],
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: [root, parent, target],
          initialMessageId: 'target',
          initialThreadRootId: 'parent',
          threadReplies: {
            // Relay subtree filtering is keyed by thread_metadata.root_event_id,
            // so nested replies are returned by the outer-root query.
            'root': [parent, target],
          },
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            'carol': UserProfile(pubkey: 'carol', displayName: 'Carol'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadPage = tester.widget<ThreadDetailPage>(
        find.byType(ThreadDetailPage),
      );
      expect(threadPage.threadHead.id, 'parent');
      expect(threadPage.initialMessageId, 'target');

      final highlighted = tester.widget<DecoratedBox>(
        find.byKey(const ValueKey('thread-message-target')),
      );
      final decoration = highlighted.decoration as BoxDecoration;
      final initialHighlight = decoration.color!;
      expect(initialHighlight, isNot(Colors.transparent));
      expect(initialHighlight.a, closeTo(0.12, 0.001));

      await tester.pump(const Duration(milliseconds: 2999));
      final heldDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(heldDecoration.color, initialHighlight);

      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump(const Duration(milliseconds: 150));

      final fadingDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(fadingDecoration.color!.a, greaterThan(0));
      expect(fadingDecoration.color!.a, lessThan(initialHighlight.a));

      await tester.pump(const Duration(milliseconds: 150));
      final dismissedDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const ValueKey('thread-message-target')),
                  )
                  .decoration
              as BoxDecoration;
      expect(dismissedDecoration.color, Colors.transparent);
    });

    testWidgets('does not replace a newer route after delayed hydration', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
      );
      final messagesNotifier = _FakeMessagesNotifier(const []);

      await tester.pumpWidget(
        _buildTestable(
          messages: const [],
          messagesNotifier: messagesNotifier,
          initialThreadRootId: 'root',
          initialThreadRouteBehavior:
              InitialThreadRouteBehavior.replaceCurrentRoute,
        ),
      );
      await tester.pumpAndSettle();

      final navigator = Navigator.of(
        tester.element(find.byType(ChannelDetailPage)),
      );
      messagesNotifier.setMessages([root]);
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('New destination')),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('New destination'), findsOneWidget);
      expect(find.byType(ThreadDetailPage), findsNothing);
    });

    testWidgets('replaces a temporary channel route for an initial thread', (
      tester,
    ) async {
      final root = _textMsg(
        id: 'root',
        pubkey: 'alice',
        content: 'Thread root',
      );
      final target = _textMsg(
        id: 'target',
        pubkey: 'bob',
        content: 'Target reply',
        createdAt: 1100,
        extraTags: const [
          ['e', 'root', '', 'reply'],
        ],
      );
      final relaySession = _TrackingRelaySession();

      await tester.pumpWidget(
        _buildTestable(
          messages: [root, target],
          relaySessionNotifier: relaySession,
          threadReplies: {
            'root': [target],
          },
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ChannelDetailPage(
                        channel: _testChannel,
                        initialMessageId: 'target',
                        initialThreadRootId: 'root',
                        initialThreadRouteBehavior:
                            InitialThreadRouteBehavior.replaceCurrentRoute,
                      ),
                    ),
                  ),
                  child: const Text('Open activity thread'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open activity thread'));
      await tester.pumpAndSettle();

      expect(find.byType(ThreadDetailPage), findsOneWidget);
      expect(find.byType(ChannelDetailPage), findsNothing);
      expect(relaySession.visibleChannels, [_testChannel.id]);

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.text('Open activity thread'), findsOneWidget);
      expect(find.byType(ChannelDetailPage), findsNothing);
      expect(relaySession.visibleChannels, isEmpty);
    });
  });

  group('Channel links', () {
    testWidgets('tapping a channel link opens that channel', (tester) async {
      final randomChannel = _channel(id: 'random-channel', name: 'random');
      final observer = _TestNavigatorObserver();

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'msg1',
              pubkey: 'alice',
              content: 'Take this to #random',
              createdAt: 1000,
            ),
          ],
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
          channels: [_testChannel, randomChannel],
          navigatorObservers: [observer],
        ),
      );
      await tester.pumpAndSettle();
      final initialPushCount = observer.pushCount;

      await tester.tap(find.text('random'));
      await tester.pumpAndSettle();

      expect(observer.pushCount, initialPushCount + 1);
    });

    testWidgets('missing channel link shows an error', (tester) async {
      final randomChannel = _channel(id: 'random-channel', name: 'random');
      final channelsNotifier = _FakeChannelsNotifier([
        _testChannel,
        randomChannel,
      ]);

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'msg1',
              pubkey: 'alice',
              content: 'Take this to #random',
              createdAt: 1000,
            ),
          ],
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
          channelsNotifier: channelsNotifier,
        ),
      );
      await tester.pumpAndSettle();

      channelsNotifier.setChannels([_testChannel]);
      await tester.tap(find.text('random'));
      await tester.pump();

      expect(find.text('Channel could not be opened'), findsOneWidget);
    });

    testWidgets('tapping a channel link inside a thread opens that channel', (
      tester,
    ) async {
      final randomChannel = _channel(id: 'random-channel', name: 'random');
      final observer = _TestNavigatorObserver();

      await tester.pumpWidget(
        _buildTestable(
          messages: [
            _textMsg(
              id: 'msg1',
              pubkey: 'alice',
              content: 'Thread root #random',
              createdAt: 1000,
            ),
          ],
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
          channels: [_testChannel, randomChannel],
          navigatorObservers: [observer],
        ),
      );
      await tester.pumpAndSettle();

      final threadMessages = formatTimeline([
        _textMsg(
          id: 'msg1',
          pubkey: 'alice',
          content: 'Thread root #random',
          createdAt: 1000,
        ),
      ]);
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadMessages.single,
            allMessages: threadMessages,
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final initialPushCount = observer.pushCount;

      await tester.tap(find.text('random').last);
      await tester.pumpAndSettle();

      expect(observer.pushCount, initialPushCount + 1);
    });

    testWidgets('thread shows day dividers when replies cross days', (
      tester,
    ) async {
      final rootCreatedAt =
          DateTime(2025, 1, 1, 12).toUtc().millisecondsSinceEpoch ~/ 1000;
      final nextDayCreatedAt =
          DateTime(2025, 1, 2, 12).toUtc().millisecondsSinceEpoch ~/ 1000;
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: rootCreatedAt,
      );
      final replies = [
        _textMsg(
          id: 'reply-same-day',
          pubkey: 'bob',
          content: 'Same day',
          createdAt: rootCreatedAt + 60,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        ),
        _textMsg(
          id: 'reply-next-day',
          pubkey: 'bob',
          content: 'Next day',
          createdAt: nextDayCreatedAt,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: {
            'alice': const UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': const UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(DayDivider), findsNWidgets(2));
      expect(
        find.descendant(
          of: find.byType(DayDivider),
          matching: find.text(formatDayHeading(rootCreatedAt)),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byType(DayDivider),
          matching: find.text(formatDayHeading(nextDayCreatedAt)),
        ),
        findsOneWidget,
      );
      // The list runs top-down (head first), so tail spacing lives on the list
      // and reply groups carry none.
      final threadList = tester.widget<ScrollablePositionedList>(
        find.byKey(const ValueKey('thread-message-list')),
      );
      expect(threadList.reverse, isFalse);
      final threadComposerDockHeight = tester
          .getSize(find.byKey(const ValueKey('thread-composer-dock')))
          .height;
      expect(threadList.padding!.bottom, Grid.xs + threadComposerDockHeight);
      final newestThreadGroup = tester.widget<Padding>(
        find.byKey(const ValueKey('thread-message-group-reply-next-day')),
      );
      expect(newestThreadGroup.padding, EdgeInsets.zero);

      // The head sits above its replies rather than jammed against the
      // composer, matching desktop's thread panel.
      final headY = tester
          .getTopLeft(
            find.byKey(const ValueKey('thread-message-group-thread-root')),
          )
          .dy;
      final oldestReplyY = tester
          .getTopLeft(
            find.byKey(const ValueKey('thread-message-group-reply-same-day')),
          )
          .dy;
      final newestReplyY = tester
          .getTopLeft(
            find.byKey(const ValueKey('thread-message-group-reply-next-day')),
          )
          .dy;
      expect(headY, lessThan(oldestReplyY));
      expect(oldestReplyY, lessThan(newestReplyY));
      final threadTimestamp = tester.widget<Text>(
        find.byKey(const ValueKey('thread-message-timestamp-thread-root')),
      );
      expect(
        threadTimestamp.style?.fontSize,
        messageTimestampTextStyle.fontSize,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('thread-message-row-thread-root')),
          matching: find.text('·'),
        ),
        findsNothing,
      );
    });

    testWidgets('thread pins and updates the active date while scrolling', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      int timestampForDay(int day, int minute) =>
          DateTime(2025, 1, day, 12, minute).toUtc().millisecondsSinceEpoch ~/
          1000;
      final rootEvent = _textMsg(
        id: 'sticky-thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: timestampForDay(1, 0),
      );
      final replies = [
        for (var i = 0; i < 90; i++)
          _textMsg(
            id: 'sticky-reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: timestampForDay(1 + (i ~/ 30), i % 30),
            extraTags: const [
              ['e', 'sticky-thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'sticky-thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final listFinder = find.byKey(const ValueKey('thread-message-list'));
      final list = tester.widget<ScrollablePositionedList>(listFinder);
      list.itemScrollController!.jumpTo(index: 40);
      await tester.pumpAndSettle();

      final stickyHeader = find.byKey(
        const ValueKey('thread-sticky-date-header'),
      );
      expect(
        find.descendant(
          of: stickyHeader,
          matching: find.text(formatDayHeading(timestampForDay(2, 0))),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: stickyHeader,
          matching: find.byType(BackdropFilter),
        ),
        findsOneWidget,
      );

      list.itemScrollController!.jumpTo(index: 70);
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: stickyHeader,
          matching: find.text(formatDayHeading(timestampForDay(3, 0))),
        ),
        findsOneWidget,
      );
    });

    testWidgets('thread keeps its tail above a growing composer dock', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 20; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
            initialMessageId: 'reply-19',
          ),
        ),
      );
      await tester.pumpAndSettle();

      final dock = find.byKey(const ValueKey('thread-composer-dock'));
      final latestReply = find.byKey(
        const ValueKey('thread-message-group-reply-19'),
      );
      final composerSurface = find.byKey(const ValueKey('composer-surface'));
      final compactDockHeight = tester.getSize(dock).height;
      expect(latestReply, findsOneWidget);
      expect(
        tester.getBottomLeft(latestReply).dy,
        lessThanOrEqualTo(tester.getTopLeft(composerSurface).dy),
      );

      await tester.tap(find.text('Reply in thread…').hitTestable());
      await tester.pumpAndSettle();

      expect(tester.getSize(dock).height, greaterThan(compactDockHeight));
      expect(latestReply, findsOneWidget);
      expect(
        tester.getBottomLeft(latestReply).dy,
        lessThanOrEqualTo(tester.getTopLeft(composerSurface).dy),
      );

      // The dock size change above is separate from the later Scaffold
      // viewport resize caused by the keyboard. Keep following the tail after
      // that metrics change too.
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.reset);
      await tester.pump();
      await tester.pump(androidImeMetricsSettleDelay);
      await tester.pump();

      expect(
        tester.getBottomLeft(latestReply).dy,
        lessThanOrEqualTo(tester.getTopLeft(composerSurface).dy),
      );
      expect(
        tester
            .state<ScrollableState>(
              find
                  .descendant(
                    of: find.byKey(const ValueKey('thread-message-list')),
                    matching: find.byType(Scrollable),
                  )
                  .first,
            )
            .position
            .isScrollingNotifier
            .value,
        isFalse,
        reason: 'Keyboard layout correction must not start a scroll animation.',
      );
    });

    testWidgets('short thread keeps its head stable when the keyboard opens', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'A short thread',
        createdAt: 1000,
      );

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: const {'thread-root': []},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final head = find.byKey(
        const ValueKey('thread-message-group-thread-root'),
      );
      final initialHeadY = tester.getTopLeft(head).dy;
      expect(initialHeadY, lessThan(300));

      await tester.tap(find.text('Reply in thread…').hitTestable());
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pump();
      await tester.pump(androidImeMetricsSettleDelay);
      await tester.pump();

      expect(
        tester.getTopLeft(head).dy,
        closeTo(initialHeadY, 1),
        reason: 'A fully visible short thread should remain head-anchored.',
      );
    });

    testWidgets(
      'iOS thread keeps Latest hidden through composer and keyboard frames',
      (tester) async {
        final previousPlatform = debugDefaultTargetPlatformOverride;
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        try {
          final rootEvent = _textMsg(
            id: 'thread-root',
            pubkey: 'alice',
            content: 'A short thread',
            createdAt: 1000,
          );
          final replies = [
            for (var i = 0; i < 6; i++)
              _textMsg(
                id: 'reply-$i',
                pubkey: i.isEven ? 'alice' : 'bob',
                content: i.isEven ? 'hello' : 'testing',
                createdAt: 1100 + i,
                extraTags: const [
                  ['e', 'thread-root', '', 'reply'],
                ],
              ),
          ];

          await tester.pumpWidget(
            _buildTestable(
              messages: [rootEvent],
              threadReplies: {'thread-root': replies},
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
                'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
              },
            ),
          );
          await tester.pumpAndSettle();

          final threadHead = formatTimeline([rootEvent]).single;
          Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
            MaterialPageRoute<void>(
              builder: (_) => ThreadDetailPage(
                threadHead: threadHead,
                allMessages: [threadHead],
                channelId: _channelId,
                currentPubkey: 'self',
                isMember: true,
                isArchived: false,
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(
            find.byKey(const ValueKey('thread-jump-to-latest')),
            findsNothing,
          );

          await tester.tap(find.text('Reply in thread…').hitTestable());
          for (var frame = 0; frame < 15; frame += 1) {
            await tester.pump(const Duration(milliseconds: 16));
            expect(
              find.byKey(const ValueKey('thread-jump-to-latest')),
              findsNothing,
              reason:
                  'Composer expansion must not expose Latest while followed '
                  'tail geometry catches up.',
            );
          }

          for (final inset in const [80.0, 160.0, 240.0, 300.0]) {
            tester.view.viewInsets = FakeViewPadding(bottom: inset);
            await tester.pump(const Duration(milliseconds: 16));
            expect(
              find.byKey(const ValueKey('thread-jump-to-latest')),
              findsNothing,
              reason:
                  'IME inset frames must not expose Latest while the composer '
                  'is following the thread tail.',
            );
          }
          await tester.pumpAndSettle();
        } finally {
          debugDefaultTargetPlatformOverride = previousPlatform;
        }
      },
    );

    for (final replyCount in [0, 1]) {
      testWidgets(
        'cached writable $replyCount-reply thread defers dock correction until measured',
        (tester) async {
          tester.view.physicalSize = const Size(400, 800);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final rootEvent = _textMsg(
            id: 'thread-root',
            pubkey: 'alice',
            content: 'Short root',
            createdAt: 1000,
          );
          final replies = [
            if (replyCount == 1)
              _textMsg(
                id: 'reply-0',
                pubkey: 'bob',
                content: 'Short reply',
                createdAt: 1100,
                extraTags: const [
                  ['e', 'thread-root', '', 'reply'],
                ],
              ),
          ];
          await tester.pumpWidget(
            _buildTestable(
              messages: [rootEvent],
              threadReplies: {'thread-root': replies},
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
                'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
              },
            ),
          );
          await tester.pumpAndSettle();
          final routeMessages = formatTimeline([rootEvent, ...replies]);
          Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
            MaterialPageRoute<void>(
              builder: (_) => ThreadDetailPage(
                threadHead: routeMessages.first,
                allMessages: routeMessages,
                channelId: _channelId,
                currentPubkey: 'self',
                isMember: true,
                isArchived: false,
              ),
            ),
          );

          await tester.pump();
          expect(tester.takeException(), isNull);
          final earlyDock = tester.widget<ComposerDockSizeReporter>(
            find.byType(ComposerDockSizeReporter).last,
          );

          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          earlyDock.onHeightChanged(200);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          final composerSurface = find.byKey(
            const ValueKey('composer-surface'),
          );
          final tail = find.byKey(
            ValueKey(
              replyCount == 0
                  ? 'thread-message-group-thread-root'
                  : 'thread-message-group-reply-0',
            ),
          );
          expect(tail, findsOneWidget);
          expect(
            tester.getTopLeft(tail).dy,
            greaterThanOrEqualTo(frostedAppBarHeight(tester.element(tail))),
          );
          expect(
            tester.getBottomLeft(tail).dy,
            lessThanOrEqualTo(tester.getTopLeft(composerSurface).dy),
          );
        },
      );
    }

    testWidgets(
      'cached initial thread settles between the app bar and measured composer',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: i == 29
                  ? List.filled(33, 'Tall latest reply').join('\n')
                  : 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            threadReplies: {'thread-root': replies},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final latestReply = find.byKey(
          const ValueKey('thread-message-group-reply-29'),
        );
        final latestRect = tester.getRect(latestReply);
        final context = tester.element(latestReply);
        final composerTop = tester
            .getTopLeft(find.byKey(const ValueKey('composer-surface')))
            .dy;
        expect(
          latestRect.top,
          greaterThanOrEqualTo(frostedAppBarHeight(context)),
        );
        expect(latestRect.bottom, lessThanOrEqualTo(composerTop));
      },
    );

    testWidgets('read-only cached thread still settles on its tail', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: false,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final latestReply = find.byKey(
        const ValueKey('thread-message-group-reply-29'),
      );
      expect(latestReply, findsOneWidget);
      expect(
        tester.getTopLeft(latestReply).dy,
        greaterThanOrEqualTo(frostedAppBarHeight(tester.element(latestReply))),
      );
    });

    testWidgets(
      'user drag abandons pending hydration settle until returning to tail',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 35; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final completer = Completer<List<NostrEvent>>();

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final provisional = formatTimeline([rootEvent, ...replies.take(30)]);
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: provisional.first,
              allMessages: provisional,
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        await tester.drag(list, const Offset(0, -100));
        await tester.pumpAndSettle();
        final anchor = find.byKey(
          const ValueKey('thread-message-group-reply-10'),
        );
        final anchorTop = tester.getTopLeft(anchor).dy;

        completer.complete(replies);
        await tester.pumpAndSettle();

        expect(anchor, findsOneWidget);
        expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-34')),
          findsNothing,
        );

        for (var i = 0; i < 12; i++) {
          await tester.drag(list, const Offset(0, -100));
          await tester.pumpAndSettle();
        }
        final latestReply = find.byKey(
          const ValueKey('thread-message-group-reply-34'),
        );
        expect(latestReply, findsOneWidget);

        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(
          tester.getBottomLeft(latestReply).dy,
          lessThanOrEqualTo(
            tester
                .getTopLeft(find.byKey(const ValueKey('composer-surface')))
                .dy,
          ),
        );
      },
    );

    testWidgets('active drag cancels a queued hydrated deep-link jump', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 35; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final completer = Completer<List<NostrEvent>>();

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          pendingThreadReplies: {'thread-root': completer.future},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final provisional = formatTimeline([rootEvent, ...replies.take(30)]);
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: provisional.first,
            allMessages: provisional,
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
            initialMessageId: 'reply-5',
          ),
        ),
      );
      await tester.pumpAndSettle();

      final anchor = find.byKey(
        const ValueKey('thread-message-group-thread-root'),
      );
      final anchorTop = tester.getTopLeft(anchor).dy;
      completer.complete(replies);
      await tester.pump();

      // Authoritative hydration has queued the deep-link jump. A primary drag
      // takes ownership before the shared deferred-intent boundary executes it.
      tester
          .widget<KeyboardDismissOnDrag>(find.byType(KeyboardDismissOnDrag))
          .onUserScrollStart!();
      await tester.pumpAndSettle();

      expect(anchor, findsOneWidget);
      expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
    });

    testWidgets('user drag invalidates an already queued hydration settle', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 35; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final completer = Completer<List<NostrEvent>>();

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          pendingThreadReplies: {'thread-root': completer.future},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final provisional = formatTimeline([rootEvent, ...replies.take(30)]);
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: provisional.first,
            allMessages: provisional,
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final anchor = find.byKey(
        const ValueKey('thread-message-group-thread-root'),
      );
      final anchorTop = tester.getTopLeft(anchor).dy;
      completer.complete(replies);
      await tester.pump();

      // Hydration has scheduled the settle's second post-frame callback. A
      // drag starts before another frame can run it.
      tester
          .widget<KeyboardDismissOnDrag>(find.byType(KeyboardDismissOnDrag))
          .onUserScrollStart!();
      await tester.pumpAndSettle();

      expect(anchor, findsOneWidget);
      expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-34')),
        findsNothing,
      );
    });

    testWidgets(
      'keyboard-open initial hydration settles within the list viewport',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: i == 29
                  ? List.filled(15, 'Tall latest reply').join('\n')
                  : 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final completer = Completer<List<NostrEvent>>();

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Reply in thread…').hitTestable());
        await tester.pumpAndSettle();
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        final listHeight = tester.getSize(list).height;
        final mediaQueryHeight = MediaQuery.sizeOf(tester.element(list)).height;
        expect(
          listHeight,
          closeTo(mediaQueryHeight, 0.5),
          reason: 'Android keeps the thread viewport fixed behind the IME.',
        );

        completer.complete(replies);
        await tester.pumpAndSettle();

        final latestReply = find.byKey(
          const ValueKey('thread-message-group-reply-29'),
        );
        final latestRect = tester.getRect(latestReply);
        final context = tester.element(latestReply);
        final composerTop = tester
            .getTopLeft(find.byKey(const ValueKey('composer-surface')))
            .dy;
        expect(
          latestRect.top,
          greaterThanOrEqualTo(frostedAppBarHeight(context)),
        );
        expect(latestRect.bottom, lessThanOrEqualTo(composerTop));
      },
    );

    testWidgets('short initial thread hydration remains top-anchored', (
      tester,
    ) async {
      final previousPlatform = debugDefaultTargetPlatformOverride;
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          _textMsg(
            id: 'reply-1',
            pubkey: 'bob',
            content: 'First reply',
            createdAt: 1100,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
          _textMsg(
            id: 'reply-2',
            pubkey: 'bob',
            content: 'Second reply',
            createdAt: 1101,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
        ];
        final completer = Completer<List<NostrEvent>>();

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final headFinder = find.byKey(
          const ValueKey('thread-message-group-thread-root'),
        );
        final initialHeadY = tester.getTopLeft(headFinder).dy;
        const latestButton = ValueKey('thread-jump-to-latest');
        expect(find.byKey(latestButton), findsNothing);

        completer.complete(replies);
        await tester.pump();
        for (var frame = 0; frame < 8; frame++) {
          expect(
            find.byKey(latestButton),
            findsNothing,
            reason:
                'Ordinary thread entry must not expose Latest on frame $frame.',
          );
          await tester.pump();
        }
        await tester.pumpAndSettle();

        expect(headFinder, findsOneWidget);
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-2')),
          findsOneWidget,
        );
        expect(tester.getTopLeft(headFinder).dy, closeTo(initialHeadY, 0.5));
        expect(find.byKey(latestButton), findsNothing);
      } finally {
        debugDefaultTargetPlatformOverride = previousPlatform;
      }
    });

    testWidgets(
      'slow initial hydration requests the frame that settles the latest reply',
      (tester) async {
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final completer = Completer<List<NostrEvent>>();

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        completer.complete(replies);
        await tester.pump();
        expect(tester.binding.hasScheduledFrame, isTrue);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-thread-root')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'initial thread hydration settles on the latest reply after pagination',
      (tester) async {
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final completer = Completer<List<NostrEvent>>();
        final messagesNotifier = _FakeMessagesNotifier([rootEvent]);

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            messagesNotifier: messagesNotifier,
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('thread-message-group-thread-root')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
        );

        completer.complete(replies);
        await tester.pump();
        final latestLiveReply = _textMsg(
          id: 'reply-live',
          pubkey: 'bob',
          content: List.filled(10, 'Tall live reply').join('\n'),
          createdAt: 1200,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        );
        messagesNotifier.setMessages([rootEvent, latestLiveReply]);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-thread-root')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-live')),
          findsOneWidget,
        );
        final listRect = tester.getRect(
          find.byKey(const ValueKey('thread-message-list')),
        );
        final latestReply = find.byKey(
          const ValueKey('thread-message-group-reply-live'),
        );
        final latestRect = tester.getRect(latestReply);
        final composerTop = tester
            .getTopLeft(find.byKey(const ValueKey('composer-surface')))
            .dy;
        expect(latestRect.bottom, lessThanOrEqualTo(composerTop));
        expect(latestRect.bottom, greaterThan(listRect.center.dy));
      },
    );

    testWidgets(
      'active primary drag rejects queued remote and local reply tail work',
      (tester) async {
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            messagesNotifier: messagesNotifier,
            threadReplies: {'thread-root': replies},
          ),
        );
        await tester.pumpAndSettle();
        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        final lifecycle = tester.widget<KeyboardDismissOnDrag>(
          find.byType(KeyboardDismissOnDrag),
        );
        lifecycle.onUserScrollStart!();
        final anchor = find.byKey(
          const ValueKey('thread-message-group-reply-20'),
        );
        final anchorTop = tester.getTopLeft(anchor).dy;
        final remoteReply = _textMsg(
          id: 'reply-remote',
          pubkey: 'bob',
          content: 'Remote',
          createdAt: 1200,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        );
        messagesNotifier.setMessages([rootEvent, remoteReply]);
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
        final localReply = _textMsg(
          id: 'reply-local',
          pubkey: 'self',
          content: 'Local',
          createdAt: 1201,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        );
        messagesNotifier.setMessages([rootEvent, remoteReply, localReply]);
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
        lifecycle.onUserScrollEnd!();
      },
    );

    testWidgets('idle detached local reply retains force-visible behavior', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          messagesNotifier: messagesNotifier,
          threadReplies: {'thread-root': replies},
        ),
      );
      await tester.pumpAndSettle();
      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final list = find.byKey(const ValueKey('thread-message-list'));
      for (var i = 0; i < 4; i++) {
        await tester.drag(list, const Offset(0, 100));
        await tester.pumpAndSettle();
      }
      final localReply = _textMsg(
        id: 'reply-local',
        pubkey: 'self',
        content: 'Local',
        createdAt: 1200,
        extraTags: const [
          ['e', 'thread-root', '', 'reply'],
        ],
      );
      messagesNotifier.setMessages([rootEvent, localReply]);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-local')),
        findsOneWidget,
      );

      final laterRemoteReplies = [
        for (var i = 0; i < 10; i++)
          _textMsg(
            id: 'reply-after-local-$i',
            pubkey: 'bob',
            content: List.filled(8, 'Tall remote reply $i').join('\n'),
            createdAt: 1300 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      messagesNotifier.setMessages([
        rootEvent,
        localReply,
        ...laterRemoteReplies,
      ]);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-after-local-9')),
        findsOneWidget,
      );
    });

    testWidgets(
      'short followed thread stays top-anchored after viewport resize',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 3; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            threadReplies: {'thread-root': replies},
          ),
        );
        await tester.pumpAndSettle();
        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: false,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final head = find.byKey(
          const ValueKey('thread-message-group-thread-root'),
        );
        final latest = find.byKey(
          const ValueKey('thread-message-group-reply-2'),
        );
        final initialHeadTop = tester.getTopLeft(head).dy;

        tester.view.viewInsets = const FakeViewPadding(bottom: 100);
        await tester.pumpAndSettle();

        expect(latest, findsOneWidget);
        expect(tester.getTopLeft(head).dy, closeTo(initialHeadTop, 0.5));
      },
    );

    for (final layout in [
      (name: 'non-member', isMember: false, isArchived: false),
      (name: 'archived', isMember: true, isArchived: true),
    ]) {
      testWidgets('${layout.name} no-dock tail resumes full-viewport follow', (
        tester,
      ) async {
        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            messagesNotifier: messagesNotifier,
            threadReplies: {'thread-root': replies},
          ),
        );
        await tester.pumpAndSettle();
        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: layout.isMember,
              isArchived: layout.isArchived,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final lifecycle = tester.widget<KeyboardDismissOnDrag>(
          find.byType(KeyboardDismissOnDrag),
        );
        lifecycle.onUserScrollStart!();
        lifecycle.onUserScrollEnd!();
        await tester.pumpAndSettle();
        messagesNotifier.setMessages([
          rootEvent,
          _textMsg(
            id: 'reply-remote',
            pubkey: 'bob',
            content: 'Remote tail',
            createdAt: 9999,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
        ]);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-reply-remote')),
          findsOneWidget,
        );
      });
    }

    testWidgets(
      'composer-covered tail remains detached after drag-end settlement',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            messagesNotifier: messagesNotifier,
            threadReplies: {'thread-root': replies},
          ),
        );
        await tester.pumpAndSettle();
        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        final latest = find.byKey(
          const ValueKey('thread-message-group-reply-29'),
        );
        final composer = find.byKey(const ValueKey('composer-surface'));
        // Clear the gesture arena's touch slop so this represents a deliberate
        // tail-detaching drag rather than a long-press hold with small motion.
        // The compact composer now rests lower, so use enough drag distance to
        // keep the final reply beneath its top edge for this covered-tail case.
        await tester.drag(list, const Offset(0, 56));
        await tester.pumpAndSettle();
        expect(
          tester.getBottomLeft(latest).dy,
          greaterThan(tester.getTopLeft(composer).dy),
        );
        expect(
          tester.getBottomLeft(latest).dy,
          lessThanOrEqualTo(tester.getBottomLeft(list).dy),
        );
        final visibleBeforeRemote = tester
            .widgetList<Widget>(
              find.byWidgetPredicate(
                (widget) =>
                    widget.key is ValueKey<String> &&
                    (widget.key! as ValueKey<String>).value.startsWith(
                      'thread-message-group-',
                    ),
              ),
            )
            .map((widget) => widget.key)
            .toSet();
        final anchorKey = visibleBeforeRemote.firstWhere(
          (key) => key != latest.evaluate().single.widget.key,
        );
        final anchor = find.byKey(anchorKey!);
        final detachedTop = tester.getTopLeft(anchor).dy;

        messagesNotifier.setMessages([
          rootEvent,
          _textMsg(
            id: 'reply-remote',
            pubkey: 'bob',
            content: 'Remote tail',
            createdAt: 9999,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
        ]);
        await tester.pumpAndSettle();
        expect(
          tester
              .widgetList<Widget>(
                find.byWidgetPredicate(
                  (widget) => visibleBeforeRemote.contains(widget.key),
                ),
              )
              .map((widget) => widget.key),
          isNotEmpty,
        );
        expect(tester.getTopLeft(anchor).dy, closeTo(detachedTop, 0.5));

        await tester.tap(find.text('Reply in thread…').hitTestable());
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(anchor).dy, closeTo(detachedTop, 0.5));

        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(anchor).dy, closeTo(detachedTop, 0.5));
      },
    );

    testWidgets('invalid writable dock geometry cannot resume tail follow', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          messagesNotifier: messagesNotifier,
          threadReplies: {'thread-root': replies},
        ),
      );
      await tester.pumpAndSettle();
      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      tester
          .widget<ComposerDockSizeReporter>(
            find.byType(ComposerDockSizeReporter).last,
          )
          .onHeightChanged(0);
      await tester.pumpAndSettle();
      final lifecycle = tester.widget<KeyboardDismissOnDrag>(
        find.byType(KeyboardDismissOnDrag),
      );
      lifecycle.onUserScrollStart!();
      lifecycle.onUserScrollEnd!();
      await tester.pumpAndSettle();
      final anchor = find.byKey(
        const ValueKey('thread-message-group-reply-29'),
      );
      final anchorTop = tester.getTopLeft(anchor).dy;

      messagesNotifier.setMessages([
        rootEvent,
        _textMsg(
          id: 'reply-remote',
          pubkey: 'bob',
          content: 'Remote tail',
          createdAt: 9999,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        ),
      ]);
      await tester.pumpAndSettle();

      expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
    });

    testWidgets('new drag invalidates deferred drag-end resumption', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final messagesNotifier = _FakeMessagesNotifier([rootEvent]);
      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          messagesNotifier: messagesNotifier,
          threadReplies: {'thread-root': replies},
        ),
      );
      await tester.pumpAndSettle();
      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      var lifecycle = tester.widget<KeyboardDismissOnDrag>(
        find.byType(KeyboardDismissOnDrag),
      );
      lifecycle.onUserScrollStart!();
      lifecycle.onUserScrollEnd!();
      await tester.pump();
      lifecycle = tester.widget<KeyboardDismissOnDrag>(
        find.byType(KeyboardDismissOnDrag),
      );
      lifecycle.onUserScrollStart!();
      await tester.pumpAndSettle();
      final anchor = find.byKey(
        const ValueKey('thread-message-group-reply-29'),
      );
      final anchorTop = tester.getTopLeft(anchor).dy;

      messagesNotifier.setMessages([
        rootEvent,
        _textMsg(
          id: 'reply-remote',
          pubkey: 'bob',
          content: 'Remote tail',
          createdAt: 9999,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        ),
      ]);
      await tester.pumpAndSettle();

      expect(tester.getTopLeft(anchor).dy, closeTo(anchorTop, 0.5));
      tester
          .widget<KeyboardDismissOnDrag>(find.byType(KeyboardDismissOnDrag))
          .onUserScrollEnd!();
    });

    testWidgets(
      'dragging away opts out, then returning to the tail resumes keyboard realignment',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            threadReplies: {'thread-root': replies},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        for (var i = 0; i < 4; i++) {
          await tester.drag(list, const Offset(0, 100));
          await tester.pumpAndSettle();
        }
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsOneWidget,
          reason: 'Browsing away from the tail should offer Latest.',
        );
        final visibleBeforeResize = tester
            .widgetList<Widget>(
              find.byWidgetPredicate(
                (widget) =>
                    widget.key is ValueKey<String> &&
                    (widget.key! as ValueKey<String>).value.startsWith(
                      'thread-message-group-',
                    ),
              ),
            )
            .map((widget) => widget.key)
            .toSet();

        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsNothing,
        );
        expect(
          tester
              .widgetList<Widget>(
                find.byWidgetPredicate(
                  (widget) => visibleBeforeResize.contains(widget.key),
                ),
              )
              .map((widget) => widget.key),
          isNotEmpty,
        );

        // Return the viewport to its original geometry while opt-out remains
        // active. This must not itself pull the list back to the tail.
        tester.view.viewInsets = FakeViewPadding.zero;
        await tester.pumpAndSettle();

        // Returning to the tail is a deliberate choice to resume following.
        // Only the scroll-end callback may clear the opt-out state, so this
        // reverse drag must complete before geometry changes re-align the tail.
        for (var i = 0; i < 12; i++) {
          await tester.drag(list, const Offset(0, -100));
          await tester.pumpAndSettle();
        }
        final latestReply = find.byKey(
          const ValueKey('thread-message-group-reply-29'),
        );
        expect(latestReply, findsOneWidget);

        final composerSurface = find.byKey(const ValueKey('composer-surface'));
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(
          tester.getBottomLeft(latestReply).dy,
          lessThanOrEqualTo(tester.getTopLeft(composerSurface).dy),
        );
      },
    );

    testWidgets(
      'deep-link stays put through passive resize until composer focus follows tail',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final completer = Completer<List<NostrEvent>>();

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            pendingThreadReplies: {'thread-root': completer.future},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        final provisionalTarget = formatTimeline([replies[5]]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead, provisionalTarget],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
              initialMessageId: 'reply-5',
            ),
          ),
        );
        await tester.pumpAndSettle();

        completer.complete(replies);
        await tester.pumpAndSettle();

        final target = find.byKey(
          const ValueKey('thread-message-group-reply-5'),
        );
        expect(target, findsOneWidget);
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsOneWidget,
        );

        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(target, findsOneWidget);

        await tester.tap(find.text('Reply in thread…').hitTestable());
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
        );
      },
    );

    testWidgets('iOS composer focus and Latest fully reveal the final reply', (
      tester,
    ) async {
      final previousPlatform = debugDefaultTargetPlatformOverride;
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = previousPlatform);
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      tester.view.viewPadding = const FakeViewPadding(bottom: 20);
      addTearDown(tester.view.reset);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 30; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Reply in thread…').hitTestable());
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();

      final latestReply = find.byKey(
        const ValueKey('thread-message-group-reply-29'),
      );
      final composerSurface = find.byKey(const ValueKey('composer-surface'));
      final focusedReplyBottom = tester.getBottomLeft(latestReply).dy;
      final composerTop = tester.getTopLeft(composerSurface).dy;

      final list = find.byKey(const ValueKey('thread-message-list'));
      final listElement = tester.element(list);
      ScrollStartNotification(
        metrics: FixedScrollMetrics(
          minScrollExtent: 0,
          maxScrollExtent: 100,
          pixels: 0,
          viewportDimension: 100,
          axisDirection: AxisDirection.down,
          devicePixelRatio: 1,
        ),
        context: listElement,
        dragDetails: DragStartDetails(),
      ).dispatch(listElement);
      tester
          .widget<ScrollablePositionedList>(list)
          .itemScrollController!
          .jumpTo(index: 5);
      await tester.pumpAndSettle();
      final latestButton = find.byKey(const ValueKey('thread-jump-to-latest'));
      expect(
        latestReply,
        findsNothing,
        reason: 'Detaching from the tail should unmount the final reply.',
      );
      final latestButtonWasVisible = latestButton.evaluate().length == 1;
      final nativeView = tester.widget<UiKitView>(
        find.byKey(const ValueKey('thread-jump-to-latest-ios-glass')),
      );
      nativeView.onPlatformViewCreated!(42);
      await tester.pump();
      const nativeChannel = MethodChannel('buzz/jump_to_latest_glass/42');
      await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
        nativeChannel.name,
        nativeChannel.codec.encodeMethodCall(const MethodCall('pressed')),
        (_) {},
      );
      await tester.pumpAndSettle();
      final latestReplyBottom = tester.getBottomLeft(latestReply).dy;
      debugDefaultTargetPlatformOverride = previousPlatform;

      expect(
        focusedReplyBottom,
        lessThanOrEqualTo(composerTop),
        reason: 'Focusing the composer must retain the final reply above it.',
      );
      expect(latestButtonWasVisible, isTrue);
      expect(
        latestReplyBottom,
        lessThanOrEqualTo(composerTop),
        reason: 'Latest must reveal the final reply above the iOS composer.',
      );
    });

    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      testWidgets(
        'thread composer focus returns to the tail on ${platform.name}',
        (tester) async {
          final previousPlatform = debugDefaultTargetPlatformOverride;
          debugDefaultTargetPlatformOverride = platform;
          tester.view.physicalSize = const Size(400, 800);
          tester.view.devicePixelRatio = 1;
          tester.view.viewPadding = const FakeViewPadding(bottom: 20);
          addTearDown(tester.view.reset);

          final rootEvent = _textMsg(
            id: 'thread-root',
            pubkey: 'alice',
            content: 'Thread root',
            createdAt: 1000,
          );
          final replies = [
            for (var i = 0; i < 30; i++)
              _textMsg(
                id: 'reply-$i',
                pubkey: 'bob',
                content: 'Reply $i',
                createdAt: 1100 + i,
                extraTags: const [
                  ['e', 'thread-root', '', 'reply'],
                ],
              ),
          ];

          await tester.pumpWidget(
            _buildTestable(
              messages: [rootEvent],
              threadReplies: {'thread-root': replies},
              users: const {
                'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
                'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
              },
            ),
          );
          await tester.pumpAndSettle();

          final threadHead = formatTimeline([rootEvent]).single;
          Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
            MaterialPageRoute<void>(
              builder: (_) => ThreadDetailPage(
                threadHead: threadHead,
                allMessages: [threadHead],
                channelId: _channelId,
                currentPubkey: 'self',
                isMember: true,
                isArchived: false,
                initialMessageId: 'reply-5',
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('thread-jump-to-latest')),
            findsOneWidget,
          );

          await tester.tap(find.text('Reply in thread…').hitTestable());
          await tester.pump();
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          await tester.pump();
          if (platform == TargetPlatform.android) {
            await tester.pump(androidImeMetricsSettleDelay);
          }
          await tester.pumpAndSettle();

          final latestReply = find.byKey(
            const ValueKey('thread-message-group-reply-29'),
          );
          final composerSurface = find.byKey(
            const ValueKey('composer-surface'),
          );
          final focusNode = tester
              .widget<TextField>(find.byType(TextField))
              .focusNode!;
          final latestReplyBottom = tester.getBottomLeft(latestReply).dy;
          final composerTop = tester.getTopLeft(composerSurface).dy;
          final latestButtonIsVisible = find
              .byKey(const ValueKey('thread-jump-to-latest'))
              .evaluate()
              .isNotEmpty;
          debugDefaultTargetPlatformOverride = previousPlatform;

          expect(focusNode.hasFocus, isTrue);
          expect(latestReplyBottom, lessThanOrEqualTo(composerTop));
          expect(latestButtonIsVisible, isFalse);
        },
      );
    }

    testWidgets(
      'thread shows Latest after composer tail correction exhausts and focus leaves',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            threadReplies: {'thread-root': replies},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
            home: ThreadDetailPage(
              threadHead: formatTimeline([rootEvent]).single,
              allMessages: formatTimeline([rootEvent, replies[5]]),
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
              initialMessageId: 'reply-5',
              jumpThreadTailForTesting: () => true,
            ),
          ),
        );
        await tester.pumpAndSettle();

        const latestButton = ValueKey('thread-jump-to-latest');
        expect(find.byKey(latestButton), findsOneWidget);

        await tester.tap(find.text('Reply in thread…').hitTestable());
        await tester.pump();
        for (var frame = 0; frame < 10; frame++) {
          await tester.pump();
        }

        final focusNode = tester
            .widget<TextField>(find.byType(TextField))
            .focusNode!;
        expect(focusNode.hasFocus, isTrue);
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsNothing,
          reason: 'The lazy tail must remain unlaid after bounded correction.',
        );

        focusNode.unfocus();
        await tester.pumpAndSettle();

        expect(focusNode.hasFocus, isFalse);
        expect(find.byKey(latestButton), findsOneWidget);
      },
    );

    testWidgets('thread hides initial tail placement until it is settled', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: formatTimeline([rootEvent]).single,
            allMessages: formatTimeline([rootEvent, ...replies]),
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pump();
      await tester.pump();

      final gate = find.byKey(const ValueKey('thread-initial-viewport-gate'));
      expect(tester.widget<Opacity>(gate).opacity, 0);

      final list = find.byKey(const ValueKey('thread-message-list'));
      final scrollable = tester.state<ScrollableState>(
        find.descendant(of: list, matching: find.byType(Scrollable)).first,
      );
      expect(scrollable.position.isScrollingNotifier.value, isFalse);

      await tester.pumpAndSettle();

      expect(tester.widget<Opacity>(gate).opacity, 1);
      final latestReply = find.byKey(
        const ValueKey('thread-message-group-reply-39'),
      );
      expect(
        tester.getTopLeft(latestReply).dy,
        greaterThanOrEqualTo(frostedAppBarHeight(tester.element(latestReply))),
      );
      expect(
        tester.getTopLeft(latestReply).dy,
        lessThan(
          tester.getTopLeft(find.byKey(const ValueKey('composer-surface'))).dy,
        ),
      );
    });

    testWidgets('thread Latest reaches the tail after inbox hydration', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 40; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: 'Reply $i',
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];
      final authoritativeReplies = Completer<List<NostrEvent>>();

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          pendingThreadReplies: {'thread-root': authoritativeReplies.future},
          localThreadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: ThreadDetailPage(
            threadHead: formatTimeline([rootEvent]).single,
            allMessages: formatTimeline([rootEvent, replies[5]]),
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
            initialMessageId: 'reply-5',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<Opacity>(
              find.byKey(const ValueKey('thread-initial-viewport-gate')),
            )
            .opacity,
        1,
        reason:
            'Pending local replies must not make an in-flight relay query '
            'look hydrated and blank the route snapshot.',
      );
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-5')),
        findsOneWidget,
      );

      authoritativeReplies.complete(replies);
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('thread-jump-to-latest')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('thread-jump-to-latest')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-39')),
        findsOneWidget,
      );
      final composerTop = tester
          .getTopLeft(find.byKey(const ValueKey('composer-surface')))
          .dy;
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('thread-tail-anchor'))).dy,
        lessThanOrEqualTo(composerTop),
        reason: 'Latest must place the actual thread tail above the composer.',
      );
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('thread-tail-anchor'))).dy,
        lessThanOrEqualTo(composerTop),
        reason: 'The hydrated Inbox thread must remain at its actual tail.',
      );
      expect(find.byKey(const ValueKey('thread-jump-to-latest')), findsNothing);
    });

    test('thread tail ignores oscillating item positions at exact extent', () {
      for (final tailItemIsVisible in [true, false, false, true, false]) {
        expect(
          threadTailIsAtEffectiveEnd(
            tailIsLaidOut: true,
            tailIsVisible: tailItemIsVisible,
            extentAfter: 0,
          ),
          isTrue,
        );
      }
      expect(
        threadTailIsAtEffectiveEnd(
          tailIsLaidOut: true,
          tailIsVisible: false,
          extentAfter: 1,
        ),
        isFalse,
      );
      expect(
        threadTailIsAtEffectiveEnd(
          tailIsLaidOut: false,
          tailIsVisible: false,
          extentAfter: 0,
        ),
        isFalse,
        reason: 'A not-yet-laid-out lazy tail cannot trust stale extent.',
      );
    });

    testWidgets('thread Latest settles across expanding lazy scroll extents', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final replies = [
        for (var i = 0; i < 160; i++)
          _textMsg(
            id: 'reply-$i',
            pubkey: 'bob',
            content: [
              'Reply $i',
              ...List.filled(
                1 + (i ~/ 6),
                'Variable-height reply line for lazy layout.',
              ),
            ].join('\n'),
            createdAt: 1100 + i,
            extraTags: const [
              ['e', 'thread-root', '', 'reply'],
            ],
          ),
      ];

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          threadReplies: {'thread-root': replies},
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
          home: ThreadDetailPage(
            threadHead: formatTimeline([rootEvent]).single,
            allMessages: formatTimeline([rootEvent, replies[5]]),
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
            initialMessageId: 'reply-5',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('thread-message-group-reply-5')),
        findsOneWidget,
      );
      const latestButton = ValueKey('thread-jump-to-latest');
      expect(find.byKey(latestButton), findsOneWidget);
      final scrollable = tester.state<ScrollableState>(
        find
            .descendant(
              of: find.byKey(const ValueKey('thread-message-list')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      final initialMaxScrollExtent = scrollable.position.maxScrollExtent;

      await tester.tap(find.byKey(latestButton));
      await tester.pumpAndSettle();

      expect(
        scrollable.position.maxScrollExtent,
        greaterThan(initialMaxScrollExtent),
        reason:
            'The fixture must exercise a lazy extent that expands after '
            'Latest starts.',
      );
      expect(
        find.byKey(const ValueKey('thread-message-group-reply-159')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('thread-jump-to-latest-hidden')),
        findsOneWidget,
        reason:
            'Latest must keep correcting after the lazy extent expands '
            'beyond the first three layout frames.',
      );
    });

    testWidgets(
      'thread shows Latest after browsing history and returns to tail',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 30; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: 'Reply $i',
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            threadReplies: {'thread-root': replies},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
        );

        final landingScrollable = tester.state<ScrollableState>(
          find.descendant(of: list, matching: find.byType(Scrollable)).first,
        );
        landingScrollable.position.jumpTo(
          landingScrollable.position.maxScrollExtent - 24,
        );
        await tester.pump();
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
          reason:
              'A stale landing measurement must not expose Latest before the '
              'user explicitly browses history.',
        );

        await tester.drag(list, const Offset(0, 500));
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsOneWidget,
        );
        expect(
          tester.getSize(find.byKey(const ValueKey('thread-jump-to-latest'))),
          const Size.square(Grid.xl),
        );
        expect(
          tester.getSize(
            find.byKey(const ValueKey('thread-jump-to-latest-surface')),
          ),
          const Size.square(Grid.lg),
        );
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('thread-jump-to-latest')),
            matching: find.byIcon(LucideIcons.arrowDown),
          ),
          findsOneWidget,
        );
        expect(find.text('Latest'), findsNothing);
        final threadLatestSwitcher = tester.widget<AnimatedSwitcher>(
          find.byKey(const ValueKey('thread-jump-to-latest-switcher')),
        );
        expect(
          threadLatestSwitcher.duration,
          const Duration(milliseconds: 180),
        );
        expect(
          threadLatestSwitcher.reverseDuration,
          const Duration(milliseconds: 160),
        );

        final threadScrollable = tester.state<ScrollableState>(
          find.descendant(of: list, matching: find.byType(Scrollable)).first,
        );
        final startPixels = threadScrollable.position.pixels;
        final targetPixels = threadScrollable.position.maxScrollExtent;
        await tester.tap(find.byKey(const ValueKey('thread-jump-to-latest')));
        await tester.pump();

        expect(
          find.byKey(const ValueKey('thread-jump-to-latest-hidden')),
          findsOneWidget,
          reason:
              'Latest should leave immediately once its navigation starts, '
              'rather than lingering over the thread at the tail.',
        );

        expect(
          find.descendant(of: list, matching: find.byType(Scrollable)),
          findsOneWidget,
          reason:
              'Latest must move the active thread scroll position directly; '
              'a second transitional list produces the visible bounce.',
        );

        expect(
          threadScrollable.position.isScrollingNotifier.value,
          isTrue,
          reason: 'Latest should use the same visible glide as the channel.',
        );
        await tester.pump(const Duration(milliseconds: 110));
        expect(threadScrollable.position.pixels, greaterThan(startPixels));
        expect(threadScrollable.position.pixels, lessThan(targetPixels));
        expect(threadScrollable.position.isScrollingNotifier.value, isTrue);
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('thread-message-group-reply-29')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
        );
        final settledTailY = tester
            .getTopLeft(find.byKey(const ValueKey('thread-tail-anchor')))
            .dy;
        await tester.pump(const Duration(milliseconds: 250));
        expect(
          tester
              .getTopLeft(find.byKey(const ValueKey('thread-tail-anchor')))
              .dy,
          closeTo(settledTailY, 0.5),
          reason: 'Latest must not be followed by a corrective rebound.',
        );
      },
    );

    testWidgets(
      'a newly sent reply keeps Latest visible until the lazy tail settles',
      (tester) async {
        tester.view.physicalSize = const Size(400, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final rootEvent = _textMsg(
          id: 'thread-root',
          pubkey: 'alice',
          content: 'Thread root',
          createdAt: 1000,
        );
        final replies = [
          for (var i = 0; i < 160; i++)
            _textMsg(
              id: 'reply-$i',
              pubkey: 'bob',
              content: [
                'Reply $i',
                ...List.filled(
                  1 + (i ~/ 6),
                  'Variable-height reply line for lazy layout.',
                ),
              ].join('\n'),
              createdAt: 1100 + i,
              extraTags: const [
                ['e', 'thread-root', '', 'reply'],
              ],
            ),
        ];
        final messagesNotifier = _FakeMessagesNotifier([rootEvent]);

        await tester.pumpWidget(
          _buildTestable(
            messages: [rootEvent],
            messagesNotifier: messagesNotifier,
            threadReplies: {'thread-root': replies},
            users: const {
              'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
              'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
              'self': UserProfile(pubkey: 'self', displayName: 'Me'),
            },
          ),
        );
        await tester.pumpAndSettle();

        final threadHead = formatTimeline([rootEvent]).single;
        Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
          MaterialPageRoute<void>(
            builder: (_) => ThreadDetailPage(
              threadHead: threadHead,
              allMessages: [threadHead],
              channelId: _channelId,
              currentPubkey: 'self',
              isMember: true,
              isArchived: false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final list = find.byKey(const ValueKey('thread-message-list'));
        final positionedList = tester.widget<ScrollablePositionedList>(list);
        final threadScrollable = tester.state<ScrollableState>(
          find.descendant(of: list, matching: find.byType(Scrollable)).first,
        );
        positionedList.itemScrollController!.jumpTo(index: 5);
        await tester.pumpAndSettle();
        await tester.drag(list, const Offset(0, 20));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-159')),
          findsNothing,
        );
        final initialMaxScrollExtent =
            threadScrollable.position.maxScrollExtent;
        final localReply = _textMsg(
          id: 'reply-local',
          pubkey: 'self',
          content: 'My new reply\n${List.filled(30, 'Final line').join('\n')}',
          createdAt: 2000,
          extraTags: const [
            ['e', 'thread-root', '', 'reply'],
          ],
        );

        messagesNotifier.setMessages([rootEvent, localReply]);
        await tester.pump();
        await tester.pump();

        expect(
          find.byKey(const ValueKey('thread-jump-to-latest-hidden')),
          findsNothing,
          reason:
              'Automatic correction must not hide Latest before the lazy '
              'tail is actually visible.',
        );

        await tester.pumpAndSettle();

        expect(
          threadScrollable.position.maxScrollExtent,
          greaterThan(initialMaxScrollExtent),
          reason:
              'The fixture must expand the lazy extent after automatic '
              'correction starts.',
        );
        expect(
          find.byKey(const ValueKey('thread-message-group-reply-local')),
          findsOneWidget,
        );
        expect(
          threadScrollable.position.isScrollingNotifier.value,
          isFalse,
          reason: 'Reply-driven tail correction must be instant.',
        );
        expect(
          find.byKey(const ValueKey('thread-jump-to-latest')),
          findsNothing,
        );
      },
    );

    testWidgets('a live deletion does not restore the routed thread head', (
      tester,
    ) async {
      final rootEvent = _textMsg(
        id: 'thread-root',
        pubkey: 'alice',
        content: 'Thread root',
        createdAt: 1000,
      );
      final reply = _textMsg(
        id: 'reply-1',
        pubkey: 'bob',
        content: 'A reply',
        createdAt: 1100,
        extraTags: const [
          ['e', 'thread-root', '', 'reply'],
        ],
      );
      final messagesNotifier = _FakeMessagesNotifier([rootEvent]);

      await tester.pumpWidget(
        _buildTestable(
          messages: [rootEvent],
          messagesNotifier: messagesNotifier,
          threadReplies: {
            'thread-root': [reply],
          },
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'bob': UserProfile(pubkey: 'bob', displayName: 'Bob'),
          },
        ),
      );
      await tester.pumpAndSettle();

      final threadHead = formatTimeline([rootEvent]).single;
      Navigator.of(tester.element(find.byType(ChannelDetailPage))).push(
        MaterialPageRoute<void>(
          builder: (_) => ThreadDetailPage(
            threadHead: threadHead,
            allMessages: [threadHead],
            channelId: _channelId,
            currentPubkey: 'self',
            isMember: true,
            isArchived: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Thread root'), findsOneWidget);

      messagesNotifier.setMessages([
        rootEvent,
        _deletion(id: 'delete-root', targetIds: ['thread-root']),
      ]);
      await tester.pumpAndSettle();

      expect(find.text('Thread root'), findsNothing);
      expect(
        find.byKey(const ValueKey('thread-message-deleted')),
        findsOneWidget,
      );
      expect(find.text('This message was deleted'), findsOneWidget);
    });
  });
}

Channel _channel({required String id, required String name}) => Channel(
  id: id,
  name: name,
  channelType: 'stream',
  visibility: 'open',
  description: '$name discussion',
  createdBy: 'abc123',
  createdAt: DateTime(2025),
  memberCount: 3,
  isMember: true,
);

class _FakeThreadLocalRepliesNotifier extends ThreadLocalRepliesNotifier {
  final List<NostrEvent> _replies;

  _FakeThreadLocalRepliesNotifier(super.args, this._replies);

  @override
  List<NostrEvent> build() => _replies;
}

class _FakeMessagesNotifier extends ChannelMessagesNotifier {
  List<NostrEvent> _messages;
  bool _hasLoadedMessages;
  final List<List<NostrEvent>> _olderPages;
  final bool failOlderFetch;
  int fetchOlderCalls = 0;

  _FakeMessagesNotifier(
    this._messages, {
    String channelId = _channelId,
    bool hasLoadedMessages = true,
    List<List<NostrEvent>> olderPages = const [],
    this.failOlderFetch = false,
  }) : _hasLoadedMessages = hasLoadedMessages,
       _olderPages = [...olderPages],
       super(channelId);

  @override
  AsyncValue<List<NostrEvent>> build() => AsyncData(_messages);

  @override
  bool get hasLoadedMessages => _hasLoadedMessages;

  @override
  bool get reachedOldest => _olderPages.isEmpty && !failOlderFetch;

  @override
  Future<bool> fetchOlder() async {
    fetchOlderCalls += 1;
    if (failOlderFetch || _olderPages.isEmpty) return false;
    _messages = [..._olderPages.removeAt(0), ..._messages]
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    state = AsyncData(_messages);
    return true;
  }

  void setMessages(List<NostrEvent> messages) {
    _messages = messages;
    _hasLoadedMessages = true;
    state = AsyncData(messages);
  }
}

class _TestAppLifecycleNotifier extends AppLifecycleNotifier {
  @override
  AppLifecycleState build() => AppLifecycleState.resumed;

  void setLifecycle(AppLifecycleState value) => state = value;
}

class _TrackingRelaySession extends RelaySessionNotifier {
  final visibleChannels = <String>[];

  @override
  SessionState build() =>
      const SessionState(status: SessionStatus.disconnected);

  @override
  void Function() registerVisibleChannel(String channelId) {
    final release = super.registerVisibleChannel(channelId);
    visibleChannels.add(channelId);
    var released = false;
    return () {
      if (released) return;
      released = true;
      visibleChannels.remove(channelId);
      release();
    };
  }
}

class _ReconnectingRelaySession extends RelaySessionNotifier {
  _ReconnectingRelaySession();

  @override
  SessionState build() =>
      const SessionState(status: SessionStatus.reconnecting);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async => [];

  void connect() {
    state = const SessionState(status: SessionStatus.connected);
  }
}

class _SynchronousReadStateNotifier extends ReadStateNotifier {
  final ReadStateState _initialState;
  final Map<String, int> markedContexts = {};

  _SynchronousReadStateNotifier(this._initialState);

  @override
  ReadStateState build() => _initialState;

  @override
  void markContextRead(
    String contextId,
    int unixTimestamp, {
    bool clearForcedMessages = false,
  }) {
    markedContexts[contextId] = unixTimestamp;
    state = state.copyWithContext(contextId, unixTimestamp);
  }
}

class _FakeUserCacheNotifier extends UserCacheNotifier {
  final Map<String, UserProfile> _users;
  final Future<bool> Function(List<String>)? _preload;
  _FakeUserCacheNotifier(
    this._users, {
    Future<bool> Function(List<String>)? preload,
  }) : _preload = preload;

  @override
  Map<String, UserProfile> build() => _users;

  @override
  UserProfile? get(String pubkey) => _users[pubkey.toLowerCase()];

  @override
  Future<bool> preload(List<String> pubkeys) =>
      _preload?.call(pubkeys) ?? Future.value(true);

  @override
  Future<bool> refresh(List<String> pubkeys) => preload(pubkeys);

  void replace(UserProfile profile) {
    state = {...state, profile.pubkey.toLowerCase(): profile};
  }
}

class _FakeChannelsNotifier extends ChannelsNotifier {
  List<Channel> _channels;
  final Map<String, Map<String, ObservedUnreadEvent>> _observedUnread;

  _FakeChannelsNotifier(
    this._channels, {
    Map<String, List<ObservedUnreadEvent>> observedUnread = const {},
  }) : _observedUnread = {
         for (final entry in observedUnread.entries)
           entry.key: {for (final event in entry.value) event.id: event},
       };

  @override
  Map<String, Map<String, ObservedUnreadEvent>>
  get observedUnreadEventsByChannel => _observedUnread;

  @override
  Future<List<Channel>> build() => SynchronousFuture(_channels);

  void setChannels(List<Channel> channels) {
    _channels = channels;
    state = AsyncData(channels);
  }
}

class _RecordingRelaySocket extends RelaySocket {
  _RecordingRelaySocket()
    : super(
        wsUrl: 'wss://relay.example',
        nsec: null,
        onMessage: (_) {},
        onConnected: () {},
        onDisconnected: (_) {},
      );

  final List<List<dynamic>> messages = [];

  @override
  void send(List<dynamic> payload) => messages.add(payload);

  @override
  void dispose() {}
}

NostrFilter _filterForChannel(String channelId) => NostrFilter(
  kinds: EventKind.channelEventKinds,
  tags: {
    '#h': [channelId],
  },
  limit: 0,
);

List<String> _replayedChannelIds(_RecordingRelaySocket socket) => socket
    .messages
    .where((message) => message.first == 'REQ')
    .map(
      (message) =>
          ((message[2] as Map<String, dynamic>)['#h'] as List).single as String,
    )
    .toList();

final _transparentPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class _TestNavigatorObserver extends NavigatorObserver {
  int pushCount = 0;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushCount += 1;
    super.didPush(route, previousRoute);
  }
}
