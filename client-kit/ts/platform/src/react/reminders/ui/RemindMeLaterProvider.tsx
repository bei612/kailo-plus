import * as React from "react";

import { useRemindersQuery } from "../hooks";
import { countDue } from "../lib/reminderFilters";
import type { ReminderTarget } from "../lib/reminderTypes";
import { RemindMeLaterDialog } from "./RemindMeLaterDialog";

type RemindMeLaterContextValue = {
  available: boolean;
  reminderCount: number;
  dueReminderCount: number;
  openReminder: (target: ReminderTarget) => void;
  /** Event IDs of messages with a pending reminder, for channel tinting. */
  activeReminderEventIds: ReadonlySet<string>;
};

const RemindMeLaterContext = React.createContext<RemindMeLaterContextValue>({
  available: false,
  reminderCount: 0,
  dueReminderCount: 0,
  openReminder: () => {},
  activeReminderEventIds: new Set(),
});

export function useRemindLater() {
  return React.useContext(RemindMeLaterContext);
}

export function RemindMeLaterProvider({
  pubkey,
  children,
}: {
  pubkey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<ReminderTarget | null>(null);

  const openReminder = React.useCallback((t: ReminderTarget) => {
    setTarget(t);
    setOpen(true);
  }, []);

  const remindersQuery = useRemindersQuery(pubkey);
  const reminders = remindersQuery.data;
  const activeReminderEventIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const reminder of reminders ?? []) {
      if (
        reminder.content.status === "pending" &&
        reminder.content.target?.eventId
      ) {
        ids.add(reminder.content.target.eventId);
      }
    }
    return ids;
  }, [reminders]);

  const contextValue = React.useMemo(
    () => ({ openReminder, activeReminderEventIds, available: Boolean(pubkey), reminderCount: reminders?.length ?? 0, dueReminderCount: countDue(reminders ?? []) }),
    [openReminder, activeReminderEventIds, pubkey, reminders],
  );

  return (
    <RemindMeLaterContext.Provider value={contextValue}>
      {children}
      <RemindMeLaterDialog open={open} onOpenChange={setOpen} target={target} />
    </RemindMeLaterContext.Provider>
  );
}
