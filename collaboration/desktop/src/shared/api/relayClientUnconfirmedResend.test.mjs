// 发送结果的确定分类与「结果不明时原样重发同一个已签名事件」（WebSocket 路径）。
//
// Relay 按事件 id 去重（buzz-db `store/event.rs` 的 ON CONFLICT DO NOTHING，
// buzz-relay `handlers/ingest.rs` 的 `duplicate:`）；重新签名会得到新 id，那才会
// 出现第二条消息。
import assert from "node:assert/strict";
import test from "node:test";

const pendingTimers = new Map();
let nextTimerId = 1;
const deliveredFrames = [];
let signCounter = 0;

globalThis.window = {
  setTimeout: (fn, ms) => {
    const id = nextTimerId++;
    pendingTimers.set(id, { fn, ms });
    return id;
  },
  clearTimeout: (id) => pendingTimers.delete(id),
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      if (command === "sign_event") {
        signCounter += 1;
        return JSON.stringify({
          id: `event-${signCounter}`.padEnd(64, "0"),
          pubkey: "f".repeat(64),
          created_at: 1_700_000_000 + signCounter,
          kind: args.kind,
          tags: args.tags,
          content: args.content,
          sig: `sig-${signCounter}`,
        });
      }
      if (command === "plugin:websocket|send") {
        deliveredFrames.push(JSON.parse(args.message.data));
        return undefined;
      }
      return undefined;
    },
  },
};

const { RelayClient } = await import("./relayClientSession.ts");
const {
  RelayPublishNotSentError,
  RelayPublishRejectedError,
  RelayPublishUnknownError,
  classifyRelayPublishFailure,
} = await import("./relayPublishOutcome.ts");
const { resetRateLimitGate } = await import("./relayRateLimitGate.ts");

function reset() {
  resetRateLimitGate();
  pendingTimers.clear();
  deliveredFrames.length = 0;
}

function connectedClient() {
  const client = new RelayClient();
  client.wsId = 7;
  return client;
}

async function flushUntil(predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition did not become true");
}

function publishedEvents() {
  return deliveredFrames.filter((f) => f[0] === "EVENT").map((f) => f[1]);
}

function settle(promise) {
  return promise.then(
    (value) => ({ status: "resolved", value }),
    (error) => ({ status: "rejected", error }),
  );
}

async function sendAndAwaitFrame(client, content, count) {
  const outcome = settle(client.sendMessage("channel-1", content));
  await flushUntil(() => publishedEvents().length === count);
  // 包一层：async 函数直接返回 Promise 会被展开，等到发布结束才返回
  return { outcome };
}

function deliver(client, frame) {
  return client.handleWsMessage(
    { type: "Text", data: JSON.stringify(frame) },
    client.connectionGeneration,
  );
}

function firePublishTimeout() {
  for (const [id, timer] of pendingTimers) {
    if (timer.ms === 25_000) {
      pendingTimers.delete(id);
      timer.fn();
    }
  }
}

test("OK false is a definite rejection; rate-limited carries its hint", async () => {
  reset();
  const client = connectedClient();
  let { outcome } = await sendAndAwaitFrame(client, "no", 1);
  await deliver(client, [
    "OK",
    publishedEvents()[0].id,
    false,
    "restricted: not a channel member",
  ]);
  let settled = await outcome;
  assert.ok(settled.error instanceof RelayPublishRejectedError);
  assert.deepEqual(classifyRelayPublishFailure(settled.error), {
    kind: "rejected",
  });

  ({ outcome } = await sendAndAwaitFrame(client, "slow", 2));
  await deliver(client, [
    "OK",
    publishedEvents()[1].id,
    false,
    "rate-limited: quota exceeded; retry in 6s",
  ]);
  settled = await outcome;
  assert.deepEqual(classifyRelayPublishFailure(settled.error), {
    kind: "rateLimited",
    retryAfterSeconds: 6,
  });
});

