// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdown/AgentSnapshotCard.tsx
// (DD-143): the snapshot attachment card for `.agent.*`/`.team.*` attachments. Download goes
// through the host's authorized media transport. The original "Add" action first verifies the bytes
// against the message's imeta `x`/`size`, then opens the import preview: DD-131(2)
// `agent.definition.import` for `.agent.*`, DD-131(3) `agent.team.import` for `.team.*`.
// The original desktop/src/features/agents/openSnapshotImportFromUrlEvent.ts hand-off (card → AgentsView
// importer via a module-level pending payload) is replaced by opening the shared import preview in
// place once the bytes match imeta; nothing is parked between views.
import * as React from "react";
import { Bot, Download, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { useHasPlatform, useUiT } from "../context";
import { AgentSnapshotImportDialog, agentSnapshotSource, sha256Hex, type AgentSnapshotSource }
  from "../agent-library/AgentSnapshotImportDialog";
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle,
} from "../composer/shared/ui/attachment";
import { TeamSnapshotImportDialog, teamSnapshotSource, type TeamSnapshotSource }
  from "../agent-library/TeamSnapshotImportDialog";
import type { ResolvedSnapshotCard } from "./resolveFileCard";

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotCard({ displayName, href, filename, size, sha256, snapshotKind, thumb, sharedBy, onDownload, readBytes }:
  Omit<ResolvedSnapshotCard, "sha256"> & {
    sha256?: string;
    sharedBy?: string;
    onDownload: (url: string, filename: string) => Promise<unknown>;
    /** The host's authorized media read of this attachment; absent hosts do not offer "Add". */
    readBytes?: () => Promise<Uint8Array>;
  }) {
  const t = useUiT();
  const platform = useHasPlatform();
  const [thumbError, setThumbError] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [source, setSource] = React.useState<AgentSnapshotSource | null>(null);
  const [teamSource, setTeamSource] = React.useState<TeamSnapshotSource | null>(null);
  const canAdd = (snapshotKind === "agent" || snapshotKind === "team") && platform && !!readBytes && !!sha256
    && /^[0-9a-f]{64}$/.test(sha256);
  const add = async () => {
    if (!readBytes || !sha256 || adding) return;
    setAdding(true);
    try {
      const bytes = await readBytes();
      if ((size != null && bytes.length !== size) || await sha256Hex(bytes) !== sha256) {
        toast.error(t("messages.snapshot.mismatch"));
        return;
      }
      if (snapshotKind === "team") {
        const next = teamSnapshotSource(filename, bytes);
        if (next === "unsupported") toast.error(t("teamSnapshot.unsupportedFile"));
        else if (next === "tooLarge") toast.error(t("teamSnapshot.fileTooLarge"));
        else setTeamSource(next);
        return;
      }
      const next = agentSnapshotSource(filename, bytes);
      if (next === "unsupported") toast.error(t("agents.snapshot.unsupportedFile"));
      else if (next === "tooLarge") toast.error(t("agents.snapshot.fileTooLarge"));
      else setSource(next);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("buzz.downloadFailed"));
    } finally {
      setAdding(false);
    }
  };
  const name = displayName || t(snapshotKind === "team" ? "messages.snapshot.team" : "messages.snapshot.agent");
  const Icon = snapshotKind === "team" ? Users : Bot;
  const showThumb = Boolean(thumb) && !thumbError;
  const metadata = [sharedBy ? t("messages.snapshot.sharedBy", { name: sharedBy }) : null,
    size == null ? null : formatSize(size)].filter(Boolean).join(" · ");
  return (
    <Attachment className="my-1 inline-flex w-fit max-w-full shadow-none" data-testid="agent-snapshot-card"
      data-snapshot-kind={snapshotKind}>
      <AttachmentMedia variant={showThumb ? "image" : "icon"} className={showThumb ? "relative h-9 w-9" : "bg-brand-soft text-brand-soft-foreground"}>
        {showThumb ? <img alt="" className="h-full w-full object-cover" data-testid="agent-snapshot-card-thumb" src={thumb}
          referrerPolicy="no-referrer" onError={() => setThumbError(true)} /> : <Icon />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="overflow-visible whitespace-normal text-clip" title={name}>{name}</AttachmentTitle>
        <AttachmentDescription className="overflow-visible whitespace-normal text-clip">
          {metadata || t(snapshotKind === "team" ? "messages.snapshot.team" : "messages.snapshot.agent")}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions aria-label={t("messages.snapshot.actions", { name })} className="ml-4 gap-2" role="group">
        {canAdd ? <AttachmentAction aria-label={t("messages.snapshot.add", { name })} data-testid="agent-snapshot-card-add"
          size="icon" title={t("messages.snapshot.addLabel")} type="button" variant="ghost" disabled={adding}
          onClick={() => { void add(); }}>
          <Plus />
        </AttachmentAction> : null}
        <AttachmentAction aria-label={t("messages.snapshot.download", { name })} data-testid="agent-snapshot-card-download"
          size="icon" title={t("buzz.download")} type="button" variant="ghost"
          onClick={() => {
            onDownload(href, filename).catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : t("buzz.downloadFailed"));
            });
          }}>
          <Download />
        </AttachmentAction>
      </AttachmentActions>
      {canAdd && snapshotKind === "agent" ? <AgentSnapshotImportDialog source={source} onClose={() => setSource(null)} /> : null}
      {canAdd && snapshotKind === "team" ? <TeamSnapshotImportDialog source={teamSource} onClose={() => setTeamSource(null)} /> : null}
    </Attachment>
  );
}
