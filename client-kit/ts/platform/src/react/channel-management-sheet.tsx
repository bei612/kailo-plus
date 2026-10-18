// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelManagementSheet.tsx::ChannelManagementSheet (overlay layout, edit dialog, action rows)
// desktop/src/features/channels/ui/ChannelManagementSheetRows.tsx::{ChannelHero,InfoFieldRow,EditableInfoFieldRow,ActionFieldRow,CopyFieldRow}
// desktop/src/features/channels/ui/ChannelMemberAvatarStack.tsx::ChannelMemberAvatarStack
// desktop/src/features/channels/ui/ChannelTypeSettings.tsx::{ChannelTypeDetailRow,ChannelTypeSettings}
// desktop/src/features/channels/ui/ChannelPermissionsSettings.tsx::ChannelPermissionsSettings
// desktop/src/features/channels/lib/channelLifecycle.ts, lib/ephemeralChannel.ts::formatTtlDuration
// desktop/src/shared/hooks/useScrollBoundaryLock.ts::useScrollBoundaryLock
// The original summary is shared by Web and Desktop and reads only admitted facts: the
// Workspace channel descriptor, its visibility and the BFF member roster. DD-119 restores the
// original edit and moderation entries over governed paths, each shown only when the BFF
// answers its action hint (Core re-admits every submission): updateActionKey → the edit dialog
// (name, description, TTL as the "Channel type" row, visibility) as one workspace.update with
// only the changed fields, or reopen alone when canReopen; leaveActionKey → Leave
// (workspace.leave); lifecycleActionKey → Archive/Unarchive (workspace.suspend/restore, DD-46);
// the member topic is the host's own-identity publication. Delete has no governed path (DD-46),
// and stream/forum type is fixed at creation, so neither is rendered.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Archive, ArchiveRestore, Check, ChevronRight, Copy, DoorClosed, MessageSquare, Pencil, Plus,
  Workflow as WorkflowIcon, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AutomationState, LeaveActionKey, UpdateActionKey, WorkspaceLifecycleActionKey, WorkspaceMembershipState, WorkspaceVisibility,
  type AutomationView, type WorkspaceUpdate,
} from "@client-kit/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { validAutomation, validAutomationDetail } from "./agents";
import { Button } from "./profile/buzz/shared/ui/button";
import { Textarea } from "./profile/buzz/shared/ui/textarea";
import { Input } from "./composer/shared/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { useBffClient, useLocale, useT } from "./context";
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
import { rosterMemberTarget, rosterQueryKey, useRosterMembers, type MemberRoster } from "./channel-members";
import { ChannelTypeSettings, DEFAULT_EPHEMERAL_TTL_SECONDS, formatTtlDuration } from "./channel-type-settings";
import { ChannelPermissionsSettings } from "./channel-permissions-settings";
import { CHANNEL_FORM_FIELD_CONTROL_CLASS, CHANNEL_FORM_FIELD_SHELL_CLASS } from "./roles";
import {
  CHANNEL_CONVERGENCE_REREAD_MS, channelActionOutcomeText, channelManagementQueryKey, useChannelManagementHints,
  useGovernedChannelAction, useTopicPublication, type ChannelActionOutcome, type ChannelManagementHost,
} from "./channel-management-actions";

export type { ChannelManagementHost } from "./channel-management-actions";

const MAX_VISIBLE_AVATARS = 3;
// The original stacks with inline zIndex index + 1; literal utilities keep the same order
// without an inline style (MAX_VISIBLE_AVATARS avatars plus the overflow chip).
const STACK_Z_CLASSES = ["z-[1]", "z-[2]", "z-[3]", "z-[4]"] as const;
/** Bounded readback after a recorded change: the governed workflow converges asynchronously. */

export type ChannelManagementChannel = {
  channelId: string;
  name: string;
  description: string;
  channelType: "stream" | "forum" | "dm";
  visibility?: "open" | "private";
  ttlSeconds: number | null;
  /** Original 39000 topic tag; absent means no topic. */
  topic?: string;
  /** Original 39000 archived flag. */
  archived?: boolean;
};

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

/** Host routes into the shared Workflows page; the sheet only lists admitted definitions. */
export type ChannelWorkflowNavigation = {
  onOpenWorkflow: (resourceId: string) => void;
  onCreateWorkflow: () => void;
};

