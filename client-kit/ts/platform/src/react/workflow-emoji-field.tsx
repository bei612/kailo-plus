// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowEmojiField.tsx::WorkflowEmojiField.
// The stored value stays the reaction event content (native glyph or :shortcode:),
// which the governed trigger evaluator compares against trigger_emoji.
import { SmilePlus, X } from "lucide-react";
import * as React from "react";
import { useBffClient, useT } from "./context";
import { EmojiPicker } from "./custom-emoji/EmojiPicker";
import { useBffCustomEmojiPalette } from "./custom-emoji/palette";
import { emojiDisplayName } from "./messages/reactions/emojiName";
import { Button } from "./profile/buzz/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./conversations/popover";
import { ActionEmoji } from "./workflow-card-actions";

export function WorkflowEmojiField({ ariaLabel, clearAriaLabel, disabled, id, onChange, value }: {
  ariaLabel: string;
  /** Renders a clear button when set and a value is present. Omit for required fields. */
  clearAriaLabel?: string;
  disabled?: boolean;
  id: string;
  onChange: (emoji: string | undefined) => void;
  value?: string;
}) {
  const t = useT();
  const customEmoji = useBffCustomEmojiPalette(useBffClient());
  const [pickerOpen, setPickerOpen] = React.useState(false);
  return <div className="flex gap-2">
    <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={ariaLabel} className="flex-1 justify-start px-3 font-normal" disabled={disabled}
          id={id} type="button" variant="outline">
          {value ? <>
            <ActionEmoji className="h-5 w-5 text-base" value={value} />
            <span>{emojiDisplayName(value)}</span>
          </> : <>
            <SmilePlus className="text-muted-foreground" />
            <span className="text-muted-foreground">{t("workflows.emoji.choose")}</span>
          </>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto overflow-hidden rounded-2xl border-0 bg-transparent p-0 shadow-none" sideOffset={4}>
        <EmojiPicker autoFocus customEmoji={customEmoji} onSelect={(emoji) => {
          onChange(emoji);
          setPickerOpen(false);
        }} />
      </PopoverContent>
    </Popover>
    {value && clearAriaLabel ? <Button aria-label={clearAriaLabel} disabled={disabled} onClick={() => onChange(undefined)}
      size="icon" type="button" variant="ghost"><X /></Button> : null}
  </div>;
}
