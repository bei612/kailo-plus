import 'dart:convert';
import 'dart:async';

import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_read_state.dart';
import 'package:buzz/shared/read_state/read_state_manager.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'platform_test_support.dart';

const _channel = '11111111-2222-4333-8444-555555555555';

/// 模拟 Core 的 CollaborationUserState：乐观版本，版本不符回 409。
class _UserState {
  int version = 3;
  final contexts = <String, String>{_channel: '2026-09-24T00:00:10Z'};
  final puts = <Map<String, dynamic>>[];
  void Function()? beforePut;
  Map<String, Object?> actor = sessionView();

  Future<http.Response> call(http.Request request) async {
    final oidc = oidcRoutes(request, refreshed: 'a');
    if (oidc != null) return oidc;
    if (request.url.path == '/api/v1/session') return jsonResponse(actor);
    if (request.method == 'GET' && request.url.path == '/api/v1/user-state') {
      return jsonResponse({
        'workspacePreferences': <String, Object>{},
        'readContexts': contexts,
        'version': version,
      });
    }
    if (request.method == 'PUT' &&
        request.url.path == '/api/v1/user-state/read') {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      puts.add(body);
      beforePut?.call();
      beforePut = null;
      if (body['version'] != version) return jsonResponse(null, 409);
      contexts[body['contextKey'] as String] = body['lastReadAt'] as String;
      version++;
      return jsonResponse({'version': version});
    }
    return jsonResponse(null, 404);
  }
}

Future<PlatformReadStateRemote> _remote(_UserState core) async {
  final client = MockClient(core.call);
  return PlatformReadStateRemote(
    session: NativeSession(
      client: client,
      refreshStore: MemoryRefreshStore()..value = 'r',
    ),
    config: testPlatformConfig,
    actor: PlatformSessionView.fromJson(sessionView()),
    prefs: await SharedPreferences.getInstance(),
    storageScope: 'trusted-actor-tenant:self',
    isCurrent: () => true,
  );
}

