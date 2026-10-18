// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ChannelTemplatesSettingsCard.tsx::{TemplateFormDialog,TemplateTeamSelector}
// desktop/src/features/channels/ui/AddChannelBotPersonasSection.tsx::AgentRow
// DD-125(4): the Agent roster names same-Tenant AgentDefinitions (the original personas);
// runtime/model/backend do not apply to a governed Installation and are not shown. Teams
// depend on Agent Teams, which have no governed mapping yet: the original section is shown
// disabled with its reason and no team entry is ever written.
import * as React from "react";
import { Check, Users } from "lucide-react";
import { toast } from "sonner";
import { useBffClient, useT } from "../context";
import { useCollaborationPreferences } from "../collaboration-preferences";
import { MAX_CANVAS_TEMPLATE_BYTES, type ChannelTemplateRecord } from "../../collaboration-preferences";
import { Dialog } from "../composer/shared/ui/dialog";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { Input } from "../composer/shared/ui/input";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { UserAvatar } from "../messages/UserAvatar";
import { useLoad } from "../use-load";
import { loadTemplateAgents, type TemplateAgentOption } from "./applyChannelTemplate";

export type EditableChannelTemplate = ChannelTemplateRecord & { id: string };

function AgentRow({ agent, selected, disabled, onToggle }: {
  agent: TemplateAgentOption; selected: boolean; disabled: boolean; onToggle: () => void;
}) {
  return <button aria-pressed={selected} type="button" disabled={disabled} onClick={onToggle}
    data-testid={`template-agent-${agent.resourceId}`}
    className={cn(
      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
      selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      disabled && "cursor-not-allowed opacity-50",
    )}>
    <UserAvatar avatarUrl={null} displayName={agent.name} shape="squircle" className="h-9 w-9 shrink-0 text-xs" />
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{agent.name}</span>
    <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border",
      selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>
      {selected ? <Check className="h-3.5 w-3.5" /> : null}
    </span>
  </button>;
}

/** Original Teams selector heading, held inert: Agent Teams are BLOCKED in DD-125(4). */
function TemplateTeamSelector() {
  const t = useT();
  return <div className="space-y-3" data-testid="template-teams-blocked" aria-disabled="true">
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4" />{t("channelTemplates.teams")}
      </div>
      <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>{t("channelTemplates.teamsBlocked")}</p>
    </div>
  </div>;
}

