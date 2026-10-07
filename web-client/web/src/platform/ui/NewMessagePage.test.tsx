// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewMessagePage } from "./NewMessagePage";
import type { ConversationView } from "@client-kit/contracts";
import { setLocale } from "@client-kit/platform/i18n";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { TransportError } from "@client-kit/platform/transport";
import type { ConversationParticipant } from "@client-kit/contracts";

const state = vi.hoisted(() => ({ prepare: vi.fn(), publish: vi.fn(), submit: null as null | (() => Promise<unknown>),
  realComposer: false, realBff: false, recipients: [] as ConversationParticipant[] }));
vi.mock("@client-kit/platform/react/new-message", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/new-message")>(),
  NewMessageScreen: ({renderComposer}: {renderComposer: (host: unknown) => unknown}) =>
    renderComposer({disabled: false, placeholder: "Message", recipients: state.recipients, prepareConversation: state.prepare}),
}));
vi.mock("./ChannelPane", async (original) => {
  const actual = await original<typeof import("./ChannelPane")>();
  return {...actual, Composer: (props: ComponentProps<typeof actual.Composer>) => {
    if (state.realComposer) return <actual.Composer {...props} />;
    state.submit = () => props.onPublish!("confirmed message", [], "unchanged-intent", [], []);
    return null;
  }};
});
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({data: {pages: []}, isSuccess: true, isPending: false, isError: false}),
  useMutation: vi.fn(), useQuery: vi.fn(() => ({data: undefined, isError: false})), useQueryClient: vi.fn(),
}));
vi.mock("../bff-client", async (original) => {
  const actual = await original<typeof import("../bff-client")>();
  return {...actual, bff: {}, fetchUserState: vi.fn(), uploadConversationMedia: vi.fn(),
    publishConversationMessage: (...args: Parameters<typeof actual.publishConversationMessage>) =>
      state.realBff ? actual.publishConversationMessage(...args) : state.publish(...args),
  };
});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null;
let host: HTMLDivElement;
const conversation = {id: "conversation", channelId: "native-channel", state: "ACTIVE", participantPrincipalIds: ["alice", "bob"], operationId: "operation", version: 1};
const receipt = {eventId: "accepted-event", operationId: "operation"};
beforeEach(() => {
  // jsdom supplies no layout for the original rich editor's selection range.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => Object.assign([], {item: () => null});
  setLocale("en");
  state.prepare.mockReset().mockResolvedValue(conversation);
  state.publish.mockReset().mockResolvedValue(receipt);
  state.realComposer = false;
  state.realBff = false;
  state.recipients = [{principalId: "bob", displayName: "Bob", pubkeys: ["b".repeat(64)]}];
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host.remove(); vi.unstubAllGlobals(); });
async function mount(principal: string, open: (conversation: ConversationView) => void | Promise<void>) {
  await act(async () => { root!.render(<TooltipProvider><NewMessagePage currentPrincipalId={principal} onConversationOpened={open} /></TooltipProvider>); });
}
it.each([
  ["en", "Message sent. The conversation could not be opened.", "Open conversation"],
  ["zh-CN", "消息已发送，但未能打开会话。", "打开会话"],
] as const)("keeps the accepted publish receipt and localized navigation feedback in %s; retry only opens the conversation", async (locale, message, button) => {
  setLocale(locale);
  const open = vi.fn().mockRejectedValueOnce(new Error("navigation unavailable")).mockResolvedValue(undefined);
  await mount("alice", open);
  await act(async () => { expect(await state.submit!()).toEqual(receipt); });
  expect(host.textContent).toContain(message);
  expect(host.querySelector("button")!.textContent).toBe(button);
  expect(state.publish).toHaveBeenCalledOnce();
  await act(async () => { host.querySelector("button")!.click(); });
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.publish).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain(message);
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

async function writeMessage(content: string) {
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = content;
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: content}));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
async function sendMessage() {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
}
it("uses selected recipients in the real first-message composer and preserves the original human mention on UNKNOWN retry", async () => {
  state.realComposer = true;
  state.publish.mockRejectedValueOnce(new TransportError("lost ACK"));
  const open = vi.fn();
  await mount("alice", open);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mention someone"]')!.click());
  expect(host.querySelectorAll('[aria-label="Mention someone Bob"]')).toHaveLength(1);
  await act(async () => host.querySelector('[aria-label="Mention someone Bob"]')!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true})));
  await sendMessage();
  expect(state.publish).toHaveBeenCalledOnce();
  const original = state.publish.mock.calls[0];
  expect(original).toEqual(["conversation", "@Bob", [], expect.any(String), undefined, undefined, ["b".repeat(64)]]);
  expect(open).not.toHaveBeenCalled();
  state.recipients = [
    {principalId: "bob", displayName: "Renamed", pubkeys: ["b".repeat(64)]},
    {principalId: "other", displayName: "Bob", pubkeys: ["c".repeat(64)]},
  ];
  await mount("alice", open);
  await sendMessage();
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.publish.mock.calls[1]).toEqual(original);
  expect(open).toHaveBeenCalledOnce();
});
it("does not silently drop or retarget an unresolved first-message mention when its recipient disappears", async () => {
  state.realComposer = true;
  state.publish.mockRejectedValueOnce(new TransportError("lost ACK"));
  await mount("alice", vi.fn());
  await writeMessage("@Bob hello");
  await sendMessage();
  expect(state.publish).toHaveBeenCalledOnce();
  state.recipients = [{principalId: "other", displayName: "Bob", pubkeys: ["c".repeat(64)]}];
  await mount("alice", vi.fn());
  await sendMessage();
  expect(state.publish).toHaveBeenCalledOnce();
  expect(state.prepare).toHaveBeenCalledOnce();
});
it("serializes first-message human mentions through the actual BFF publisher without edit or reply fields", async () => {
  state.realComposer = true; state.realBff = true;
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(receipt),
    {status: 200, headers: {"Content-Type": "application/json"}}));
  vi.stubGlobal("fetch", fetcher);
  const open = vi.fn();
  await mount("alice", open);
  await writeMessage("@Bob hello");
  await sendMessage();
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, request] = fetcher.mock.calls[0]!;
  expect(String(url)).toContain("/conversations/conversation/messages");
  expect(JSON.parse(request.body)).toEqual({content: "@Bob hello", attachments: [], mentionInstallationIds: [], mentionPubkeys: ["b".repeat(64)]});
  expect(new Headers(request.headers).get("Idempotency-Key")).toBeTruthy();
  expect(open).toHaveBeenCalledOnce();
});
