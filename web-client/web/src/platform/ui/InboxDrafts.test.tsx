// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebMessageType } from "@client-kit/contracts";
import { draftMessageTarget, useInboxDrafts } from "./InboxDrafts";
import { initDraftStore, saveDraftEntry, loadDraftEntry, type DraftState } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

vi.mock("./ChannelPane", () => ({ChannelPane: () => null}));
vi.mock("./ForumPane", () => ({ForumPane: () => null}));
vi.mock("./InboxThreadPane", () => ({InboxThreadPane: () => null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const draft: DraftState = {content: "private draft", channelId: "scope", selectionStart: 0, selectionEnd: 0,
  createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", pendingImeta: [], spoileredAttachmentUrls: [], status: "active"};
let root: Root; let host: HTMLDivElement;
beforeEach(() => {localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); localStorage.clear();});
function Store({identity}: {identity: string}) {const store = useInboxDrafts(identity); return <><output>{store.entries.map((item) => item.draft.content).join("|")}</output><button onClick={() => store.remove("scope")}>delete</button></>;}
it("resolves only existing draft namespaces belonging to the stored destination", () => {
  const parent = "a".repeat(64);
  expect(draftMessageTarget({key: "scope", draft})).toEqual({messageType: WebMessageType.Stream});
  expect(draftMessageTarget({key: `thread:scope:${parent}`, draft})).toEqual({messageType: WebMessageType.Stream, parentEventId: parent});
  expect(draftMessageTarget({key: "forum:scope:post", draft})).toEqual({messageType: WebMessageType.ForumPost});
  expect(draftMessageTarget({key: `forum:scope:${parent}`, draft})).toEqual({messageType: WebMessageType.ForumComment, parentEventId: parent});
  expect(draftMessageTarget({key: `thread:other:${parent}`, draft})).toBeNull();
  expect(draftMessageTarget({key: "forum:scope:unknown", draft})).toBeNull();
});
it("uses the existing identity-and-origin draft store and never deletes UNKNOWN intent", async () => {
  initDraftStore("alice", window.location.origin); saveDraftEntry("scope", {...draft, sendIntent: {key: "retained", signature: "original"}});
  await act(async () => root.render(<Store identity="alice" />));
  expect(host.textContent).toContain("private draft");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(loadDraftEntry("scope")?.sendIntent?.key).toBe("retained");
  await act(async () => root.render(<Store identity="bob" />));
  expect(host.textContent).not.toContain("private draft");
  await act(async () => root.render(<Store identity="alice" />));
  expect(host.textContent).toContain("private draft");
});
