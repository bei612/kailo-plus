/// 令牌的持有与管理平面调用（`DD-78`）。
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

import 'package:client_kit/shared/contracts/contracts.dart';
import 'platform_config.dart';
import 'platform_oidc.dart';

/// 可经本模块调用的 BFF 路径前缀。其余一概不发。
const platformApiPrefix = '/api/v1/';

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

  static const _key = 'platform_refresh_token';
  final FlutterSecureStorage _secure;

  @override
  Future<String?> load() => _secure.read(key: _key);

  @override
  Future<void> store(String value) => _secure.write(key: _key, value: value);

  @override
  Future<void> delete() => _secure.delete(key: _key);
}

/// 本机没有可用的平台登录：从未登录、已注销，或 IdP 拒绝了刷新令牌。
class PlatformNotSignedIn implements Exception {
  const PlatformNotSignedIn();

  @override
  String toString() => 'Sign in again';
}

/// 平台服务暂时不可达：请求没有得到任何回应，结果不明。
class PlatformUnavailable implements Exception {
  const PlatformUnavailable(this.message);
  final String message;

  @override
  String toString() => message;
}

/// BFF 的一次回应。错误体按契约解读，不在这里重新解释。
class PlatformResponse {
  const PlatformResponse(this.status, this.body);

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
class PlatformApiError implements Exception {
  const PlatformApiError(this.response);
  final PlatformResponse response;

  @override
  String toString() {
    final error = response.error;
    return error == null
        ? 'HTTP ${response.status}'
        : '${reasonCodeValues.reverse[error.reason]}（HTTP ${response.status}）';
  }
}

enum PlatformMethod { get, post, put, delete }

/// 一次注销在服务端的结果。仅本机凭据清理成功后返回；这里只回答服务端是否确认。
class PlatformSignOutReport {
  const PlatformSignOutReport({
    required this.coreSessionRevoked,
    required this.refreshTokenRevoked,
  });

  /// Core 以契约 200 回答了 `POST /api/v1/logout`（含幂等撤销结果）
  final bool coreSessionRevoked;

  /// IdP 以 200 回答了刷新令牌撤销（RFC 7009），或本机本就没有刷新令牌
  final bool refreshTokenRevoked;

  bool get confirmed => coreSessionRevoked && refreshTokenRevoked;
}

class NativeSession {
  NativeSession({
    required http.Client client,
    required RefreshTokenStore refreshStore,
  }) : _client = client,
       _refreshStore = refreshStore;

  final http.Client _client;
  final RefreshTokenStore _refreshStore;
  String? _accessToken;
  Future<String>? _refreshing;
  int _generation = 0;
  Future<void> _credentialWrite = Future<void>.value();

  void _requireCurrent(int generation) {
    if (generation != _generation) {
      // 旧请求不代表当前登录失效，调用方不得据此清除新会话。
      throw const PlatformUnavailable('The platform session changed');
    }
  }

  // 安全存储写入也异步：删除排在旧写入之后，旧刷新不能复活已退出的会话。
  Future<void> _writeCredentials(Future<void> Function() write) {
    final pending = _credentialWrite.then((_) => write());
    _credentialWrite = pending.then<void>((_) {}, onError: (Object _) {});
    return pending;
  }

  /// 采用一次登录或刷新得到的令牌。刷新令牌是长期凭据：没有它，下次启动就得
  /// 重新登录；有它却存不进安全存储，就不能假装已经持久登录。
  Future<void> adopt(OidcTokens tokens) async {
    final generation = ++_generation;
    _refreshing = null;
    _accessToken = null;
    await _adopt(tokens, generation);
  }

  Future<void> _adopt(OidcTokens tokens, int generation) =>
      _writeCredentials(() async {
        _requireCurrent(generation);
        final refresh = tokens.refreshToken;
        if (refresh != null) {
          await _refreshStore.store(refresh);
        } else {
          await _refreshStore.delete();
        }
        _requireCurrent(generation);
        _accessToken = tokens.accessToken;
      });

  /// 本机持有刷新令牌。它是否仍被 IdP 接受，要到下一次调用才知道。
  Future<bool> hasCredentials() async => await _refreshStore.load() != null;

