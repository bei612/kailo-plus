/// The editable values encoded by an inline emoji avatar.
class EmojiAvatarData {
  /// Creates decoded emoji avatar values.
  const EmojiAvatarData({required this.emoji, required this.colorValue});

  /// The system emoji rendered in the avatar.
  final String emoji;

  /// The ARGB background color.
  final int colorValue;
}

/// Decodes the editable values from an emoji-avatar SVG.
EmojiAvatarData? parseEmojiAvatarSvg(String svg) {
  final colorValue = RegExp(
    r'<rect\b[^>]*\sfill="([^"]+)"',
  ).firstMatch(svg)?[1];
  final emojiValue = RegExp(r'<text\b[^>]*>(.*?)</text>').firstMatch(svg)?[1];
  if (colorValue == null || emojiValue == null) return null;

  final hex = colorValue.startsWith('#') ? colorValue.substring(1) : colorValue;
  if (!RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(hex)) return null;
  final rgb = int.tryParse(hex, radix: 16);
  if (rgb == null) return null;
  return EmojiAvatarData(
    emoji: emojiValue
        .replaceAll('&gt;', '>')
        .replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&'),
    colorValue: 0xFF000000 | rgb,
  );
}
