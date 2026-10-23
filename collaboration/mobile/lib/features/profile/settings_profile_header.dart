import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/custom_emoji/custom_emoji_provider.dart';
import '../../shared/custom_emoji/custom_emoji_render.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/masked_avatar_badge.dart';
import 'profile_avatar.dart';
import 'set_status_sheet.dart';
import 'user_status_provider.dart';

/// 设置页顶部的本人信息。显示名取自平台的 HumanIdentity（经 BFF 会话）。
///
/// Buzz 779af8886caae1317b4de962082429867ab61503
/// mobile/lib/features/profile/settings_profile_header.dart: the status badge notched out of
/// the avatar and the status text both open the original status sheet (NIP-38 30315 signed by
/// this device's CLIENT key, DD-75/DD-120). The kind:20001 presence pill is not restored.
class SettingsProfileHeader extends ConsumerWidget {
  const SettingsProfileHeader({super.key});

  static const _avatarSize = 96.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(platformSessionViewProvider);
    final status = ref.watch(userStatusProvider).asData?.value;
    final hasStatus = status != null && !status.isEmpty;

    void openStatusSheet() =>
        showSetStatusSheet(context, currentStatus: status);

    return Padding(
      key: const ValueKey('settings-profile-header'),
      padding: const EdgeInsets.only(top: Grid.sm, bottom: Grid.twelve),
      child: Column(
        children: [
          MaskedAvatarBadge(
            size: _avatarSize,
            avatar: const ProfileAvatar(size: _avatarSize),
            badge: _StatusBadge(
              emoji: status?.emoji ?? '',
              onTap: openStatusSheet,
            ),
          ),
          const SizedBox(height: Grid.twelve),
          Text(
            session.value?.displayName ?? '',
            style: context.textTheme.titleLarge,
          ),
          // Keep the status text visible even when no emoji is set. NIP-38
          // permits text-only statuses, which the avatar badge cannot represent.
          if (hasStatus)
            GestureDetector(
              onTap: openStatusSheet,
              child: Padding(
                padding: const EdgeInsets.only(
                  top: Grid.quarter,
                  left: Grid.gutter,
                  right: Grid.gutter,
                  bottom: Grid.half,
                ),
                child: Text(
                  status.text.isNotEmpty ? status.text : status.emoji,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.colors.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Fills the notch left by [MaskedAvatarBadge], so its size comes from the mask
/// geometry rather than being set here.
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.emoji, required this.onTap});

  final String emoji;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: platformText(
        PlatformMessageKey.userStatusTitle,
        locale: Localizations.localeOf(context).toLanguageTag(),
      ),
      child: GestureDetector(
        key: const ValueKey('settings-status-badge'),
        onTap: onTap,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: context.colors.surfaceContainerHighest,
            shape: BoxShape.circle,
          ),
          child: Center(child: _StatusGlyph(emoji: emoji)),
        ),
      ),
    );
  }
}

/// The status emoji, resolving `:shortcode:` values against the community's
/// custom emoji. Falls back to the add-status icon when no status is set.
class _StatusGlyph extends ConsumerWidget {
  const _StatusGlyph({required this.emoji});

  final String emoji;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (emoji.isEmpty) {
      return Icon(
        LucideIcons.smilePlus,
        size: 20,
        color: context.colors.onSurfaceVariant,
      );
    }

    final shortcode = emoji.startsWith(':') && emoji.endsWith(':')
        ? emoji.substring(1, emoji.length - 1).toLowerCase()
        : null;
    if (shortcode != null) {
      for (final entry in ref.watch(customEmojiListProvider)) {
        if (entry.shortcode == shortcode) {
          return CustomEmojiImage(
            shortcode: shortcode,
            url: entry.url,
            size: 22,
          );
        }
      }
      return Icon(
        LucideIcons.smile,
        size: 20,
        color: context.colors.onSurfaceVariant,
      );
    }

    return Text(emoji, style: const TextStyle(fontSize: 20));
  }
}
