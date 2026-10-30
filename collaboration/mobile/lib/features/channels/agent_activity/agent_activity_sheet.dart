// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/agent_activity/agent_activity_sheet.dart. Kailo Agents do not
// publish 24200/44200 observer frames (DD-125(6)), so the original live transcript is read from
// Core instead: the Workspace's running turns (`agent-turns`) and that AgentSession's Codex items
// (`transcript`), both Installation `audit` reads that Core admits and audits on every request.
// A member without `audit` sees the Agent's 20002 "working" signal and is told the detail is
// audit-only; nothing is polled — the turn list and transcript are re-read when the Agent's
// working signal changes, on pull-to-refresh, and on demand ("load more").
// "Stop current turn" is the governed Agent turn cancel (DD-84 widened by DD-125(6),
// task.cancel.agent.invoke.v1): offered only when Core puts `cancelActionKey` on the turn (the
// turn's initiator or an Installation `manage` holder), the intent is frozen with its key and an
// unknown outcome keeps that same command for a retry; an accepted cancel is not the end of the
// turn, the turn list and transcript show the real end (client-kit useInterruptTurn).
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../shared/platform/agent_activity_api.dart';
import '../../../shared/platform/platform_api.dart';
import '../../../shared/profile/user_cache_provider.dart';
import '../../../shared/theme/theme.dart';
import '../../../shared/utils/string_utils.dart';
import '../../../shared/widgets/buzz_loading_indicator.dart';
import '../channel_governed_actions.dart';
import 'working_agents_provider.dart';

/// Pages read in one go before "load more" is offered; each page is an audited read.
const _maxPagesPerLoad = 10;

/// Command output shown per item; the full text stays in the native session.
const _maxOutputChars = 4000;

/// Full-height sheet with one admitted Agent's current activity in [channelId].
class AgentActivitySheet extends HookConsumerWidget {
  const AgentActivitySheet({
    super.key,
    required this.channelId,
    required this.installationId,
    required this.agentPubkey,
    this.agentName,
  });

  final String channelId;
  final String installationId;
  final String agentPubkey;

