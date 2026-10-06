import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// 本人的审计记录（`.design/03` §14：未经目标 audit 权限判定时只看自己的动作）。
class PlatformAuditPage extends ConsumerWidget {
  const PlatformAuditPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(PlatformMessageKey.platformAuditMyTitle, locale: locale),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(platformOwnAuditProvider),
        onRetry: () => ref.invalidate(platformOwnAuditProvider),
        builder: (context, entries) => entries.isEmpty
            ? Center(
                child: Text(
                  platformText(
                    PlatformMessageKey.platformAuditNone,
                    locale: locale,
                  ),
                ),
              )
            : ListView(
                children: [
                  AppListCard(
                    children: [
                      for (final (index, entry) in entries.indexed)
                        AppListRow(
                          key: ValueKey('platform-audit-$index'),
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
  final type = platformAuditEventTypeText(entry.eventType, locale: locale);
  final at = platformAbsoluteTime(entry.occurredAt, locale: locale);
  final decisionKey = switch (entry.decision) {
    'ALLOW' => PlatformMessageKey.platformAuditAllow,
    'DENY' => PlatformMessageKey.platformAuditDeny,
    'NONE' => PlatformMessageKey.platformAuditNoDecision,
    _ => PlatformMessageKey.platformAuditUnknownDecision,
  };
  final decision = platformText(
    decisionKey,
    locale: locale,
    variables: {'code': entry.decision},
  );
  final resultKey = switch (entry.resultCode) {
    'NONE' => PlatformMessageKey.platformAuditNoResult,
    'ACCEPTED' => PlatformMessageKey.platformAuditAccepted,
    'DISPATCHED' => PlatformMessageKey.platformAuditDispatched,
    'DELIVERED' => PlatformMessageKey.platformAuditDelivered,
    'NOT_DELIVERED' => PlatformMessageKey.platformAuditNotDelivered,
    'REJECTED' => PlatformMessageKey.platformAuditRejected,
    'UNKNOWN' => PlatformMessageKey.platformAuditUnknownResult,
    _ => null,
  };
  final reason = reasonCodeValues.map[entry.resultCode];
  final result = resultKey != null
      ? platformText(resultKey, locale: locale)
      : reason != null
      ? platformReasonText(reason, locale: locale)
      : platformText(
          PlatformMessageKey.platformAuditResultCode,
          locale: locale,
          variables: {'code': entry.resultCode},
        );
  return '$type · $decision · $result\n${entry.decision} · ${entry.resultCode}\n$at';
}