export function TemplateFormDialog({ template, open, onOpenChange, onCreated }: {
  template: EditableChannelTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (template: EditableChannelTemplate) => void;
}) {
  const t = useT();
  const client = useBffClient();
  const preferences = useCollaborationPreferences();
  const isEditing = template !== null;
  const [agents, reloadAgents] = useLoad(`channel-template-agents:${open}`, () => open ? loadTemplateAgents(client) : Promise.resolve([]));
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [canvasTemplate, setCanvasTemplate] = React.useState("");
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<string[]>([]);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setCanvasTemplate(template?.canvasTemplate ?? "");
    setSelectedAgentIds(template?.agentResourceIds ?? []);
  }, [open, template]);

  const canvasTooLarge = new TextEncoder().encode(canvasTemplate.trim()).length > MAX_CANVAS_TEMPLATE_BYTES;
  const disabled = isPending || !preferences?.writable;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !preferences || canvasTooLarge || isPending) return;
    setIsPending(true);
    try {
      const draft = {
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        // The original form has no type or visibility field: new templates keep the
        // original defaults, edits keep what the template already holds.
        channelType: template?.channelType ?? "stream" as const,
        visibility: template?.visibility ?? "open" as const,
        ...(canvasTemplate.trim() ? { canvasTemplate: canvasTemplate.trim() } : {}),
        agentResourceIds: selectedAgentIds,
      };
      const id = await preferences.saveTemplate(template?.id ?? null, draft);
      if (!id) {
        toast.error(t(isEditing ? "channelTemplates.updateFailed" : "channelTemplates.createFailed"));
        return;
      }
      toast.success(t(isEditing ? "channelTemplates.updated" : "channelTemplates.created", { name: trimmedName }));
      if (!isEditing) onCreated?.({ ...draft, id, updatedAt: new Date().toISOString() });
      onOpenChange(false);
    } finally {
      setIsPending(false);
    }
  }

  const toggleAgent = (resourceId: string) => setSelectedAgentIds((prev) =>
    prev.includes(resourceId) ? prev.filter((id) => id !== resourceId) : [...prev, resourceId]);
  const agentOptions = agents.status === "ok" ? agents.data : [];
  // Saved entries whose Definition is no longer listed stay selectable for removal.
  const unlisted = selectedAgentIds.filter((id) => !agentOptions.some((agent) => agent.resourceId === id))
    .map((resourceId) => ({ resourceId, name: resourceId }));

  return <Dialog onOpenChange={(next) => { if (!isPending) onOpenChange(next); }} open={open}>
    <ChooserDialogContent className="max-w-lg" data-testid="channel-template-form"
      title={t(isEditing ? "channelTemplates.editTitle" : "channelTemplates.createTitle")}
      description={t(isEditing ? "channelTemplates.editDescription" : "channelTemplates.createDescription")}
      footer={<div className="flex w-full items-center justify-end gap-2">
        <Button disabled={isPending} onClick={() => onOpenChange(false)} type="button" variant="ghost">{t("buzz.cancel")}</Button>
        <Button disabled={disabled || name.trim().length === 0 || canvasTooLarge} form="template-form" type="submit">
          {isPending ? t(isEditing ? "channelTemplates.saving" : "channelTemplates.creating")
            : t(isEditing ? "buzz.save" : "channelTemplates.createSubmit")}
        </Button>
      </div>}>
      <form className="space-y-5" id="template-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-name">{t("channel.create.name")}</label>
          <Input autoComplete="off" disabled={isPending} id="template-name" onChange={(e) => setName(e.target.value)}
            placeholder={t("channelTemplates.namePlaceholder")} value={name} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-description">
            {t("channelTemplates.descriptionLabel")}{" "}
            <span className="font-normal text-muted-foreground">{t("channelTemplates.optional")}</span>
          </label>
          <Textarea className="min-h-16 resize-none" disabled={isPending} id="template-description" rows={2}
            onChange={(e) => setDescription(e.target.value)} placeholder={t("channelTemplates.descriptionPlaceholder")} value={description} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="template-canvas">
            {t("channelTemplates.canvasLabel")}{" "}
            <span className="font-normal text-muted-foreground">{t("channelTemplates.optional")}</span>
          </label>
          <Textarea className="min-h-20 resize-none font-mono text-xs" disabled={isPending} id="template-canvas" rows={4}
            onChange={(e) => setCanvasTemplate(e.target.value)} placeholder={t("channelTemplates.canvasPlaceholder")} value={canvasTemplate} />
          <p className="text-xs text-muted-foreground/70" data-settings-subcopy>{t("channelTemplates.placeholders")}</p>
          {canvasTooLarge ? <p role="alert" className="text-xs text-destructive">{t("channelTemplates.canvasTooLarge")}</p> : null}
        </div>
        <div className="space-y-4">
          {agents.status === "pending" ? <p className="px-3 text-sm text-muted-foreground">{t("channelTemplates.agentsLoading")}</p> : null}
          {agents.status === "error" ? <div role="alert" className="px-3 text-sm text-muted-foreground">
            {t("platform.loadFailed")} <Button size="xs" variant="ghost" type="button" onClick={reloadAgents}>{t("platform.retry")}</Button>
          </div> : null}
          {agentOptions.length > 0 || unlisted.length > 0 ? <div className="space-y-1">
            <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">{t("channelTemplates.agents")}</div>
            {[...agentOptions, ...unlisted].map((agent) => <AgentRow key={agent.resourceId} agent={agent}
              disabled={isPending} selected={selectedAgentIds.includes(agent.resourceId)} onToggle={() => toggleAgent(agent.resourceId)} />)}
          </div> : null}
        </div>
        <TemplateTeamSelector />
      </form>
    </ChooserDialogContent>
  </Dialog>;
}
