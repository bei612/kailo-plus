// DD-120 Web host: the presence session heartbeats through the BFF, admitted stream frames
// reach the shared caches, and leaving the page releases presence best-effort (V-SCN-100/101).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformSessionAccessMode, type PlatformSessionView } from "@client-kit/contracts";
import { setLocale } from "@client-kit/platform/i18n";
import { usePresenceQuery, useSelfPresence } from "@client-kit/platform/react/presence";
import { WebPresenceHost } from "./PresenceHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const SELF = "a".repeat(64);
const PEER = "b".repeat(64);
const state = vi.hoisted(() => ({
  sink: null as null | ((event: unknown) => void),
  updatePresence: vi.fn(async (_status: string) => {}),
  queryPresence: vi.fn(async (_pubkeys: string[]) => ({ presences: [] as unknown[] })),
  releasePresence: vi.fn(),
}));
vi.mock("@client-kit/platform/react/custom-emoji", () => ({ useBffCustomEmojiPalette: () => [] }));
vi.mock("@/platform/bff-client", () => ({
  bff: { profile: async () => ({ pubkey: "a".repeat(64), displayName: "Ada", avatarUrl: null, avatarMediaPaths: {} }) },
  queryPresence: (pubkeys: string[]) => state.queryPresence(pubkeys),
  updatePresence: (status: string) => state.updatePresence(status),
  queryUserStatus: async () => ({ statuses: [] }),
  updateUserStatus: async () => ({ eventId: "e".repeat(64) }),
  releasePresence: () => state.releasePresence(),
  setIdentityStreamSink: (sink: (event: unknown) => void) => {
    state.sink = sink;
    return () => { if (state.sink === sink) state.sink = null; };
  },
}));

const session: PlatformSessionView = {
  accessMode: PlatformSessionAccessMode.Full, displayName: "Ada", humanIdentityId: "human",
  platformSessionId: "session", tenantId: "tenant", tenantMembershipId: "membership", tenantPrincipalId: "principal",
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
  state.sink = null;
  state.updatePresence.mockClear();
  state.queryPresence.mockClear();
  state.releasePresence.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Peer() {
  const presence = usePresenceQuery([PEER]);
  const self = useSelfPresence();
  return <output data-self={self?.currentStatus ?? ""}>{presence.data?.[PEER] ?? "none"}</output>;
}
async function mount(ui: ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={cache}><WebPresenceHost session={session}>{ui}</WebPresenceHost></QueryClientProvider>));
  for (let i = 0; i < 5; i++) await act(async () => {});
}

it("heartbeats the own Web key and feeds admitted 20001 frames into presence lookups", async () => {
  await mount(<Peer />);
  await vi.waitFor(() => expect(state.updatePresence).toHaveBeenCalledWith("online"));
  expect(host.querySelector("output")?.getAttribute("data-self")).toBe("online");
  expect(state.queryPresence).toHaveBeenCalledWith([PEER]);
  expect(host.textContent).toBe("none");
  await act(async () => state.sink!({ id: "c".repeat(64), pubkey: PEER, kind: 20001, created_at: 1, content: "online", tags: [] }));
  expect(host.textContent).toBe("online");
  // A frame claiming another subject through a p tag still only speaks for its signer.
  await act(async () => state.sink!({ id: "d".repeat(64), pubkey: SELF, kind: 20001, created_at: 2, content: "offline", tags: [["p", PEER]] }));
  expect(host.textContent).toBe("online");
});

it("releases presence when the page is hidden and renews it after a back/forward restore", async () => {
  await mount(<Peer />);
  await vi.waitFor(() => expect(state.updatePresence).toHaveBeenCalledWith("online"));
  const beats = state.updatePresence.mock.calls.length;
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(state.releasePresence).toHaveBeenCalledOnce();
  const show = new Event("pageshow") as Event & { persisted: boolean };
  Object.defineProperty(show, "persisted", { value: true });
  await act(async () => { window.dispatchEvent(show); });
  expect(state.updatePresence.mock.calls.length).toBe(beats + 1);
});

it("leaves presence to another open page instead of sending offline when one page closes", async () => {
  localStorage.setItem("kailo-presence-tab:other", String(Date.now()));
  await mount(<Peer />);
  await vi.waitFor(() => expect(state.updatePresence).toHaveBeenCalledWith("online"));
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(state.releasePresence).not.toHaveBeenCalled();
  localStorage.setItem("kailo-presence-tab:other", String(Date.now() - 60_000));
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(state.releasePresence).toHaveBeenCalledOnce();
});
