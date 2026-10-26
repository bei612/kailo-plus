/// DD-151(1)(6): this device's push registration with Core.
///
/// The token never leaves the device except in the one registration request to Core (which
/// writes it to the Tenant's OpenBao and keeps only a digest). The request carries a NIP-98
/// proof signed by this device's CLIENT key and bound to the current PlatformSession, the same
/// shape as the device-key registration (`platform_device.dart`). The switch is this device's
/// preference under version CAS: a stale version is re-read, never overwritten blindly.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:package_info_plus/package_info_plus.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../auth/auth_provider.dart';
import '../relay/relay_provider.dart';
import '../platform/platform_api.dart';
import '../platform/platform_config.dart';
import '../platform/platform_device.dart';
import '../platform/platform_locale.dart';
import '../deeplink/pending_deep_link_provider.dart';
import 'push_bridge.dart';

const pushRegistrationPath = '/api/v1/push/registration';
const pushCapabilityPath = '/api/v1/push/capability';

/// How long to wait for APNs to hand back a token after asking for one.
const _tokenTimeout = Duration(seconds: 20);

enum PushRegistrationOutcome { none, saving, failed, notConfirmed }

@immutable
class DevicePushState {
  const DevicePushState({
    this.loading = true,
    this.available = false,
    this.devicePubkey,
    this.enabled = false,
    this.registrationState,
    this.version = 0,
    this.outcome = PushRegistrationOutcome.none,
  });

  final bool loading;

  /// The deployment configured APNs credentials (DD-151(2)).
  final bool available;
  final String? devicePubkey;
  final bool enabled;

  /// ACTIVE, INVALID or REVOKED as Core reports it; null before the first registration.
  final String? registrationState;
  final int version;
  final PushRegistrationOutcome outcome;

  bool get effectiveEnabled => enabled && registrationState == 'ACTIVE';

  DevicePushState copyWith({
    bool? loading,
    bool? available,
    String? devicePubkey,
    bool? enabled,
    String? registrationState,
    int? version,
    PushRegistrationOutcome? outcome,
  }) => DevicePushState(
    loading: loading ?? this.loading,
    available: available ?? this.available,
    devicePubkey: devicePubkey ?? this.devicePubkey,
    enabled: enabled ?? this.enabled,
    registrationState: registrationState ?? this.registrationState,
    version: version ?? this.version,
    outcome: outcome ?? this.outcome,
  );
}

/// Everything the controller needs from outside, replaceable in tests.
class PushRegistrationDeps {
  const PushRegistrationDeps({
    required this.send,
    required this.deviceKeys,
    required this.appId,
    required this.apiUri,
    required this.locale,
  });

  final Future<PlatformResponse> Function(
    PlatformMethod method,
    String path, {
    Object? body,
  })
  send;
  final Future<nostr.Keys> Function() deviceKeys;
  final Future<String> Function() appId;
  final Uri Function(String path) apiUri;

  /// `en` or `zh-CN`: the language of the fixed system text Core sends.
  final String Function() locale;
}

final pushRegistrationDepsProvider = Provider<PushRegistrationDeps?>((ref) {
  final config = ref.watch(platformConfigProvider);
  final identity = ref.watch(
    authProvider.select((a) => (a.value?.status, a.value?.community?.id)),
  );
  final pubkey = ref.watch(myPubkeyProvider);
  if (config == null ||
      identity.$1 != AuthStatus.authenticated ||
      pubkey == null) {
    return null;
  }
  final session = ref.read(nativeSessionProvider);
  return PushRegistrationDeps(
    send: (method, path, {body}) =>
        session.send(config, method, path, body: body),
    deviceKeys: () => ensureDeviceKeys(ref.read(deviceKeyStoreProvider)),
    appId: () async => (await PackageInfo.fromPlatform()).packageName,
    apiUri: config.apiUri,
    locale: () =>
        platformLocale(
              locale: ref.read(platformLocaleProvider).toLanguageTag(),
            ) ==
            'en'
        ? 'en'
        : 'zh-CN',
  );
});

class PushRegistrationNotifier extends Notifier<DevicePushState> {
  String? _lastToken;

  @override
  DevicePushState build() {
    _lastToken = null;
    final deps = ref.watch(pushRegistrationDepsProvider);
    if (deps == null) {
      return const DevicePushState(loading: false);
    }
    unawaited(_load(deps));
    return const DevicePushState();
  }

  bool _current(PushRegistrationDeps deps) =>
      ref.mounted && identical(ref.read(pushRegistrationDepsProvider), deps);

  Future<void> _load(PushRegistrationDeps deps) async {
    try {
      final capability = await deps.send(
        PlatformMethod.get,
        pushCapabilityPath,
      );
      if (!_current(deps)) return;
      final available =
          capability.status == 200 &&
          PushCapability.fromJson(
                capability.body! as Map<String, dynamic>,
              ).apns ==
              PushAvailability.CONFIGURED;
      final keys = await deps.deviceKeys();
      if (!_current(deps)) return;
      final device = keys.public;
      final current = await deps.send(
        PlatformMethod.get,
        '$pushRegistrationPath?devicePubkey=$device',
      );
      if (!_current(deps)) return;
      var next = state.copyWith(
        loading: false,
        available: available,
        devicePubkey: device,
      );
      if (current.status == 200) {
        final view = PushRegistrationView.fromJson(
          current.body! as Map<String, dynamic>,
        );
        next = next.copyWith(
          enabled: view.enabled,
          registrationState: view.state.name,
          version: view.version,
        );
      }
      state = next;
    } catch (error) {
      debugPrint('push: registration read failed: $error');
      if (_current(deps)) state = state.copyWith(loading: false);
    }
  }

