// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelSections.tsx: the `isBot` branch of
// ProfileSummaryView (sticky hero and tabs, primary actions, Info / Runtime / Channels /
// Memories tabs) and the bot ProfileHero. The HUMAN branch is pulse/ProfileSummaryView.
// Kailo differences, each with its design basis:
// - DD-120(5): an Agent's presence is whether its Installation is active.
// - The numbered-copy identicon and "other setup" marker describe local agent copies and device
//   key custody (DD-26, DD-75); neither exists for a Kailo Agent.
// - DD-125(6): the primary tiles are the owner's governed lifecycle; Message, Wave and Follow
//   are HUMAN-to-HUMAN surfaces (conversation participants and followed Principals are HUMAN).
import type { AgentInstallationView } from "@client-kit/contracts";
import * as React from "react";

import type { LifecycleRequest } from "../../../../../agent-activity/AgentLifecycleControls";
import {
  isInstallationActive,
  lifecycleOffer,
} from "../../../../../agent-activity/agentLifecycle";
import { useUiLocale, useUiT } from "../../../../../context";
import {
  MaskedAvatarBadgeFrame,
  STATUS_DOT_MASK_CURVE,
} from "../../../../../messages/thread/MaskedAvatarBadgeFrame";
import { observeElementBlockSize } from "../../../../../messages/observeElementBlockSize";
import { useMeasuredCssVariable } from "../../../../../messages/useMeasuredCssVariable";
import { getPresenceLabelKey, type PresenceStatus } from "../../../../../presence/lib/presence";
import { PresenceDot } from "../../../../../presence/ui/PresenceBadge";
import { ProfileHeroDescription } from "../../../../../pulse/ProfileSummaryView";
import { ProfileTabContentTransition } from "../../../../../pulse/ProfileTabContentTransition";
import { ProfilePrimaryActions } from "../../../../../pulse/UserProfilePrimaryActions";
import { AvatarHostProvider } from "../../../../avatar-host";
import { cn } from "../../../shared/lib/cn";
import type { ProfileActivityAgent } from "../lib/profileActivityAgent";
import type { ProfileActiveTurn } from "../lib/profileActivityFeedScope";
import { ProfileAvatar } from "./ProfileAvatar";
import { AGENT_DETAILS_FIELD_KEYS } from "./UserProfilePanelAgentDetails";
import type { ProfileField } from "./UserProfilePanelFields";
import {
  ChannelsFocusedView,
  MemoryFocusedView,
} from "./UserProfilePanelFocusedViews";
import {
  ProfileInfoTabContent,
  ProfileRuntimeTabContent,
  ProfileTabBar,
} from "./UserProfilePanelTabs";
import type {
  ProfileChannelLink,
  ProfilePanelTab,
} from "./UserProfilePanelUtils";

export { AgentInstructionsFocusedView } from "./UserProfilePanelAgentDetails";

export type AgentProfileSummaryViewProps = {
  activeTurns: readonly ProfileActiveTurn[];
  activityAgent: ProfileActivityAgent | null;
  agentInfoFields: ProfileField[];
  agentSettingsFields: ProfileField[];
  canDeleteAgent: boolean;
  canViewActivity: boolean;
  channelIdToName: Record<string, string>;
  channels: ProfileChannelLink[];
  diagnosticsFields: ProfileField[];
  displayName: string;
  installation: AgentInstallationView;
  instances: AgentInstallationView[];
  lifecycle: LifecycleRequest;
  mediaUrl: (url: string) => string;
  onOpenActivity: (channelId?: string | null) => void;
  onOpenChannel?: (channelId: string) => void;
  onOpenInstance?: (pubkey: string) => void;
  onOpenInstructions: () => void;
  onStickyChromeChange: (state: { active: boolean; height: number }) => void;
  onTabChange: (tab: ProfilePanelTab, options?: { replace?: boolean }) => void;
  profile: { avatarUrl?: string | null; about?: string | null; nip05Handle?: string | null } | undefined;
  pubkey: string;
  showInstructionBlock: boolean;
  tab: ProfilePanelTab;
  viewerIsOwner: boolean;
};

