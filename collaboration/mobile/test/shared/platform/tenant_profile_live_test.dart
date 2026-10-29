import 'dart:async';

import 'package:buzz/shared/auth/auth_provider.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/platform/tenant_profile_live.dart';
import 'package:buzz/shared/relay/app_lifecycle_provider.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'platform_test_support.dart';

class _Auth extends AuthNotifier {
  @override
  Future<AuthState> build() async => AuthState(
    status: AuthStatus.authenticated,
    community: Community(
      id: 'community',
      name: 'Stored old name',
      relayUrl: 'wss://relay.test',
      addedAt: DateTime(2026),
    ),
  );
}

class _Config extends PlatformConfigNotifier {
  @override
  PlatformConfig? build() => testPlatformConfig;
}

class _Lifecycle extends AppLifecycleNotifier {
  final events = StreamController<void>.broadcast();
  @override
  Stream<void> get networkRestored => events.stream;
  @override
  AppLifecycleState build() {
    ref.onDispose(events.close);
    return AppLifecycleState.resumed;
  }

  void pause() {
    state = AppLifecycleState.paused;
  }

  void resume() {
    state = AppLifecycleState.resumed;
  }
}

Future<({ProviderContainer container, _Lifecycle lifecycle})> harness(
  Future<http.Response> Function(http.Request) respond,
) async {
  final native = NativeSession(
    client: MockClient(respond),
    refreshStore: MemoryRefreshStore(),
  );
  await native.adopt(const OidcTokens(accessToken: 'fixture-access'));
  final lifecycle = _Lifecycle();
  final container = ProviderContainer(
    overrides: [
      nativeSessionProvider.overrideWithValue(native),
      authProvider.overrideWith(_Auth.new),
      platformConfigProvider.overrideWith(_Config.new),
      myPubkeyProvider.overrideWithValue('a' * 64),
      appLifecycleProvider.overrideWith(() => lifecycle),
    ],
  );
  await container.read(authProvider.future);
  addTearDown(container.dispose);
  return (container: container, lifecycle: lifecycle);
}

