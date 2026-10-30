part of '../invite_create_page.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/invites/invite_create_page/invite_link_section.dart. Kailo: the link is
// issued on request for a named invitee instead of being minted on open, appears only in the
// first response (kept in widget memory, never stored), and is copied, not shared through a
// relay URL. An unknown outcome keeps the frozen command; the button then resends exactly it.
class _InviteLinkSection extends HookConsumerWidget {
  const _InviteLinkSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final actions = ref.watch(communityInviteActionsProvider);
    final label = useTextEditingController();
    useListenable(label);
    final outcome = useState<InviteIssueOutcome?>(null);
    final busy = useState(false);
    final retained = actions.retained;

    Future<void> issue() async {
      if (busy.value) return;
      busy.value = true;
      try {
        final result = await actions.issue(label.text);
        if (!context.mounted || result == null) return;
        // A retry that is still unknown keeps the first unknown message.
        if (result is InviteIssueUnknown &&
            outcome.value is InviteIssueUnknown) {
          return;
        }
        outcome.value = result;
        if (result is InviteIssued) label.clear();
      } finally {
        if (context.mounted) busy.value = false;
      }
    }

    final canSubmit =
        !busy.value && (retained != null || label.text.trim().isNotEmpty);
    final result = outcome.value;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('community-invite-label'),
            controller: label,
            enabled: !busy.value && retained == null,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => canSubmit ? unawaited(issue()) : null,
            decoration: InputDecoration(
              labelText: t(PlatformMessageKey.invitationsInviteeLabel),
              helperText: t(PlatformMessageKey.invitationsInviteeHint),
              helperMaxLines: 3,
            ),
          ),
          const SizedBox(height: Grid.xs),
          FilledButton(
            key: const Key('community-invite-issue'),
            onPressed: canSubmit ? () => unawaited(issue()) : null,
            child: Text(
              t(
                retained != null
                    ? PlatformMessageKey.platformRetry
                    : PlatformMessageKey.invitationsIssue,
              ),
            ),
          ),
          if (result != null) ...[
            const SizedBox(height: Grid.sm),
            _IssueResult(outcome: result, locale: locale),
          ],
        ],
      ),
    );
  }
}

class _IssueResult extends StatelessWidget {
  const _IssueResult({required this.outcome, required this.locale});

  final InviteIssueOutcome outcome;
  final String locale;

  @override
  Widget build(BuildContext context) {
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final message = switch (outcome) {
      InviteIssued(:final label, :final invitation) =>
        t(PlatformMessageKey.invitationsIssued, {
          'label': label,
          'expires': platformRelativeTime(invitation.expiresAt, locale: locale),
        }),
      InviteIssuedWithoutLink() => t(PlatformMessageKey.invitationsNoLink),
      InviteIssueUnknown(:final operation) => t(
        PlatformMessageKey.invitationsIssueUnknown,
        {'operation': operation ?? '—'},
      ),
      InviteIssueRejected(:final reason, :final error) =>
        t(PlatformMessageKey.invitationsIssueRejected, {
          'reason': reason != null
              ? platformReasonText(reason, locale: locale)
              : platformErrorText(error ?? Exception(), locale: locale),
        }),
    };
    final rejected = outcome is InviteIssueRejected;
    final link = switch (outcome) {
      InviteIssued(:final invitation) => invitation.link,
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            message,
            key: const Key('community-invite-result'),
            style: context.textTheme.bodySmall?.copyWith(
              color: rejected
                  ? context.colors.error
                  : context.colors.onSurfaceVariant,
            ),
          ),
        ),
        if (link != null) ...[
          const SizedBox(height: Grid.xs),
          SelectableText(
            link,
            key: const Key('community-invite-link'),
            style: context.textTheme.bodySmall,
          ),
          const SizedBox(height: Grid.xs),
          BuzzActionTile(
            key: const Key('community-invite-copy-link'),
            icon: LucideIcons.copy,
            label: t(PlatformMessageKey.invitationsCopy),
            onTap: () async {
              await Clipboard.setData(ClipboardData(text: link));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(t(PlatformMessageKey.invitationsLinkCopied)),
                ),
              );
            },
          ),
        ],
      ],
    );
  }
}
