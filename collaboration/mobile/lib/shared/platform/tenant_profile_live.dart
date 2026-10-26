// DD-158 / V-SCN-261: the same BFF profile watch as Web/Desktop.
import 'dart:async';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../auth/auth_provider.dart';
import '../relay/app_lifecycle_provider.dart';
import '../relay/relay_provider.dart';
import 'platform_api.dart';
import 'platform_config.dart';
import 'platform_views.dart';

/// Holds no independent profile authority. Every yielded snapshot is a fresh
/// admitted BFF read; background/disposed identities ignore late responses.
final tenantProfileLiveProvider = StreamProvider.autoDispose<TenantProfileView>((ref) async* {
  final config = ref.watch(platformConfigProvider);
  final scope = ref.watch(authProvider.select((a) => (a.value?.status, a.value?.community?.id)));
  final pubkey = ref.watch(myPubkeyProvider);
  final lifecycle = ref.watch(appLifecycleProvider);
  if (config == null || scope.$1 != AuthStatus.authenticated || pubkey == null || lifecycle != AppLifecycleState.resumed) return;
  final session = ref.read(nativeSessionProvider);
  final generation = session.credentialGeneration;
  int? version, retryMillis;
  var retired = false;
  final wake = Completer<void>();
  ref.onDispose(() { retired = true; if (!wake.isCompleted) wake.complete(); });
  while (!retired && session.credentialGeneration == generation) {
    try {
      final response = await session.send(config, PlatformMethod.get,
        '/api/v1/tenant/profile${version == null ? '' : '?afterVersion=$version'}');
      if (retired || session.credentialGeneration != generation) return;
      if (response.status == 401 || response.status == 403) return;
      if (!response.isSuccess) throw PlatformApiError(response);
      final next = TenantProfileView.fromJson(response.body! as Map<String, dynamic>);
      if (next.name.trim().isEmpty || next.version < 1 || (version != null && next.version < version)) {
        throw const FormatException('Invalid Tenant profile');
      }
      retryMillis = next.refreshAfterMillis;
      if (retryMillis != null && (retryMillis < 1 || retryMillis > 0x7fffffff)) {
        throw const FormatException('Invalid Tenant profile watch interval');
      }
      if (version != next.version) {
        ref.invalidate(platformSessionViewProvider);
        yield next;
      }
      version = next.version;
      // An older Core gives one snapshot; a foreground resume rereads it.
      if (retryMillis == null) return;
    } on PlatformNotSignedIn {
      return;
    } catch (_) {
      if (retired || retryMillis == null) return;
      await Future.any<void>([Future<void>.delayed(Duration(milliseconds: retryMillis)), wake.future]);
    }
  }
});
