// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/CommunityCatalogDialog.tsx.
// DD-131(6): the catalog is Core's read model, i.e. the Definitions and teams the caller can
// discover whose owners shared them (`catalogShared`), never Relay kind 30175/30178. Kept: the
// sidebar (Create agent / Import / Agents / Teams), selection keys, detail panes with the exact
// instructions review, drag-and-drop import and testids. "Add agent" is either an install of the
// current published version in a channel (`agent.installation.create`) or a copy as the person's own
// Definition (catalogCopy.ts); "Add team" copies the team as the person's own `agent_team`. The
// original runtime/model metadata rows are replaced by the published version's runtime contract
// facts; the outline artwork is replaced by the shared Users glyph.
import * as React from "react";
import { ChevronDown, Plus, Upload, Users } from "lucide-react";

import { AgentVersionState, type AgentDefinitionView, type AgentTeamView, type AgentVersionView, type WorkspaceView } from "@client-kit/contracts";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { Input } from "../composer/shared/ui/input";
import { Dialog } from "../composer/shared/ui/dialog";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { useBffClient, useCurrentPrincipalId, useFailureText, useUiT } from "../context";
import { useLoad } from "../use-load";
import { useGovernedChannelAction } from "../channel-management-actions";
import { loadConversationPeople } from "../conversations/use-conversations";
import { effectiveAgentDescription } from "./agentDescription";
import { agentActionOutcomeText } from "./agentActionOutcome";
import { resolveCatalogOwnerLabel } from "./catalogOwnerLabel";
import { copyCatalogDefinition, copyContentProblems, copyTeamCommand, suggestSlug, type CopyResult } from "./catalogCopy";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { SnapshotImportRuntimeFields, useImportRuntimeSources } from "./SnapshotImportFields";
import { resolveTeamMembers } from "./teamPersonas";
import { deployTeamToChannel, type TeamDeployResult } from "./teamDeploy";
import { AgentAlertDialog, AlertDialogAction, AlertDialogCancel } from "./AgentAlertDialog";

// ── Type-tagged selection keys ────────────────────────────────────────────────
function personaKey(definition: AgentDefinitionView): string {
  return `p:${definition.resourceId}`;
}
function teamKey(team: AgentTeamView): string {
  return `t:${team.resourceId}`;
}

type CommunityCatalogDialogProps = {
  /** Create pane: the host's governed create entry (the catalog closes first). */
  onCreateAgent: () => void;
  /** Import pane: absent when the host cannot move snapshot bytes. */
  onImportFile: ((file: File) => void) | null;
  definitions: AgentDefinitionView[];
  definitionsError: string | null;
  definitionsLoading: boolean;
  teams: AgentTeamView[];
  teamsError: string | null;
  teamsLoading: boolean;
  /** A recorded copy or install: the page re-reads its directories. */
  onChanged: () => void;
  open: boolean;
  preferSection: "agents" | "teams";
  onOpenChange: (open: boolean) => void;
};

type PendingNavigation = { type: "close" } | { type: "selection"; selection: string };

