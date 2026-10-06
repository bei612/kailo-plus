// Reused from Buzz 779af8886caae1317b4de962082429867ab61503; host transport is injected.
import { createPortal } from "react-dom";
import { useAvatarText } from "../../../../avatar-host";

import type {
  AvatarEditorPresentation,
  AvatarMode,
} from "./ProfileAvatarEditor.types";
import { cn } from "../../../shared/lib/cn";
import { SegmentedControl } from "../../../../../segmented-control";
import { Tabs, TabsList, TabsTrigger } from "../../../shared/ui/tabs";

const MODE_TAB_ORDER: AvatarMode[] = ["image", "emoji", "animated"];

type ProfileAvatarModeTabsProps = {
  disabled: boolean;
  mode: AvatarMode;
  onModeChange: (mode: AvatarMode) => void;
  presentation: AvatarEditorPresentation;
  portalContainer?: HTMLElement | null;
};

export function ProfileAvatarModeTabs({
  disabled,
  mode,
  onModeChange,
  presentation,
  portalContainer,
}: ProfileAvatarModeTabsProps) {
  const t = useAvatarText();
  const labels = { animated: t("platform.profile.avatar.animated"), emoji: t("platform.profile.avatar.emoji"), image: t("platform.profile.avatar.image") };
  const isOnboardingModal = presentation === "onboarding-modal";
  const isOnboardingInline = presentation === "onboarding-inline";
  const tabs = isOnboardingInline ? (
    <SegmentedControl
      disabled={disabled}
      indicatorTestId="onboarding-avatar-mode-indicator"
      legend={t("platform.profile.avatar.avatarType")}
      onValueChange={onModeChange}
      optionTestIdPrefix="onboarding-avatar-mode"
      options={MODE_TAB_ORDER.map((value) => ({ label: labels[value], value }))}
      testId="onboarding-avatar-mode-control"
      value={mode}
    />
  ) : (
    <Tabs
      className={isOnboardingModal ? "flex w-full justify-center" : "w-full"}
      onValueChange={(nextMode) => {
        if (!disabled) onModeChange(nextMode as AvatarMode);
      }}
      value={mode}
    >
      <TabsList
        aria-label={t("platform.profile.avatar.avatarType")}
        className={cn(
          isOnboardingModal
            ? "relative isolate grid h-10 w-full max-w-[320px] grid-cols-3 overflow-hidden rounded-full bg-[color:rgb(var(--buzz-onboarding-avatar-control-fg)_/_0.12)] p-1 text-muted-foreground"
            : "relative isolate grid h-14 w-full grid-cols-3 overflow-hidden rounded-full bg-muted p-1 text-muted-foreground",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute z-0 rounded-full transition-transform motion-reduce:transition-none",
            "bottom-1 left-1 top-1 shadow duration-[250ms] ease-out",
            isOnboardingModal
              ? "bg-[rgb(var(--buzz-onboarding-avatar-action-bg))]"
              : "bg-background",
          )}
          style={{
            transform: `translateX(${MODE_TAB_ORDER.indexOf(mode) * 100}%)`,
            width: "calc((100% - 8px) / 3)",
          }}
        />
        {MODE_TAB_ORDER.map((tabMode) => (
          <TabsTrigger
            className={cn(
              isOnboardingModal
                ? "relative z-10 h-full rounded-full bg-transparent px-4 text-sm font-normal shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-[rgb(var(--buzz-onboarding-avatar-action-fg))] data-[state=active]:shadow-none"
                : "relative z-10 h-full rounded-full bg-transparent text-sm font-medium shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
            )}
            disabled={disabled}
            key={tabMode}
            value={tabMode}
          >
            {labels[tabMode]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return portalContainer === undefined
    ? tabs
    : portalContainer
      ? createPortal(tabs, portalContainer)
      : null;
}