int _seconds(String iso) => DateTime.parse(iso).millisecondsSinceEpoch ~/ 1000;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test('reads positions as unix seconds', () async {
    final remote = await _remote(_UserState());
    expect(await remote.fetch(), {_channel: _seconds('2026-09-24T00:00:10Z')});
  });

  test('writes with the version it read, as RFC3339', () async {
    final core = _UserState();
    final remote = await _remote(core);
    await remote.fetch();
    final at = _seconds('2026-09-24T00:01:00Z');

    final confirmed = await remote.publish({_channel: at});

    expect(confirmed, {_channel: at});
    expect(core.puts.single, {
      'contextKey': _channel,
      'lastReadAt': '2026-09-24T00:01:00.000Z',
      'version': 3,
    });
  });

  test(
    'a version conflict re-reads and rewrites only if still newer',
    () async {
      final core = _UserState();
      final remote = await _remote(core);
      await remote.fetch();
      // 另一端在这次写入之前推进到了更晚的位置
      core.beforePut = () {
        core.contexts[_channel] = '2026-09-24T00:05:00Z';
        core.version++;
      };

      final confirmed = await remote.publish({
        _channel: _seconds('2026-09-24T00:01:00Z'),
      });

      expect(core.puts, hasLength(1));
      expect(confirmed, {_channel: _seconds('2026-09-24T00:05:00Z')});
      expect(core.contexts[_channel], '2026-09-24T00:05:00Z');
    },
  );

  test('keys Core does not accept are never sent', () async {
    final core = _UserState();
    final remote = await _remote(core);

    final confirmed = await remote.publish({'thread:${'ab' * 32}': 5});

    expect(confirmed, isEmpty);
    expect(core.puts, isEmpty);
  });

  test('a refused write is an error, not a silent success', () async {
    final core = _UserState();
    final client = MockClient((request) async {
      if (request.method == 'PUT') return jsonResponse(null, 403);
      return core.call(request);
    });
    final remote = PlatformReadStateRemote(
      session: NativeSession(
        client: client,
        refreshStore: MemoryRefreshStore()..value = 'r',
      ),
      config: testPlatformConfig,
      actor: PlatformSessionView.fromJson(sessionView()),
      prefs: await SharedPreferences.getInstance(),
      storageScope: 'trusted-actor-tenant:self',
      isCurrent: () => true,
    );

    await expectLater(
      remote.publish({_channel: _seconds('2026-09-24T00:01:00Z')}),
      throwsA(isA<PlatformApiError>()),
    );
  });

  test('a changed actor cannot receive the old read intent', () async {
    final core = _UserState();
    final remote = await _remote(core);
    await remote.fetch();
    core.actor = {
      ...sessionView(),
      'tenantPrincipalId': '00000000-0000-4000-8000-000000000099',
    };
    await expectLater(
      remote.publish({_channel: _seconds('2026-09-24T00:01:00Z')}),
      throwsA(isA<PlatformUnavailable>()),
    );
    expect(core.puts, isEmpty);
  });

  test(
    'corrupt original CAS is retained and blocks read state without crashing construction',
    () async {
      final core = _UserState();
      final prefs = await SharedPreferences.getInstance();
      const key =
          'buzz.channel-read-state.request.v1:trusted-actor-tenant:self';
      const original = 'bad original CAS bytes';
      await prefs.setString(key, original);
      final remote = await _remote(core);
      final manager = ReadStateManager(
        pubkey: 'self',
        storageScope: 'trusted-actor-tenant:self',
        prefs: prefs,
        remote: remote,
        onChanged: () {},
      );
      await manager.initialize();
      expect(manager.authorityReady, isFalse);
      expect(manager.effectiveContexts, isEmpty);
      expect(
        await manager.markContextReadConfirmed(_channel, 1800000000),
        isFalse,
      );
      expect(core.puts, isEmpty);
      expect(prefs.getString(key), original);
      manager.dispose(flushPending: false);
    },
  );

  test('adopting another login fences an already constructed remote', () async {
    final core = _UserState();
    final session = NativeSession(
      client: MockClient(core.call),
      refreshStore: MemoryRefreshStore()..value = 'r',
    );
    final remote = PlatformReadStateRemote(
      session: session,
      config: testPlatformConfig,
      actor: PlatformSessionView.fromJson(sessionView()),
      prefs: await SharedPreferences.getInstance(),
      storageScope: 'trusted-actor-tenant:self',
      isCurrent: () => true,
    );
    await session.adopt(
      const OidcTokens(
        accessToken: 'new-actor-token',
        refreshToken: 'new-refresh',
      ),
    );
    await expectLater(
      remote.publish({_channel: 1800000000}),
      throwsA(isA<PlatformUnavailable>()),
    );
    expect(core.puts, isEmpty);
  });

  test(
    'a failed durable save never permits a PUT, including recheck',
    () async {
      final core = _UserState();
      final prefs = _FailingPreferences(await SharedPreferences.getInstance());
      final remote = PlatformReadStateRemote(
        session: NativeSession(
          client: MockClient(core.call),
          refreshStore: MemoryRefreshStore()..value = 'r',
        ),
        config: testPlatformConfig,
        actor: PlatformSessionView.fromJson(sessionView()),
        prefs: prefs,
        storageScope: 'trusted-actor-tenant:self',
        isCurrent: () => true,
      );
      final at = _seconds('2026-09-24T00:01:00Z');
      await expectLater(
        remote.publish({_channel: at}),
        throwsA(isA<PlatformUnavailable>()),
      );
      await expectLater(
        remote.publish({_channel: at}),
        throwsA(isA<PlatformUnavailable>()),
      );
      expect(core.puts, isEmpty);
      expect(remote.pendingContextId, isNull);
    },
  );

  test(
    'a 200 without authoritative cursor advancement is not confirmation',
    () async {
      final core = _UserState();
      final remote = PlatformReadStateRemote(
        session: NativeSession(
          client: MockClient((request) async {
            if (request.method == 'PUT') {
              return jsonResponse({'version': core.version + 1});
            }
            return core.call(request);
          }),
          refreshStore: MemoryRefreshStore()..value = 'r',
        ),
        config: testPlatformConfig,
        actor: PlatformSessionView.fromJson(sessionView()),
        prefs: await SharedPreferences.getInstance(),
        storageScope: 'trusted-actor-tenant:self',
        isCurrent: () => true,
      );
      expect(
        await remote.publish({_channel: _seconds('2026-09-24T00:01:00Z')}),
        isEmpty,
      );
      expect(remote.pendingContextId, _channel);
    },
  );

  test(
    'UNKNOWN recheck repeats exact CAS bytes; a refusal cannot erase it',
    () async {
      final core = _UserState();
      final puts = <String>[];
      var unknown = true;
      final client = MockClient((request) async {
        if (request.method == 'PUT') {
          puts.add(request.body);
          if (unknown) throw const PlatformUnavailable('Response lost');
          return jsonResponse(null, 403);
        }
        return core.call(request);
      });
      final prefs = await SharedPreferences.getInstance();
      PlatformReadStateRemote create() => PlatformReadStateRemote(
        session: NativeSession(
          client: client,
          refreshStore: MemoryRefreshStore()..value = 'r',
        ),
        config: testPlatformConfig,
        actor: PlatformSessionView.fromJson(sessionView()),
        prefs: prefs,
        storageScope: 'trusted-actor-tenant:self',
        isCurrent: () => true,
      );
      final at = _seconds('2026-09-24T00:01:00Z');
      await expectLater(
        create().publish({_channel: at}),
        throwsA(isA<PlatformUnavailable>()),
      );
      unknown = false;
      final restored = create();
      await expectLater(
        restored.publish({_channel: at}),
        throwsA(isA<PlatformApiError>()),
      );
      expect(puts, hasLength(2));
      expect(puts[1], puts[0]);
      expect(restored.pendingContextId, _channel);
      expect(
        prefs.getKeys().where((key) => key.contains('.request.v1:')),
        hasLength(1),
      );
      core.version++;
      await restored.fetch();
      expect(restored.pendingContextId, isNull);
    },
  );

  test(
    'an in-flight response after disposal cannot become confirmed',
    () async {
      final core = _UserState();
      final waiting = Completer<void>();
      final started = Completer<void>();
      var current = true;
      final client = MockClient((request) async {
        if (request.method == 'PUT') {
          started.complete();
          await waiting.future;
        }
        return core.call(request);
      });
      final remote = PlatformReadStateRemote(
        session: NativeSession(
          client: client,
          refreshStore: MemoryRefreshStore()..value = 'r',
        ),
        config: testPlatformConfig,
        actor: PlatformSessionView.fromJson(sessionView()),
        prefs: await SharedPreferences.getInstance(),
        storageScope: 'trusted-actor-tenant:self',
        isCurrent: () => current,
      );
      final result = remote.publish({
        _channel: _seconds('2026-09-24T00:01:00Z'),
      });
      final assertion = expectLater(
        result,
        throwsA(isA<PlatformUnavailable>()),
      );
      await started.future;
      current = false;
      waiting.complete();
      await assertion;
      expect(remote.pendingContextId, _channel);
    },
  );
}

class _FailingPreferences extends Fake implements SharedPreferences {
  _FailingPreferences(this.inner);
  final SharedPreferences inner;
  @override
  String? getString(String key) => inner.getString(key);
  @override
  Future<bool> setString(String key, String value) async => false;
  @override
  Future<bool> remove(String key) => inner.remove(key);
}
