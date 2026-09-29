/// 部署事实：原生入口地址、IdP issuer 与原生端 client id（Kailo `DD-78`）。
///
/// 它们因部署而异，不编进产物：首次启动由用户填写（或由管理员告知后填写），保存在
/// 本机偏好里。缺任一项即视为未配置，不回退到任何默认地址——猜一个地址就是把登录
/// 与设备密钥交给一个未经确认的服务。
library;

import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../theme/theme_provider.dart';

const _prefsKey = 'kailo.config.v1';

/// 不带展示文案的部署配置校验结论。界面从共享文案目录翻译它。
enum KailoConfigIssue {
  nativeInvalidUrl,
  issuerInvalidUrl,
  nativeInvalidScheme,
  issuerInvalidScheme,
  nativeQueryOrFragment,
  issuerQueryOrFragment,
  nativeUserInfo,
  issuerUserInfo,
  clientIdRequired,
}

class KailoConfig {
  const KailoConfig({
    required this.nativeApiUrl,
    required this.oidcIssuer,
    required this.oidcClientId,
  });

  /// 网关原生入口的根地址，例如 `https://kailo.example.com:8091`
  final String nativeApiUrl;

  /// IdP 的 issuer；discovery 文档取自 `{issuer}/.well-known/openid-configuration`
  final String oidcIssuer;

  /// 在 IdP 登记的原生端公开客户端
  final String oidcClientId;

  /// 配置无效时返回原因，有效时返回 null。
  KailoConfigIssue? validate() {
    for (final (native, value) in [(true, nativeApiUrl), (false, oidcIssuer)]) {
      final uri = Uri.tryParse(value.trim());
      if (uri == null || !uri.hasAuthority || uri.host.isEmpty) {
        return native
            ? KailoConfigIssue.nativeInvalidUrl
            : KailoConfigIssue.issuerInvalidUrl;
      }
      if (uri.scheme != 'https' && uri.scheme != 'http') {
        return native
            ? KailoConfigIssue.nativeInvalidScheme
            : KailoConfigIssue.issuerInvalidScheme;
      }
      if (uri.hasQuery || uri.hasFragment) {
        return native
            ? KailoConfigIssue.nativeQueryOrFragment
            : KailoConfigIssue.issuerQueryOrFragment;
      }
      if (uri.userInfo.isNotEmpty) {
        return native
            ? KailoConfigIssue.nativeUserInfo
            : KailoConfigIssue.issuerUserInfo;
      }
    }
    if (oidcClientId.trim().isEmpty) return KailoConfigIssue.clientIdRequired;
    return null;
  }

  /// 原生入口下某个 BFF 路径的完整地址。
  Uri apiUri(String path) {
    final base = nativeApiUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    return Uri.parse('$base$path');
  }

  /// discovery 文档地址。
  Uri get discoveryUri {
    final issuer = oidcIssuer.trim().replaceFirst(RegExp(r'/+$'), '');
    return Uri.parse('$issuer/.well-known/openid-configuration');
  }

  Map<String, dynamic> toJson() => {
    'nativeApiUrl': nativeApiUrl.trim(),
    'oidcIssuer': oidcIssuer.trim(),
    'oidcClientId': oidcClientId.trim(),
  };

  static KailoConfig? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final native = json['nativeApiUrl'];
    final issuer = json['oidcIssuer'];
    final client = json['oidcClientId'];
    if (native is! String || issuer is! String || client is! String) {
      return null;
    }
    final config = KailoConfig(
      nativeApiUrl: native,
      oidcIssuer: issuer,
      oidcClientId: client,
    );
    return config.validate() == null ? config : null;
  }

  @override
  bool operator ==(Object other) =>
      other is KailoConfig &&
      other.nativeApiUrl == nativeApiUrl &&
      other.oidcIssuer == oidcIssuer &&
      other.oidcClientId == oidcClientId;

  @override
  int get hashCode => Object.hash(nativeApiUrl, oidcIssuer, oidcClientId);
}

/// 本机保存的 Kailo 部署配置；未配置或保存的内容无效时为 null。
class KailoConfigNotifier extends Notifier<KailoConfig?> {
  @override
  KailoConfig? build() {
    final raw = ref.read(savedPrefsProvider).getString(_prefsKey);
    if (raw == null) return null;
    try {
      return KailoConfig.fromJson(jsonDecode(raw));
    } on FormatException {
      return null;
    }
  }

  /// 保存一份新配置。无效时抛出 [ArgumentError]，不写入。
  Future<void> save(KailoConfig config) async {
    final problem = config.validate();
    if (problem != null) throw ArgumentError(problem.name);
    final normalized = KailoConfig.fromJson(config.toJson())!;
    await ref
        .read(savedPrefsProvider)
        .setString(_prefsKey, jsonEncode(normalized.toJson()));
    state = normalized;
  }
}

final kailoConfigProvider = NotifierProvider<KailoConfigNotifier, KailoConfig?>(
  KailoConfigNotifier.new,
);
