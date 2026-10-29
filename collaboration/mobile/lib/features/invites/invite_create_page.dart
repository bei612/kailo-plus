// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/invites/invite_create_page.dart. Kailo: the original "Invite to community"
// page issues one DD-83 invitation link per named invitee (invite_create_provider.dart). The
// original "Or use npub" person section is not offered: membership is created only by redeeming
// an invitation and an admin's confirmation (`tenant.member.add` is not registered, DD-83).
import 'dart:async';

import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_action_tile.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../platform/platform_async_view.dart';
import 'invite_create_provider.dart';

part 'invite_create_page/invite_link_section.dart';

/// A page for authorized community members to create invitation links.
class CommunityInvitePage extends ConsumerWidget {
  /// Creates the community invitation page.
  const CommunityInvitePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final access = ref.watch(inviteAccessProvider);
    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(
        centerTitle: true,
        title: Text(
          platformText(
            PlatformMessageKey.invitationsCommunityInvite,
            locale: locale,
          ),
        ),
      ),
      body: switch (access) {
        AsyncData(value: InviteAccess.denied) => _InviteMessage(
          icon: LucideIcons.shieldAlert,
          title: platformText(
            PlatformMessageKey.invitationsAccessRequired,
            locale: locale,
          ),
          body: platformText(
            PlatformMessageKey.invitationsAccessRequiredBody,
            locale: locale,
          ),
        ),
        AsyncData() || AsyncError() => const _CommunityInviteBody(),
        _ => Center(
          child: BuzzLoadingIndicator(
            size: 48,
            semanticLabel: platformText(
              PlatformMessageKey.invitationsCheckingAccess,
              locale: locale,
            ),
          ),
        ),
      },
    );
  }
}

class _CommunityInviteBody extends StatelessWidget {
  const _CommunityInviteBody();

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return ListView(
      padding: EdgeInsets.fromLTRB(
        0,
        frostedAppBarHeight(context) + Grid.xs,
        0,
        Grid.lg,
      ),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
          child: Text(
            platformText(PlatformMessageKey.invitationsExplain, locale: locale),
            style: context.textTheme.bodyMedium?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: Grid.sm),
        const _InviteLinkSection(),
      ],
    );
  }
}

class _InviteMessage extends StatelessWidget {
  const _InviteMessage({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 36, color: context.colors.onSurfaceVariant),
            const SizedBox(height: Grid.xs),
            Text(title, style: context.textTheme.titleMedium),
            const SizedBox(height: Grid.xxs),
            Text(
              body,
              textAlign: TextAlign.center,
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
