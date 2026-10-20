// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelFocusedViews.tsx: Memories, Channels and Agent
// info views (embedded in the summary tabs or focused).
// Kailo differences, each with its design basis:
// - DD-68, 19 §7: Memories is the governed Installation memory surface (HUMAN owner; Core
//   re-admits every read and write), replacing the local NIP-AE MemorySection.
// - The original "Add to channel" ingress attaches the same local agent to another channel. A
//   Kailo AgentPrincipal belongs to one Installation in one Workspace; adding an Agent elsewhere
//   is a separate agent.installation.create with its own identity, which has no designed entry
//   from this panel, so the row is not rendered.
// - DD-26: the harness log ("Diagnostics" / "Logs") has no local process and is not rendered.
import type { AgentInstallationView } from "@client-kit/contracts";
import { ArrowUpRight, UserPlus } from "lucide-react";

import { useUiT } from "../../../../../context";
import { InstallationMemory } from "../../../../../memory";
import {
  type ProfileField,
  ProfileFieldGroup,
  ProfileSectionGroup,
} from "./UserProfilePanelFields";
import type { ProfileChannelLink } from "./UserProfilePanelUtils";

export function MemoryFocusedView({
  installation,
  variant = "focused",
  viewerIsOwner,
}: {
  installation: AgentInstallationView;
  variant?: "embedded" | "focused";
  viewerIsOwner: boolean;
}) {
  if (!viewerIsOwner) {
    return null;
  }

  return (
    <div className={variant === "focused" ? "pt-4" : undefined}>
      <ProfileSectionGroup testId="user-profile-memories-section">
        <div className="px-4 pb-4">
          <InstallationMemory
            installation={installation}
            key={`${installation.workspaceId}:${installation.resourceId}`}
            resourceId={installation.resourceId}
            workspaceId={installation.workspaceId}
          />
        </div>
      </ProfileSectionGroup>
    </div>
  );
}

export function ChannelsFocusedView({
  channels,
  onOpenChannel,
  variant = "focused",
}: {
  channels: ProfileChannelLink[];
  onOpenChannel?: (channelId: string) => void;
  variant?: "embedded" | "focused";
}) {
  const t = useUiT();
  return (
    <div className={variant === "focused" ? "pt-4" : undefined}>
      <ProfileSectionGroup testId="user-profile-channels-section">
        {channels.length === 0 ? (
          <div
            className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"
            data-testid="user-profile-channels-empty"
          >
            <UserPlus className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {t("platform.profile.channels.emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("platform.profile.channels.emptyBody")}
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-border/55"
            data-testid="user-profile-channels-list"
          >
            {channels.map((channel) => (
              <li key={channel.id}>
                {onOpenChannel ? (
                  <button
                    aria-label={t("platform.profile.channels.open", { name: channel.name })}
                    className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                    data-testid={`user-profile-channel-link-${channel.name}`}
                    onClick={() => onOpenChannel(channel.id)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      #{channel.name}
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </button>
                ) : (
                  <div
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground"
                    data-testid={`user-profile-channel-link-${channel.name}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      #{channel.name}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </ProfileSectionGroup>
    </div>
  );
}

export function AgentInfoFocusedView({
  metadataFields,
}: {
  metadataFields: ProfileField[];
}) {
  const t = useUiT();
  if (metadataFields.length === 0) {
    return null;
  }

  return (
    <div className="pt-4">
      <ProfileFieldGroup
        fields={metadataFields}
        title={t("platform.profile.panelInfo")}
      />
    </div>
  );
}
