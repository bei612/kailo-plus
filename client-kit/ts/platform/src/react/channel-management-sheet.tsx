// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelManagementSheet.tsx::ChannelManagementSheet (overlay layout)
// desktop/src/features/channels/ui/ChannelManagementSheetRows.tsx::{ChannelHero,InfoFieldRow,EditableInfoFieldRow,CopyFieldRow}
// desktop/src/features/channels/ui/ChannelMemberAvatarStack.tsx::ChannelMemberAvatarStack
// desktop/src/features/channels/ui/ChannelTypeSettings.tsx::ChannelTypeDetailRow
// desktop/src/features/channels/lib/channelLifecycle.ts, lib/ephemeralChannel.ts::formatTtlDuration
// desktop/src/shared/hooks/useScrollBoundaryLock.ts::useScrollBoundaryLock
// The original summary is shared by Web and Desktop and reads only admitted facts: the
// Workspace channel descriptor, its visibility and the BFF member roster. Channel name,
// description, type, visibility, archive, delete and leave have no governed platform action
// (channel metadata is written only by the Tenant CONTROL identity, DD-80), so their edit
// affordances and action rows are not rendered.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { useLocale, useT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { ChannelGlyph } from "./channel-glyph";
import { PanelSectionGroup } from "./pulse/PanelSectionGroup";
import {
  AuxiliaryPanelBody, AuxiliaryPanelContext, AuxiliaryPanelHeader, AuxiliaryPanelHeaderGroup, AuxiliaryPanelTitle,
} from "./messages/thread/auxiliary";
import {
  OverlayPanelBackdrop, PANEL_BASE_CLASS, PANEL_ENTER_MOTION_CLASS, PANEL_OVERLAY_CLASS,
} from "./messages/thread/OverlayPanelBackdrop";
import { ProfileAvatar } from "./profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "./profile/avatar-host";
import { MemberAvatar } from "./members";
import { useChannelMembers } from "./channel-members";

const MAX_VISIBLE_AVATARS = 3;
// The original stacks with inline zIndex index + 1; literal utilities keep the same order
// without an inline style (MAX_VISIBLE_AVATARS avatars plus the overflow chip).
const STACK_Z_CLASSES = ["z-[1]", "z-[2]", "z-[3]", "z-[4]"] as const;
const TTL_UNIT_SECONDS = { d: 86_400, h: 3_600, m: 60, s: 1 } as const;

export type ChannelManagementChannel = {
  channelId: string;
  name: string;
  description: string;
  channelType: "stream" | "forum";
  visibility?: "open" | "private";
  ttlSeconds: number | null;
};

function formatTtlDuration(ttlSeconds: number): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "";
  let remaining = Math.floor(ttlSeconds);
  const parts: string[] = [];
  for (const unit of ["d", "h", "m", "s"] as const) {
    const size = TTL_UNIT_SECONDS[unit];
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      remaining -= count * size;
    }
  }
  return parts.join("");
}

function useScrollBoundaryLock(scrollRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (maxScrollTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const atTop = scrollElement.scrollTop <= 0;
      const atBottom = scrollElement.scrollTop >= maxScrollTop - 1;
      const scrollingPastTop = event.deltaY < 0 && atTop;
      const scrollingPastBottom = event.deltaY > 0 && atBottom;
      if (scrollingPastTop || scrollingPastBottom) {
        event.preventDefault();
        event.stopPropagation();
        scrollElement.scrollTop = scrollingPastTop ? 0 : maxScrollTop;
      }
    };
    scrollElement.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel, { capture: true });
  }, [scrollRef]);
}

