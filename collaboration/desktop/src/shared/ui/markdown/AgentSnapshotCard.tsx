// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdown/AgentSnapshotCard.tsx host
// wiring (DD-131(5)(7)). The card itself is shared; bytes come only from the validated Relay
// `/media/` path (`fetch_media_bytes`) and Download keeps the native `download_file` command.
import { AgentSnapshotCard as SharedAgentSnapshotCard } from "@client-kit/platform/react/messages/AgentSnapshotCard";
import type { ResolvedSnapshotCard } from "@client-kit/platform/react/messages/resolveFileCard";
import { invokeTauri } from "@/shared/api/tauri";
import { fetchMediaBytes } from "@/shared/api/tauriMedia";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function AgentSnapshotCard({ card }: { card: ResolvedSnapshotCard }) {
  const href = rewriteRelayUrl(card.href);
  return (
    <SharedAgentSnapshotCard
      displayName={card.displayName}
      filename={card.filename}
      size={card.size}
      sha256={card.sha256}
      snapshotKind={card.snapshotKind}
      thumb={card.isAgentPng ? href : undefined}
      fetchBytes={() => fetchMediaBytes(card.href)}
      onDownload={() => invokeTauri("download_file", { url: card.href, filename: card.filename })}
    />
  );
}