test("an unanswered publish is unknown and is resent as the same event", async () => {
  reset();
  const client = connectedClient();
  client.ensureConnected = async () => {
    client.relayUrl = "wss://resolved-relay.test";
  };
  const { outcome: first } = await sendAndAwaitFrame(client, "hello", 1);
  firePublishTimeout();
  const firstOutcome = await first;
  assert.ok(firstOutcome.error instanceof RelayPublishUnknownError);
  assert.deepEqual(classifyRelayPublishFailure(firstOutcome.error), {
    kind: "outcomeUnknown",
  });

  const { outcome: second } = await sendAndAwaitFrame(client, "hello", 2);
  const [original, resent] = publishedEvents();
  assert.equal(resent.id, original.id, "重发必须是同一个已签名事件");
  assert.equal(resent.sig, original.sig);
  await deliver(client, ["OK", resent.id, true, "duplicate:"]);
  assert.equal((await second).status, "resolved");

  // 确认接受后记录清除：同样的正文是一条新消息
  const { outcome: third } = await sendAndAwaitFrame(client, "hello", 3);
  assert.notEqual(publishedEvents()[2].id, original.id);
  await deliver(client, ["OK", publishedEvents()[2].id, true, ""]);
  assert.equal((await third).status, "resolved");
});

test("a disconnect while awaiting OK stays unknown through a refused resend", async () => {
  reset();
  const client = connectedClient();
  const { outcome: first } = await sendAndAwaitFrame(client, "after revoke", 1);
  client.resetConnection(new Error("Relay connection closed."), {
    reconnect: false,
  });
  const firstOutcome = await first;
  assert.ok(firstOutcome.error instanceof RelayPublishUnknownError);

  // 模拟重连成功（真实重连由 connect() 建立新的 socket）
  client.terminal = false;
  client.wsId = 8;
  const { outcome: second } = await sendAndAwaitFrame(
    client,
    "after revoke",
    2,
  );
  const [original, resent] = publishedEvents();
  assert.equal(resent.id, original.id);
  await deliver(client, [
    "OK",
    resent.id,
    false,
    "restricted: not a channel member",
  ]);
  const secondOutcome = await second;
  assert.deepEqual(
    classifyRelayPublishFailure(secondOutcome.error),
    { kind: "outcomeUnknown" },
    "撤权后本次拒绝不能证明首次未存储",
  );
  client.ensureConnected = async () => {
    throw new Error("offline");
  };
  const offline = await settle(client.sendMessage("channel-1", "after revoke"));
  assert.equal(offline.error.eventId, original.id);
  assert.deepEqual(classifyRelayPublishFailure(offline.error), {
    kind: "outcomeUnknown",
  });
  client.ensureConnected = async () => {};
  const { outcome: third } = await sendAndAwaitFrame(client, "after revoke", 3);
  assert.equal(publishedEvents()[2].id, original.id);
  await deliver(client, ["OK", original.id, true, "duplicate:"]);
  assert.equal((await third).status, "resolved");
});

test("a different text is signed as a different event", async () => {
  reset();
  const client = connectedClient();
  const { outcome: first } = await sendAndAwaitFrame(client, "one", 1);
  firePublishTimeout();
  await first;
  const { outcome: second } = await sendAndAwaitFrame(client, "two", 2);
  assert.notEqual(publishedEvents()[1].id, publishedEvents()[0].id);
  await deliver(client, ["OK", publishedEvents()[1].id, true, ""]);
  await second;
});

test("a community switch forgets unconfirmed events", async () => {
  reset();
  const client = connectedClient();
  const { outcome: first } = await sendAndAwaitFrame(client, "switch", 1);
  firePublishTimeout();
  await first;
  client.disconnect();
  client.wsId = 9;
  const { outcome: second } = await sendAndAwaitFrame(client, "switch", 2);
  assert.notEqual(publishedEvents()[1].id, publishedEvents()[0].id);
  await deliver(client, ["OK", publishedEvents()[1].id, true, ""]);
  await second;
});

test("a terminal session refuses before signing: definitely not sent", async () => {
  reset();
  const client = new RelayClient();
  client.terminal = true;
  const outcome = await settle(client.sendMessage("channel-1", "never"));
  assert.ok(outcome.error instanceof RelayPublishNotSentError);
  assert.equal(publishedEvents().length, 0);
});
