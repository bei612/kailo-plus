part of 'channels_provider.dart';

const _channelMembershipPageSize = 500;
const _maxChannelMembershipPages = 100;

/// Returns the stable refresh scope for a relay and signing identity.
String _channelRefreshScope(String relayBaseUrl, String? pubkey) =>
    '$relayBaseUrl:${pubkey?.toLowerCase() ?? ''}';

Future<List<NostrEvent>> _fetchChannelMemberships(
  RelaySessionNotifier session,
  String pubkey, {
  void Function()? ensureCurrent,
}) => _fetchPaginatedChannelEvents(
  session,
  kind: 39002,
  tags: {
    '#p': [pubkey],
  },
  operation: 'Channel memberships',
  ensureCurrent: ensureCurrent,
);

/// Thrown when a channel-list request is retired before it settles.
///
/// Callers must treat this as "write nothing": a newer request or scope now
/// owns the installed list and its related cache, subscription, and load state.
class _StaleChannelRefresh implements Exception {
  const _StaleChannelRefresh();

  @override
  String toString() =>
      'Channel refresh retired by a newer request or scope change';
}

/// Carries one channel-list refresh's request ownership across every await.
///
/// This token is captured once at the start of every ordinary and reconnect
/// refresh. It is re-checked after each relay await, so an older
/// request cannot regain ownership by reaching subscription setup last.
class _ChannelRefreshFence {
  /// Relay-and-identity scope that started the refresh.
  final String scope;

  final _ChannelRefreshCoordinator _coordinator;
  final int _generation;

  _ChannelRefreshFence(this._coordinator, this.scope, this._generation);

  /// Whether the refresh still owns the active scope and generation.
  bool get isCurrent =>
      _generation == _coordinator.generation &&
      scope == _coordinator.currentScope();

  /// Throws [_StaleChannelRefresh] once this refresh has been retired.
  ///
  /// Call after every await and immediately before every write to metadata,
  /// cache, load status, subscriptions or provider state.
  void ensureCurrent() {
    if (!isCurrent) throw const _StaleChannelRefresh();
  }
}

/// Whether a detached unread catch-up has been superseded, so it writes nothing.
///
/// The refresh fence is acquired before the first relay await, which makes this
/// request-ordered rather than subscription-completion-ordered. The subscription
/// generation remains a second lifecycle check for disconnect and disposal.
///
/// A retired catch-up returns rather than throwing [_StaleChannelRefresh]:
/// nothing awaits it, so a throw would only surface as an unhandled error.
///
/// An extension in this part file rather than a method on the notifier because
/// `channels_provider.dart` sits against the repository-wide 1200-line file
/// ceiling enforced by `just file-size-check`.
extension _CatchUpFencing on ChannelsNotifier {
  bool _isCatchUpRetired(
    _ChannelRefreshFence fence,
    int subscriptionGeneration,
  ) => !fence.isCurrent || subscriptionGeneration != _subscriptionVersion;
}

/// Awaits [future], then rejects the result if the refresh was retired.
///
/// One helper keeps every await site on the fenced path identical, so a new
/// await cannot be added without deciding whether it needs the fence.
///
/// The error path is fenced too. Without it a retired refresh that fails would
/// surface an ordinary exception as a failure of the current scope.
Future<T> _fenced<T>(_ChannelRefreshFence fence, Future<T> future) async {
  final T value;
  try {
    value = await future;
  } catch (_) {
    if (!fence.isCurrent) throw const _StaleChannelRefresh();
    rethrow;
  }
  fence.ensureCurrent();
  return value;
}

Map<String, int> _memberCountsByChannelId(Iterable<NostrEvent> memberEvents) {
  final memberCounts = <String, int>{};
  for (final event in memberEvents) {
    final channelId = event.getTagValue('d');
    if (channelId == null) continue;
    final pTags = <String>{};
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag[0] == 'p' && tag.length > 1) {
        pTags.add(tag[1].toLowerCase());
      }
    }
    memberCounts[channelId] = pTags.length;
  }
  return memberCounts;
}

/// Fences channel-list refreshes to the scope that requested them.
///
/// A community or identity switch changes the scope, and a newer request bumps
/// the generation. Either one retires an in-flight request, so a delayed
/// response can never populate the current community's state. This is the
/// tenant boundary described in VISION.md: isolation is the boundary, not a
/// filter, so a retired response is discarded rather than merged.
///
/// Lives in this part file because `channels_provider.dart` sits against the
/// repository-wide 1200-line file ceiling enforced by `just file-size-check`.
class _ChannelRefreshCoordinator {
  /// Resolves the relay-and-identity scope that is active right now.
  final String Function() currentScope;

