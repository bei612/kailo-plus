/// 把一次平台登录变成可用的协作连接（`DD-75`、`DD-78`、`DD-79`）。
///
/// 顺序固定：登录 IdP → 以本机设备密钥登记公钥 → 等它投影到 Relay 与 Channel
/// roster（`ACTIVE`）→ 取本 Tenant 的 Community 连接事实 → 以设备密钥直连
/// Relay。连接本身沿用上游的 Community 与 relay 会话：Community 条目里的
/// `relayUrl` 与 `nsec` 就是这里取得的 Relay 地址与设备私钥。
library;

import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'platform_api.dart';
import 'platform_config.dart';
import 'platform_device.dart';
import 'platform_display_name.dart';
import 'platform_oidc.dart';

enum PlatformLinkPhase {
  /// 还没有部署配置
  unconfigured,

  /// 已配置，未登录
  signedOut,

  /// 系统浏览器里的 IdP 登录进行中
  signingIn,

  /// 正在登记本机设备公钥
  registering,

  /// 已受理，等待投影到 Relay 与 Channel roster
  awaitingActivation,

  /// 正在取 Community 连接事实
  fetchingCommunity,

  /// Relay 连接事实已交给协作会话
  linked,

  /// 确定失败；[PlatformLinkState.error] 是可展示的契约错误，detail 仅作诊断证据
  failed,

  /// 请求发出后没有得到可判定的回应：既不是成功也不是失败
  outcomeUnknown,
}

class PlatformLinkState {
  const PlatformLinkState(
    this.phase, {
    this.error,
    this.detail,
    this.manualRecheck = false,
  });

  final PlatformLinkPhase phase;

  /// BFF 按契约给出的错误体
  final ErrorBody? error;

  /// 契约之外的说明（IdP 或网络的原话），仅作诊断证据，不进入用户界面
  final String? detail;

  /// 老服务端没有提供重查间隔时只允许用户主动确认，不猜自动重查频率。
  final bool manualRecheck;

  bool get busy => switch (phase) {
    PlatformLinkPhase.signingIn ||
    PlatformLinkPhase.registering ||
    PlatformLinkPhase.awaitingActivation ||
    PlatformLinkPhase.fetchingCommunity => true,
    _ => false,
  };
}

/// 系统浏览器与回到应用的 URI 流。端到端核验以模拟浏览器替换它。
class PlatformBrowser {
  const PlatformBrowser({
    required this.open,
    required this.callbacks,
    this.redirectUri = platformRedirectUri,
  });

  final Future<void> Function(Uri uri) open;
  final Stream<Uri> Function() callbacks;

  /// IdP 把浏览器送回应用的地址，须在 IdP 登记为该 client 的 redirect URI
  final String redirectUri;
}

final platformBrowserProvider = Provider<PlatformBrowser>(
  (ref) => PlatformBrowser(
    open: (uri) async {
      // 外部浏览器，不是内嵌 WebView：IdP 的口令页不经应用之手（RFC 8252 §8.12）
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) {
        throw const OidcUnavailable('Cannot open the system browser');
      }
    },
    callbacks: () => AppLinks().uriLinkStream,
  ),
);

class PlatformLinkNotifier extends Notifier<PlatformLinkState> {
  Completer<void>? _cancelSignIn;
  bool _cancelActivation = false;

  @override
  PlatformLinkState build() {
    final config = ref.watch(platformConfigProvider);
    return PlatformLinkState(
      config == null
          ? PlatformLinkPhase.unconfigured
          : PlatformLinkPhase.signedOut,
    );
  }

  NativeSession get _session => ref.read(nativeSessionProvider);
  DeviceKeyStore get _deviceKeys => ref.read(deviceKeyStoreProvider);

