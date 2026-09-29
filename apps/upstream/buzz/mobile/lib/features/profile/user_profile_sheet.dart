import 'dart:async';

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
import '../../shared/profile/user_cache_provider.dart';

/// Show a user profile bottom sheet for the given [pubkey].
void showUserProfileSheet(BuildContext context, String pubkey) {
  showBuzzModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: false,
    builder: (_) => UserProfileSheet(pubkey: pubkey),
  );
}

class UserProfileSheet extends HookConsumerWidget {
  final String pubkey;

  const UserProfileSheet({super.key, required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pk = pubkey.toLowerCase();

    // Watch the cached profile.
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);

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
      ref.read(userCacheProvider.notifier).preload([pk]);
      return null;
    }, [pk]);
    final copied = useState(false);

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
                    const SizedBox(height: Grid.xs),

                    // Display name — centered, large
                    Center(
                      child: Text(
                        displayName ?? shortPubkey(pubkey),
                        style: context.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
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

                    BuzzActionTile(
                      icon: copied.value ? LucideIcons.check : LucideIcons.key,
                      label: copied.value ? 'Copied' : 'Copy public key',
                      isEnabled: npub != null,
                      onTap: copyPublicKey,
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
                        'About',
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
              Text('Public key copied', style: textStyle),
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
