// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelCanvas.tsx::ChannelCanvas (view, edit, save, cancel)
// desktop/src/features/channels/ui/ChannelManagementSheetRows.tsx::getMarkdownPreviewText
// DD-125(4), V-SCN-135: the Canvas is management metadata. It is read as the member through the
// BFF, which adopts only the newest kind 40100 authored by the Tenant CONTROL key, and written
// only by the governed workspace.canvas.set (Workspace manage, explicit confirmation, CONTROL
// signs). The edit entry follows the BFF hint (original canEditNarrative); Core re-admits every
// save. An unknown outcome keeps the same command and key, so a retry never writes twice.
import * as React from "react";
import { Pencil, Save, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WebChannelCanvasView } from "@client-kit/contracts";
import { TransportError } from "../transport";
import { useBffClient, useT } from "./context";
import { Button } from "./profile/buzz/shared/ui/button";
import { Textarea } from "./profile/buzz/shared/ui/textarea";
import { useGovernedChannelAction, type ChannelActionOutcome } from "./channel-management-actions";

/** The only Canvas write (05 §2.11). */
export const CANVAS_SET_ACTION_KEY = "workspace.canvas.set";
/** Original Canvas bound: Markdown up to 64 KiB (SF-BUZ-54). */
export const MAX_CANVAS_BYTES = 64 * 1024;

export const channelCanvasQueryKey = (workspaceId: string) => ["platform", "channel-canvas", workspaceId] as const;

/** The admitted Canvas view of one Workspace channel; a foreign or malformed answer fails closed. */
export function useChannelCanvas(workspaceId: string | undefined, enabled: boolean) {
  const client = useBffClient();
  return useQuery({
    queryKey: channelCanvasQueryKey(workspaceId ?? ""),
    enabled: enabled && workspaceId !== undefined,
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<WebChannelCanvasView> => {
      const view = await client.channelCanvas(workspaceId!);
      if (!view || view.workspaceId !== workspaceId
        || (view.content !== undefined && typeof view.content !== "string")
        || (view.setActionKey !== undefined && view.setActionKey !== CANVAS_SET_ACTION_KEY))
        throw new TransportError("Invalid channel canvas view");
      return view;
    },
  });
}

/** Whether the BFF offers the governed edit entry for this Canvas. */
export function canEditChannelCanvas(view: WebChannelCanvasView | undefined): boolean {
  return view?.setActionKey === CANVAS_SET_ACTION_KEY;
}

/** Original getMarkdownPreviewText: one plain line for the sheet row. */
export function getMarkdownPreviewText(content: string): string {
  return content
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/~~(.*?)~~/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
}

function canvasBytes(content: string): number {
  return new TextEncoder().encode(content).length;
}

function saveOutcomeText(t: ReturnType<typeof useT>, outcome: ChannelActionOutcome): string | null {
  switch (outcome.kind) {
    case "recorded":
    case "waiting":
      return null;
    case "unknown":
      return t("channelCanvas.saveUnknown");
    case "aborted":
    case "rejected":
      return t("channelCanvas.saveFailed", { reason: outcome.reason });
  }
}

export function ChannelCanvas({ workspaceId, canEdit, isArchived, renderMarkdown }: {
  workspaceId: string;
  /** BFF hint (setActionKey): the original canEditNarrative. */
  canEdit: boolean;
  isArchived: boolean;
  /** Host Markdown renderer for the adopted Canvas body. */
  renderMarkdown: (content: string) => React.ReactNode;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canvasQuery = useChannelCanvas(workspaceId, true);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const save = useGovernedChannelAction(() => {
    setIsEditing(false);
    setDraft("");
    void queryClient.invalidateQueries({ queryKey: channelCanvasQueryKey(workspaceId) });
  });

  const canvasContent = canvasQuery.data?.content ?? null;
  // Defer the single large Markdown render so opening the canvas commits the chrome first.
  const deferredCanvasContent = React.useDeferredValue(canvasContent);
  const tooLarge = canvasBytes(draft) > MAX_CANVAS_BYTES;
  const message = save.outcome ? saveOutcomeText(t, save.outcome) : null;

  function handleStartEditing() {
    save.dismiss();
    setDraft(canvasContent ?? "");
    setIsEditing(true);
  }

  function handleCancelEditing() {
    if (save.unknown) return;
    save.dismiss();
    setIsEditing(false);
    setDraft("");
  }

  async function handleSave() {
    if (save.unknown) {
      await save.submit();
      return;
    }
    if (tooLarge) return;
    await save.submit({
      actionKey: CANVAS_SET_ACTION_KEY, workspaceId, explicitConfirmation: true, workspaceCanvas: { content: draft },
    });
  }

  if (canvasQuery.isPending) return <p className="text-sm text-muted-foreground" role="status">{t("channelCanvas.loading")}</p>;

  if (canvasQuery.isError) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
        {t("channelCanvas.loadFailed")}
      </p>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-3">
        <Textarea
          aria-label={t("channelCanvas.editorLabel")}
          className="min-h-48 font-mono text-sm"
          data-testid="channel-canvas-editor"
          disabled={save.busy || save.unknown}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("channelCanvas.placeholder")}
          value={draft}
        />
        <div className="flex gap-2">
          <Button data-testid="channel-canvas-save" disabled={save.busy || (tooLarge && !save.unknown)}
            onClick={() => { void handleSave(); }} size="sm" type="button">
            <Save className="h-4 w-4" />
            {t(save.busy ? "channelCanvas.saving" : save.unknown ? "workspace.lifecycle.retry" : "channelCanvas.save")}
          </Button>
          <Button data-testid="channel-canvas-cancel" disabled={save.busy || save.unknown} onClick={handleCancelEditing}
            size="sm" type="button" variant="outline">
            <X className="h-4 w-4" />
            {t("channelCanvas.cancel")}
          </Button>
        </div>
        {tooLarge && !save.unknown ? <p className="text-sm text-destructive" role="alert">{t("channelCanvas.tooLarge")}</p> : null}
        {message ? <p className="text-sm text-destructive" data-testid="channel-canvas-save-outcome" role="alert">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canvasContent ? (
        <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3" data-testid="channel-canvas-content">
          {renderMarkdown(deferredCanvasContent ?? "")}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("channelCanvas.empty")}</p>
      )}
      {canEdit && !isArchived ? (
        <Button data-testid="channel-canvas-edit" onClick={handleStartEditing} size="sm" type="button" variant="outline">
          <Pencil className="h-4 w-4" />
          {t(canvasContent ? "channelCanvas.edit" : "channelCanvas.create")}
        </Button>
      ) : null}
    </div>
  );
}
