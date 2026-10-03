import 'package:buzz/features/channels/relay_sync_banner.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  Future<_FixedSession> pump(WidgetTester tester, SessionState initial) async {
    final session = _FixedSession(initial);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [relaySessionProvider.overrideWith(() => session)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const Scaffold(body: RelaySyncBanner()),
        ),
      ),
    );
    return session;
  }

  testWidgets('reconnecting says the view is not synced, then clears', (
    tester,
  ) async {
    final session = await pump(
      tester,
      const SessionState(status: SessionStatus.reconnecting),
    );
    final banner = find.byKey(
      const ValueKey('relay-sync-banner-nativeSyncReconnecting'),
    );
    expect(banner, findsOneWidget);
    expect(
      find.text(platformText(PlatformMessageKey.nativeSyncReconnecting)),
      findsOneWidget,
    );

    session.set(const SessionState(status: SessionStatus.connected));
    await tester.pump();
    expect(banner, findsNothing);
  });

  testWidgets('an auth rejection says the server no longer accepts us', (
    tester,
  ) async {
    await pump(
      tester,
      const SessionState(
        status: SessionStatus.disconnected,
        authRejected: true,
      ),
    );
    expect(
      find.byKey(const ValueKey('relay-sync-banner-nativeSyncRejected')),
      findsOneWidget,
    );
    expect(
      find.text(platformText(PlatformMessageKey.nativeSyncRejected)),
      findsOneWidget,
    );
  });

  testWidgets('connected shows nothing', (tester) async {
    await pump(tester, const SessionState(status: SessionStatus.connected));
    expect(find.byType(Text), findsNothing);
  });
}

class _FixedSession extends RelaySessionNotifier {
  _FixedSession(this._initial);

  final SessionState _initial;

  @override
  SessionState build() => _initial;

  void set(SessionState next) => state = next;
}