  /// The pinned version's persona name from the author directory, when it has one.
  final String? agentName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);

    final pk = agentPubkey.toLowerCase();
    final working = ref.watch(
      workingAgentPubkeysProvider(channelId).select((set) => set.contains(pk)),
    );
    final turnsAsync = ref.watch(platformAgentActiveTurnsProvider(channelId));
    final profile = ref.watch(userCacheProvider.select((cache) => cache[pk]));
    final persona = agentName?.trim();
    final name = persona != null && persona.isNotEmpty
        ? persona
        : profile?.label ?? shortPubkey(agentPubkey);

    useEffect(() {
      ref.read(userCacheProvider.notifier).preload([agentPubkey]);
      return null;
    }, [agentPubkey]);

    // The working signal is the only trigger: a change re-reads the audited turn list.
    final firstWorking = useRef(true);
    useEffect(() {
      if (firstWorking.value) {
        firstWorking.value = false;
        return null;
      }
      ref.invalidate(platformAgentActiveTurnsProvider(channelId));
      return null;
    }, [working]);

    // A re-read keeps the previous page until the new one lands, so the open transcript is
    // not torn down and re-read just because the turn list is being refreshed.
    final turn = turnsAsync.value?.turns
        .where((row) => row.installationId == installationId)
        .firstOrNull;
    final transcript = _useTranscript(ref, turn);

    Future<void> refresh() async {
      ref.invalidate(platformAgentActiveTurnsProvider(channelId));
      await ref.read(platformAgentActiveTurnsProvider(channelId).future);
      await transcript.reload();
    }

    // The turn start is a native fact only `audit` holders receive; it is shown as the
    // clock time it happened, never estimated from this device's clock.
    final startedAt = DateTime.tryParse(turn?.startedAt ?? '')?.toLocal();
    final statusLine = turn != null || working
        ? t(PlatformMessageKey.agentActivityPopoverWorking)
        : null;
    final startedLine = startedAt == null
        ? null
        : t(PlatformMessageKey.agentTranscriptTurnStarted, {
            'time': DateFormat.jm(
              platformIntlLocale(locale: locale),
            ).format(startedAt),
          });

    return DraggableScrollableSheet(
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        final bottomPadding =
            MediaQuery.viewPaddingOf(context).bottom + Grid.sm;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        LucideIcons.bot,
                        size: 18,
                        color: context.colors.onSurface,
                      ),
                      const SizedBox(width: Grid.xxs),
                      Expanded(
                        child: Text(
                          name,
                          key: const ValueKey('agent-activity-name'),
                          style: context.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (statusLine != null) _WorkingBadge(label: statusLine),
                    ],
                  ),
                  if (startedLine != null) ...[
                    const SizedBox(height: Grid.half),
                    Text(
                      startedLine,
                      key: const ValueKey('agent-activity-started'),
                      style: context.textTheme.bodySmall?.copyWith(
                        color: context.colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                  if (turn != null)
                    AgentTurnStopControl(
                      channelId: channelId,
                      turn: turn,
                      agentName: name,
                    ),
                  const SizedBox(height: Grid.xxs),
                  Divider(color: context.colors.outlineVariant),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: refresh,
                child: _body(
                  context,
                  t: t,
                  locale: locale,
                  name: name,
                  working: working,
                  turnsAsync: turnsAsync,
                  turn: turn,
                  transcript: transcript,
                  scrollController: scrollController,
                  bottomPadding: bottomPadding,
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _body(
    BuildContext context, {
    required String Function(PlatformMessageKey, [Map<String, Object>?]) t,
    required String locale,
    required String name,
    required bool working,
    required AsyncValue<AgentActiveTurnPage> turnsAsync,
    required AgentActiveTurnView? turn,
    required _TranscriptState transcript,
    required ScrollController scrollController,
    required double bottomPadding,
  }) {
    Widget message(String text, {Key? key, bool spinner = false}) => ListView(
      controller: scrollController,
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.md,
        Grid.gutter,
        bottomPadding,
      ),
      children: [
        if (spinner) ...[
          Center(
            child: BuzzLoadingIndicator(
              size: 28,
              color: context.colors.onSurfaceVariant,
              semanticLabel: text,
            ),
          ),
          const SizedBox(height: Grid.xxs),
        ],
        Text(
          text,
          key: key,
          textAlign: TextAlign.center,
          style: context.textTheme.bodySmall?.copyWith(
            color: context.colors.onSurfaceVariant,
          ),
        ),
      ],
    );

    if (turnsAsync.hasError && !turnsAsync.hasValue) {
      return message(
        _failureText(turnsAsync.error!, locale),
        key: const ValueKey('agent-activity-error'),
      );
    }
    if (!turnsAsync.hasValue) {
      return message(
        t(PlatformMessageKey.agentTranscriptWaiting),
        spinner: true,
      );
    }
    if (turn == null) {
      // No audited turn row: either the Agent is idle, or the reader has no `audit` and
      // only sees the 20002 working signal.
      return message(
        working
            ? t(PlatformMessageKey.agentActivityAuditOnly)
            : t(PlatformMessageKey.agentTranscriptEmptyChannel, {'name': name}),
        key: ValueKey(
          working ? 'agent-activity-audit-only' : 'agent-activity-idle',
        ),
      );
    }
    if (transcript.error case final error?) {
      return message(
        error is PlatformApiError && error.response.status == 403
            ? t(PlatformMessageKey.agentTranscriptRevoked)
            : _failureText(error, locale),
        key: const ValueKey('agent-activity-error'),
      );
    }
    if (transcript.items.isEmpty) {
      return message(
        t(PlatformMessageKey.agentTranscriptWaiting),
        spinner: transcript.loading,
      );
    }
    final items = transcript.items;
    return ListView.builder(
      key: const ValueKey('agent-activity-transcript'),
      controller: scrollController,
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xxs,
        Grid.gutter,
        bottomPadding,
      ),
      itemCount: items.length + (transcript.nextCursor == null ? 0 : 1),
      itemBuilder: (context, index) {
        if (index == items.length) {
          return Center(
            child: TextButton(
              key: const ValueKey('agent-activity-load-more'),
              onPressed: transcript.loading ? null : transcript.loadMore,
              child: Text(t(PlatformMessageKey.agentTranscriptLoadMore)),
            ),
          );
        }
        return AgentTranscriptItemTile(item: items[index], agentName: name);
      },
    );
  }
}

/// The original "Stop current turn" entry for one running [turn].
class AgentTurnStopControl extends HookConsumerWidget {
  const AgentTurnStopControl({
    super.key,
    required this.channelId,
    required this.turn,
    required this.agentName,
  });

  final String channelId;
  final AgentActiveTurnView turn;
  final String agentName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final busy = useState(false);
    final ChannelGovernedActions actions;
    try {
      actions = ref.watch(channelGovernedActionsProvider);
    } on Object {
      // No platform session (Riverpod surfaces the provider's PlatformNotSignedIn): no entry.
      return const SizedBox.shrink();
    }
    // One frozen intent per original agent.invoke execution; another turn starts a new one.
    final slot = 'agent-turn-cancel:${turn.originalActionExecutionId}';
    final retained = actions.retained(slot);
    final cancelKey = turn.cancelActionKey;
    if (cancelKey == null && retained == null) return const SizedBox.shrink();

    Future<void> stop() async {
      busy.value = true;
      final ChannelActionOutcome? outcome;
      try {
        outcome = await actions.submit(
          slot,
          (key) => ActionCommand(
            actionKey: cancelKey!,
            idempotencyKey: key,
            originalActionExecutionId: turn.originalActionExecutionId,
          ),
        );
      } finally {
        if (context.mounted) busy.value = false;
      }
      if (outcome == null || !context.mounted) return;
      final text = switch (outcome) {
        ChannelActionRecorded() => t(
          PlatformMessageKey.agentTranscriptStopSent,
          {'name': agentName},
        ),
        ChannelActionUnknown(:final operation) => t(
          PlatformMessageKey.agentTranscriptStopUnknown,
          {'operation': operation ?? '—'},
        ),
        ChannelActionRejected(:final reason?) => platformReasonText(
          reason,
          locale: locale,
        ),
        ChannelActionRejected() => t(
          PlatformMessageKey.agentTranscriptStopFailed,
          {'name': agentName},
        ),
        _ => channelActionOutcomeText(outcome, locale: locale),
      };
      ScaffoldMessenger.maybeOf(
        context,
      )?.showSnackBar(SnackBar(content: Text(text)));
      // A settled answer re-reads the audited turn list; the turn ends there, not here.
      if (outcome is! ChannelActionUnknown) {
        ref.invalidate(platformAgentActiveTurnsProvider(channelId));
      }
    }

    return Padding(
      padding: const EdgeInsets.only(top: Grid.xxs),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: OutlinedButton.icon(
          key: const ValueKey('agent-activity-stop'),
          onPressed: busy.value || actions.busy(slot) ? null : stop,
          icon: const Icon(LucideIcons.square, size: 14),
          label: Text(
            t(
              retained != null
                  ? PlatformMessageKey.agentTranscriptStopRetry
                  : PlatformMessageKey.agentTranscriptStopLabel,
            ),
          ),
        ),
      ),
    );
  }
}