export function ChannelManagementSheet({ open, onOpenChange, workspaceId, channel, isDark, onOpenMembers, onCopy }: {
  open: boolean;
  /** Host theme state, as the original reads useTheme().isDark for the overlay surface. */
  isDark: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  channel: ChannelManagementChannel;
  onOpenMembers?: () => void;
  /** Host clipboard transport; the shared row owns the original feedback. */
  onCopy: (value: string) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useScrollBoundaryLock(scrollRef);
  const membersQuery = useChannelMembers(workspaceId, open);
  const members = (membersQuery.data ?? []).filter((member) => member.state === WorkspaceMembershipState.Active);
  const memberCount = members.length;
  const description = channel.description.trim();
  const lifecycle = channel.ttlSeconds !== null
    ? formatTtlDuration(channel.ttlSeconds)
      ? t("channelManagement.temporaryFor", { duration: formatTtlDuration(channel.ttlSeconds) })
      : t("channel.ttl.temporary")
    : t("channel.ttl.ongoing");

  return (
    <DialogPrimitive.Root modal onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <OverlayPanelBackdrop onClose={() => onOpenChange(false)} />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          className={cn(
            PANEL_BASE_CLASS,
            PANEL_OVERLAY_CLASS,
            PANEL_ENTER_MOTION_CLASS,
            "w-[380px] cursor-default overflow-hidden p-0 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200",
            isDark ? "bg-background/85 backdrop-blur-xl supports-backdrop-filter:bg-background/75" : "bg-background",
          )}
          data-testid="channel-management-sheet"
        >
          <AvatarHostProvider value={{ locale, rewriteMediaUrl: (url) => url }}>
            <AuxiliaryPanelContext.Provider value={{
              isFloatingOverlay: true, isOverlay: true, isSinglePanelView: false, isSplitLayout: false,
              layout: "standalone", mode: "panel", onClose: () => onOpenChange(false), transparentChrome: false, widthPx: 380,
            }}>
              <AuxiliaryPanelHeader bordered density="compact" mode="panel" transparent={false}>
                <AuxiliaryPanelHeaderGroup mode="panel">
                  <DialogPrimitive.Title asChild>
                    <AuxiliaryPanelTitle>{t("channelManagement.title")}</AuxiliaryPanelTitle>
                  </DialogPrimitive.Title>
                </AuxiliaryPanelHeaderGroup>
                <DialogPrimitive.Description className="sr-only">{t("channelManagement.settings")}</DialogPrimitive.Description>
              </AuxiliaryPanelHeader>
              <AuxiliaryPanelBody
                className="overflow-y-auto overflow-x-hidden overscroll-contain bg-background px-4 pb-8 [overflow-anchor:none]"
                mode="panel"
                panelPadding
                ref={scrollRef}
              >
                <div className="space-y-6 pt-3">
                  <div className="flex flex-col items-center gap-3 py-3 text-center" data-testid="channel-management-hero">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <ChannelGlyph channel={{ channelType: channel.channelType, visibility: channel.visibility }} className="h-8 w-8" />
                    </div>
                    <div className="flex max-w-full flex-col items-center">
                      <h3 className="max-w-full truncate text-xl font-semibold tracking-tight" data-testid="channel-management-name-row">
                        {channel.name}
                      </h3>
                      {description ? (
                        <p className="mt-1 line-clamp-6 max-w-full whitespace-pre-line text-sm leading-5 text-muted-foreground/70"
                          data-testid="channel-management-description">{description}</p>
                      ) : null}
                    </div>
                  </div>

                  {membersQuery.isError ? (
                    <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      {t("platform.loadFailed")}
                    </p>
                  ) : null}

                  <PanelSectionGroup testId="channel-management-details" title={t("channelManagement.details")}>
                    <InfoFieldRow label={t("channelManagement.channelType")} testId="channel-management-type" value={lifecycle} />
                    {channel.visibility ? (
                      <InfoFieldRow label={t("channelManagement.visibility")} testId="channel-management-visibility"
                        value={t(channel.visibility === "private" ? "channelManagement.private" : "channelManagement.public")} />
                    ) : null}
                    <InfoFieldRow
                      label={t("channelManagement.members")}
                      onClick={onOpenMembers}
                      testId="channel-management-member-count"
                      trailing={<MemberAvatarStack workspaceId={workspaceId} members={members} />}
                      value={membersQuery.isSuccess
                        ? t(memberCount === 1 ? "channelManagement.memberCountOne" : "channelManagement.memberCountOther", { count: memberCount })
                        : t("channelMembers.loading")}
                    />
                    <CopyFieldRow copiedMessage={t("channelManagement.channelIdCopied")} label={t("channelManagement.channelId")} onCopy={onCopy}
                      testId="channel-management-channel-id" value={channel.channelId} />
                  </PanelSectionGroup>
                </div>
              </AuxiliaryPanelBody>
            </AuxiliaryPanelContext.Provider>
          </AvatarHostProvider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MemberAvatarStack({ workspaceId, members }: {
  workspaceId: string;
  members: { principalId: string; displayName: string; pubkeys: string[] }[];
}) {
  const t = useT();
  const visibleMembers = members.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = members.length - visibleMembers.length;
  const stackItemCount = visibleMembers.length + (overflowCount > 0 ? 1 : 0);
  if (members.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center pl-3" data-testid="channel-management-member-avatar-stack">
      {visibleMembers.map((member, index) => {
        const pubkey = member.pubkeys[0];
        const className = "!h-8 !w-8 border-2 border-background text-2xs";
        return (
          <span className={cn(STACK_Z_CLASSES[index], index > 0 && "-ml-2")} data-testid="channel-management-member-avatar"
            key={member.principalId}>
            {pubkey ? <MemberAvatar className={className} label={member.displayName} target={{ workspaceId, principalId: member.principalId, pubkey }} />
              : <ProfileAvatar avatarUrl={null} className={className} label={member.displayName} shape="circle" />}
          </span>
        );
      })}
      {overflowCount > 0 ? (
        <span
          className={cn("-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-2xs font-semibold text-muted-foreground",
            STACK_Z_CLASSES[stackItemCount - 1])}
          data-testid="channel-management-member-avatar-overflow"
          title={t("channelManagement.moreMembers", { count: overflowCount })}
        >
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}

function InfoFieldRow({ label, onClick, trailing, value, testId }: {
  label: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  value: string;
  testId?: string;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground/70">{value}</span>
      </span>
      {trailing}
    </>
  );
  if (onClick) {
    return (
      <button
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={testId}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }
  return <div className="flex min-h-16 w-full items-center gap-3 px-4 py-3" data-testid={testId}>{content}</div>;
}

function truncateIdentifier(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function CopyFieldRow({ copiedMessage, label, value, testId, onCopy }: {
  copiedMessage: string;
  label: string;
  value: string;
  testId?: string;
  onCopy: (value: string) => Promise<void>;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const resetTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  async function handleCopy() {
    try {
      await onCopy(value);
    } catch {
      toast.error(t("platform.profile.copyFailed"));
      return;
    }
    setCopied(true);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, 1_500);
    toast.success(copiedMessage);
  }

  return (
    <button
      aria-label={copied ? t("channelManagement.copied", { label }) : t("channelManagement.copy", { label })}
      className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      data-testid={testId}
      onClick={() => { void handleCopy(); }}
      title={t("channelManagement.copy", { label })}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block truncate font-mono text-sm text-muted-foreground/70" title={value}>{truncateIdentifier(value)}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-4 w-4 shrink-0 transition-opacity duration-150 ease-out motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100",
          copied ? "opacity-100" : "opacity-0",
        )}
        data-copied={copied}
        data-testid={testId ? `${testId}-copy-status` : undefined}
      >
        <Copy className={cn(
          "absolute inset-0 h-4 w-4 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          copied ? "scale-95 opacity-0" : "scale-100 opacity-100",
        )} />
        <Check className={cn(
          "absolute inset-0 h-4 w-4 text-primary transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          copied ? "scale-100 opacity-100" : "scale-95 opacity-0",
        )} />
      </span>
    </button>
  );
}
