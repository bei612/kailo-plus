// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelUtils.ts: panel views, summary tabs, their
// search parsing and the profile channel links.
// Kailo differences, each with its design basis:
// - DD-26: Agents run only as SERVER_CODEX, so the local harness views ("diagnostics", "logs")
//   have no object; those search values fall back to the summary.
// - DD-125(4)/(6), 17 §8: the managed agent / persona inputs are the admitted AgentInstallation
//   (≙ managed instance) of an AgentDefinition (≙ persona); its channel is the Workspace channel
//   of its ACTIVE ChannelAgentBinding.
import {
  AgentInstallationViewChannelBindingStatus,
  type AgentInstallationView,
} from "@client-kit/contracts";

import type { PlatformMessageKey } from "../../../../../../i18n";

export type ProfileChannelLink = {
  id: string;
  name: string;
};

export type ProfilePanelView =
  | "summary"
  | "instructions"
  | "info"
  | "configuration"
  | "memories"
  | "channels";

export type ProfilePanelTab = "info" | "runtime" | "channels" | "memories";

export const PROFILE_PANEL_VIEW_TITLES = {
  summary: "platform.settings.profile",
  instructions: "platform.profile.section.instructions",
  info: "platform.profile.section.agentInfo",
  configuration: "platform.profile.section.runtime",
  memories: "platform.profile.section.memories",
  channels: "platform.profile.section.channels",
} as const satisfies Record<ProfilePanelView, PlatformMessageKey>;

const PROFILE_PANEL_VIEWS = new Set<string>(
  Object.keys(PROFILE_PANEL_VIEW_TITLES),
);

const PROFILE_PANEL_TABS = new Set<string>([
  "info",
  "runtime",
  "channels",
  "memories",
]);

const LEGACY_PROFILE_PANEL_VIEW_ALIASES: Record<string, ProfilePanelView> = {
  model: "configuration",
  settings: "configuration",
};

export function parseProfilePanelView(value: unknown): ProfilePanelView | null {
  if (typeof value !== "string") {
    return null;
  }

  if (PROFILE_PANEL_VIEWS.has(value)) {
    return value as ProfilePanelView;
  }

  return LEGACY_PROFILE_PANEL_VIEW_ALIASES[value] ?? null;
}

export function profilePanelViewFromSearch(value: unknown): ProfilePanelView {
  return parseProfilePanelView(value) ?? "summary";
}

export function parseProfilePanelTab(value: unknown): ProfilePanelTab | null {
  if (typeof value !== "string") {
    return null;
  }

  if (PROFILE_PANEL_TABS.has(value)) {
    return value as ProfilePanelTab;
  }

  return null;
}

export function profilePanelTabFromSearch(value: unknown): ProfilePanelTab {
  return parseProfilePanelTab(value) ?? "info";
}

export function profilePanelTargetKey(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

/**
 * The Agent's visible channel: the Workspace channel of its ACTIVE ChannelAgentBinding, named by
 * the host that admitted the Workspace. A binding without a recorded channel shows nothing.
 */
export function deriveProfileChannels(
  installation: Pick<AgentInstallationView, "channelBinding">,
  channelName: string | null | undefined,
): ProfileChannelLink[] {
  const binding = installation.channelBinding;
  if (
    !binding ||
    binding.status !== AgentInstallationViewChannelBindingStatus.Active ||
    !binding.channelId
  ) {
    return [];
  }
  return [{ id: binding.channelId, name: channelName?.trim() || binding.channelId }];
}
