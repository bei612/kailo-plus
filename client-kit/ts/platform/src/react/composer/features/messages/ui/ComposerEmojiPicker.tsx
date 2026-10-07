// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/ComposerEmojiPicker.tsx: original emoji-only
// branch. GIF provider capability is separate and is not claimed by this port.
import { SmilePlus } from "lucide-react";
import { EmojiPicker } from "../../../../custom-emoji/EmojiPicker";
import type { CustomEmoji } from "../../../../custom-emoji/emoji";
import { Button } from "../../../../profile/buzz/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../conversations/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../sidebar/tooltip";
import { useUiT } from "../../../../context";

export function ComposerEmojiPicker({ disabled, customEmoji, onClose, onEmojiSelect,
  onOpenChange, open }: {
  disabled: boolean; customEmoji: CustomEmoji[]; onClose: () => void;
  onEmojiSelect: (value: string) => void; onOpenChange: (open: boolean) => void; open: boolean;
}) {
  const t = useUiT();
  return <Popover onOpenChange={onOpenChange} open={open}>
    <Tooltip disableHoverableContent><TooltipTrigger asChild><PopoverTrigger asChild>
      <Button aria-label={t("buzz.insertEmoji")} data-testid="composer-emoji-button"
        disabled={disabled} size="icon" type="button" variant="ghost"><SmilePlus /></Button>
    </PopoverTrigger></TooltipTrigger><TooltipContent>{t("platform.profile.avatar.emoji")}</TooltipContent></Tooltip>
    <PopoverContent align="start"
      className="w-auto p-0 rounded-2xl overflow-hidden border-0 bg-transparent shadow-none"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }} side="top" sideOffset={10}>
      <EmojiPicker autoFocus customEmoji={customEmoji} onSelect={onEmojiSelect} perLine={9} />
    </PopoverContent>
  </Popover>;
}
