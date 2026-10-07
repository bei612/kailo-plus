import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownCodeBlock, MESSAGE_BODY_COMPONENTS } from "../src/react/message-body";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { setLocale } from "../src/i18n";
import { render, click } from "./render";

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("copies the original code text without language or UI labels and waits before reporting success", async () => {
  setLocale("en");
  let finish!: () => void;
  const copyText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const bubble = vi.fn();
  const host = await render(<TooltipProvider><div onClick={bubble}><MarkdownCodeBlock language="text" copyText={copyText}><code><span>first</span>{"\nsecond\n\n"}</code></MarkdownCodeBlock></div></TooltipProvider>);
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Copy code block"]')!;
  expect(button).not.toBeNull();
  expect(host.querySelector("pre")?.style.borderRadius).toBe("1rem");
  await click(button);
  expect(copyText).toHaveBeenCalledExactlyOnceWith("first\nsecond\n");
  expect(button.disabled).toBe(true);
  expect(bubble).not.toHaveBeenCalled();
  expect(notifications.success).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(button.disabled).toBe(false);
  expect(notifications.success).toHaveBeenCalledExactlyOnceWith("Copied code to clipboard");
});

it("the shared pre consumer exposes the original control with Chinese labels and browser fallback", async () => {
  setLocale("zh-CN");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const Pre = MESSAGE_BODY_COMPONENTS.pre;
  const host = await render(<TooltipProvider><Pre><code className="language-text">{"原文\n"}</code></Pre></TooltipProvider>);
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="复制代码块"]')!);
  expect(writeText).toHaveBeenCalledExactlyOnceWith("原文");
  expect(notifications.success).toHaveBeenCalledExactlyOnceWith("代码已复制到剪贴板");
});

it("uses the native plain-text fallback only after rich clipboard rejection", async () => {
  setLocale("en");
  const write = vi.fn().mockRejectedValue(new Error("rich clipboard unavailable"));
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", class { constructor(public data: Record<string, Blob>) {} });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const copyText = vi.fn().mockResolvedValue(undefined);
  const host = await render(<TooltipProvider><MarkdownCodeBlock copyText={copyText}><code>{"<code>&\n"}</code></MarkdownCodeBlock></TooltipProvider>);
  await click(host.querySelector("button")!);
  expect(write).toHaveBeenCalledOnce();
  expect(copyText).toHaveBeenCalledExactlyOnceWith("<code>&");
  expect(warn).toHaveBeenCalledOnce();
  expect(notifications.success).toHaveBeenCalledOnce();
});

it("preserves the original rich code marker and escaped HTML without invoking the fallback", async () => {
  setLocale("en");
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", class { constructor(public data: Record<string, Blob>) {} });
  const copyText = vi.fn();
  const host = await render(<TooltipProvider><MarkdownCodeBlock copyText={copyText}><code>{'<tag attr="x">&\n'}</code></MarkdownCodeBlock></TooltipProvider>);
  await click(host.querySelector("button")!);
  expect(write).toHaveBeenCalledOnce();
  const [item] = write.mock.calls[0]![0] as { data: Record<string, Blob> }[];
  const read = (blob: Blob) => new Promise<string>(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
  });
  expect(await read(item!.data["text/plain"]!)).toBe('<tag attr="x">&');
  expect(await read(item!.data["text/html"]!)).toBe('<pre data-buzz-code-block="true"><code>&lt;tag attr=&quot;x&quot;&gt;&amp;</code></pre>');
  expect(copyText).not.toHaveBeenCalled();
});

it("does not claim success when the actual clipboard write fails", async () => {
  setLocale("en");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = await render(<TooltipProvider><MarkdownCodeBlock copyText={vi.fn().mockRejectedValue(new Error("denied"))}><code>secret</code></MarkdownCodeBlock></TooltipProvider>);
  await click(host.querySelector("button")!);
  expect(notifications.success).not.toHaveBeenCalled();
  expect(notifications.error).toHaveBeenCalledExactlyOnceWith("Failed to copy code");
  expect(host.querySelector("button")!.disabled).toBe(false);
});
