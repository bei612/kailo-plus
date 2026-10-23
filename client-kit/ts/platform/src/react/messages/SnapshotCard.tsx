// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdown/AgentSnapshotCard.tsx
// (DD-143): the snapshot attachment card for `.agent.*`/`.team.*` attachments. Download goes
// through the host's authorized media transport. The original "Add agent/team" action opens
// the DD-131(2)(3) import preview (`agent.definition.import` / `agent.team.import`); Kailo has no
// RESOURCE_IMPORT path yet, so that action is not rendered rather than offered as a dead button.
import * as React from "react";
import { Bot, Download, Users } from "lucide-react";
import { toast } from "sonner";

import { useUiT } from "../context";
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle,
} from "../composer/shared/ui/attachment";
import type { ResolvedSnapshotCard } from "./resolveFileCard";

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotCard({ displayName, href, filename, size, snapshotKind, thumb, sharedBy, onDownload }:
  Omit<ResolvedSnapshotCard, "sha256"> & {
    sharedBy?: string;
    onDownload: (url: string, filename: string) => Promise<unknown>;
  }) {
  const t = useUiT();
  const [thumbError, setThumbError] = React.useState(false);
  const name = displayName || t(snapshotKind === "team" ? "messages.snapshot.team" : "messages.snapshot.agent");
  const Icon = snapshotKind === "team" ? Users : Bot;
  const showThumb = Boolean(thumb) && !thumbError;
  const metadata = [sharedBy ? t("messages.snapshot.sharedBy", { name: sharedBy }) : null,
    size == null ? null : formatSize(size)].filter(Boolean).join(" · ");
  return (
    <Attachment className="my-1 inline-flex w-fit max-w-full shadow-none" data-testid="agent-snapshot-card"
      data-snapshot-kind={snapshotKind}>
      <AttachmentMedia variant={showThumb ? "image" : "icon"} className={showThumb ? "relative h-9 w-9" : undefined}>
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
    </Attachment>
  );
}
