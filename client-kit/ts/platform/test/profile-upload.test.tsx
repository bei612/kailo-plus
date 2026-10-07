import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "sonner";
import { beginAvatarPresentation, getAvatarPresentation, resetAvatarPresentations } from "../src/react/profile/buzz/features/profile/avatarPresentationStore";
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
  it.each([
    ["zh-CN", "头像未能完成上传", "现显示默认头像。", "重试"],
    ["en", "Avatar couldn’t finish uploading", "Your default avatar is showing instead.", "Try again"],
  ] as const)("renders the original failed presentation and real retry in %s", async (locale, title, description, retryLabel) => {
    vi.useFakeTimers();
    const create = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const revoked = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:original-avatar" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
    let available = false;
    const probes: string[] = [];
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      referrerPolicy = "";
      set src(url: string) {
        probes.push(url);
        Promise.resolve().then(() => available ? this.onload?.() : this.onerror?.());
      }
    });
    const url = "https://community.example/media/original.png";
    try {
      const host = await render(<Toaster />);
      await act(async () => {
        beginAvatarPresentation(url, new Blob(["avatar"]), (value) => `/authorized/${encodeURIComponent(value)}`, locale);
        await vi.advanceTimersByTimeAsync(5_300);
      });
      expect(getAvatarPresentation(url)?.state).toBe("failed");
      expect(host.textContent).toContain(title);
      expect(host.textContent).toContain(description);
      const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === retryLabel);
      expect(retry).toBeDefined();
      expect(probes).toHaveLength(4);
      available = true;
      await act(async () => { retry!.click(); await vi.advanceTimersByTimeAsync(1); });
      expect(getAvatarPresentation(url)?.state).toBe("ready");
      expect(probes).toHaveLength(5);
      expect(probes.every((probe) => probe.startsWith("/authorized/"))).toBe(true);
      expect(revoked).toHaveBeenCalledExactlyOnceWith("blob:original-avatar");
    } finally {
      await act(async () => { resetAvatarPresentations(); toast.dismiss(); });
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      if (create) Object.defineProperty(URL, "createObjectURL", create); else Reflect.deleteProperty(URL, "createObjectURL");
      if (revoke) Object.defineProperty(URL, "revokeObjectURL", revoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

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
