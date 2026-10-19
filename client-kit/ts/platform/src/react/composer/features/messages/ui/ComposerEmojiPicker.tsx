// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/ComposerEmojiPicker.tsx. Without `gifs` this is the
// original emoji-only branch. DD-125(5): a host that has verified the GIF option (Relay NIP-11
// advertises `gif` and the deployment registered image origins) passes `gifs`, which turns the
// button into the original "Emoji and GIFs" picker with its two tabs.
import * as React from "react";
import { Images, Smile, SmilePlus } from "lucide-react";
import type { WebGIFItem } from "@client-kit/contracts";
import { EmojiPicker } from "../../../../custom-emoji/EmojiPicker";
import type { CustomEmoji } from "../../../../custom-emoji/emoji";
import { Button } from "../../../../profile/buzz/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../conversations/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../sidebar/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../profile/buzz/shared/ui/tabs";
import { KlipyGifPicker, type GifSearch } from "../../../../gifs/KlipyGifPicker";
import { useUiT } from "../../../../context";

/** The host's verified GIF option for this composer. */
export type ComposerGifOption = {
  search: GifSearch;
  onSelect: (gif: WebGIFItem) => void;
  /** Original `gifsDisabled` (a voice note is attached). */
  disabled?: boolean;
};

type ComposerPickerTab = "emoji" | "gifs";

export function ComposerEmojiPicker({ disabled, customEmoji, gifs, onClose, onEmojiSelect,
  onOpenChange, onTriggerMouseDown, open }: {
  disabled: boolean; customEmoji: CustomEmoji[]; onClose: () => void;
  onEmojiSelect: (value: string) => void; onOpenChange: (open: boolean) => void; open: boolean;
  onTriggerMouseDown?: () => void; gifs?: ComposerGifOption;
}) {
  const t = useUiT();
  const [pickerTab, setPickerTab] = React.useState<ComposerPickerTab>("emoji");
  // Original: the picker always reopens on the emoji tab.
  React.useEffect(() => { if (!open) setPickerTab("emoji"); }, [open]);
  const selectGif = React.useCallback((gif: WebGIFItem) => {
    if (!gifs || gifs.disabled) return;
    onOpenChange(false);
    gifs.onSelect(gif);
  }, [gifs, onOpenChange]);
  return <Popover onOpenChange={onOpenChange} open={open}>
    <Tooltip disableHoverableContent><TooltipTrigger asChild><PopoverTrigger asChild>
      <Button aria-label={t(gifs ? "gif.insertEmojiOrGif" : "buzz.insertEmoji")} data-testid="composer-emoji-button"
        disabled={disabled} onMouseDown={onTriggerMouseDown} size="icon" type="button" variant="ghost"><SmilePlus /></Button>
    </PopoverTrigger></TooltipTrigger><TooltipContent>{t(gifs ? "gif.emojiAndGifs" : "platform.profile.avatar.emoji")}</TooltipContent></Tooltip>
    <PopoverContent align="start"
      className="w-auto p-0 rounded-2xl overflow-hidden border-0 bg-transparent shadow-none"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }} side="top" sideOffset={10}>
      {gifs ? (
        <Tabs className="w-[352px] overflow-hidden rounded-2xl bg-muted"
          onValueChange={(value) => setPickerTab(value === "gifs" ? "gifs" : "emoji")} value={pickerTab}>
          <TabsList className="grid h-11 w-full grid-cols-2 overflow-hidden rounded-none border-b border-border/60 bg-muted p-1.5 text-muted-foreground">
            <TabsTrigger className="h-8 gap-1.5" value="emoji">
              <Smile aria-hidden className="h-4 w-4" />{t("gif.tabEmoji")}
            </TabsTrigger>
            <TabsTrigger className="h-8 gap-1.5" data-testid="composer-gif-tab" disabled={gifs.disabled === true} value="gifs">
              <Images aria-hidden className="h-4 w-4" />{t("gif.tabGifs")}
            </TabsTrigger>
          </TabsList>
          <TabsContent className="m-0" value="emoji">
            <EmojiPicker autoFocus customEmoji={customEmoji} onSelect={onEmojiSelect} perLine={9} />
          </TabsContent>
          <TabsContent className="m-0" value="gifs">
            <KlipyGifPicker onSelect={selectGif} search={gifs.search} />
          </TabsContent>
        </Tabs>
      ) : (
        <EmojiPicker autoFocus customEmoji={customEmoji} onSelect={onEmojiSelect} perLine={9} />
      )}
    </PopoverContent>
  </Popover>;
}
