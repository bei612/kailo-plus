import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';

import '../../shared/relay/relay_publish_failure.dart';

/// Forum copy from the shared catalog, in the view's locale.
String forumText(
  BuildContext context,
  PlatformMessageKey key, [
  Map<String, Object>? variables,
]) => platformText(
  key,
  locale: Localizations.localeOf(context).toLanguageTag(),
  variables: variables,
);

/// Reply count in the original "{n} reply/replies" form.
String forumReplyCount(BuildContext context, int count) => forumText(
  context,
  count == 1
      ? PlatformMessageKey.forumReplyOne
      : PlatformMessageKey.forumReplyMany,
  {'count': count},
);

/// Deletion is a signed Relay event: an unknown outcome keeps the same signed
/// event for a re-check, a definite rejection leaves the content in place.
/// Neither is reported as success.
void showForumDeleteFailure(BuildContext context, Object error) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        forumText(
          context,
          error is RelayPublishOutcomeUnknown
              ? PlatformMessageKey.forumDeleteUnknown
              : PlatformMessageKey.forumDeleteRejected,
        ),
      ),
    ),
  );
}