function ActionOutcome({ outcome, testId }: { outcome: ChannelActionOutcome | null; testId: string }) {
  const t = useT();
  if (!outcome) return null;
  const settled = outcome.kind === "recorded" || outcome.kind === "waiting";
  return <p className={cn("text-sm", settled ? "text-muted-foreground" : "text-destructive")} data-testid={testId}
    role={settled ? "status" : "alert"}>{channelActionOutcomeText(t, outcome)}</p>;
}

export function ChannelManagementSheet({ open, onOpenChange, roster, channel, isDark, onOpenMembers, onCopy, workflows, management }: {
  open: boolean;
  /** Host theme state, as the original reads useTheme().isDark for the overlay surface. */
  isDark: boolean;
  onOpenChange: (open: boolean) => void;
  roster: MemberRoster;
  channel: ChannelManagementChannel;
  onOpenMembers?: () => void;
  /** Host clipboard transport; the shared row owns the original feedback. */
  onCopy: (value: string) => Promise<void>;
  /** Original ChannelWorkflowsSection: Workspace automations are channel-scoped workflows. */
  workflows?: ChannelWorkflowNavigation;
  /** DD-119 governed management of a Workspace channel; omitted keeps the read-only summary. */
  management?: ChannelManagementHost;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useScrollBoundaryLock(scrollRef);
  const membersQuery = useRosterMembers(roster, open);
  const workspaceId = roster.kind === "workspace" ? roster.workspaceId : undefined;
  const dm = channel.channelType === "dm";
  const [activeView, setActiveView] = React.useState<"summary" | "workflows">("summary");
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [isTopicDialogOpen, setIsTopicDialogOpen] = React.useState(false);
  const [confirmLifecycle, setConfirmLifecycle] = React.useState(false);
  React.useEffect(() => {
    if (open) return;
    setActiveView("summary");
    setIsEditDialogOpen(false);
    setIsTopicDialogOpen(false);
    setConfirmLifecycle(false);
  }, [open]);
  const workflowsQuery = useChannelWorkflows(workflows ? workspaceId : undefined, open);
  const members = (membersQuery.data ?? []).filter((member) => member.state === WorkspaceMembershipState.Active);
  const memberCount = members.length;
  const description = channel.description.trim();
  const lifecycleLabel = channel.ttlSeconds !== null
    ? formatTtlDuration(channel.ttlSeconds)
      ? t("channelManagement.temporaryFor", { duration: formatTtlDuration(channel.ttlSeconds) })
      : t("channel.ttl.temporary")
    : t("channel.ttl.ongoing");

  // Entries follow the BFF action hints for this Workspace; Core re-admits every submission.
  const managed = management !== undefined && workspaceId !== undefined && !dm;
  const hintsQuery = useChannelManagementHints(workspaceId, channel.channelId, open && managed);
  const hints = managed && hintsQuery.isSuccess ? hintsQuery.data : undefined;
  const archived = channel.archived === true;
  const canEditChannel = hints?.updateActionKey !== undefined && !hints.canReopen && !archived;
  const canReopen = hints?.canReopen === true;
  const canLeave = hints?.leaveActionKey !== undefined;
  const canEditTopic = managed && management?.publishTopic !== undefined && !archived;

  // A recorded change converges through its workflow: re-read the host view and the hints on a
  // bounded backoff (reads only, never a resend).
  const managementRef = React.useRef(management);
  managementRef.current = management;
  const rereadTimers = React.useRef<number[]>([]);
  React.useEffect(() => () => { for (const timer of rereadTimers.current) window.clearTimeout(timer); }, []);
  const readBack = React.useCallback(() => {
    const reread = () => {
      managementRef.current?.refresh();
      if (workspaceId !== undefined) void queryClient.invalidateQueries({ queryKey: channelManagementQueryKey(workspaceId) });
    };
    for (const timer of rereadTimers.current) window.clearTimeout(timer);
    reread();
    let at = 0;
    rereadTimers.current = CHANNEL_CONVERGENCE_REREAD_MS.map((delay) => { at += delay; return window.setTimeout(reread, at); });
  }, [queryClient, workspaceId]);
  const update = useGovernedChannelAction(readBack);
  const reopen = useGovernedChannelAction(readBack);
  const lifecycle = useGovernedChannelAction(readBack);
  const leave = useGovernedChannelAction(() => {
    readBack();
    void queryClient.invalidateQueries({ queryKey: rosterQueryKey(roster) });
  });
  const topic = useTopicPublication(management, workspaceId, readBack);
  const lifecycleAction = lifecycle.intent?.actionKey ?? (canReopen ? undefined : hints?.lifecycleActionKey);
  const suspending = lifecycleAction === WorkspaceLifecycleActionKey.WorkspaceSuspend;

  // Original edit drafts: synced from the current channel when the dialog opens, never while a
  // frozen (unknown) update is retained.
  const [nameDraft, setNameDraft] = React.useState("");
  const [descriptionDraft, setDescriptionDraft] = React.useState("");
  const [isPrivateDraft, setIsPrivateDraft] = React.useState(false);
  const [isEphemeralDraft, setIsEphemeralDraft] = React.useState(false);
  const [ttlSecondsDraft, setTtlSecondsDraft] = React.useState(DEFAULT_EPHEMERAL_TTL_SECONDS);
  const [hasUserEditedChannelDraft, setHasUserEditedChannelDraft] = React.useState(false);
  const currentPrivate = channel.visibility === "private";
  const currentTtlSeconds = channel.ttlSeconds;
  function resetChannelDrafts() {
    setNameDraft(channel.name);
    setDescriptionDraft(channel.description);
    setIsPrivateDraft(currentPrivate);
    setIsEphemeralDraft(currentTtlSeconds !== null);
    setTtlSecondsDraft(currentTtlSeconds ?? DEFAULT_EPHEMERAL_TTL_SECONDS);
    setHasUserEditedChannelDraft(false);
  }
  function openEditDialog() {
    if (!update.intent) {
      resetChannelDrafts();
      update.dismiss();
    }
    setIsEditDialogOpen(true);
  }
  function handleEditDialogOpenChange(next: boolean) {
    if (next) {
      openEditDialog();
      return;
    }
    if (update.busy) return;
    if (!update.intent) {
      resetChannelDrafts();
      update.dismiss();
    }
    setIsEditDialogOpen(false);
  }
  const nextTtlSeconds: number | null = isEphemeralDraft ? ttlSecondsDraft : null;
  const nameDirty = nameDraft.trim() !== channel.name.trim();
  const descriptionDirty = descriptionDraft.trim() !== channel.description.trim();
  const ttlDirty = nextTtlSeconds !== currentTtlSeconds;
  const visibilityDirty = isPrivateDraft !== currentPrivate;
  const frozenEdit = update.intent !== null;
  const isSavingChannelEdits = update.busy;
  const canSaveChannelEdits = frozenEdit ? !isSavingChannelEdits
    : nameDraft.trim().length > 0 && hasUserEditedChannelDraft && (nameDirty || descriptionDirty || ttlDirty || visibilityDirty)
      && !isSavingChannelEdits;

  async function handleSaveChannelEdits() {
    if (workspaceId === undefined) return;
    // One workspace.update carrying only the changed fields (original update_channel).
    const workspaceUpdate: WorkspaceUpdate = {
      ...(nameDirty ? { name: nameDraft.trim() } : {}),
      ...(descriptionDirty ? { description: descriptionDraft.trim() } : {}),
      ...(ttlDirty ? nextTtlSeconds === null ? { clearTtl: true } : { ttlSeconds: nextTtlSeconds } : {}),
      ...(visibilityDirty ? { visibility: isPrivateDraft ? WorkspaceVisibility.Private : WorkspaceVisibility.Open } : {}),
    };
    const result = await update.submit({ actionKey: UpdateActionKey.WorkspaceUpdate, workspaceId, workspaceUpdate });
    if (result?.kind === "recorded" || result?.kind === "waiting") {
      setHasUserEditedChannelDraft(false);
      setIsEditDialogOpen(false);
    }
  }

  const [topicDraft, setTopicDraft] = React.useState("");
  const currentTopic = channel.topic?.trim() ?? "";
  function openTopicDialog() {
    if (!topic.intent) {
      setTopicDraft(channel.topic ?? "");
      topic.reset();
    }
    setIsTopicDialogOpen(true);
  }
  function handleTopicDialogOpenChange(next: boolean) {
    if (next) {
      openTopicDialog();
      return;
    }
    if (topic.busy) return;
    if (!topic.intent) topic.reset();
    setIsTopicDialogOpen(false);
  }
  const canSaveTopic = topic.intent ? !topic.busy : !topic.busy && topicDraft.trim() !== currentTopic;
  async function handleSaveTopic() {
    if (await topic.publish(topic.intent ? undefined : topicDraft.trim())) setIsTopicDialogOpen(false);
  }

  async function handleLeave() {
    if (workspaceId === undefined) return;
    const result = await leave.submit({ actionKey: LeaveActionKey.WorkspaceLeave, workspaceId });
    if (result?.kind === "recorded" || result?.kind === "waiting") {
      onOpenChange(false);
      managementRef.current?.onLeft?.();
    }
  }
  function handleReopen() {
    if (workspaceId === undefined) return;
    void reopen.submit({ actionKey: UpdateActionKey.WorkspaceUpdate, workspaceId, workspaceUpdate: { reopen: true } });
  }
  async function handleLifecycle() {
    if (workspaceId === undefined || lifecycleAction === undefined) return;
    const result = await lifecycle.submit({ actionKey: lifecycleAction, workspaceId });
    if (result && result.kind !== "unknown") setConfirmLifecycle(false);
  }
  const showLeave = canLeave || leave.intent !== null;
  const showReopen = canReopen || reopen.intent !== null;
  const showLifecycle = !showReopen && lifecycleAction !== undefined;

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
                <AuxiliaryPanelHeaderGroup mode="panel" backButtonAriaLabel={t("channelManagement.back")} backButtonTestId="channel-management-back"
                  onBack={activeView !== "summary" ? () => setActiveView("summary") : undefined}>
                  <DialogPrimitive.Title asChild>
                    <AuxiliaryPanelTitle>{t(activeView === "workflows" ? "channelManagement.workflows" : "channelManagement.title")}</AuxiliaryPanelTitle>
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
                {activeView === "workflows" && workflows ? (
                  <ChannelWorkflowsSection query={workflowsQuery} workflows={workflows} />
                ) : <div className="space-y-6 pt-3">
                  <ChannelHero channel={channel} description={description} dm={dm} onEdit={canEditChannel ? openEditDialog : undefined} />

                  {membersQuery.isError || (managed && hintsQuery.isError) ? (
                    <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      {t("platform.loadFailed")}
                    </p>
                  ) : null}

                  <PanelSectionGroup testId="channel-management-details" title={t("channelManagement.details")}>
                    {dm ? null : <EditableInfoFieldRow editTestId="channel-management-edit-channel-type" label={t("channelManagement.channelType")}
                      onEdit={canEditChannel ? openEditDialog : undefined} testId="channel-management-type" value={lifecycleLabel} />}
                    {!dm && channel.visibility ? (
                      <EditableInfoFieldRow editTestId="channel-management-edit-visibility" label={t("channelManagement.visibility")}
                        onEdit={canEditChannel ? openEditDialog : undefined} testId="channel-management-visibility"
                        value={t(channel.visibility === "private" ? "channelManagement.private" : "channelManagement.public")} />
                    ) : null}
                    {managed ? (
                      <EditableInfoFieldRow editTestId="channel-management-edit-topic" label={t("channelManagement.topic")} multiline
                        onEdit={canEditTopic ? openTopicDialog : undefined} testId="channel-management-topic"
                        value={currentTopic || t(canEditTopic ? "channelManagement.addTopic" : "channelManagement.noTopic")} />
                    ) : null}
                    <InfoFieldRow
                      label={t("channelManagement.members")}
                      onClick={onOpenMembers}
                      testId="channel-management-member-count"
                      trailing={<MemberAvatarStack roster={roster} members={members} />}
                      value={membersQuery.isSuccess
                        ? t(memberCount === 1 ? "channelManagement.memberCountOne" : "channelManagement.memberCountOther", { count: memberCount })
                        : t("channelMembers.loading")}
                    />
                    <CopyFieldRow copiedMessage={t("channelManagement.channelIdCopied")} label={t("channelManagement.channelId")} onCopy={onCopy}
                      testId="channel-management-channel-id" value={channel.channelId} />
                  </PanelSectionGroup>
                  {workflows && workspaceId ? (
                    <IngressRow
                      description={workflowsQuery.isSuccess
                        ? t(workflowsQuery.data.rows.length === 1 ? "channelManagement.workflowCountOne" : "channelManagement.workflowCountOther", { count: workflowsQuery.data.rows.length })
                        : undefined}
                      label={t("channelManagement.workflows")}
                      onClick={() => setActiveView("workflows")}
                      testId="channel-workflows-ingress"
                      trailing={workflowsQuery.isPending ? t("channelManagement.loading") : undefined}
                    />
                  ) : null}

                  {showLeave || showReopen || showLifecycle ? (
                    <PanelSectionGroup testId="channel-management-actions">
                      {showLeave ? (
                        <ActionFieldRow disabled={leave.busy} icon={DoorClosed}
                          label={t(leave.busy ? "channelManagement.leaving" : leave.unknown ? "workspace.lifecycle.retry" : "channelManagement.leave")}
                          onClick={() => { void handleLeave(); }} testId="channel-management-leave" />
                      ) : null}
                      {showReopen ? (
                        <ActionFieldRow disabled={reopen.busy} icon={ArchiveRestore}
                          label={t(reopen.busy ? "channelManagement.restoring" : reopen.unknown ? "workspace.lifecycle.retry" : "channelManagement.unarchive")}
                          onClick={handleReopen} testId="channel-management-unarchive" />
                      ) : showLifecycle ? (
                        <ActionFieldRow disabled={lifecycle.busy} icon={suspending ? Archive : ArchiveRestore}
                          label={t(lifecycle.busy ? suspending ? "channelManagement.archiving" : "channelManagement.restoring"
                            : lifecycle.unknown ? "workspace.lifecycle.retry" : suspending ? "channelManagement.archive" : "channelManagement.unarchive")}
                          onClick={() => {
                            if (lifecycle.unknown) void handleLifecycle();
                            else { lifecycle.dismiss(); setConfirmLifecycle(true); }
                          }}
                          testId={suspending ? "channel-management-archive" : "channel-management-unarchive"} />
                      ) : null}
                    </PanelSectionGroup>
                  ) : null}

                  {confirmLifecycle && showLifecycle ? (
                    <div className="space-y-3 rounded-xl border border-border/70 p-4" data-testid="channel-management-lifecycle-confirm" role="group">
                      <p className="text-sm">{t(suspending ? "channelManagement.confirmArchive" : "channelManagement.confirmUnarchive", { name: channel.name })}</p>
                      <div className="flex justify-end gap-2">
                        <Button disabled={lifecycle.busy} onClick={() => setConfirmLifecycle(false)} size="sm" type="button" variant="outline">
                          {t("platform.cancel")}
                        </Button>
                        <Button data-testid="channel-management-lifecycle-submit" disabled={lifecycle.busy} onClick={() => { void handleLifecycle(); }}
                          size="sm" type="button">
                          {t(lifecycle.unknown ? "workspace.lifecycle.retry" : "platform.confirm")}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {update.outcome?.kind === "recorded" || update.outcome?.kind === "waiting"
                    ? <ActionOutcome outcome={update.outcome} testId="channel-management-update-outcome" /> : null}
                  <ActionOutcome outcome={reopen.outcome} testId="channel-management-reopen-outcome" />
                  <ActionOutcome outcome={leave.outcome} testId="channel-management-leave-outcome" />
                  <ActionOutcome outcome={lifecycle.outcome} testId="channel-management-lifecycle-outcome" />
                </div>}
              </AuxiliaryPanelBody>
            </AuxiliaryPanelContext.Provider>
          </AvatarHostProvider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {canEditChannel || frozenEdit ? (
        <Dialog onOpenChange={handleEditDialogOpenChange} open={isEditDialogOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-lg overflow-hidden p-0" data-testid="channel-management-edit-dialog">
            <div className="flex max-h-[85vh] flex-col">
              <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 pr-14">
                <DialogTitle>{t(isPrivateDraft ? "channelManagement.editPrivate" : "channelManagement.editPublic")}</DialogTitle>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="channel-name">{t("channelManagement.name")}</label>
                    <div className={cn("flex min-h-11 items-center px-3", CHANNEL_FORM_FIELD_SHELL_CLASS)}>
                      <Input
                        className={cn("h-8 px-0 py-0 leading-6", CHANNEL_FORM_FIELD_CONTROL_CLASS)}
                        data-testid="channel-management-name"
                        disabled={isSavingChannelEdits || frozenEdit}
                        id="channel-name"
                        onChange={(event) => {
                          setNameDraft(event.target.value);
                          setHasUserEditedChannelDraft(true);
                        }}
                        value={nameDraft}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="channel-description">{t("channelManagement.description")}</label>
                    <div className={CHANNEL_FORM_FIELD_SHELL_CLASS}>
                      <Textarea
                        className={cn("min-h-20 resize-none px-3 py-3 leading-5", CHANNEL_FORM_FIELD_CONTROL_CLASS)}
                        data-testid="channel-management-description"
                        disabled={isSavingChannelEdits || frozenEdit}
                        id="channel-description"
                        onChange={(event) => {
                          setDescriptionDraft(event.target.value);
                          setHasUserEditedChannelDraft(true);
                        }}
                        rows={2}
                        value={descriptionDraft}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-5" data-testid="channel-management-lifecycle">
                  <ChannelTypeSettings
                    disabled={isSavingChannelEdits || frozenEdit}
                    label={t("channelManagement.channelType")}
                    onTemporaryChange={(temporary) => {
                      setIsEphemeralDraft(temporary);
                      setHasUserEditedChannelDraft(true);
                    }}
                    onTtlSecondsChange={(ttlSeconds) => {
                      setTtlSecondsDraft(ttlSeconds);
                      setHasUserEditedChannelDraft(true);
                    }}
                    temporary={isEphemeralDraft}
                    testIdPrefix="channel-management"
                    ttlSeconds={ttlSecondsDraft}
                    variant="dropdown"
                  />
                  <ChannelPermissionsSettings
                    disabled={isSavingChannelEdits || frozenEdit}
                    onVisibilityChange={(visibility) => {
                      setIsPrivateDraft(visibility === WorkspaceVisibility.Private);
                      setHasUserEditedChannelDraft(true);
                    }}
                    testIdPrefix="channel-management"
                    visibility={isPrivateDraft ? WorkspaceVisibility.Private : WorkspaceVisibility.Open}
                  />
                </div>

                {update.outcome && update.outcome.kind !== "recorded" && update.outcome.kind !== "waiting" ? (
                  <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    data-testid="channel-management-edit-error" role="alert">
                    {channelActionOutcomeText(t, update.outcome)}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-6 py-4">
                <Button disabled={isSavingChannelEdits} onClick={() => handleEditDialogOpenChange(false)} size="sm" type="button" variant="outline">
                  {t("platform.cancel")}
                </Button>
                <Button
                  data-testid="channel-management-save-changes"
                  disabled={!canSaveChannelEdits}
                  onClick={() => void handleSaveChannelEdits()}
                  size="sm"
                  type="button"
                >
                  {t(isSavingChannelEdits ? "channelManagement.saving" : frozenEdit ? "workspace.lifecycle.retry" : "channelManagement.saveChanges")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {canEditTopic || topic.intent ? (
        <Dialog onOpenChange={handleTopicDialogOpenChange} open={isTopicDialogOpen}>
          <DialogContent aria-describedby={undefined} className="max-w-lg overflow-hidden p-0" data-testid="channel-management-topic-dialog">
            <div className="flex max-h-[85vh] flex-col">
              <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 pr-14">
                <DialogTitle>{t("channelManagement.editTopic")}</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="channel-topic">{t("channelManagement.topic")}</label>
                  <div className={CHANNEL_FORM_FIELD_SHELL_CLASS}>
                    <Textarea
                      className={cn("min-h-20 resize-none px-3 py-3 leading-5", CHANNEL_FORM_FIELD_CONTROL_CLASS)}
                      data-testid="channel-management-topic-input"
                      disabled={topic.busy || topic.intent !== null}
                      id="channel-topic"
                      onChange={(event) => setTopicDraft(event.target.value)}
                      rows={2}
                      value={topicDraft}
                    />
                  </div>
                </div>
                {topic.failure ? (
                  <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    data-testid="channel-management-topic-error" role="alert">
                    {topic.failure.kind === "unknown" ? t("channelManagement.topicUnknown")
                      : t("workspace.lifecycle.rejected", { reason: topic.failure.reason })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-6 py-4">
                <Button disabled={topic.busy} onClick={() => handleTopicDialogOpenChange(false)} size="sm" type="button" variant="outline">
                  {t("platform.cancel")}
                </Button>
                <Button data-testid="channel-management-topic-save" disabled={!canSaveTopic} onClick={() => void handleSaveTopic()} size="sm" type="button">
                  {t(topic.busy ? "channelManagement.saving" : topic.intent ? "workspace.lifecycle.retry" : "channelManagement.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </DialogPrimitive.Root>
  );
}

function ChannelHero({ channel, description, dm, onEdit }: {
  channel: ChannelManagementChannel;
  description: string;
  dm: boolean;
  onEdit?: () => void;
}) {
  const t = useT();
  const shownDescription = description || (onEdit ? t("channelManagement.addDescription") : null);
  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center" data-testid="channel-management-hero">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
        {dm ? <MessageSquare className="h-8 w-8" />
          : <ChannelGlyph channel={{ channelType: channel.channelType, visibility: channel.visibility }} className="h-8 w-8" />}
      </div>
      {dm ? null : onEdit ? (
        <button
          aria-label={t("channelManagement.editChannel")}
          className="group flex max-w-full flex-col items-center rounded-lg px-8 py-1 text-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="channel-management-edit"
          onClick={onEdit}
          type="button"
        >
          <span className="relative max-w-full" data-testid="channel-management-name-row">
            <span className="block max-w-full truncate text-xl font-semibold tracking-tight">{channel.name}</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-full ml-1 -translate-y-1/2 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 ease-out group-hover:text-foreground group-hover:opacity-100 group-focus-visible:opacity-100"
              data-testid="channel-management-edit-icon"
            >
              <Pencil className="h-4 w-4" />
            </span>
          </span>
          <span className="mt-1 line-clamp-6 max-w-full whitespace-pre-line text-sm leading-5 text-muted-foreground/70"
            data-testid="channel-management-description">{shownDescription}</span>
        </button>
      ) : (
        <div className="flex max-w-full flex-col items-center">
          <h3 className="max-w-full truncate text-xl font-semibold tracking-tight" data-testid="channel-management-name-row">
            {channel.name}
          </h3>
          {shownDescription ? (
            <p className="mt-1 line-clamp-6 max-w-full whitespace-pre-line text-sm leading-5 text-muted-foreground/70"
              data-testid="channel-management-description">{shownDescription}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MemberAvatarStack({ roster, members }: {
  roster: MemberRoster;
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
            {pubkey ? <MemberAvatar className={className} label={member.displayName} target={rosterMemberTarget(roster, member, pubkey)} />
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

type ChannelWorkflows = { rows: AutomationView[]; canCreate: boolean };

/** Every page of the Workspace's admitted automations, validated like the Workflows page. */
function useChannelWorkflows(workspaceId: string | undefined, enabled: boolean) {
  const client = useBffClient();
  return useQuery({
    queryKey: ["platform", "channel-workflows", workspaceId],
    enabled: enabled && workspaceId !== undefined,
    retry: false,
    queryFn: async (): Promise<ChannelWorkflows> => {
      const rows: AutomationView[] = [];
      let canCreate = false;
      let offset = 0;
      for (;;) {
        const page = await client.automations(workspaceId!, offset);
        if (!page || !Array.isArray(page.automations) || typeof page.canCreate !== "boolean"
          || !page.automations.every((row) => validAutomation(row) && row.workspaceId === workspaceId))
          throw new Error("Invalid workflow page");
        rows.push(...page.automations.filter((row) => row.state !== AutomationState.Deleted));
        canCreate = canCreate || page.canCreate;
        if (page.nextOffset === undefined) break;
        if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Workflow cursor did not advance");
        offset = page.nextOffset;
      }
      return { rows, canCreate };
    },
  });
}

const automationStateLabels = {
  [AutomationState.Draft]: "agents.automation.state.draft",
  [AutomationState.Enabled]: "agents.automation.state.enabled",
  [AutomationState.Paused]: "agents.automation.state.paused",
  [AutomationState.Disabled]: "agents.automation.state.disabled",
  [AutomationState.Deleted]: "agents.automation.state.deleted",
} as const;

function ChannelWorkflowsSection({ query, workflows }: {
  query: ReturnType<typeof useChannelWorkflows>;
  workflows: ChannelWorkflowNavigation;
}) {
  const t = useT();
  return (
    <div className="space-y-4 pt-3" data-testid="channel-workflows-section">
      {query.isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("channelManagement.loadingWorkflows")}</p>
      ) : query.isError ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{t("platform.loadFailed")}</p>
          <Button onClick={() => void query.refetch()} size="sm" variant="outline">{t("platform.retry")}</Button>
        </div>
      ) : query.data.rows.length > 0 ? (
        <PanelSectionGroup testId="channel-workflows-list">
          {query.data.rows.map((row) => <ChannelWorkflowRow key={row.resourceId} row={row} onOpen={workflows.onOpenWorkflow} />)}
        </PanelSectionGroup>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("channelManagement.noWorkflows")}</p>
      )}
      {query.isSuccess && query.data.canCreate ? (
        <Button className="w-full" data-testid="channel-workflows-new" onClick={workflows.onCreateWorkflow} type="button" variant="outline">
          <Plus />
          {t("channelManagement.newWorkflow")}
        </Button>
      ) : null}
    </div>
  );
}

function ChannelWorkflowRow({ row, onOpen }: { row: AutomationView; onOpen: (resourceId: string) => void }) {
  const client = useBffClient();
  const t = useT();
  // Same label rule as the Workflows card: the executing pin, else the latest readable version.
  const detail = useQuery({
    queryKey: ["platform", "channel-workflow", row.resourceId, row.resourceVersion],
    retry: false,
    queryFn: async () => {
      const value = await client.automation(row.resourceId, 0, 0);
      if (!validAutomationDetail(value, row.resourceId, row.workspaceId)) throw new Error("Invalid workflow detail");
      return value;
    },
  });
  const version = detail.isSuccess ? row.pinnedVersionAssetId
    ? detail.data.versions.find((item) => item.assetId === row.pinnedVersionAssetId)
    : detail.data.versions[0] : undefined;
  return (
    <button
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      data-testid={`channel-workflow-${row.resourceId}`}
      onClick={() => onOpen(row.resourceId)}
      type="button"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <WorkflowIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {version?.content.name ?? (detail.isPending ? t("channelManagement.loading") : t("workflows.unnamed"))}
        </span>
        <span className="block text-xs text-muted-foreground">{t(automationStateLabels[row.state])}</span>
      </span>
    </button>
  );
}

function IngressRow({ description, label, onClick, testId, trailing }: {
  description?: string;
  label: string;
  onClick: () => void;
  testId: string;
  trailing?: string;
}) {
  const t = useT();
  return (
    <PanelSectionGroup testId={`${testId}-section`}>
      <div className="relative flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
        <button
          aria-label={t("channelManagement.open", { label })}
          className="absolute inset-0 z-10 transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid={testId}
          onClick={onClick}
          type="button"
        />
        <WorkflowIcon className="pointer-events-none relative z-20 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="pointer-events-none relative z-20 min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground"><span>{label}</span></span>
          {description ? <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground/70">{description}</span> : null}
        </span>
        {trailing ? <span className="pointer-events-none relative z-20 text-sm text-muted-foreground/70">{trailing}</span> : null}
        <ChevronRight className="pointer-events-none relative z-20 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </PanelSectionGroup>
  );
}

function EditableInfoFieldRow({ editTestId, icon: Icon, label, multiline = false, onEdit, value, testId }: {
  editTestId?: string;
  icon?: LucideIcon;
  label: string;
  multiline?: boolean;
  onEdit?: () => void;
  value: string;
  testId: string;
}) {
  const t = useT();
  const content = (
    <>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" data-slot="field-row-icon" /> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className={cn("mt-0.5 block text-sm font-normal text-muted-foreground/70",
          multiline ? "line-clamp-2 whitespace-normal leading-5" : "truncate")}>{value}</span>
      </span>
      {onEdit ? (
        <span aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          data-testid={editTestId}>
          <Pencil className="h-4 w-4" />
        </span>
      ) : null}
    </>
  );
  if (onEdit) {
    return (
      <button
        aria-label={t("channelManagement.edit", { label: label.toLowerCase() })}
        className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={testId}
        onClick={onEdit}
        type="button"
      >
        {content}
      </button>
    );
  }
  return <div className="group flex min-h-16 w-full items-center gap-3 px-4 py-3" data-testid={testId}>{content}</div>;
}

function ActionFieldRow({ destructive = false, description, disabled, icon: Icon, label, onClick, testId }: {
  destructive?: boolean;
  description?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  testId: string;
}) {
  return (
    <button
      className={cn(
        "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
        destructive && "text-destructive",
      )}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", destructive && "text-destructive")} data-slot="field-row-icon" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground/70">{description}</span> : null}
      </span>
    </button>
  );
}
