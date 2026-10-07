import { useUiT } from "../../../../context";
// Extracted from the pinned Buzz fork; original authority 779af8886caae1317b4de962082429867ab61503, desktop/src/features/messages/ui/MessageComposerToolbar.tsx.
import * as React from "react";
import type { Editor } from "@tiptap/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ALargeSmall, Mic, Paperclip, X } from "lucide-react";

import { Button } from "../../../../profile/buzz/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../sidebar/tooltip";
import { ComposerMentionButton, ComposerSendButton } from "./ComposerControls";
import { FormattingToolbar } from "./FormattingToolbar";
import { SelectionFormattingTray } from "./SelectionFormattingTray";
import { ComposerEmojiPicker } from "./ComposerEmojiPicker";
import type { CustomEmoji } from "../../../../custom-emoji/emoji";
import { CUSTOM_EMOJI_NODE_NAME } from "../lib/customEmojiNode";

const NO_CUSTOM_EMOJI: CustomEmoji[] = [];

/** Spring for enter/exit of button groups — all fire simultaneously. */
const presenceSpring = {
  type: "spring",
  stiffness: 400,
  damping: 28,
} as const;
const ingressControlVariants = {
  exit: {
    opacity: 0,
    x: -12,
    transition: presenceSpring,
  },
} as const;

