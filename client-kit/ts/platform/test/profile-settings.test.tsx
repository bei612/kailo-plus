import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { npubEncode } from "nostr-tools/nip19";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";
import { ProfileSettingsCard, ProfileAvatarPreview, type ProfilePresentation, type ProfileAvatarEditorBinding } from "../src/react/profile-settings";
import { TransportError } from "../src/transport";
import { emojiAvatarDataUrl, DEFAULT_EMOJI_AVATAR_COLOR } from "../src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor.utils";
import { button, click, render, settle, type } from "./render";

const copyFeedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: copyFeedback }));

const profile: ProfilePresentation = { pubkey: "a".repeat(64), displayName: "Original", about: "Before", avatarUrl: null, nip05Handle: "me@community.example" };
const clipboard = vi.fn(async (_value: string) => {});

async function edit(host: HTMLElement, name: string) {
  await click(button(host, "Edit"));
  await type(host.querySelector<HTMLInputElement>("#profile-display-name")!, name);
}

describe("original profile settings through canonical host callbacks", () => {
  it.each(["en", "zh-CN"] as const)("ignores the original blank display-name request and restores its draft without publishing (%s)", async (locale) => {
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => profile);
    const host = await render(<ProfileSettingsCard locale={locale} profile={profile} onCopy={clipboard} onSave={onSave} />);
    const control = host.querySelector<HTMLButtonElement>('[data-testid="profile-metadata-edit"]')!;
    await click(control);
    await type(host.querySelector<HTMLInputElement>("#profile-display-name")!, "  ");
    expect(host.textContent).toContain(locale === "en"
      ? "Clearing existing profile fields is not supported yet. Blank display name and avatar values are ignored for now."
      : "暂不支持清空已有的个人资料字段。空白的显示名称和头像值会被忽略。");
    const notice = [...host.querySelectorAll("p")].find((element) => element.textContent?.includes(locale === "en" ? "Clearing existing profile fields" : "暂不支持清空"))!;
    expect(notice.className).toBe("text-sm text-muted-foreground");
    expect(notice.parentElement?.className).toBe("mx-auto w-full max-w-[576px] space-y-2");
    await click(control);
    expect(onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe(profile.displayName);
    expect(host.textContent).not.toContain(locale === "en" ? "Clearing existing profile fields" : "暂不支持清空");
  });

  it("ignores the original blank avatar request and restores it on Done without a save or upload", async () => {
    const original = { ...profile, avatarUrl: "https://community.example/media/original.png" };
    let editor!: ProfileAvatarEditorBinding;
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => original);
    const host = await render(<ProfileSettingsCard locale="en" profile={original} onCopy={clipboard} onSave={onSave}
      avatarEditor={(binding) => { editor = binding; return <button type="button" onClick={binding.onDone}>Finish avatar</button>; }} />);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    await act(async () => editor.onChange("  "));
    expect(host.textContent).not.toContain("Clearing existing profile fields");
    await click(button(host, "Finish avatar"));
    expect(onSave).not.toHaveBeenCalled();
    expect(editor.avatarUrl).toBe(original.avatarUrl);
    expect(host.querySelector('[data-testid="profile-readonly-content"]')?.hasAttribute("inert")).toBe(false);
  });

  it("ignores a blank name while preserving the original supported biography clear in the real save payload", async () => {
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => ({ ...profile, about: "" }));
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await edit(host, "");
    await type(host.querySelector<HTMLTextAreaElement>("#profile-about")!, "  ");
    await click(button(host, "Done"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0]![0];
    expect(request).toMatchObject({ expectedPubkey: profile.pubkey, about: "" });
    expect(request).not.toHaveProperty("displayName");
    expect(request).not.toHaveProperty("avatarUrl");
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe(profile.displayName);
    expect(host.querySelector('[data-testid="profile-about-value"]')?.textContent).toBe("Not set");
  });

  it("keeps the original identity fallback and draft priority in the real avatar preview and editor binding", async () => {
    let editor!: ProfileAvatarEditorBinding;
    const emptyName = { ...profile, displayName: "" };
    const onSave = vi.fn(async () => emptyName);
    const host = await render(<ProfileSettingsCard locale="en" profile={emptyName} fallbackDisplayName="Local identity" onCopy={clipboard} onSave={onSave}
      avatarPreview={(actual) => <ProfileAvatarPreview locale="en" avatarUrl={actual.avatarUrl} label={actual.displayName ?? ""} upload={vi.fn()} rewriteMediaUrl={(url) => url} testId="actual-avatar" />}
      avatarEditor={(binding) => { editor = binding; return <button type="button" onClick={binding.onDone}>Finish avatar</button>; }} />);
    expect(host.querySelector('[data-testid="actual-avatar-fallback"]')?.textContent).toBe("LI");
    await edit(host, "Draft name");
    expect(host.querySelector('[data-testid="actual-avatar-fallback"]')?.textContent).toBe("DN");
    await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(editor.previewName).toBe("Draft name");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps a canonical profile name ahead of the original local identity fallback", async () => {
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} fallbackDisplayName="Local identity" onCopy={clipboard} onSave={async () => profile}
      avatarPreview={(actual) => <ProfileAvatarPreview locale="en" avatarUrl={actual.avatarUrl} label={actual.displayName ?? ""} upload={vi.fn()} rewriteMediaUrl={(url) => url} testId="actual-avatar" />} />);
    expect(host.querySelector('[data-testid="actual-avatar-fallback"]')?.textContent).toBe("O");
  });

  it.each(["en", "zh-CN"] as const)("does not manufacture a private-key export in the browser host (%s)", async (locale) => {
    const host = await render(<ProfileSettingsCard locale={locale} profile={profile} onCopy={clipboard} onSave={async () => profile} />);
    expect(host.querySelector('[data-testid="profile-identity-details"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="profile-private-key-row"]')).toBeNull();
    expect(host.textContent).not.toContain("Private key");
    expect(host.textContent).not.toContain("私钥");
  });
  it("consumes a fresh same-identity host profile rather than pinning the first avatar and metadata", async () => {
    let refresh!: (next: ProfilePresentation) => void;
    function Host() {
      const [current, setCurrent] = useState(profile);
      refresh = setCurrent;
      return <ProfileSettingsCard locale="en" profile={current} onCopy={clipboard} onSave={async () => current}
        avatarPreview={(actual) => <span data-testid="actual-avatar">{actual.avatarUrl}</span>} />;
    }
    const host = await render(<Host />);
    await act(async () => refresh({ ...profile, displayName: "Other device", about: "Fresh biography", avatarUrl: "data:image/png;base64,AA==" }));
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe("Other device");
    expect(host.querySelector('[data-testid="profile-about-value"]')?.textContent).toBe("Fresh biography");
    expect(host.querySelector('[data-testid="actual-avatar"]')?.textContent).toBe("data:image/png;base64,AA==");
  });

  it("preserves an edited draft while consuming another device's metadata and writes only the original edit", async () => {
    let refresh!: (next: ProfilePresentation) => void;
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => ({ ...profile, displayName: "My edit", about: "Other device biography" }));
    function Host() {
      const [current, setCurrent] = useState(profile);
      refresh = setCurrent;
      return <ProfileSettingsCard locale="en" profile={current} onCopy={clipboard} onSave={onSave} />;
    }
    const host = await render(<Host />);
    await edit(host, "My edit");
    await act(async () => refresh({ ...profile, about: "Other device biography" }));
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.value).toBe("My edit");
    await click(button(host, "Done"));
    expect(onSave.mock.calls).toHaveLength(1);
    const request = onSave.mock.calls[0]![0];
    expect(request).toMatchObject({ expectedPubkey: profile.pubkey, displayName: "My edit" });
    expect(request).not.toHaveProperty("about");
  });

  it("lets a newer host read replace the canonical local save snapshot", async () => {
    let refresh!: (next: ProfilePresentation) => void;
    const onSave = vi.fn(async () => ({ ...profile, displayName: "Canonical edit" }));
    function Host() {
      const [current, setCurrent] = useState(profile);
      refresh = setCurrent;
      return <ProfileSettingsCard locale="en" profile={current} onCopy={clipboard} onSave={onSave} />;
    }
    const host = await render(<Host />);
    await edit(host, "My edit");
    await click(button(host, "Done"));
    expect(host.textContent).toContain("Canonical edit");
    await act(async () => refresh({ ...profile, displayName: "Newer canonical read" }));
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe("Newer canonical read");
    expect(host.textContent).not.toContain("Canonical edit");
  });

  it("does not overwrite a newer host profile with a delayed older save readback", async () => {
    let refresh!: (next: ProfilePresentation) => void;
    let finish!: (next: ProfilePresentation) => void;
    const onSave = vi.fn(() => new Promise<ProfilePresentation>((resolve) => { finish = resolve; }));
    function Host() {
      const [current, setCurrent] = useState(profile);
      refresh = setCurrent;
      return <ProfileSettingsCard locale="en" profile={current} onCopy={clipboard} onSave={onSave} />;
    }
    const host = await render(<Host />);
    await edit(host, "My edit");
    await click(button(host, "Done"));
    await act(async () => refresh({ ...profile, displayName: "Newer read", about: "Latest biography" }));
    await act(async () => finish({ ...profile, displayName: "Older save" }));
    await settle();
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe("Newer read");
    expect(host.querySelector('[data-testid="profile-about-value"]')?.textContent).toBe("Latest biography");
  });

  it.each(["en", "zh-CN"] as const)("keeps original clipboard feedback for synchronous and asynchronous failures (%s)", async (locale) => {
    copyFeedback.success.mockClear();
    copyFeedback.error.mockClear();
    let failure: "synchronous" | "asynchronous" | null = "synchronous";
    const copy = vi.fn((): Promise<void> => {
      if (failure === "synchronous") throw new TypeError("private native detail");
      return failure === "asynchronous" ? Promise.reject(new Error("private native detail")) : Promise.resolve();
    });
    const host = await render(<ProfileSettingsCard locale={locale} profile={profile} onCopy={copy} onSave={async () => profile} />);
    const control = host.querySelector<HTMLButtonElement>('[data-testid="copy-profile-pubkey"]')!;
    expect(control.title).toBe(control.getAttribute("aria-label"));
    await click(control);
    expect(copyFeedback.error).toHaveBeenLastCalledWith(locale === "en" ? "Could not copy to clipboard" : "未能复制到剪贴板");
    expect(copyFeedback.success).not.toHaveBeenCalled();
    failure = "asynchronous";
    await click(control);
    expect(copyFeedback.error).toHaveBeenCalledTimes(2);
    failure = null;
    await click(control);
    expect(copyFeedback.success).toHaveBeenLastCalledWith(locale === "en" ? "Copied to clipboard" : "已复制到剪贴板");
    expect(copy).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain("private native detail");
  });
  it("saves the emoji avatar on HTTP without randomUUID and closes only after canonical readback", async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("crypto", { getRandomValues, randomUUID: undefined });
    try {
      let editor!: ProfileAvatarEditorBinding;
      let finish!: (value: ProfilePresentation) => void;
      const avatarUrl = emojiAvatarDataUrl("😀", DEFAULT_EMOJI_AVATAR_COLOR);
      const onSave = vi.fn((_request: WebProfileUpdateRequest) => new Promise<ProfilePresentation>((resolve) => { finish = resolve; }));
      const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave}
        avatarEditor={(binding) => { editor = binding; return <button type="button" disabled={binding.disabled} onClick={binding.onDone}>Finish avatar</button>; }} />);
      await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
      await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
      await act(async () => editor.onChange(avatarUrl));
      await click(button(host, "Finish avatar"));
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0]![0]).toMatchObject({ expectedPubkey: profile.pubkey, avatarUrl,
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
      expect(editor.disabled).toBe(true);
      expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(true);
      expect(host.textContent).not.toContain("Saved and read back");
      await act(async () => finish({ ...profile, avatarUrl }));
      expect(host.textContent).toContain("Saved and read back");
      expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a local key-generation failure without publishing or losing the avatar draft", async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("entropy unavailable"); }, randomUUID: undefined });
    try {
      let editor!: ProfileAvatarEditorBinding;
      const avatarUrl = emojiAvatarDataUrl("😀", DEFAULT_EMOJI_AVATAR_COLOR);
      const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => ({ ...profile, avatarUrl }));
      const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave}
        avatarEditor={(binding) => { editor = binding; return <button type="button" disabled={binding.disabled} onClick={binding.onDone}>Finish avatar</button>; }} />);
      await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
      await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
      await act(async () => editor.onChange(avatarUrl));
      await click(button(host, "Finish avatar"));
      expect(onSave).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')!.textContent).toContain("Profile could not be saved. Your edits have been kept.");
      expect(editor.avatarUrl).toBe(avatarUrl);
      expect(editor.disabled).toBe(false);
      expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(true);
      vi.stubGlobal("crypto", { getRandomValues, randomUUID: undefined });
      await click(button(host, "Finish avatar"));
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain("Saved and read back");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the original independent avatar editor without opening metadata and passes both original portal targets", async () => {
    let editor!: ProfileAvatarEditorBinding;
    const onSave = vi.fn(async () => profile);
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave}
      avatarEditor={(binding) => { editor = binding; return <button type="button" onClick={binding.onDone}>Finish avatar</button>; }} />);
    expect(host.querySelector('[data-testid="profile-avatar-clip-frame"]')!.classList.contains("h-48")).toBe(true);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(host.querySelector("#profile-display-name")).toBeNull();
    expect(editor.animatedPreviewContainer).toBe(host.querySelector('[data-testid="profile-avatar-animated-preview-slot"]'));
    expect(editor.modeTabsContainer).toBe(host.querySelector('[data-testid="profile-avatar-mode-tabs-slot"]'));
    expect(editor.modeTabsContainer).not.toBeNull();
    expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(true);
    await click(button(host, "Finish avatar"));
    expect(onSave).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(false);
  });

  it("preserves the avatar draft and exact intent through unknown and rejected readback until canonical completion", async () => {
    let editor!: ProfileAvatarEditorBinding;
    const avatarUrl = "https://media.example/avatar.png";
    const onSave = vi.fn<(request: WebProfileUpdateRequest) => Promise<ProfilePresentation>>()
      .mockRejectedValueOnce(new TransportError("publication response lost"))
      .mockRejectedValueOnce(new Error("observation denied"))
      .mockResolvedValue({ ...profile, avatarUrl });
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave}
      avatarEditor={(binding) => { editor = binding; return <button type="button" disabled={binding.disabled} onClick={binding.onDone}>Finish avatar</button>; }} />);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="profile-avatar-edit"]')!);
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    await act(async () => editor.onChange(avatarUrl));
    await click(button(host, "Finish avatar"));
    const first = onSave.mock.calls[0]![0];
    expect(first).toMatchObject({ avatarUrl, expectedPubkey: profile.pubkey });
    expect(first).not.toHaveProperty("displayName");
    expect(first).not.toHaveProperty("about");
    expect(editor.disabled).toBe(true);
    expect(editor.avatarUrl).toBe(avatarUrl);
    await click(button(host, "Check save result"));
    expect(editor.disabled).toBe(true);
    expect(host.textContent).toContain("The save result is unknown");
    await click(button(host, "Check save result"));
    expect(onSave.mock.calls.every(([request]) => request === first)).toBe(true);
    expect(host.textContent).toContain("Saved and read back");
    expect(host.querySelector('[data-testid="profile-readonly-content"]')!.hasAttribute("inert")).toBe(false);
  });

  it("does not claim save success or close the editor before the canonical readback", async () => {
    let finish!: (value: ProfilePresentation) => void;
    const onSave = vi.fn((_request: WebProfileUpdateRequest) => new Promise<ProfilePresentation>((resolve) => { finish = resolve; }));
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await edit(host, "After");
    await click(button(host, "Done"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.disabled).toBe(true);
    expect(host.textContent).not.toContain("Saved and read back");
    await act(async () => finish({ ...profile, displayName: "Canonical After" }));
    expect(host.querySelector("#profile-display-name")).toBeNull();
    expect(host.textContent).toContain("Canonical After");
    expect(host.textContent).toContain("Saved and read back");
  });

  it.each([
    ["displayName", "#profile-display-name", "Renamed"],
    ["about", "#profile-about", "Updated biography"],
    ["about", "#profile-about", ""],
  ] as const)("submits only the edited %s field (%j) and adopts the complete canonical receipt", async (field, selector, value) => {
    const actual = { ...profile, displayName: "Other session name", about: "Other session biography", [field]: value };
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest) => actual);
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await click(button(host, "Edit"));
    await type(host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!, value);
    await click(button(host, "Done"));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![0]).toEqual({
      idempotencyKey: expect.any(String), expectedPubkey: profile.pubkey, [field]: value,
    });
    expect(host.querySelector('[data-testid="profile-display-name-value"]')?.textContent).toBe(actual.displayName);
    expect(host.querySelector('[data-testid="profile-about-value"]')?.textContent).toBe(actual.about || "Not set");
    expect(host.textContent).toContain("Saved and read back");
  });

  it("keeps the exact frozen intent and disables payload changes while a save is unknown", async () => {
    const onSave = vi.fn(async (_request: WebProfileUpdateRequest): Promise<ProfilePresentation> => { throw new TransportError("response lost"); });
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await edit(host, "Frozen");
    await click(button(host, "Done"));
    const first = onSave.mock.calls[0]![0];
    expect(first.expectedPubkey).toBe(profile.pubkey);
    expect(first.displayName).toBe("Frozen");
    expect(Object.isFrozen(first)).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.disabled).toBe(true);
    expect(button(host, "Done").disabled).toBe(true);
    await click(button(host, "Check save result"));
    expect(onSave.mock.calls[1]![0]).toBe(first);
    expect(host.textContent).not.toContain("Saved and read back");
  });

  it("does not accept another signer as the outcome of the original request", async () => {
    const onSave = vi.fn(async () => ({ ...profile, pubkey: "b".repeat(64) }));
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await edit(host, "Keep my draft");
    await click(button(host, "Done"));
    expect(host.textContent).toContain("The save result is unknown");
    expect(host.textContent).not.toContain("Saved and read back");
  });

  it("does not release an unknown intent when a later observation is rejected", async () => {
    const onSave = vi.fn<(request: WebProfileUpdateRequest) => Promise<ProfilePresentation>>()
      .mockRejectedValueOnce(new TransportError("publication response lost"))
      .mockRejectedValueOnce(new Error("readback currently unavailable"))
      .mockResolvedValue({ ...profile, displayName: "Frozen" });
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={clipboard} onSave={onSave} />);
    await edit(host, "Frozen");
    await click(button(host, "Done"));
    const first = onSave.mock.calls[0]![0];
    await click(button(host, "Check save result"));
    expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.disabled).toBe(true);
    expect(button(host, "Done").disabled).toBe(true);
    expect(host.textContent).toContain("The save result is unknown");
    await click(button(host, "Check save result"));
    expect(onSave.mock.calls.every(([request]) => request === first)).toBe(true);
    expect(host.textContent).toContain("Saved and read back");
  });

  it("ignores a prior scope's delayed completion after the real host remounts its identity", async () => {
    let finish!: (value: ProfilePresentation) => void;
    let switchIdentity!: () => void;
    const onSave = vi.fn(() => new Promise<ProfilePresentation>((resolve) => { finish = resolve; }));
    function Host() {
      const [current, setCurrent] = useState(profile);
      switchIdentity = () => setCurrent({ ...profile, pubkey: "b".repeat(64), displayName: "Another identity" });
      return <ProfileSettingsCard key={current.pubkey} locale="en" profile={current} onCopy={clipboard} onSave={onSave} />;
    }
    const host = await render(<Host />);
    await edit(host, "Old scope edit");
    await click(button(host, "Done"));
    await act(async () => switchIdentity());
    await act(async () => finish({ ...profile, displayName: "Old scope canonical" }));
    await settle();
    expect(host.textContent).toContain("Another identity");
    expect(host.textContent).not.toContain("Old scope canonical");
  });

  it("retains the original canonical npub and NIP-05 copy controls, never a private key", async () => {
    const copy = vi.fn(async (_value: string) => {});
    const host = await render(<ProfileSettingsCard locale="en" profile={profile} onCopy={copy} onSave={async () => profile} />);
    const npub = npubEncode(profile.pubkey);
    expect(host.querySelector('[data-testid="profile-pubkey"]')!.textContent).toBe(npub);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="copy-profile-pubkey"]')!);
    expect(copy).toHaveBeenCalledExactlyOnceWith(npub);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="copy-profile-nip05"]')!);
    expect(copy).toHaveBeenLastCalledWith(profile.nip05Handle);
    expect(host.textContent).not.toMatch(/private key|nsec|backup/i);
  });
});
