// DD-125(5) (V-SCN-142): Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/onboarding/{hooks.ts::useFirstRunOnboardingGate, ui/OnboardingFlow.tsx,
// ui/ProfileStep.tsx, ui/AvatarStep.tsx}: the first-run profile and avatar steps open only while
// the signed-in key has no kind:0, save through the host's own-profile publication and keep an
// unknown result's request for the next attempt.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { TransportError } from "../src/transport";
import {
  createProfileUpdatePayload, onboardingCompletionStorageKey, OnboardingGate, resolveProfileSaveRecovery,
  type OnboardingHost, type OnboardingProfileRead,
} from "../src/react/onboarding";
import { click, render, settle, type } from "./render";

// The shared avatar editor has its own tests; here it only picks an avatar URL.
vi.mock("../src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor", () => ({
  parseEmojiAvatarDataUrl: () => null,
  ProfileAvatarEditor: ({ onUrlChange }: { onUrlChange: (url: string) => void }) =>
    <button data-testid="stub-avatar-pick" onClick={() => onUrlChange("https://community.example/media/avatar.png")} type="button">pick</button>,
}));
vi.mock("../src/react/profile/buzz/features/profile/ui/ProfileAvatar", () => ({
  ProfileAvatar: ({ testId }: { testId?: string }) => <span data-testid={testId} />,
}));

const pubkey = "a".repeat(64);

function read(hasProfileEvent: boolean, overrides: Partial<OnboardingProfileRead> = {}): OnboardingProfileRead {
  return { status: "success", isFetching: false, data: { pubkey, displayName: null, avatarUrl: null, hasProfileEvent }, ...overrides };
}

const saveMock = (implementation: OnboardingHost["saveProfile"] = async () => {}) => vi.fn<OnboardingHost["saveProfile"]>(implementation);

function host(saveProfile = saveMock()) {
  const value: OnboardingHost = { saveProfile, uploadMediaBytes: vi.fn<OnboardingHost["uploadMediaBytes"]>(), rewriteMediaUrl: (url: string) => url };
  return { ...value, saveProfile };
}

async function mount(profile: OnboardingProfileRead, onboardingHost: OnboardingHost = host()) {
  const ui = await render(<OnboardingGate profile={profile} host={onboardingHost} blocking={<p data-testid="blocking" />}>
    <p data-testid="app">app</p>
  </OnboardingGate>);
  await settle();
  return ui;
}

