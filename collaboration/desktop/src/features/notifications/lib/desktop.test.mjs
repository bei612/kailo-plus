import assert from "node:assert/strict";
import test from "node:test";

const notifications = [];

class WorkingNotification {
  static permission = "granted";

  constructor(title, options) {
    notifications.push({ title, options });
  }

  close() {}
}

class ThrowingNotification {
  static permission = "granted";

  constructor() {
    throw new Error("notification backend unavailable");
  }
}

globalThis.window = { Notification: ThrowingNotification };

const { sendDesktopNotification } = await import("./desktop.ts");

test("constructor failure is a delivery miss and does not prevent a later notification", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));

  const failed = await sendDesktopNotification({ title: "First" });

  assert.equal(failed, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /notification backend unavailable/);

  window.Notification = WorkingNotification;

  const delivered = await sendDesktopNotification({
    title: "Second",
    body: "Recovered",
  });

  assert.equal(delivered, true);
  assert.deepEqual(notifications, [
    {
      title: "Second",
      options: { body: "Recovered", silent: true, extra: undefined },
    },
  ]);
});

test("does not send a reminder when identity changes during permission lookup", async () => {
  window.Notification = WorkingNotification;
  const count = notifications.length;
  let active = true;
  const result = sendDesktopNotification({ title: "Private reminder", body: "Private preview" }, () => active);
  active = false;
  assert.equal(await result, false);
  assert.equal(notifications.length, count);
  assert.equal(await sendDesktopNotification({ title: "Current reminder" }, () => true), true);
  assert.equal(notifications.length, count + 1);
});

// DD-138(4), 07 §4.8.3: the component notification target survives the native round trip.
test("parses a component notification application target without a channel anchor", async () => {
  const { parseNotificationTarget } = await import("./desktop.ts");
  const parsed = parseNotificationTarget({ channelId: null, eventId: null, kind: null,
    application: { notificationId: "n-1", bindingId: "b-1", path: "/files/a", extra: "ignored" } });
  assert.deepEqual(parsed?.application, { notificationId: "n-1", bindingId: "b-1", workspaceId: undefined, path: "/files/a" });
  assert.equal(parseNotificationTarget({ channelId: null, eventId: null, application: { bindingId: "b-1", path: "/x" } }), null);
});