  /// 结束本机的平台登录（SS-AGW-OIDC 的原生部分）：先快照并丢弃本机凭据，
  /// 再仅以该快照撤销 Core 的 PlatformSession 与 IdP 刷新令牌。后续登录不受
  /// 旧注销请求影响；返回服务端两步是否都得到确认。
  Future<PlatformSignOutReport> endSession(PlatformConfig config) async {
    final refreshInFlight = _refreshing != null;
    var accessToken = _accessToken;
    String? refreshToken;
    _generation++;
    _refreshing = null;
    _accessToken = null;
    await _writeCredentials(() async {
      try {
        refreshToken = await _refreshStore.load();
      } finally {
        await _refreshStore.delete();
      }
    });
    var coreSessionRevoked = false;
    try {
      if (accessToken == null && refreshToken != null) {
        final tokens = await refreshOidcTokens(_client, config, refreshToken!);
        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
      }
      if (accessToken != null) {
        var response = await _request(
          config,
          PlatformMethod.post,
          '/api/v1/logout',
          accessToken,
        );
        if (response.status == 401 && refreshToken != null) {
          final tokens = await refreshOidcTokens(
            _client,
            config,
            refreshToken!,
          );
          refreshToken = tokens.refreshToken;
          response = await _request(
            config,
            PlatformMethod.post,
            '/api/v1/logout',
            tokens.accessToken,
          );
        }
        coreSessionRevoked =
            response.status == 200 &&
            response.body is Map<String, dynamic> &&
            (response.body! as Map<String, dynamic>)['revoked'] is bool;
      }
    } on OidcFailure {
      // 旧会话的刷新或注销没有确认；绝不触碰并发建立的新会话。
    } on PlatformUnavailable {
      // Core 未确认，仍继续撤销快照里的旧刷新令牌。
    }
    final refreshTokenRevoked = refreshToken == null
        ? true
        : await revokeRefreshToken(_client, config, refreshToken!);
    return PlatformSignOutReport(
      coreSessionRevoked: coreSessionRevoked,
      // 在途刷新可能已轮换，旧令牌的 200 撤销不能确认该未知新令牌也已撤销。
      refreshTokenRevoked: refreshTokenRevoked && !refreshInFlight,
    );
  }

  Future<void> discardCredentials() async {
    _generation++;
    _refreshing = null;
    _accessToken = null;
    await _writeCredentials(_refreshStore.delete);
  }

  Future<String> _refresh(PlatformConfig config) {
    // 并发的 401 共用同一次刷新：刷新令牌可能是一次性的，两次并发刷新会让
    // 后一次因令牌已被消费而被判为需要重新登录
    if (_refreshing != null) return _refreshing!;
    final generation = _generation;
    late final Future<String> refreshing;
    refreshing = () async {
      try {
        final refreshToken = await _refreshStore.load();
        _requireCurrent(generation);
        if (refreshToken == null) throw const PlatformNotSignedIn();
        final OidcTokens tokens;
        try {
          tokens = await refreshOidcTokens(_client, config, refreshToken);
        } on OidcRejected {
          // 刷新令牌被 IdP 拒绝（过期、撤销、会话已结束）：只能重新登录
          _requireCurrent(generation);
          await discardCredentials();
          throw const PlatformNotSignedIn();
        } on OidcUnavailable catch (error) {
          // IdP 暂不可达：凭据留着，稍后再试
          _requireCurrent(generation);
          throw PlatformUnavailable(error.message);
        }
        await _adopt(tokens, generation);
        return tokens.accessToken;
      } finally {
        if (identical(_refreshing, refreshing)) _refreshing = null;
      }
    }();
    return _refreshing = refreshing;
  }

  /// 以 Bearer 调用一个 BFF 路径。401 时刷新一次并重试一次。
  Future<PlatformResponse> send(
    PlatformConfig config,
    PlatformMethod method,
    String path, {
    Object? body,
  }) async {
    if (!path.startsWith(platformApiPrefix) || path.contains('..')) {
      throw ArgumentError.value(
        path,
        'path',
        'only paths under $platformApiPrefix are sent',
      );
    }
    final generation = _generation;
    var token = _accessToken ?? await _refresh(config);
    for (var attempt = 0; attempt < 2; attempt++) {
      _requireCurrent(generation);
      final response = await _request(config, method, path, token, body: body);
      _requireCurrent(generation);
      if (response.status == 401) {
        if (attempt == 0) {
          token = await _refresh(config);
          continue;
        }
        await discardCredentials();
        throw const PlatformNotSignedIn();
      }
      return response;
    }
    throw const PlatformNotSignedIn();
  }

  Future<PlatformResponse> _request(
    PlatformConfig config,
    PlatformMethod method,
    String path,
    String token, {
    Object? body,
  }) async {
    final request = http.Request(method.name.toUpperCase(), config.apiUri(path))
      ..headers['Authorization'] = 'Bearer $token'
      ..headers['Accept'] = 'application/json';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final response = await http.Response.fromStream(
        await _client.send(request),
      );
      return PlatformResponse(response.statusCode, _decode(response));
    } on Exception catch (error) {
      throw PlatformUnavailable('The platform is unreachable: $error');
    }
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

final platformHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final nativeSessionProvider = Provider<NativeSession>(
  (ref) => NativeSession(
    client: ref.watch(platformHttpClientProvider),
    refreshStore: SecureRefreshTokenStore(),
  ),
);
