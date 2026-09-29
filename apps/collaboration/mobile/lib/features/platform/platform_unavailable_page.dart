import 'package:flutter/material.dart';

import '../../shared/contracts/contracts.dart';
import '../../shared/kailo/kailo_platform_text.dart';
import '../../shared/kailo/kailo_reason_text.dart';
import '../../shared/theme/theme.dart';

/// 深链接指向移动端不交付的能力时的去处（Kailo `REQ-21`、`V-SCN-65`）。
///
/// 只说明原因、给出稳定 reason code 并指向 Web 或桌面端；不打开链接目标，也不以
/// 内嵌 WebView 代替。
class KailoUnavailablePage extends StatelessWidget {
  const KailoUnavailablePage({super.key, required this.uri});

  /// 收到的链接，原样显示，便于用户在别的端打开
  final Uri uri;

  static const reason = ReasonCode.SURFACE_CAPABILITY_UNAVAILABLE;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          kailoText(KailoMessageKey.nativeUnavailableTitle, locale: locale),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(Grid.gutter),
        children: [
          Text(
            kailoReasonText(reason, locale: locale),
            style: context.textTheme.bodyLarge,
          ),
          const SizedBox(height: Grid.xs),
          SelectableText(
            kailoReasonCode(reason),
            key: const ValueKey('kailo-unavailable-reason'),
            style: context.textTheme.labelLarge,
          ),
          const SizedBox(height: Grid.xs),
          SelectableText(
            uri.toString(),
            style: context.textTheme.bodySmall?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
