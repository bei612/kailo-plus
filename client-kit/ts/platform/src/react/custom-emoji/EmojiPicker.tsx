// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/custom-emoji/ui/EmojiPicker.tsx
import Picker from "../profile/buzz/shared/ui/emoji-picker";
import * as React from "react";

import { buildCustomEmojiCategory } from "./emojiMartCategory";
import type { CustomEmoji } from "./emoji";
import { useUiLocale, useUiT } from "../context";
import { emojiMartData } from "./emojiMartPrewarm";

/**
 * Reach into the `em-emoji-picker` shadow root and disable spellcheck,
 * autocorrect, and autocapitalize on its search input. When `autoFocus` is
 * true, also focus the input so the cursor lands there immediately — this
 * makes focus deterministic and owned by us, preventing Radix's focus-scope
 * from racing emoji-mart's own async focus call and winning.
 *
 * emoji-mart mounts the custom element and its shadow content asynchronously,
 * so the input is not present on first render. A MutationObserver on the
 * shadow root watches for the input to appear, applies the attributes once,
 * then disconnects. Returns a cleanup function for `useEffect`.
 */
function disableSearchInputCorrections(
  host: HTMLElement,
  autoFocus: boolean,
): () => void {
  const picker = host.querySelector("em-emoji-picker");
  const shadowRoot = picker?.shadowRoot ?? null;
  if (!shadowRoot) {
    return () => undefined;
  }
  // shadowRoot is ShadowRoot here; capture as a typed const so the nested
  // closure doesn't re-widen to ShadowRoot | null.
  const root: ShadowRoot = shadowRoot;

  function applyAttributes() {
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return false;
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    if (autoFocus) {
      input.focus();
    }
    return true;
  }

  // Fast path: input already present (e.g. picker re-mount from hot cache).
  if (applyAttributes()) {
    return () => undefined;
  }

  // Slow path: wait for the shadow subtree to include the input.
  const observer = new MutationObserver(() => {
    if (applyAttributes()) {
      observer.disconnect();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * The one emoji picker for the whole app. Every place that lets a user choose
 * an emoji — composing a message, reacting to a regular or system message,
 * setting a status — renders this, so the config and custom-emoji wiring can't
 * drift across call sites (they used to, and that's why custom emoji were
 * missing from some pickers).
 *
 * The two admitted host readers supply the community custom-emoji palette,
 * so the original picker stays shared. Selection is normalized to a
 * single string: a standard emoji emits its `native` glyph; a custom emoji has
 * no `native`, so it emits its `:shortcode:` (the emoji-mart `id` is the
 * shortcode). Consumers store/send that string and let the existing renderers
 * (reactions' `emojiUrl`, the remark shortcode plugin) resolve it to an image.
 *
 * Only the raw picker lives here — not the Popover/trigger. Those differ per
 * site (ghost button vs status swatch, popover vs dialog content) and forcing
 * them into one wrapper would be less clear, not more. The thing that drifted
 * was the picker config + custom wiring + select handling; that's what this
 * centralizes.
 */
type EmojiPickerProps = {
  customEmoji: CustomEmoji[];
  /** Autofocus the search field when the picker mounts (e.g. reaction popovers). */
  autoFocus?: boolean;
  /** Called with the chosen emoji as a string: `native` glyph or `:shortcode:`. */
  onSelect: (emoji: string) => void;
  /** Number of emoji columns. Defaults to the compact picker used elsewhere. */
  perLine?: number;
};

export const EmojiPicker = React.memo(function EmojiPicker({
  autoFocus = false,
  customEmoji,
  onSelect,
  perLine = 8,
}: EmojiPickerProps) {
  const t = useUiT();
  const locale = useUiLocale();
  const custom = React.useMemo(
    () => buildCustomEmojiCategory(customEmoji, t("customEmoji.category")),
    [customEmoji, t],
  );
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!hostRef.current) return;
    return disableSearchInputCorrections(hostRef.current, autoFocus);
  }, [autoFocus]);

  return (
    <div ref={hostRef}>
      <Picker
        autoFocus={autoFocus}
        custom={custom}
        locale={locale === "zh-CN" ? "zh" : "en"}
        data={emojiMartData}
        maxFrequentRows={2}
        onEmojiSelect={(emoji: { native?: string; id?: string }) => {
          // Standard emoji carry a `native` glyph. Custom emoji don't — emit
          // their `:shortcode:` (emoji-mart `id` == shortcode) instead. Ignore a
          // malformed selection that has neither.
          const value = emoji.native ?? (emoji.id ? `:${emoji.id}:` : "");
          if (value) {
            onSelect(value);
          }
        }}
        perLine={perLine}
        previewPosition="bottom"
        set="native"
        skinTonePosition="search"
        theme="auto"
      />
    </div>
  );
});
