// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/moderation/ui/ReportMessageDialog.tsx::ReportMessageDialog
// DD-125(2): the original seven-category report dialog. Submitting is the governed
// moderation.report.submit: Core re-reads the message as the reporter in its admitted scope,
// takes its signer as the `p` target and signs kind 1984 as the reporter. Reporting stays
// available while timed out (original Relay behaviour).
// A native host (Desktop, DD-75) instead publishes the same 1984 with its device CLIENT key, as
// DD-125(2) puts 1984 in the member whitelist "原生端直连": it supplies a NativeReportPublisher
// that answers done or unknown; an unknown report is never re-signed (the host resends the same
// signed event), and is never shown as success or failure.
import { Flag } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { ModerationReportType } from "@client-kit/contracts";
import { REPORT_CATEGORIES, REPORT_NOTE_MAX_CHARS, reportCommand, type ReportScope } from "../../moderation";
import { BffError, isOutcomeUnknown } from "../../transport";
import { useHasPlatform, useReasonText, useT, useUiT } from "../context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { Button } from "../profile/buzz/shared/ui/button";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { useModerationAction } from "./hooks";

export type NativeReportInput = { eventId: string; authorPubkey: string; reportType: ModerationReportType; note?: string };
export type NativeReportPublisher = (input: NativeReportInput) => Promise<"done" | "unknown">;
const NativeReportPublisherContext = React.createContext<NativeReportPublisher | null>(null);
/** Native hosts publish 1984 themselves (DD-125(2)); Web leaves this unset and uses Core. */
export const NativeReportPublisherProvider = NativeReportPublisherContext.Provider;

type ReportMessageDialogProps = {
  /** Reported message author (the `p` tag); required for a native publisher. */
  authorPubkey?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reported message event id (the `e` tag target). */
  eventId: string;
  /** The admitted scope the reporter reads the message in. */
  scope: ReportScope;
};

/** Original "Report message" entry of the message More menu; needs the host's platform session. */
export function ReportMessageMenuItem({ messageId, onSelect }: { messageId: string; onSelect: () => void }) {
  const t = useUiT();
  if (!useHasPlatform()) return null;
  return (
    <DropdownMenuItem data-testid={`report-message-${messageId}`} onClick={onSelect}>
      <Flag className="h-4 w-4" />
      {t("moderation.report.title")}
    </DropdownMenuItem>
  );
}

/** The governed submission needs the host's platform session; without one nothing renders. */
export function ReportMessageDialog(props: ReportMessageDialogProps) {
  return useHasPlatform() ? <ReportDialogBody {...props} /> : null;
}

function ReportDialogBody({ open, onOpenChange, eventId, scope, authorPubkey }: ReportMessageDialogProps) {
  const t = useT();
  const reasonText = useReasonText();
  const governedReport = useModerationAction();
  const nativePublisher = React.useContext(NativeReportPublisherContext);
  const [nativePending, setNativePending] = React.useState(false);
  const submitReport = { isPending: governedReport.isPending || nativePending };
  const [category, setCategory] = React.useState<ModerationReportType | null>(null);
  const [note, setNote] = React.useState("");

  // Reset the form each time the dialog opens so a prior report's selection never leaks.
  React.useEffect(() => {
    if (open) {
      setCategory(null);
      setNote("");
    }
  }, [open]);

  const submit = () => {
    if (!category || submitReport.isPending) return;
    const trimmed = note.trim();
    if (nativePublisher) {
      if (!authorPubkey) { toast.error(t("moderation.report.failed")); return; }
      setNativePending(true);
      void nativePublisher({ eventId, authorPubkey, reportType: category, ...(trimmed ? { note: trimmed } : {}) })
        .then((outcome) => {
          if (outcome === "done") {
            toast.success(t("moderation.report.submitted"));
            onOpenChange(false);
          } else toast(t("moderation.report.unknown", { operation: "" }));
        }, () => toast.error(t("moderation.report.failed")))
        .finally(() => setNativePending(false));
      return;
    }
    governedReport.mutate(
      {
        intent: `report:${eventId}:${category}:${trimmed}`,
        build: (key) => reportCommand({ eventId, reportType: category, note: trimmed || undefined, scope }, key),
      },
      {
        onSuccess: (outcome) => {
          if (outcome.kind === "done") {
            toast.success(t("moderation.report.submitted"));
            onOpenChange(false);
          } else if (outcome.kind === "unknown") {
            toast(t("moderation.report.unknown", { operation: outcome.operationId }));
          } else {
            toast.error(outcome.reason ? reasonText(outcome.reason) : t("moderation.report.failed"));
          }
        },
        onError: (error) => {
          if (isOutcomeUnknown(error)) {
            const operation = error instanceof BffError ? error.operationId ?? "" : "";
            toast(t("moderation.report.unknown", { operation }));
          } else {
            toast.error(t("moderation.report.failed"));
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="report-message-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" />
            {t("moderation.report.title")}
          </DialogTitle>
          <DialogDescription>{t("moderation.report.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {REPORT_CATEGORIES.map((item) => (
            <Button
              key={item.value}
              variant={category === item.value ? "default" : "outline"}
              className="justify-start"
              data-testid={`report-category-${item.value}`}
              disabled={submitReport.isPending}
              onClick={() => setCategory(item.value)}
              type="button"
            >
              {t(item.label)}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <label htmlFor="report-note" className="text-sm font-medium text-muted-foreground">
            {t("moderation.report.noteLabel")}
          </label>
          <Textarea
            id="report-note"
            placeholder={t("moderation.report.notePlaceholder")}
            value={note}
            maxLength={REPORT_NOTE_MAX_CHARS}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitReport.isPending} type="button">
            {t("platform.cancel")}
          </Button>
          <Button variant="default" onClick={submit} disabled={!category || submitReport.isPending}
            data-testid="report-submit" type="button">
            {t("moderation.report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
