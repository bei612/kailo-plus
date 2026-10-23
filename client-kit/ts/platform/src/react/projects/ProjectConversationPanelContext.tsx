// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/projects/ui/ProjectConversationPanelContext.tsx::{ProjectConversationPanelProvider,
// useProjectConversationPanel} and desktop/src/features/projects/ui/DiscussionChannels.tsx::openDiscussionHit.
// Inside project detail a "Discussed in" row opens the channel conversation beside the detail;
// outside it (and for forum hits, channel-only rows) the original navigation remains. The thread
// itself is the host's own governed channel thread (ProjectDiscussionHost.renderConversation).
import * as React from "react";
import type { SearchHit } from "../search/types";

/** desktop/src/shared/constants/kinds.ts KIND_FORUM_POST / KIND_FORUM_COMMENT. */
const KIND_FORUM_POST = 45001;
const KIND_FORUM_COMMENT = 45003;

export type ProjectConversationPanelValue = { openConversation: (hit: SearchHit) => void };

const ProjectConversationPanelContext = React.createContext<ProjectConversationPanelValue | null>(null);

export function ProjectConversationPanelProvider({ children, onOpenConversation }: {
  children: React.ReactNode;
  onOpenConversation: (hit: SearchHit) => void;
}) {
  const value = React.useMemo(() => ({ openConversation: onOpenConversation }), [onOpenConversation]);
  return <ProjectConversationPanelContext.Provider value={value}>{children}</ProjectConversationPanelContext.Provider>;
}

/** Returns null outside project detail, where normal channel navigation remains. */
export function useProjectConversationPanel() {
  return React.useContext(ProjectConversationPanelContext);
}

/** Original openDiscussionHit order: no hit → channel; forum hit or no panel → message link; else the panel. */
export async function openDiscussionHit({ channelId, latestHit, panel, openChannel, openHit }: {
  channelId: string;
  latestHit: SearchHit | undefined;
  panel: ProjectConversationPanelValue | null;
  openChannel: (channelId: string) => unknown;
  openHit: (hit: SearchHit) => unknown;
}) {
  if (!latestHit) { await openChannel(channelId); return; }
  const opensForum = latestHit.kind === KIND_FORUM_POST || latestHit.kind === KIND_FORUM_COMMENT;
  if (!panel || opensForum) { await openHit(latestHit); return; }
  panel.openConversation(latestHit);
}
