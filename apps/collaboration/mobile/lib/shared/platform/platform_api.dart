/// 令牌的持有与管理平面调用（Kailo `DD-78`）。
///
/// 刷新令牌存系统安全存储（Keychain / Android Keystore 支撑的
/// `flutter_secure_storage`，与设备身份同一处），访问令牌只在内存。不按到期时间
/// 提前刷新——那要一个拍脑袋的提前量；而是在 BFF 回 401 时刷新一次并重试一次，
/// 两次都不行即判为需要重新登录。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../contracts/contracts.dart';
import 'kailo_config.dart';
import 'kailo_oidc.dart';

/// 可经本模块调用的 BFF 路径前缀。其余一概不发。
const kailoApiPrefix = '/api/v1/';

/// 刷新令牌的存放处。应用里是系统安全存储；无界面的端到端核验里是内存。
abstract interface class RefreshTokenStore {
  Future<String?> load();
  Future<void> store(String value);
  Future<void> delete();
}

/// 系统安全存储。写入失败时登录随之失败——不退而把长期凭据写成普通文件。
class SecureRefreshTokenStore implements RefreshTokenStore {
  SecureRefreshTokenStore({FlutterSecureStorage? secure})
    : _secure = secure ?? const FlutterSecureStorage();

  static const _key = 'kailo_refresh_token';
  final FlutterSecureStorage _secure;

  @override
  Future<String?> load() => _secure.read(key: _key);

  @override
  Future<void> store(String value) => _secure.write(key: _key, value: value);

  @override
  Future<void> delete() => _secure.delete(key: _key);
}

/// 本机没有可用的 Kailo 登录：从未登录、已注销，或 IdP 拒绝了刷新令牌。
class KailoNotSignedIn implements Exception {
  const KailoNotSignedIn();

  @override
  String toString() => 'Sign in to Kailo again';
}

/// Kailo 服务暂时不可达：请求没有得到任何回应，结果不明。
class KailoUnavailable implements Exception {
  const KailoUnavailable(this.message);
  final String message;

  @override
  String toString() => message;
}

/// BFF 的一次回应。错误体按契约解读，不在这里重新解释。
class KailoResponse {
  const KailoResponse(this.status, this.body);

  final int status;

  /// 解析后的 JSON；无正文时为 null
  final Object? body;

  bool get isSuccess => status >= 200 && status < 300;

  /// 按契约解析的错误体。非错误回应、无错误体或错误体不符合契约（例如出现本端
  /// 尚不认识的 reason code）时为 null——调用方据此把结果当作「不可判定」，而
  /// 不是成功或某个具体失败。
  ErrorBody? get error {
    if (isSuccess) return null;
    final body = this.body;
    if (body is! Map<String, dynamic>) return null;
    try {
      return ErrorBody.fromJson(body);
    } on Object {
      return null;
    }
  }
}

/// BFF 回了非预期的状态。[response] 的错误体按契约解读。
class KailoApiError implements Exception {
  const KailoApiError(this.response);
  final KailoResponse response;

  @override
  String toString() {
    final error = response.error;
    return error == null
        ? 'HTTP ${response.status}'
        : '${reasonCodeValues.reverse[error.reason]}（HTTP ${response.status}）';
  }
}

enum KailoMethod { get, post, put, delete }

class KailoSession {
  KailoSession({
    required http.Client client,
    required RefreshTokenStore refreshStore,
  }) : _client = client,
       _refreshStore = refreshStore;

  final http.Client _client;
  final RefreshTokenStore _refreshStore;
  String? _accessToken;
  Future<String>? _refreshing;

  /// 采用一次登录或刷新得到的令牌。刷新令牌是长期凭据：没有它，下次启动就得
  /// 重新登录；有它却存不进安全存储，就不能假装已经持久登录。
  Future<void> adopt(OidcTokens tokens) async {
    final refresh = tokens.refreshToken;
    if (refresh != null) {
      await _refreshStore.store(refresh);
    } else {
      await _refreshStore.delete();
    }
    _accessToken = tokens.accessToken;
  }

  /// 本机持有刷新令牌。它是否仍被 IdP 接受，要到下一次调用才知道。
  Future<bool> hasCredentials() async => await _refreshStore.load() != null;

  Future<void> discardCredentials() async {
    _accessToken = null;
    await _refreshStore.delete();
  }

  Future<String> _refresh(KailoConfig config) {
    // 并发的 401 共用同一次刷新：刷新令牌可能是一次性的，两次并发刷新会让
    // 后一次因令牌已被消费而被判为需要重新登录
    return _refreshing ??= () async {
      try {
        final refreshToken = await _refreshStore.load();
        if (refreshToken == null) throw const KailoNotSignedIn();
        final OidcTokens tokens;
        try {
          tokens = await refreshOidcTokens(_client, config, refreshToken);
        } on OidcRejected {
          // 刷新令牌被 IdP 拒绝（过期、撤销、会话已结束）：只能重新登录
          await discardCredentials();
          throw const KailoNotSignedIn();
        } on OidcUnavailable catch (error) {
          // IdP 暂不可达：凭据留着，稍后再试
          throw KailoUnavailable(error.message);
        }
        await adopt(tokens);
        return tokens.accessToken;
      } finally {
        _refreshing = null;
      }
    }();
  }

  /// 以 Bearer 调用一个 BFF 路径。401 时刷新一次并重试一次。
  Future<KailoResponse> send(
    KailoConfig config,
    KailoMethod method,
    String path, {
    Object? body,
  }) async {
    if (!path.startsWith(kailoApiPrefix) || path.contains('..')) {
      throw ArgumentError.value(
        path,
        'path',
        'only paths under $kailoApiPrefix are sent',
      );
    }
    final uri = config.apiUri(path);
    var token = _accessToken ?? await _refresh(config);
    for (var attempt = 0; attempt < 2; attempt++) {
      final request = http.Request(method.name.toUpperCase(), uri)
        ..headers['Authorization'] = 'Bearer $token'
        ..headers['Accept'] = 'application/json';
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      final http.Response response;
      try {
        response = await http.Response.fromStream(await _client.send(request));
      } on Exception catch (error) {
        throw KailoUnavailable('Kailo is unreachable: $error');
      }
      if (response.statusCode == 401) {
        if (attempt == 0) {
          token = await _refresh(config);
          continue;
        }
        await discardCredentials();
        throw const KailoNotSignedIn();
      }
      return KailoResponse(response.statusCode, _decode(response));
    }
    throw const KailoNotSignedIn();
  }

  static Object? _decode(http.Response response) {
    if (response.bodyBytes.isEmpty) return null;
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      return null;
    }
  }
}

final kailoHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final kailoSessionProvider = Provider<KailoSession>(
  (ref) => KailoSession(
    client: ref.watch(kailoHttpClientProvider),
    refreshStore: SecureRefreshTokenStore(),
  ),
);