String _failureText(Object error, String locale) {
  if (error is PlatformApiError) {
    final body = error.response.error;
    if (body != null) {
      return '${platformReasonText(body.reason, locale: locale)} '
          '(${platformReasonCode(body.reason)})';
    }
  }
  return platformText(PlatformMessageKey.platformLoadFailed, locale: locale);
}

class _TranscriptState {
  const _TranscriptState({
    required this.items,
    required this.nextCursor,
    required this.loading,
    required this.error,
    required this.reload,
    required this.loadMore,
  });

  final List<AgentTranscriptItem> items;
  final String? nextCursor;
  final bool loading;
  final Object? error;
  final Future<void> Function() reload;
  final Future<void> Function() loadMore;
}

/// Reads [turn]'s session in ascending pages. A result for a session that is no longer the
/// current one is dropped (generation fence), never merged into the newer transcript.
_TranscriptState _useTranscript(WidgetRef ref, AgentActiveTurnView? turn) {
  final items = useState<List<AgentTranscriptItem>>(const []);
  final nextCursor = useState<String?>(null);
  final loading = useState(false);
  final error = useState<Object?>(null);
  final generation = useRef(0);
  final context = useContext();
  final scope = turn == null
      ? null
      : '${turn.installationId}|${turn.rootEventId}|${turn.projectionGeneration}';

  Future<void> read({required bool fromStart}) async {
    final current = turn;
    if (current == null) return;
    final token = ++generation.value;
    loading.value = true;
    error.value = null;
    final reader = ref.read(agentTranscriptReaderProvider);
    final collected = fromStart ? <AgentTranscriptItem>[] : [...items.value];
    String? cursor = fromStart ? null : nextCursor.value;
    try {
      for (var page = 0; page < _maxPagesPerLoad; page++) {
        final result = await reader(current, cursor: cursor);
        if (!context.mounted || token != generation.value) return;
        collected.addAll(result.items);
        cursor = result.nextCursor;
        if (cursor == null) break;
      }
      items.value = _mergeById(collected);
      nextCursor.value = cursor;
    } catch (failure) {
      if (!context.mounted || token != generation.value) return;
      error.value = failure;
    } finally {
      if (context.mounted && token == generation.value) loading.value = false;
    }
  }

  // A new session starts a new read; the newer read's token makes any older result stale.
  // Losing the turn (it finished, or the list is being re-read) keeps what was read.
  useEffect(() {
    if (turn == null) return null;
    items.value = const [];
    nextCursor.value = null;
    error.value = null;
    read(fromStart: true);
    return null;
  }, [scope]);

  return _TranscriptState(
    items: items.value,
    nextCursor: nextCursor.value,
    loading: loading.value,
    error: error.value,
    reload: () => read(fromStart: true),
    loadMore: () => read(fromStart: false),
  );
}

