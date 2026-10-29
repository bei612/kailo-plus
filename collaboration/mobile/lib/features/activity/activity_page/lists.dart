part of '../activity_page.dart';

/// Reminders surface for the Reminders filter — due/pending NIP-ER
/// reminders that deep-link to their target message.
class _RemindersList extends ConsumerWidget {
  final ScrollController scrollController;
  final void Function(Reminder reminder) onOpen;
  final Future<void> Function() onRefresh;

  const _RemindersList({
    required this.scrollController,
    required this.onOpen,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final remindersAsync = ref.watch(remindersProvider);
    final reminders = [
      for (final r in remindersAsync.value ?? const <Reminder>[])
        if (r.status == 'pending') r,
    ];

    if (remindersAsync.isLoading && reminders.isEmpty) {
      return Center(
        child: BuzzLoadingIndicator(
          size: 44,
          semanticLabel: _activityText(
            context,
            PlatformMessageKey.remindersLoading,
          ),
        ),
      );
    }
    if (reminders.isEmpty) {
      return _EmptySurface(
        icon: LucideIcons.clock,
        message: _activityText(context, PlatformMessageKey.remindersEmpty),
        detail: _activityText(context, PlatformMessageKey.remindersEmptyHint),
      );
    }

    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return BeeRefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        controller: scrollController,
        padding: _activityScrollPadding(context),
        itemCount: reminders.length,
        itemBuilder: (context, index) {
          final reminder = reminders[index];
          final due = reminder.isDue(now);
          final title = reminder.note?.trim().isNotEmpty == true
              ? reminder.note!.trim()
              : reminder.target?.preview ??
                    _activityText(context, PlatformMessageKey.remindersTitle);
          return ListTile(
            key: ValueKey('reminder-row-${reminder.id}'),
            leading: Icon(
              due ? LucideIcons.bellRing : LucideIcons.clock,
              size: 20,
              color: due
                  ? context.colors.primary
                  : context.colors.onSurfaceVariant,
            ),
            title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: reminder.notBefore != null
                ? Text(
                    due
                        ? _activityText(
                            context,
                            PlatformMessageKey.activityDueNow,
                          )
                        : _activityText(
                            context,
                            PlatformMessageKey.activityDueAt,
                            {
                              'time': _inboxTimestamp(
                                reminder.notBefore!,
                                locale: _activityLocale(context),
                              ),
                            },
                          ),
                  )
                : null,
            onTap: () => onOpen(reminder),
          );
        },
      ),
    );
  }
}

/// Drafts surface for the Drafts filter — locally saved unsent composer
/// text that reopens the target composer.
class _DraftsList extends StatelessWidget {
  final List<ComposeDraft> drafts;
  final ScrollController scrollController;
  final Map<String, Channel> channelById;
  final String? myPubkey;
  final void Function(ComposeDraft draft) onOpen;
  final void Function(ComposeDraft draft) onDelete;

  const _DraftsList({
    required this.drafts,
    required this.scrollController,
    required this.channelById,
    required this.myPubkey,
    required this.onOpen,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    if (drafts.isEmpty) {
      return _EmptySurface(
        icon: LucideIcons.filePen,
        message: _activityText(context, PlatformMessageKey.activityDraftsEmpty),
        detail: _activityText(
          context,
          PlatformMessageKey.activityDraftsEmptyHint,
        ),
      );
    }

    return ListView.builder(
      controller: scrollController,
      padding: _activityScrollPadding(context),
      itemCount: drafts.length,
      itemBuilder: (context, index) {
        final draft = drafts[index];
        final channel = channelById[draft.channelId];
        final destination = channel == null
            ? _activityText(
                context,
                PlatformMessageKey.activityUnavailableChannel,
              )
            : channel.isDm
            ? resolveDmChannelDisplayLabel(channel, currentPubkey: myPubkey)
            : '#${channel.name}';
        return ListTile(
          key: ValueKey('draft-row-${draft.key}'),
          leading: Icon(
            LucideIcons.filePen,
            size: 20,
            color: context.colors.onSurfaceVariant,
          ),
          title: Text(draft.text, maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text(
            draft.threadHeadId != null
                ? _activityText(
                    context,
                    PlatformMessageKey.activityDraftThreadIn,
                    {'destination': destination},
                  )
                : destination,
          ),
          trailing: IconButton(
            icon: const Icon(LucideIcons.trash2, size: 18),
            tooltip: _activityText(
              context,
              PlatformMessageKey.activityDeleteDraft,
            ),
            onPressed: () => onDelete(draft),
          ),
          onTap: () => onOpen(draft),
        );
      },
    );
  }
}

/// Inbox list timestamp — desktop's `formatInboxTimestamp`:
/// time today, "Yesterday", short date this year, dated otherwise.
String _inboxTimestamp(int unixSeconds, {DateTime? now, String? locale}) {
  final current = now ?? DateTime.now();
  final date = DateTime.fromMillisecondsSinceEpoch(unixSeconds * 1000);
  final today = DateTime(current.year, current.month, current.day);
  final day = DateTime(date.year, date.month, date.day);
  final dayDiff = today.difference(day).inDays;
  final intlLocale = platformIntlLocale(locale: locale);

  if (dayDiff == 0) return DateFormat.jm(intlLocale).format(date);
  if (dayDiff == 1) {
    return platformText(PlatformMessageKey.chatTimeYesterday, locale: locale);
  }
  return date.year == current.year
      ? DateFormat.MMMd(intlLocale).format(date)
      : DateFormat.yMMMd(intlLocale).format(date);
}