  /// Re-read capability and this device's registration (after a conflict or on resume).
  Future<void> refresh() async {
    if (!ref.mounted) return;
    final deps = ref.read(pushRegistrationDepsProvider);
    if (deps != null) await _load(deps);
  }

  /// Turn notifications on or off for this device. Turning on asks iOS for permission and
  /// APNs for a token first; the token is sent once, to Core, with the device-key proof.
  Future<void> setEnabled(bool enabled) async {
    final deps = ref.read(pushRegistrationDepsProvider);
    if (deps == null ||
        !state.available ||
        state.outcome == PushRegistrationOutcome.saving) {
      return;
    }
    state = state.copyWith(outcome: PushRegistrationOutcome.saving);
    final bridge = ref.read(pushBridgeProvider);
    final String token;
    try {
      final next = bridge.tokens.first.timeout(_tokenTimeout);
      await bridge.startRegistration();
      token = await next;
    } catch (_) {
      if (_current(deps)) {
        state = state.copyWith(outcome: PushRegistrationOutcome.failed);
      }
      return;
    }
    if (!_current(deps)) return;
    await _put(deps, token: token, enabled: enabled);
  }

  /// APNs may rotate the token; re-register the same switch state with the new one.
  Future<void> tokenChanged(String token) async {
    final deps = ref.read(pushRegistrationDepsProvider);
    if (deps == null ||
        !state.available ||
        state.registrationState == null ||
        state.outcome == PushRegistrationOutcome.saving ||
        token == _lastToken) {
      return;
    }
    await _put(deps, token: token, enabled: state.enabled);
  }

  Future<void> _put(
    PushRegistrationDeps deps, {
    required String token,
    required bool enabled,
  }) async {
    if (!_current(deps)) return;
    final version = state.version;
    try {
      final current = await deps.send(PlatformMethod.get, '/api/v1/session');
      if (!_current(deps)) return;
      if (current.status != 200) {
        state = state.copyWith(outcome: PushRegistrationOutcome.failed);
        return;
      }
      final session = PlatformSessionView.fromJson(
        current.body! as Map<String, dynamic>,
      );
      final keys = await deps.deviceKeys();
      if (!_current(deps)) return;
      final proof = nostr.Event.from(
        kind: 27235,
        content: '',
        tags: [
          ['u', deps.apiUri(pushRegistrationPath).toString()],
          ['method', 'PUT'],
          ['session', session.platformSessionId],
        ],
        secretKey: keys.secret,
      );
      final appId = await deps.appId();
      if (!_current(deps)) return;
      final response = await deps.send(
        PlatformMethod.put,
        pushRegistrationPath,
        body: {
          'proof': proof.toMap(),
          'platform': 'APNS',
          'appId': appId,
          'token': token,
          'locale': deps.locale(),
          'enabled': enabled,
          'expectedVersion': version,
        },
      );
      if (!_current(deps)) return;
      if (response.status == 200) {
        final view = PushRegistrationView.fromJson(
          response.body! as Map<String, dynamic>,
        );
        _lastToken = token;
        state = state.copyWith(
          enabled: view.enabled,
          registrationState: view.state.name,
          version: view.version,
          devicePubkey: view.devicePubkey,
          outcome: PushRegistrationOutcome.none,
        );
        return;
      }
      if (response.status == 409) {
        // Another write of this device's preference won: read it back, do not overwrite.
        await refresh();
      }
      if (_current(deps)) {
        state = state.copyWith(outcome: PushRegistrationOutcome.failed);
      }
    } catch (_) {
      // Transport loss: the write may or may not have landed. Re-read before any retry.
      if (!_current(deps)) return;
      state = state.copyWith(outcome: PushRegistrationOutcome.notConfirmed);
      unawaited(refresh());
    }
  }
}

final pushRegistrationProvider =
    NotifierProvider<PushRegistrationNotifier, DevicePushState>(
      PushRegistrationNotifier.new,
    );

/// Keeps an enabled registration's APNs token current: on launch it asks APNs again (tokens
/// can change across restores and reinstalls) and re-registers a changed token.
final pushTokenRefreshProvider = Provider<void>((ref) {
  final bridge = ref.watch(pushBridgeProvider);
  final subscription = bridge.tokens.listen(
    (token) => unawaited(
      ref.read(pushRegistrationProvider.notifier).tokenChanged(token),
    ),
  );
  ref.onDispose(subscription.cancel);
  var asked = false;
  ref.listen<DevicePushState>(pushRegistrationProvider, (_, next) {
    if (!asked && !next.loading && next.available && next.effectiveEnabled) {
      asked = true;
      unawaited(bridge.startRegistration());
    }
  }, fireImmediately: true);
});

/// Notification taps (warm and cold start) go into the existing deep-link pipeline.
final pushNavigationProvider = Provider<void>((ref) {
  final bridge = ref.watch(pushBridgeProvider);
  final links = ref.read(pendingDeepLinkProvider.notifier);
  final subscription = bridge.opened.listen(links.openLink);
  ref.onDispose(subscription.cancel);
  unawaited(
    bridge.takePendingOpen().then((link) {
      if (link != null) links.openLink(link);
    }),
  );
});
