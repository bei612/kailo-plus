import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { DraftListSurface, DraftDetailSurface, type DraftSurfaceItem } from "../src/react/draft-surfaces";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { click, render } from "./render";

const item: DraftSurfaceItem = {entry: {key: "workspace", draft: {content: "retained draft", channelId: "workspace", selectionStart: 0, selectionEnd: 0,
  createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", pendingImeta: [], spoileredAttachmentUrls: [], status: "active"}},
  channelLabel: "#Original", createdAt: "10:00", isPrivate: false, isOrphaned: false, canOpen: true, canSend: true};
beforeEach(() => setLocale("en"));
it("keeps the original row/detail actions and requires confirmation before sending", async () => {
  const open = vi.fn(); const send = vi.fn(); const select = vi.fn(); const remove = vi.fn();
  const host = await render(<TooltipProvider><DraftListSurface items={[item]} selectedKey={null} onSelect={select}
    onOpen={open} onSend={send} onDelete={remove} renderPreview={(draft) => <span>{draft.content}</span>} /></TooltipProvider>);
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')!);
  expect(open).toHaveBeenCalledWith(item.entry); expect(select).not.toHaveBeenCalled();
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!);
  expect(send).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("#Original");
  await click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Send message")!);
  expect(send).toHaveBeenCalledWith(item.entry);
});
it("does not discard an unresolved publication intent from either original draft surface", async () => {
  const unknown = {...item, entry: {...item.entry, draft: {...item.entry.draft, sendIntent: {key: "frozen", signature: "signature"}}}};
  const remove = vi.fn(); const actions = {onOpen: vi.fn(), onSend: vi.fn(), onDelete: remove, renderPreview: () => <span>draft</span>};
  const host = await render(<TooltipProvider><DraftListSurface items={[unknown]} selectedKey={unknown.entry.key} onSelect={vi.fn()} {...actions} />
    <DraftDetailSurface item={unknown} {...actions} /></TooltipProvider>);
  const deletes = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Delete draft"]')];
  expect(deletes).toHaveLength(2);
  for (const button of deletes) { expect(button.disabled).toBe(true); await click(button); }
  expect(remove).not.toHaveBeenCalled();
});
