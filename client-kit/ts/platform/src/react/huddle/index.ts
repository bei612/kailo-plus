// DD-125(3): the original Buzz Huddle surfaces shared by the hosts (see ./host for the seam).
export {
  type AudioOutputDevice, type AudioWorkletHandle, type HuddleBackendState, type HuddleHost, type HuddleHostEvents,
  type HuddleJoinInfo, type HuddleParent, type HuddlePhase, type VoiceInputMode, HuddleHostProvider, HuddleParentProvider,
  IDLE_HUDDLE_STATE, huddleParentKey, useHasHuddleHost, useHuddleHost, useHuddleParent, useHuddleParentChannelName,
} from "./host";
export {
  type AudioInputDevice, type HuddleContextValue, type HuddleLevelsValue, HuddleProvider, useFormatHuddleError, useHuddle,
  useHuddleLevels, useOptionalHuddle,
} from "./HuddleContext";
export { HuddleIndicator } from "./HuddleIndicator";
export { HuddleAttachment } from "./HuddleAttachment";
export { HuddleBar } from "./HuddleBar";
export { HuddleShell } from "./HuddleShell";
export { MicControls, SpeakerControls, DeviceList } from "./MicControls";
export { HuddleParticipantsControl } from "./ParticipantList";
export { AddAgentDialog } from "./AddAgentDialog";
export {
  HUDDLE_POLL_MS, type HuddleDirectoryEntry, huddleParentQueryKey, useActiveParentHuddle, useHuddleDirectory, useHuddleLifecycle,
  useParentHuddles,
} from "./queries";
