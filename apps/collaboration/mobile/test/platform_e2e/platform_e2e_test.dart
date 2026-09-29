// Buzz Mobile 的平台接入端到端核验，对运行中的平台本地拓扑执行。
//
// 走的是应用自己的代码：PlatformLinkNotifier 登录（PKCE、state、换令牌）、设备登记
// 与等待 ACTIVE、取 Community 连接事实并交给协作会话；随后由上游的 relay 会话以
// 设备私钥直连 Relay（NIP-42），用 channelsProvider 读出所在 Channel，用
// sendMessageProvider 发消息。唯一的替身是浏览器：一个按 IdP 登录表单作答的模拟
// 浏览器，代替用户在系统浏览器里的操作。
//
// 需要一个真实 Workspace（其成员是 PLATFORM_E2E_USER），由本仓库的
// core/verify/mobile-e2e.sh 准备并传入环境变量；没有这些变量时整组跳过。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/channels/send_message_provider.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_device.dart';
import 'package:buzz/shared/platform/platform_link.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../shared/community/community_storage_test.dart';
import '../shared/platform/platform_test_support.dart';

String? _env(String name) => Platform.environment[name];

/// 模拟用户在浏览器里的操作：打开授权页，按登录表单填入口令，读出 IdP 把浏览器
/// 送回应用的地址。cookie 手工携带：只有这一个站点、两次请求。
Future<Uri> _browse(Uri authorize, String user, String password) async {
  final client = HttpClient();
  try {
    final page = await client.getUrl(authorize);
    page.followRedirects = false;
    final pageResponse = await page.close();
    final cookies = pageResponse.cookies;
    final html = await pageResponse.transform(utf8.decoder).join();
    final action = RegExp(
      r'action="([^"]+)"',
    ).firstMatch(html)!.group(1)!.replaceAll('&amp;', '&');
    final login = await client.postUrl(Uri.parse(action));
    login.followRedirects = false;
    login.cookies.addAll(cookies);
    login.headers.contentType = ContentType(
      'application',
      'x-www-form-urlencoded',
    );
    login.write(
      'username=${Uri.encodeQueryComponent(user)}'
      '&password=${Uri.encodeQueryComponent(password)}',
    );
    final back = await login.close();
    await back.drain<void>();
    final location = back.headers.value(HttpHeaders.locationHeader);
    expect(location, isNotNull, reason: '登录后应重定向回应用');
    return Uri.parse(location!);
  } finally {
    client.close(force: true);
  }
}

Future<T> _within<T>(Future<T> future, Duration bound, String what) =>
    future.timeout(bound, onTimeout: () => fail('$what 未在 $bound 内完成'));

