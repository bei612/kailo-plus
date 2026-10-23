// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamDialog.tsx.
// DD-131(1): name, description and ordered member Definitions only. The original team-level
// "Team Instructions" field is not rendered (it would bypass the members' AgentVersion config hash);
// the original "Built-in" badge has no Kailo counterpart. Saving is the governed
// `agent.team.create` / `agent.team.update`; an unknown outcome keeps the same request.
import * as React from "react";

import type { AgentDefinitionView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Checkbox } from "../profile/buzz/shared/ui/checkbox";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { Input } from "../composer/shared/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useUiT } from "../context";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { RemoveMembersConfirmDialog } from "./RemoveMembersConfirmDialog";
import {
  MAX_TEAM_MEMBERS,
  copySelectedMemberIds,
  countMissingMemberIds,
  filterAvailableMemberIds,
  orderDefinitionsByInitiallySelected,
} from "./teamPersonas";

export type TeamDialogValues = {
  /** Present when editing: the read team and its version for the CAS update. */
  resourceId?: string;
  resourceVersion?: number;
  name: string;
  description: string;
  memberAgentResourceIds: string[];
  /** Members hidden from the editor; an update replaces the member list, so editing is blocked. */
  hiddenMemberCount?: number;
};

export type TeamSubmitInput = TeamDialogValues;

type TeamDialogProps = {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialValues: TeamDialogValues | null;
  definitions: AgentDefinitionView[];
  error: string | null;
  isPending: boolean;
  /** The last submission's outcome is unknown: only the same request may be re-checked. */
  unknown?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TeamSubmitInput) => void;
  onRetry?: () => void;
};

