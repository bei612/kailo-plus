import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// 本人的审计记录（`.design/03` §14：未经目标 audit 权限判定时只看自己的动作）。
class KailoAuditPage extends ConsumerWidget {
  const KailoAuditPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          kailoText(KailoMessageKey.platformAuditMyTitle, locale: locale),
        ),
      ),
      body: KailoAsyncView(
        value: ref.watch(kailoOwnAuditProvider),
        onRetry: () => ref.invalidate(kailoOwnAuditProvider),
        builder: (context, entries) => entries.isEmpty
            ? Center(
                child: Text(
                  kailoText(KailoMessageKey.platformAuditNone, locale: locale),
                ),
              )
            : ListView(
                children: [
                  AppListCard(
                    children: [
                      for (final (index, entry) in entries.indexed)
                        AppListRow(
                          key: ValueKey('kailo-audit-$index'),
                          title: entry.actionKey,
                          subtitle: _auditSubtitle(entry, locale),
                          subtitleMaxLines: 3,
                        ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}

String _auditSubtitle(OwnAuditEntry entry, String locale) {
  final type = kailoAuditEventTypeText(entry.eventType, locale: locale);
  final at = kailoAbsoluteTime(entry.occurredAt, locale: locale);
  return '$type · ${entry.decision} · ${entry.resultCode}\n$at';
}
