import 'dart:async';
import 'dart:convert';

import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final preload in [true, false]) {
    for (final outcome in ['success', 'failure', 'community change']) {
      test(
        '${preload ? "preload" : "refresh"} waits for final bounded query: $outcome',
        () async {
          final started = Completer<void>();
          final release = Completer<void>();
          final session = _ClampingSession(
            beforeFetch: (index) async {
              if (index != 1) return;
              started.complete();
              await release.future;
              if (outcome == 'failure') throw StateError('relay unavailable');
            },
          );
          final container = ProviderContainer(
            overrides: [relaySessionProvider.overrideWith(() => session)],
          );
          addTearDown(container.dispose);
          final cache = container.read(userCacheProvider.notifier);
          final keys = List.generate(1001, (i) => 'profile-$i');
          bool? result;
          final done = (preload ? cache.preload(keys) : cache.refresh(keys))
              .then((value) => result = value);
          await started.future.timeout(const Duration(seconds: 5));
          expect(result, isNull);
          expect(container.read(userCacheProvider), hasLength(1000));
          if (outcome == 'community change') {
            container
                .read(relayConfigProvider.notifier)
                .update(baseUrl: 'https://next.invalid');
            container.read(userCacheProvider);
          }
          release.complete();
          await done;
          expect(result, outcome == 'success');
          expect(session.filters.map((f) => f.authors!.length), [1000, 1]);
          expect(session.maxRunning, 1);
          expect(
            container.read(userCacheProvider),
            hasLength(
              outcome == 'community change'
                  ? 0
                  : outcome == 'failure'
                  ? 1000
                  : 1001,
            ),
          );
        },
      );
    }
  }
}

class _ClampingSession extends RelaySessionNotifier {
  _ClampingSession({this.beforeFetch});
  final Future<void> Function(int)? beforeFetch;
  final filters = <NostrFilter>[];
  int running = 0;
  int maxRunning = 0;

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final index = filters.length;
    filters.add(filter);
    running++;
    if (running > maxRunning) maxRunning = running;
    try {
      await beforeFetch?.call(index);
      return [
        for (final key in filter.authors!.take(1000))
          NostrEvent(
            id: key,
            pubkey: key,
            createdAt: 1,
            kind: 0,
            tags: [],
            content: jsonEncode({'name': key}),
            sig: 'synthetic',
          ),
      ];
    } finally {
      running--;
    }
  }
}
