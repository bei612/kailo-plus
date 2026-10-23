// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/agent_activity/working_bots_provider.dart. Kailo: the channel's
// Agents are its admitted Installation directory (DD-147 author directory), never kind:0
// `is_agent` or a roster role. Members see only the Agent's 20002 typing; Kailo Agents reply in
// threads, so a thread-scoped typing entry also marks the Agent as working (client-kit
// agentWorkingSignal, DD-125(6)). The audited turn list stays an `audit` holder's detail.
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../../shared/platform/agent_author_directory.dart';
import '../channel_typing_provider.dart';

/// Lowercase pubkeys of this channel's admitted Agents that are currently typing.
final workingAgentPubkeysProvider = Provider.autoDispose
    .family<Set<String>, String>((ref, channelId) {
      final typingEntries = ref.watch(channelTypingProvider(channelId));
      if (typingEntries.isEmpty) return const <String>{};
      final agents =
          ref.watch(platformAgentAuthorsProvider(channelId)).asData?.value ??
          const [];
      final agentPubkeys = <String>{
        for (final agent in agents) agent.agentPubkey.toLowerCase(),
      };
      return <String>{
        for (final entry in typingEntries)
          if (agentPubkeys.contains(entry.pubkey.toLowerCase()))
            entry.pubkey.toLowerCase(),
      };
    });
