import { useUiT } from "../../../../context";
// Extracted from the pinned Buzz fork; original authority 779af8886caae1317b4de962082429867ab61503, desktop/src/features/messages/ui/ComposerControls.tsx.
import { ArrowUp, AtSign, Square } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../sidebar/tooltip";

export function ComposerMentionButton({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: () => void;
}) {
  const translateUi = useUiT();
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          aria-label={translateUi("buzz.mention")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          data-mention-picker-trigger=""
          data-testid="message-insert-mention"
          disabled={disabled}
          onClick={onOpen}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          <AtSign aria-hidden="true" className="h-4 w-4 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{translateUi("buzz.mention")}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerSendButton({
  isSending,
  onFinishVoiceNote,
  sendDisabled,
}: {
  isSending: boolean;
  onFinishVoiceNote?: () => void;
  sendDisabled: boolean;
}) {
  const translateUi = useUiT();
  const isFinishingVoiceNote = onFinishVoiceNote != null;
  return (
    <button
      aria-label={
        isFinishingVoiceNote
          ? translateUi("buzz.finishVoice")
          : isSending
            ? translateUi("buzz.sending")
            : translateUi("buzz.sendMessage")
      }
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      data-testid={isFinishingVoiceNote ? "finish-voice-note" : "send-message"}
      disabled={sendDisabled || isSending}
      onClick={onFinishVoiceNote}
      type={isFinishingVoiceNote ? "button" : "submit"}
    >
      {isFinishingVoiceNote ? (
        <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
      ) : isSending ? (
        <SendSpinner />
      ) : (
        <ArrowUp aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}

function SendSpinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
    />
  );
}
