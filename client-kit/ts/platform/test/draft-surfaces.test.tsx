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
it("uses the original detail action bar without shrinking it to the list controls", async () => {
  const open = vi.fn(); const send = vi.fn(); const remove = vi.fn();
  const actions = {onOpen: open, onSend: send, onDelete: remove, renderPreview: () => <span>retained draft</span>};
  const ui = await render(<TooltipProvider><DraftListSurface items={[item]} selectedKey={item.entry.key} onSelect={vi.fn()} {...actions} />
    <DraftDetailSurface item={item} {...actions} /></TooltipProvider>);
  const list = ui.querySelector('[data-testid="home-inbox-drafts-list"]')!;
  const listControls = [...list.querySelectorAll<HTMLButtonElement>('button[aria-label="Open draft"],button[aria-label="Send message"],button[aria-label="Delete draft"]')];
  expect(listControls).toHaveLength(3);
  for (const button of listControls) {
    expect(button.className).toContain("h-7 w-7 rounded-full p-0");
  }
  const bar = ui.querySelector('[data-testid="home-inbox-draft-action-bar"]')!;
  expect(bar.className).toBe("-m-1 p-1 opacity-100 transition-opacity duration-150 ease-out sm:pointer-events-none sm:opacity-0 sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100 sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100");
  const controls = [...bar.querySelectorAll<HTMLButtonElement>("button")];
  expect(controls.map(control => control.getAttribute("aria-label"))).toEqual(["Open draft", "Send message", "Delete draft"]);
  for (const control of controls) {
    expect(control.className).toContain("h-8 w-8 rounded-full p-0");
    expect(control.className).not.toContain("text-muted-foreground");
    expect(control.className).not.toContain("h-7");
  }
  expect(controls[2]!.className).toContain("text-destructive hover:text-destructive");
  await click(controls[0]!); expect(open).toHaveBeenCalledWith(item.entry);
  await click(controls[1]!); expect(send).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("#Original");
  await click([...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Cancel")!);
  expect(send).not.toHaveBeenCalled();
  await click(controls[1]!);
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Send message")!);
  expect(send).toHaveBeenCalledWith(item.entry);
  await click(controls[2]!); expect(remove).toHaveBeenCalledWith(item.entry.key);
});
