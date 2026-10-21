import 'dart:async';

import 'package:buzz/features/activity/activity_page.dart';
import 'package:buzz/features/activity/activity_provider.dart';
import 'package:buzz/features/activity/feed_item.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_detail_page.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/channels/compose_drafts_provider.dart';
import 'package:buzz/shared/mentions/agent_identity_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/frosted_app_bar.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _alice =
    'a11ce00000000000000000000000000000000000000000000000000000000000';

void main() {
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;

  final testMention = FeedItem(
    id: 'm1',
    kind: 9,
    pubkey: _alice,
    content: 'Hey check this out',
    createdAt: now - 120,
    channelId: 'ch1',
    tags: const [],
    category: 'mention',
  );

  final testThreadReply = FeedItem(
    id: 'a1',
    kind: 9,
    pubkey: 'bob_pk',
    content: 'Deployed the fix',
    createdAt: now - 3600,
    channelId: 'ch2',
    tags: const [
      ['e', 'root1', '', 'root'],
      ['e', 'root1', '', 'reply'],
    ],
    category: 'mention',
  );

  final testFeed = HomeFeedResponse(
    mentions: [testMention, testThreadReply],
    activity: const [],
  );

  Channel channel(String id, String name, {String type = 'stream'}) => Channel(
    id: id,
    name: name,
    channelType: type,
    visibility: 'private',
    description: '',
    createdBy: 'x',
    createdAt: DateTime(2025),
    memberCount: 3,
    isMember: true,
  );

  final testChannels = [
    channel('ch1', 'general'),
    channel('ch2', 'engineering'),
  ];

  final testUsers = <String, UserProfile>{
    _alice: const UserProfile(
      pubkey: _alice,
      displayName: 'Alice',
      nip05Handle: 'alice@example.com',
    ),
    'bob_pk': const UserProfile(pubkey: 'bob_pk', displayName: 'Bob'),
  };

  late _FakeReadStateNotifier readStateNotifier;
  late _FakeActivityNotifier activityNotifier;

  Future<Widget> buildTestable({
    HomeFeedResponse? feed,
    ActivityNotifier Function()? customActivity,
    Map<String, UserProfile>? users,
    Map<String, int> readContexts = const {},
    List<Channel>? channels,
    List<ComposeDraft> drafts = const [],
    Locale? locale,
    List<NavigatorObserver> navigatorObservers = const [],
    ValueListenable<int>? tabReselection,
  }) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    readStateNotifier = _FakeReadStateNotifier(readContexts);
    activityNotifier = _FakeActivityNotifier(feed ?? testFeed);
    return ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        myPubkeyProvider.overrideWithValue('me_pk'),
        activityProvider.overrideWith(customActivity ?? () => activityNotifier),
        channelsProvider.overrideWith(
          () => _FakeChannelsNotifier(channels ?? testChannels),
        ),
        userCacheProvider.overrideWith(
          () => _FakeUserCacheNotifier(users ?? testUsers),
        ),
        knownAgentPubkeysProvider.overrideWithValue(const {}),
        readStateProvider.overrideWith(() => readStateNotifier),
        composeDraftsProvider.overrideWith(
          () => _FakeComposeDraftsNotifier(drafts),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        locale: locale,
        supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        navigatorObservers: navigatorObservers,
        home: ActivityPage(tabReselection: tabReselection),
      ),
    );
  }

  testWidgets('shows loading skeleton while feed loads', (tester) async {
    await tester.pumpWidget(
      await buildTestable(customActivity: _PendingActivityNotifier.new),
    );
    await tester.pump();

    expect(find.text('Hey check this out'), findsNothing);
    expect(find.text('No activity yet'), findsNothing);
  });

  testWidgets('shows empty state when feed is empty', (tester) async {
    await tester.pumpWidget(
      await buildTestable(feed: HomeFeedResponse.empty()),
    );
    await tester.pumpAndSettle();

    expect(find.text('No activity yet'), findsOneWidget);
  });

  testWidgets('is a top-level page titled with the shared Inbox text', (
    tester,
  ) async {
    await tester.pumpWidget(await buildTestable());
    await tester.pumpAndSettle();

    final appBar = tester.widget<FrostedAppBar>(
      find.byType(FrostedAppBar).last,
    );
    expect(appBar.automaticallyImplyLeading, isFalse);
    expect(find.text('Inbox'), findsOneWidget);
  });

  testWidgets('uses the selected platform language', (tester) async {
    await tester.pumpWidget(
      await buildTestable(locale: const Locale('zh', 'CN')),
    );
    await tester.pumpAndSettle();

    expect(find.text('收件箱'), findsOneWidget);
    expect(find.text('提及于'), findsNWidgets(2));
    expect(find.text('Mentioned in'), findsNothing);
  });

  testWidgets('shows error view with retry button', (tester) async {
    await tester.pumpWidget(
      await buildTestable(customActivity: _ErrorActivityNotifier.new),
    );
    await tester.pumpAndSettle();

    expect(find.text('Home feed unavailable'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('rows lead with sender, contextual label, and preview', (
    tester,
  ) async {
    await tester.pumpWidget(await buildTestable());
    await tester.pumpAndSettle();

    expect(find.text('Alice'), findsOneWidget);
    expect(find.text('alice@example.com'), findsOneWidget);
    expect(find.text('Bob'), findsOneWidget);

    // A thread reply that mentions me is labelled as a mention first.
    expect(find.text('Mentioned in'), findsNWidgets(2));
    expect(find.text('#general'), findsOneWidget);
    expect(find.text('#engineering'), findsOneWidget);

    final contextLabel = tester.widgetList<Text>(find.text('Mentioned in'));
    expect(
      contextLabel.first.style?.fontSize,
      activityContextTextStyle.fontSize,
    );

    expect(find.textContaining('Hey check this out'), findsOneWidget);
    expect(find.textContaining('Deployed the fix'), findsOneWidget);
  });

  testWidgets('multiple top-level messages in one DM render one row', (
    tester,
  ) async {
    FeedItem dmMessage(String id, int age) => FeedItem(
      id: id,
      kind: 9,
      pubkey: _alice,
      content: 'dm body $id',
      createdAt: now - age,
      channelId: 'dm1',
      tags: const [],
      category: 'activity',
    );

    await tester.pumpWidget(
      await buildTestable(
        feed: HomeFeedResponse(
          mentions: const [],
          activity: [dmMessage('dm-a', 300), dmMessage('dm-b', 200)],
        ),
        channels: [...testChannels, channel('dm1', 'dm', type: 'dm')],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('inbox-row-dm-b')), findsOneWidget);
    expect(find.byKey(const ValueKey('inbox-row-dm-a')), findsNothing);
    expect(find.text('DM from Alice'), findsOneWidget);
    expect(find.textContaining('dm body dm-a'), findsNothing);
  });

  testWidgets('unread rows show a dot; read rows do not', (tester) async {
    await tester.pumpWidget(await buildTestable(readContexts: {'ch1': now}));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('inbox-unread-dot-m1')), findsNothing);
    expect(find.byKey(const ValueKey('inbox-unread-dot-a1')), findsOneWidget);
  });

  testWidgets('New boundary separates unread rows from read rows', (
    tester,
  ) async {
    await tester.pumpWidget(
      await buildTestable(readContexts: {'thread:root1': now}),
    );
    await tester.pumpAndSettle();

    expect(find.text('New'), findsOneWidget);
  });

  testWidgets('filter menu offers only the sources Mobile reads', (
    tester,
  ) async {
    await tester.pumpWidget(await buildTestable());
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('activity-filter-menu')));
    await tester.pumpAndSettle();
    final popover = find.byKey(const ValueKey('activity-filter-popover'));
    for (final label in ['Mentions', 'Threads', 'Activity', 'Drafts']) {
      expect(
        find.descendant(of: popover, matching: find.text(label)),
        findsOneWidget,
      );
    }
    for (final label in ['Needs Action', 'Agents', 'Reminders']) {
      expect(find.text(label), findsNothing);
    }

    await tester.tap(
      find.descendant(of: popover, matching: find.text('Threads')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Deployed the fix'), findsOneWidget);
    expect(find.textContaining('Hey check this out'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('activity-filter-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Activity').last);
    await tester.pumpAndSettle();

    expect(find.text('No activity yet'), findsOneWidget);
  });

  testWidgets('drafts filter lists local drafts and their destination', (
    tester,
  ) async {
    await tester.pumpWidget(
      await buildTestable(
        drafts: const [
          ComposeDraft(
            key: 'ch1:root1',
            channelId: 'ch1',
            threadHeadId: 'root1',
            text: 'half-written reply',
            updatedAt: 1,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('activity-filter-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Drafts').last);
    await tester.pumpAndSettle();

    expect(find.text('half-written reply'), findsOneWidget);
    expect(find.text('Thread in #general'), findsOneWidget);
  });

  testWidgets('unread-only toggle hides read rows', (tester) async {
    await tester.pumpWidget(await buildTestable(readContexts: {'ch1': now}));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('activity-options-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Show unread only'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Deployed the fix'), findsOneWidget);
    expect(find.textContaining('Hey check this out'), findsNothing);
  });

  testWidgets('mark as read advances the shared msg and channel positions', (
    tester,
  ) async {
    await tester.pumpWidget(await buildTestable());
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(const ValueKey('inbox-row-a1')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text('Mark as read'),
      ),
    );
    await tester.pumpAndSettle();

    expect(readStateNotifier.markedRead, {
      'msg:a1': now - 3600,
      'thread:root1': now - 3600,
    });
    expect(find.byKey(const ValueKey('inbox-unread-dot-a1')), findsNothing);

    await tester.longPress(find.byKey(const ValueKey('inbox-row-m1')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text('Mark as read'),
      ),
    );
    await tester.pumpAndSettle();

    expect(readStateNotifier.markedRead['ch1'], now - 120);
  });

  testWidgets('long-press mark unread reopens a read row for the session', (
    tester,
  ) async {
    await tester.pumpWidget(
      await buildTestable(readContexts: {'ch1': now, 'thread:root1': now}),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('inbox-unread-dot-m1')), findsNothing);

    await tester.longPress(find.byKey(const ValueKey('inbox-row-m1')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text('Mark unread'),
      ),
    );
    await tester.pumpAndSettle();

    expect(readStateNotifier.markedUnread, ['ch1']);
    expect(find.byKey(const ValueKey('inbox-unread-dot-m1')), findsOneWidget);
  });

  testWidgets('mark all as read covers every unread visible row', (
    tester,
  ) async {
    await tester.pumpWidget(await buildTestable());
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('activity-options-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark all as read'));
    await tester.pumpAndSettle();

    expect(readStateNotifier.markedRead.keys.toSet(), {
      'ch1',
      'msg:a1',
      'thread:root1',
    });
    expect(find.byKey(const ValueKey('inbox-unread-dot-m1')), findsNothing);
    expect(find.byKey(const ValueKey('inbox-unread-dot-a1')), findsNothing);
  });

  testWidgets('commits the read-state action past the swipe threshold', (
    tester,
  ) async {
    await tester.pumpWidget(
      await buildTestable(readContexts: {'ch1': now, 'thread:root1': now}),
    );
    await tester.pumpAndSettle();

    await tester.drag(
      find.byKey(const ValueKey('inbox-row-m1')),
      const Offset(-500, 0),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('inbox-unread-dot-m1')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('inbox-swipe-background-m1')),
      findsNothing,
    );
  });

  testWidgets('opens a thread mention at the referenced message', (
    tester,
  ) async {
    final observer = _PushObserver();
    await tester.pumpWidget(
      await buildTestable(
        feed: HomeFeedResponse(
          mentions: [
            FeedItem(
              id: 'reply-event',
              kind: 9,
              pubkey: _alice,
              content: 'Reply in a thread',
              createdAt: now,
              channelId: 'ch1',
              tags: const [
                ['e', 'thread-root', '', 'root'],
                ['e', 'parent-reply', '', 'reply'],
              ],
              category: 'mention',
            ),
          ],
          activity: const [],
        ),
        navigatorObservers: [observer],
      ),
    );
    await tester.pumpAndSettle();

    // Inspect the pushed destination without building the full channel
    // page, which needs the live relay and platform session.
    await tester.tap(find.byKey(const ValueKey('inbox-row-reply-event')));
    final route = observer.pushed.last as MaterialPageRoute<void>;
    final page =
        route.builder(tester.element(find.byType(ActivityPage)))
            as ChannelDetailPage;
    expect(page.channel.id, 'ch1');
    expect(page.initialThreadRootId, 'parent-reply');
    expect(page.initialMessageId, 'reply-event');
    expect(
      page.initialThreadRouteBehavior,
      InitialThreadRouteBehavior.replaceCurrentRoute,
    );
  });

  testWidgets('a row whose channel is unavailable explains instead', (
    tester,
  ) async {
    final observer = _PushObserver();
    await tester.pumpWidget(
      await buildTestable(
        channels: [testChannels.last],
        navigatorObservers: [observer],
      ),
    );
    await tester.pumpAndSettle();
    final pushedBefore = observer.pushed.length;

    await tester.tap(find.byKey(const ValueKey('inbox-row-m1')));
    await tester.pump();

    expect(observer.pushed, hasLength(pushedBefore));
    expect(find.text('Destination unavailable'), findsOneWidget);
  });

  testWidgets('scrolls to the top when its tab is selected again', (
    tester,
  ) async {
    final reselection = ValueNotifier(0);
    addTearDown(reselection.dispose);
    final many = [
      for (var i = 0; i < 30; i++)
        FeedItem(
          id: 'm$i',
          kind: 9,
          pubkey: _alice,
          content: 'message $i',
          createdAt: now - i,
          channelId: 'ch1',
          tags: const [],
          category: 'mention',
        ),
    ];
    await tester.pumpWidget(
      await buildTestable(
        feed: HomeFeedResponse(mentions: many, activity: const []),
        tabReselection: reselection,
      ),
    );
    await tester.pumpAndSettle();

    final scrollable = find
        .descendant(
          of: find.byType(CustomScrollView),
          matching: find.byType(Scrollable),
        )
        .first;
    await tester.drag(scrollable, const Offset(0, -800));
    await tester.pumpAndSettle();
    final position = tester.state<ScrollableState>(scrollable).position;
    expect(position.pixels, greaterThan(0));

    reselection.value++;
    await tester.pumpAndSettle();
    expect(position.pixels, position.minScrollExtent);
  });
}

class _PushObserver extends NavigatorObserver {
  final List<Route<dynamic>> pushed = [];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushed.add(route);
  }
}

class _FakeActivityNotifier extends ActivityNotifier {
  _FakeActivityNotifier(this._feed);
  final HomeFeedResponse _feed;
  int refreshes = 0;

  @override
  Future<HomeFeedResponse> build() async => _feed;

  @override
  Future<void> refresh() async {
    refreshes += 1;
  }
}

class _PendingActivityNotifier extends ActivityNotifier {
  @override
  Future<HomeFeedResponse> build() => Completer<HomeFeedResponse>().future;
}

class _ErrorActivityNotifier extends ActivityNotifier {
  @override
  Future<HomeFeedResponse> build() => Future.error('Connection refused');

  @override
  Future<void> refresh() async {}
}

class _FakeChannelsNotifier extends ChannelsNotifier {
  _FakeChannelsNotifier(this._channels);
  final List<Channel> _channels;

  @override
  Future<List<Channel>> build() async => _channels;
}

class _FakeUserCacheNotifier extends UserCacheNotifier {
  _FakeUserCacheNotifier(this._users);
  final Map<String, UserProfile> _users;

  @override
  Map<String, UserProfile> build() => _users;

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}

class _FakeReadStateNotifier extends ReadStateNotifier {
  _FakeReadStateNotifier(this._contexts);
  final Map<String, int> _contexts;
  final Map<String, int> markedRead = {};
  final List<String> markedUnread = [];

  @override
  ReadStateState build() => ReadStateState(
    isReady: true,
    pubkey: 'me_pk',
    contexts: Map.unmodifiable(_contexts),
    version: 1,
  );

  @override
  void markContextRead(
    String contextId,
    int unixTimestamp, {
    bool clearForcedMessages = false,
  }) {
    markedRead[contextId] = unixTimestamp;
    state = _withForced({
      for (final entry in state.forcedUnreadContexts.entries)
        if (entry.key != contextId) entry.key: entry.value,
    }).copyWithContext(contextId, unixTimestamp);
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

class _FakeComposeDraftsNotifier extends ComposeDraftsNotifier {
  _FakeComposeDraftsNotifier(this._drafts);
  final List<ComposeDraft> _drafts;

  @override
  List<ComposeDraft> build() => _drafts;
}