const PROFILE_HERO_SPACING = {
  "0": 0,
  "6": 24,
} as const;
const PROFILE_ACTIONS_SCROLL_DISTANCE_PX = 96;

const PROFILE_HERO_PRESENCE_BADGE = {
  cutout: { cx: 68, cy: 68, r: 15 },
  shell: {
    bottom: PROFILE_HERO_SPACING["0"],
    height: PROFILE_HERO_SPACING["6"],
    right: PROFILE_HERO_SPACING["0"],
    width: PROFILE_HERO_SPACING["6"],
  },
} as const;

export function AgentProfileSummaryView({
  activeTurns,
  activityAgent,
  agentInfoFields,
  agentSettingsFields,
  canDeleteAgent,
  canViewActivity,
  channelIdToName,
  channels,
  diagnosticsFields,
  displayName,
  installation,
  instances,
  lifecycle,
  mediaUrl,
  onOpenActivity,
  onOpenChannel,
  onOpenInstance,
  onOpenInstructions,
  onStickyChromeChange,
  onTabChange,
  profile,
  pubkey,
  showInstructionBlock,
  tab,
  viewerIsOwner,
}: AgentProfileSummaryViewProps) {
  const t = useUiT();
  const stickyLayoutRef = React.useRef<HTMLDivElement>(null);
  const [primaryActionsConcealed, setPrimaryActionsConcealed] =
    React.useState(false);
  const [primaryActionsElement, setPrimaryActionsElement] =
    React.useState<HTMLDivElement | null>(null);
  const [stickyTabsElement, setStickyTabsElement] =
    React.useState<HTMLDivElement | null>(null);
  const stickyHeroRef = useMeasuredCssVariable({
    cssVariable: "--buzz-profile-sticky-hero-height",
    enabled: true,
    resetKey: displayName,
    resetValue: "0px",
    targetRef: stickyLayoutRef,
  });

  const active = isInstallationActive(installation);
  const presenceStatus: PresenceStatus = active ? "online" : "offline";
  const offer = lifecycleOffer(installation);
  const lifecycleBusy =
    lifecycle.controller.busy || lifecycle.controller.pending.length > 0;

  const showMemoriesTab = viewerIsOwner;
  const showChannelsTab = true;
  const runtimeConfigurationFields = agentSettingsFields.filter((field) =>
    AGENT_DETAILS_FIELD_KEYS.has(field.key),
  );
  const runtimeSettingsFields = agentSettingsFields.filter(
    (field) => !AGENT_DETAILS_FIELD_KEYS.has(field.key),
  );
  const runtimeFields = [
    ...runtimeConfigurationFields,
    ...runtimeSettingsFields,
  ];
  const showRuntimeTab =
    viewerIsOwner &&
    (runtimeFields.length > 0 ||
      instances.length > 0 ||
      diagnosticsFields.length > 0);
  const showActivityIngress = canViewActivity;
  const showInfoTab =
    agentInfoFields.length > 0 ||
    runtimeFields.length > 0 ||
    showActivityIngress ||
    showInstructionBlock ||
    canDeleteAgent ||
    !showRuntimeTab;

  const tabs = React.useMemo(() => {
    const items: Array<{ id: ProfilePanelTab; label: string }> = [];
    if (showInfoTab) {
      items.push({ id: "info", label: t("platform.profile.panelInfo") });
    }
    if (showRuntimeTab) {
      items.push({ id: "runtime", label: t("platform.profile.section.runtime") });
    }
    if (showChannelsTab) {
      items.push({ id: "channels", label: t("platform.profile.section.channels") });
    }
    if (showMemoriesTab) {
      items.push({ id: "memories", label: t("platform.profile.section.memories") });
    }
    return items;
  }, [showChannelsTab, showInfoTab, showMemoriesTab, showRuntimeTab, t]);

  const showTabSection = tabs.length > 0;
  const showTabBar = !(tabs.length === 1 && tabs[0]?.id === "info");
  const activeTab = tabs.some((item) => item.id === tab)
    ? tab
    : (tabs[0]?.id ?? "info");
  const tabIds = React.useMemo(() => tabs.map((item) => item.id), [tabs]);

  React.useLayoutEffect(() => {
    const layout = stickyLayoutRef.current;
    const scrollBody = layout?.closest<HTMLElement>(
      '[data-testid="user-profile-scroll-body"]',
    );
    const panel = scrollBody?.parentElement;
    const header = panel?.querySelector<HTMLElement>(
      '[data-testid="user-profile-panel-header"]',
    );
    const hero = layout?.querySelector<HTMLElement>(
      '[data-testid="user-profile-sticky-hero"]',
    );

    if (!showTabBar || !scrollBody || !header || !hero || !stickyTabsElement) {
      if (primaryActionsElement) {
        primaryActionsElement.style.opacity = "";
      }
      setPrimaryActionsConcealed(false);
      onStickyChromeChange({ active: false, height: 0 });
      return;
    }

    let animationFrame: number | null = null;
    const updateScrollChrome = () => {
      animationFrame = null;
      const headerRect = header.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const tabsRect = stickyTabsElement.getBoundingClientRect();

      if (primaryActionsElement) {
        const actionsProgress = Math.min(
          Math.max(
            scrollBody.scrollTop / PROFILE_ACTIONS_SCROLL_DISTANCE_PX,
            0,
          ),
          1,
        );
        primaryActionsElement.style.opacity = String(1 - actionsProgress);
        setPrimaryActionsConcealed(actionsProgress >= 1);
      }
      onStickyChromeChange({
        active: scrollBody.scrollTop > 0 && tabsRect.top <= heroRect.bottom + 1,
        height: Math.max(0, Math.ceil(tabsRect.bottom - headerRect.top)),
      });
    };
    const scheduleStickyChromeUpdate = () => {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(updateScrollChrome);
      }
    };

    const disconnectObservers = [header, hero, stickyTabsElement].map(
      (element) => observeElementBlockSize(element, scheduleStickyChromeUpdate),
    );
    scrollBody.addEventListener("scroll", scheduleStickyChromeUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleStickyChromeUpdate);
    scheduleStickyChromeUpdate();

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      for (const disconnect of disconnectObservers) {
        disconnect();
      }
      scrollBody.removeEventListener("scroll", scheduleStickyChromeUpdate);
      window.removeEventListener("resize", scheduleStickyChromeUpdate);
      if (primaryActionsElement) {
        primaryActionsElement.style.opacity = "";
      }
      setPrimaryActionsConcealed(false);
      onStickyChromeChange({ active: false, height: 0 });
    };
  }, [onStickyChromeChange, primaryActionsElement, showTabBar, stickyTabsElement]);

  const primaryActionsMotionClassName = cn(
    "will-change-[opacity]",
    primaryActionsConcealed && "pointer-events-none",
  );

  return (
    <div
      className="flex flex-col gap-6 pt-4"
      data-testid="user-profile-summary-scroll-layout"
      ref={stickyLayoutRef}
    >
      <div
        className="sticky top-0 z-40 -mx-4 px-4"
        data-testid="user-profile-sticky-hero"
        ref={stickyHeroRef}
      >
        <AgentProfileHero
          displayName={displayName}
          mediaUrl={mediaUrl}
          presenceStatus={presenceStatus}
          profile={profile}
        />
      </div>

      {viewerIsOwner ? (
        <ProfilePrimaryActions
          actionGroupRef={setPrimaryActionsElement}
          agentActionDisabled={lifecycleBusy}
          agentActionLabel={
            offer.stop
              ? t("agentLifecycle.stop")
              : offer.start
                ? t("agentLifecycle.start")
                : undefined
          }
          agentActionLive={active}
          className={primaryActionsMotionClassName}
          concealed={primaryActionsConcealed}
          onAgentPrimaryAction={
            offer.stop
              ? () => lifecycle.request("stop", [installation])
              : offer.start
                ? () => lifecycle.request("start", [installation])
                : undefined
          }
          onAgentRestart={
            offer.restart && active
              ? () => lifecycle.request("restart", [installation])
              : undefined
          }
        />
      ) : null}
      {lifecycle.feedback}

      {showTabSection ? (
        <section className="space-y-0">
          {showTabBar ? (
            <div
              className="sticky z-40 -mx-4 px-4 pb-3 pt-2 motion-reduce:transition-none"
              data-testid="user-profile-sticky-tabs"
              ref={setStickyTabsElement}
              style={{ top: "var(--buzz-profile-sticky-hero-height, 0px)" }}
            >
              <ProfileTabBar
                activeTab={activeTab}
                onTabChange={onTabChange}
                tabs={tabs}
              />
            </div>
          ) : null}
          <ProfileTabContentTransition
            activeTab={activeTab}
            className={cn(showTabBar && "pt-2")}
            tabs={tabIds}
          >
            {activeTab === "info" ? (
              <ProfileInfoTabContent
                activeTurns={activeTurns}
                activityAgent={activityAgent}
                agentInfoFields={agentInfoFields}
                canDeleteAgent={canDeleteAgent}
                channelIdToName={channelIdToName}
                installation={installation}
                lifecycle={lifecycle}
                onOpenActivity={onOpenActivity}
                onOpenInstructions={onOpenInstructions}
                pubkey={pubkey}
                showActivityIngress={showActivityIngress}
                showInstructionBlock={showInstructionBlock}
              />
            ) : null}
            {activeTab === "runtime" ? (
              <ProfileRuntimeTabContent
                configurationFields={runtimeFields}
                currentPubkey={pubkey}
                diagnosticsFields={diagnosticsFields}
                instances={instances}
                onOpenInstance={onOpenInstance}
              />
            ) : null}
            {activeTab === "channels" ? (
              <ChannelsFocusedView
                channels={channels}
                onOpenChannel={onOpenChannel}
                variant="embedded"
              />
            ) : null}
            {activeTab === "memories" ? (
              <MemoryFocusedView
                installation={installation}
                variant="embedded"
                viewerIsOwner={viewerIsOwner}
              />
            ) : null}
          </ProfileTabContentTransition>
        </section>
      ) : null}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function AgentProfileHero({
  displayName,
  mediaUrl,
  presenceStatus,
  profile,
}: {
  displayName: string;
  mediaUrl: (url: string) => string;
  presenceStatus: PresenceStatus;
  profile: AgentProfileSummaryViewProps["profile"];
}) {
  const t = useUiT();
  const locale = useUiLocale();
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <MaskedAvatarBadgeFrame
        badge={
          <span
            aria-label={t(getPresenceLabelKey(presenceStatus))}
            className="flex h-6 w-6 items-center justify-center rounded-full"
            data-testid="user-profile-presence-badge"
            role="img"
          >
            <PresenceDot className="h-4.5 w-4.5" status={presenceStatus} />
          </span>
        }
        badgeBox={PROFILE_HERO_PRESENCE_BADGE.shell}
        className="h-20 w-20"
        curve={STATUS_DOT_MASK_CURVE}
        cutout={PROFILE_HERO_PRESENCE_BADGE.cutout}
        shape="squircle"
        size={80}
      >
        <AvatarHostProvider value={{ locale, rewriteMediaUrl: mediaUrl }}>
          <ProfileAvatar
            avatarUrl={profile?.avatarUrl ?? null}
            className="h-full w-full text-xl"
            iconClassName="h-8 w-8"
            label={displayName}
            plain
            shape="squircle"
            testId="user-profile-avatar"
          />
        </AvatarHostProvider>
      </MaskedAvatarBadgeFrame>

      <div className="flex flex-col items-center gap-1">
        <h3
          className="flex max-w-full items-center justify-center gap-2 text-xl font-semibold tracking-tight"
          data-testid="user-profile-name-row"
        >
          <span className="truncate">{displayName}</span>
        </h3>

        {profile?.about?.trim() ? (
          <ProfileHeroDescription
            about={profile.about.trim()}
            key={profile.about.trim()}
          />
        ) : null}

        {profile?.nip05Handle ? (
          <p className="text-sm text-muted-foreground">{profile.nip05Handle}</p>
        ) : null}
      </div>
    </div>
  );
}
