import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';

import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';

/// 管理平面视图的统一加载与错误显示。
///
/// 错误按来源分开说：BFF 按契约拒绝时显示 reason code 与说明；没有得到可判定的
/// 回应时只说「不明」，不当作成功或失败；登录失效时给出重新登录的入口。
class PlatformAsyncView<T> extends ConsumerWidget {
  const PlatformAsyncView({
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
        if (error is PlatformNotSignedIn) {
          return _Message(
            text: platformText(
              PlatformMessageKey.nativeErrorSessionEnded,
              locale: locale,
            ),
            action: platformText(
              PlatformMessageKey.nativeErrorSignInAgain,
              locale: locale,
            ),
            onAction: () =>
                unawaited(ref.read(platformLinkProvider.notifier).signOut()),
          );
        }
        return _Message(
          text: platformErrorText(error, locale: locale),
          action: platformText(
            PlatformMessageKey.platformRetry,
            locale: locale,
          ),
          onAction: onRetry,
        );
      },
    );
  }
}

/// 一次管理平面调用失败的说明。
String platformErrorText(Object error, {String? locale}) {
  if (error is PlatformApiError) {
    final body = error.response.error;
    if (body != null && body.errorBodyClass != ErrorClass.UNKNOWN) {
      return platformText(
        PlatformMessageKey.platformReasonWithCode,
        locale: locale,
        variables: {
          'text': platformReasonText(body.reason, locale: locale),
          'code': platformReasonCode(body.reason),
        },
      );
    }
    // 裸读取拒绝是确定结论；显式 UNKNOWN、未知分类/原因优先保留不明。
    final raw = error.response.body;
    if (raw == null || (raw is Map<String, dynamic> && raw['class'] == null)) {
      if (error.response.status == 403) {
        return platformText(PlatformMessageKey.tasksStatusDenied, locale: locale);
      }
      if (error.response.status == 404) {
        return platformText(PlatformMessageKey.nativeUnavailableTitle, locale: locale);
      }
    }
    return platformText(
      PlatformMessageKey.nativeErrorHttpOutcomeUnknown,
      locale: locale,
      variables: {'status': error.response.status},
    );
  }
  if (error is PlatformUnavailable) {
    return platformText(
      PlatformMessageKey.nativeErrorUnavailable,
      locale: locale,
    );
  }
  if (error is TypeError) {
    return platformText(PlatformMessageKey.nativeErrorContract, locale: locale);
  }
  return platformText(
    PlatformMessageKey.nativeStatusOutcomeUnknown,
    locale: locale,
  );
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
              key: const ValueKey('platform-view-error'),
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
