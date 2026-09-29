/// RFC 8252 原生应用登录：系统浏览器、私有 URI scheme 回调、PKCE S256 与 `state`。
///
/// 移动端不用回环地址：RFC 8252 §7.3 的回环重定向是给桌面的，移动系统上别的应用
/// 同样能监听本机端口。这里用 §7.1 的私有 scheme，由 PKCE（§8.1）防止被抢注
/// scheme 的应用拿授权码换令牌。授权页在系统浏览器里打开，不经内嵌 WebView。
///
/// 登录不设超时：用户在 IdP 上可能要花任意长的时间（多因素、找口令）。取而代之的是
/// 可取消——调用方随时可以放弃这次等待。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:pointycastle/digests/sha256.dart';

import 'platform_config.dart';

/// 私有 URI scheme 回调地址。scheme 同时登记在 Android 的 intent-filter 与 iOS 的
/// `CFBundleURLTypes` 里，并须作为原生端 client 的 redirect URI 登记在 IdP。
const platformRedirectUri = 'xyz.block.buzz.mobile:/platform/oauth2redirect';

/// 令牌请求的失败分两种，对调用方意义相反：IdP 明确拒绝（刷新令牌过期或被撤销，
/// 只能重新登录）与 IdP 暂不可达（稍后再试，不能因此丢掉凭据）。
sealed class OidcFailure implements Exception {
  const OidcFailure(this.message);
  final String message;

  @override
  String toString() => message;
}

class OidcRejected extends OidcFailure {
  const OidcRejected(super.message);
}

class OidcUnavailable extends OidcFailure {
  const OidcUnavailable(super.message);
}

/// 用户取消了这次登录，或新的一次登录顶替了它。
class OidcCancelled extends OidcFailure {
  const OidcCancelled() : super('Sign-in was cancelled');
}

class OidcTokens {
  const OidcTokens({required this.accessToken, this.refreshToken});

  final String accessToken;
  final String? refreshToken;
}

class OidcEndpoints {
  const OidcEndpoints({required this.authorization, required this.token});

  final Uri authorization;
  final Uri token;
}

Future<OidcEndpoints> discoverOidc(
  http.Client client,
  PlatformConfig config,
) async {
  final http.Response response;
  try {
    response = await client.get(config.discoveryUri);
  } on Exception catch (error) {
    throw OidcUnavailable('Cannot reach the identity provider: $error');
  }
  if (response.statusCode != 200) {
    throw OidcUnavailable(
      'Identity provider discovery returned HTTP ${response.statusCode}',
    );
  }
  try {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return OidcEndpoints(
      authorization: Uri.parse(json['authorization_endpoint'] as String),
      token: Uri.parse(json['token_endpoint'] as String),
    );
  } on Object {
    throw const OidcUnavailable(
      'Identity provider discovery document is malformed',
    );
  }
}

String _randomUrlSafe(int bytes) {
  final random = Random.secure();
  final data = Uint8List.fromList(
    List<int>.generate(bytes, (_) => random.nextInt(256)),
  );
  return base64Url.encode(data).replaceAll('=', '');
}

/// PKCE：verifier 为 32 字节随机数的 base64url，challenge 为其 SHA-256 的 base64url
/// （RFC 7636 §4.2 的 S256）。
({String verifier, String challenge}) generatePkce() {
  final verifier = _randomUrlSafe(32);
  return (verifier: verifier, challenge: pkceChallenge(verifier));
}

String pkceChallenge(String verifier) {
  final digest = SHA256Digest().process(
    Uint8List.fromList(ascii.encode(verifier)),
  );
  return base64Url.encode(digest).replaceAll('=', '');
}

/// 一次进行中的授权码登录：授权地址已生成，等待 IdP 把浏览器重定向回来。
class AuthorizationRequest {
  AuthorizationRequest._({
    required this.authorizeUri,
    required this.redirectUri,
    required String state,
    required String verifier,
    required OidcEndpoints endpoints,
  }) : _state = state,
       _verifier = verifier,
       _endpoints = endpoints;

  /// 交给系统浏览器打开的授权地址
  final Uri authorizeUri;
  final Uri redirectUri;
  final String _state;
  final String _verifier;
  final OidcEndpoints _endpoints;

