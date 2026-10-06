import { expect, it, vi } from "vitest";
import { MessageRowSurface, MessageActionBarSurface, type TimelineMessage } from "../src/react/messages";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render, click } from "./render";

const message: TimelineMessage = { id: "message", pubkey: "author", author: "Alice", body: "Hello", createdAt: 1770000000, depth: 0, time: "", tags: [] };

it("keeps the original avatar, author, timestamp, measured hover rail and actual copy action", async () => {
  const copy = vi.fn();
  const host = await render(<TooltipProvider><MessageRowSurface message={message}
    renderBody={(className) => <p className={className}>{message.body}</p>}
    renderActions={(ref) => <MessageActionBarSurface ref={ref} message={message} onCopyMessage={copy} onCopyLink={copy} />} /></TooltipProvider>);
  expect(host.querySelector('[data-testid="message-row"]')?.className).toContain("group/message");
  expect(host.querySelector('[data-testid="message-avatar"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Alice");
  expect(host.querySelector('[data-testid="message-timestamp"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="message-header"]')?.className).toContain("--message-action-rail-width");
  expect(host.querySelector('[data-testid="reply-message-message"]')).toBeNull();
  await click(host.querySelector<HTMLButtonElement>('[data-testid="copy-link-message-message"]')!);
  expect(copy).toHaveBeenCalledWith(message);
});

it("uses the original continuation timestamp gutter without repeating avatar or author", async () => {
  const host = await render(<MessageRowSurface message={message} isContinuation renderBody={() => message.body} />);
  expect(host.querySelector('[data-testid="message-avatar"]')).toBeNull();
  expect(host.querySelector('[data-testid="message-author"]')).toBeNull();
  expect(host.querySelector('[data-testid="message-timestamp"]')?.className).toContain("group-hover/message:opacity-100");
});

it("keeps pending sends ungrouped and prevents delivered-message copy actions", async () => {
  const pending = { ...message, pending: true };
  const host = await render(<TooltipProvider><MessageRowSurface message={pending} isContinuation renderBody={() => pending.body}
    renderActions={(ref) => <MessageActionBarSurface ref={ref} message={pending} onCopyMessage={vi.fn()} onCopyLink={vi.fn()} />} /></TooltipProvider>);
  expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Alice");
  expect(host.querySelector('[data-testid="message-send-status"]')?.textContent).toBe("Sending…");
  expect(host.querySelector('[data-testid="copy-link-message-message"]')).toBeNull();
  expect(host.querySelector('[data-testid="more-actions-message"]')).toBeNull();
});
