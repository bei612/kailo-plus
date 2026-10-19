// DD-125(6): the Web host of the shared Agent transcript — the BFF SSE seam,
// the shared Markdown renderer and the authenticated scope that bounds live data.
import { useMemo, type ReactNode } from "react";
import type { PlatformSessionView } from "@client-kit/contracts";
import { AgentTranscriptHostProvider, type AgentTranscriptHost } from "@client-kit/platform/react/agent-transcript";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { openAgentTranscriptStream } from "../agentTranscriptStream";

export function WebAgentTranscriptHost({ session, children }: { session: PlatformSessionView; children: ReactNode }) {
  const value = useMemo<AgentTranscriptHost>(() => ({
    scopeKey: `${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`,
    openStream: openAgentTranscriptStream,
    // Transcript text is display-only Markdown: no message actions or link previews.
    renderMarkdown: (content, options) => <MessageContent className={options.className}
      content={content} interactive={false} workspaceId={options.workspaceId} />,
  }), [session.platformSessionId, session.tenantId, session.tenantPrincipalId]);
  return <AgentTranscriptHostProvider value={value}>{children}</AgentTranscriptHostProvider>;
}
