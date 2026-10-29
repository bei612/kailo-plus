import 'package:flutter/widgets.dart';
import 'package:client_kit/shared/platform/platform_text.dart';

String forumText(BuildContext context, PlatformMessageKey key) =>
    platformText(key, locale: Localizations.localeOf(context).toLanguageTag());

String forumReplyCount(BuildContext context, int count) => platformText(
  count == 1
      ? PlatformMessageKey.forumReplyOne
      : PlatformMessageKey.forumReplyMany,
  locale: Localizations.localeOf(context).toLanguageTag(),
  variables: {'count': count},
);