/// item/started then item/completed carry the same id; the later state wins in place.
List<AgentTranscriptItem> _mergeById(List<AgentTranscriptItem> items) {
  final index = <String, int>{};
  final merged = <AgentTranscriptItem>[];
  for (final item in items) {
    final at = index[item.itemId];
    if (at == null) {
      index[item.itemId] = merged.length;
      merged.add(item);
    } else {
      merged[at] = item;
    }
  }
  return merged;
}

class _WorkingBadge extends StatelessWidget {
  const _WorkingBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final color = context.appColors.success;
    return Container(
      key: const ValueKey('agent-activity-working'),
      padding: const EdgeInsets.symmetric(
        horizontal: Grid.xxs,
        vertical: Grid.quarter,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: Grid.half),
          Text(
            label,
            style: context.textTheme.labelSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// Buzz 779af8886caae1317b4de962082429867ab61503
// `mobile/lib/features/channels/agent_activity/transcript_item_widget.dart`: the original per-item
// rendering (message, thought, lifecycle, metadata, tool) over Core's audited transcript items.
/// One Codex item in the original transcript shape: a headline and its body.
class AgentTranscriptItemTile extends StatelessWidget {
  const AgentTranscriptItemTile({
    super.key,
    required this.item,
    required this.agentName,
  });

  final AgentTranscriptItem item;
  final String agentName;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final failed =
        item.status == AgentTranscriptItemStatus.FAILED ||
        item.status == AgentTranscriptItemStatus.DECLINED;
    String toolHeadline(PlatformMessageKey key) => failed
        ? t(PlatformMessageKey.agentTranscriptToolFailed, {'label': t(key)})
        : t(key);

    final (
      IconData icon,
      String headline,
      String? body,
      bool mono,
    ) = switch (item.kind) {
      AgentTranscriptItemKind.USER_MESSAGE => (
        LucideIcons.user,
        t(PlatformMessageKey.agentTranscriptHeadlineUserPrompt),
        item.text,
        false,
      ),
      AgentTranscriptItemKind.AGENT_MESSAGE => (
        LucideIcons.bot,
        agentName,
        item.text,
        false,
      ),
      AgentTranscriptItemKind.REASONING => (
        LucideIcons.brain,
        t(PlatformMessageKey.agentTranscriptThinking),
        (item.reasoningSummary ?? const <String>[]).join('\n\n'),
        false,
      ),
      AgentTranscriptItemKind.COMMAND_EXECUTION => (
        LucideIcons.squareTerminal,
        toolHeadline(PlatformMessageKey.agentTranscriptToolRanCommand),
        [
          if (item.command case final command?) '\$ $command',
          if (item.aggregatedOutput case final output?)
            output.length > _maxOutputChars
                ? '${output.substring(0, _maxOutputChars)}…'
                : output,
        ].join('\n'),
        true,
      ),
      AgentTranscriptItemKind.FILE_CHANGE => (
        LucideIcons.filePen,
        toolHeadline(PlatformMessageKey.agentTranscriptToolEditedFile),
        (item.fileChanges ?? const <AgentTranscriptFileChange>[])
            .map((change) => change.path)
            .join('\n'),
        true,
      ),
      AgentTranscriptItemKind.MCP_TOOL_CALL ||
      AgentTranscriptItemKind.DYNAMIC_TOOL_CALL => (
        LucideIcons.wrench,
        toolHeadline(PlatformMessageKey.agentTranscriptToolRanTool),
        [
          [item.server, item.tool].whereType<String>().join('.'),
          if (item.errorText case final error?)
            '${t(PlatformMessageKey.agentTranscriptToolError)}: $error',
        ].where((line) => line.isNotEmpty).join('\n'),
        true,
      ),
      AgentTranscriptItemKind.WEB_SEARCH => (
        LucideIcons.globe,
        toolHeadline(PlatformMessageKey.agentTranscriptToolSearchedWeb),
        item.query,
        false,
      ),
      AgentTranscriptItemKind.PLAN => (
        LucideIcons.listChecks,
        t(PlatformMessageKey.agentTranscriptPlanUpdated),
        item.text,
        false,
      ),
      AgentTranscriptItemKind.IMAGE_VIEW => (
        LucideIcons.image,
        t(PlatformMessageKey.agentTranscriptViewedImage),
        null,
        false,
      ),
      AgentTranscriptItemKind.CONTEXT_COMPACTION => (
        LucideIcons.layers,
        t(PlatformMessageKey.agentTranscriptContextCompacted),
        null,
        false,
      ),
      AgentTranscriptItemKind.OTHER => (
        LucideIcons.circleDashed,
        t(PlatformMessageKey.agentTranscriptOtherItem),
        t(PlatformMessageKey.agentTranscriptOtherItemBody),
        false,
      ),
    };
    final color = failed ? context.colors.error : context.colors.onSurface;

    return Padding(
      key: ValueKey('agent-transcript-item-${item.itemId}'),
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: Grid.half),
              Expanded(
                child: Text(
                  headline,
                  style: context.textTheme.labelMedium?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (item.status == AgentTranscriptItemStatus.IN_PROGRESS)
                BuzzLoadingIndicator(
                  size: 12,
                  color: context.colors.onSurfaceVariant,
                  semanticLabel: t(
                    PlatformMessageKey.agentTranscriptTurnInProgress,
                  ),
                ),
            ],
          ),
          if (body != null && body.trim().isNotEmpty) ...[
            const SizedBox(height: Grid.quarter),
            SelectableText(
              body,
              style: mono
                  ? context.textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                      color: context.colors.onSurfaceVariant,
                    )
                  : context.textTheme.bodyMedium,
            ),
          ],
        ],
      ),
    );
  }
}