const byTestId = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("original first-run onboarding gate", () => {
  it("goes straight to the app when the key has a kind:0, and remembers it", async () => {
    await mount(read(true));
    expect(byTestId("app")).not.toBeNull();
    expect(byTestId("onboarding-gate")).toBeNull();
    expect(localStorage.getItem(onboardingCompletionStorageKey(pubkey))).toBe("true");
  });

  it("blocks while the own profile is pending and never blocks the app on a failed read", async () => {
    await mount({ status: "pending", isFetching: true, data: undefined });
    expect(byTestId("blocking")).not.toBeNull();
    expect(byTestId("app")).toBeNull();
    await mount({ status: "error", isFetching: false, data: undefined });
    expect(document.querySelectorAll('[data-testid="app"]')).toHaveLength(1);
  });

  it("does not ask again on a device that finished onboarding for this key", async () => {
    localStorage.setItem(onboardingCompletionStorageKey(pubkey), "true");
    await mount(read(false));
    expect(byTestId("app")).not.toBeNull();
    expect(byTestId("onboarding-gate")).toBeNull();
  });

  it("walks the profile and avatar steps through the host publication and completes", async () => {
    const onboardingHost = host();
    await mount(read(false), onboardingHost);
    expect(byTestId("onboarding-gate")?.textContent).toContain("What should we call you?");
    expect(byTestId("app")).toBeNull();
    expect(byTestId("onboarding-next")?.disabled).toBe(true);
    await type(document.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!, "  Ada  ");
    expect(byTestId("onboarding-next")?.disabled).toBe(false);
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(byTestId("onboarding-page-avatar")).not.toBeNull());
    expect(onboardingHost.saveProfile).toHaveBeenCalledOnce();
    const first = onboardingHost.saveProfile.mock.calls[0]![0];
    expect(first).toEqual({ idempotencyKey: expect.any(String), expectedPubkey: pubkey, displayName: "Ada" });
    expect(byTestId("onboarding-gate")?.textContent).toContain("Next, add a display image");
    expect(byTestId("onboarding-next")?.disabled).toBe(true);
    await click(byTestId("stub-avatar-pick")!);
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(byTestId("app")).not.toBeNull());
    // Only the changed field is published on the second step, with its own intent key.
    const second = onboardingHost.saveProfile.mock.calls[1]![0];
    expect(second).toEqual({ idempotencyKey: expect.any(String), expectedPubkey: pubkey, avatarUrl: "https://community.example/media/avatar.png" });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(localStorage.getItem(onboardingCompletionStorageKey(pubkey))).toBe("true");
  });

  it("finishes without an avatar from the original Skip for now, and goes back to the profile step", async () => {
    await mount(read(false));
    await type(document.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!, "Ada");
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(byTestId("onboarding-page-avatar")).not.toBeNull());
    await click(byTestId("onboarding-back")!);
    expect(byTestId("onboarding-page-1")).not.toBeNull();
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(byTestId("onboarding-page-avatar")).not.toBeNull());
    await click(byTestId("onboarding-skip")!);
    await vi.waitFor(() => expect(byTestId("app")).not.toBeNull());
    expect(localStorage.getItem(onboardingCompletionStorageKey(pubkey))).toBe("true");
  });

  it("keeps an unknown save's request and key for the next attempt; skip closes for this run only", async () => {
    const saveProfile = saveMock(async () => { throw new TransportError("no response"); });
    await mount(read(false), host(saveProfile));
    await type(document.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!, "Ada");
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe("The save result is unknown. Check the original request; it will not be published again."));
    expect(byTestId("onboarding-page-avatar")).toBeNull();
    await type(document.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!, "Ada Lovelace");
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(2));
    expect(saveProfile.mock.calls[1]![0]).toBe(saveProfile.mock.calls[0]![0]);
    await click(byTestId("onboarding-skip")!);
    await vi.waitFor(() => expect(byTestId("app")).not.toBeNull());
    expect(localStorage.getItem(onboardingCompletionStorageKey(pubkey))).toBeNull();
  });

  it("drops a definitely rejected request so the next attempt is a new intent", async () => {
    const saveProfile = saveMock(async () => { throw new Error("rejected"); });
    await mount(read(false), host(saveProfile));
    await type(document.querySelector<HTMLInputElement>('[data-testid="onboarding-display-name"]')!, "Ada");
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe("Profile could not be saved. Your edits have been kept."));
    await click(byTestId("onboarding-next")!);
    await vi.waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(2));
    expect(saveProfile.mock.calls[1]![0].idempotencyKey).not.toBe(saveProfile.mock.calls[0]![0].idempotencyKey);
  });

  it("shows the original copy in Chinese", async () => {
    await act(async () => setLocale("zh-CN"));
    await mount(read(false));
    expect(byTestId("onboarding-gate")?.textContent).toContain("我们该怎么称呼你？");
    expect(byTestId("onboarding-next")?.textContent).toBe("继续");
  });
});

describe("original profile update payload and recovery", () => {
  it("publishes only changed, non-empty fields", () => {
    expect(createProfileUpdatePayload({ draftProfile: { displayName: " Ada ", avatarUrl: "" }, savedProfile: { displayName: "", avatarUrl: "" } }))
      .toEqual({ displayName: "Ada" });
    expect(createProfileUpdatePayload({ draftProfile: { displayName: "Ada", avatarUrl: "x" }, savedProfile: { displayName: "Ada", avatarUrl: "x" } }))
      .toEqual({});
  });

  it("offers Skip for now without a saved name and Continue without saving with one", () => {
    expect(resolveProfileSaveRecovery("failed", "")).toEqual({ canAdvanceWithoutSaving: false, canSkipForNow: true, errorMessage: "failed" });
    expect(resolveProfileSaveRecovery("failed", "Ada")).toEqual({ canAdvanceWithoutSaving: true, canSkipForNow: false, errorMessage: "failed" });
    expect(resolveProfileSaveRecovery(null, "")).toEqual({ canAdvanceWithoutSaving: false, canSkipForNow: false, errorMessage: null });
  });
});
