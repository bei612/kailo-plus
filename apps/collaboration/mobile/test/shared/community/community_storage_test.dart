import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_storage.dart';

/// In-memory fake that extends Fake to satisfy all FlutterSecureStorage
/// interface methods, but implements the core read/write/delete with real
/// in-memory logic.
class FakeSecureStorage extends Fake implements FlutterSecureStorage {
  final Map<String, String> _data = {};
  final Map<String, int> _writeCounts = {};

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _data[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    _writeCounts[key] = (_writeCounts[key] ?? 0) + 1;
    if (value != null) {
      _data[key] = value;
    } else {
      _data.remove(key);
    }
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _data.remove(key);

  @override
  Future<Map<String, String>> readAll({
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => Map.from(_data);

  @override
  Future<void> deleteAll({
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _data.clear();

  @override
  Future<bool> containsKey({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _data.containsKey(key);

  // Convenience for setting up test data.
  String? operator [](String key) => _data[key];
  void operator []=(String key, String value) => _data[key] = value;
  int writeCount(String key) => _writeCounts[key] ?? 0;
}

void main() {
  late FakeSecureStorage fakeSecure;
  late CommunityStorage storage;

  setUp(() {
    fakeSecure = FakeSecureStorage();
    storage = CommunityStorage(secure: fakeSecure);
  });

  group('CommunityStorage', () {
    test('loadAll returns empty list when no data', () async {
      final result = await storage.loadAll();
      expect(result, isEmpty);
    });

    test('save updates existing community with same id', () async {
      final ws = Community.create(
        name: 'Original',
        relayUrl: 'https://relay.example.com',
      );

      await storage.save(ws);
      await storage.save(ws.copyWith(name: 'Updated'));

      final loaded = await storage.loadAll();
      expect(loaded, hasLength(1));
      expect(loaded.first.name, 'Updated');
    });

    test('remove deletes a community', () async {
      final ws1 = Community.create(
        name: 'One',
        relayUrl: 'https://one.example.com',
      );
      final ws2 = Community.create(
        name: 'Two',
        relayUrl: 'https://two.example.com',
      );

      await storage.save(ws1);
      await storage.save(ws2);
      await storage.remove(ws1.id);

      final loaded = await storage.loadAll();
      expect(loaded, hasLength(1));
      expect(loaded.first.id, ws2.id);
    });

    test('active community ID persists', () async {
      await storage.saveActiveId('ws-123');
      final id = await storage.loadActiveId();
      expect(id, 'ws-123');
    });

    test('clearActiveId removes active ID', () async {
      await storage.saveActiveId('ws-123');
      await storage.clearActiveId();
      final id = await storage.loadActiveId();
      expect(id, isNull);
    });

    group('migration', () {
      test('does not migrate when no legacy keys exist', () async {
        final loaded = await storage.loadAll();
        expect(loaded, isEmpty);
      });
    });
  });
}
