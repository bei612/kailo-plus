// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelTabs.tsx: ingress rows, the tab bar, the Info
// tab (live activity embed, Info section, management rows) and the Runtime tab.
// Kailo differences, each with its design basis:
// - DD-125(6): the live activity embed is the Installation's Codex thread for `audit` holders;
//   the original ManagedAgentSessionPanel embed is AgentSessionPreview. A Kailo Agent is one
//   Installation in one Workspace channel, so the embed has at most one slide; slides switch by
//   their dots without the original Embla carousel dependency.
// - DD-125(6): "Delete agent" is agent.installation.disable through the shared lifecycle confirm
//   (profile, history and settings are kept). Archive, duplicate, export, trading card and the
//   protected Bestie action have no Kailo authority (identity archive / snapshots / cards are not
//   designed) and are not rendered.
// - DD-26: the Runtime tab has no "Start on launch", "Harness log" or restart-drift banner (no
//   local runtime; a Version is immutable, so its config cannot drift from a running process);
//   the per-agent model/MCP config panel is a local ACP write surface and is not rendered.
import type { AgentInstallationView } from "@client-kit/contracts";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, MessageSquare, Trash2, Wrench } from "lucide-react";
import * as React from "react";

import type { LifecycleRequest } from "../../../../../agent-activity/AgentLifecycleControls";
import { AgentSessionPreview } from "../../../../../agent-transcript/AgentSessionPanel";
import { useUiT, type Translate } from "../../../../../context";
import { PanelSectionGroup } from "../../../../../pulse/PanelSectionGroup";
import { useNow } from "../../../../../useNow";
import { cn } from "../../../shared/lib/cn";
import { Button } from "../../../shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../../shared/ui/tabs";
import type { ProfileActivityAgent } from "../lib/profileActivityAgent";
import { resolveActivityChannelId } from "../lib/profileActivityCarousel";
import {
  type ProfileActiveTurn,
  type ProfileActivityFeedScope,
  useProfileActivityFeedScope,
} from "../lib/profileActivityFeedScope";
import { useAgentTranscript } from "../../../../../agent-transcript/useAgentTranscript";
import { ProfileInstancesSection } from "./ProfileInstancesSection";
import {
  type ProfileField,
  ProfileFieldRows,
  ProfileSectionGroup,
} from "./UserProfilePanelFields";
import type { ProfilePanelTab } from "./UserProfilePanelUtils";

