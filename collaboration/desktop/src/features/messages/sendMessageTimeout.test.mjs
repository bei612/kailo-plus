// DD-125(2): the production send mutation records a Relay timeout refusal for the shared
// composer banner and clears it on an accepted send (original features/messages/hooks.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the actual useSendMessageMutation callbacks with controlled collaborators; the
// send path itself (Tauri/Relay) is covered elsewhere and is not evaluated here.
const source = ts.createSourceFile("hooks.ts", readFileSync(new URL("./hooks.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useSendMessageMutation");
assert.ok(declaration);
const javascript = ts.transpile(declaration.getText(source).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });

function harness() {
  const calls = [];
  let options;
  const hook = new Function(
    "useQueryClient", "useMutation", "recordTimeoutFromRestriction", "publishRestrictionFromRelayFailure", "clearTimeoutState",
    `${javascript}; return useSendMessageMutation;`,
  )(
    () => ({ setQueryData: () => calls.push("setQueryData") }),
    (value) => { options = value; return value; },
    (restriction) => { calls.push(["record", restriction]); return Boolean(restriction); },
    (error) => { calls.push(["map", error.message]); return error.message.includes("timed out") ? { kind: "TIMED_OUT" } : undefined; },
    () => calls.push("clear"),
  );
  hook({ id: "channel" }, { pubkey: "actor" });
  return { calls, get options() { return options; } };
}

test("a refused send is mapped and recorded for the composer timeout banner", () => {
  const h = harness();
  h.options.onError(new Error("relay rejected event: restricted: you are timed out until 1760000000"), {}, undefined);
  assert.deepEqual(h.calls, [
    ["map", "relay rejected event: restricted: you are timed out until 1760000000"],
    ["record", { kind: "TIMED_OUT" }],
  ]);
});

test("every other failure passes through the same mapping and records nothing", () => {
  const h = harness();
  h.options.onError(new Error("relay rejected event: invalid"), {}, undefined);
  assert.deepEqual(h.calls, [["map", "relay rejected event: invalid"], ["record", undefined]]);
});

test("an accepted send clears the recorded timeout before reconciling the timeline", () => {
  const h = harness();
  h.options.onSuccess({ id: "event" }, {}, undefined);
  assert.deepEqual(h.calls, ["clear"]);
});
