import 'package:flutter/foundation.dart';

const Object _sentinel = Object();

/// 本人所在的一个 Channel，取自 Relay 的 kind:39000 元数据与 kind:39002 roster。
/// 平台的 Channel 由 Core 建立、一律 private（`DD-80`）。
@immutable
class Channel {
  final String id;
  final String name;
  final String channelType;
  final String visibility; // "open", "private"
  final String description;
  final String? topic;
  final String? purpose;
  final String createdBy;
  final DateTime createdAt;
  final int memberCount;
  final DateTime? lastMessageAt;
  final DateTime? archivedAt;
  // Original Buzz TTL facts from the relay's kind:39000 `ttl`/`ttl_deadline`.
  final int? ttlSeconds;
  final DateTime? ttlDeadline;
  final bool isMember;
  final List<String> participants;
  final List<String> participantPubkeys;
  final List<String> participantPrincipalIds;

  const Channel({
    required this.id,
    required this.name,
    required this.channelType,
    required this.visibility,
    required this.description,
    required this.createdBy,
    required this.createdAt,
    required this.memberCount,
    this.topic,
    this.purpose,
    this.lastMessageAt,
    this.archivedAt,
    this.ttlSeconds,
    this.ttlDeadline,
    this.isMember = false,
    this.participants = const [],
    this.participantPubkeys = const [],
    this.participantPrincipalIds = const [],
  });

  bool get isPrivate => visibility == 'private';
  bool get isDm => channelType == 'dm';
  bool get isForum => channelType == 'forum';

  String displayLabel({String? currentPubkey}) {
    if (!isDm || participants.length != participantPubkeys.length) return name;
    return [
      for (var index = 0; index < participants.length; index++)
        if (participantPubkeys[index].toLowerCase() !=
            currentPubkey?.toLowerCase())
          participants[index],
    ].join(', ');
  }

  bool get isArchived => archivedAt != null;
  bool get isEphemeral => ttlSeconds != null || ttlDeadline != null;

  Channel mergeDetails(ChannelDetails details) => Channel(
    id: id,
    name: details.name,
    channelType: details.channelType,
    visibility: details.visibility,
    description: details.description,
    topic: details.topic,
    purpose: details.purpose,
    createdBy: details.createdBy,
    createdAt: details.createdAt,
    memberCount: memberCount,
    lastMessageAt: lastMessageAt,
    archivedAt: details.archivedAt,
    ttlSeconds: details.ttlSeconds,
    ttlDeadline: details.ttlDeadline,
    isMember: isMember,
    participants: participants,
    participantPubkeys: participantPubkeys,
    participantPrincipalIds: participantPrincipalIds,
  );

  Channel copyWith({
    String? name,
    String? description,
    Object? lastMessageAt = _sentinel,
    Object? archivedAt = _sentinel,
    int? memberCount,
    bool? isMember,
    List<String>? participants,
    List<String>? participantPubkeys,
    List<String>? participantPrincipalIds,
  }) => Channel(
    id: id,
    name: name ?? this.name,
    channelType: channelType,
    visibility: visibility,
    description: description ?? this.description,
    topic: topic,
    purpose: purpose,
    createdBy: createdBy,
    createdAt: createdAt,
    memberCount: memberCount ?? this.memberCount,
    lastMessageAt: identical(lastMessageAt, _sentinel)
        ? this.lastMessageAt
        : lastMessageAt as DateTime?,
    archivedAt: identical(archivedAt, _sentinel)
        ? this.archivedAt
        : archivedAt as DateTime?,
    ttlSeconds: ttlSeconds,
    ttlDeadline: ttlDeadline,
    isMember: isMember ?? this.isMember,
    participants: participants ?? this.participants,
    participantPubkeys: participantPubkeys ?? this.participantPubkeys,
    participantPrincipalIds:
        participantPrincipalIds ?? this.participantPrincipalIds,
  );
}

@immutable
class ChannelDetails {
  final String id;
  final String name;
  final String channelType;
  final String visibility;
  final String description;
  final String? topic;
  final String? purpose;
  final String createdBy;
  final DateTime createdAt;
  final int memberCount;
  final DateTime? archivedAt;
  final int? ttlSeconds;
  final DateTime? ttlDeadline;

  const ChannelDetails({
    required this.id,
    required this.name,
    required this.channelType,
    required this.visibility,
    required this.description,
    required this.createdBy,
    required this.createdAt,
    required this.memberCount,
    this.topic,
    this.purpose,
    this.archivedAt,
    this.ttlSeconds,
    this.ttlDeadline,
  });

  factory ChannelDetails.fromChannel(Channel channel) => ChannelDetails(
    id: channel.id,
    name: channel.name,
    channelType: channel.channelType,
    visibility: channel.visibility,
    description: channel.description,
    topic: channel.topic,
    purpose: channel.purpose,
    createdBy: channel.createdBy,
    createdAt: channel.createdAt,
    memberCount: channel.memberCount,
    archivedAt: channel.archivedAt,
    ttlSeconds: channel.ttlSeconds,
    ttlDeadline: channel.ttlDeadline,
  );
}
