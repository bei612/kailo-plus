// DD-125(6): shared Agent session transcript (Codex item adapter over the original
// Buzz renderers), its live seam and the activity opener used by working surfaces.
export type {
  AgentActivityDescriptor,
  AgentActivityRenderClass,
  ToolStatus,
  TranscriptItem,
} from "./agentSessionTypes";
export {
  adaptTranscriptItems,
  agentSessionKey,
  fileChangeDiff,
  type AdaptOptions,
  type AgentTranscriptEntry,
} from "./agentTranscriptAdapter";
export {
  getActivityHeadline,
  isMeaningfulItem,
  isSpineItem,
} from "./agentSessionTranscriptPresentation";
export { buildTranscriptDisplayBlocks } from "./agentSessionTranscriptGrouping";
export { formatElapsed } from "./agentSessionUtils";
export {
  AgentSessionTranscriptList,
  type AgentSessionTranscriptEmptyState,
} from "./AgentSessionTranscriptList";
export {
  AgentSessionPanel,
  AgentSessionTranscriptView,
  type AgentSessionPanelProps,
} from "./AgentSessionPanel";
export { TurnLivenessIndicator } from "./TurnLivenessIndicator";
export {
  useAgentSessionTranscript,
  useAgentTranscript,
  useAgentTranscriptLive,
  type AgentSessionTranscriptState,
} from "./useAgentTranscript";
export { useInterruptTurn } from "./useInterruptTurn";
export {
  AgentTranscriptHostProvider,
  useAgentTranscriptHost,
  type AgentTranscriptHost,
} from "./host";
export {
  AgentActivityOpenerHost,
  AgentActivityOpenerProvider,
  useOpenAgentActivity,
  useRegisterAgentActivityOpener,
  type AgentActivityOpener,
  type OpenAgentActivityOptions,
} from "./open-agent-activity";
export type { LiveTranscriptSnapshot, LiveTurn } from "./liveTranscriptStore";
export {
  setTranscriptAnimationEnabled,
  setTranscriptTimestampsEnabled,
  useTranscriptAnimationEnabled,
  useTranscriptTimestampsEnabled,
} from "./transcriptPreferences";
