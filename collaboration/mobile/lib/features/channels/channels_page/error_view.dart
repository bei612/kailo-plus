part of '../channels_page.dart';

class _ErrorView extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;

  const _ErrorView({required this.error, required this.onRetry});

  static String _userMessage(BuildContext context, Object error) {
    if (error is RelayException) {
      if (error.statusCode == 401) {
        return _channelText(context, PlatformMessageKey.channelsLoadUnauthorized);
      }
      if (error.statusCode == 403) {
        return _channelText(context, PlatformMessageKey.channelsLoadDenied);
      }
      return _channelText(context, PlatformMessageKey.channelsLoadServerError, variables: {'status': error.statusCode});
    }
    if (error is SocketException) {
      return _channelText(context, PlatformMessageKey.channelsLoadUnreachable);
    }
    return _channelText(context, PlatformMessageKey.channelsLoadConnectionError);
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              LucideIcons.wifiOff,
              size: Grid.xl,
              color: context.colors.error,
            ),
            const SizedBox(height: Grid.xs),
            Text(
              _channelText(context, PlatformMessageKey.channelsLoadFailed),
              style: context.textTheme.titleMedium,
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              _userMessage(context, error),
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: Grid.xs),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(LucideIcons.refreshCw),
              label: Text(_channelText(context, PlatformMessageKey.timelineRetry)),
            ),
          ],
        ),
      ),
    );
  }
}
