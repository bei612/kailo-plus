// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx (Template row, summary, "Create new
// channel template…"), desktop/src/features/sidebar/lib/useCreateChannelForm.ts::{applyTemplate,
// handleTemplateChange} and desktop/src/app/AppShell.tsx::handleCreateChannel.
// Choosing a template pre-fills description and (until the user picks one) visibility. After the
// existing workspace.create submission is recorded, its parts are submitted one by one; a refused
// part is reported on its own and nothing that already succeeded is rolled back (DD-125(4)).
import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceVisibility, type ActionSubmission } from "@client-kit/contracts";
import { useBffClient, useFailureText, useT } from "../context";
import { useCollaborationPreferences } from "../collaboration-preferences";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import type { WorkspaceCreateState } from "../roles";
import { TemplateFormDialog, type EditableChannelTemplate } from "./TemplateFormDialog";
import {
  applyChannelTemplate, TemplateChannelPending, TemplateChannelRejected, waitForCreatedWorkspace,
  type TemplateApplyResult,
} from "./applyChannelTemplate";

const CREATE_LABEL_OPTIONAL_CLASS = "ml-1 text-xs font-normal text-muted-foreground/50";
const NO_TEMPLATE_VALUE = "__no-template__";
const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

export type ChannelTemplateSelection = {
  available: boolean;
  disabled: boolean;
  templates: EditableChannelTemplate[];
  selectedTemplateId: string | null;
  onChange: (templateId: string) => void;
  onCreated: (template: EditableChannelTemplate) => void;
};

/** Selection plus the post-create apply. `state` is the shared workspace.create form. */
export function useChannelTemplateSelection(state: WorkspaceCreateState, open: boolean): ChannelTemplateSelection {
  const t = useT();
  const client = useBffClient();
  const failureText = useFailureText();
  const preferences = useCollaborationPreferences();
  const templates = preferences?.templates ?? [];
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);
  // Original visibilityTouchedRef: a template never overrides a visibility the user picked.
  const expectedVisibility = React.useRef(state.visibility);
  const lifetime = React.useRef(true);
  React.useEffect(() => { lifetime.current = true; return () => { lifetime.current = false; }; }, []);
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current && !state.busy && !state.command) {
      setSelectedTemplateId(null);
      expectedVisibility.current = WorkspaceVisibility.Open;
    }
    wasOpen.current = open;
  }, [open, state.busy, state.command]);

  const applyTemplate = React.useCallback((template: EditableChannelTemplate) => {
    setSelectedTemplateId(template.id);
    state.setDescription(template.description ?? "");
    if (state.visibility === expectedVisibility.current) {
      const next = template.visibility === "private" ? WorkspaceVisibility.Private : WorkspaceVisibility.Open;
      expectedVisibility.current = next;
      state.setVisibility(next);
    }
  }, [state]);

  const onChange = React.useCallback((templateId: string) => {
    if (!templateId) {
      setSelectedTemplateId(null);
      state.setDescription("");
      if (state.visibility === expectedVisibility.current) {
        expectedVisibility.current = WorkspaceVisibility.Open;
        state.setVisibility(WorkspaceVisibility.Open);
      }
      return;
    }
    const template = templates.find((candidate) => candidate.id === templateId);
    if (template) applyTemplate(template);
  }, [applyTemplate, state, templates]);

  // The template is frozen with the creation intent, then applied once its submission lands.
  const intent = React.useRef<{ template: EditableChannelTemplate; name: string } | null>(null);
  React.useEffect(() => {
    if (!state.command) return;
    const template = templates.find((candidate) => candidate.id === selectedTemplateId);
    if (!intent.current && template && typeof state.command.name === "string")
      intent.current = { template, name: state.command.name };
  }, [state.command, selectedTemplateId, templates]);
  React.useEffect(() => {
    if (!state.command && !state.submission && !state.busy) intent.current = null;
  }, [state.command, state.submission, state.busy]);

  const handled = React.useRef<ActionSubmission | null>(null);
  const report = React.useCallback((results: TemplateApplyResult[]) => {
    for (const result of results) {
      if (result.outcome === "submitted") continue;
      const item = result.item.kind === "canvas" ? t("channelTemplates.apply.canvas") : result.item.name;
      const reason = result.outcome === "unavailable"
        ? t(result.item.kind === "canvas" ? "channelTemplates.apply.canvasUnavailable" : "channelTemplates.apply.agentUnavailable")
        : result.failure.kind === "unknown" ? t("channelTemplates.apply.unknown") : failureText(result.failure);
      toast.error(t("channelTemplates.apply.failed", { item, reason }));
    }
  }, [failureText, t]);

  React.useEffect(() => {
    const submission = state.submission;
    const frozen = intent.current;
    if (!submission || handled.current === submission || !frozen) return;
    handled.current = submission;
    intent.current = null;
    setSelectedTemplateId(null);
    const isCurrent = () => lifetime.current;
    void (async () => {
      let workspaceId: string;
      try {
        workspaceId = await waitForCreatedWorkspace(client, submission, { isCurrent, sleep });
      } catch (error) {
        // A refused channel is already shown by the create form; nothing else is sent.
        if (!(error instanceof TemplateChannelRejected) && isCurrent())
          toast.error(t(error instanceof TemplateChannelPending ? "channelTemplates.apply.pending" : "platform.loadFailed"));
        return;
      }
      // Agent names come from each Definition's installable candidate.
      const results = await applyChannelTemplate(client, frozen.template, workspaceId, frozen.name, new Map(), isCurrent);
      if (isCurrent()) report(results);
    })();
  }, [client, report, state.submission, t]);

  return {
    available: preferences !== null,
    disabled: state.locked || preferences?.state == null,
    templates, selectedTemplateId, onChange,
    onCreated: applyTemplate,
  };
}

