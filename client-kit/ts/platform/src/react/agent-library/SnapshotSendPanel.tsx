// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/PersonaShareDialog.tsx::SnapshotShareDialog (recipient row and Send),
// desktop/src/features/agents/ui/PersonaShareRecipients.tsx and
// desktop/src/features/agents/ui/useSnapshotSendController.ts (one guarded open → upload → send).
// DD-131(7): "send to people" is the READY export package sent as an ordinary message attachment in
// a direct message with the chosen people of this organization. The conversation is opened through
// the governed conversation.open (the same preparation as New message), and the attachment goes
// through that conversation's own media and publish chain on each host. There is no public link.
// One Send freezes one intent: the recipients, the conversation and the DM publication's
// Idempotency-Key (DD-81). An outcome-unknown publication is never reported as sent or failed; it is
// retried only with the same intent, and only on hosts whose publication is deduplicated by that key.
// The original memory levels are not offered (DD-131(4)): the package is the Agent or Team only.
// Visual layer: DD-141 Kailo roles only.
import type { ConversationParticipant, ConversationView } from "@client-kit/contracts";
import { Search, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { newIdempotencyKey } from "../../governance";
import { BffError, isOutcomeUnknown, writeFailure } from "../../transport";
import { useCurrentPrincipalId, useFailureText, useT } from "../context";
import { NewMessageResultRow } from "../conversations/new-message-result-row";
import { SelectedRecipientChip } from "../conversations/selected-recipient-chip";
import {
  ConversationPreparationPending,
  formatRecipientName,
  useConversationDirectory,
  useConversationOpen,
} from "../conversations/use-conversations";
import { Button } from "../ui";
import { sha256Hex } from "./AgentSnapshotImportDialog";

/** Original PersonaShareRecipients limit. */
export const SNAPSHOT_RECIPIENT_LIMIT = 8;

/** DD-141 §6 primary action on the shared Button: brand fill, theme tokens only. */
const PRIMARY = "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";
const WARNING = "rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text";
const DANGER = "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text";

/** One frozen "send this package to these people" intent, handed to the host unchanged on a retry. */
export type SnapshotShareIntent = {
  /** The DM publication's Idempotency-Key (DD-81). */
  idempotencyKey: string;
  conversation: ConversationView;
  /** The READY package bytes, already checked against its size and SHA-256. */
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
  /** Original attachment link label: the shared Agent's or Team's display name. */
  label: string;
};

/**
 * A host's ordinary-attachment send into an opened conversation: upload the bytes through the
 * conversation's media chain and publish one message carrying them. An unanswered publication must
 * reject with an outcome-unknown error, never resolve.
 */
export type SnapshotShareSend = (intent: SnapshotShareIntent) => Promise<void>;

/** A READY package view: size and digest are checked against the bytes before anything is sent. */
type ReadyPackage = { byteSize?: number; contentDigest?: string; fileName: string; mediaType: string };

type Frozen = { key: string; recipientIds: string[]; names: string[]; stage: "open" | "publish" };

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "pending"; message: string }
  | { kind: "unknown" }
  | { kind: "failed"; message: string };

