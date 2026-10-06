import { expect, it, vi } from "vitest";
import { ChatHeader } from "../src/react/messages/chat-header";
import { setLocale } from "../src/i18n";
import { render, click } from "./render";

it("renders the actual admitted title, description and original status surface", async () => {
  setLocale("zh-CN");
  const copy = vi.fn(async () => {});
  const host = await render(<ChatHeader title="  研发频道  " description="  频道介绍  "
    leadingContent={<span data-glyph />} statusBadge={<span>归档</span>} onCopyTitle={copy} />);
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("  研发频道  ");
  expect(host.querySelector("h1")?.getAttribute("title")).toBe("频道介绍");
  expect(host.querySelector("[data-glyph]")).not.toBeNull();
  expect(host.textContent).toContain("归档");
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("aria-label")).toContain("研发频道");
  await click(button);
  expect(copy).toHaveBeenCalledExactlyOnceWith("研发频道");
});

it("retains English copy affordance and does not copy an empty title", async () => {
  setLocale("en");
  const copy = vi.fn(async () => {});
  const host = await render(<ChatHeader title=" " leadingContent={null} onCopyTitle={copy} />);
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("title")).toMatch(/copy/i);
  await click(button);
  expect(copy).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.hasAttribute("title")).toBe(false);
});
