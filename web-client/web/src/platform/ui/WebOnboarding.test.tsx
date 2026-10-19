// @vitest-environment jsdom
// DD-125(5) (V-SCN-142): the Web host of the original first-run profile step reads this session's
// own profile through the BFF, opens only without a kind:0, and saves through the existing
// identity.profile.publish with the same readback as Settings → Profile.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlatformSessionAccessMode, type PlatformSessionView } from "@client-kit/contracts";
import { setLocale } from "@client-kit/platform/i18n";
import { onboardingCompletionStorageKey } from "@client-kit/platform/react/onboarding";
import { WebOnboardingGate } from "./WebOnboarding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), upload: vi.fn() }));
vi.mock("@/platform/bff-client", () => ({
  bff: { profile: (...args: unknown[]) => state.read(...args), updateProfile: (...args: unknown[]) => state.write(...args) },
  uploadProfileAvatar: state.upload,
}));

const own = "a".repeat(64);
const session = { humanIdentityId: "human", displayName: "Account", tenantId: "tenant", tenantMembershipId: "membership",
  tenantPrincipalId: "principal", platformSessionId: "session", accessMode: PlatformSessionAccessMode.Full } as PlatformSessionView;
const empty = { pubkey: own, eventId: null, displayName: null, about: null, avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} };
let root: Root;
let host: HTMLDivElement;

async function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={cache}>
    <WebOnboardingGate session={session} blocking={<p data-testid="blocking" />}><p data-testid="app">app</p></WebOnboardingGate>
  </QueryClientProvider>));
  for (let i = 0; i < 5; i++) await act(async () => {});
}

async function typeName(value: string) {
  const input = host.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  state.read.mockReset(); state.write.mockReset(); state.upload.mockReset();
  // jsdom omits these native browser APIs; keep the real avatar components.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("opens the original profile step only while the session key has no kind:0", async () => {
  state.read.mockResolvedValue({ ...empty, eventId: "1".repeat(64), displayName: "Ada" });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="app"]')).not.toBeNull());
  expect(host.querySelector('[data-testid="onboarding-gate"]')).toBeNull();
  expect(localStorage.getItem(onboardingCompletionStorageKey(own))).toBe("true");
});

it("saves the name through the existing publication and its readback", async () => {
  state.read.mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, eventId: "2".repeat(64), displayName: "Ada" });
  state.write.mockResolvedValue({ eventId: "2".repeat(64), operationId: "operation" });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="onboarding-gate"]')).not.toBeNull());
  expect(host.querySelector('[data-testid="app"]')).toBeNull();
  await typeName("Ada");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')!.click());
  await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce());
  expect(state.write.mock.calls[0]![0]).toEqual({ idempotencyKey: expect.any(String), expectedPubkey: own, displayName: "Ada" });
  await vi.waitFor(() => expect(host.querySelector('[data-testid="onboarding-page-avatar"]')).not.toBeNull());
});

it("treats a readback that is not the published event as an unknown result", async () => {
  state.read.mockResolvedValueOnce(empty).mockResolvedValueOnce({ ...empty, eventId: "3".repeat(64), displayName: "Other" });
  state.write.mockResolvedValue({ eventId: "2".repeat(64), operationId: "operation" });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="onboarding-gate"]')).not.toBeNull());
  await typeName("Ada");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')!.click());
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent)
    .toBe("The save result is unknown. Check the original request; it will not be published again."));
  expect(host.querySelector('[data-testid="onboarding-page-avatar"]')).toBeNull();
});

it("does not hold the app on a failed own-profile read", async () => {
  state.read.mockRejectedValue(new Error("unavailable"));
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="app"]')).not.toBeNull());
});
