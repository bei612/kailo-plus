// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/custom-emoji/emojiMartCategory.ts
import type { CustomEmoji } from "./emoji";

/**
 * Build the emoji-mart `custom` prop from the community custom emoji palette.
 * Returns `undefined` when there are none (so the Picker shows only standard
 * categories). A selected custom emoji has no `native` field — only `id`/`src`
 * — so select handlers must insert `:id:` for these.
 */
export function buildCustomEmojiCategory(customEmoji: CustomEmoji[], categoryName: string) {
  if (customEmoji.length === 0) return undefined;
  return [
    {
      id: "buzz-custom",
      name: categoryName,
      emojis: customEmoji.map((e) => ({
        id: e.shortcode,
        name: `:${e.shortcode}:`,
        keywords: [e.shortcode],
        skins: [{ src: e.url }],
      })),
    },
  ];
}
