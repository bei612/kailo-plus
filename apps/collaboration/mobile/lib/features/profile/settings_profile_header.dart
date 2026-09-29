import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import 'profile_avatar.dart';

/// 设置页顶部的本人信息。显示名取自 Kailo 的 HumanIdentity（经 BFF 会话），
/// 不取 Relay 上的 kind:0：原生设备密钥没有、也不能发布自己的资料。
class SettingsProfileHeader extends ConsumerWidget {
  const SettingsProfileHeader({super.key});

  static const _avatarSize = 96.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(kailoSessionViewProvider);
    return Padding(
      key: const ValueKey('settings-profile-header'),
      padding: const EdgeInsets.only(top: Grid.sm, bottom: Grid.twelve),
      child: Column(
        children: [
          const ProfileAvatar(size: _avatarSize),
          const SizedBox(height: Grid.twelve),
          Text(
            session.value?.displayName ?? '',
            style: context.textTheme.titleLarge,
          ),
        ],
      ),
    );
  }
}
