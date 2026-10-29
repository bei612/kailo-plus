// DD-83: the original Mobile "Invite to community" over the governed tenant.member.invite.
import 'dart:convert';

import 'package:buzz/features/invites/invite_create_page.dart';
import 'package:buzz/features/invites/invite_create_provider.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/platform/platform_test_support.dart';

const _link = 'https://kailo.test/invite#credential-shown-once';

class _Server {
  int listStatus = 200;
  String gate = 'ALLOWED';
  bool withLink = true;
  bool loseResponse = false;
  final posts = <Map<String, Object?>>[];

  Future<http.Response> respond(http.Request request) async {
    switch (request.url.path) {
      case '/api/v1/invitations':
        return listStatus == 200
            ? jsonResponse(<Object?>[])
            : jsonResponse(
                errorBody('DENIED', 'PERMISSION_DENIED'),
                listStatus,
              );
      case '/api/v1/actions':
        posts.add(jsonDecode(request.body) as Map<String, Object?>);
        if (loseResponse) {
          loseResponse = false;
          throw http.ClientException('Response lost after POST');
        }
        return jsonResponse({
          'actionExecutionId': 'execution',
          'operationId': 'operation',
          'actionKey': 'tenant.member.invite',
          'gateState': gate,
          'dispatchState': gate == 'ALLOWED' ? 'DISPATCHED' : 'NOT_DISPATCHED',
          if (gate != 'ALLOWED') 'reason': 'PERMISSION_DENIED',
          if (gate == 'ALLOWED' && withLink)
            'invitation': {
              'invitationId': '33333333-3333-4333-8333-333333333333',
              'link': _link,
              'expiresAt': '2099-01-01T00:00:00Z',
            },
        }, 202);
    }
    return http.Response('', 404);
  }
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
      nativeSessionProvider.overrideWithValue(session),
    ],
  );
  await container.read(authProvider.future);
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the entry follows the BFF answer for the invitation list', () async {
    final server = _Server();
    final container = await _start(server);
    addTearDown(container.dispose);
    expect(
      await container.read(inviteAccessProvider.future),
      InviteAccess.allowed,
    );
    server.listStatus = 403;
    container.invalidate(inviteAccessProvider);
    expect(
      await container.read(inviteAccessProvider.future),
      InviteAccess.denied,
    );
    server.listStatus = 503;
    container.invalidate(inviteAccessProvider);
    expect(
      await container.read(inviteAccessProvider.future),
      InviteAccess.unknown,
    );
  });

  test('issues one named invitation and returns its only link', () async {
    final server = _Server();
    final container = await _start(server);
    addTearDown(container.dispose);
    final actions = container.read(communityInviteActionsProvider);
    expect(await actions.issue('   '), isNull);
    expect(server.posts, isEmpty);

    final outcome = await actions.issue(' Dana ');
    expect(outcome, isA<InviteIssued>());
    final issued = outcome! as InviteIssued;
    expect(issued.label, 'Dana');
    expect(issued.invitation.link, _link);
    expect(server.posts.single['actionKey'], 'tenant.member.invite');
    expect(server.posts.single['name'], 'Dana');
    expect(server.posts.single['idempotencyKey'], isNotEmpty);
    expect(actions.retained, isNull);
  });

  test('an unknown outcome resends only the same frozen command', () async {
    final server = _Server()..loseResponse = true;
    final container = await _start(server);
    addTearDown(container.dispose);
    final actions = container.read(communityInviteActionsProvider);

    expect(await actions.issue('Dana'), isA<InviteIssueUnknown>());
    expect(actions.retained?.name, 'Dana');
    // The label of a later attempt is ignored while the first intent is unresolved.
    expect(await actions.issue('Someone else'), isA<InviteIssued>());
    expect(server.posts, hasLength(2));
    expect(server.posts[1]['name'], 'Dana');
    expect(
      server.posts[1]['idempotencyKey'],
      server.posts[0]['idempotencyKey'],
    );
    expect(actions.retained, isNull);
  });

  test('a definite refusal settles; a missing link is never invented', () async {
    final server = _Server()..gate = 'DENIED';
    final container = await _start(server);
    addTearDown(container.dispose);
    final actions = container.read(communityInviteActionsProvider);
    expect(await actions.issue('Dana'), isA<InviteIssueRejected>());
    expect(actions.retained, isNull);

    server
      ..gate = 'ALLOWED'
      ..withLink = false;
    expect(await actions.issue('Eli'), isA<InviteIssuedWithoutLink>());
    expect(
      server.posts[1]['idempotencyKey'],
      isNot(server.posts[0]['idempotencyKey']),
    );
  });

  Future<void> pumpPage(WidgetTester tester, ProviderContainer container) =>
      tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: const CommunityInvitePage(),
          ),
        ),
      );

  testWidgets('the page shows the link once after issuing it', (tester) async {
    final server = _Server();
    final container = await tester.runAsync(() => _start(server));
    addTearDown(container!.dispose);
    await pumpPage(tester, container);
    await tester.runAsync(() => container.read(inviteAccessProvider.future));
    await tester.pumpAndSettle();

    expect(find.text('Invite to community'), findsWidgets);
    final issue = find.byKey(const Key('community-invite-issue'));
    expect(tester.widget<FilledButton>(issue).onPressed, isNull);
    await tester.enterText(
      find.byKey(const Key('community-invite-label')),
      'Dana',
    );
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(issue);
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('community-invite-link')), findsOneWidget);
    expect(find.text(_link), findsOneWidget);
    expect(find.byKey(const Key('community-invite-copy-link')), findsOneWidget);
    expect(server.posts.single['name'], 'Dana');
  });

  testWidgets('a 403 shows that invite access is required', (tester) async {
    final server = _Server()..listStatus = 403;
    final container = await tester.runAsync(() => _start(server));
    addTearDown(container!.dispose);
    await pumpPage(tester, container);
    await tester.runAsync(() => container.read(inviteAccessProvider.future));
    await tester.pumpAndSettle();
    expect(find.text('Invite access required'), findsOneWidget);
    expect(find.byKey(const Key('community-invite-issue')), findsNothing);
  });
}
