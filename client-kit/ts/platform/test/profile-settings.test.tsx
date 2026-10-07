import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { npubEncode } from "nostr-tools/nip19";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";
import { ProfileSettingsCard, type ProfilePresentation, type ProfileAvatarEditorBinding } from "../src/react/profile-settings";
import { TransportError } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const profile: ProfilePresentation = { pubkey: "a".repeat(64), displayName: "Original", about: "Before", avatarUrl: null, nip05Handle: "me@community.example" };
const clipboard = vi.fn(async (_value: string) => {});

async function edit(host: HTMLElement, name: string) {
  await click(button(host, "Edit"));
  await type(host.querySelector<HTMLInputElement>("#profile-display-name")!, name);
}

describe("original profile settings through canonical host callbacks", () => {
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
    expect(first).toMatchObject({ avatarUrl, expectedPubkey: profile.pubkey, displayName: profile.displayName });
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
