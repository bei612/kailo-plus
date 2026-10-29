import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WebGifItem, WebGifSearchView } from "@client-kit/contracts";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { KlipyGifPicker, withGifLines, gifAttachment, splitDraftGifMedia, type GifSearch } from "../src/react/gifs";
import { ComposerEmojiPicker } from "../src/react/composer/features/messages/ui/ComposerEmojiPicker";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { BffError } from "../src/transport";
import { setLocale } from "../src/i18n";
import { click, render, type } from "./render";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotion: () => motion.reduced,
}));
vi.mock("../src/react/profile/buzz/shared/ui/emoji-picker", () => ({ default: () => <div data-testid="emoji-mart" /> }));
vi.mock("../src/react/custom-emoji/emojiMartPrewarm", () => ({ emojiMartData: {} }));

const gif = (slug: string, patch: Partial<WebGifItem> = {}): WebGifItem => ({
  slug, title: `GIF ${slug}`, url: `https://static.klipy.com/${slug}/md.gif`, width: 480, height: 270, size: 1000,
  previewUrl: `https://static.klipy.com/${slug}/sm.webp`, previewWidth: 220, previewHeight: 124, ...patch,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  motion.reduced = false;
});

async function picker(search: GifSearch, onSelect = vi.fn()) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = await render(<QueryClientProvider client={cache}><KlipyGifPicker search={search} onSelect={onSelect} /></QueryClientProvider>);
  return { host, onSelect };
}

describe("original KLIPY picker over the BFF forward", () => {
  it("asks for trending first, then the debounced query, and chooses a GIF", async () => {
    const search = vi.fn<GifSearch>(async (query): Promise<WebGifSearchView> => ({ gifs: query ? [gif("ship")] : [gif("trend")] }));
    const { host, onSelect } = await picker(search);
    expect(host.textContent).toContain("Loading GIFs");
    await vi.waitFor(() => expect(host.querySelector("[aria-label='Choose GIF trend']")).not.toBeNull());
    expect(search).toHaveBeenCalledWith("");
    await type(host.querySelector<HTMLInputElement>("input[aria-label='Search KLIPY']")!, "  ship ");
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith("ship"), { timeout: 2000 });
    await vi.waitFor(() => expect(host.querySelector("[aria-label='Choose GIF ship']")).not.toBeNull());
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://static.klipy.com/ship/sm.webp");
    expect(host.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(host.textContent).toContain("Powered by KLIPY");
    await click(host.querySelector<HTMLButtonElement>("[aria-label='Choose GIF ship']")!);
    expect(onSelect).toHaveBeenCalledWith(gif("ship"));
  });

  it("shows the original empty, member-gate and retry states", async () => {
    const empty = await picker(async () => ({ gifs: [] }));
    await vi.waitFor(() => expect(empty.host.textContent).toContain("No GIFs found."));
    const denied = new BffError(403, "denied", { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied });
    const search = vi.fn<GifSearch>().mockRejectedValueOnce(denied).mockResolvedValue({ gifs: [gif("back")] });
    const { host } = await picker(search);
    await vi.waitFor(() => expect(host.textContent).toContain("Join this community to search GIFs."));
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Try again")!);
    await vi.waitFor(() => expect(host.querySelector("[aria-label='Choose GIF back']")).not.toBeNull());
  });

  it("shows the poster, or the title placeholder, under reduced motion", async () => {
    motion.reduced = true;
    const { host } = await picker(async () => ({ gifs: [gif("still", { posterUrl: "https://static.klipy.com/still/sm.jpg" }), gif("plain")] }));
    await vi.waitFor(() => expect(host.querySelector("[aria-label='Choose GIF still'] img")).not.toBeNull());
    expect(host.querySelector("[aria-label='Choose GIF still'] img")?.getAttribute("src")).toBe("https://static.klipy.com/still/sm.jpg");
    expect(host.querySelector("[data-testid='klipy-gif-static-placeholder']")?.textContent).toBe("GIF plain");
  });

  it("round trips the original GIF draft marker without consuming hash-backed files at the same URL", () => {
    const selected = gif("kept");
    const marker = gifAttachment(selected);
    const file = {...marker, sha256: "a".repeat(64), uploaded: 99};
    const missingFile = {...marker, type: "text/plain", filename: "missing.txt"};
    const restored = splitDraftGifMedia([file, marker, missingFile]);
    expect(restored.attachments).toEqual([file, missingFile]);
    expect(restored.gifs).toEqual([expect.objectContaining({url:selected.url,title:selected.title,width:480,height:270})]);
    expect(gifAttachment(restored.gifs[0]!)).toEqual(marker);
    expect(withGifLines("body", restored.gifs)).toBe(`body\n![image](${selected.url})`);
  });

  it("appends chosen GIFs as body lines without imeta", () => {
    expect(withGifLines("hello", [gif("a")])).toBe("hello\n![image](https://static.klipy.com/a/md.gif)");
    expect(withGifLines("", [gif("a")])).toBe("![image](https://static.klipy.com/a/md.gif)");
    expect(withGifLines("hello", [])).toBe("hello");
  });
});

describe("ComposerEmojiPicker GIF option", () => {
  const base = { disabled: false, customEmoji: [], onClose: () => {}, onEmojiSelect: () => {}, onOpenChange: () => {} };

  it("stays the original emoji-only picker without a verified option", async () => {
    await render(<TooltipProvider><ComposerEmojiPicker {...base} open /></TooltipProvider>);
    expect(document.querySelector("[data-testid='composer-emoji-button']")?.getAttribute("aria-label")).toBe("Insert emoji");
    expect(document.querySelector("[data-testid='composer-gif-tab']")).toBeNull();
  });

  it("offers the original Emoji | GIFs tabs when the host verified the option", async () => {
    const cache = new QueryClient();
    const onSelect = vi.fn();
    await render(<QueryClientProvider client={cache}><TooltipProvider>
      <ComposerEmojiPicker {...base} open gifs={{ search: async () => ({ gifs: [] }), onSelect, disabled: true }} />
    </TooltipProvider></QueryClientProvider>);
    expect(document.querySelector("[data-testid='composer-emoji-button']")?.getAttribute("aria-label")).toBe("Insert emoji or GIF");
    const tab = document.querySelector<HTMLButtonElement>("[data-testid='composer-gif-tab']");
    expect(tab?.textContent).toContain("GIFs");
    // Original gifsDisabled while a voice note is attached.
    expect(tab?.disabled).toBe(true);
    await act(async () => {});
  });

  it("closes the popover and hands the chosen GIF to the host", async () => {
    const cache = new QueryClient();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    await render(<QueryClientProvider client={cache}><TooltipProvider>
      <ComposerEmojiPicker {...base} onOpenChange={onOpenChange} open gifs={{ search: async () => ({ gifs: [gif("pick")] }), onSelect }} />
    </TooltipProvider></QueryClientProvider>);
    const tab = document.querySelector<HTMLButtonElement>("[data-testid='composer-gif-tab']")!;
    await act(async () => { tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    const choose = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("[aria-label='Choose GIF pick']");
      expect(found).not.toBeNull();
      return found!;
    });
    await click(choose);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).toHaveBeenCalledWith(gif("pick"));
  });
});