export const MessageComposerToolbar = React.memo(
  function MessageComposerToolbar({
    composerDisabled,
    customEmoji = NO_CUSTOM_EMOJI,
    editor,
    extraActions,
    formattingDisabled,
    isFormattingOpen,
    isSending,
    isUploading,
    isVoiceNoteProcessing = false,
    isVoiceNoteRecording = false,
    hasVoiceNoteAttachment = false,
    voiceNoteRecorder,
    onFormattingToggle,
    onLinkButton,
    onOpenMentionPicker,
    onPaperclip,
    onFinishVoiceNote,
    onVoiceNote,
    sendDisabled,
  }: {
    composerDisabled: boolean;
    customEmoji?: CustomEmoji[];
    editor: Editor | null;
    extraActions?: React.ReactNode;
    formattingDisabled: boolean;
    isFormattingOpen: boolean;
    isSending: boolean;
    isUploading: boolean;
    isVoiceNoteProcessing?: boolean;
    isVoiceNoteRecording?: boolean;
    hasVoiceNoteAttachment?: boolean;
    voiceNoteRecorder?: React.ReactNode;
    onFormattingToggle: (pressed: boolean) => void;
    onLinkButton: () => void;
    onOpenMentionPicker?: () => void;
    onPaperclip: () => void;
    onFinishVoiceNote?: () => void;
    onVoiceNote?: () => void;
    sendDisabled: boolean;
  }) {
    const translateUi = useUiT();
    const shouldReduceMotion = useReducedMotion();
    const [isEmojiPickerOpen, setIsEmojiPickerOpen] = React.useState(false);
    React.useEffect(() => {
      if (isFormattingOpen || composerDisabled) setIsEmojiPickerOpen(false);
    }, [isFormattingOpen, composerDisabled]);
    const insertEmoji = React.useCallback((emoji: string) => {
      if (!editor || composerDisabled) return;
      const shortcode = /^:([^:\s]+):$/.exec(emoji)?.[1]?.toLowerCase();
      const known = customEmoji.find((entry) => entry.shortcode.toLowerCase() === shortcode);
      if (known) {
        editor.chain().focus().insertContent({ type: CUSTOM_EMOJI_NODE_NAME,
          attrs: { shortcode: known.shortcode, src: known.url } }).insertContent(" ").run();
      } else {
        editor.chain().focus().insertContent(emoji).run();
      }
      setIsEmojiPickerOpen(false);
    }, [editor, composerDisabled, customEmoji]);

    return (
      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-3"
        data-testid="message-composer-toolbar"
      >
        <SelectionFormattingTray
          disabled={formattingDisabled}
          editor={editor}
          onLinkButton={onLinkButton}
        />
        <div className="-ml-2 flex min-h-10 min-w-0 flex-1 items-center gap-1 py-1">
          {/*
           * AnimatePresence with mode="popLayout" — exiting elements
           * are popped out of flow immediately so entering elements
           * can animate in simultaneously. No sequencing.
           *
           * The Aa toggle is duplicated inside both groups so
           * AnimatePresence handles the crossfade.
           */}
          <AnimatePresence mode="popLayout" initial={false}>
            {voiceNoteRecorder ? (
              <motion.div
                key="voice-note-controls"
                className="flex min-w-0 flex-1 items-center"
                data-testid="voice-note-controls"
                initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={
                  shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }
                }
                transition={
                  shouldReduceMotion ? { duration: 0 } : presenceSpring
                }
              >
                {voiceNoteRecorder}
              </motion.div>
            ) : isFormattingOpen ? (
              /*
               * ── Expanded: [Aa] [✕] | [formatting buttons] ──
               */
              <motion.div
                key="formatting-controls"
                className="flex min-w-0 flex-1 items-center gap-1"
                initial={false}
                animate={{}}
                exit={{ opacity: 0 }}
                transition={presenceSpring}
              >
                <motion.div
                  initial={{ x: 8, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 8, opacity: 0 }}
                  transition={presenceSpring}
                >
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={translateUi("buzz.toggleFormatting")}
                        aria-pressed={isFormattingOpen}
                        disabled={composerDisabled}
                        onClick={() => onFormattingToggle(!isFormattingOpen)}
                        size="icon"
                        type="button"
                        variant={isFormattingOpen ? "default" : "ghost"}
                      >
                        <ALargeSmall />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{translateUi("buzz.formatting")}</TooltipContent>
                  </Tooltip>
                </motion.div>
                <motion.div
                  className="flex items-center gap-1"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ ...presenceSpring, delay: 0.15 }}
                >
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={translateUi("buzz.closeFormatting")}
                        disabled={composerDisabled}
                        onClick={() => onFormattingToggle(false)}
                        size="icon"
                        type="button"
                        variant="ghost"
                        className="shrink-0"
                      >
                        <X />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{translateUi("buzz.closeFormatting")}</TooltipContent>
                  </Tooltip>
                  <div className="mx-1 h-5 w-px shrink-0 bg-border/60" />
                </motion.div>
                <motion.div
                  className="min-w-0 flex-1 overflow-x-auto"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ ...presenceSpring, delay: 0.15 }}
                >
                  <FormattingToolbar
                    editor={editor}
                    disabled={formattingDisabled}
                    onLinkButton={onLinkButton}
                  />
                </motion.div>
              </motion.div>
            ) : (
              /*
               * ── Passive: [@ 📎] [Aa] ──
               */
              <motion.div
                key="ingress-controls"
                className="flex items-center gap-1"
                data-testid="composer-ingress-controls"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit="exit"
                variants={ingressControlVariants}
                transition={presenceSpring}
              >
                {onOpenMentionPicker ? <ComposerMentionButton
                  disabled={composerDisabled}
                  onOpen={onOpenMentionPicker}
                /> : null}
                <Tooltip disableHoverableContent>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={translateUi("buzz.attachFile")}
                      disabled={
                        composerDisabled ||
                        isUploading ||
                        isVoiceNoteRecording ||
                        hasVoiceNoteAttachment
                      }
                      onClick={onPaperclip}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Paperclip />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{translateUi("buzz.attachFile")}</TooltipContent>
                </Tooltip>
                <ComposerEmojiPicker disabled={composerDisabled} customEmoji={customEmoji}
                  open={isEmojiPickerOpen} onOpenChange={setIsEmojiPickerOpen}
                  onEmojiSelect={insertEmoji} onClose={() => { editor?.commands.focus(); }} />
                {onVoiceNote ? (
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={translateUi("buzz.recordVoice")}
                        disabled={composerDisabled || isUploading}
                        onClick={onVoiceNote}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <span className="inline-flex">
                          <Mic />
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{translateUi("buzz.recordVoice")}</TooltipContent>
                  </Tooltip>
                ) : null}
                <motion.div
                  initial={{ x: -8, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -8, opacity: 0 }}
                  transition={presenceSpring}
                >
                  <Tooltip disableHoverableContent>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={translateUi("buzz.toggleFormatting")}
                        aria-pressed={isFormattingOpen}
                        disabled={composerDisabled}
                        onClick={() => onFormattingToggle(!isFormattingOpen)}
                        size="icon"
                        type="button"
                        variant={isFormattingOpen ? "default" : "ghost"}
                      >
                        <ALargeSmall />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{translateUi("buzz.formatting")}</TooltipContent>
                  </Tooltip>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2">
          {extraActions}
          <ComposerSendButton
            isSending={isSending}
            onFinishVoiceNote={
              isVoiceNoteRecording ? onFinishVoiceNote : undefined
            }
            sendDisabled={
              isVoiceNoteRecording ? isVoiceNoteProcessing : sendDisabled
            }
          />
        </div>
      </div>
    );
  },
);
