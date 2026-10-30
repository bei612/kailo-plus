// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/invites/invite_create_provider.dart. Kailo (DD-83): a community invite is
// the governed `tenant.member.invite` — one single-use invitation credential per named invitee,
// whose link appears only in the first response. There is no relay-minted reusable invite, no
// TTL or use-count choice (the expiry is frozen by the deployment at issue), and no direct
// npub add (`tenant.member.add` is not registered; DD-83). The entry follows the same BFF answer
// as client-kit invitations.tsx: the invitation list is open only to Tenant `manage`, so a 403
// means "no entry", and Core re-admits every submission anyway.
//
// A new intent is frozen with its idempotency key before it is sent; an unknown outcome keeps
// it and only that same command can be resent; a definite answer settles it (DD-81).
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../shared/auth/auth.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';

/// Whether this person may issue invitations, as answered by the BFF.
enum InviteAccess {
  /// The invitation list was read: the caller holds Tenant `manage`.
  allowed,

  /// The BFF answered 403: no entry is shown.
  denied,

  /// The answer is not known (transport or server error). Like the original row
  /// (`roleAsync.hasError`), the entry stays reachable; Core re-admits the submission.
  unknown,
}

/// The BFF's answer for the community invite entry.
final inviteAccessProvider = FutureProvider.autoDispose<InviteAccess>((
  ref,
) async {
  final config = ref.watch(platformConfigProvider);
  ref.watch(authProvider.select((auth) => auth.value?.community?.id));
  if (config == null) return InviteAccess.denied;
  try {
    final response = await ref
        .read(nativeSessionProvider)
        .send(config, PlatformMethod.get, '/api/v1/invitations');
    if (response.isSuccess) return InviteAccess.allowed;
    if (response.status == 403) return InviteAccess.denied;
    return InviteAccess.unknown;
  } on PlatformNotSignedIn {
    return InviteAccess.denied;
  } on Exception {
    return InviteAccess.unknown;
  }
});

/// The answer to one `tenant.member.invite` submission.
sealed class InviteIssueOutcome {
  const InviteIssueOutcome();
}

/// Issued; [invitation] carries the only copy of the link.
class InviteIssued extends InviteIssueOutcome {
  const InviteIssued(this.label, this.invitation);
  final String label;
  final IssuedInvitation invitation;
}

/// Admitted but the response carried no link; it cannot be shown again.
class InviteIssuedWithoutLink extends InviteIssueOutcome {
  const InviteIssuedWithoutLink();
}

/// Not known whether it was created; only the same command may be resent.
class InviteIssueUnknown extends InviteIssueOutcome {
  const InviteIssueUnknown(this.operation);
  final String? operation;
}

/// A definite refusal: [reason] from the receipt, or [error] from the request.
class InviteIssueRejected extends InviteIssueOutcome {
  const InviteIssueRejected({this.reason, this.error});
  final ReasonCode? reason;
  final Object? error;
}

/// The frozen invite intent for the current platform session.
class CommunityInviteActions {
  CommunityInviteActions(this._ref, this._config, this._current);

  final Ref _ref;
  final PlatformConfig _config;
  final bool Function() _current;
  ActionCommand? _retained;
  String? _retainedOperation;
  bool _inFlight = false;

  /// The intent kept after an unknown outcome; while it exists only it may be resent.
  ActionCommand? get retained => _retained;

  bool get busy => _inFlight;

  /// Issues an invitation for [label], or resends the retained command unchanged.
  Future<InviteIssueOutcome?> issue(String label) async {
    if (_inFlight) return null;
    final retained = _retained;
    final name = label.trim();
    if (retained == null && name.isEmpty) return null;
    _inFlight = true;
    final command =
        retained ??
        ActionCommand(
          actionKey: 'tenant.member.invite',
          idempotencyKey: const Uuid().v4(),
          name: name,
        );
    _retained = command;
    final priorOperation = retained == null ? null : _retainedOperation;
    try {
      final outcome = await _send(
        command,
        priorOperation,
        retried: retained != null,
      );
      if (outcome is InviteIssueUnknown) {
        if (outcome.operation != null) _retainedOperation = outcome.operation;
      } else {
        _retained = null;
        _retainedOperation = null;
      }
      return outcome;
    } finally {
      _inFlight = false;
    }
  }

  Future<InviteIssueOutcome> _send(
    ActionCommand command,
    String? priorOperation, {
    required bool retried,
  }) async {
    final PlatformResponse response;
    try {
      if (!_current()) throw const PlatformUnavailable('session changed');
      response = await _ref
          .read(nativeSessionProvider)
          .send(
            _config,
            PlatformMethod.post,
            '/api/v1/actions',
            body: command.toJson(),
          );
    } on PlatformNotSignedIn catch (error) {
      return retried
          ? InviteIssueUnknown(priorOperation)
          : InviteIssueRejected(error: error);
    } on Exception {
      return InviteIssueUnknown(priorOperation);
    }
    if (!response.isSuccess) {
      final error = response.error;
      if (error == null ||
          error.errorBodyClass == ErrorClass.UNKNOWN ||
          retried) {
        return InviteIssueUnknown(priorOperation);
      }
      return InviteIssueRejected(error: PlatformApiError(response));
    }
    final ActionSubmission receipt;
    try {
      receipt = ActionSubmission.fromJson(
        response.body! as Map<String, dynamic>,
      );
    } on Object {
      return InviteIssueUnknown(priorOperation);
    }
    if (receipt.actionKey != command.actionKey ||
        receipt.actionExecutionId.isEmpty ||
        receipt.operationId.isEmpty ||
        (priorOperation != null && receipt.operationId != priorOperation)) {
      return InviteIssueUnknown(priorOperation);
    }
    final gate = receipt.gateState;
    final dispatch = receipt.dispatchState;
    if (dispatch == ActionDispatchState.UNKNOWN ||
        gate == ActionGateState.EVALUATING ||
        (gate == ActionGateState.ALLOWED &&
            dispatch == ActionDispatchState.NOT_DISPATCHED)) {
      return InviteIssueUnknown(receipt.operationId);
    }
    if (gate != ActionGateState.ALLOWED ||
        dispatch == ActionDispatchState.ABORTED) {
      return InviteIssueRejected(reason: receipt.reason);
    }
    final invitation = receipt.invitation;
    // The link appears only in this first response; without it there is no second source.
    return invitation == null
        ? const InviteIssuedWithoutLink()
        : InviteIssued(command.name ?? '', invitation);
  }
}

/// Session-scoped like the channel actions: closing the page keeps an unknown intent.
final communityInviteActionsProvider = Provider<CommunityInviteActions>((ref) {
  final community = ref.watch(
    authProvider.select((auth) => auth.value?.community?.id),
  );
  final config = ref.watch(platformConfigProvider);
  if (config == null || community == null) {
    throw const PlatformNotSignedIn();
  }
  var active = true;
  ref.onDispose(() => active = false);
  return CommunityInviteActions(
    ref,
    config,
    () =>
        active &&
        ref.read(platformConfigProvider) == config &&
        ref.read(authProvider).value?.community?.id == community,
  );
});
