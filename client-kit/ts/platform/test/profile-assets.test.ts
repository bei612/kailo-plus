import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { profileAssets } from "../profile-assets";
import { openAvatarCamera } from "../src/react/profile/buzz/features/profile/lib/animatedAvatarCapture";

describe("original avatar assets and camera host boundary", () => {
  it("emits the actual installed SDK pair and fixed model under the same origin", () => {
    const plugin = profileAssets(pathToFileURL(resolve("../../../web-client/web/vite.config.ts")).href);
    const emitted = new Map<string, Uint8Array>();
    plugin.generateBundle.call({ emitFile: (asset) => emitted.set(asset.fileName, asset.source) });
    expect(emitted.has("profile-assets/wasm/vision_wasm_internal.js")).toBe(true);
    expect(emitted.has("profile-assets/wasm/vision_wasm_internal.wasm")).toBe(true);
    const model = emitted.get("profile-assets/selfie_segmenter.tflite")!;
    expect(createHash("sha256").update(model).digest("hex")).toBe("191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b");
    expect(model.byteLength).toBe(249537);
    expect([...emitted.keys()].every((name) => name.startsWith("profile-assets/") && !name.includes(".."))).toBe(true);
  });

  it("keeps Web scripts/connect same-origin and never grants a cross-origin component camera", () => {
    const caddy = readFileSync(resolve("../../../web-client/web/Caddyfile"), "utf8");
    expect(caddy).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(caddy).toContain("connect-src 'self';");
    expect(caddy).toContain('Permissions-Policy "camera=(self),');
    expect(caddy).not.toContain("'unsafe-eval'");
    expect(caddy).not.toMatch(/camera=\([^)]*(?:https?:|\*)/);
  });

  it("refuses an insecure camera context and only requests video through the original browser API", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    const devices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => ({ getTracks: () => [] } as unknown as MediaStream));
    try {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
      await expect(openAvatarCamera()).rejects.toMatchObject({ name: "NotSupportedError" });
      expect(getUserMedia).not.toHaveBeenCalled();
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      await openAvatarCamera("selected-device");
      expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: { ideal: "user" }, frameRate: { ideal: 30 }, height: { ideal: 1080 }, width: { ideal: 1080 }, deviceId: { exact: "selected-device" } } });
    } finally {
      if (original) Object.defineProperty(window, "isSecureContext", original);
      else Reflect.deleteProperty(window, "isSecureContext");
      if (devices) Object.defineProperty(navigator, "mediaDevices", devices);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });
});