  /// 走一次完整的登录与连接。
  Future<void> signIn() async {
    final config = ref.read(platformConfigProvider);
    if (config == null || state.busy) return;
    _cancelSignIn?.complete();
    final cancel = _cancelSignIn = Completer<void>();
    _cancelActivation = false;
    state = const PlatformLinkState(PlatformLinkPhase.signingIn);
    final browser = ref.read(platformBrowserProvider);
    try {
      final tokens = await signInWithAuthorizationCode(
        client: ref.read(platformHttpClientProvider),
        config: config,
        redirectUri: browser.redirectUri,
        open: browser.open,
        callbacks: browser.callbacks(),
        cancelled: cancel.future,
      );
      await _session.adopt(tokens);
    } on OidcCancelled {
      state = const PlatformLinkState(PlatformLinkPhase.signedOut);
      return;
    } on OidcFailure catch (error) {
      state = PlatformLinkState(
        PlatformLinkPhase.failed,
        detail: error.message,
      );
      return;
    } finally {
      if (identical(_cancelSignIn, cancel)) _cancelSignIn = null;
    }
    await _link(config);
  }

  /// 放弃进行中的登录或等待。
  void cancel() {
    _cancelSignIn?.complete();
    _cancelSignIn = null;
    _cancelActivation = true;
    if (state.phase == PlatformLinkPhase.awaitingActivation &&
        state.manualRecheck) {
      state = const PlatformLinkState(PlatformLinkPhase.signedOut);
    }
  }

  /// 启动时核对：本机凭据仍在就重走一遍登记与连接事实（已 ACTIVE 的设备重复登记
  /// 只回 200，不起新的 Workflow）；凭据已不在就撤掉残留的协作连接。
  Future<void> reconcile() async {
    final config = ref.read(platformConfigProvider);
    if (config == null || (state.busy && !state.manualRecheck)) return;
    if (state.manualRecheck) {
      state = const PlatformLinkState(PlatformLinkPhase.registering);
    }
    _cancelActivation = false;
    if (!await _session.hasCredentials()) {
      await _dropCommunity();
      state = const PlatformLinkState(PlatformLinkPhase.signedOut);
      return;
    }
    await _link(config);
  }

  Future<void> _link(PlatformConfig config) async {
    try {
      final keys = await _registerUntilActive(config);
      if (keys == null) return;
      // 部署显示名只影响显示，与连接并行读取，不阻断连接（DD-111）
      unawaited(ref.read(platformDisplayNameProvider.notifier).refresh(config));
      state = const PlatformLinkState(PlatformLinkPhase.fetchingCommunity);
      final response = await _session.send(
        config,
        PlatformMethod.get,
        '/api/v1/native/community',
      );
      if (response.status != 200) {
        _fail(response);
        return;
      }
      final facts = NativeCommunityFacts.fromJson(
        response.body! as Map<String, dynamic>,
      );
      await _adoptCommunity(facts, keys);
      state = const PlatformLinkState(PlatformLinkPhase.linked);
    } on PlatformNotSignedIn {
      await _dropCommunity();
      state = const PlatformLinkState(PlatformLinkPhase.signedOut);
    } on PlatformUnavailable catch (error) {
      state = PlatformLinkState(
        PlatformLinkPhase.outcomeUnknown,
        detail: error.message,
      );
    } on PlatformApiError catch (error) {
      _fail(error.response);
    } on TypeError {
      // 回应不符合契约（缺字段、本端不认识的枚举值）：不猜它的意思
      state = const PlatformLinkState(
        PlatformLinkPhase.outcomeUnknown,
        detail: 'The platform answered outside the contract',
      );
    }
  }

