import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/kailo/kailo_api.dart';
import '../../shared/kailo/kailo_link.dart';
import '../../shared/kailo/kailo_platform_text.dart';
import '../../shared/kailo/kailo_reason_text.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';

/// 管理平面视图的统一加载与错误显示。
///
/// 错误按来源分开说：BFF 按契约拒绝时显示 reason code 与说明；没有得到可判定的
/// 回应时只说「不明」，不当作成功或失败；登录失效时给出重新登录的入口。
class KailoAsyncView<T> extends ConsumerWidget {
  const KailoAsyncView({
    super.key,
    required this.value,
    required this.onRetry,
    required this.builder,
  });

  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(BuildContext context, T data) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return value.when(
      skipLoadingOnRefresh: false,
      loading: () => const Center(child: BuzzLoadingIndicator(size: 40)),
      data: (data) => builder(context, data),
      error: (error, _) {
        if (error is KailoNotSignedIn) {
          return _Message(
            text: kailoText(
              KailoMessageKey.nativeErrorSessionEnded,
              locale: locale,
            ),
            action: kailoText(
              KailoMessageKey.nativeErrorSignInAgain,
              locale: locale,
            ),
            onAction: () =>
                unawaited(ref.read(kailoLinkProvider.notifier).signOut()),
          );
        }
        return _Message(
          text: kailoErrorText(error, locale: locale),
          action: kailoText(KailoMessageKey.platformRetry, locale: locale),
          onAction: onRetry,
        );
      },
    );
  }
}

/// 一次管理平面调用失败的说明。
String kailoErrorText(Object error, {String? locale}) {
  if (error is KailoApiError) {
    final body = error.response.error;
    if (body != null) {
      return kailoText(
        KailoMessageKey.platformReasonWithCode,
        locale: locale,
        variables: {
          'text': kailoReasonText(body.reason, locale: locale),
          'code': kailoReasonCode(body.reason),
        },
      );
    }
    return kailoText(
      KailoMessageKey.nativeErrorHttpOutcomeUnknown,
      locale: locale,
      variables: {'status': error.response.status},
    );
  }
  if (error is KailoUnavailable) {
    return kailoText(KailoMessageKey.nativeErrorUnavailable, locale: locale);
  }
  if (error is TypeError) {
    return kailoText(KailoMessageKey.nativeErrorContract, locale: locale);
  }
  return kailoText(KailoMessageKey.nativeStatusOutcomeUnknown, locale: locale);
}

class _Message extends StatelessWidget {
  const _Message({
    required this.text,
    required this.action,
    required this.onAction,
  });

  final String text;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              text,
              key: const ValueKey('kailo-view-error'),
              textAlign: TextAlign.center,
              style: context.textTheme.bodyMedium,
            ),
            const SizedBox(height: Grid.xs),
            OutlinedButton(onPressed: onAction, child: Text(action)),
          ],
        ),
      ),
    );
  }
}