export function ProfileIngressRow({
  disabled,
  disclosureIcon: DisclosureIcon = ChevronRight,
  grouped = false,
  icon: Icon,
  label,
  onClick,
  testId,
  trailing,
}: {
  disabled?: boolean;
  disclosureIcon?: LucideIcon;
  grouped?: boolean;
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  testId: string;
  trailing?: React.ReactNode;
}) {
  const trailingTitle = typeof trailing === "string" ? trailing : undefined;

  const content = (
    <>
      {Icon ? (
        <Icon
          className="h-4 w-4 shrink-0 text-muted-foreground"
          data-slot="profile-ingress-icon"
        />
      ) : null}
      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {label}
      </span>
      {trailing ? (
        <span
          className="max-w-[45%] truncate text-right text-sm text-muted-foreground"
          title={trailingTitle}
        >
          {trailing}
        </span>
      ) : null}
      {onClick ? (
        <DisclosureIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  const className = cn(
    "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left",
    onClick &&
      "transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
  );

  let row: React.ReactNode;
  if (!onClick) {
    row = (
      <div className={className} data-testid={testId}>
        {content}
      </div>
    );
  } else {
    row = (
      <button
        className={cn(
          className,
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return grouped ? (
    row
  ) : (
    <PanelSectionGroup testId={`${testId}-section`}>{row}</PanelSectionGroup>
  );
}

export function ProfileTabBar({
  activeTab,
  onTabChange,
  tabs,
}: {
  activeTab: ProfilePanelTab;
  onTabChange: (tab: ProfilePanelTab) => void;
  tabs: Array<{
    id: ProfilePanelTab;
    label: string;
    trailing?: React.ReactNode;
  }>;
}) {
  const t = useUiT();
  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  );

  return (
    <Tabs
      className="w-full"
      onValueChange={(value) => onTabChange(value as ProfilePanelTab)}
      value={activeTab}
    >
      <TabsList
        aria-label={t("platform.profile.tabs")}
        className="relative isolate grid h-9 w-full overflow-hidden rounded-lg bg-muted p-0.5"
        data-testid="user-profile-tab-list"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute bottom-0.5 left-0.5 top-0.5 z-0 rounded-md bg-background shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          data-testid="user-profile-tab-indicator"
          style={{
            transform: `translateX(${activeIndex * 100}%)`,
            width: `calc((100% - 4px) / ${tabs.length})`,
          }}
        />
        {tabs.map((tab) => {
          return (
            <TabsTrigger
              className="group relative z-10 h-full min-w-0 gap-1 rounded-md bg-transparent px-2 text-xs font-medium shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              data-testid={`user-profile-tab-${tab.id}`}
              key={tab.id}
              value={tab.id}
            >
              <span className="truncate">{tab.label}</span>
              {tab.trailing ? (
                <span className="inline-flex shrink-0 items-center leading-none text-2xs text-muted-foreground group-data-[state=active]:text-foreground/70">
                  {tab.trailing}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export function ProfileInfoTabContent({
  activeTurns,
  activityAgent,
  agentInfoFields,
  canDeleteAgent,
  channelIdToName,
  lifecycle,
  installation,
  onOpenActivity,
  onOpenInstructions,
  pubkey,
  showActivityIngress,
  showInstructionBlock,
}: {
  activeTurns: readonly ProfileActiveTurn[];
  activityAgent: ProfileActivityAgent | null;
  agentInfoFields: ProfileField[];
  canDeleteAgent: boolean;
  channelIdToName: Record<string, string>;
  lifecycle: LifecycleRequest;
  installation: AgentInstallationView;
  onOpenActivity: (channelId?: string | null) => void;
  onOpenInstructions: () => void;
  pubkey: string;
  showActivityIngress: boolean;
  showInstructionBlock: boolean;
}) {
  const t = useUiT();
  const infoFields = agentInfoFields;
  const hasInfoFields = infoFields.length > 0;
  // The live window of the Installation's transcript (original observer transcript): only an
  // `audit` holder subscribes, and only while the activity ingress is shown.
  const transcript = useAgentTranscript(
    installation.resourceId,
    showActivityIngress && activityAgent !== null,
    { agentName: activityAgent?.name ?? "", channelId: installation.workspaceId },
  );
  const feedScope = useProfileActivityFeedScope(activeTurns, transcript);
  const showLiveActivityEmbed =
    showActivityIngress && (feedScope.isLive || feedScope.hasFeedContent);

  if (
    !hasInfoFields &&
    !canDeleteAgent &&
    !showActivityIngress &&
    !showInstructionBlock
  ) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="user-profile-info-sections">
      {showActivityIngress ? (
        showLiveActivityEmbed && activityAgent ? (
          <ProfileLiveActivityEmbed
            activeTurns={activeTurns}
            activityAgent={activityAgent}
            channelIdToName={channelIdToName}
            feedScope={feedScope}
            onOpenActivity={onOpenActivity}
          />
        ) : (
          <ProfileIngressRow
            icon={Wrench}
            label={t("platform.profile.activityLog")}
            onClick={() => onOpenActivity(null)}
            testId={`user-profile-view-activity-${pubkey}`}
            trailing={t("platform.profile.activityView")}
          />
        )
      ) : null}
      {hasInfoFields || showInstructionBlock ? (
        <ProfileSectionGroup
          testId="user-profile-info-section"
          title={t("platform.profile.panelInfo")}
        >
          {showInstructionBlock ? (
            <ProfileIngressRow
              grouped
              icon={MessageSquare}
              label={t("platform.profile.section.instructions")}
              onClick={onOpenInstructions}
              testId="user-profile-agent-instruction-row"
            />
          ) : null}
          <ProfileFieldRows fields={infoFields} />
        </ProfileSectionGroup>
      ) : null}
      {canDeleteAgent ? (
        <PanelSectionGroup testId="user-profile-agent-management-section">
          <ProfileAgentActionRow
            destructive
            disabled={lifecycle.controller.busy || lifecycle.controller.pending.length > 0}
            icon={Trash2}
            label={t("platform.profile.deleteAgent")}
            onClick={() => lifecycle.request("remove", [installation])}
            testId="user-profile-delete-agent-row"
          />
        </PanelSectionGroup>
      ) : null}
    </div>
  );
}

export function ProfileAgentActionRow({
  destructive = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon
        className={
          destructive
            ? "h-4 w-4 shrink-0 text-destructive"
            : "h-4 w-4 shrink-0 text-muted-foreground"
        }
        data-slot="profile-action-icon"
      />
      <span
        className={
          destructive
            ? "min-w-0 flex-1 text-sm font-medium text-destructive"
            : "min-w-0 flex-1 text-sm font-medium"
        }
      >
        {label}
      </span>
    </button>
  );
}

function ProfileLiveActivityEmbed({
  activeTurns,
  activityAgent,
  channelIdToName,
  feedScope,
  onOpenActivity,
}: {
  activeTurns: readonly ProfileActiveTurn[];
  activityAgent: ProfileActivityAgent;
  channelIdToName: Record<string, string>;
  feedScope: ProfileActivityFeedScope;
  onOpenActivity: (channelId?: string | null) => void;
}) {
  const t = useUiT();
  const [selectedChannelId, setSelectedChannelId] = React.useState<
    string | null
  >(null);

  const slides = React.useMemo(() => {
    const channelIds = feedScope.isLive
      ? activeTurns.map((turn) => turn.channelId)
      : feedScope.channelIds;
    return [...new Set(channelIds)];
  }, [activeTurns, feedScope.channelIds, feedScope.isLive]);

  const activeChannelId = resolveActivityChannelId(
    slides,
    selectedChannelId,
    feedScope.preferredChannelId,
  );
  const selectedIndex = activeChannelId ? slides.indexOf(activeChannelId) : 0;

  const selectedTurn = feedScope.isLive
    ? (activeTurns.find((turn) => turn.channelId === activeChannelId) ??
      activeTurns[0] ??
      null)
    : null;
  const activeChannelName = activeChannelId
    ? (channelIdToName[activeChannelId] ?? activeChannelId)
    : null;
  const lastLiveAt =
    (activeChannelId
      ? feedScope.latestActivityAtByChannel[activeChannelId]
      : undefined) ??
    selectedTurn?.anchorAt ??
    null;
  const emptyState = feedScope.isLive ? "loading" : "idle";
  const emptyDescription = t("platform.profile.activity.empty");
  const openSelectedActivity = React.useCallback(() => {
    onOpenActivity(activeChannelId);
  }, [activeChannelId, onOpenActivity]);

  const handleDotSelect = React.useCallback(
    (index: number) => {
      const targetIndex =
        slides.length === 2 && index === selectedIndex
          ? (selectedIndex + 1) % slides.length
          : index;
      setSelectedChannelId(slides[targetIndex] ?? null);
    },
    [selectedIndex, slides],
  );
  const openLabel = t("platform.profile.activity.openFeed", {
    label: formatLastLiveLabel(t, lastLiveAt, Date.now()),
  });
  const compact = slides.length > 0;

  return (
    <div>
      <section
        aria-label={openLabel}
        className="relative flex h-56 cursor-pointer flex-col overflow-hidden rounded-2xl border bg-background text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`user-profile-live-activity-${activityAgent.pubkey}`}
      >
        <button
          aria-label={openLabel}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openSelectedActivity}
          type="button"
        />
        <LiveActivityOpenButton
          activeChannelId={activeChannelId}
          lastLiveAt={lastLiveAt}
          onOpenActivity={onOpenActivity}
        />
        <AgentSessionPreview
          agentAvatarUrl={activityAgent.avatarUrl ?? null}
          agentName={activityAgent.name}
          channelId={activeChannelId}
          className={cn(
            "relative z-0 min-h-0 flex-1 border-0 bg-transparent px-4 text-xs shadow-none **:data-message-id:pointer-events-none",
            compact && "h-full",
          )}
          contentContainerClassName="py-4"
          emptyDescription={emptyDescription}
          emptyState={emptyState}
          installation={activityAgent.installation}
          key={activeChannelId ?? "none"}
        />
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex flex-col items-start bg-linear-to-t from-background to-transparent px-3 pb-3",
              compact ? "via-background/80 pt-16" : "via-background/90 pt-24",
            )}
          >
            <div className="min-w-0">
              <span
                className={cn(
                  "block font-semibold text-muted-foreground",
                  compact ? "text-xs" : "text-sm",
                )}
              >
                {t("platform.profile.activity.latest")}
              </span>
              {compact && activeChannelName ? (
                <span
                  className="block truncate text-xs font-medium text-muted-foreground/75"
                  data-testid="user-profile-activity-channel-label"
                  title={`#${activeChannelName}`}
                >
                  #{activeChannelName}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <ActivityCarouselDots
        channelIdToName={channelIdToName}
        onSelect={handleDotSelect}
        selectedIndex={selectedIndex}
        slides={slides}
      />
    </div>
  );
}

function ActivityCarouselDots({
  channelIdToName,
  onSelect,
  selectedIndex,
  slides,
}: {
  channelIdToName: Record<string, string>;
  onSelect: (index: number) => void;
  selectedIndex: number;
  slides: string[];
}) {
  const t = useUiT();
  if (slides.length <= 1) {
    return null;
  }

  return (
    <div
      aria-label={t("platform.profile.activity.chooseChannel")}
      className="mt-2 flex items-center justify-center gap-1.5"
      role="tablist"
    >
      {slides.map((channelId, index) => {
        const isSelected = index === selectedIndex;
        const channelName = channelIdToName[channelId] ?? channelId;

        return (
          <button
            aria-label={t("platform.profile.activity.showChannel", { name: channelName })}
            aria-selected={isSelected}
            className="group relative flex items-center justify-center before:absolute before:-inset-2 before:content-['']"
            data-testid={`user-profile-activity-dot-${channelId}`}
            key={channelId}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(index);
            }}
            role="tab"
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 block rounded-full bg-foreground transition-all",
                isSelected
                  ? "h-1 w-4"
                  : "h-1 w-1 opacity-30 group-hover:opacity-60",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function LiveActivityOpenButton({
  activeChannelId,
  lastLiveAt,
  onOpenActivity,
}: {
  activeChannelId: string | null;
  lastLiveAt: number | null;
  onOpenActivity: (channelId?: string | null) => void;
}) {
  const t = useUiT();
  const now = useNow(15_000);
  const label = formatLastLiveLabel(t, lastLiveAt, now);

  return (
    <Button
      aria-label={t("platform.profile.activity.openFull", { label })}
      className="absolute right-3 top-3 z-40 rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      onClick={(event) => {
        event.stopPropagation();
        onOpenActivity(activeChannelId);
      }}
      size="xs"
      title={t("platform.profile.activity.lastLive", { label })}
      type="button"
    >
      {label}
    </Button>
  );
}

export function formatLastLiveLabel(
  t: Translate,
  timestamp: number | null,
  now: number,
): string {
  if (timestamp === null) {
    return t("platform.profile.activity.noActivity");
  }

  const elapsedMs = Math.max(0, now - timestamp);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return t("platform.profile.activity.justNow");
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return t("agentTranscript.recency.minutes", { count: totalMinutes });
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return t("agentTranscript.recency.hours", { count: totalHours });
  }

  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 7) {
    return t("agentTranscript.recency.days", { count: totalDays });
  }

  const totalWeeks = Math.floor(totalDays / 7);
  return t("agentTranscript.recency.weeks", { count: totalWeeks });
}

export function ProfileRuntimeTabContent({
  configurationFields,
  currentPubkey,
  diagnosticsFields,
  instances,
  onOpenInstance,
}: {
  configurationFields: ProfileField[];
  currentPubkey: string | null;
  diagnosticsFields: ProfileField[];
  instances: AgentInstallationView[];
  onOpenInstance?: (pubkey: string) => void;
}) {
  const t = useUiT();
  const statusDiagnosticsFields = diagnosticsFields.filter(
    (field) => field.key === "status",
  );
  const hasActivityRows = statusDiagnosticsFields.length > 0;
  const hasConfigurationRows = configurationFields.length > 0;
  const hasInstances = instances.length > 0;

  if (!hasActivityRows && !hasConfigurationRows && !hasInstances) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="user-profile-runtime-sections">
      {hasActivityRows ? (
        <ProfileSectionGroup
          testId="user-profile-runtime-activity-section"
          title={t("agentTranscript.activity")}
        >
          <ProfileFieldRows fields={statusDiagnosticsFields} variant="runtime" />
        </ProfileSectionGroup>
      ) : null}
      {hasConfigurationRows ? (
        <ProfileSectionGroup
          testId="user-profile-agent-configuration-section"
          title={t("platform.profile.section.configuration")}
        >
          <ProfileFieldRows fields={configurationFields} variant="runtime" />
        </ProfileSectionGroup>
      ) : null}
      {hasInstances ? (
        <ProfileInstancesSection
          currentPubkey={currentPubkey}
          instances={instances}
          onOpenInstance={onOpenInstance}
        />
      ) : null}
    </div>
  );
}