  static Future<AuthorizationRequest> start(
    http.Client client,
    PlatformConfig config, {
    required String redirectUri,
  }) async {
    final endpoints = await discoverOidc(client, config);
    final pkce = generatePkce();
    final state = _randomUrlSafe(16);
    final authorize = endpoints.authorization.replace(
      queryParameters: {
        ...endpoints.authorization.queryParameters,
        'response_type': 'code',
        'client_id': config.oidcClientId,
        'redirect_uri': redirectUri,
        'scope': 'openid',
        'state': state,
        'code_challenge': pkce.challenge,
        'code_challenge_method': 'S256',
      },
    );
    return AuthorizationRequest._(
      authorizeUri: authorize,
      redirectUri: Uri.parse(redirectUri),
      state: state,
      verifier: pkce.verifier,
      endpoints: endpoints,
    );
  }

  /// 这个回调是否属于本次登录：同一个回调地址且 `state` 相符。不属于的回调
  /// 不消费，继续等真正的那一次。
  bool owns(Uri callback) =>
      callback.scheme == redirectUri.scheme &&
      callback.host == redirectUri.host &&
      callback.path == redirectUri.path &&
      callback.queryParameters['state'] == _state;

  /// 以回调里的授权码换取令牌。
  Future<OidcTokens> complete(
    http.Client client,
    PlatformConfig config,
    Uri callback,
  ) async {
    final code = callback.queryParameters['code'];
    if (code == null || code.isEmpty) {
      final error =
          callback.queryParameters['error_description'] ??
          callback.queryParameters['error'] ??
          'The identity provider returned no authorization code';
      throw OidcRejected(error);
    }
    return _tokenRequest(client, _endpoints.token, {
      'grant_type': 'authorization_code',
      'code': code,
      'redirect_uri': redirectUri.toString(),
      'client_id': config.oidcClientId,
      'code_verifier': _verifier,
    });
  }
}

/// 走完一次授权码登录。
///
/// [open] 把授权地址交给用户的浏览器：应用里是系统浏览器，端到端核验里是一个
/// 按 IdP 登录表单作答的模拟浏览器。[callbacks] 是回到应用的 URI 流。其余一切
/// ——PKCE、state、换取令牌——两者走同一份代码。[cancelled] 完成即放弃等待。
Future<OidcTokens> signInWithAuthorizationCode({
  required http.Client client,
  required PlatformConfig config,
  required String redirectUri,
  required Future<void> Function(Uri authorizeUri) open,
  required Stream<Uri> callbacks,
  required Future<void> cancelled,
}) async {
  final request = await AuthorizationRequest.start(
    client,
    config,
    redirectUri: redirectUri,
  );
  final callback = Completer<Uri>();
  final subscription = callbacks.listen((uri) {
    if (!callback.isCompleted && request.owns(uri)) callback.complete(uri);
  });
  unawaited(
    cancelled.then((_) {
      if (!callback.isCompleted) {
        callback.completeError(const OidcCancelled());
      }
    }),
  );
  try {
    await open(request.authorizeUri);
    final uri = await callback.future;
    return await request.complete(client, config, uri);
  } finally {
    await subscription.cancel();
  }
}

/// 以刷新令牌换新的访问令牌。
Future<OidcTokens> refreshOidcTokens(
  http.Client client,
  PlatformConfig config,
  String refreshToken,
) async {
  final endpoints = await discoverOidc(client, config);
  return _tokenRequest(client, endpoints.token, {
    'grant_type': 'refresh_token',
    'refresh_token': refreshToken,
    'client_id': config.oidcClientId,
  });
}

Future<OidcTokens> _tokenRequest(
  http.Client client,
  Uri endpoint,
  Map<String, String> form,
) async {
  final http.Response response;
  try {
    response = await client.post(endpoint, body: form);
  } on Exception catch (error) {
    throw OidcUnavailable('Token endpoint unreachable: $error');
  }
  if (response.statusCode != 200) {
    // 错误体可能含 IdP 的诊断文本，但不含令牌；只取 error 字段
    String error = '';
    try {
      final json = jsonDecode(response.body);
      if (json is Map && json['error'] is String) error = json['error'];
    } on FormatException {
      // 非 JSON 错误体：只报状态码
    }
    final message = 'Token endpoint returned HTTP ${response.statusCode} $error'
        .trim();
    // 4xx 是 IdP 的判定（invalid_grant 等）；5xx 是它暂时不可用
    if (response.statusCode >= 400 && response.statusCode < 500) {
      throw OidcRejected(message);
    }
    throw OidcUnavailable(message);
  }
  try {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return OidcTokens(
      accessToken: json['access_token'] as String,
      refreshToken: json['refresh_token'] as String?,
    );
  } on Object {
    throw const OidcUnavailable('Token response is malformed');
  }
}
