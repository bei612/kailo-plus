// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdown/AgentSnapshotCard.tsx.
// DD-131(5)(7): a received snapshot attachment is the import entry. "Add agent/team" fetches the bytes
// through the host's authorized media path, verifies size and SHA-256 against the imeta, then asks
// the Agents page to upload them to the BFF for Core's preview (open-snapshot-import-event); nothing
// is imported until the person confirms there. "Download" uses the host's existing download.
import * as React from "react";
import { Bot, Download, Loader2, Users } from "lucide-react";

import { cn } from "../profile/buzz/shared/lib/cn";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "../composer/shared/ui/attachment";
import { useUiT } from "../context";
import { requestOpenSnapshotImport } from "../open-snapshot-import-event";
import { sha256Hex } from "../agent-library/snapshotFlow";

export type AgentSnapshotCardProps = {
  displayName: string;
  filename: string;
  sharedBy?: string;
  size?: number;
  sha256: string;
  snapshotKind: "agent" | "team";
  /** The agent PNG card image (authorized host URL); falls back to the icon. */
  thumb?: string;
  /** Authorized host fetch of the attachment bytes. */
  fetchBytes: () => Promise<Uint8Array<ArrayBuffer>>;
  onDownload: () => Promise<unknown>;
  /** Verified bytes for the importer; defaults to the Agents page import request. */
  onImport?: (fileBytes: Uint8Array<ArrayBuffer>, fileName: string, snapshotKind: "agent" | "team") => void;
};

type ImportState = { phase: "idle" } | { phase: "fetching" } | { phase: "error"; message: string };

function formatSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentSnapshotCard({ displayName, filename, sharedBy, size, sha256, snapshotKind, thumb, fetchBytes, onDownload, onImport }: AgentSnapshotCardProps) {
  const t = useUiT();
  const [importState, setImportState] = React.useState<ImportState>({ phase: "idle" });
  const inFlightRef = React.useRef(false);
  const [thumbError, setThumbError] = React.useState(false);

  async function handleImport() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setImportState({ phase: "fetching" });
    try {
      const fileBytes = await fetchBytes();
      if ((size !== undefined && size > 0 && fileBytes.byteLength !== size) || (await sha256Hex(fileBytes)) !== sha256.toLowerCase())
        throw new Error(t("agentSnapshots.cardIntegrity"));
      setImportState({ phase: "idle" });
      (onImport ?? ((bytes, name, kind) => requestOpenSnapshotImport({ fileBytes: bytes, fileName: name, snapshotKind: kind })))(fileBytes, filename, snapshotKind);
    } catch (err) {
      setImportState({ phase: "error", message: err instanceof Error ? err.message : t("agentSnapshots.cardLoadFailed") });
    } finally {
      inFlightRef.current = false;
    }
  }

  const isFetching = importState.phase === "fetching";
  const SnapshotIcon = snapshotKind === "team" ? Users : Bot;
  const showThumb = !!thumb && !thumbError;
  const metadata = [sharedBy ? t("agentSnapshots.sharedBy", { name: sharedBy }) : null, size == null ? null : formatSize(size)]
    .filter(Boolean).join(" · ");

  return (
    <Attachment className="my-1 inline-flex w-fit max-w-full shadow-none" data-testid="agent-snapshot-card"
      data-snapshot-kind={snapshotKind} state={importState.phase === "error" ? "error" : "done"}>
      <AttachmentMedia className={cn(showThumb ? "relative h-9 w-9" : "bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15")}
        variant={showThumb ? "image" : "icon"}>
        {showThumb ? (
          <>
            <img alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover" src={thumb} referrerPolicy="no-referrer" />
            <img alt="" className="relative h-full w-full object-cover" data-testid="agent-snapshot-card-thumb" src={thumb}
              referrerPolicy="no-referrer" onError={() => setThumbError(true)} />
          </>
        ) : <SnapshotIcon />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="overflow-visible whitespace-normal text-clip" title={displayName}>{displayName}</AttachmentTitle>
        {importState.phase === "error" ? (
          <AttachmentDescription className="overflow-visible whitespace-normal text-clip text-destructive" data-testid="agent-snapshot-card-error">
            {importState.message}
          </AttachmentDescription>
        ) : metadata ? (
          <AttachmentDescription className="overflow-visible whitespace-normal text-clip text-secondary-foreground/75">{metadata}</AttachmentDescription>
        ) : null}
      </AttachmentContent>
      <AttachmentActions aria-label={t("agentSnapshots.cardActions", { name: displayName })} className="ml-4 gap-2" role="group">
        <AttachmentAction aria-label={t("agentSnapshots.cardDownload", { name: displayName })} data-testid="agent-snapshot-card-download"
          onClick={() => { void onDownload().catch(() => undefined); }} size="icon" title={t("buzz.download")} type="button" variant="ghost">
          <Download />
        </AttachmentAction>
        <AttachmentAction className="text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground hover:shadow-none"
          data-testid="agent-snapshot-card-import" disabled={isFetching} onClick={() => void handleImport()} size="sm" type="button" variant="default">
          {isFetching ? <Loader2 className="animate-spin" /> : <SnapshotIcon />}
          {isFetching ? t("platform.loading") : snapshotKind === "team" ? t("agentSnapshots.cardAddTeam") : t("agentSnapshots.cardAddAgent")}
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
