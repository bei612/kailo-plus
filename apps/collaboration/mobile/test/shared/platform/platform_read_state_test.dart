import 'dart:convert';

import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_read_state.dart';
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

  Future<http.Response> call(http.Request request) async {
    final oidc = oidcRoutes(request, refreshed: 'a');
    if (oidc != null) return oidc;
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

KailoReadStateRemote _remote(_UserState core) {
  final client = MockClient(core.call);
  return KailoReadStateRemote(
    session: KailoSession(
      client: client,
      refreshStore: MemoryRefreshStore()..value = 'r',
    ),
    config: testKailoConfig,
  );
}

int _seconds(String iso) => DateTime.parse(iso).millisecondsSinceEpoch ~/ 1000;

void main() {
  test('reads positions as unix seconds', () async {
    final remote = _remote(_UserState());
    expect(await remote.fetch(), {_channel: _seconds('2026-09-24T00:00:10Z')});
  });

  test('writes with the version it read, as RFC3339', () async {
    final core = _UserState();
    final remote = _remote(core);
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
      final remote = _remote(core);
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
    final remote = _remote(core);

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
    final remote = KailoReadStateRemote(
      session: KailoSession(
        client: client,
        refreshStore: MemoryRefreshStore()..value = 'r',
      ),
      config: testKailoConfig,
    );

    await expectLater(
      remote.publish({_channel: 1}),
      throwsA(isA<KailoApiError>()),
    );
  });
}
