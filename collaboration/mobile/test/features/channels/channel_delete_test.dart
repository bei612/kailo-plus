// DD-150 (V-SCN-247): the original Mobile deleteChannel over the governed workspace.delete.
import 'dart:convert';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_governed_actions.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/platform/platform_test_support.dart';

const _workspace = '22222222-2222-4222-8222-222222222222';

class _Server {
  String? deleteActionKey;
  String state = 'ACTIVE';
  bool loseResponse = false;
  final posts = <Map<String, Object?>>[];

  Future<http.Response> respond(http.Request request) async {
    switch (request.url.path) {
      case '/api/v1/discoverable-workspaces':
        return jsonResponse({'items': []});
      case '/api/v1/role-workspaces':
        return jsonResponse({
          'workspaces': [
            {
              'id': _workspace,
              'name': 'release-notes',
              'state': state,
              'deleteActionKey': ?deleteActionKey,
            },
          ],
        });
      case '/api/v1/actions':
        posts.add(jsonDecode(request.body) as Map<String, Object?>);
        if (loseResponse) {
          loseResponse = false;
          throw http.ClientException('Response lost after POST');
        }
        return jsonResponse({
          'actionExecutionId': 'execution',
          'operationId': 'operation',
          'actionKey': 'workspace.delete',
          'gateState': 'ALLOWED',
          'dispatchState': 'DISPATCHED',
        }, 202);
    }
    return http.Response('', 404);
  }
}

Future<ProviderContainer> _start(_Server server) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final session = NativeSession(
    client: MockClient(server.respond),
    refreshStore: MemoryRefreshStore(),
  );
  await session.adopt(
    const OidcTokens(
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
    ),
  );
  final container = ProviderContainer(
    overrides: [
      savedPrefsProvider.overrideWithValue(prefs),
      platformConfigProvider.overrideWith(_Config.new),
      authProvider.overrideWith(_Auth.new),
      currentPubkeyProvider.overrideWithValue('fixture-pubkey'),
      nativeSessionProvider.overrideWithValue(session),
      relaySessionProvider.overrideWith(_Relay.new),
      channelsProvider.overrideWith(_Channels.new),
    ],
  );
  await container.read(authProvider.future);
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the delete entry follows the role deleteActionKey', () async {
    final server = _Server();
    final container = await _start(server);
    addTearDown(container.dispose);
    final none = await container.read(
      channelManagementHintsProvider(_workspace).future,
    );
    expect(none.deleteActionKey, isNull);
    expect(none.deleting, isFalse);

    server.deleteActionKey = 'workspace.delete';
    container.invalidate(channelManagementHintsProvider(_workspace));
    final offered = await container.read(
      channelManagementHintsProvider(_workspace).future,
    );
    expect(offered.deleteActionKey, 'workspace.delete');
    expect(offered.deleting, isFalse);
  });

  test('a converging delete reads as deleting from state DELETING', () async {
    final server = _Server()..state = 'DELETING';
    final container = await _start(server);
    addTearDown(container.dispose);
    final hints = await container.read(
      channelManagementHintsProvider(_workspace).future,
    );
    expect(hints.deleting, isTrue);
    expect(hints.deleteActionKey, isNull);
  });

  test('deleteChannel submits workspace.delete with explicit confirmation '
      'and resends the same command after an unknown outcome', () async {
    final server = _Server()..loseResponse = true;
    final container = await _start(server);
    addTearDown(container.dispose);
    final actions = container.read(channelGovernedActionsProvider);

    final unknown = await actions.deleteChannel(_workspace);
    expect(unknown, isA<ChannelActionUnknown>());
    expect(actions.retained('delete:$_workspace'), isNotNull);

    final recorded = await actions.deleteChannel(_workspace);
    expect(recorded, isA<ChannelActionRecorded>());
    expect(server.posts, hasLength(2));
    expect(server.posts[1], server.posts[0]);
    expect(server.posts[0]['actionKey'], 'workspace.delete');
    expect(server.posts[0]['workspaceId'], _workspace);
    expect(server.posts[0]['explicitConfirmation'], isTrue);
    expect(actions.retained('delete:$_workspace'), isNull);
  });
}

class _Config extends PlatformConfigNotifier {
  @override
  PlatformConfig? build() => testPlatformConfig;
}

class _Auth extends AuthNotifier {
  @override
  Future<AuthState> build() async => AuthState(
    status: AuthStatus.authenticated,
    community: Community(
      id: 'fixture-tenant-community',
      name: 'Fixture',
      relayUrl: 'https://relay.test',
      addedAt: DateTime(2026),
    ),
  );
}

class _Relay extends RelaySessionNotifier {
  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);
}

class _Channels extends ChannelsNotifier {
  @override
  Future<List<Channel>> build() async => const [];
  @override
  Future<void> refresh() async => state = const AsyncData([]);
}
