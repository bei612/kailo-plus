import 'dart:convert';

import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_device.dart';
import 'package:http/http.dart' as http;

/// 测试用部署配置。地址只是测试夹具，不是任何默认值。
const testPlatformConfig = PlatformConfig(
  nativeApiUrl: 'https://platform.test:8443',
  oidcIssuer: 'https://idp.test/realms/platform',
  oidcClientId: 'platform-native',
);

class MemoryRefreshStore implements RefreshTokenStore {
  String? value;

  @override
  Future<void> delete() async => value = null;

  @override
  Future<String?> load() async => value;

  @override
  Future<void> store(String v) async => value = v;
}

class MemoryDeviceKeyStore implements DeviceKeyStore {
  String? nsec;

  @override
  Future<void> delete() async => nsec = null;

  @override
  Future<String?> load() async => nsec;

  @override
  Future<void> store(String value) async => nsec = value;
}

http.Response jsonResponse(Object? body, [int status = 200]) => http.Response(
  body == null ? '' : jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, Object?> errorBody(String klass, String reason) => {
  'class': klass,
  'reason': reason,
};

/// discovery 文档与令牌端点，所有 OIDC 测试共用。
http.Response? oidcRoutes(http.Request request, {required String refreshed}) {
  final path = request.url.path;
  if (path.endsWith('/.well-known/openid-configuration')) {
    return jsonResponse({
      'authorization_endpoint': 'https://idp.test/realms/platform/auth',
      'token_endpoint': 'https://idp.test/realms/platform/token',
    });
  }
  if (path.endsWith('/token')) {
    return jsonResponse({
      'access_token': refreshed,
      'refresh_token': 'refresh-2',
    });
  }
  return null;
}

Map<String, Object?> sessionView() => {
  'humanIdentityId': '00000000-0000-4000-8000-000000000001',
  'displayName': 'Tester',
  'tenantId': '00000000-0000-4000-8000-000000000002',
  'tenantMembershipId': '00000000-0000-4000-8000-000000000003',
  'tenantPrincipalId': '00000000-0000-4000-8000-000000000004',
  'platformSessionId': '00000000-0000-4000-8000-000000000005',
};
