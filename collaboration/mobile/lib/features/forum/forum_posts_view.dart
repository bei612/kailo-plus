// Restored from Buzz 779af8886c; platform identity, delivery and i18n seams below.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/read_state/read_state_provider.dart';
import '../../shared/read_state/deferred_read_state_update.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/bee_refresh_indicator.dart';
import '../channels/channel.dart';
import '../channels/compose_bar.dart';
import 'forum_models.dart';
import 'forum_text.dart';
import 'forum_post_card.dart';
import 'forum_provider.dart';
import 'forum_thread_page.dart';

/// Main forum view — replaces the old _ForumPlaceholder.
///
/// Shows a list of forum posts for the channel with a FAB to open the compose
/// bar, and navigates to [ForumThreadPage] when a post is tapped.
class ForumPostsView extends HookConsumerWidget {
  final Channel channel;
  final String? currentPubkey;

  const ForumPostsView({
    super.key,
    required this.channel,
    required this.currentPubkey,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final postsAsync = ref
        .watch(forumPostsProvider(channel.id))
        .unwrapPrevious();
    final readState = ref.watch(readStateProvider);
    final posts = postsAsync.asData?.value.posts;
    final newestAt = posts?.fold<int>(
      0,
      (at, post) => post.createdAt > at ? post.createdAt : at,
    );
    useEffect(() {
      if (!readState.isReady || newestAt == null || newestAt == 0) return null;
      return deferReadStateUpdate(
        context,
        () => ref
            .read(readStateProvider.notifier)
            .markContextRead(channel.id, newestAt),
      );
    }, [channel.id, newestAt, readState.isReady]);
    final isComposing = useState(false);
    // A queued attachment can finish after this view is popped. Capture the
    // app-level provider container instead of retaining the route's WidgetRef.
    final providerContainer = ProviderScope.containerOf(context, listen: false);
    final forumDelivery = ForumEventDelivery.capture(providerContainer);

    // Periodic refresh (every 15s, matching desktop).
    useEffect(() {
      final timer = Stream.periodic(const Duration(seconds: 15)).listen((_) {
        ref.invalidate(forumPostsProvider(channel.id));
      });
      return timer.cancel;
    }, [channel.id]);

    final canPost = channel.isMember && !channel.isArchived;

    return Column(
      children: [
        Expanded(
          child: Scaffold(
            // Transparent so the parent Scaffold's background shows through.
            backgroundColor: Colors.transparent,
            floatingActionButton: canPost && !isComposing.value
                ? FloatingActionButton(
                    heroTag: 'forum-fab',
                    onPressed: () => isComposing.value = true,
                    tooltip: forumText(context, PlatformMessageKey.forumStart),
                    shape: const CircleBorder(),
                    child: const Icon(LucideIcons.plus),
                  )
                : null,
            body: postsAsync.unwrapPrevious().when(
              loading: () => Padding(
                padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
                child: Center(
                  child: BuzzLoadingIndicator(
                    size: 44,
                    semanticLabel: forumText(
                      context,
                      PlatformMessageKey.platformLoading,
                    ),
                  ),
                ),
              ),
              error: (e, _) => Padding(
                padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
                child: Center(
                  child: Text(
                    forumText(context, PlatformMessageKey.platformLoadFailed),
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: context.colors.error,
                    ),
                  ),
                ),
              ),
              data: (response) {
                final posts = response.posts;
                if (posts.isEmpty) {
                  return _EmptyState(
                    isMember: channel.isMember,
                    isArchived: channel.isArchived,
                  );
                }
                return BeeRefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(forumPostsProvider(channel.id));
                    await ref.read(forumPostsProvider(channel.id).future);
                  },
                  child: ListView.separated(
                    padding: EdgeInsets.only(
                      top: frostedAppBarHeight(context),
                      left: Grid.gutter,
                      right: Grid.gutter,
                      bottom: Grid.xs,
                    ),
                    itemCount: posts.length,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: Grid.xxs),
                    itemBuilder: (context, index) {
                      final post = posts[index];
                      return ForumPostCard(
                        post: post,
                        currentPubkey: currentPubkey,
                        onTap: () => _openThread(context, post),
                        onDelete: (eventId) async {
                          await deleteForumEvent(
                            ref,
                            channelId: channel.id,
                            eventId: eventId,
                          );
                        },
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ),
        if (isComposing.value) ...[
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(right: Grid.xxs),
              child: IconButton(
                onPressed: () => isComposing.value = false,
                icon: const Icon(LucideIcons.x, size: 18),
                tooltip: forumText(
                  context,
                  PlatformMessageKey.tenantProfileClose,
                ),
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
          ComposeBar(
            channelId: channel.id,
            hintText: forumText(
              context,
              PlatformMessageKey.forumPostPlaceholder,
            ),
            onSend:
                (
                  content,
                  mentionPubkeys, {
                  mediaTags = const <List<String>>[],
                }) async {
                  await forumDelivery.createPost(
                    channelId: channel.id,
                    content: content,
                    mentionPubkeys: mentionPubkeys,
                    mediaTags: mediaTags,
                  );
                  if (context.mounted) isComposing.value = false;
                },
          ),
        ],
      ],
    );
  }

  void _openThread(BuildContext context, ForumPost post) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ForumThreadPage(
          channelId: channel.id,
          postEventId: post.eventId,
          currentPubkey: currentPubkey,
          isMember: channel.isMember,
          isArchived: channel.isArchived,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isMember;
  final bool isArchived;

  const _EmptyState({required this.isMember, required this.isArchived});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Grid.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              LucideIcons.messageSquareText,
              size: Grid.xl,
              color: context.colors.onSurfaceVariant,
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              forumText(context, PlatformMessageKey.forumEmpty),
              style: context.textTheme.bodyLarge?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: Grid.half),
            Text(
              isArchived
                  ? forumText(context, PlatformMessageKey.forumArchived)
                  : isMember
                  ? forumText(context, PlatformMessageKey.forumEmptyHint)
                  : forumText(context, PlatformMessageKey.forumJoin),
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