export function SnapshotSendPanel({ view, label, readBytes, send, dedupesRetry, onSent, onBusyChange, testIdPrefix }: {
  view: ReadyPackage;
  label: string;
  readBytes: () => Promise<Uint8Array>;
  send: SnapshotShareSend;
  /** True when the host's publication carries the intent's Idempotency-Key, so a retry cannot duplicate. */
  dedupesRetry: boolean;
  onSent: () => void;
  onBusyChange?: (busy: boolean) => void;
  testIdPrefix: string;
}) {
  const t = useT();
  const failureText = useFailureText();
  const principalId = useCurrentPrincipalId() ?? "";
  const directory = useConversationDirectory(principalId);
  const opening = useConversationOpen(principalId, directory.selectedUsers);
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const frozen = React.useRef<Frozen | null>(null);
  const inFlight = React.useRef(false);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const sending = status.kind === "sending";
  // A started intent owns the recipients until it resolves: an accepted or uncertain send cannot be
  // retargeted at other people.
  const held = sending || status.kind === "pending" || status.kind === "unknown";
  const blockedUnknown = status.kind === "unknown" && !dedupesRetry;
  React.useEffect(() => { onBusyChange?.(sending); }, [sending, onBusyChange]);

  const selected = directory.selectedUsers;
  const limit = Math.min(SNAPSHOT_RECIPIENT_LIMIT, directory.maxParticipants ? directory.maxParticipants - 1 : 0);
  const atLimit = selected.length >= limit;
  const selectedIds = new Set(selected.map((user) => user.principalId));
  const results = directory.searchResults.filter((user) => !selectedIds.has(user.principalId));
  const settling = directory.isDirectoryLoading || directory.searchQuery.trim() !== directory.deferredSearchQuery;

  const select = (user: ConversationParticipant) => {
    if (held || atLimit) return;
    directory.selectUser(user);
    setStatus({ kind: "idle" });
  };

  const submit = async () => {
    if (inFlight.current || selected.length === 0 || blockedUnknown) return;
    const recipientIds = selected.map((user) => user.principalId).sort();
    const current = frozen.current;
    if (current && (current.recipientIds.length !== recipientIds.length
      || current.recipientIds.some((id, index) => id !== recipientIds[index]))) return;
    const intent = current ?? { key: newIdempotencyKey(), recipientIds, names: selected.map(formatRecipientName), stage: "open" as const };
    frozen.current = intent;
    inFlight.current = true;
    setStatus({ kind: "sending" });
    try {
      const conversation = await opening.prepareConversation(selected);
      const bytes = await readBytes();
      if (bytes.length !== view.byteSize || !view.contentDigest || await sha256Hex(bytes) !== view.contentDigest)
        throw new Error(t("agents.share.packageChanged"));
      intent.stage = "publish";
      await send({ idempotencyKey: intent.key, conversation, bytes, fileName: view.fileName, mediaType: view.mediaType, label });
      frozen.current = null;
      if (!active.current) return;
      setStatus({ kind: "idle" });
      toast.success(t("agents.share.sent", { name: label }));
      onSent();
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ConversationPreparationPending) {
        // conversation.open keeps its own frozen command; the next Send asks about the same one.
        setStatus({ kind: "pending", message: error.message });
      } else if (isOutcomeUnknown(error)) {
        if (intent.stage === "publish") setStatus({ kind: "unknown" });
        else setStatus({ kind: "pending", message: t("dm.retryUnknown") });
      } else {
        // A definite refusal releases the intent; a later Send is a new message.
        frozen.current = null;
        const failed = writeFailure(error);
        setStatus({ kind: "failed", message: failed.kind === "rejected" && (error instanceof BffError || !(error instanceof Error) || !error.message)
          ? failureText(failed) : error instanceof Error ? error.message : String(error) });
      }
    } finally { inFlight.current = false; }
  };

  return <section className="flex flex-col gap-2" data-testid={`${testIdPrefix}-send-panel`}>
    <h3 className="text-xs font-medium text-muted-foreground">{t("agents.share.sendTitle")}</h3>
    <div className="flex items-start gap-2">
      <div className="relative min-w-0 flex-1">
        <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/15"
          data-testid={`${testIdPrefix}-recipient-field`}>
          {selected.length === 0 ? <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
          {selected.map((user) => <SelectedRecipientChip key={user.principalId} disabled={held} inspectable={false}
            label={formatRecipientName(user)} onRemove={() => { if (!held) directory.removeUser(user.principalId); }} user={user}
            testIds={{ chip: `${testIdPrefix}-recipient-chip-${user.principalId}` }} />)}
          <input aria-label={t("agents.share.recipients")} role="combobox" aria-expanded={pickerOpen && !held}
            aria-controls={`${testIdPrefix}-recipient-results`} autoComplete="off" spellCheck={false} type="text"
            className="h-7 min-w-16 flex-1 border-0 bg-transparent p-0 text-sm outline-hidden placeholder:text-muted-foreground"
            data-testid={`${testIdPrefix}-recipient-search`} disabled={held || atLimit || !principalId}
            placeholder={atLimit && selected.length > 0 ? t("agents.share.limitReached") : selected.length === 0 ? t("agents.share.searchPeople") : ""}
            value={directory.searchQuery} onFocus={() => setPickerOpen(true)}
            onChange={(event) => { directory.setSearchQuery(event.target.value); setPickerOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setPickerOpen(false); return; }
              if (event.key === "Backspace" && !directory.searchQuery && selected.length > 0 && !held) {
                directory.removeUser(selected[selected.length - 1]!.principalId); return;
              }
              if (event.key === "Enter" && directory.searchQuery.trim() && directory.searchQuery.trim() === directory.deferredSearchQuery && results[0]) {
                event.preventDefault(); select(results[0]);
              }
            }} />
        </div>
        {pickerOpen && !held && !atLimit ? <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover py-1 shadow-xl"
          role="listbox" id={`${testIdPrefix}-recipient-results`} data-testid={`${testIdPrefix}-recipient-results`}
          onScroll={directory.handleDirectoryScroll}>
          {settling ? <p role="status" className="px-3 py-3 text-sm text-muted-foreground">{t("platform.loading")}</p>
            : directory.searchError ? <p role="alert" className="px-3 py-3 text-sm text-danger-text">{t("dm.directoryUnavailable")}</p>
              : results.length > 0 ? results.map((user) => <NewMessageResultRow key={user.principalId} disabled={held} user={user}
                onSelect={select} />)
                : <p className="px-3 py-3 text-sm text-muted-foreground">{t("agents.share.noPeople")}</p>}
        </div> : null}
      </div>
      {selected.length > 0 ? <Button className={`h-10 shrink-0 ${PRIMARY}`} disabled={sending || blockedUnknown}
        data-testid={`${testIdPrefix}-send`} onClick={() => { setPickerOpen(false); void submit(); }}>
        <Send aria-hidden className="h-4 w-4" />
        {sending ? t("agents.share.sending") : status.kind === "pending" || status.kind === "unknown" ? t("agents.retry") : t("agents.share.send")}
      </Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">{t("agents.share.boundary")}</p>
    {status.kind === "pending" ? <p role="status" className={WARNING} data-testid={`${testIdPrefix}-send-pending`}>{status.message}</p> : null}
    {status.kind === "unknown" ? <p role="status" className={WARNING} data-testid={`${testIdPrefix}-send-unknown`}>
      {dedupesRetry ? t("agents.share.unknownRetry") : t("agents.share.unknownCheck")}</p> : null}
    {status.kind === "failed" ? <p role="alert" className={DANGER} data-testid={`${testIdPrefix}-send-failed`}>
      {t("agents.share.failed", { reason: status.message })}</p> : null}
  </section>;
}