  /// 登记本机设备公钥并等到 `ACTIVE`。返回可用的设备密钥；失败或被放弃时返回
  /// null，并已把原因写进状态。
  Future<nostr.Keys?> _registerUntilActive(PlatformConfig config) async {
    state = const PlatformLinkState(PlatformLinkPhase.registering);
    var keys = await ensureDeviceKeys(_deviceKeys);
    var response = await registerDeviceKey(_session, config, keys);
    if (response.error?.reason == ReasonCode.CLIENT_KEY_ALREADY_BOUND) {
      // 本机这把钥匙已被撤销（撤销的身份不复活），换一把新钥匙重新登记
      await _deviceKeys.delete();
      await _dropCommunity();
      keys = await ensureDeviceKeys(_deviceKeys);
      response = await registerDeviceKey(_session, config, keys);
    }
    if (response.status != 200 && response.status != 202) {
      _fail(response);
      return null;
    }
    var status = ClientKeyStatus.fromJson(
      response.body! as Map<String, dynamic>,
    );
    while (status.state != BuzzIdentityState.ACTIVE) {
      if (status.state != BuzzIdentityState.RECONCILING) {
        // 登记中途被撤销：这把钥匙不会再 ACTIVE
        state = PlatformLinkState(
          PlatformLinkPhase.failed,
          detail:
              'This device key is ${buzzIdentityStateValues.reverse[status.state]}',
        );
        return null;
      }
      final recheckAfterMillis = status.recheckAfterMillis;
      if (recheckAfterMillis == null || recheckAfterMillis <= 0) {
        state = const PlatformLinkState(
          PlatformLinkPhase.awaitingActivation,
          manualRecheck: true,
        );
        return null;
      }
      state = const PlatformLinkState(PlatformLinkPhase.awaitingActivation);
      await Future<void>.delayed(Duration(milliseconds: recheckAfterMillis));
      if (_cancelActivation) {
        state = const PlatformLinkState(PlatformLinkPhase.signedOut);
        return null;
      }
      final keysNow = await listDeviceKeys(_session, config);
      final mine = keysNow.where((k) => k.pubkey == keys.public).firstOrNull;
      if (mine == null) {
        state = const PlatformLinkState(
          PlatformLinkPhase.failed,
          detail: 'This device key is no longer registered',
        );
        return null;
      }
      if (mine.state == BuzzIdentityState.ACTIVE) return keys;
      status = ClientKeyStatus(
        pubkey: mine.pubkey,
        state: mine.state,
        recheckAfterMillis: recheckAfterMillis,
      );
    }
    return keys;
  }

  Future<void> _adoptCommunity(
    NativeCommunityFacts facts,
    nostr.Keys keys,
  ) async {
    final current = ref.read(authProvider).value?.community;
    if (current != null &&
        current.relayUrl == facts.relayUrl &&
        current.nsec == keys.nsec) {
      return;
    }
    await ref
        .read(authProvider.notifier)
        .authenticateWithCommunity(
          Community.create(
            name: facts.communityHost,
            relayUrl: facts.relayUrl,
            pubkey: keys.public,
            nsec: keys.nsec,
          ),
        );
  }

  void _fail(PlatformResponse response) {
    final error = response.error;
    state = error == null
        ? PlatformLinkState(
            PlatformLinkPhase.outcomeUnknown,
            detail: 'HTTP ${response.status}',
          )
        : PlatformLinkState(PlatformLinkPhase.failed, error: error);
  }

  Future<void> _dropCommunity() async {
    if (ref.read(authProvider).value?.status == AuthStatus.authenticated) {
      await ref.read(authProvider.notifier).signOut();
    }
  }

  /// 注销：先撤销 Core 的 PlatformSession，再丢弃本机令牌与协作连接。撤销未到达
  /// Core 不阻止本机丢弃——本机不再持有它才是用户要的结果；Core 侧会话按其有效期
  /// 过期。设备密钥保留：它仍是这台设备在平台的身份，下次登录直接复用。
  Future<void> signOut() async {
    cancel();
    final config = ref.read(platformConfigProvider);
    if (config != null) {
      try {
        await _session.send(config, PlatformMethod.post, '/api/v1/logout');
      } on Exception {
        // 见上：本机丢弃不以 Core 收到注销为前提
      }
    }
    await _session.discardCredentials();
    await _dropCommunity();
    state = PlatformLinkState(
      config == null
          ? PlatformLinkPhase.unconfigured
          : PlatformLinkPhase.signedOut,
    );
  }

  /// 本机设备已被撤销：它的钥匙不会再被 Relay 接受，也不能再登记。丢弃钥匙并
  /// 注销，下次登录生成新钥匙。
  Future<void> forgetRevokedDevice() async {
    await _deviceKeys.delete();
    await signOut();
  }
}

final platformLinkProvider =
    NotifierProvider<PlatformLinkNotifier, PlatformLinkState>(
      PlatformLinkNotifier.new,
    );
