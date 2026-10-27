import { scheduleSettleGatedAutoSubmit } from "./messageComposerAutoSubmit";
// REQ-24 / DD-74: the original Buzz MessageComposer editor and interaction
// owner, consumed by both hosts. Publication and file receipts stay in hosts.
import * as React from "react";
import { findDmAgentMention } from "./dmAgentMention";
import { useRichTextEditor, type RichTextEditorOptions, type AutocompleteEdit } from "./features/messages/lib/useRichTextEditor";
import { useLinkEditor } from "./features/messages/lib/useLinkEditor";
import { useComposerAutofocus } from "./features/messages/lib/useComposerAutofocus";
import { useComposerSpoilerParticles } from "./features/messages/lib/useComposerSpoilerParticles";
import { focusMentionOptionsTrigger } from "./features/messages/ui/MentionAutocomplete";

type EditorOptions = Omit<RichTextEditorOptions, "onSubmit" | "onEditLastOwnMessage" | "onEditLink" | "onLinkSelectionChange" | "onLinkShortcut" | "isAutocompleteOpen">;

export function useMessageComposerController(options: {
  editor: EditorOptions;
  links: Parameters<typeof useLinkEditor>[1];
  draftKey: string | null | undefined;
  autofocusDisabled: boolean;
  editing: boolean;
  replyTarget?: unknown;
  autocompleteOpen: boolean;
  onEditLastOwnMessage?: () => boolean;
  submit: () => void | Promise<void>;
}) {
  const current = React.useRef(options);
  current.current = options;
  const autocompleteOpen = React.useRef(options.autocompleteOpen);
  autocompleteOpen.current = options.autocompleteOpen;
  const linkRef = React.useRef<ReturnType<typeof useLinkEditor> | null>(null);
  const richText = useRichTextEditor({
    ...options.editor,
    isAutocompleteOpen: autocompleteOpen,
    onSubmit: () => { void current.current.submit(); },
    onEditLastOwnMessage: () => !current.current.editing && (current.current.onEditLastOwnMessage?.() ?? false),
    onEditLink: info => linkRef.current?.openFromClick(info),
    onLinkSelectionChange: info => linkRef.current?.showFromCursor(info),
    onLinkShortcut: () => linkRef.current?.openFromShortcut() ?? false,
  });
  const linkEditor = useLinkEditor(richText, options.links);
  linkRef.current = linkEditor;
  const composerScrollRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const focusComposerEnd = React.useCallback(() => {
    richText.editor?.commands.focus("end", { scrollIntoView: false });
  }, [richText.editor]);
  useComposerAutofocus(focusComposerEnd, options.draftKey, options.autofocusDisabled);
  useComposerSpoilerParticles(richText.editor, composerScrollRef);
  React.useEffect(() => {
    if (options.replyTarget && options.editor.editable) richText.focusPreserve();
  }, [options.replyTarget, options.editor.editable, richText.focusPreserve]);
  const applyAutocompleteEdit = React.useCallback((edit: AutocompleteEdit) => {
    richText.replacePlainTextRange(edit.replaceFromOffset, edit.replaceToOffset,
      edit.insertText, edit.preserveSelection, edit.reassertMentionCaret);
  }, [richText.replacePlainTextRange]);
  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void current.current.submit();
  }, []);
  // Original selection belongs to Tiptap, not a second host selection store.
  const handleCaptureSelection = React.useCallback(() => {}, []);
  return { richText, linkEditor, composerScrollRef, formRef, focusComposerEnd,
    applyAutocompleteEdit, handleSubmit, handleCaptureSelection };
}

// Preserve the original priority: address shortcut, emoji, channel, mentions,
// then link-card focus. Hosts supply admitted identities, never a second editor.
export function composerKeyDown<E, C, M>(options: {
  alwaysAddress: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
  emoji: (event: React.KeyboardEvent<HTMLDivElement>) => { handled: boolean; suggestion?: E | null };
  selectEmoji: (suggestion: E) => void;
  channel: (event: React.KeyboardEvent<HTMLDivElement>) => { handled: boolean; suggestion?: C | null };
  selectChannel: (suggestion: C) => void;
  mentionOpen: boolean;
  mention: (event: React.KeyboardEvent<HTMLDivElement>) => { handled: boolean; suggestion?: M | null };
  selectMention: (suggestion: M) => void;
  linkEditor: Pick<ReturnType<typeof useLinkEditor>, "isCardOpen" | "focusCardFirstControl">;
}) {
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (options.alwaysAddress(event)) return;
    const emoji = options.emoji(event);
    if (emoji.handled) { if (emoji.suggestion) options.selectEmoji(emoji.suggestion); return; }
    const channel = options.channel(event);
    if (channel.handled) { if (channel.suggestion) options.selectChannel(channel.suggestion); return; }
    if (event.key === "Tab" && event.shiftKey && options.mentionOpen && focusMentionOptionsTrigger(event.currentTarget.closest("form"))) {
      event.preventDefault(); return;
    }
    const mention = options.mention(event);
    if (mention.handled) { if (mention.suggestion) options.selectMention(mention.suggestion); return; }
    if (event.key === "Tab" && !event.shiftKey && options.linkEditor.isCardOpen) {
      event.preventDefault();
      if (!options.linkEditor.focusCardFirstControl()) requestAnimationFrame(options.linkEditor.focusCardFirstControl);
    }
  };
}

