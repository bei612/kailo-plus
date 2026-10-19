// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLinkPreviewStyle } from "@client-kit/platform/react/link-preview";
import { setLocale } from "@client-kit/platform/i18n";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { GIF_CAPABILITY_QUERY_KEY } from "@/platform/gif-capability";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const SHA = "ab".repeat(32);
const client = createBffClient({ send: async () => { throw new Error("Rendering performs no BFF calls"); } });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function cacheWith(origins: string[]) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(GIF_CAPABILITY_QUERY_KEY, { available: origins.length > 0, imageOrigins: origins });
  return cache;
}

async function show(ui: ReactNode, cache = cacheWith([])) {
  await act(async () => root.render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en">
    <TooltipProvider>{ui}</TooltipProvider></PlatformProvider></QueryClientProvider>));
}

describe("DD-125(5) GIF bodies (V-SCN-140)", () => {
  it("renders an imeta-less GIF only from a registered https origin", async () => {
    const registered = "https://static.klipy.com/ship/md.gif";
    const foreign = "https://tracker.example/pixel.gif";
    await show(<MessageContent workspaceId={WORKSPACE} content={`![image](${registered})\n\n![image](${foreign})`} />,
      cacheWith(["https://static.klipy.com"]));
    await vi.waitFor(() => expect(host.querySelector("[data-registered-gif] img")?.getAttribute("src")).toBe(registered));
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.querySelector(`a[href="${foreign}"]`)).not.toBeNull();
  });

  it("keeps every imeta-less image a link when no origin is registered", async () => {
    await show(<MessageContent workspaceId={WORKSPACE} content="![image](https://static.klipy.com/ship/md.gif)" />);
    await act(async () => {});
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('a[href="https://static.klipy.com/ship/md.gif"]')).not.toBeNull();
  });
});

describe("DD-125(5) original Remove preview for everyone", () => {
  const href = "https://example.com/product";
  const imageUrl = `https://relay.example.com/media/${SHA}.png`;
  const snapshot = ["link-preview", "snapshot", "1", href, "Signed title", "Example", "Signed description", imageUrl, SHA, "", ""];

  async function openRemoveDialog() {
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Link display settings"]')!;
    expect(trigger).not.toBeNull();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const remove = await vi.waitFor(() => {
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) => entry.textContent?.includes("Remove preview"));
      expect(item).toBeDefined();
      return item!;
    });
    await act(async () => remove.click());
    return vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>('[data-testid="link-preview-remove-dialog"]');
      expect(dialog).not.toBeNull();
      return dialog!;
    });
  }

  it("asks once, hides the cards at once and calls the host's suppressing edit", async () => {
    setLinkPreviewStyle("compact");
    const onRemove = vi.fn(async () => {});
    await show(<MessageContent workspaceId={WORKSPACE} content={href} mediaTags={[snapshot]} onRemoveLinkPreviews={onRemove} />);
    expect(host.querySelector("[data-link-preview-list]")).not.toBeNull();
    const dialog = await openRemoveDialog();
    expect(dialog.textContent).toContain("Remove preview?");
    expect(dialog.textContent).toContain("This removes the preview for everyone.");
    await act(async () => dialog.querySelector<HTMLButtonElement>('[data-testid="link-preview-remove-confirm"]')!.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-link-preview-list]")).toBeNull();
  });

  it("shows the cards again when the removal fails", async () => {
    setLinkPreviewStyle("compact");
    const onRemove = vi.fn(async () => { throw new Error("refused"); });
    await show(<MessageContent workspaceId={WORKSPACE} content={href} mediaTags={[snapshot]} onRemoveLinkPreviews={onRemove} />);
    const dialog = await openRemoveDialog();
    await act(async () => dialog.querySelector<HTMLButtonElement>('[data-testid="link-preview-remove-confirm"]')!.click());
    await vi.waitFor(() => expect(host.querySelector("[data-link-preview-list]")).not.toBeNull());
  });

  it("offers no removal without the host's edit authority", async () => {
    setLinkPreviewStyle("compact");
    await show(<MessageContent workspaceId={WORKSPACE} content={href} mediaTags={[snapshot]} />);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Link display settings"]')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => {});
    expect([...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.includes("Remove preview"))).toBe(false);
  });
});
