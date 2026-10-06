import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AvatarHostProvider } from "../src/react/profile/avatar-host";
import { useAvatarUpload } from "../src/react/profile/buzz/features/profile/useAvatarUpload";
import { ProfileAvatar } from "../src/react/profile/buzz/features/profile/ui/ProfileAvatar";
import { buildAnimatedAvatarUrl } from "../src/react/profile/buzz/shared/lib/animatedAvatar";
import { render, settle } from "./render";

function OriginalUpload({ saved }: { saved: (url: string) => void }) {
  const upload = useAvatarUpload({ onUploadSuccess: saved });
  return <><input type="file" onChange={upload.handleFileChange} disabled={upload.isUploading} />
    {upload.errorMessage ? <p role="alert">{upload.errorMessage}</p> : null}</>;
}

async function select(host: HTMLElement) {
  const file = new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" });
  // jsdom's File lacks arrayBuffer; the bytes still pass through the actual
  // original upload hook, not a rewritten implementation under test.
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
  const input = host.querySelector<HTMLInputElement>("input")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
}

describe("original avatar upload consumes its captured host uploader", () => {
  it("keeps original animated styling and empty-identity fallback with a read-only host", async () => {
    const rewrite = vi.fn((url: string) => `/governed-media/${encodeURIComponent(url)}`);
    const host = await render(<AvatarHostProvider value={{ locale: "zh-CN", rewriteMediaUrl: rewrite }}>
      <ProfileAvatar avatarUrl={null} label="" testId="empty-avatar" />
      <ProfileAvatar avatarUrl={buildAnimatedAvatarUrl("https://community.example/poster.png", "https://community.example/motion.png")} label="Alice" testId="animated-avatar" />
    </AvatarHostProvider>);
    expect(host.querySelector('[data-testid="empty-avatar-fallback"] .lucide-user-round')).not.toBeNull();
    const animated = host.querySelector<HTMLElement>('[data-testid="animated-avatar"]')!;
    expect(animated.classList.contains("bg-transparent")).toBe(true);
    expect(animated.classList.contains("shadow-none")).toBe(true);
    expect(rewrite).toHaveBeenCalledWith("https://community.example/poster.png");
    await act(async () => animated.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(rewrite).toHaveBeenCalledWith("https://community.example/motion.png");
  });

  it("passes actual bytes and only applies the returned image URL", async () => {
    const upload = vi.fn(async () => ({ url: "https://community.example/media/actual.png", type: "image/png" }));
    const saved = vi.fn();
    const host = await render(<AvatarHostProvider value={{ locale: "en", uploadMediaBytes: upload, rewriteMediaUrl: (url) => url, performDefaultHaptic: () => {} }}>
      <OriginalUpload saved={saved} />
    </AvatarHostProvider>);
    await select(host);
    expect(upload).toHaveBeenCalledExactlyOnceWith([137, 80, 78, 71]);
    expect(saved).toHaveBeenCalledExactlyOnceWith("https://community.example/media/actual.png");
    expect(host.querySelector("[role=alert]")).toBeNull();
  });

  it("does not apply a server-rejected image or a failed upload as a saved avatar", async () => {
    const saved = vi.fn();
    const upload = vi.fn(async () => ({ url: "https://community.example/media/not-image", type: "application/octet-stream" }));
    const host = await render(<AvatarHostProvider value={{ locale: "zh-CN", uploadMediaBytes: upload, rewriteMediaUrl: (url) => url, performDefaultHaptic: () => {} }}>
      <OriginalUpload saved={saved} />
    </AvatarHostProvider>);
    await select(host);
    expect(saved).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    upload.mockRejectedValueOnce(new Error("original upload refused"));
    await select(host);
    expect(saved).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("original upload refused");
    expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
  });
});
