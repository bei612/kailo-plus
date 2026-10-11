import { useUiT } from "../../context";
import { isOutcomeUnknown } from "../../../transport";
import { CalendarClock, Clock, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useReminderMutations } from "../hooks";
import {
  parseCustomDateTime,
  TIME_PRESETS,
  todayDateString,
} from "../lib/timePresets";
import type { ReminderTarget } from "../lib/reminderTypes";
import { useReminderHost } from "../host";
import { Button } from "../../profile/buzz/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../composer/shared/ui/dialog";
import { Input } from "../../composer/shared/ui/input";
import { Textarea } from "../../profile/buzz/shared/ui/textarea";

export function RemindMeLaterDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ReminderTarget | null;
}) {
  const t = useUiT();
  const pubkey = useReminderHost().pubkey;
  const { create } = useReminderMutations(pubkey);
  const [note, setNote] = React.useState("");
  const [customDate, setCustomDate] = React.useState(todayDateString);
  const [customTime, setCustomTime] = React.useState("09:00");
  const customTimestamp = parseCustomDateTime(customDate, customTime);

  const submit = (notBefore: number) => {
    if (!target || create.isPending) return;
    create.mutate(
      { target, notBefore, note: note || undefined },
      {
        onSuccess: () => {
          toast.success(t("reminders.created"));
          onOpenChange(false);
          setNote("");
        },
        onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.createFailed")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("reminders.remindLater")}
          </DialogTitle>
          <DialogDescription>
            {t("reminders.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {TIME_PRESETS.map((preset) => (
            <Button
              key={t(preset.label)}
              variant="outline"
              className="justify-start"
              disabled={create.isPending}
              onClick={() => submit(preset.getTimestamp())}
            >
              {t(preset.label)}
            </Button>
          ))}
        </div>

        <div className="space-y-3 border-t pt-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4" />
            {t("reminders.customDate")}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={t("reminders.date")}
              className="flex-1"
              min={todayDateString()}
              onChange={(e) => setCustomDate(e.target.value)}
              type="date"
              value={customDate}
            />
            <Input
              aria-label={t("reminders.time")}
              className="w-[120px]"
              onChange={(e) => setCustomTime(e.target.value)}
              type="time"
              value={customTime}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="reminder-note"
            className="text-sm font-medium text-muted-foreground"
          >
            {t("reminders.noteOptional")}
          </label>
          <Textarea
            id="reminder-note"
            placeholder={t("reminders.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t("reminders.cancel")}
          </Button>
          <Button
            className="relative"
            disabled={create.isPending || customTimestamp === null}
            onClick={() => {
              if (customTimestamp === null) return;
              submit(customTimestamp);
            }}
            variant="default"
          >
            {/* The hidden label keeps the button width stable while the
                spinner overlays it. */}
            <span className={create.isPending ? "invisible" : undefined}>
              {t("reminders.set")}
            </span>
            {create.isPending ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="animate-spin" />
              </span>
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
