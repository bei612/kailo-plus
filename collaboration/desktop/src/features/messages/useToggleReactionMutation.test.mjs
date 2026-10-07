import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the actual mutation hook with controlled hook state and transport;
// this isolates publish lifecycle from unrelated channel hydration/Tauri APIs.
const source = ts.createSourceFile("hooks.ts", readFileSync(new URL("./hooks.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useToggleReactionMutation");
assert.ok(declaration);
const javascript = ts.transpile(declaration.getText(source).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });

function harness() {
  let ref;
  let cleanup;
  let options;
  let publish = async () => ({ id: "signed", pubkey: "actor", kind: 7 });
  let calls = 0;
  const invalidations = [];
  class TransportError extends Error {}
  const hook = new Function("useRef", "useEffect", "useMutation", "useQueryClient", "useActiveCommunity", "addReaction", "removeReaction", "TransportError", "classifyRelayPublishFailure", "channelMessagesKey", `${javascript}; return useToggleReactionMutation;`)(
    value => ref ??= { current: value },
    effect => { cleanup ??= effect(); },
    value => { options = value; return value; },
    () => ({ invalidateQueries: value => { invalidations.push(value.queryKey); return Promise.resolve(); } }),
    () => ({ relayUrl: "relay" }),
    async (...args) => { calls++; return publish(...args); },
    async (...args) => { calls++; return publish(...args); },
    TransportError,
    error => error instanceof TransportError ? { kind: "outcomeUnknown" } : null,
    id => ["channel-messages", id],
  );
  const channel = { id: "channel", isMember: true, archivedAt: null };
  return {
    render: value => hook(value ?? channel, "actor"),
    setPublish: value => { publish = value; },
    unmount: () => cleanup(),
    get options() { return options; },
    get calls() { return calls; },
    invalidations,
  };
}
const input = { eventId: "event", emoji: "😀", remove: false };

test("confirmed reaction refreshes channel, thread and Inbox without mutation retry", async () => {
  const h = harness(); h.render();
  assert.equal(h.options.retry, false);
  await h.options.mutationFn(input);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.invalidations, [["channel-messages", "channel"], ["thread-replies", "channel"], ["inbox-reactions", "channel"]]);
});

test("missing signed receipt stays UNKNOWN without refresh or replay", async () => {
  const h = harness(); h.render(); h.setPublish(async () => ({}));
  await assert.rejects(h.options.mutationFn(input), /outcome unknown/);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.invalidations, []);
});

for (const boundary of ["scope", "unmount"]) {
  test(`late receipt after ${boundary} does not report success or refresh a new view`, async () => {
    const h = harness(); h.render();
    let resolve;
    h.setPublish(() => new Promise(done => { resolve = done; }));
    const pending = h.options.mutationFn(input);
    if (boundary === "scope") h.render({ id: "other", isMember: true, archivedAt: null });
    else h.unmount();
    resolve({ id: "signed", pubkey: "actor", kind: 7 });
    await assert.rejects(pending, /outcome unknown/);
    assert.deepEqual(h.invalidations, []);
    assert.equal(h.calls, 1);
  });
}

test("archived channel never dispatches a reaction", async () => {
  const h = harness(); h.render({ id: "channel", isMember: true, archivedAt: "archived" });
  await assert.rejects(h.options.mutationFn(input), /scope is not available/);
  assert.equal(h.calls, 0);
});
