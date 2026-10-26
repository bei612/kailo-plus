// DD-158: private Core feedback; no Relay publication or media upload.
import 'dart:convert';
import 'dart:typed_data';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../shared/auth/auth_provider.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/relay/relay_provider.dart';

enum FeedbackFailure { refused, unconfirmed }

typedef FeedbackSender =
    Future<PlatformResponse> Function(Map<String, dynamic>);

/// Kept while the form is closed, retired on account/device/deployment change.
final feedbackDraftProvider = Provider<FeedbackDraft>((ref) {
  final config = ref.watch(platformConfigProvider);
  final scope = ref.watch(
    authProvider.select((a) => (a.value?.status, a.value?.community?.id)),
  );
  final pubkey = ref.watch(myPubkeyProvider);
  final session = ref.read(nativeSessionProvider);
  final draft = FeedbackDraft(
    config != null && scope.$1 == AuthStatus.authenticated && pubkey != null
        ? (body) => session.send(
            config,
            PlatformMethod.post,
            '/api/v1/feedback',
            body: body,
          )
        : null,
  );
  ref.onDispose(draft.dispose);
  return draft;
});

class FeedbackDraft extends ChangeNotifier {
  FeedbackDraft(this._send);
  final FeedbackSender? _send;
  bool _retired = false;
  String message = '';
  FeedbackCategory? category;
  String? diagnostics;
  bool includeDiagnostics = false;
  Uint8List? image;
  String? imageMime;
  FeedbackSubmissionRequest? _frozen;
  bool sending = false;
  FeedbackFailure? failure;

  bool get locked => sending || _frozen != null;
  bool get canSend =>
      _send != null &&
      !sending &&
      (_frozen != null ||
          (message.trim().isNotEmpty && message.trim().runes.length <= 4000));

  void changed() {
    if (!_retired) {
      notifyListeners();
    }
  }

  void attach(Uint8List bytes) {
    if (locked) {
      return;
    }
    if (bytes.isEmpty || bytes.length > 2 * 1024 * 1024) {
      throw const FormatException('image size');
    }
    bool starts(List<int> signature) =>
        bytes.length >= signature.length &&
        listEquals(bytes.sublist(0, signature.length), signature);
    final mime = starts([137, 80, 78, 71, 13, 10, 26, 10])
        ? 'image/png'
        : starts([255, 216, 255])
        ? 'image/jpeg'
        : bytes.length >= 12 &&
              starts([82, 73, 70, 70]) &&
              listEquals(bytes.sublist(8, 12), [87, 69, 66, 80])
        ? 'image/webp'
        : null;
    if (mime == null) {
      throw const FormatException('image type');
    }
    image = Uint8List.fromList(bytes);
    imageMime = mime;
    failure = null;
    changed();
  }

  Future<bool> submit() async {
    if (_retired || !canSend) {
      return false;
    }
    final request = _frozen ??= FeedbackSubmissionRequest(
      idempotencyKey: const Uuid().v4(),
      client: FeedbackClient.MOBILE,
      category: category,
      message: message.trim(),
      diagnostics: includeDiagnostics ? diagnostics : null,
      attachment: image == null
          ? null
          : FeedbackAttachmentUpload(
              dataBase64: base64Encode(image!),
              mimeType: imageMime!,
            ),
    );
    sending = true;
    failure = null;
    changed();
    try {
      final response = await _send!(request.toJson());
      if (_retired) {
        return false;
      }
      if (response.status == 200) {
        final receipt = FeedbackSubmissionReceipt.fromJson(
          response.body! as Map<String, dynamic>,
        );
        if (!RegExp(r'^[0-9a-f-]{36}$').hasMatch(receipt.feedbackId) ||
            DateTime.tryParse(receipt.createdAt) == null) {
          throw const FormatException('receipt');
        }
        message = '';
        category = null;
        image = null;
        imageMime = null;
        diagnostics = null;
        includeDiagnostics = false;
        _frozen = null;
        return true;
      }
      if (response.status >= 500) {
        failure = FeedbackFailure.unconfirmed;
      } else {
        _frozen = null;
        failure = FeedbackFailure.refused;
      }
    } catch (_) {
      if (!_retired) {
        failure = FeedbackFailure.unconfirmed;
      }
    } finally {
      if (!_retired) {
        sending = false;
        changed();
      }
    }
    return false;
  }

  @override
  void dispose() {
    _retired = true;
    _frozen = null;
    message = '';
    image = null;
    imageMime = null;
    diagnostics = null;
    super.dispose();
  }
}