export function CommunityCatalogDialog({
  onCreateAgent,
  onImportFile,
  definitions,
  definitionsError,
  definitionsLoading,
  teams,
  teamsError,
  teamsLoading,
  onChanged,
  open,
  preferSection,
  onOpenChange,
}: CommunityCatalogDialogProps) {
  const t = useUiT();
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const dragDepthRef = React.useRef(0);
  const didInitRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation | null>(null);
  const [selection, setSelection] = React.useState("create");
  const [userHasSelected, setUserHasSelected] = React.useState(false);

  const personas = React.useMemo(() => definitions.filter((definition) => definition.catalogShared === true), [definitions]);
  const sharedTeams = React.useMemo(() => teams.filter((team) => team.catalogShared), [teams]);
  const firstTeamKey = sharedTeams[0] ? teamKey(sharedTeams[0]) : null;

  React.useEffect(() => {
    if (open) {
      didInitRef.current = false;
      setUserHasSelected(false);
      setSelection("create");
      setPendingNavigation(null);
      dragDepthRef.current = 0;
      setIsDragOver(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || didInitRef.current || userHasSelected) return;
    if (preferSection !== "teams") { didInitRef.current = true; return; }
    if (teamsLoading) return;
    didInitRef.current = true;
    if (firstTeamKey) setSelection(firstTeamKey);
  }, [open, preferSection, teamsLoading, firstTeamKey, userHasSelected]);

  // Drop a selected item that a refresh no longer lists.
  React.useEffect(() => {
    if (selection.startsWith("p:")) {
      if (!personas.some((definition) => personaKey(definition) === selection)) setSelection("create");
    } else if (selection.startsWith("t:")) {
      if (!sharedTeams.some((team) => teamKey(team) === selection)) setSelection("create");
    }
  }, [personas, sharedTeams, selection]);

  const selectedPersona = selection.startsWith("p:") ? personas.find((definition) => personaKey(definition) === selection) ?? null : null;
  const selectedTeam = selection.startsWith("t:") ? sharedTeams.find((team) => teamKey(team) === selection) ?? null : null;
  const isCreateSelected = selection === "create";
  const isImportSelected = selection === "import" && onImportFile !== null;
  const bothEmpty = !definitionsLoading && !teamsLoading && personas.length === 0 && sharedTeams.length === 0;
  const noError = !definitionsError && !teamsError;

  function requestSelection(next: string) {
    if (busyRef.current && next !== selection) { setPendingNavigation({ type: "selection", selection: next }); return; }
    setSelection(next);
  }
  function requestClose() {
    if (busyRef.current) { setPendingNavigation({ type: "close" }); return; }
    onOpenChange(false);
  }
  function discardChangesAndNavigate() {
    const navigation = pendingNavigation;
    busyRef.current = false;
    setPendingNavigation(null);
    if (navigation?.type === "selection") setSelection(navigation.selection);
    else if (navigation?.type === "close") onOpenChange(false);
  }

  React.useEffect(() => {
    if (!isImportSelected) { dragDepthRef.current = 0; setIsDragOver(false); }
  }, [isImportSelected]);

  function hasFiles(event: React.DragEvent) {
    return event.dataTransfer.types.includes("Files");
  }
  function isAgentSnapshot(file: File) {
    const lower = file.name.toLowerCase();
    return lower.endsWith(".agent.json") || lower.endsWith(".agent.png");
  }
  function importFile(file: File) {
    if (!isAgentSnapshot(file) || !onImportFile) return;
    onOpenChange(false);
    onImportFile(file);
  }

  return (
    <>
      <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) { requestClose(); return; } onOpenChange(true); }} open={open}>
        <ChooserDialogContent
          className="h-[42rem] max-w-4xl"
          contentClassName="flex min-h-0 min-w-0 flex-1 p-0"
          data-testid="community-catalog-dialog"
          description={t("agentCatalog.dialogDescription")}
          headerClassName="bg-sidebar pb-3 text-sidebar-foreground"
          headerTestId="community-catalog-dialog-header"
          onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus(); }}
          ref={contentRef}
          scrollAreaClassName="flex min-h-0 overflow-hidden px-0"
          scrollAreaTestId="community-catalog-dialog-body"
          tabIndex={-1}
          title={t("agentCatalog.dialogTitle")}
          onDragEnter={(event) => {
            if (!isImportSelected || !hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!isImportSelected) return;
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragOver(false);
          }}
          onDragOver={(event) => {
            if (!isImportSelected || !hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (!isImportSelected || !hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) importFile(file);
          }}
        >
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar sm:flex-row">
            {isImportSelected && isDragOver ? (
              <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm"
                data-testid="agent-catalog-drop-overlay">
                <p className="rounded-full bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-sm">{t("agentCatalog.dropToImport")}</p>
              </div>
            ) : null}

            <div className="flex max-h-56 min-h-0 flex-col sm:max-h-none sm:w-56">
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3" data-testid="community-catalog-dialog-scroll-area">
                <div className="space-y-1">
                  <CatalogNavigationButton icon={<Plus className="h-4 w-4" />} isCurrent={isCreateSelected} label={t("agentCatalog.createAgent")}
                    onClick={() => requestSelection("create")} testId="agent-catalog-create" />
                  {onImportFile ? (
                    <CatalogNavigationButton icon={<Upload className="h-4 w-4" />} isCurrent={isImportSelected} label={t("agentCatalog.import")}
                      onClick={() => requestSelection("import")} testId="agent-catalog-import" />
                  ) : null}
                </div>

                <div className="my-3 border-t border-sidebar-border/60" />

                {definitionsLoading ? <CatalogListSkeleton /> : null}
                {!definitionsLoading && personas.length > 0 ? (
                  <div className="mb-1">
                    <p className="px-4 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">{t("agentCatalog.agents")}</p>
                    <div className="space-y-1">
                      {personas.map((definition, index) => {
                        const key = personaKey(definition);
                        const isCurrent = key === selection;
                        return (
                          <button
                            aria-current={isCurrent ? "true" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-4 py-1.5 text-left transition-[background-color,color,box-shadow] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                              isCurrent ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            )}
                            data-testid={`community-catalog-agent-${definition.resourceId}`}
                            key={definition.resourceId}
                            onClick={() => { setUserHasSelected(true); requestSelection(key); }}
                            type="button"
                          >
                            <span className="h-6 w-6 shrink-0"><IdentityInitialsAvatar className="border-0 text-3xs shadow-none" colorIndex={index} label={definition.displayName} size={24} /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{definition.displayName}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {teamsLoading ? <CatalogListSkeleton /> : null}
                {!teamsLoading && sharedTeams.length > 0 ? (
                  <div className="mb-1">
                    <p className="px-4 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">{t("agentCatalog.teams")}</p>
                    <div className="space-y-1">
                      {sharedTeams.map((team) => {
                        const key = teamKey(team);
                        const isCurrent = key === selection;
                        return (
                          <button
                            aria-current={isCurrent ? "true" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-4 py-1.5 text-left transition-[background-color,color,box-shadow] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                              isCurrent ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            )}
                            data-testid={`community-catalog-team-${team.resourceId}`}
                            key={team.resourceId}
                            onClick={() => { setUserHasSelected(true); requestSelection(key); }}
                            type="button"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>
                            <span className="shrink-0 text-xs tabular-nums opacity-70">{team.memberAgentResourceIds.length + team.hiddenMemberCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {bothEmpty && noError ? <CatalogEmptyState /> : null}
              </div>
            </div>

            <div className="relative z-10 mb-3 ml-px mr-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-[-1px_0_0_0_hsl(var(--sidebar-border)/0.45)]">
              {isCreateSelected ? <CreateAgentPane onCreate={() => { onOpenChange(false); onCreateAgent(); }} /> : null}
              {isImportSelected ? <ImportAgentPane onImport={() => fileInputRef.current?.click()} /> : null}
              {selectedPersona ? (
                <PersonaCatalogEntry key={selectedPersona.resourceId} definition={selectedPersona} onBusyChange={(busy) => { busyRef.current = busy; }} onChanged={onChanged} />
              ) : null}
              {selectedTeam ? (
                <TeamCatalogEntry key={selectedTeam.resourceId} team={selectedTeam} definitions={definitions}
                  onBusyChange={(busy) => { busyRef.current = busy; }} onChanged={onChanged} />
              ) : null}
              {definitionsError ? (
                <p className="m-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{definitionsError}</p>
              ) : null}
              {teamsError ? (
                <p className="m-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{teamsError}</p>
              ) : null}
            </div>
          </div>

          <input
            accept=".agent.json,.agent.png"
            className="hidden"
            data-testid="agent-catalog-import-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importFile(file);
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
        </ChooserDialogContent>
      </Dialog>

      <AgentAlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(nextOpen) => { if (!nextOpen) setPendingNavigation(null); }}
        testId="discard-create-agent-dialog"
        title={t("agentCatalog.leaveTitle")}
        description={t("agentCatalog.leaveDescription")}
        footer={<>
          <AlertDialogCancel asChild><Button type="button" variant="outline">{t("agentCatalog.keepEditing")}</Button></AlertDialogCancel>
          <AlertDialogAction asChild><Button onClick={discardChangesAndNavigate} type="button" variant="destructive">{t("agentCatalog.leave")}</Button></AlertDialogAction>
        </>}
      />
    </>
  );
}

function CatalogNavigationButton({ icon, isCurrent, label, onClick, testId }: {
  icon: React.ReactNode; isCurrent: boolean; label: string; onClick: () => void; testId: string;
}) {
  return (
    <button
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-4 py-2 text-left text-sm font-medium transition-[background-color,color,box-shadow] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        isCurrent ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CreateAgentPane({ onCreate }: { onCreate: () => void }) {
  const t = useUiT();
  return (
    <div className="m-5 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-border/70 px-8 py-12 text-center" data-testid="agent-catalog-create-pane">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Plus className="h-6 w-6" /></span>
      <span className="mt-4 text-base font-semibold">{t("agentCatalog.createAgent")}</span>
      <span className="mt-2 max-w-sm text-sm text-muted-foreground">{t("agentCatalog.createHint")}</span>
      <Button className="mt-5" data-testid="agent-catalog-create-open" onClick={onCreate} size="sm" type="button">{t("agentCatalog.createAgent")}</Button>
    </div>
  );
}

function ImportAgentPane({ onImport }: { onImport: () => void }) {
  const t = useUiT();
  return (
    <button
      className="m-5 flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/20 px-8 py-12 text-center transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="agent-catalog-import-dropzone"
      onClick={onImport}
      type="button"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Upload className="h-6 w-6" /></span>
      <span className="mt-4 text-base font-semibold">{t("agentCatalog.importAgent")}</span>
      <span className="mt-2 max-w-sm text-sm text-muted-foreground">{t("agentCatalog.importHint")}</span>
      <span className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{t("agentCatalog.chooseFile")}</span>
    </button>
  );
}

function CatalogEmptyState() {
  const t = useUiT();
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center" data-testid="community-catalog-empty-state">
      <Users aria-hidden="true" className="h-24 w-24 text-sidebar-foreground/30" data-testid="community-catalog-empty-artwork" />
      <p className="mt-3 text-sm font-semibold text-sidebar-foreground">{t("agentCatalog.emptyTitle")}</p>
      <p className="mt-1 text-xs text-sidebar-foreground/60">{t("agentCatalog.emptyDescription")}</p>
    </div>
  );
}

function CatalogListSkeleton() {
  return (
    <div className="space-y-2">
      {["first", "second", "third", "fourth", "fifth"].map((key) => (
        <div className="flex items-center gap-2 rounded-lg px-4 py-1.5" key={key}>
          <div className="h-6 w-6 animate-pulse rounded-full bg-primary/10" />
          <div className="h-4 w-28 animate-pulse rounded-md bg-primary/10" />
        </div>
      ))}
    </div>
  );
}

/**
 * Security review surface for instructions that will execute verbatim (original). Not the chat
 * Markdown renderer: Markdown hides spoilers, link targets and image sources.
 */
export function AgentInstructionReview({ instructions }: { instructions: string }) {
  const t = useUiT();
  return (
    <pre className="mt-3 w-full min-w-0 max-w-full whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground"
      data-testid="persona-catalog-exact-instructions">
      {instructions || t("agentSnapshots.noInstructions")}
    </pre>
  );
}

function useOwnerNames() {
  const client = useBffClient();
  const [people] = useLoad("catalog-owner-names", () => loadConversationPeople(client, () => undefined));
  return React.useMemo(() => people.status === "ok"
    ? new Map(people.data.map((person) => [person.principalId, person.displayName])) : null, [people]);
}

function PersonaAddedBy({ label }: { label: string }) {
  const t = useUiT();
  return <p className="mt-0.5 text-xs text-muted-foreground" data-testid="persona-added-by">{t("agentCatalog.addedBy", { name: label })}</p>;
}

// ── Persona entry: detail + install / copy ────────────────────────────────────

function PersonaCatalogEntry({ definition, onBusyChange, onChanged }: {
  definition: AgentDefinitionView; onBusyChange: (busy: boolean) => void; onChanged: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const principalId = useCurrentPrincipalId();
  const names = useOwnerNames();
  const assetId = definition.currentPublishedVersionAssetId;
  const [version] = useLoad(`catalog-version:${definition.resourceId}:${assetId ?? ""}`,
    () => assetId ? client.agentVersion(assetId) : Promise.resolve(null));
  const published: AgentVersionView | null = version.status === "ok" && version.data && version.data.assetId === assetId
    && version.data.state === AgentVersionState.Published ? version.data : null;
  const [mode, setMode] = React.useState<"detail" | "install" | "copy">("detail");
  const description = published ? effectiveAgentDescription(published.content.personaIdentity) : null;
  const ownerLabel = resolveCatalogOwnerLabel(t, definition.ownerPrincipalId, principalId, names);

  return (
    <>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-5 pb-24 pt-5" data-testid="community-catalog-detail-pane">
        <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0"><IdentityInitialsAvatar className="border-0 text-sm shadow-none" label={definition.displayName} size={48} /></span>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-semibold leading-snug">{definition.displayName}</h3>
              <PersonaAddedBy label={ownerLabel} />
            </div>
          </div>
          {description ? <p className="min-w-0 max-w-prose break-all text-sm leading-6 text-muted-foreground" data-testid="persona-catalog-description">{description}</p> : null}
          {!assetId ? <p className="text-sm text-muted-foreground" role="status">{t("agentCatalog.noPublishedVersion")}</p>
            : version.status === "pending" ? <p className="text-sm text-muted-foreground" role="status">{t("platform.loading")}</p>
            : !published ? <p className="text-sm text-destructive" role="alert">{t("platform.loadFailed")}</p>
            : <>
              <div className="space-y-1 text-xs text-muted-foreground" data-testid="persona-catalog-metadata">
                <p>{t("agents.version.replyPolicy")}: {published.content.replyPolicy}</p>
                <p>{t("agents.version.parallelism")}: {published.content.parallelism}</p>
              </div>
              <div className="min-w-0 max-w-full pt-3">
                <p className="text-base font-semibold text-foreground">{t("agentSnapshots.instructions")}</p>
                <AgentInstructionReview instructions={published.content.instructions} />
              </div>
            </>}
          {published && mode === "install" ? <CatalogInstallPanel definition={definition} onBusyChange={onBusyChange} onChanged={onChanged} onCancel={() => setMode("detail")} /> : null}
          {published && mode === "copy" ? <CatalogCopyPanel source={published} definition={definition} onBusyChange={onBusyChange} onChanged={onChanged} onCancel={() => setMode("detail")} /> : null}
        </div>
      </div>
      {published && mode === "detail" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-background via-background/95 to-transparent px-5 pb-4 pt-12">
          <Button aria-label={t("agentCatalog.installAria", { name: definition.displayName })} className="pointer-events-auto"
            data-testid={`community-catalog-install-agent-${definition.resourceId}`} onClick={() => setMode("install")} size="sm" type="button" variant="outline">
            {t("agentCatalog.addToChannel")}
          </Button>
          <Button aria-label={t("agentCatalog.copyAria", { name: definition.displayName })} className="pointer-events-auto"
            data-testid={`community-catalog-use-agent-${definition.resourceId}`} onClick={() => setMode("copy")} size="sm" type="button">
            {t("agentCatalog.addAgent")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ChannelSelect({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const t = useUiT();
  const client = useBffClient();
  const [channels, reload] = useLoad("catalog-install-channels", client.workspaces);
  const available: WorkspaceView[] = channels.status === "ok" && Array.isArray(channels.data) ? channels.data.filter((channel) => channel.isMember !== false) : [];
  React.useEffect(() => { const first = available[0]; if (!value && first) onChange(first.id); }, [value, available, onChange]);
  if (channels.status === "error") return <p className="text-sm text-destructive" role="alert">{t("platform.loadFailed")} <button className="underline" onClick={reload} type="button">{t("platform.retry")}</button></p>;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor="catalog-install-channel">{t("agentTeams.channel")}</label>
      <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs" disabled={disabled || available.length === 0}
        id="catalog-install-channel" onChange={(event) => onChange(event.target.value)} value={value}>
        {available.length === 0 ? <option value="">{t("agentTeams.noChannels")}</option> : null}
        {available.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
    </div>
  );
}

function CatalogInstallPanel({ definition, onBusyChange, onChanged, onCancel }: {
  definition: AgentDefinitionView; onBusyChange: (busy: boolean) => void; onChanged: () => void; onCancel: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const [channelId, setChannelId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TeamDeployResult | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const install = async () => {
    if (!channelId || busy) return;
    setBusy(true); onBusyChange(true); setProblem(null);
    try {
      const [done] = await deployTeamToChannel(client, [{ resourceId: definition.resourceId, name: definition.displayName }], channelId, () => true);
      setResult(done ?? null);
      if (done?.outcome === "submitted") onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); onBusyChange(false); }
  };
  const text = !result ? null : result.outcome === "submitted" ? t(result.waiting ? "agentTeams.deployWaiting" : "agentTeams.deploySubmitted", { operation: result.operationId })
    : result.outcome === "already" ? t("agentTeams.deployAlready") : result.outcome === "unavailable" ? t("agentTeams.deployUnavailable")
    : result.failure.kind === "unknown" ? t("agents.unknown", { operation: result.failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(result.failure) });
  return (
    <section className="space-y-3 rounded-md border border-border p-3" data-testid="community-catalog-install-panel">
      <p className="text-xs text-muted-foreground">{t("agentCatalog.installHint")}</p>
      <ChannelSelect value={channelId} onChange={setChannelId} disabled={busy || result !== null} />
      {text ? <p className="text-sm" data-outcome={result?.outcome} data-testid="community-catalog-install-result" role="status">{text}</p> : null}
      {problem ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="ghost">{result ? t("buzz.close") : t("buzz.cancel")}</Button>
        {!result ? <Button data-testid="community-catalog-install-confirm" disabled={busy || !channelId} onClick={() => void install()} size="sm" type="button">
          {busy ? t("agentTeams.deploying") : t("agentCatalog.addToChannel")}
        </Button> : null}
      </div>
    </section>
  );
}

function CatalogCopyPanel({ source, definition, onBusyChange, onChanged, onCancel }: {
  source: AgentVersionView; definition: AgentDefinitionView; onBusyChange: (busy: boolean) => void; onChanged: () => void; onCancel: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const sources = useImportRuntimeSources(true);
  const [name, setName] = React.useState(source.content.personaIdentity.displayName || definition.displayName);
  const [slug, setSlug] = React.useState(() => suggestSlug(source.content.personaIdentity.displayName || definition.displayName));
  const [profileKey, setProfileKey] = React.useState("");
  const [routeId, setRouteId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<CopyResult | null>(null);
  const scope = React.useRef({ active: true });
  React.useEffect(() => { const current = { active: true }; scope.current = current; return () => { current.active = false; }; }, []);
  const profile = sources.state.status === "ok" ? sources.state.data.profiles.find((value) => value.key === profileKey) : undefined;
  const problems = profile ? copyContentProblems(source.content, profile) : [];
  const valid = !!name.trim() && /^[a-z0-9][a-z0-9-]*$/.test(slug.trim()) && !!profile && !!routeId && problems.length === 0;
  const copy = async () => {
    if (!valid || !profile || busy) return;
    const current = scope.current;
    setBusy(true); onBusyChange(true);
    try {
      const done = await copyCatalogDefinition(client, source, { name, slug, profile, routeId },
        { isCurrent: () => current.active, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
      if (current.active) setResult(done);
      if (done.outcome !== "failed") onChanged();
    } finally { if (current.active) setBusy(false); onBusyChange(false); }
  };
  const resultText = !result ? null : result.outcome === "copied" ? t("agentCatalog.copied", { operation: result.operations.join(", ") })
    : t(result.outcome === "partial" ? "agentCatalog.copyPartial" : "agentCatalog.copyFailed", {
      step: t(result.step === "definition" ? "agentCatalog.stepDefinition" : "agentCatalog.stepVersion"),
      reason: result.failure.kind === "unknown" ? t("agents.unknown", { operation: result.failure.operationId ?? "—" }) : failureText(result.failure) });
  return (
    <section className="space-y-3 rounded-md border border-border p-3" data-testid="community-catalog-copy-panel">
      <p className="text-xs text-muted-foreground">{t("agentCatalog.copyHint")}</p>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="catalog-copy-name">{t("agents.name")}</label>
        <Input disabled={busy || result !== null} id="catalog-copy-name" onChange={(event) => setName(event.target.value)} value={name} />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="catalog-copy-slug">{t("agents.slug")}</label>
        <Input disabled={busy || result !== null} id="catalog-copy-slug" onChange={(event) => setSlug(event.target.value)} value={slug} />
        <p className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</p>
      </div>
      <SnapshotImportRuntimeFields sources={sources.state} onReload={sources.reload} profileKey={profileKey} routeId={routeId}
        onProfileChange={setProfileKey} onRouteChange={setRouteId} disabled={busy || result !== null} testIdPrefix="catalog-copy" requireImport={false} />
      {problems.length > 0 ? <p className="text-sm text-destructive" data-testid="catalog-copy-problems" role="alert">{t("agentCatalog.copyIncompatible", { fields: problems.join(", ") })}</p> : null}
      {resultText ? <p className="text-sm" data-outcome={result?.outcome} data-testid="community-catalog-copy-result" role="status">{resultText}</p> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="ghost">{result ? t("buzz.close") : t("buzz.cancel")}</Button>
        {!result ? <Button data-testid="community-catalog-copy-confirm" disabled={!valid || busy} onClick={() => void copy()} size="sm" type="button">
          {busy ? t("agentCatalog.adding") : t("agentCatalog.addAgent")}
        </Button> : null}
      </div>
    </section>
  );
}

// ── Team entry ────────────────────────────────────────────────────────────────

function TeamCatalogEntry({ team, definitions, onBusyChange, onChanged }: {
  team: AgentTeamView; definitions: AgentDefinitionView[]; onBusyChange: (busy: boolean) => void; onChanged: () => void;
}) {
  const t = useUiT();
  const principalId = useCurrentPrincipalId();
  const names = useOwnerNames();
  const action = useGovernedChannelAction(() => onChanged());
  React.useEffect(() => { onBusyChange(action.busy || action.unknown); }, [action.busy, action.unknown, onBusyChange]);
  const resolution = resolveTeamMembers(team, definitions);
  const memberCount = team.memberAgentResourceIds.length + team.hiddenMemberCount;
  const isOwn = principalId !== undefined && team.ownerPrincipalId === principalId;
  const ownerLabel = resolveCatalogOwnerLabel(t, team.ownerPrincipalId, principalId, names);
  const added = action.outcome?.kind === "recorded" || action.outcome?.kind === "waiting";
  const add = () => {
    if (action.unknown) { void action.submit(); return; }
    if (added || action.busy || resolution.resolvedMembers.length === 0) return;
    void action.submit(copyTeamCommand({ name: team.name, description: team.description, memberAgentResourceIds: resolution.resolvedMemberIds }));
  };
  return (
    <>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-5 pb-24 pt-5" data-testid="community-catalog-detail-pane">
        <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold leading-snug">{team.name}</h3>
            <PersonaAddedBy label={ownerLabel} />
            {team.description ? <p className="mt-3 text-sm text-muted-foreground">{team.description}</p> : null}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">{t(memberCount === 1 ? "agentTeams.memberCount.one" : "agentTeams.memberCount.other", { count: memberCount })}</p>
            <ul className="mt-3 space-y-2">
              {resolution.resolvedMembers.map((member) => <TeamCatalogMemberRow key={member.resourceId} member={member} />)}
            </ul>
            {team.hiddenMemberCount > 0 ? <p className="mt-2 text-xs text-muted-foreground">
              {t(team.hiddenMemberCount === 1 ? "agentTeams.hidden.one" : "agentTeams.hidden.other", { count: team.hiddenMemberCount })}
            </p> : null}
          </div>
          {action.outcome ? <p className="text-sm" data-testid="community-catalog-add-team-result" role={action.outcome.kind === "rejected" ? "alert" : "status"}>
            {agentActionOutcomeText(t, action.outcome)}
          </p> : null}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-background via-background/95 to-transparent px-5 pb-4 pt-12">
        <Button
          aria-label={added || isOwn ? t("agentCatalog.teamAlreadyAria", { name: team.name }) : t("agentCatalog.addTeamAria", { name: team.name })}
          className="pointer-events-auto"
          data-testid="community-catalog-add-team"
          disabled={(isOwn || added || action.busy || resolution.resolvedMembers.length === 0) && !action.unknown}
          onClick={add}
          size="sm"
          type="button"
        >
          {added || isOwn ? t("agentCatalog.addedTeam") : action.busy ? t("agentCatalog.adding") : action.unknown ? t("agents.retry") : t("agentCatalog.addTeam")}
        </Button>
      </div>
    </>
  );
}

function TeamCatalogMemberRow({ member }: { member: AgentDefinitionView }) {
  const t = useUiT();
  const client = useBffClient();
  const [expanded, setExpanded] = React.useState(false);
  const assetId = member.currentPublishedVersionAssetId;
  return (
    <li className="overflow-hidden rounded-lg border border-border/70 bg-card/70" data-testid={`community-catalog-member-${member.resourceId}`}>
      <button aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/30 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        data-testid={`community-catalog-member-expand-${member.resourceId}`} onClick={() => setExpanded((value) => !value)} type="button">
        <span className="h-8 w-8 shrink-0"><IdentityInitialsAvatar className="border-0 text-3xs shadow-none" label={member.displayName} size={32} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{member.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{assetId ? t("agentCatalog.published") : t("agentCatalog.noPublishedVersion")}</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && assetId ? <MemberInstructions assetId={assetId} client={client} /> : null}
    </li>
  );
}

function MemberInstructions({ assetId, client }: { assetId: string; client: ReturnType<typeof useBffClient> }) {
  const t = useUiT();
  const [version] = useLoad(`catalog-member-version:${assetId}`, () => client.agentVersion(assetId));
  return (
    <div className="space-y-4 border-t border-border/60 px-3 pb-4 pt-3">
      <div className="min-w-0 max-w-full">
        <p className="text-sm font-semibold text-foreground">{t("agentSnapshots.instructions")}</p>
        {version.status === "pending" ? <p className="mt-3 text-sm text-muted-foreground">{t("platform.loading")}</p>
          : version.status === "error" ? <p className="mt-3 text-sm text-destructive">{t("platform.loadFailed")}</p>
          : version.data.content.instructions.trim().length > 0 ? <AgentInstructionReview instructions={version.data.content.instructions} />
          : <p className="mt-3 text-sm italic text-muted-foreground/60">{t("agentSnapshots.noInstructions")}</p>}
      </div>
    </div>
  );
}
