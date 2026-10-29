// DD-142: the message row's edit/delete entry (MessageRow → useManagedMessageActions) under the
// channel pane's owned-Agent scope. Owner sees it on its Agent's message in a Workspace channel;
// a non-owner and any private conversation do not.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { OwnedAgentMessageScopeProvider, useManagedMessageActions } from "./ownedAgentMessageScope.tsx";

const ME = "a".repeat(64);
const MY_AGENT = "b".repeat(64);
const OTHER_AGENT = "c".repeat(64);
const OTHER_PERSON = "d".repeat(64);

const message = (signer, extra = {}) => ({ id: signer.slice(0, 8), kind: 9, pubkey: signer, signerPubkey: signer, ...extra });
const onEdit = () => {};
const onDelete = () => {};

function Row({ row }) {
  const actions = useManagedMessageActions(row, ME, { onEdit, onDelete });
  return React.createElement("li", { "data-id": row.id },
    actions.onEdit ? React.createElement("button", null, "Edit") : null,
    actions.onDelete ? React.createElement("button", null, "Delete") : null);
}

async function render(channelType, ownedAgentPubkeys, rows) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(OwnedAgentMessageScopeProvider,
      { channelType, ownedAgentPubkeys }, rows.map((row) => React.createElement(Row, { key: row.id, row })))));
    return Object.fromEntries([...host.querySelectorAll("li")].map((li) =>
      [li.dataset.id, [...li.querySelectorAll("button")].map((button) => button.textContent)]));
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const name of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  }
}

const rows = [message(ME), message(MY_AGENT), message(OTHER_AGENT), message(OTHER_PERSON)];
const id = (signer) => signer.slice(0, 8);

test("the owner sees edit and delete on its own Agent's message in a Workspace channel", async () => {
  const shown = await render("stream", new Set([MY_AGENT]), rows);
  assert.deepEqual(shown[id(ME)], ["Edit", "Delete"]);
  assert.deepEqual(shown[id(MY_AGENT)], ["Edit", "Delete"]);
  assert.deepEqual(shown[id(OTHER_AGENT)], []);
  assert.deepEqual(shown[id(OTHER_PERSON)], []);
});

test("a non-owner sees no entry on an Agent's message", async () => {
  const shown = await render("stream", new Set(), rows);
  assert.deepEqual(shown[id(ME)], ["Edit", "Delete"]);
  assert.deepEqual(shown[id(MY_AGENT)], []);
  const unscoped = await render("stream", undefined, rows);
  assert.deepEqual(unscoped[id(MY_AGENT)], []);
});

test("a private conversation never offers another signer's message, even an owned Agent's", async () => {
  const shown = await render("dm", new Set([MY_AGENT]), rows);
  assert.deepEqual(shown[id(ME)], ["Edit", "Delete"]);
  assert.deepEqual(shown[id(MY_AGENT)], []);
});

test("pending and non-stream Agent messages are not offered", async () => {
  const shown = await render("stream", new Set([MY_AGENT]), [
    message(MY_AGENT, { id: "pending", pending: true }),
    message(MY_AGENT, { id: "system", kind: 40099 }),
  ]);
  assert.deepEqual(shown.pending, []);
  assert.deepEqual(shown.system, []);
});
