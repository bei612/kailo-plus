import type { Reminder } from "./reminderTypes";

type InboxItem = { id: string; item: { id: string }; groupItems: readonly { id: string }[]; conversationId: string; latestActivityAt: number };

export type InboxListRow<T extends InboxItem> =
  | {
      key: string;
      kind: "inbox";
      item: T;
      dueReminder?: Reminder;
      sortAt: number;
    }
  | {
      key: string;
      kind: "reminder";
      reminder: Reminder;
      sortAt: number;
    };

export function buildInboxListRows<T extends InboxItem>({
  items,
  reminders,
}: {
  items: readonly T[];
  reminders: readonly Reminder[];
}): InboxListRow<T>[] {
  const consumedReminderIds = new Set<string>();
  const inboxRows = items.map((item): InboxListRow<T> => {
    const eventIds = new Set([
      item.id,
      item.item.id,
      ...item.groupItems.map((groupItem) => groupItem.id),
    ]);
    const matchingReminders = reminders
      .filter(
        (reminder) =>
          reminder.content.status === "pending" &&
          Boolean(
            reminder.content.target?.eventId &&
              eventIds.has(reminder.content.target.eventId),
          ),
      )
      .sort(
        (left, right) =>
          (right.notBefore ?? right.createdAt) -
          (left.notBefore ?? left.createdAt),
      );
    const dueReminder = matchingReminders[0];

    for (const reminder of matchingReminders) {
      consumedReminderIds.add(reminder.id);
    }

    return {
      key: `inbox:${item.conversationId}`,
      kind: "inbox",
      item,
      dueReminder,
      sortAt: Math.max(
        item.latestActivityAt,
        dueReminder?.notBefore ?? dueReminder?.createdAt ?? 0,
      ),
    };
  });

  return [
    ...inboxRows,
    ...reminders
      .filter(
        (reminder) =>
          reminder.content.status === "pending" &&
          !consumedReminderIds.has(reminder.id),
      )
      .map(
        (reminder): InboxListRow<T> => ({
          key: `reminder:${reminder.id}`,
          kind: "reminder",
          reminder,
          sortAt: reminder.notBefore ?? reminder.createdAt,
        }),
      ),
  ].sort((left, right) => right.sortAt - left.sortAt);
}
