// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewMessagePage } from "./NewMessagePage";
import type { ConversationView } from "@client-kit/contracts";

const state = vi.hoisted(() => ({ prepare: vi.fn(), publish: vi.fn(), submit: null as null | (() => Promise<unknown>) }));
vi.mock("@client-kit/platform/react/new-message", () => ({
  NewMessageScreen: ({renderComposer}: {renderComposer: (host: unknown) => unknown}) =>
    renderComposer({disabled: false, placeholder: "Message", prepareConversation: state.prepare}),
}));
vi.mock("./ChannelPane", () => ({
  Composer: ({onPublish}: {onPublish: (content: string, attachments: [], key: string) => Promise<unknown>}) => {
    state.submit = () => onPublish("confirmed message", [], "unchanged-intent");
    return null;
  },
}));
vi.mock("../bff-client", () => ({ publishConversationMessage: state.publish, uploadConversationMedia: vi.fn() }));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null;
let host: HTMLDivElement;
const conversation = {id: "conversation", channelId: "native-channel", state: "ACTIVE", participantPrincipalIds: ["alice", "bob"], operationId: "operation", version: 1};
const receipt = {eventId: "accepted-event", operationId: "operation"};
beforeEach(() => {
  state.prepare.mockReset().mockResolvedValue(conversation);
  state.publish.mockReset().mockResolvedValue(receipt);
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host.remove(); });
async function mount(principal: string, open: (conversation: ConversationView) => void | Promise<void>) {
  await act(async () => { root!.render(<NewMessagePage currentPrincipalId={principal} onConversationOpened={open} />); });
}
it("keeps the accepted publish receipt when navigation fails; retry only opens the conversation", async () => {
  const open = vi.fn().mockRejectedValueOnce(new Error("navigation unavailable")).mockResolvedValue(undefined);
  await mount("alice", open);
  await act(async () => { expect(await state.submit!()).toEqual(receipt); });
  expect(host.textContent).toContain("Message sent.");
  expect(state.publish).toHaveBeenCalledOnce();
  await act(async () => { host.querySelector("button")!.click(); });
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.publish).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("could not be opened");
});
it("does not navigate a new identity after an old confirmed send completes", async () => {
  let complete!: (value: typeof receipt) => void;
  state.publish.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  const open = vi.fn();
  await mount("alice", open);
  let sending!: Promise<unknown>;
  await act(async () => { sending = state.submit!(); });
  await mount("bob", open);
  await act(async () => { complete(receipt); expect(await sending).toEqual(receipt); });
  expect(open).not.toHaveBeenCalled();
});
it("does not navigate after leaving the compose page", async () => {
  let complete!: (value: typeof receipt) => void;
  state.publish.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  const open = vi.fn();
  await mount("alice", open);
  let sending!: Promise<unknown>;
  await act(async () => { sending = state.submit!(); });
  await act(async () => { root!.unmount(); root = null; });
  await act(async () => { complete(receipt); expect(await sending).toEqual(receipt); });
  expect(open).not.toHaveBeenCalled();
});
it("does not publish when admission finishes after the compose owner has left", async () => {
  let prepared!: (value: typeof conversation) => void;
  state.prepare.mockReturnValueOnce(new Promise((resolve) => { prepared = resolve; }));
  const open = vi.fn();
  await mount("alice", open);
  let sending!: Promise<unknown>;
  await act(async () => { sending = state.submit!(); });
  await act(async () => { root!.unmount(); root = null; });
  await act(async () => { prepared(conversation); await expect(sending).rejects.toThrow("no longer active"); });
  expect(state.publish).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
