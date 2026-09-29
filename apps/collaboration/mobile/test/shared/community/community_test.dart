import 'package:buzz/shared/community/community.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('round-trips the connection facts and the device secret', () {
    final community = Community.create(
      name: 't1.kailo.test:8443',
      relayUrl: 'wss://t1.kailo.test:8443',
      pubkey: 'ab' * 32,
      nsec: 'nsec1test',
    );

    final restored = Community.fromJson(community.toJson());

    expect(restored.id, community.id);
    expect(restored.name, community.name);
    expect(restored.relayUrl, community.relayUrl);
    expect(restored.pubkey, community.pubkey);
    expect(restored.nsec, community.nsec);
    expect(restored.addedAt, community.addedAt);
  });

  test('omits absent credentials from storage', () {
    final json = Community.create(name: 'n', relayUrl: 'wss://n.test').toJson();
    expect(json.containsKey('nsec'), isFalse);
    expect(json.containsKey('pubkey'), isFalse);
  });
}
