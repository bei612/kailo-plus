// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ChannelTemplatesSettingsCard.tsx::{ChannelTemplatesSettingsCard,TemplateRow}
// DD-125(4): templates are the caller's CollaborationUserState (at most 200), shared by Web and
// Desktop instead of the original Desktop-local file; there are no built-in templates here.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Bot, Copy, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../context";
import { useCollaborationPreferences } from "../collaboration-preferences";
import { SettingsOptionGroup } from "../settings-option-group";
import { SettingsSectionHeader } from "../settings-surface";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { TemplateFormDialog, type EditableChannelTemplate } from "./TemplateFormDialog";

function TemplateRow({ template, disabled, onEdit, onDuplicate, onDelete }: {
  template: EditableChannelTemplate; disabled: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const t = useT();
  const agentCount = template.agentResourceIds.length;
  return <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50" data-testid={`channel-template-${template.id}`}>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{template.name}</span></div>
      {template.description ? <p className="mt-0.5 truncate text-sm font-normal text-muted-foreground/70" data-settings-subcopy>{template.description}</p> : null}
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/70" data-settings-subcopy>
        {agentCount > 0 ? <span className="flex items-center gap-1"><Bot className="h-4 w-4" />
          {t(agentCount === 1 ? "channelTemplates.agentCount.one" : "channelTemplates.agentCount.other", { count: agentCount })}</span> : null}
        {template.canvasTemplate ? <span className="flex items-center gap-1"><MessageSquare className="h-4 w-4" />{t("channelTemplates.canvas")}</span> : null}
      </div>
    </div>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t("buzz.moreActions")} className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          disabled={disabled} size="icon" type="button" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" />{t("channelTemplates.edit")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}><Copy className="mr-2 h-4 w-4" />{t("channelTemplates.duplicate")}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />{t("buzz.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function ChannelTemplatesSettingsCard() {
  const t = useT();
  const preferences = useCollaborationPreferences();
  const [editingTemplate, setEditingTemplate] = React.useState<EditableChannelTemplate | null>(null);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<EditableChannelTemplate | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const templates = preferences?.templates ?? [];
  const writable = preferences?.writable === true;

  async function handleDuplicate(template: EditableChannelTemplate) {
    if (!preferences) return;
    // Original duplicate_channel_template: every field but the ID, renamed "(Copy)".
    const name = t("channelTemplates.copyName", { name: template.name });
    const id = await preferences.saveTemplate(null, {
      name, channelType: template.channelType, visibility: template.visibility, agentResourceIds: template.agentResourceIds,
      ...(template.description ? { description: template.description } : {}),
      ...(template.canvasTemplate ? { canvasTemplate: template.canvasTemplate } : {}),
    });
    if (id) toast.success(t("channelTemplates.duplicated", { name }));
    else toast.error(t("channelTemplates.duplicateFailed"));
  }

  async function handleDelete() {
    if (!deleteTarget || !preferences || deleting) return;
    setDeleting(true);
    try {
      if (await preferences.deleteTemplate(deleteTarget.id)) {
        toast.success(t("channelTemplates.deleted", { name: deleteTarget.name }));
        setDeleteTarget(null);
      } else toast.error(t("channelTemplates.deleteFailed"));
    } finally { setDeleting(false); }
  }

  return <section className="min-w-0" data-testid="settings-channel-templates">
    <SettingsSectionHeader title={t("channelTemplates.title")} description={t("channelTemplates.description")}
      action={<Button disabled={!writable} onClick={() => setIsCreateOpen(true)} size="sm" type="button" variant="outline">
        <Plus className="mr-1.5 h-4 w-4" />{t("channelTemplates.createSubmit")}
      </Button>} />
    <SettingsOptionGroup title={t("channelTemplates.group")}>
      {!preferences ? <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">{t("channelTemplates.unavailable")}</p>
        : preferences.state === null ? <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">{t("channelTemplates.loading")}</p>
        : templates.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("channelTemplates.empty")}</div>
        : templates.map((template) => <TemplateRow key={template.id} template={template} disabled={!writable}
          onDelete={() => setDeleteTarget(template)} onDuplicate={() => void handleDuplicate(template)}
          onEdit={() => setEditingTemplate(template)} />)}
    </SettingsOptionGroup>
    <TemplateFormDialog onOpenChange={setIsCreateOpen} open={isCreateOpen} template={null} />
    {editingTemplate ? <TemplateFormDialog open template={editingTemplate}
      onOpenChange={(open) => { if (!open) setEditingTemplate(null); }} /> : null}
    <AlertDialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("channelTemplates.deleteTitle")}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {t("channelTemplates.deleteDescription", { name: deleteTarget?.name ?? "" })}
              </AlertDialog.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild><Button disabled={deleting} type="button" variant="outline">{t("buzz.cancel")}</Button></AlertDialog.Cancel>
              <Button disabled={deleting || !writable} onClick={() => void handleDelete()} type="button" variant="destructive">{t("buzz.delete")}</Button>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </section>;
}
