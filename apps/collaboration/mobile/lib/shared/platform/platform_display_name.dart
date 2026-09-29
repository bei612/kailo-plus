/// 部署的显示名（`DD-111`）。
///
/// 界面上的产品名只来自部署配置，经 BFF 的公开平台信息下发；应用里不写产品名。
/// 选定服务器并登录之前没有可读的部署，只显示中性文案；登录后经原生入口读取，按
/// 服务器（原生入口地址）缓存，此后在该服务器的登录页也显示缓存值。缓存键只由
/// 服务器决定，换服务器不会把上一台服务器的名字带过来。
library;

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../theme/theme_provider.dart';
import 'platform_api.dart';
import 'platform_config.dart';

String _prefsKey(PlatformConfig config) =>
    'platform.display-name:${config.nativeApiUrl}';

class PlatformDisplayNameNotifier extends Notifier<String?> {
  @override
  String? build() {
    final config = ref.watch(platformConfigProvider);
    if (config == null) return null;
    final cached = ref
        .read(savedPrefsProvider)
        .getString(_prefsKey(config))
        ?.trim();
    return cached == null || cached.isEmpty ? null : cached;
  }

  /// 已登录时读一次并缓存。它只影响显示：读不到或回应不符合契约时保留此前的
  /// 缓存值，不阻断连接，也不猜一个名字。
  Future<void> refresh(PlatformConfig config) async {
    final String name;
    try {
      final response = await ref
          .read(nativeSessionProvider)
          .send(config, PlatformMethod.get, '/api/v1/platform-info');
      if (response.status != 200) return;
      name = PlatformInfo.fromJson(
        response.body! as Map<String, dynamic>,
      ).displayName.trim();
    } on Exception {
      return;
    } on TypeError {
      return;
    }
    if (name.isEmpty || ref.read(platformConfigProvider) != config) return;
    await ref.read(savedPrefsProvider).setString(_prefsKey(config), name);
    state = name;
  }
}

final platformDisplayNameProvider =
    NotifierProvider<PlatformDisplayNameNotifier, String?>(
      PlatformDisplayNameNotifier.new,
    );