/** Original Template row of the create-channel form. Hidden when the host has no preferences. */
export function CreateChannelTemplateField({ selection, visibility }: {
  selection: ChannelTemplateSelection; visibility: WorkspaceVisibility;
}) {
  const t = useT();
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = React.useState(false);
  if (!selection.available) return null;
  const selectedTemplate = selection.templates.find((template) => template.id === selection.selectedTemplateId);
  const agentCount = selectedTemplate?.agentResourceIds.length ?? 0;
  const summary = selectedTemplate ? [
    t(visibility === WorkspaceVisibility.Private ? "channel.visibility.private" : "channelTemplates.summary.open"),
    selectedTemplate.canvasTemplate ? t("channelTemplates.summary.canvas") : null,
    agentCount > 0 ? t(agentCount === 1 ? "channelTemplates.agentCount.one" : "channelTemplates.agentCount.other", { count: agentCount }) : null,
  ].filter(Boolean).join(" · ") : null;
  const label = selectedTemplate?.name ?? t("channelTemplates.none");
  return <>
    <div className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-input bg-background px-3 py-3"
      data-testid="create-channel-template-container">
      <span className={cn("text-sm font-medium text-foreground", selection.disabled && "opacity-50")}>
        {t("channelTemplates.templateLabel")}<span className={CREATE_LABEL_OPTIONAL_CLASS}>{t("channel.create.optional")}</span>
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t("channelTemplates.templateAria", { name: label })}
            className="-mr-2.5 ml-auto h-9 min-w-0 max-w-[60%] justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
            data-testid="create-channel-template" disabled={selection.disabled} id="create-channel-template" type="button" variant="ghost">
            <span className="truncate text-right">{label}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}
          style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}>
          <DropdownMenuRadioGroup value={selection.selectedTemplateId ?? NO_TEMPLATE_VALUE}
            onValueChange={(templateId) => selection.onChange(templateId === NO_TEMPLATE_VALUE ? "" : templateId)}>
            <DropdownMenuRadioItem value={NO_TEMPLATE_VALUE}>{t("channelTemplates.none")}</DropdownMenuRadioItem>
            {selection.templates.map((template) => <DropdownMenuRadioItem key={template.id} value={template.id}>{template.name}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setIsCreateTemplateOpen(true)}>
            <Plus className="size-4" />{t("channelTemplates.createNew")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TemplateFormDialog onCreated={selection.onCreated} onOpenChange={setIsCreateTemplateOpen} open={isCreateTemplateOpen} template={null} />
    </div>
    {summary ? <p className="-mt-3 px-3 text-xs text-muted-foreground" data-testid="create-channel-template-summary">{summary}</p> : null}
  </>;
}
