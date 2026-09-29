import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../../shared/mentions/agent_identity_provider.dart';
import '../../../shared/relay/relay.dart';
import '../../../shared/profile/user_cache_provider.dart';
import '../channel_management_provider.dart';
import '../channels_provider.dart';
import 'mention_candidates.dart';
import 'mention_ranking.dart';

/// Ranked mention candidates for a channel + query: the channel's members,
/// ordered as desktop's `rankMentionCandidates` does.
final mentionCandidatesProvider = Provider.family
    .autoDispose<List<MentionCandidate>, ({String channelId, String query})>((
      ref,
      args,
    ) {
      final channelsAsync = ref.watch(channelsProvider);
      final membersAsync = ref.watch(channelMembersProvider(args.channelId));
      final sessionStatus = ref.watch(relaySessionProvider).status;
      final cachedMembers = channelsAsync.asData == null
          ? const <ChannelMember>[]
          : ref
                .read(channelsProvider.notifier)
                .cachedMembersForChannel(args.channelId);
      final members = channelMembersForAutocomplete(
        membersAsync: membersAsync,
        sessionStatus: sessionStatus,
        cachedMembers: cachedMembers,
      );
      final owners = ref.watch(agentOwnersProvider).asData?.value ?? const {};
      final userCache = ref.watch(userCacheProvider);
      final currentPubkey = ref.watch(currentPubkeyProvider);

      final candidates = buildMentionCandidates(
        members: members,
        userCache: userCache,
        ownerByAgentPubkey: owners,
        currentPubkey: currentPubkey,
      );

      return rankMentionCandidates(candidates, args.query);
    });
