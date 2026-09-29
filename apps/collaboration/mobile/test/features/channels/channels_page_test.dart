import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_page.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/features/channels/unread_badge/observed_unread_event.dart';
import 'package:buzz/features/profile/profile_avatar.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/shared/community/community_icon_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/avatar_image.dart';
import 'package:buzz/shared/widgets/frosted_app_bar.dart';
import 'package:buzz/shared/widgets/skeleton.dart';

void main() {
  Widget buildTestable({
    required List<Override> overrides,
    double keyboardInset = 0,
    bool disableAnimations = false,
    double bottomPadding = 0,
    Map<String, String?> communityIcons = const {},
    ValueChanged<String>? onCommunityIconLoad,
    TextScaler textScaler = TextScaler.noScaling,
    Gradient? topSectionGradient,
    ValueChanged<double>? onSettingsTransitionProgress,
    ValueListenable<int>? tabReselection,
  }) {
    return ProviderScope(
      overrides: [
        // The avatar reads the Kailo session; keep it off the network.
        kailoSessionViewProvider.overrideWith(
          (ref) => Future.value(_sessionView),
        ),
        communityIconProvider.overrideWith((ref, relayUrl) async {
          onCommunityIconLoad?.call(relayUrl);
          return communityIcons[relayUrl];
        }),
        ...overrides,
      ],
      child: MaterialApp(
        theme: AppTheme.light(topSectionGradient: topSectionGradient),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: disableAnimations,
            textScaler: textScaler,
            padding: EdgeInsets.only(bottom: bottomPadding),
            viewInsets: EdgeInsets.only(bottom: keyboardInset),
          ),
          child: child!,
        ),
        home: ChannelsPage(
          settingsPageBuilder: _buildSettingsPage,
          onSettingsTransitionProgress: onSettingsTransitionProgress ?? (_) {},
          tabReselection: tabReselection,
        ),
      ),
    );
  }

  final testChannels = [
    Channel(
      id: '1',
      name: 'general',
      channelType: 'stream',
      visibility: 'open',
      description: 'General discussion',
      createdBy: 'abc',
      createdAt: DateTime(2025),
      memberCount: 10,
      isMember: true,
    ),
    Channel(
      id: '2',
      name: 'design-forum',
      channelType: 'forum',
      visibility: 'open',
      description: 'Discuss designs',
      createdBy: 'abc',
      createdAt: DateTime(2025),
      memberCount: 3,
      isMember: true,
    ),
    Channel(
      id: '3',
      name: 'releases',
      channelType: 'stream',
      visibility: 'private',
      description: 'Release coordination',
      createdBy: 'abc',
      createdAt: DateTime(2025),
      memberCount: 2,
      isMember: true,
    ),
  ];

  testWidgets('sizes the community header for accessible text', (tester) async {
    await tester.pumpWidget(
      buildTestable(
        textScaler: const TextScaler.linear(2),
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final appBar = tester.widget<FrostedAppBar>(
      find.byType(FrostedAppBar).last,
    );
    final titleStyle = appBar.titleStyle!;
    expect(titleStyle.fontSize, 22);
    expect(
      tester
          .getSize(
            find.descendant(
              of: find.byType(FrostedAppBar).last,
              matching: find.byType(ClipRect),
            ),
          )
          .height,
      closeTo(
        frostedAppBarHeight(
              tester.element(find.byType(FrostedAppBar).last),
              titleStyle: titleStyle,
              bottomHeight: appBar.bottomHeight,
            ) -
            1,
        0.01,
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('interrupts a ballistic scroll from a transparent list gap', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final channels = List.generate(
      40,
      (index) => Channel(
        id: 'channel-$index',
        name: 'channel-$index',
        channelType: 'stream',
        visibility: 'open',
        description: 'Channel $index',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 10,
        isMember: true,
      ),
    );
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(channels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final scrollView = find.byType(CustomScrollView);
    final scrollable = tester.state<ScrollableState>(
      find.descendant(of: scrollView, matching: find.byType(Scrollable)).first,
    );
    await tester.fling(scrollView, const Offset(0, -300), 2400);
    await tester.pump(const Duration(milliseconds: 32));
    final ballisticOffset = scrollable.position.pixels;
    await tester.pump(const Duration(milliseconds: 32));
    expect(scrollable.position.pixels, greaterThan(ballisticOffset));

    // x=1 is inside the scroll viewport but outside the padded section rows.
    // A drag beginning here must still enter the scrollable's gesture arena.
    final interruptingDrag = await tester.startGesture(const Offset(1, 300));
    await interruptingDrag.moveBy(const Offset(0, 80));
    await tester.pump();

    expect(scrollable.position.pixels, lessThan(ballisticOffset));
    await interruptingDrag.up();
  });

  testWidgets('keeps the last channel above the floating tab bar', (
    tester,
  ) async {
    const footerClearance = 102.0;
    await tester.pumpWidget(
      buildTestable(
        bottomPadding: footerClearance,
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final padding = tester.widget<SliverPadding>(
      find.descendant(
        of: find.byType(CustomScrollView),
        matching: find.byType(SliverPadding),
      ),
    );
    expect((padding.padding as EdgeInsets).bottom, footerClearance);
  });

  testWidgets('keeps the Buzz background fixed behind the channels list', (
    tester,
  ) async {
    await tester.pumpWidget(
      buildTestable(
        topSectionGradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.yellow, Colors.blue],
        ),
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('frosted-scaffold-pinned-gradient')),
      findsOneWidget,
    );
    expect(find.byType(DecoratedSliver), findsNothing);
    final gradientBackground = tester.widget<DecoratedBox>(
      find.byKey(const ValueKey('frosted-scaffold-pinned-gradient')),
    );
    final gradient =
        (gradientBackground.decoration as BoxDecoration).gradient
            as LinearGradient;
    expect(gradient.end, Alignment.bottomCenter);

    final appBar = tester.widget<FrostedAppBar>(
      find.byType(FrostedAppBar).last,
    );
    expect(appBar.frosted, isFalse);
    expect(appBar.frostedSurfaceOpacity, 0);
    expect(appBar.frostedBlurSigma, 0);
    expect(appBar.showBottomDivider, isFalse);
    expect(appBar.bottomHeight, Grid.xxs);
  });

  testWidgets('builds Home header frost progressively while scrolling', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 160);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      buildTestable(
        topSectionGradient: const LinearGradient(
          colors: [Colors.yellow, Colors.blue],
        ),
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final scrollable = tester.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    expect(scrollable.position.maxScrollExtent, greaterThanOrEqualTo(Grid.xxl));

    scrollable.position.jumpTo(Grid.xl / 2);
    await tester.pump();
    var appBar = tester.widget<FrostedAppBar>(find.byType(FrostedAppBar).last);
    expect(appBar.frosted, isTrue);
    expect(appBar.frostedSurfaceOpacity, 0);
    expect(appBar.frostedBlurSigma, closeTo(8.67, 0.001));

    scrollable.position.jumpTo(Grid.xxl);
    await tester.pump();
    appBar = tester.widget<FrostedAppBar>(find.byType(FrostedAppBar).last);
    expect(appBar.frostedSurfaceOpacity, 0);
    expect(appBar.frostedBlurSigma, 23.12);
  });

  testWidgets('scrolls Home to the top when its tab is selected again', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 160);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final tabReselection = ValueNotifier(0);
    addTearDown(tabReselection.dispose);
    await tester.pumpWidget(
      buildTestable(
        tabReselection: tabReselection,
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final scrollable = tester.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    tabReselection.value++;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 130));

    expect(
      scrollable.position.pixels,
      lessThan(scrollable.position.maxScrollExtent),
    );
    await tester.pumpAndSettle();
    expect(scrollable.position.pixels, scrollable.position.minScrollExtent);
  });

  testWidgets('aligns the top, section, row, and skeleton label columns', (
    tester,
  ) async {
    final relaySession = _ReconnectingRelaySession();
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
          relaySessionProvider.overrideWith(() => relaySession),
        ],
      ),
    );
    relaySession.connect();
    await tester.pumpAndSettle();

    final topLabelX = tester.getTopLeft(find.text('Community')).dx;
    final sectionLabelX = tester.getTopLeft(find.text('Channels')).dx;
    final rowLabelX = tester.getTopLeft(find.text('general')).dx;
    // The community title shares the leading row with its avatar. Channel
    // labels stay aligned below it.
    expect(topLabelX, Grid.twelve + 40 + Grid.xxs);
    expect(sectionLabelX, rowLabelX);

    relaySession.setReconnecting();
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();

    final skeletonSectionLabelX = tester
        .getTopLeft(
          find.byKey(const Key('channels-skeleton-section-label')).first,
        )
        .dx;
    final skeletonRowLabelX = tester
        .getTopLeft(
          find.byKey(const Key('channels-skeleton-row-label-0')).first,
        )
        .dx;
    expect(skeletonSectionLabelX, skeletonRowLabelX);
    expect(skeletonSectionLabelX, sectionLabelX);
  });

  testWidgets('centers the smaller profile avatar beside the community', (
    tester,
  ) async {
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final appBar = find.byType(FrostedAppBar).last;
    final communityAvatar = find.descendant(
      of: appBar,
      matching: find.byType(AvatarImage),
    );
    final profileAvatar = find.descendant(
      of: appBar,
      matching: find.byType(ProfileAvatar),
    );

    expect(tester.getSize(communityAvatar), const Size.square(40));
    expect(tester.getSize(profileAvatar), const Size.square(36));
    final communityRect = tester.getRect(communityAvatar);
    final profileRect = tester.getRect(profileAvatar);
    expect(profileRect.center.dy, communityRect.center.dy);
  });

  testWidgets('reveals channel content from same-slot reconnect skeletons', (
    tester,
  ) async {
    final relaySession = _ReconnectingRelaySession();
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
          relaySessionProvider.overrideWith(() => relaySession),
        ],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();

    final skeleton = find.byKey(const Key('channels-connection-skeleton'));
    expect(skeleton, findsOneWidget);
    expect(
      find.descendant(of: skeleton, matching: find.byType(SkeletonBar)),
      findsWidgets,
    );
    expect(
      find.descendant(
        of: skeleton,
        matching: find.byType(CircularProgressIndicator),
      ),
      findsNothing,
    );
    expect(
      tester
          .widget<Opacity>(find.byKey(const Key('skeleton-reveal-placeholder')))
          .opacity,
      1,
    );
    expect(
      tester
          .widget<Opacity>(find.byKey(const Key('skeleton-reveal-content')))
          .opacity,
      0,
    );

    relaySession.connect();
    await tester.pump();
    await tester.pump();
    expect(
      tester.widget<SkeletonReveal>(find.byType(SkeletonReveal)).loading,
      isFalse,
    );
    await tester.pump(const Duration(milliseconds: 200));

    expect(
      tester
          .widget<Opacity>(find.byKey(const Key('skeleton-reveal-placeholder')))
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
    expect(find.text('general'), findsOneWidget);
  });

  testWidgets('announces neutral loading outside connection transitions', (
    tester,
  ) async {
    final relaySession = _ReconnectingRelaySession(
      initialStatus: SessionStatus.connected,
    );
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _LoadingNotifier()),
          relaySessionProvider.overrideWith(() => relaySession),
        ],
      ),
    );
    await tester.pump();

    expect(
      tester
          .widget<Semantics>(
            find.byKey(const Key('channels-connection-skeleton')),
          )
          .properties
          .label,
      'Loading',
    );
  });

  testWidgets('opens the settings page supplied by the app layer', (
    tester,
  ) async {
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Hero), findsNothing);
    await tester.tap(find.byType(ProfileAvatar));
    await tester.pumpAndSettle();

    expect(find.text('Injected settings'), findsOneWidget);
    final route = ModalRoute.of(tester.element(find.text('Injected settings')));
    expect(route, isNot(isA<MaterialPageRoute<void>>()));
    expect(route?.opaque, isFalse);
    expect(route?.allowSnapshotting, isFalse);
    expect(route?.transitionDuration, const Duration(milliseconds: 150));
    expect(route?.reverseTransitionDuration, const Duration(milliseconds: 150));
  });

  testWidgets('reports monotonic Settings route progress', (tester) async {
    final progress = <double>[];
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
        onSettingsTransitionProgress: progress.add,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(ProfileAvatar));
    await tester.pump();
    expect(progress, [0]);
    await tester.pump(const Duration(milliseconds: 16));
    expect(progress.last, inExclusiveRange(0, 1));
    await tester.pump(const Duration(milliseconds: 95));
    expect(progress.last, inExclusiveRange(0, 1));
    await tester.pumpAndSettle();
    expect(progress.last, 1);
    for (var index = 1; index < progress.length; index++) {
      expect(progress[index], greaterThanOrEqualTo(progress[index - 1]));
    }

    Navigator.of(tester.element(find.text('Injected settings'))).pop();
    await tester.pump();
    final reverseStart = progress.length;
    await tester.pump(const Duration(milliseconds: 95));
    expect(progress.last, inExclusiveRange(0, 1));
    await tester.pumpAndSettle();
    expect(progress.last, 0);
    for (var index = reverseStart + 1; index < progress.length; index++) {
      expect(progress[index], lessThanOrEqualTo(progress[index - 1]));
    }
  });

  testWidgets('scales and fully fades Settings into view', (tester) async {
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(testChannels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(ProfileAvatar));
    await tester.pump();

    final transition = find.byKey(
      const ValueKey('settings-transition-opacity'),
      skipOffstage: false,
    );
    final scaleTransition = find.byKey(
      const ValueKey('settings-transition-scale'),
      skipOffstage: false,
    );
    expect(transition, findsOneWidget);
    expect(scaleTransition, findsOneWidget);
    expect(
      find.descendant(
        of: transition,
        matching: find.byKey(
          const ValueKey('settings-transition-layer'),
          skipOffstage: false,
        ),
      ),
      findsOneWidget,
    );
    expect(tester.widget<FadeTransition>(transition).opacity.value, 0);

    await tester.pump(const Duration(milliseconds: 95));
    final forwardOpacity = tester
        .widget<FadeTransition>(transition)
        .opacity
        .value;
    final forwardScale = tester
        .widget<ScaleTransition>(scaleTransition)
        .scale
        .value;
    final forwardScaleProgress = (1.04 - forwardScale) / 0.04;
    expect(
      forwardOpacity,
      closeTo(Curves.easeOutQuad.transform(95 / 150), 0.02),
    );
    expect(forwardScaleProgress, closeTo(forwardOpacity, 0.001));
    await tester.pumpAndSettle();
    expect(tester.widget<FadeTransition>(transition).opacity.value, 1);

    Navigator.of(tester.element(find.text('Injected settings'))).pop();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 95));
    final reverseOpacity = tester
        .widget<FadeTransition>(transition)
        .opacity
        .value;
    final reverseScale = tester
        .widget<ScaleTransition>(scaleTransition)
        .scale
        .value;
    final reverseScaleProgress = (1.04 - reverseScale) / 0.04;
    expect(
      reverseOpacity,
      inExclusiveRange(0, 1),
      reason: 'The complete Settings layer still fades out on exit.',
    );
    expect(reverseScaleProgress, closeTo(reverseOpacity, 0.001));
  });

  testWidgets('hides unjoined and archived channels from the main list', (
    tester,
  ) async {
    final channels = [
      ...testChannels,
      Channel(
        id: '4',
        name: 'open-stream',
        channelType: 'stream',
        visibility: 'open',
        description: 'Available to join',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 8,
        isMember: false,
      ),
      Channel(
        id: '5',
        name: 'archived-stream',
        channelType: 'stream',
        visibility: 'open',
        description: 'Archived channel',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 4,
        isMember: true,
        archivedAt: DateTime(2025, 1, 2),
      ),
    ];

    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(channels)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    // Unjoined and archived channels should not appear in the main list.
    expect(find.text('general'), findsOneWidget);
    expect(find.text('open-stream'), findsNothing);
    expect(find.text('archived-stream'), findsNothing);
  });

  testWidgets('empty state does not preview unjoined channels', (tester) async {
    final discoveredChannel = Channel(
      id: 'discovered-channel',
      name: 'community-help',
      channelType: 'stream',
      visibility: 'open',
      description: 'Get help from the community',
      createdBy: 'abc',
      createdAt: DateTime(2025),
      memberCount: 7,
    );
    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(
            () => _FakeNotifier([discoveredChannel]),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No conversations yet'), findsOneWidget);
    expect(
      find.text('Join an open channel to start a conversation.'),
      findsNothing,
    );
    expect(
      find.byKey(const Key('browse-channel-discovered-channel')),
      findsNothing,
    );
  });

  testWidgets('shows error view with retry button', (tester) async {
    await tester.pumpWidget(
      buildTestable(
        overrides: [channelsProvider.overrideWith(() => _ErrorNotifier())],
      ),
    );
    // The error view is gated on a grace timer in ChannelsPage to absorb
    // transient AsyncError frames during relay reconnect. Pump once to mount
    // and schedule the timer, advance the fake clock past the grace window,
    // then pump again to flush the setState the timer triggered.
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();

    expect(find.text('Could not load channels'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('bolds and clears unread channel labels', (tester) async {
    final channels = [
      Channel(
        id: '1',
        name: 'general',
        channelType: 'stream',
        visibility: 'open',
        description: 'General discussion',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 10,
        lastMessageAt: DateTime.fromMillisecondsSinceEpoch(
          20 * 1000,
          isUtc: true,
        ),
        isMember: true,
      ),
    ];
    final readState = _FakeReadStateNotifier(
      const ReadStateState(
        isReady: true,
        pubkey: 'pk',
        contexts: {'1': 10},
        version: 0,
      ),
    );

    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(
            () => _FakeNotifier(
              channels,
              observedEventsByChannel: {
                '1': [_observed(id: 'msg-1', createdAt: 20)],
              },
            ),
          ),
          readStateProvider.overrideWith(() => readState),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      tester.widget<Text>(find.text('general')).style?.fontWeight,
      FontWeight.w700,
    );
    expect(
      tester.widget<Text>(find.text('general')).style?.color,
      Theme.of(tester.element(find.text('general'))).colorScheme.onSurface,
    );

    readState.markContextRead('1', 20);
    await tester.pump();

    expect(
      tester.widget<Text>(find.text('general')).style?.fontWeight,
      FontWeight.w400,
    );
  });

  testWidgets('bolds channels with unread thread activity without a badge', (
    tester,
  ) async {
    final channels = [
      Channel(
        id: '1',
        name: 'general',
        channelType: 'stream',
        visibility: 'open',
        description: 'General discussion',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 10,
        lastMessageAt: DateTime.fromMillisecondsSinceEpoch(
          30 * 1000,
          isUtc: true,
        ),
        isMember: true,
      ),
    ];
    final readState = _FakeReadStateNotifier(
      const ReadStateState(
        isReady: true,
        pubkey: 'pk',
        contexts: {'1': 10},
        version: 0,
      ),
    );

    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(
            () => _FakeNotifier(
              channels,
              observedEventsByChannel: {
                '1': [
                  _observed(
                    id: 'reply-1',
                    createdAt: 20,
                    rootId: 'root',
                    isThreadedReply: true,
                  ),
                  _observed(
                    id: 'reply-2',
                    createdAt: 30,
                    rootId: 'root',
                    isThreadedReply: true,
                  ),
                ],
              },
            ),
          ),
          readStateProvider.overrideWith(() => readState),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      tester.widget<Text>(find.text('general')).style?.fontWeight,
      FontWeight.w700,
    );
  });

  testWidgets('seeds first loaded channels as read', (tester) async {
    final channels = [
      Channel(
        id: '1',
        name: 'general',
        channelType: 'stream',
        visibility: 'open',
        description: 'General discussion',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 10,
        lastMessageAt: DateTime.fromMillisecondsSinceEpoch(
          20 * 1000,
          isUtc: true,
        ),
        isMember: true,
      ),
    ];
    final readState = _FakeReadStateNotifier(
      const ReadStateState(
        isReady: true,
        pubkey: 'pk',
        contexts: {},
        version: 0,
      ),
    );

    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(channels)),
          readStateProvider.overrideWith(() => readState),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(readState.seededContexts, {'1': 20});
    expect(readState.markedContexts, isEmpty);
    expect(
      tester.widget<Text>(find.text('general')).style?.fontWeight,
      FontWeight.w400,
    );
  });

  testWidgets('waits for read-state readiness before initial seeding', (
    tester,
  ) async {
    final channels = [
      Channel(
        id: '1',
        name: 'general',
        channelType: 'stream',
        visibility: 'open',
        description: 'General discussion',
        createdBy: 'abc',
        createdAt: DateTime(2025),
        memberCount: 10,
        lastMessageAt: DateTime.fromMillisecondsSinceEpoch(
          20 * 1000,
          isUtc: true,
        ),
        isMember: true,
      ),
    ];
    final readState = _FakeReadStateNotifier(
      const ReadStateState(
        isReady: false,
        pubkey: 'pk',
        contexts: {},
        version: 0,
      ),
    );

    await tester.pumpWidget(
      buildTestable(
        overrides: [
          channelsProvider.overrideWith(() => _FakeNotifier(channels)),
          readStateProvider.overrideWith(() => readState),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(readState.seededContexts, isEmpty);
    expect(readState.markedContexts, isEmpty);

    readState.setReady();
    await tester.pumpAndSettle();

    expect(readState.seededContexts, {'1': 20});
    expect(readState.markedContexts, isEmpty);
  });
}

Widget _buildSettingsPage(BuildContext context) =>
    const Scaffold(body: Text('Injected settings'));

class _FakeNotifier extends ChannelsNotifier {
  final List<Channel> _channels;
  final Map<String, Map<String, ObservedUnreadEvent>> _observedEventsByChannel;

  _FakeNotifier(
    this._channels, {
    Map<String, List<ObservedUnreadEvent>> observedEventsByChannel = const {},
  }) : _observedEventsByChannel = {
         for (final entry in observedEventsByChannel.entries)
           entry.key: {for (final event in entry.value) event.id: event},
       };

  @override
  Future<List<Channel>> build() async => _channels;

  @override
  Map<String, int> get latestObservedByChannel => {
    for (final entry in _observedEventsByChannel.entries)
      if (entry.value.isNotEmpty)
        entry.key: entry.value.values
            .map((event) => event.createdAt)
            .reduce((left, right) => left > right ? left : right),
  };

  @override
  Map<String, Map<String, ObservedUnreadEvent>>
  get observedUnreadEventsByChannel => _observedEventsByChannel;
}

class _ErrorNotifier extends ChannelsNotifier {
  @override
  Future<List<Channel>> build() => Future.error('Connection refused');
}

class _LoadingNotifier extends ChannelsNotifier {
  @override
  Future<List<Channel>> build() => Completer<List<Channel>>().future;
}

class _ReconnectingRelaySession extends RelaySessionNotifier {
  final SessionStatus initialStatus;

  _ReconnectingRelaySession({this.initialStatus = SessionStatus.reconnecting});

  @override
  SessionState build() => SessionState(status: initialStatus);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async => [];

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async => () {};

  void connect() {
    state = const SessionState(status: SessionStatus.connected);
  }

  void setReconnecting() {
    state = const SessionState(status: SessionStatus.reconnecting);
  }
}

class _FakeReadStateNotifier extends ReadStateNotifier {
  final ReadStateState _initialState;
  final Map<String, int> seededContexts = {};
  final Map<String, int> markedContexts = {};

  _FakeReadStateNotifier(this._initialState);

  @override
  ReadStateState build() => _initialState;

  void setReady() {
    state = ReadStateState(
      isReady: true,
      pubkey: state.pubkey,
      contexts: state.contexts,
      version: state.version + 1,
      forcedUnreadContexts: state.forcedUnreadContexts,
    );
  }

  @override
  void seedContextRead(String contextId, int unixTimestamp) {
    seededContexts[contextId] = unixTimestamp;
    state = state.copyWithContext(contextId, unixTimestamp);
  }

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

ObservedUnreadEvent _observed({
  required String id,
  required int createdAt,
  String? rootId,
  bool highPriority = false,
  bool isThreadedReply = false,
}) => makeObservedUnreadEvent(
  id: id,
  createdAt: createdAt,
  rootId: rootId,
  highPriority: highPriority,
  isThreadedReply: isThreadedReply,
);

/// The channel tile (its `InkWell`) that renders [labelText] as its row
/// label.

final _sessionView = PlatformSessionView(
  humanIdentityId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Tester',
  tenantId: '00000000-0000-4000-8000-000000000002',
  tenantMembershipId: '00000000-0000-4000-8000-000000000003',
  tenantPrincipalId: '00000000-0000-4000-8000-000000000004',
  platformSessionId: '00000000-0000-4000-8000-000000000005',
);
