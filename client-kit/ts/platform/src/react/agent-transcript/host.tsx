// DD-125(6): what the shared transcript needs from its host. The Web host gives
// the live SSE stream and its shared Markdown renderer; a host without them still
// renders paged transcripts with plain text bodies.
import * as React from "react";

import type { AgentTranscriptStreamOpener } from "../../client";
import { cn } from "../profile/buzz/shared/lib/cn";

export type AgentTranscriptHost = {
  /** Authenticated scope (e.g. Tenant principal + session); live data never crosses it. */
  scopeKey?: string;
  openStream?: AgentTranscriptStreamOpener;
  renderMarkdown?: (
    content: string,
    options: { className?: string; workspaceId?: string },
  ) => React.ReactNode;
};

const AgentTranscriptHostContext = React.createContext<AgentTranscriptHost>({});
const TranscriptWorkspaceContext = React.createContext<string | undefined>(undefined);

export function AgentTranscriptHostProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AgentTranscriptHost;
}) {
  return (
    <AgentTranscriptHostContext.Provider value={value}>
      {children}
    </AgentTranscriptHostContext.Provider>
  );
}

export function useAgentTranscriptHost(): AgentTranscriptHost {
  return React.useContext(AgentTranscriptHostContext);
}

/** The Installation's Workspace, for media inside rendered Markdown. */
export const TranscriptWorkspaceProvider = TranscriptWorkspaceContext.Provider;

/** Original `<Markdown content className />` through the host renderer. */
export function TranscriptMarkdown({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  const host = useAgentTranscriptHost();
  const workspaceId = React.useContext(TranscriptWorkspaceContext);
  if (host.renderMarkdown) {
    return <>{host.renderMarkdown(content, { className, workspaceId })}</>;
  }
  return (
    <p className={cn("whitespace-pre-wrap wrap-anywhere", className)}>
      {content}
    </p>
  );
}
