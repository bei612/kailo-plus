import 'package:flutter/foundation.dart';

const Object _sentinel = Object();

/// 本人所在的一个 Channel，取自 Relay 的 kind:39000 元数据与 kind:39002 roster。
/// Kailo 的 Channel 由 Core 建立、一律 private（`DD-80`）。
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
  final bool isMember;

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
    this.isMember = false,
  });

  bool get isPrivate => visibility == 'private';

  bool get isArchived => archivedAt != null;

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
    isMember: isMember,
  );

  Channel copyWith({
    String? name,
    String? description,
    Object? lastMessageAt = _sentinel,
    Object? archivedAt = _sentinel,
    int? memberCount,
    bool? isMember,
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
    isMember: isMember ?? this.isMember,
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
  );
}
