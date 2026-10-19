// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { setLocale } from "@client-kit/platform/i18n";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { TransportError } from "@client-kit/platform/transport";
import { clearAllDrafts } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import type { WebLinkPreviewSnapshotView } from "@client-kit/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./ChannelPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  publish: vi.fn(),
  prepare: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/platform/bff-client", () => ({
  bff: {
    session: async () => ({ tenantPrincipalId: "human-a" }),
    profile: async () => ({ pubkey: "d".repeat(64) }),
    members: async () => [],
    customEmoji: async () => ({ pubkey: "d".repeat(64), events: [], mediaPaths: {} }),
    workspaceChannel: async () => ({ channelId: "relay-channel-a", channelType: "stream", archived: false }),
    agentInstallations: async () => ({ installations: [], nextOffset: null }),
    gifCapability: () => state.capability(),
    gifSearch: async () => ({ gifs: [] }),
    gifShare: async () => undefined,
  },
  BffError: class extends Error {},
  publishMessage: state.publish,
  prepareLinkPreview: (target: unknown, url: string) => state.prepare(target, url),
  markRead: vi.fn(),
  openStream: vi.fn(),
  uploadMedia: vi.fn(),
  fetchUserState: vi.fn(),
  mediaUrl: (workspace: string, sha256: string) => `/api/v1/workspaces/${workspace}/media/${sha256}`,
}));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: () => null }));

const snapshot = (url: string, id: string): WebLinkPreviewSnapshotView => ({
  snapshotId: id, url, canonicalUrl: url, title: "Release notes", siteName: "Example", description: "",
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
});

const mounted: { root: Root; host: HTMLElement }[] = [];
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  clearAllDrafts();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  state.publish.mockReset().mockResolvedValue({ eventId: "event", operationId: "operation" });
  state.prepare.mockReset().mockImplementation(async (_target: unknown, url: string) => snapshot(url, "snap-a"));
  state.capability.mockReset().mockResolvedValue({ available: false, imageOrigins: [] });
});
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={queryClient}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>));
  return host;
}
async function type(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  await act(async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = value;
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function send(host: HTMLElement) {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
}

it("fetches the composer preview through the BFF and publishes only the snapshot ID", async () => {
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="previews" />);
  await type(host, "see https://example.com/release");
  await vi.waitFor(() => expect(host.querySelector("[data-snapshot-tag-ready='true']")).not.toBeNull());
  expect(state.prepare).toHaveBeenCalledWith({ workspaceId: "workspace-a" }, "https://example.com/release");
  await send(host);
  await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  const [, content, , , , intent] = state.publish.mock.calls[0]!;
  expect(content).toBe("see https://example.com/release");
  expect(intent).toEqual(expect.objectContaining({ linkPreviewSnapshotIds: ["snap-a"] }));
  expect(intent).not.toHaveProperty("suppressLinkPreviews");
});

it("sends without previews after the original card control, as the suppression flag", async () => {
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="suppressed" />);
  await type(host, "see https://example.com/release");
  await vi.waitFor(() => expect(host.querySelector("[data-snapshot-tag-ready='true']")).not.toBeNull());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="composer-hide-link-previews"]')!.click());
  expect(host.querySelector("[data-link-preview-composer-card]")).toBeNull();
  await send(host);
  await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  expect(state.publish.mock.calls[0]![5]).toEqual(expect.objectContaining({ suppressLinkPreviews: true }));
  expect(state.publish.mock.calls[0]![5]).not.toHaveProperty("linkPreviewSnapshotIds");
});

it("retries an UNKNOWN send with the same key and the same snapshot references", async () => {
  state.publish.mockRejectedValueOnce(new TransportError("lost response"));
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="retry" />);
  await type(host, "see https://example.com/release");
  await vi.waitFor(() => expect(host.querySelector("[data-snapshot-tag-ready='true']")).not.toBeNull());
  await send(host);
  await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  state.prepare.mockImplementation(async (_target: unknown, url: string) => snapshot(url, "snap-new"));
  await send(host);
  await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));
  expect(state.publish.mock.calls[1]![3]).toBe(state.publish.mock.calls[0]![3]);
  expect(state.publish.mock.calls[1]![5]).toEqual(state.publish.mock.calls[0]![5]);
});

it("names no previews when the site has none", async () => {
  state.prepare.mockResolvedValue(null);
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="none" />);
  await type(host, "see https://example.com/none");
  await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(host.querySelector("[data-link-preview-composer-card]")).toBeNull());
  await send(host);
  await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  expect(state.publish.mock.calls[0]![5]).not.toHaveProperty("linkPreviewSnapshotIds");
  expect(state.publish.mock.calls[0]![5]).not.toHaveProperty("suppressLinkPreviews");
});

it("offers the GIF picker only when the BFF reports the option", async () => {
  state.capability.mockResolvedValue({ available: true, imageOrigins: ["https://static.klipy.com"] });
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="gif" />);
  await vi.waitFor(() => expect(host.querySelector('[data-testid="composer-emoji-button"]')?.getAttribute("aria-label")).toBe("Insert emoji or GIF"));
  const edit = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="gif-edit" editTarget={{
    id: "e".repeat(64), createdAt: 1, author: "A", time: "", body: "old", depth: 0, kind: 9, tags: [],
  }} />);
  expect(edit.querySelector('[data-testid="composer-emoji-button"]')?.getAttribute("aria-label")).toBe("Insert emoji");
});
