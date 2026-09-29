import { ArrowUp, AtSign, Square } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export function ComposerMentionButton({
  disabled,
  onCaptureSelection,
  onOpen,
}: {
  disabled: boolean;
  onCaptureSelection: () => void;
  onOpen: () => void;
}) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          aria-label="Mention someone"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          data-mention-picker-trigger=""
          data-testid="message-insert-mention"
          disabled={disabled}
          onClick={onOpen}
          onMouseDown={(event) => {
            onCaptureSelection();
            event.preventDefault();
          }}
          type="button"
        >
          <AtSign aria-hidden="true" className="h-4 w-4 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Mention someone</TooltipContent>
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
  const isFinishingVoiceNote = onFinishVoiceNote != null;
  return (
    <button
      aria-label={
        isFinishingVoiceNote
          ? "Finish voice note"
          : isSending
            ? "Sending"
            : "Send message"
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
