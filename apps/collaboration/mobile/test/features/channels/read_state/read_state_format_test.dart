import 'package:buzz/shared/read_state/read_state_format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('only Channel ids and msg: keys are shared with Core', () {
    expect(
      isSharedReadContextKey('11111111-2222-4333-8444-555555555555'),
      isTrue,
    );
    expect(isSharedReadContextKey(msgContextKey('ab' * 32)), isTrue);
    // Core 拒绝的形式只留在本机
    expect(isSharedReadContextKey(threadContextKey('ab' * 32)), isFalse);
    expect(isSharedReadContextKey(msgContextKey('not-an-event-id')), isFalse);
    expect(isSharedReadContextKey('general'), isFalse);
  });

  test('maxReadAt ignores absent markers', () {
    expect(maxReadAt([null, 3, 7, null, 5]), 7);
    expect(maxReadAt(const [null]), isNull);
  });
}
