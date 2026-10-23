// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/profile/user_profile_sheet.dart. Kailo: the status line reads the restored
// NIP-38 cache (kind:30315); "Message" opens the person through the governed
// `conversation.open` (Core admission over the trusted HUMAN directory, DD-75) instead of a
// direct 9007, so it is only offered for a person of that directory other than oneself, and a
// refusal or an unconfirmed submission is told apart rather than failing silently.
import 'dart:async';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/animated_avatar.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/buzz_action_tile.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../../shared/widgets/progressive_animated_avatar.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../channels/channel.dart';
import '../channels/channel_detail_page.dart';
import '../channels/direct_messages.dart';
import '../channels/message_content.dart';
import 'presence_cache_provider.dart';
import 'user_status_cache_provider.dart';

/// Opens (or reuses) the governed DM with one person through `conversation.open`.
typedef ProfileDirectMessageOpener =
    Future<Channel> Function(String principalId);

final profileDirectMessageOpenerProvider = Provider<ProfileDirectMessageOpener>(
  (ref) => (principalId) async {
    final consumer = await ref.read(directMessagesProvider.future);
    return consumer.openDm(principalIds: [principalId]);
  },
);

/// Show a user profile bottom sheet for the given [pubkey].
void showUserProfileSheet(BuildContext context, String pubkey) {
  showBuzzModalBottomSheet<Channel>(
    context: context,
    isScrollControlled: true,
    showDragHandle: false,
    builder: (_) => UserProfileSheet(pubkey: pubkey),
  ).then((channel) {
    if (channel == null || !context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChannelDetailPage(channel: channel),
      ),
    );
  });
}

class UserProfileSheet extends HookConsumerWidget {
  final String pubkey;

