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
  const OidcEndpoints({
    required this.authorization,
    required this.token,
    this.revocation,
  });

  final Uri authorization;
  final Uri token;

  /// RFC 7009 令牌撤销端点（RFC 8414 的 `revocation_endpoint`）。IdP 不公布时为
  /// null：此时本机无法让 IdP 作废刷新令牌，注销只能如实报告未确认。
  final Uri? revocation;
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
    final revocation = json['revocation_endpoint'];
    return OidcEndpoints(
      authorization: Uri.parse(json['authorization_endpoint'] as String),
      token: Uri.parse(json['token_endpoint'] as String),
      revocation: revocation is String ? Uri.parse(revocation) : null,
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
  var isCancelled = false;
  final cancellation = cancelled.then<OidcTokens>((_) {
    isCancelled = true;
    throw const OidcCancelled();
  });
  StreamSubscription<Uri>? subscription;
  Future<OidcTokens> authorize() async {
    final request = await AuthorizationRequest.start(
      client,
      config,
      redirectUri: redirectUri,
    );
    if (isCancelled) throw const OidcCancelled();
    final callback = Completer<Uri>();
    subscription = callbacks.listen((uri) {
      if (!callback.isCompleted && request.owns(uri)) callback.complete(uri);
    });
    await open(request.authorizeUri);
    if (isCancelled) throw const OidcCancelled();
    final uri = await callback.future;
    return request.complete(client, config, uri);
  }

  try {
    return await Future.any([authorize(), cancellation]);
  } finally {
    await subscription?.cancel();
  }
}

/// 以刷新令牌换新的访问令牌。
Future<OidcTokens> refreshOidcTokens(
  http.Client client,
  PlatformConfig config,
  String refreshToken,
) async {
  final endpoints = await discoverOidc(client, config);
  final tokens = await _tokenRequest(client, endpoints.token, {
    'grant_type': 'refresh_token',
    'refresh_token': refreshToken,
    'client_id': config.oidcClientId,
  });
  // RFC 6749 §6：只有签发新刷新令牌时才替换；省略不代表撤销旧令牌。
  return OidcTokens(
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? refreshToken,
  );
}

/// 请 IdP 作废刷新令牌（RFC 7009 §2.1，公共客户端以 `client_id` 标识自己）。
///
/// 只有 IdP 以 200 回答才算确认（§2.2：已失效的令牌同样回 200）。IdP 没有公布
/// 撤销端点、不可达或回其他状态时返回 false——调用方不得把它说成已撤销。
Future<bool> revokeRefreshToken(
  http.Client client,
  PlatformConfig config,
  String refreshToken,
) async {
  final OidcEndpoints endpoints;
  try {
    endpoints = await discoverOidc(client, config);
  } on OidcFailure {
    return false;
  }
  final revocation = endpoints.revocation;
  if (revocation == null) return false;
  try {
    final response = await client.post(
      revocation,
      body: {
        'token': refreshToken,
        'token_type_hint': 'refresh_token',
        'client_id': config.oidcClientId,
      },
    );
    return response.statusCode == 200;
  } on Exception {
    return false;
  }
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
    // 只用协议字段区分明确 invalid_grant；未知原始错误不回显。
    String error = '';
    try {
      final json = jsonDecode(response.body);
      if (json is Map && json['error'] is String) error = json['error'];
    } on FormatException {
      // 非 JSON 错误体：只报状态码
    }
    if (response.statusCode == 400 && error == 'invalid_grant') {
      throw const OidcRejected('Token grant was rejected');
    }
    throw OidcUnavailable(
      'Token endpoint returned HTTP ${response.statusCode}',
    );
  }
  try {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final accessToken = json['access_token'] as String;
    final refreshToken = json['refresh_token'] as String?;
    if (accessToken.trim().isEmpty || refreshToken?.trim().isEmpty == true) {
      throw const FormatException('Empty token');
    }
    return OidcTokens(accessToken: accessToken, refreshToken: refreshToken);
  } on Object {
    throw const OidcUnavailable('Token response is malformed');
  }
}
