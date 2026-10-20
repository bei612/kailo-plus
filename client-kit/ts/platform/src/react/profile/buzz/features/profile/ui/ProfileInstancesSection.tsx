// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/ProfileInstancesSection.tsx.
// DD-125(4): a persona's managed instances are the Installations of the same AgentDefinition;
// only those in the admitted Workspace directory the profile was opened from are known here.
// The original identity-archive bucket has no Kailo authority, so there is no "Archived"
// subsection; each row shows its recorded Installation state instead.
import type { AgentInstallationView } from "@client-kit/contracts";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { installationLabels } from "../../../../../agent-installation-view";
import { useUiT } from "../../../../../context";
import { truncateNpub } from "../../../../../conversations/pubkey";
import { cn } from "../../../shared/lib/cn";
import { ProfileSectionGroup } from "./UserProfilePanelFields";

const ROW_CLASS =
  "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left";

function ProfileInstanceRow({
  currentPubkey,
  instance,
  onOpenInstance,
}: {
  currentPubkey: string | null;
  instance: AgentInstallationView;
  onOpenInstance?: (pubkey: string) => void;
}) {
  const t = useUiT();
  const pubkey = instance.agentPubkey ?? "";
  const isCurrent =
    currentPubkey !== null && pubkey.toLowerCase() === currentPubkey.toLowerCase();
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {instance.agentDisplayName?.trim() || truncateNpub(pubkey)}
      </span>
      <span className="text-xs text-muted-foreground">
        {isCurrent
          ? t("platform.profile.instances.current")
          : t(installationLabels[instance.state])}
      </span>
      {onOpenInstance ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  if (!onOpenInstance) {
    return (
      <div className={ROW_CLASS} data-testid={`user-profile-instance-${pubkey}`}>
        {content}
      </div>
    );
  }
  return (
    <button
      className={cn(
        ROW_CLASS,
        "transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
      data-testid={`user-profile-instance-${pubkey}`}
      onClick={() => onOpenInstance(pubkey)}
      type="button"
    >
      {content}
    </button>
  );
}

/**
 * The Definition's Installations in this Workspace. The count reflects every row; the section
 * renders only when at least one instance exists.
 */
export function ProfileInstancesSection({
  currentPubkey,
  instances,
  onOpenInstance,
}: {
  currentPubkey: string | null;
  instances: AgentInstallationView[];
  /** Absent when the host cannot open another profile from this panel. */
  onOpenInstance?: (pubkey: string) => void;
}) {
  const t = useUiT();
  const [expanded, setExpanded] = React.useState(false);
  const totalCount = instances.length;
  if (totalCount === 0) return null;
  const instanceCountLabel = t(
    totalCount === 1
      ? "platform.profile.instances.count.one"
      : "platform.profile.instances.count.other",
    { count: totalCount },
  );

  return (
    <ProfileSectionGroup
      testId="user-profile-instances-section"
      title={t("platform.profile.instances.title")}
    >
      <button
        aria-expanded={expanded}
        className={cn(
          ROW_CLASS,
          "transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        data-testid="user-profile-instances"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 text-sm font-medium">
          {instanceCountLabel}
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded
        ? instances.map((instance) => (
            <ProfileInstanceRow
              currentPubkey={currentPubkey}
              instance={instance}
              key={instance.resourceId}
              onOpenInstance={onOpenInstance}
            />
          ))
        : null}
    </ProfileSectionGroup>
  );
}
