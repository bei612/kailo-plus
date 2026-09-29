import 'package:buzz/shared/emoji/emoji_only.dart';
import 'package:flutter_test/flutter_test.dart';

/// Keycaps carry no `Extended_Pictographic` code point of their own, so they
/// only pass via the dataset's glyph set — the one case that needs it.
const _keycapOne = '1\u{FE0F}\u{20E3}';

bool emojiOnly(String content, {Set<String> nativeEmoji = const {}}) =>
    isEmojiOnlyMessage(content, nativeEmoji: nativeEmoji);

void main() {
  group('isEmojiOnlyMessage', () {
    test('accepts emoji, alone and in runs', () {
      // Mirrors the cases in desktop's emojiOnly.test.mjs.
      expect(emojiOnly('\u{1F600}'), isTrue);
      expect(
        emojiOnly('\u{1F600} \u{1F44D}\u{1F3FD}\n\u{2764}\u{FE0F}'),
        isTrue,
      );
      expect(emojiOnly('\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}'), isTrue);
      expect(
        emojiOnly(
          '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
        ),
        isTrue,
      );
    });

    test('rejects anything with text in it', () {
      expect(emojiOnly('hi \u{1F600}'), isFalse);
      expect(emojiOnly('\u{1F600}!'), isFalse);
      expect(emojiOnly('nice'), isFalse);
    });

    test('rejects empty and whitespace-only bodies', () {
      expect(emojiOnly(''), isFalse);
      expect(emojiOnly('   \n '), isFalse);
    });

    test('a shortcode is just text', () {
      expect(emojiOnly(':buzz:'), isFalse);
      expect(emojiOnly(':'), isFalse);
      expect(emojiOnly('::'), isFalse);
    });

    test('keycaps need the dataset glyph set', () {
      expect(emojiOnly(_keycapOne), isFalse);
      expect(emojiOnly(_keycapOne, nativeEmoji: {_keycapOne}), isTrue);
    });
  });

  group('emoji-only sizing', () {});
}
