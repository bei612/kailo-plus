// DD-158: session Tenant read and the existing ActionCommand admission endpoint.
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../shared/auth/auth_provider.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/relay/relay_provider.dart';

typedef TenantProfileSender =
    Future<PlatformResponse> Function(
      PlatformMethod method,
      String path, {
      Map<String, dynamic>? body,
    });
final tenantProfileControllerProvider = Provider<TenantProfileController>((
  ref,
) {
  final config = ref.watch(platformConfigProvider);
  final scope = ref.watch(
    authProvider.select((a) => (a.value?.status, a.value?.community?.id)),
  );
  final pubkey = ref.watch(myPubkeyProvider);
  final session = ref.read(nativeSessionProvider);
  final controller = TenantProfileController(
    config != null && scope.$1 == AuthStatus.authenticated && pubkey != null
        ? (method, path, {body}) =>
              session.send(config, method, path, body: body)
        : null,
    onSaved: () {
      if (ref.mounted) {
        ref.invalidate(platformSessionViewProvider);
      }
    },
  );
  ref.onDispose(controller.dispose);
  return controller;
});

class TenantProfileController extends ChangeNotifier {
  TenantProfileController(this._send, {this.onSaved});
  final void Function()? onSaved;
  final TenantProfileSender? _send;
  TenantProfileView? view;
  String name = '', icon = '';
  bool confirmed = false,
      busy = false,
      loading = false,
      failed = false,
      unknown = false,
      needsRefresh = false;
  bool _retired = false;
  int _reads = 0;
  ActionCommand? _frozen;
  String? _operation;
  bool get editable => view?.updateActionKey == 'tenant.profile.update';
  bool get locked => busy || unknown || loading;
  bool get dirty =>
      view != null && (name.trim() != view!.name || icon != (view!.icon ?? ''));
  bool get canSave =>
      !_retired &&
      !busy &&
      !loading &&
      (unknown ||
          (editable &&
              dirty &&
              confirmed &&
              !needsRefresh &&
              name.trim().isNotEmpty &&
              name.trim().runes.length <= 64));
  void changed() {
    if (!_retired) {
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    if (_retired || busy || unknown || _send == null) {
      return;
    }
    final read = ++_reads;
    loading = true;
    failed = false;
    changed();
    try {
      final response = await _send(
        PlatformMethod.get,
        '/api/v1/tenant/profile',
      );
      if (_retired || read != _reads) {
        return;
      }
      if (!response.isSuccess) {
        throw const FormatException('profile unavailable');
      }
      final next = TenantProfileView.fromJson(
        response.body! as Map<String, dynamic>,
      );
      if (next.version < 1 ||
          (next.updateActionKey != null &&
              next.updateActionKey != 'tenant.profile.update')) {
        throw const FormatException('invalid profile');
      }
      view = next;
      name = next.name;
      icon = next.icon ?? '';
      confirmed = false;
      needsRefresh = false;
    } catch (_) {
      if (!_retired && read == _reads) {
        failed = true;
        view = null;
      }
    } finally {
      if (!_retired && read == _reads) {
        loading = false;
        changed();
      }
    }
  }

  Future<bool> save() async {
    if (!canSave || _send == null) {
      return false;
    }
    final retained = _frozen != null;
    final request = _frozen ??= ActionCommand(
      actionKey: 'tenant.profile.update',
      idempotencyKey: const Uuid().v4(),
      resourceVersion: view!.version,
      explicitConfirmation: true,
      tenantProfile: TenantProfileInput(
        name: name.trim() != view!.name ? name.trim() : null,
        icon: icon != (view!.icon ?? '') && icon.isNotEmpty ? icon : null,
        clearIcon: icon != (view!.icon ?? '') && icon.isEmpty ? true : null,
      ),
    );
    busy = true;
    failed = false;
    changed();
    bool recorded = false;
    try {
      final response = await _send(
        PlatformMethod.post,
        '/api/v1/actions',
        body: request.toJson(),
      );
      if (_retired) {
        return false;
      }
      if (!response.isSuccess) {
        if (retained ||
            response.status >= 500 ||
            response.error?.errorBodyClass == ErrorClass.UNKNOWN) {
          unknown = true;
        } else {
          _frozen = null;
          unknown = false;
          needsRefresh = true;
        }
        failed = true;
        return false;
      }
      final receipt = ActionSubmission.fromJson(
        response.body! as Map<String, dynamic>,
      );
      if (receipt.actionKey != request.actionKey ||
          receipt.operationId.isEmpty ||
          receipt.actionExecutionId.isEmpty ||
          (_operation != null && _operation != receipt.operationId)) {
        throw const FormatException('invalid receipt');
      }
      _operation = receipt.operationId;
      if (receipt.gateState == ActionGateState.EVALUATING ||
          receipt.dispatchState == ActionDispatchState.UNKNOWN ||
          (receipt.gateState == ActionGateState.ALLOWED &&
              receipt.dispatchState == ActionDispatchState.NOT_DISPATCHED)) {
        unknown = true;
        failed = true;
        return false;
      }
      _frozen = null;
      unknown = false;
      _operation = null;
      confirmed = false;
      recorded =
          receipt.gateState == ActionGateState.ALLOWED &&
          receipt.dispatchState == ActionDispatchState.DISPATCHED;
      if (!recorded) {
        failed = true;
        needsRefresh = true;
      }
    } catch (_) {
      if (!_retired) {
        unknown = true;
        failed = true;
      }
    } finally {
      if (!_retired) {
        busy = false;
        changed();
      }
    }
    if (recorded && !_retired) {
      onSaved?.call();
      await refresh();
    }
    return recorded;
  }

  @override
  void dispose() {
    _retired = true;
    _reads++;
    _frozen = null;
    view = null;
    name = '';
    icon = '';
    super.dispose();
  }
}