void main() {
  test(
    'native BFF watch updates another session without copying its credentials or old profile',
    () async {
      final pending = Completer<http.Response>(),
          started = Completer<void>(),
          updated = Completer<void>();
      final paths = <String>[];
      final h = await harness((request) async {
        expect(request.headers['Authorization'], 'Bearer fixture-access');
        paths.add(
          request.url.path +
              (request.url.hasQuery ? '?${request.url.query}' : ''),
        );
        if (paths.length == 1) {
          return jsonResponse({
            'name': 'Before',
            'version': 3,
            'icon': '🎉',
            'refreshAfterMillis': 10,
          });
        }
        if (paths.length == 2) {
          started.complete();
          return pending.future;
        }
        return Completer<http.Response>().future;
      });
      h.container.listen(tenantProfileLiveProvider, (_, next) {
        if (next.value?.version == 4 && !updated.isCompleted) {
          updated.complete();
        }
      });
      expect(
        (await h.container.read(tenantProfileLiveProvider.future))?.name,
        'Before',
      );
      await started.future.timeout(const Duration(seconds: 5));
      expect(paths[1], '/api/v1/tenant/profile?afterVersion=3');
      pending.complete(
        jsonResponse({'name': 'After', 'version': 4, 'refreshAfterMillis': 10}),
      );
      await updated.future.timeout(const Duration(seconds: 5));
      expect(h.container.read(tenantProfileLiveProvider).value?.name, 'After');
      expect(h.container.read(tenantProfileLiveProvider).value?.icon, isNull);
    },
  );

  test(
    'backgrounding rejects a late BFF answer and foreground resume rereads the profile',
    () async {
      final late = Completer<http.Response>(), waiting = Completer<void>();
      var calls = 0;
      final h = await harness((request) async {
        calls++;
        if (calls == 1) {
          return jsonResponse({
            'name': 'Before',
            'version': 1,
            'refreshAfterMillis': 10,
          });
        }
        if (calls == 2) {
          waiting.complete();
          return late.future;
        }
        return jsonResponse({'name': 'Fresh foreground', 'version': 2});
      });
      h.container.listen(tenantProfileLiveProvider, (_, _) {});
      await h.container.read(tenantProfileLiveProvider.future);
      await waiting.future.timeout(const Duration(seconds: 5));
      h.lifecycle.pause();
      await h.container.pump();
      late.complete(
        jsonResponse({
          'name': 'Stale background',
          'version': 2,
          'refreshAfterMillis': 10,
        }),
      );
      await h.container.pump();
      expect(
        h.container
            .read(tenantProfileLiveProvider)
            .unwrapPrevious()
            .value
            ?.name,
        isNot('Stale background'),
      );
      h.lifecycle.resume();
      await h.container.pump();
      expect(
        (await h.container.read(tenantProfileLiveProvider.future))?.name,
        'Fresh foreground',
      );
      expect(calls, 3);
    },
  );

  test(
    'the original connectivity source recovers an initial unavailable profile without an invented poll',
    () async {
      var calls = 0;
      final h = await harness((request) async {
        calls++;
        if (calls == 1) throw http.ClientException('offline');
        return jsonResponse({'name': 'Recovered', 'version': 5});
      });
      h.container.listen(tenantProfileLiveProvider, (_, _) {});
      for (var n = 0; n < 10; n++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(calls, 1);
      h.lifecycle.events.add(null);
      await Future<void>.delayed(Duration.zero);
      await h.container.pump();
      expect(
        (await h.container.read(tenantProfileLiveProvider.future))?.name,
        'Recovered',
      );
      expect(calls, 2);
    },
  );
  test(
    'a terminal profile denial clears the previous admitted profile',
    () async {
      var calls = 0;
      final refused = Completer<void>();
      final h = await harness((request) async {
        calls++;
        if (calls == 1) {
          return jsonResponse({
            'name': 'Previously visible',
            'version': 1,
            'refreshAfterMillis': 10,
          });
        }
        refused.complete();
        return jsonResponse(null, 403);
      });
      h.container.listen(tenantProfileLiveProvider, (_, _) {});
      await h.container.read(tenantProfileLiveProvider.future);
      await refused.future.timeout(const Duration(seconds: 5));
      for (var n = 0; n < 20; n++) {
        await Future<void>.delayed(Duration.zero);
      }
      await h.container.pump();
      expect(
        h.container.read(tenantProfileLiveProvider).unwrapPrevious().value,
        isNull,
      );
      expect(calls, 2);
    },
  );

  test(
    'an expired login clears the old profile without retrying the denied session',
    () async {
      var calls = 0;
      final denied = Completer<void>();
      final h = await harness((request) async {
        calls++;
        if (calls == 1) {
          return jsonResponse({
            'name': 'Before expiry',
            'version': 1,
            'refreshAfterMillis': 10,
          });
        }
        denied.complete();
        return jsonResponse(null, 401);
      });
      h.container.listen(tenantProfileLiveProvider, (_, _) {});
      await h.container.read(tenantProfileLiveProvider.future);
      await denied.future.timeout(const Duration(seconds: 5));
      for (var n = 0; n < 20; n++) {
        await Future<void>.delayed(Duration.zero);
      }
      await h.container.pump();
      expect(
        h.container.read(tenantProfileLiveProvider).unwrapPrevious().value,
        isNull,
      );
      expect(calls, 2);
    },
  );

  test(
    'an adopted login fences the late old watch and removes its previous snapshot',
    () async {
      var calls = 0;
      final started = Completer<void>();
      final late = Completer<http.Response>();
      final h = await harness((request) async {
        calls++;
        if (calls == 1) {
          return jsonResponse({
            'name': 'Old login',
            'version': 1,
            'refreshAfterMillis': 10,
          });
        }
        started.complete();
        return late.future;
      });
      h.container.listen(tenantProfileLiveProvider, (_, _) {});
      await h.container.read(tenantProfileLiveProvider.future);
      await started.future.timeout(const Duration(seconds: 5));
      await h.container
          .read(nativeSessionProvider)
          .adopt(const OidcTokens(accessToken: 'replacement-access'));
      late.complete(
        jsonResponse({
          'name': 'Late old identity',
          'version': 2,
          'refreshAfterMillis': 10,
        }),
      );
      for (var n = 0; n < 20; n++) {
        await Future<void>.delayed(Duration.zero);
      }
      await h.container.pump();
      expect(
        h.container.read(tenantProfileLiveProvider).unwrapPrevious().value,
        isNull,
      );
      expect(calls, 2);
    },
  );
}
