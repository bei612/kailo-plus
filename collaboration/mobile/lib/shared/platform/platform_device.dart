/// 本机设备身份与其公钥登记（`DD-77`、`DD-79`）。
///
/// 每台原生设备有自己的一把 Nostr 密钥，私钥只在本机系统安全存储里，协作数据平面
/// 以它签名直连 Relay（`DD-75`）。登记时以同一把私钥签一份绑定当前
/// PlatformSession 的 NIP-98 持钥证明：截获的证明不能在别人的会话里重放。
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;

import 'package:client_kit/shared/contracts/contracts.dart';
import 'platform_api.dart';
import 'platform_config.dart';

/// 设备登记端点。持钥证明的 `u` 标签必须指向它。
const platformRegisterPath = '/api/v1/identity/client-keys';

/// NIP-98 HTTP Auth 事件
const _nip98Kind = 27235;

/// 设备私钥的存放处。应用里是系统安全存储；无界面的端到端核验里是内存。
abstract interface class DeviceKeyStore {
  /// bech32 `nsec`；本机尚无设备密钥时为 null
  Future<String?> load();
  Future<void> store(String nsec);
  Future<void> delete();
}

class SecureDeviceKeyStore implements DeviceKeyStore {
  SecureDeviceKeyStore({FlutterSecureStorage? secure})
    : _secure = secure ?? const FlutterSecureStorage();

  static const _key = 'platform_device_nsec';
  final FlutterSecureStorage _secure;

  @override
  Future<String?> load() => _secure.read(key: _key);

  @override
  Future<void> store(String nsec) => _secure.write(key: _key, value: nsec);

  @override
  Future<void> delete() => _secure.delete(key: _key);
}

/// 本机的设备密钥；没有就生成一把并存入安全存储。存不进去即失败——不持有一把
/// 下次启动就找不回来的钥匙去登记。
Future<nostr.Keys> ensureDeviceKeys(DeviceKeyStore store) async {
  final existing = await store.load();
  if (existing != null) return nostr.Keys(existing);
  final keys = nostr.Keys.generate();
  await store.store(keys.nsec);
  return keys;
}

/// 以 [keys] 登记设备公钥：取当前会话、以该私钥签持钥证明、提交。
///
/// 返回 BFF 的原样回应；取会话失败时返回那次回应，不继续签名。
Future<PlatformResponse> registerDeviceKey(
  NativeSession session,
  PlatformConfig config,
  nostr.Keys keys,
) async {
  final current = await session.send(
    config,
    PlatformMethod.get,
    '/api/v1/session',
  );
  if (current.status != 200) return current;
  final view = PlatformSessionView.fromJson(
    current.body! as Map<String, dynamic>,
  );
  final proof = nostr.Event.from(
    kind: _nip98Kind,
    content: '',
    tags: [
      ['u', config.apiUri(platformRegisterPath).toString()],
      ['method', 'POST'],
      ['session', view.platformSessionId],
    ],
    secretKey: keys.secret,
  );
  return session.send(
    config,
    PlatformMethod.post,
    platformRegisterPath,
    body: {'proof': proof.toMap()},
  );
}

/// 本人登记过且未撤销的设备。
Future<List<ClientKeyView>> listDeviceKeys(
  NativeSession session,
  PlatformConfig config,
) async {
  final response = await session.send(
    config,
    PlatformMethod.get,
    platformRegisterPath,
  );
  if (response.status != 200) throw PlatformApiError(response);
  return [
    for (final item in response.body! as List<dynamic>)
      ClientKeyView.fromJson(item as Map<String, dynamic>),
  ];
}

/// 撤销本人的一台设备。只移出这一把公钥，此人的其他设备与 Web 不受影响。
Future<PlatformResponse> revokeDeviceKey(
  NativeSession session,
  PlatformConfig config,
  String pubkey,
) => session.send(
  config,
  PlatformMethod.delete,
  '$platformRegisterPath/$pubkey',
);

final deviceKeyStoreProvider = Provider<DeviceKeyStore>(
  (ref) => SecureDeviceKeyStore(),
);
