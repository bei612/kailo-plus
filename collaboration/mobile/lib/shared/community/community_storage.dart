import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'community.dart';

class CommunityStorage {
  static const _keyCommunities = 'buzz_communities';
  static const _keyActiveId = 'buzz_active_community_id';

  final FlutterSecureStorage _secure;

  CommunityStorage({FlutterSecureStorage? secure})
    : _secure = secure ?? const FlutterSecureStorage();

  Future<List<Community>> loadAll() async {
    final raw = await _secure.read(key: _keyCommunities);
    return raw == null ? [] : _decodeList(raw);
  }

  Future<void> save(Community community) async {
    final all = await loadAll();
    final index = all.indexWhere((w) => w.id == community.id);
    if (index >= 0) {
      all[index] = community;
    } else {
      all.add(community);
    }
    await _saveList(all);
  }

  /// Replaces the complete stored community list in one secure-storage write.
  Future<void> saveAll(List<Community> communities) => _saveList(communities);

  Future<void> remove(String id) async {
    final all = await loadAll();
    all.removeWhere((w) => w.id == id);
    await _saveList(all);
  }

  Future<String?> loadActiveId() async {
    return _secure.read(key: _keyActiveId);
  }

  Future<void> saveActiveId(String id) async {
    await _secure.write(key: _keyActiveId, value: id);
  }

  Future<void> clearActiveId() async {
    await _secure.delete(key: _keyActiveId);
  }

  List<Community> _decodeList(String raw) {
    final list = jsonDecode(raw) as List<dynamic>;
    return list
        .map((entry) => Community.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  Future<void> _saveList(List<Community> communities) async {
    final json = jsonEncode(communities.map((item) => item.toJson()).toList());
    await _secure.write(key: _keyCommunities, value: json);
  }
}
