import 'package:uuid/uuid.dart';

const _uuid = Uuid();
const _sentinel = Object();

/// 本机连接的 Buzz Community。
///
/// Kailo 里它由登录后取得的连接事实建立（Kailo `DD-75`）：[relayUrl] 是 BFF 给出的
/// Relay 地址，[nsec] 是本机设备私钥。Community 与 Tenant 一一对应（`DD-01`）。
class Community {
  final String id;
  final String name;
  final String relayUrl;
  final String? pubkey;
  final String? nsec;
  final DateTime addedAt;

  const Community({
    required this.id,
    required this.name,
    required this.relayUrl,
    this.pubkey,
    this.nsec,
    required this.addedAt,
  });

  factory Community.create({
    required String name,
    required String relayUrl,
    String? pubkey,
    String? nsec,
  }) {
    return Community(
      id: _uuid.v4(),
      name: name,
      relayUrl: relayUrl,
      pubkey: pubkey,
      nsec: nsec,
      addedAt: DateTime.now(),
    );
  }

  Community copyWith({
    String? name,
    String? relayUrl,
    Object? pubkey = _sentinel,
    Object? nsec = _sentinel,
  }) {
    return Community(
      id: id,
      name: name ?? this.name,
      relayUrl: relayUrl ?? this.relayUrl,
      pubkey: pubkey == _sentinel ? this.pubkey : pubkey as String?,
      nsec: nsec == _sentinel ? this.nsec : nsec as String?,
      addedAt: addedAt,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'relayUrl': relayUrl,
    if (pubkey != null) 'pubkey': pubkey,
    if (nsec != null) 'nsec': nsec,
    'addedAt': addedAt.toIso8601String(),
  };

  factory Community.fromJson(Map<String, dynamic> json) {
    return Community(
      id: json['id'] as String,
      name: json['name'] as String,
      relayUrl: json['relayUrl'] as String,
      pubkey: json['pubkey'] as String?,
      nsec: json['nsec'] as String?,
      addedAt: DateTime.parse(json['addedAt'] as String),
    );
  }
}
