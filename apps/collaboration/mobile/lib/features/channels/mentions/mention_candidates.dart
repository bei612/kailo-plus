import '../../../shared/profile/user_profile.dart';
import '../../../shared/utils/string_utils.dart';
import '../channel_management_provider.dart';
import 'mention_ranking.dart';

/// Format the "managed by …" label. Mirrors desktop's `formatOwnerLabel`.
String? formatOwnerLabel(
  String? ownerPubkey,
  String? currentPubkey,
  Map<String, UserProfile> userCache,
) {
  if (ownerPubkey == null) return null;
  final owner = ownerPubkey.toLowerCase();
  if (currentPubkey != null && owner == currentPubkey.toLowerCase()) {
    return 'you';
  }
  final profile = userCache[owner];
  final name = profile?.displayName?.trim();
  if (name != null && name.isNotEmpty) return name;
  final handle = profile?.nip05Handle?.trim();
  if (handle != null && handle.isNotEmpty) return handle;
  return shortPubkey(ownerPubkey);
}

/// Assemble the mention candidate list: channel members first-class, then the
/// given user-search results.
///
/// 平台不提供非成员 Agent 与全员目录作为提及候选：Channel roster 由 Core 管理
/// （`DD-80`），提及非成员只会降为引用标签，Agent 调用也不在一期移动端交付。
/// Mirrors desktop's `useMentions` candidate assembly (minus personas and
/// managed agents, which live in the desktop app's local store; the
/// owner-check on search results below covers their mention-eligibility
/// semantics).
List<MentionCandidate> buildMentionCandidates({
  required List<ChannelMember> members,
  required Map<String, UserProfile> userCache,
  required Map<String, String> ownerByAgentPubkey,
  List<UserProfile> searchResults = const [],
  String? currentPubkey,
}) {
  final candidates = <MentionCandidate>[];
  final seen = <String>{};

  for (final member in members) {
    final pk = member.pubkey.toLowerCase();
    if (!seen.add(pk)) continue;
    final profile = userCache[pk];
    final ownerPubkey = ownerByAgentPubkey[pk] ?? profile?.ownerPubkey;
    final isAgent = member.isBot || ownerPubkey != null;
    candidates.add(
      MentionCandidate(
        pubkey: pk,
        displayName: profile?.displayName?.trim().isNotEmpty == true
            ? profile!.displayName!.trim()
            : member.displayName,
        secondaryLabel: profile?.nip05Handle,
        avatarUrl: profile?.avatarUrl,
        isAgent: isAgent,
        isMember: true,
        role: member.role,
        ownerPubkey: ownerPubkey,
      ),
    );
  }

  final currentLower = currentPubkey?.toLowerCase();
  for (final profile in searchResults) {
    final pk = profile.pubkey.toLowerCase();
    if (seen.contains(pk)) continue;
    final ownerPubkey = ownerByAgentPubkey[pk] ?? profile.ownerPubkey;
    final isAgent = ownerPubkey != null;
    if (isAgent) {
      // Mirrors desktop's `shouldHideAgentFromMentions` for non-member
      // agents: show only when owned by the current user (desktop's
      // managed-agent semantics, derived from the verified NIP-OA owner).
      final ownedByCurrentUser =
          currentLower != null && ownerPubkey.toLowerCase() == currentLower;
      if (!ownedByCurrentUser) continue;
    }
    seen.add(pk);
    candidates.add(
      MentionCandidate(
        pubkey: pk,
        displayName: profile.displayName?.trim().isNotEmpty == true
            ? profile.displayName!.trim()
            : null,
        secondaryLabel: profile.nip05Handle,
        avatarUrl: profile.avatarUrl,
        isAgent: isAgent,
        isMember: false,
        ownerPubkey: ownerPubkey,
      ),
    );
  }

  return candidates;
}