export function useComposerControls() {
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = React.useState(false);
  const [isFormattingOpen, setIsFormattingOpen] = React.useState(false);
  const handleFormattingToggle = React.useCallback((pressed: boolean) => {
    if (pressed) setIsEmojiPickerOpen(false);
    setIsFormattingOpen(pressed);
  }, []);
  return { isEmojiPickerOpen, setIsEmojiPickerOpen, isFormattingOpen, setIsFormattingOpen, handleFormattingToggle };
}

/** Original submit boundary: snapshot editor text, refuse unavailable recipients,
 * serialize preparation, and hand the host the captured input. The host owns
 * durable intent keys, upload receipts and acknowledgement/UNKNOWN recovery. */
export function useComposerSubmission<Context, Decision = void>(options: {
  getContent: () => string;
  hasMedia: () => boolean;
  canSubmit: () => boolean;
  isEditing: boolean;
  isDm: boolean;
  dmAgentNames: readonly string[];
  refuseDmAgent: (refused: boolean) => void;
  requestEmptyEdit?: () => void;
  capture: () => Context | undefined;
  prepare: (input: { content: string; context: Context; release: () => void; decision: Decision | undefined }) => Promise<void>;
  onPreparingChange?: (preparing: boolean) => void;
}) {
  const current = React.useRef(options);
  current.current = options;
  const locked = React.useRef(false);
  const [isPreparing, setIsPreparing] = React.useState(false);
  const submit = React.useCallback(async (decision?: Decision) => {
    const host = current.current;
    if (locked.current || !host.canSubmit()) return;
    const content = host.getContent().trim();
    if (host.isDm && findDmAgentMention(content, host.dmAgentNames)) {
      host.refuseDmAgent(true);
      return;
    }
    host.refuseDmAgent(false);
    if (!content && !host.hasMedia()) {
      if (host.isEditing) host.requestEmptyEdit?.();
      return;
    }
    const context = host.capture();
    if (context === undefined) return;
    locked.current = true;
    setIsPreparing(true);
    host.onPreparingChange?.(true);
    let released = false;
    // A queued publication may release its cleared editor while its original
    // frozen intent continues. Its late finally cannot unlock a later submit.
    const release = () => {
      if (released) return;
      released = true;
      locked.current = false;
      setIsPreparing(false);
      host.onPreparingChange?.(false);
    };
    try { await host.prepare({ content, context, release, decision }); }
    finally { release(); }
  }, []);
  return { submit, isPreparing, locked };
}

/** Both hosts consume an explicit Inbox confirmation once for its draft owner.
 * Hydration/readiness and UNKNOWN refusal come from the original draft store;
 * scheduling never creates a new publication identity. */
export function useComposerAutoSubmit(options: {
  owner: object;
  enabled: boolean;
  ready: boolean;
  active: () => boolean;
  consume?: () => void | Promise<void>;
  beforeSubmit?: () => boolean;
  submit: () => void | Promise<void>;
  onError?: () => void;
}) {
  const attempted = React.useRef<object | null>(null);
  const latest = React.useRef(options);
  latest.current = options;
  React.useEffect(() => {
    if (!options.enabled || !options.ready || attempted.current === options.owner) return;
    const owner = options.owner;
    let canceled = false;
    const cancel = scheduleSettleGatedAutoSubmit({ submit: () => {
      if (canceled || !options.active() || latest.current.owner !== owner) return;
      attempted.current = owner;
      void Promise.resolve().then(() => options.consume?.()).then(() => {
        if (options.active() && latest.current.owner === owner && (options.beforeSubmit?.() ?? true)) {
          return latest.current.submit();
        }
      }).catch(() => { if (options.active() && latest.current.owner === owner) options.onError?.(); });
    }});
    return () => { canceled = true; cancel(); };
  }, [options.owner, options.enabled, options.ready]);
}
