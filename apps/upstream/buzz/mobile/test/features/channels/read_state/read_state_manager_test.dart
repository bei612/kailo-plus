import 'package:buzz/shared/read_state/read_state_manager.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _channel = '11111111-2222-4333-8444-555555555555';
const _other = '22222222-3333-4444-8555-666666666666';

class _FakeRemote implements ReadStateRemote {
  _FakeRemote([Map<String, int>? initial]) : stored = {...?initial};

  final Map<String, int> stored;
  final published = <Map<String, int>>[];
  bool failNext = false;

  @override
  Future<Map<String, int>> fetch() async => Map.of(stored);

  @override
  Future<Map<String, int>> publish(Map<String, int> contexts) async {
    if (failNext) {
      failNext = false;
      throw Exception('unreachable');
    }
    published.add(Map.of(contexts));
    stored.addAll(contexts);
    return Map.of(contexts);
  }
}

Future<ReadStateManager> _manager(ReadStateRemote? remote) async {
  final prefs = await SharedPreferences.getInstance();
  final manager = ReadStateManager(
    pubkey: 'self',
    prefs: prefs,
    remote: remote,
    onChanged: () {},
  );
  await manager.initialize();
  return manager;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('adopts newer positions read on another client', () async {
    final remote = _FakeRemote({_channel: 200});
    final manager = await _manager(remote);

    expect(manager.getEffectiveTimestamp(_channel), 200);
    expect(manager.drainSyncedAdvances(), {_channel});
  });

  test('writes only positions that advanced past the authority', () async {
    final remote = _FakeRemote({_channel: 200, _other: 50});
    final manager = await _manager(remote);

    manager.markContextRead(_channel, 150); // 比权威副本旧：不写
    manager.markContextRead(_other, 80);
    manager.markContextRead('thread:${'ab' * 32}', 90); // Core 不接受：留本机
    await manager.flush();

    expect(remote.published, [
      {_other: 80},
    ]);
    expect(manager.getEffectiveTimestamp('thread:${'ab' * 32}'), 90);
  });

  test('seeded positions stay local', () async {
    final remote = _FakeRemote();
    final manager = await _manager(remote);

    manager.seedContextRead(_channel, 100);
    await manager.flush();

    expect(remote.published, isEmpty);
    expect(manager.getEffectiveTimestamp(_channel), 100);
  });

  test('an unconfirmed write is retried at the next flush', () async {
    final remote = _FakeRemote()..failNext = true;
    final manager = await _manager(remote);

    manager.markContextRead(_channel, 100);
    await manager.flush();
    expect(remote.published, isEmpty);

    await manager.flush();
    expect(remote.published, [
      {_channel: 100},
    ]);
  });

  test('dispose flushes a pending write', () async {
    final remote = _FakeRemote();
    final manager = await _manager(remote);

    manager.markContextRead(_channel, 100);
    manager.dispose();
    await Future<void>.delayed(Duration.zero);

    expect(remote.published, [
      {_channel: 100},
    ]);
  });

  test('without an authority the local cache still works', () async {
    final manager = await _manager(null);
    manager.markContextRead(_channel, 100);
    await manager.flush();
    expect(manager.getEffectiveTimestamp(_channel), 100);

    final reloaded = await _manager(null);
    expect(reloaded.getEffectiveTimestamp(_channel), 100);
  });
}
