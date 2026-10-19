// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/agentSessionTranscriptContext.ts.
import * as React from "react";

export type AgentSessionTranscriptVariant = "default" | "compactPreview";

const AgentSessionTranscriptVariantContext =
  React.createContext<AgentSessionTranscriptVariant>("default");

export const AgentSessionTranscriptVariantProvider =
  AgentSessionTranscriptVariantContext.Provider;

export function useAgentSessionTranscriptVariant() {
  return React.useContext(AgentSessionTranscriptVariantContext);
}
