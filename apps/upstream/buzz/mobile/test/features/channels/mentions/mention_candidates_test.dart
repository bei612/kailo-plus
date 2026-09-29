import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/mentions/mention_candidates.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/mentions/agent_identity_provider.dart';

final userPubkey = 'a' * 64;
final memberPubkey = 'b' * 64;
final agentPubkey = 'c' * 64;
final ownerPubkey = 'd' * 64;

ChannelMember member(String pubkey, {String role = 'member'}) {
  return ChannelMember(
    pubkey: pubkey,
    role: role,
    joinedAt: DateTime(2024),
    displayName: 'Member',
  );
}

void main() {
  test('role-only agent mentions fall back to a compact npub label', () {
    const pubkey =
        'deadbeef00000000000000000000000000000000000000000000000000000000';

    expect(
      mentionNamesWithDirectoryLabels(
        mentionPubkeys: const [pubkey],
        profileMentionNames: const {},
        directoryDisplayNames: const {},
        agentMentionPubkeys: const {pubkey},
      ),
      const {pubkey: 'npub1m6k\u20263kf3'},
    );
  });

  group('formatOwnerLabel', () {
    test('returns "you" for the current user', () {
      expect(formatOwnerLabel(userPubkey, userPubkey, const {}), 'you');
    });

    test('prefers display name, then handle, then compact npub', () {
      final profiles = {
        ownerPubkey: UserProfile(pubkey: ownerPubkey, displayName: 'Wes'),
      };
      expect(formatOwnerLabel(ownerPubkey, userPubkey, profiles), 'Wes');
      expect(
        formatOwnerLabel(ownerPubkey, userPubkey, const {}),
        'npub1mhw\u2026dmpv',
      );
    });

    test('returns null without an owner', () {
      expect(formatOwnerLabel(null, userPubkey, const {}), isNull);
    });
  });

  group('buildMentionCandidates', () {
    test('includes the current user (desktop parity)', () {
      final candidates = buildMentionCandidates(
        members: [member(userPubkey)],
        userCache: const {},
        ownerByAgentPubkey: const {},
        currentPubkey: userPubkey,
      );
      expect(candidates.map((c) => c.pubkey), contains(userPubkey));
    });

    test('search results add non-member humans, ungated', () {
      final humanPubkey = '1' * 64;
      final candidates = buildMentionCandidates(
        members: [member(memberPubkey)],
        userCache: const {},
        ownerByAgentPubkey: const {},
        searchResults: [
          UserProfile(pubkey: humanPubkey, displayName: 'Wes Outside'),
        ],
        currentPubkey: userPubkey,
      );

      expect(candidates.map((c) => c.pubkey), [memberPubkey, humanPubkey]);
      final human = candidates.last;
      expect(human.isAgent, isFalse);
      expect(human.isMember, isFalse);
      expect(human.displayName, 'Wes Outside');
    });

    test('search results show agents owned by the current user', () {
      final ownedAgent = '2' * 64;
      final candidates = buildMentionCandidates(
        members: const [],
        userCache: const {},
        ownerByAgentPubkey: const {},
        searchResults: [
          UserProfile(
            pubkey: ownedAgent,
            displayName: 'raccoon',
            ownerPubkey: userPubkey,
          ),
        ],
        currentPubkey: userPubkey,
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.isAgent, isTrue);
      expect(candidates.single.ownerPubkey, userPubkey);
    });

    test('search results never duplicate channel members', () {
      final candidates = buildMentionCandidates(
        members: [member(memberPubkey)],
        userCache: const {},
        ownerByAgentPubkey: const {},
        searchResults: [
          UserProfile(pubkey: memberPubkey, displayName: 'Member Dup'),
        ],
        currentPubkey: userPubkey,
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.isMember, isTrue);
    });
  });
}
