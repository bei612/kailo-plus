import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../channels/channel.dart';
import '../channels/channels_provider.dart';

@immutable
class SearchHit {
  final String eventId;
  final String content;
  final int kind;
  final String pubkey;
  final String? channelId;
  final String? channelName;
  final int createdAt;
  final double score;
  final List<List<String>> tags;

  const SearchHit({
    required this.eventId,
    required this.content,
    required this.kind,
    required this.pubkey,
    this.channelId,
    this.channelName,
    required this.createdAt,
    required this.score,
    this.tags = const [],
  });

  factory SearchHit.fromJson(Map<String, dynamic> json) => SearchHit(
    eventId: json['event_id'] as String,
    content: json['content'] as String? ?? '',
    kind: json['kind'] as int? ?? 9,
    pubkey: json['pubkey'] as String,
    channelId: json['channel_id'] as String?,
    channelName: json['channel_name'] as String?,
    createdAt: json['created_at'] as int? ?? 0,
    score: (json['score'] as num?)?.toDouble() ?? 0.0,
    tags:
        (json['tags'] as List<dynamic>?)
            ?.map((t) => (t as List<dynamic>).map((e) => e as String).toList())
            .toList() ??
        const [],
  );
}

@immutable
class SearchState {
  final String query;
  final List<SearchHit> messageResults;
  final List<Channel> channelResults;
  final bool isLoading;
  final String? error;

  const SearchState({
    this.query = '',
    this.messageResults = const [],
    this.channelResults = const [],
    this.isLoading = false,
    this.error,
  });

  const SearchState.initial()
    : query = '',
      messageResults = const [],
      channelResults = const [],
      isLoading = false,
      error = null;

  SearchState copyWith({
    String? query,
    List<SearchHit>? messageResults,
    List<Channel>? channelResults,
    bool? isLoading,
    String? error,
  }) => SearchState(
    query: query ?? this.query,
    messageResults: messageResults ?? this.messageResults,
    channelResults: channelResults ?? this.channelResults,
    isLoading: isLoading ?? this.isLoading,
    error: error ?? this.error,
  );
}

class SearchNotifier extends Notifier<SearchState> {
  Timer? _debounce;

  @override
  SearchState build() {
    // Watch relayConfig so search state resets on community switch.
    ref.watch(relayConfigProvider);
    ref.onDispose(() {
      _debounce?.cancel();
    });
    return const SearchState.initial();
  }

  void search(String query) {
    _debounce?.cancel();

    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      state = const SearchState.initial();
      return;
    }

    state = SearchState(query: trimmed, isLoading: true);

    _debounce = Timer(const Duration(milliseconds: 300), () {
      _executeSearch(trimmed);
    });
  }

  Future<void> _executeSearch(String query) async {
    // If the query changed while debouncing, bail out.
    if (state.query != query) return;

    // Fire both lookups in parallel.
    _searchMessages(query);
    _searchChannels(query);
  }

  Future<void> _searchMessages(String query) async {
    try {
      final session = ref.read(relaySessionProvider.notifier);
      final events = await session.fetchHistory(
        NostrFilter(
          kinds: const [EventKind.streamMessage, EventKind.streamMessageV2],
          search: query,
          limit: 20,
        ),
      );

      // Channel-name lookup from the cached channels list — not all hits
      // will have a known channel (e.g. ones we're not a member of).
      final channelsById = {
        for (final c in ref.read(channelsProvider).value ?? const <Channel>[])
          c.id: c.name,
      };

      final hits = events
          .map(
            (e) => SearchHit(
              eventId: e.id,
              content: e.content,
              kind: e.kind,
              pubkey: e.pubkey,
              channelId: e.channelId,
              channelName: e.channelId != null
                  ? channelsById[e.channelId!]
                  : null,
              createdAt: e.createdAt,
              score: 0.0,
              tags: e.tags,
            ),
          )
          .toList();

      if (state.query != query) return;
      state = state.copyWith(messageResults: hits, isLoading: false);
    } catch (e) {
      if (state.query != query) return;
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  void _searchChannels(String query) {
    final channels = ref.read(channelsProvider).value ?? [];
    final lowerQuery = query.toLowerCase();
    final matches = channels
        .where(
          (c) =>
              c.name.toLowerCase().contains(lowerQuery) ||
              c.description.toLowerCase().contains(lowerQuery),
        )
        .toList();

    if (state.query != query) return;
    state = state.copyWith(
      channelResults: matches,
      isLoading: state.messageResults.isEmpty,
    );
  }

  void clear() {
    _debounce?.cancel();
    state = const SearchState.initial();
  }
}

final searchProvider = NotifierProvider<SearchNotifier, SearchState>(
  SearchNotifier.new,
);