void main() {
  final native = _env('PLATFORM_E2E_NATIVE_URL');
  final skip = native == null ? '端到端核验：需要运行中的本地拓扑与真实 Workspace，见文件头' : null;

  test(
    'mobile signs in, registers its device, and publishes through the relay',
    () async {
      final config = PlatformConfig(
        nativeApiUrl: native!,
        oidcIssuer: _env('PLATFORM_E2E_OIDC_ISSUER')!,
        oidcClientId: _env('PLATFORM_E2E_CLIENT_ID')!,
      );
      final user = _env('PLATFORM_E2E_USER')!;
      final password = File(
        _env('PLATFORM_E2E_PASSWORD_FILE')!,
      ).readAsStringSync().trim();
      final workspace = _env('PLATFORM_E2E_WORKSPACE')!;
      final bound = Duration(
        seconds: int.parse(_env('PLATFORM_E2E_CONVERGE_SECS')!),
      );

      SharedPreferences.setMockInitialValues({
        'platform.config.v1': jsonEncode(config.toJson()),
      });
      final prefs = await SharedPreferences.getInstance();
      final callbacks = StreamController<Uri>.broadcast();
      addTearDown(callbacks.close);
      final keys = MemoryDeviceKeyStore();
      final container = ProviderContainer(
        overrides: [
          savedPrefsProvider.overrideWithValue(prefs),
          deviceKeyStoreProvider.overrideWithValue(keys),
          nativeSessionProvider.overrideWith(
            (ref) => NativeSession(
              client: ref.watch(platformHttpClientProvider),
              refreshStore: MemoryRefreshStore(),
            ),
          ),
          communityStorageProvider.overrideWithValue(
            CommunityStorage(secure: FakeSecureStorage()),
          ),
          platformBrowserProvider.overrideWithValue(
            PlatformBrowser(
              // 本地 IdP 为原生 client 登记的是回环地址；redirect 只是 IdP 送回
              // 浏览器的去处，其余 PKCE 与换令牌走的是应用同一份代码
              redirectUri: 'http://127.0.0.1:1/callback',
              open: (uri) async =>
                  callbacks.add(await _browse(uri, user, password)),
              callbacks: () => callbacks.stream,
            ),
          ),
        ],
      );
      addTearDown(container.dispose);
      final link = container.read(platformLinkProvider.notifier);
      final session = container.read(nativeSessionProvider);

      // 1. 登录 → 设备登记 → ACTIVE → Community 连接事实 → 协作会话
      await _within(link.signIn(), bound, '登录与设备登记');
      final linked = container.read(platformLinkProvider);
      expect(
        linked.phase,
        PlatformLinkPhase.linked,
        reason: '${linked.error?.reason} ${linked.detail}',
      );
      final device = nostr.Keys(keys.nsec!);
      final auth = await container.read(authProvider.future);
      expect(auth.community?.nsec, device.nsec);
      final relayHost = Uri.parse(auth.community!.relayUrl).authority;
      expect(
        relayHost,
        auth.community!.name,
        reason: 'Relay 地址的 authority 就是 Community host',
      );

      // 2. 上游的 relay 会话以设备私钥直连 Relay（NIP-42）
      final connected = Completer<void>();
      final sub = container.listen(relaySessionProvider, (_, next) {
        if (next.status == SessionStatus.connected && !connected.isCompleted) {
          connected.complete();
        }
      }, fireImmediately: true);
      addTearDown(sub.close);
      await _within(connected.future, bound, 'Relay 连接');

      // 3. 设备所在的 Channel（Workspace id 即 Channel id）
      final channels = await _within(
        container.read(channelsProvider.future),
        bound,
        '读 Channel',
      );
      expect(channels.map((c) => c.id), contains(workspace));

      // 4. 以设备私钥发一条消息：Relay 接受
      final text = 'from platform mobile ${const Uuid().v4()}';
      await _within(
        container
            .read(sendMessageProvider)
            .call(
              channelId: workspace,
              content: text,
              mentionPubkeys: const [],
            ),
        bound,
        '发消息',
      );
      final relay = container.read(relaySessionProvider.notifier);
      final echoed = await relay.fetchHistory(
        NostrFilter(
          kinds: const [EventKind.streamMessage],
          authors: [device.public],
          tags: {
            '#h': [workspace],
          },
          limit: 10,
        ),
      );
      expect(echoed.map((e) => e.content), contains(text));

      // 5. 直连不等于能治理：自建 Channel 被 Relay 拒绝（DD-80）
      final signer = SignedEventRelay(session: relay, nsec: device.nsec);
      await expectLater(
        signer.submit(
          kind: 9007,
          content: '',
          tags: [
            ['h', const Uuid().v4()],
            ['name', 'rogue'],
            ['visibility', 'private'],
          ],
        ),
        throwsA(anything),
        reason: '设备不得自建 Channel',
      );

      // 6. 撤销本设备：Relay 随后拒绝它
      final revoked = await revokeDeviceKey(session, config, device.public);
      expect(revoked.status, 202, reason: '${revoked.body}');
      final deadline = DateTime.now().add(bound);
      while ((await listDeviceKeys(
        session,
        config,
      )).any((k) => k.pubkey == device.public)) {
        expect(DateTime.now().isBefore(deadline), isTrue, reason: '撤销未收敛');
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
      await expectLater(
        signer.submit(
          kind: EventKind.streamMessage,
          content: 'after revocation',
          tags: [
            ['h', workspace],
          ],
        ),
        throwsA(anything),
        reason: '撤销后 Relay 必须拒绝这台设备',
      );

      // 7. 注销
      await link.signOut();
      expect(await session.hasCredentials(), isFalse);
    },
    skip: skip,
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