  const UserProfileSheet({super.key, required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final pk = pubkey.toLowerCase();

    // Watch the cached profile.
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);
    // kind:20001 presence (DD-120 (5)): no fact yet means no chip, never "Offline".
    final presence = ref.watch(presenceCacheProvider.select((map) => map[pk]));
    final userStatus = ref.watch(
      userStatusCacheProvider.select((cache) => cache[pk]),
    );
    final myPubkey = ref.watch(myPubkeyProvider)?.toLowerCase();
    // The person behind this key in the trusted DM directory; agents and people outside it
    // have no governed conversation to open, so no Message action is offered for them.
    final directory = pk == myPubkey
        ? null
        : ref.watch(conversationDirectoryProvider).asData?.value;
    final actorPrincipalId = ref
        .watch(platformSessionViewProvider)
        .value
        ?.tenantPrincipalId;
    final dmTarget = actorPrincipalId == null
        ? null
        : directory?.people
              .where(
                (person) =>
                    person.principalId != actorPrincipalId &&
                    person.pubkeys.any((key) => key.toLowerCase() == pk),
              )
              .firstOrNull;

    // Fetch about from the user's kind:0 profile event.
    final aboutFuture = useMemoized(
      () => ref
          .read(relaySessionProvider.notifier)
          .fetchHistory(NostrFilters.profile(pk))
          .then((events) {
            if (events.isEmpty) return '';
            return ProfileData.fromEvent(events.first).about ?? '';
          })
          .catchError((_) => ''),
      [pk],
    );
    final aboutSnapshot = useFuture(aboutFuture);
    final about = aboutSnapshot.data ?? profile?.about ?? '';

    useEffect(() {
      ref.read(presenceCacheProvider.notifier).track([pk]);
      ref.read(userStatusCacheProvider.notifier).track([pk]);
      ref.read(userCacheProvider.notifier).preload([pk]);
      return null;
    }, [pk]);
    final copied = useState(false);
    final isOpeningDirectMessage = useState(false);
    final directMessageError = useState<String?>(null);

    // Canonical npub for the copy action; null when [pubkey] is not a valid
    // identity, in which case the copy tile is disabled — an invalid key is
    // never placed on the clipboard.
    final npub = fullNpub(pubkey);

    // Routed through the shared label so a blank cached name (empty or
    // whitespace-only, relay-valid) falls back to the compact npub instead
    // of an empty heading.
    final displayName = profile?.label;
    final avatarUrl = profile?.avatarUrl;
    final nip05 = profile?.nip05Handle;
    final initial =
        profile?.initial ?? (pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?');

    Future<void> copyPublicKey() async {
      if (npub == null) return;
      await Clipboard.setData(ClipboardData(text: npub));
      if (!context.mounted) return;
      copied.value = true;
      _showProfileCopyToast(context);
      unawaited(
        Future<void>.delayed(const Duration(seconds: 2), () {
          if (context.mounted) copied.value = false;
        }),
      );
    }

    Future<void> openDirectMessage() async {
      final target = dmTarget;
      if (target == null || isOpeningDirectMessage.value) return;
      isOpeningDirectMessage.value = true;
      directMessageError.value = null;
      try {
        final channel = await ref.read(profileDirectMessageOpenerProvider)(
          target.principalId,
        );
        if (context.mounted) Navigator.of(context).pop(channel);
      } on DirectMessageEnded catch (ended) {
        if (!context.mounted) return;
        directMessageError.value = ended.task.reason == null
            ? platformText(PlatformMessageKey.dmDenied, locale: locale)
            : platformReasonText(ended.task.reason!, locale: locale);
      } on DirectMessagePending {
        if (!context.mounted) return;
        directMessageError.value = platformText(
          PlatformMessageKey.dmPreparationPending,
          locale: locale,
        );
      } on PlatformApiError catch (failure) {
        if (!context.mounted) return;
        final body = failure.response.error;
        directMessageError.value = body == null
            ? platformText(PlatformMessageKey.dmUnknown, locale: locale)
            : '${platformReasonText(body.reason, locale: locale)} '
                  '(${platformReasonCode(body.reason)})';
      } on Object {
        if (!context.mounted) return;
        // A submission that was sent but not confirmed stays the pending command; saying
        // "failed" then would invite a second, different conversation request.
        final pending = ref
            .read(directMessagesProvider)
            .asData
            ?.value
            .pendingCommand;
        directMessageError.value = platformText(
          pending == null
              ? PlatformMessageKey.platformProfileOpenDmFailed
              : PlatformMessageKey.dmUnknown,
          locale: locale,
        );
      } finally {
        if (context.mounted) isOpeningDirectMessage.value = false;
      }
    }

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.7,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Flexible(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                Grid.gutter,
                0,
                Grid.gutter,
                MediaQuery.viewInsetsOf(context).bottom,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.only(bottom: Grid.xs),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Center the presence chip on the avatar's lower edge.
                    Padding(
                      padding: EdgeInsets.only(
                        bottom: presence == null ? 0 : Grid.xl / 2,
                      ),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Align(
                            alignment: Alignment.center,
                            child: FractionallySizedBox(
                              widthFactor: 0.5,
                              child: _ProfileAvatar(
                                avatarUrl: avatarUrl,
                                initial: initial,
                              ),
                            ),
                          ),
                          if (presence != null)
                            Positioned(
                              left: 0,
                              right: 0,
                              bottom: -(Grid.xl / 2),
                              child: _ProfilePresenceChip(presence: presence),
                            ),
                        ],
                      ),
                    ),
                    SizedBox(height: presence == null ? Grid.xs : Grid.half),

                    // Display name — centered, large
                    Center(
                      child: Text(
                        displayName ?? shortPubkey(pubkey),
                        style: context.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    // Match Settings: status is quiet, centered copy directly
                    // below the profile name rather than a separate information row.
                    if (userStatus != null && !userStatus.isEmpty)
                      SizedBox(
                        key: const ValueKey('user-profile-status'),
                        width: double.infinity,
                        child: Padding(
                          padding: const EdgeInsets.only(
                            top: Grid.xxs,
                            left: Grid.gutter,
                            right: Grid.gutter,
                            bottom: Grid.xxs,
                          ),
                          child: MessageContent(
                            content: userStatus.text.isNotEmpty
                                ? '${userStatus.emoji.isNotEmpty ? '${userStatus.emoji} ' : ''}${userStatus.text}'
                                : userStatus.emoji,
                            baseStyle: context.textTheme.bodySmall?.copyWith(
                              color: context.colors.onSurfaceVariant,
                            ),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                          ),
                        ),
                      ),

                    // NIP-05 handle — centered, secondary
                    if (nip05 != null && nip05.isNotEmpty) ...[
                      const SizedBox(height: Grid.half),
                      Center(
                        child: Text(
                          nip05,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: context.colors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: Grid.xs + Grid.half),

                    Row(
                      children: [
                        if (dmTarget != null) ...[
                          Expanded(
                            child: BuzzActionTile(
                              key: const ValueKey('user-profile-message'),
                              icon: isOpeningDirectMessage.value
                                  ? null
                                  : LucideIcons.messageSquare,
                              label: platformText(
                                isOpeningDirectMessage.value
                                    ? PlatformMessageKey.dmOpening
                                    : PlatformMessageKey.platformProfileMessage,
                                locale: locale,
                              ),
                              isLoading: isOpeningDirectMessage.value,
                              loadingSemanticLabel: platformText(
                                PlatformMessageKey.dmPreparing,
                                locale: locale,
                              ),
                              onTap: openDirectMessage,
                            ),
                          ),
                          const SizedBox(width: Grid.twelve),
                        ],
                        Expanded(
                          child: BuzzActionTile(
                            icon: copied.value
                                ? LucideIcons.check
                                : LucideIcons.key,
                            label: copied.value
                                ? platformText(
                                    PlatformMessageKey
                                        .platformProfileCopiedShort,
                                    locale: locale,
                                  )
                                : platformText(
                                    PlatformMessageKey.platformProfileCopyField,
                                    locale: locale,
                                    variables: {
                                      'field': platformText(
                                        PlatformMessageKey
                                            .platformProfilePublicKey,
                                        locale: locale,
                                      ).toLowerCase(),
                                    },
                                  ),
                            isEnabled: npub != null,
                            onTap: copyPublicKey,
                          ),
                        ),
                      ],
                    ),
                    if (directMessageError.value case final message?)
                      Padding(
                        key: const ValueKey('user-profile-message-error'),
                        padding: const EdgeInsets.only(top: Grid.xxs),
                        child: Text(
                          message,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: context.colors.error,
                          ),
                        ),
                      ),
                    const SizedBox(height: Grid.xs),

                    // About / bio section
                    if (about.isNotEmpty) ...[
                      const SizedBox(height: Grid.xxs),
                      Divider(
                        color: context.colors.outlineVariant.withValues(
                          alpha: 0.3,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        platformText(
                          PlatformMessageKey.platformProfileAbout,
                          locale: locale,
                        ),
                        style: context.textTheme.labelSmall?.copyWith(
                          color: context.colors.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: Grid.half),
                      Text(
                        about,
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: context.colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shows clipboard feedback above the bottom-sheet route. A regular SnackBar
/// belongs to the page Scaffold, which sits behind the modal sheet.
void _showProfileCopyToast(BuildContext context) {
  final overlay = Overlay.of(context, rootOverlay: true);
  final colors = context.colors;
  final textStyle = context.textTheme.bodyMedium?.copyWith(
    color: colors.onInverseSurface,
  );
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (overlayContext) => Positioned(
      left: Grid.gutter,
      right: Grid.gutter,
      bottom: MediaQuery.viewPaddingOf(overlayContext).bottom + Grid.xs,
      child: Material(
        color: colors.inverseSurface,
        elevation: 6,
        borderRadius: BorderRadius.circular(Radii.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Grid.xs,
            vertical: Grid.twelve,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.check, size: 18, color: colors.onInverseSurface),
              const SizedBox(width: Grid.xxs),
              Text(
                platformText(
                  PlatformMessageKey.platformProfileCopied,
                  locale: Localizations.localeOf(context).toLanguageTag(),
                ),
                style: textStyle,
              ),
            ],
          ),
        ),
      ),
    ),
  );
  overlay.insert(entry);
  Future<void>.delayed(const Duration(seconds: 2), () {
    if (entry.mounted) entry.remove();
  });
}

class _ProfileAvatar extends HookWidget {
  final String? avatarUrl;
  final String initial;

  const _ProfileAvatar({required this.avatarUrl, required this.initial});

  @override
  Widget build(BuildContext context) {
    final animatedAvatar = parseAnimatedAvatarUrl(avatarUrl);
    final stoppedAnimationUrl = useState<String?>(null);
    final isPlaying =
        animatedAvatar != null &&
        stoppedAnimationUrl.value != animatedAvatar.animationUrl;

    return AspectRatio(
      aspectRatio: 1,
      child: GestureDetector(
        key: const ValueKey('selected-profile-avatar'),
        onTap: animatedAvatar == null
            ? null
            : () => stoppedAnimationUrl.value =
                  stoppedAnimationUrl.value == animatedAvatar.animationUrl
                  ? null
                  : animatedAvatar.animationUrl,
        child: ClipOval(
          child: isPlaying
              ? ProgressiveAnimatedAvatar(
                  key: ValueKey(animatedAvatar.animationUrl),
                  descriptor: animatedAvatar,
                  fallback: _AvatarFallback(initial: initial),
                )
              : AvatarImageContent(
                  imageUrl: animatedAvatar?.posterUrl ?? avatarUrl,
                  fallback: _AvatarFallback(initial: initial),
                ),
        ),
      ),
    );
  }
}

class _AvatarFallback extends StatelessWidget {
  final String initial;

  const _AvatarFallback({required this.initial});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: context.colors.primaryContainer,
      alignment: Alignment.center,
      child: Text(
        initial,
        style: context.textTheme.displayLarge?.copyWith(
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// The read-only version of the presence control in Settings. A viewed profile
/// reflects its owner's availability but does not allow another user to change
/// it.
class _ProfilePresenceChip extends StatelessWidget {
  const _ProfilePresenceChip({required this.presence});

  final String presence;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final effectivePresence = switch (presence) {
      'online' || 'away' => presence,
      _ => 'offline',
    };
    final backgroundColor = switch (effectivePresence) {
      'online' => context.appColors.success,
      'away' => context.appColors.warning,
      _ => context.colors.onSurfaceVariant,
    };
    final label = platformText(switch (effectivePresence) {
      'online' => PlatformMessageKey.presenceOnline,
      'away' => PlatformMessageKey.presenceAway,
      _ => PlatformMessageKey.presenceOffline,
    }, locale: locale);

    return Semantics(
      label:
          '${platformText(PlatformMessageKey.presenceChooser, locale: locale)}: $label',
      child: SizedBox(
        key: const ValueKey('user-profile-presence-chip'),
        height: Grid.xl,
        child: Center(
          child: Material(
            color: backgroundColor,
            borderRadius: BorderRadius.circular(Radii.full),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Grid.xs,
                vertical: Grid.xxs,
              ),
              child: ExcludeSemantics(
                child: Text(
                  label,
                  style: filterChipTextStyle.copyWith(
                    color: context.colors.onPrimary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
