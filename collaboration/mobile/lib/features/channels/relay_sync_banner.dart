import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';

/// 与 Relay 不同步时的如实提示。
///
/// 重连时提示已显示的消息可能过时；身份被拒时显示拒绝状态，不显示为正在重连。
/// 其他会话状态不显示横幅。这只消费会话状态，不证明历史查询已经全部完成。
class RelaySyncBanner extends ConsumerWidget {
  const RelaySyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(relaySessionProvider);
    final key = switch (session) {
      SessionState(authRejected: true) => PlatformMessageKey.nativeSyncRejected,
      SessionState(status: SessionStatus.reconnecting) =>
        PlatformMessageKey.nativeSyncReconnecting,
      _ => null,
    };
    if (key == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        key: ValueKey('relay-sync-banner-${key.name}'),
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.gutter,
          vertical: Grid.xxs,
        ),
        color: context.colors.surfaceContainerHighest,
        child: Text(
          platformText(key),
          style: context.textTheme.bodySmall?.copyWith(
            color: key == PlatformMessageKey.nativeSyncRejected
                ? context.colors.error
                : context.colors.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
