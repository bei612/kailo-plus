// Restored Buzz 779af8886c forum surface; management facts remain Core-owned (DD-80).
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/relay/relay.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../channels/channel.dart';
import '../channels/channel_management_provider.dart';
import 'forum_posts_view.dart';
import 'forum_thread_page.dart';

class ForumChannelPage extends HookConsumerWidget {
  const ForumChannelPage({super.key, required this.channel, this.initialEventId});
  final Channel channel;
  final String? initialEventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final details = ref.watch(channelDetailsProvider(channel.id));
    final resolved = details.unwrapPrevious().asData?.value;
    final current = resolved == null ? channel : channel.mergeDetails(resolved);
    final pubkey = ref.watch(currentPubkeyProvider);
    ref.watch(platformAuthorNamesProvider(channel.id));
    final opened = useRef<String?>(null);
    useEffect(() {
      final target = initialEventId;
      if (target == null || opened.value == target) return null;
      opened.value = target;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!context.mounted) return;
        Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ForumThreadPage(
          channelId: channel.id, postEventId: target, currentPubkey: pubkey,
          isMember: current.isMember, isArchived: current.isArchived,
        )));
      });
      return null;
    }, [channel.id, initialEventId]);
    return FrostedScaffold(
      appBar: FrostedAppBar(title: Text(current.name)),
      body: ForumPostsView(channel: current, currentPubkey: pubkey),
    );
  }
}