  int _generation = 0;

  /// Generation of the most recently issued or retired request.
  int get generation => _generation;

  _ChannelRefreshCoordinator({required this.currentScope});

  /// Binds the fence to a notifier's [Ref] so the provider needs one line.
  ///
  /// The closure reads rather than watches: the fence asks what the scope is
  /// right now, and must not make the notifier depend on it.
  factory _ChannelRefreshCoordinator.forRef(Ref ref) =>
      _ChannelRefreshCoordinator(
        currentScope: () => _channelRefreshScope(
          ref.read(relayConfigProvider).baseUrl,
          ref.read(myPubkeyProvider),
        ),
      );

  /// Retires any in-flight request without starting a new one.
  ///
  /// Called when the relay or identity changes so a response already on the
  /// wire cannot be written into the new scope.
  void retireInFlight() => _generation++;

  /// Starts a fenced refresh that carries the scope across later awaits.
  _ChannelRefreshFence beginRefresh() {
    final scope = currentScope();
    final generation = ++_generation;
    return _ChannelRefreshFence(this, scope, generation);
  }
}

Future<List<NostrEvent>> _fetchPaginatedChannelEvents(
  RelaySessionNotifier session, {
  required int kind,
  required String operation,
  Map<String, List<String>> tags = const {},
  void Function()? ensureCurrent,
}) async {
  final events = <NostrEvent>[];
  final seenEventIds = <String>{};
  int? until;
  String? beforeId;
  for (var pageIndex = 0; pageIndex < _maxChannelMembershipPages; pageIndex++) {
    ensureCurrent?.call();
    final page = await session.queryRelay([
      NostrFilter(
        kinds: [kind],
        tags: tags,
        limit: _channelMembershipPageSize,
        until: until,
        extensions: {'before_id': ?beforeId},
      ),
    ]);
    ensureCurrent?.call();
    if (page.isEmpty) break;
    var madeProgress = false;
    for (final event in page) {
      if (seenEventIds.add(event.id)) {
        events.add(event);
        madeProgress = true;
      }
    }
    if (!madeProgress) break;

    final last = page.last;
    until = last.createdAt;
    beforeId = last.id;
    if (pageIndex == _maxChannelMembershipPages - 1) {
      throw StateError('$operation exceeded $_maxChannelMembershipPages pages');
    }
  }
  return events;
}

/// Thread-interest and unread helpers shared by [ChannelsNotifier].
///
/// Lives in this part file because `channels_provider.dart` sits against the
/// repository-wide 1200-line file ceiling enforced by `just file-size-check`.
String? _observedUnreadRootId(NostrEvent event) =>
    _isBroadcastReply(event) ? null : event.threadReference.rootId;

bool _isBroadcastReply(NostrEvent event) => event.tags.any(
  (tag) => tag.length >= 2 && tag[0] == 'broadcast' && tag[1] == '1',
);

Set<String> _readRootIdSet(String? raw) {
  if (raw == null || raw.isEmpty) return {};
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return {};
    return {
      for (final value in decoded)
        if (value is String) value,
    };
  } catch (_) {
    return {};
  }
}

String _encodeRootIdSet(Set<String> values) => jsonEncode(values.toList());

/// Records one observed unread event for a channel's badge state.
///
/// An extension in this part file rather than a method on the notifier because
/// `channels_provider.dart` sits against the repository-wide 1200-line file
/// ceiling enforced by `just file-size-check`. Private members stay reachable:
/// a part shares its parent's library.
extension _ObservedUnreadRecording on ChannelsNotifier {
  void _recordUnreadEvent(Channel channel, NostrEvent event, String myPk) {
    final isThreadedReply =
        event.threadReference.parentId != null && !_isBroadcastReply(event);
    final isHighPriority = isHighPriorityEvent(event.tags, myPk);
    recordObservedUnreadEvent(
      _observedUnreadEventsByChannel,
      channel.id,
      makeObservedUnreadEvent(
        id: event.id,
        createdAt: event.createdAt,
        rootId: _observedUnreadRootId(event),
        highPriority: isHighPriority,
        isThreadedReply: isThreadedReply,
      ),
      _unreadCatchUpLimit,
    );

    final current = _latestObservedByChannel[channel.id] ?? 0;
    if (event.createdAt > current) {
      _latestObservedByChannel[channel.id] = event.createdAt;
    }
  }
}
