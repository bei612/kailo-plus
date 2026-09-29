import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';

/// Matches desktop's sidebar profile card, whose avatar is 32px.
const _defaultAvatarSize = 32.0;

/// 本人头像：Kailo 显示名的首字母。
class ProfileAvatar extends ConsumerWidget {
  final VoidCallback? onTap;

  /// The avatar diameter in logical pixels; defaults to the 32px desktop match.
  final double size;

  const ProfileAvatar({super.key, this.onTap, this.size = _defaultAvatarSize});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = ref.watch(kailoSessionViewProvider).value?.displayName.trim();
    final initial = name == null || name.isEmpty
        ? '?'
        : name.characters.first.toUpperCase();
    return GestureDetector(
      onTap: onTap,
      child: CircleAvatar(
        radius: size / 2,
        backgroundColor: context.colors.primaryContainer,
        child: Text(
          initial,
          style:
              (size > 48
                      ? context.textTheme.headlineMedium
                      : context.textTheme.labelMedium)
                  ?.copyWith(color: context.colors.onPrimaryContainer),
        ),
      ),
    );
  }
}
