import assert from "node:assert/strict";
import test from "node:test";

import {
  ReadStateManager,
  resolveEffectiveTimestamp,
} from "./readStateManager.ts";

// ── ReadStateManager integration helpers ─────────────────────────────────────
// Provide browser globals required by ReadStateManager (localStorage,
// window.setTimeout/clearTimeout). Each test that uses ReadStateManager
// constructs a fresh in-memory store so tests are isolated.

function makeLocalStorage() {
  const store = new Map();
  const writes = [];
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      store.set(key, value);
    },
    removeItem: (key) => store.delete(key),
    writes,
  };
}

function makeFakeTimers() {
  let nextId = 1;
  let now = 0;
  const timers = new Map();

  function runThrough(targetTime) {
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= targetTime)
        .sort(
          ([firstId, first], [secondId, second]) =>
            first.dueAt - second.dueAt || firstId - secondId,
        )[0];
      if (!next) break;

      const [id, timer] = next;
      timers.delete(id);
      now = timer.dueAt;
      timer.fn();
    }
    now = targetTime;
  }

  return {
    setTimeout(fn, delay = 0) {
      const id = nextId++;
      timers.set(id, { fn, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advanceBy(ms) {
      runThrough(now + ms);
    },
    runAll() {
      while (timers.size > 0) {
        const nextDueAt = Math.min(
          ...[...timers.values()].map((timer) => timer.dueAt),
        );
        runThrough(nextDueAt);
      }
    },
    get size() {
      return timers.size;
    },
  };
}

// Install browser globals required by ReadStateManager. window.localStorage is
// replaced per-test for isolation; the bare `localStorage` global proxies to it.
{
  const ls = makeLocalStorage();
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  globalThis.window = {
    localStorage: ls,
    clearTimeout: (id) => clearTimeout(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    addEventListener: (...args) => windowEvents.addEventListener(...args),
    removeEventListener: (...args) => windowEvents.removeEventListener(...args),
    dispatchEvent: (...args) => windowEvents.dispatchEvent(...args),
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (...args) => documentEvents.addEventListener(...args),
    removeEventListener: (...args) =>
      documentEvents.removeEventListener(...args),
    dispatchEvent: (...args) => documentEvents.dispatchEvent(...args),
  };
  // Ensure bare `localStorage` always proxies to window.localStorage.
  Object.defineProperty(globalThis, "localStorage", {
    get: () => globalThis.window.localStorage,
    configurable: true,
  });
}

const threadKey = `thread:${"a".repeat(64)}`;
const channelKey = "channel-1";
const channelResolver = (ctx) =>
  ctx.startsWith("thread:") ? channelKey : null;

// ── ReadStateManager local persistence ────────────────────────────────────────

function withFakeTimers() {
  const timers = makeFakeTimers();
  const originalSetTimeout = globalThis.window.setTimeout;
  const originalClearTimeout = globalThis.window.clearTimeout;
  globalThis.window.setTimeout = (fn, ms) => timers.setTimeout(fn, ms);
  globalThis.window.clearTimeout = (id) => timers.clearTimeout(id);
  return {
    timers,
    restore() {
      globalThis.window.setTimeout = originalSetTimeout;
      globalThis.window.clearTimeout = originalClearTimeout;
    },
  };
}

test("advanceContext burst coalesces local persistence into one write", () => {
  const storage = makeLocalStorage();
  globalThis.window.localStorage = storage;
  const { timers, restore } = withFakeTimers();
  const manager = new ReadStateManager("1".repeat(64));
  const baselineWrites = storage.writes.length;

  try {
    manager.markContextRead("channel-1", 100);
    manager.markContextRead("channel-2", 200);
    manager.markContextRead("channel-3", 300);

    assert.equal(timers.size, 1, "burst should leave one trailing timer");
    assert.equal(storage.writes.length, baselineWrites);

    timers.runAll();
    assert.equal(
      storage.writes.length - baselineWrites,
      1,
      "one writeStoredReadState call writes the read-state blob once",
    );
  } finally {
    manager.destroy();
    restore();
  }
});

test("sustained advances persist within each one-second window", () => {
  const storage = makeLocalStorage();
  globalThis.window.localStorage = storage;
  const { timers, restore } = withFakeTimers();
  const manager = new ReadStateManager("5".repeat(64));
  const baselineWrites = storage.writes.length;

  try {
    manager.markContextRead("channel-1", 100);

    for (let timestamp = 200; timestamp <= 3_200; timestamp += 200) {
      timers.advanceBy(200);
      manager.markContextRead("channel-1", timestamp);

      if (timestamp % 1_000 === 0) {
        assert.equal(
          storage.writes.length - baselineWrites,
          timestamp / 1_000,
          "latest state should persist once per one-second window",
        );
      }
    }

    const contexts = JSON.parse(
      storage.getItem(`buzz.channel-read-state.v2:${"5".repeat(64)}`),
    );
    assert.equal(contexts["channel-1"], new Date(2_800_000).toISOString());
    assert.equal(timers.size, 1, "latest advance should open the next window");
  } finally {
    manager.destroy();
    restore();
  }
});

test("visibility hidden flushes pending local state", () => {
  const storage = makeLocalStorage();
  globalThis.window.localStorage = storage;
  const { timers, restore } = withFakeTimers();
  const manager = new ReadStateManager("2".repeat(64));
  const baselineWrites = storage.writes.length;

  try {
    manager.markContextRead("channel-1", 100);
    assert.equal(storage.writes.length, baselineWrites);

    globalThis.document.visibilityState = "hidden";
    globalThis.document.dispatchEvent(new Event("visibilitychange"));

    assert.equal(timers.size, 0, "flush should cancel the trailing timer");
    assert.equal(storage.writes.length - baselineWrites, 1);
    const contexts = JSON.parse(
      storage.getItem(`buzz.channel-read-state.v2:${"2".repeat(64)}`),
    );
    assert.equal(contexts["channel-1"], new Date(100_000).toISOString());
  } finally {
    globalThis.document.visibilityState = "visible";
    manager.destroy();
    restore();
  }
});

test("construction hydrates from local storage and persists immediately", () => {
  const storage = makeLocalStorage();
  const pubkey = "3".repeat(64);
  storage.setItem(
    `buzz.channel-read-state.v2:${pubkey}`,
    JSON.stringify({ "channel-1": new Date(100_000).toISOString() }),
  );
  globalThis.window.localStorage = storage;
  const { timers, restore } = withFakeTimers();
  const baselineWrites = storage.writes.length;
  const manager = new ReadStateManager(pubkey);

  try {
    assert.equal(timers.size, 0);
    assert.equal(storage.writes.length - baselineWrites, 1);
    assert.equal(manager.getOwnTimestamp("channel-1"), 100);
  } finally {
    manager.destroy();
    restore();
  }
});

test("markContextRead never moves a marker backwards", () => {
  const storage = makeLocalStorage();
  globalThis.window.localStorage = storage;
  const { restore } = withFakeTimers();
  const manager = new ReadStateManager("7".repeat(64));

  try {
    manager.markContextRead("channel-1", 200);
    manager.markContextRead("channel-1", 100);
    assert.equal(manager.getOwnTimestamp("channel-1"), 200);
  } finally {
    manager.destroy();
    restore();
  }
});

test("destroy flushes pending local state and stops persisting", () => {
  const storage = makeLocalStorage();
  globalThis.window.localStorage = storage;
  const { timers, restore } = withFakeTimers();
  const pubkey = "6".repeat(64);
  const manager = new ReadStateManager(pubkey);

  try {
    manager.markContextRead("channel-1", 100);
    manager.destroy();
    const writesAfterDestroy = storage.writes.length;

    manager.markContextRead("channel-1", 200);
    timers.runAll();

    assert.equal(storage.writes.length, writesAfterDestroy);
    const contexts = JSON.parse(
      storage.getItem(`buzz.channel-read-state.v2:${pubkey}`),
    );
    assert.equal(contexts["channel-1"], new Date(100_000).toISOString());
  } finally {
    restore();
  }
});

test("resolveEffectiveTimestamp returns own value when context has no parent", () => {
  const effectiveState = new Map([[channelKey, 200]]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: channelKey,
    parentResolver: channelResolver,
  });
  assert.equal(result, 200);
});

test("resolveEffectiveTimestamp inherits the channel frontier when it is newer than the thread", () => {
  // Channel-read clears its threads: marking the channel read at 300 must
  // dominate a thread last read at 100.
  const effectiveState = new Map([
    [threadKey, 100],
    [channelKey, 300],
  ]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: threadKey,
    parentResolver: channelResolver,
  });
  assert.equal(result, 300);
});

test("resolveEffectiveTimestamp keeps the thread frontier when it is newer than the channel", () => {
  const effectiveState = new Map([
    [threadKey, 400],
    [channelKey, 300],
  ]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: threadKey,
    parentResolver: channelResolver,
  });
  assert.equal(result, 400);
});

test("resolveEffectiveTimestamp returns the channel frontier when the thread was never read", () => {
  const effectiveState = new Map([[channelKey, 300]]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: threadKey,
    parentResolver: channelResolver,
  });
  assert.equal(result, 300);
});

test("resolveEffectiveTimestamp degrades to the thread's own value when the root is unresolvable", () => {
  // Resolver returns null (root not in the event graph) → own term only.
  const effectiveState = new Map([
    [threadKey, 100],
    [channelKey, 300],
  ]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: threadKey,
    parentResolver: () => null,
  });
  assert.equal(result, 100);
});

test("resolveEffectiveTimestamp degrades to own value when no resolver is set", () => {
  const effectiveState = new Map([
    [threadKey, 100],
    [channelKey, 300],
  ]);
  const result = resolveEffectiveTimestamp({
    effectiveState,
    contextId: threadKey,
    parentResolver: null,
  });
  assert.equal(result, 100);
});

test("resolveEffectiveTimestamp returns null when neither context nor parent has a value", () => {
  const result = resolveEffectiveTimestamp({
    effectiveState: new Map(),
    contextId: threadKey,
    parentResolver: channelResolver,
  });
  assert.equal(result, null);
});