export function TeamDialog({
  open,
  title,
  description,
  submitLabel,
  initialValues,
  definitions,
  error,
  isPending,
  unknown = false,
  onOpenChange,
  onSubmit,
  onRetry,
}: TeamDialogProps) {
  const t = useUiT();
  const [name, setName] = React.useState("");
  const [teamDescription, setTeamDescription] = React.useState("");
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<string[]>([]);
  const [initialSelectedIdsForSort, setInitialSelectedIdsForSort] = React.useState<string[]>([]);
  const [confirmRemovalOpen, setConfirmRemovalOpen] = React.useState(false);
  const isEditMode = Boolean(initialValues?.resourceId);
  // Core replaces the whole member list on update: a hidden member would silently be dropped.
  const hiddenCount = isEditMode ? initialValues?.hiddenMemberCount ?? 0 : 0;
  const locked = isPending || unknown || hiddenCount > 0;
  const missingInitialMemberCount = React.useMemo(() => {
    if (!initialValues) return 0;
    return countMissingMemberIds(initialValues.memberAgentResourceIds, definitions);
  }, [initialValues, definitions]);

  React.useEffect(() => {
    if (!open || !initialValues) return;
    setName(initialValues.name);
    setTeamDescription(initialValues.description ?? "");
    setSelectedMemberIds(copySelectedMemberIds(initialValues.memberAgentResourceIds));
    setInitialSelectedIdsForSort(copySelectedMemberIds(initialValues.memberAgentResourceIds));
  }, [initialValues, open]);

  function handleOpenChange(next: boolean) {
    if (!next && (isPending || unknown)) return;
    if (!next) {
      setName("");
      setTeamDescription("");
      setSelectedMemberIds([]);
      setInitialSelectedIdsForSort([]);
      setConfirmRemovalOpen(false);
    }
    onOpenChange(next);
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= MAX_TEAM_MEMBERS ? current : [...current, id],
    );
  }

  const removedMemberIds = React.useMemo(() => {
    if (!isEditMode || !initialValues) return [];
    const currentSet = new Set(selectedMemberIds);
    return initialValues.memberAgentResourceIds.filter(
      (id) => !currentSet.has(id) && definitions.some((definition) => definition.resourceId === id),
    );
  }, [isEditMode, initialValues, selectedMemberIds, definitions]);

  const removedMemberNames = React.useMemo(
    () => removedMemberIds
      .map((id) => definitions.find((definition) => definition.resourceId === id)?.displayName)
      .filter((value): value is string => Boolean(value)),
    [removedMemberIds, definitions],
  );

  function buildSubmitInput(): TeamSubmitInput {
    return {
      ...(initialValues?.resourceId ? { resourceId: initialValues.resourceId, resourceVersion: initialValues.resourceVersion } : {}),
      name,
      description: teamDescription.trim(),
      memberAgentResourceIds: filterAvailableMemberIds(selectedMemberIds, definitions),
    };
  }

  function handleSubmit() {
    if (!initialValues) return;
    if (unknown) { onRetry?.(); return; }
    if (removedMemberIds.length > 0 && isEditMode) {
      setConfirmRemovalOpen(true);
      return;
    }
    onSubmit(buildSubmitInput());
  }

  function handleSubmitKeepAgents() {
    setConfirmRemovalOpen(false);
    onSubmit(buildSubmitInput());
  }

  const orderedDefinitions = React.useMemo(
    () => orderDefinitionsByInitiallySelected(definitions, initialSelectedIdsForSort),
    [initialSelectedIdsForSort, definitions],
  );
  const atLimit = selectedMemberIds.length >= MAX_TEAM_MEMBERS;

  return (
    <>
      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent className="max-w-2xl overflow-hidden p-0" data-testid="team-dialog" showCloseButton={!isPending && !unknown}
          onEscapeKeyDown={(event) => { if (isPending || unknown) event.preventDefault(); }}
          onInteractOutside={(event) => { if (isPending || unknown) event.preventDefault(); }}>
          <div className="flex max-h-[85vh] flex-col">
            <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
              <DialogTitle>{title}</DialogTitle>
              {description.trim().length > 0 ? (
                <DialogDescription>{description}</DialogDescription>
              ) : null}
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="space-y-1.5">
                <label className="text-control font-medium" htmlFor="team-name">
                  {t("agentTeams.name")}
                </label>
                <Input
                  autoCorrect="off"
                  disabled={locked}
                  id="team-name"
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("agentTeams.namePlaceholder")}
                  value={name}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-control font-medium" htmlFor="team-description">
                  {t("agentTeams.description")}
                </label>
                <Textarea
                  className="min-h-20"
                  disabled={locked}
                  id="team-description"
                  maxLength={2000}
                  onChange={(event) => setTeamDescription(event.target.value)}
                  placeholder={t("agentTeams.descriptionPlaceholder")}
                  value={teamDescription}
                />
              </div>

              <div className="space-y-2">
                <span className="text-control font-medium">{t("agentTeams.agents")}</span>
                <p className="text-xs text-muted-foreground">{t("agentTeams.selectAgents")}</p>
                {missingInitialMemberCount > 0 ? (
                  <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-text">
                    {t(missingInitialMemberCount === 1 ? "agentTeams.dialogMissing.one" : "agentTeams.dialogMissing.other", { count: missingInitialMemberCount })}
                  </p>
                ) : null}
                {hiddenCount > 0 ? (
                  <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground" data-testid="team-dialog-hidden-locked" role="status">
                    {t(hiddenCount === 1 ? "agentTeams.hiddenEditLocked.one" : "agentTeams.hiddenEditLocked.other", { count: hiddenCount })}
                  </p>
                ) : null}
                {atLimit ? <p className="text-xs text-muted-foreground" role="status">{t("agentTeams.memberLimit", { count: MAX_TEAM_MEMBERS })}</p> : null}
                {definitions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t("agentTeams.emptyAgents")}</p>
                ) : (
                  <div
                    className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-background p-1"
                    role="listbox"
                    aria-label={t("agentTeams.agents")}
                    aria-multiselectable="true"
                  >
                    {orderedDefinitions.map((definition, index) => {
                      const isSelected = selectedMemberIds.includes(definition.resourceId);
                      const disabled = locked || (!isSelected && atLimit);
                      return (
                        <div
                          className="flex min-h-[30px] cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-100 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                          data-testid={`team-member-option-${definition.resourceId}`}
                          key={definition.resourceId}
                          onClick={() => { if (!disabled) toggleMember(definition.resourceId); }}
                          onKeyDown={(event) => {
                            if (!disabled && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              toggleMember(definition.resourceId);
                            }
                          }}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={disabled}
                          tabIndex={0}
                        >
                          <Checkbox checked={isSelected} className="pointer-events-none" disabled={disabled} tabIndex={-1} />
                          <span className="h-6 w-6 shrink-0">
                            <IdentityInitialsAvatar className="border-0 text-2xs shadow-none" colorIndex={index} label={definition.displayName} size={24} />
                          </span>
                          <span className="text-sm">{definition.displayName}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {error ? (
                <p className={unknown ? "rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning-text" : "rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-text"} role={unknown ? "status" : "alert"}>
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Button disabled={isPending || unknown} onClick={() => handleOpenChange(false)} size="sm" type="button" variant="outline">
                  {t("buzz.cancel")}
                </Button>
                <Button
                  data-testid="team-dialog-submit"
                  disabled={!unknown && (name.trim().length === 0 || selectedMemberIds.length === 0 || isPending || hiddenCount > 0)}
                  onClick={handleSubmit}
                  size="sm"
                  type="button"
                >
                  {isPending ? t("agentTeams.saving") : unknown ? t("agents.retry") : submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RemoveMembersConfirmDialog
        open={confirmRemovalOpen}
        onOpenChange={setConfirmRemovalOpen}
        isPending={isPending}
        memberNames={removedMemberNames}
        onKeepAgents={handleSubmitKeepAgents}
      />
    </>
  );
}
