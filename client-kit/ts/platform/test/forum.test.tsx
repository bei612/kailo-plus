import { describe, expect, it, vi } from "vitest";
import { ForumView, type ForumViewProps } from "../src/react/forum/ForumView";
import { button, click, render } from "./render";
import { act } from "react";
import { DeleteActionMenu } from "../src/react/forum/DeleteActionMenu";
import { TransportError } from "../src/transport";
import { setLocale } from "../src/i18n";

const post = { eventId: "post", pubkey: "author", content: "Original post", createdAt: 1, tags: [] };
const base: ForumViewProps = {
  channelId: "channel", isMember: true, archived: false, posts: [], replies: [], selectedPostId: null,
  loading: false, hasMore: false, loadingMore: false, onMore: () => {}, onRetry: () => {}, onSelectPost: () => {},
  labels: { back: "Back", start: "Start", archived: "Archived", join: "Join", empty: "No posts", emptyHint: "Start discussion",
    noReplies: "No replies", more: "More", retry: "Retry", replies: (count) => `${count} replies` },
  formatTime: () => "now", renderAuthor: (message) => <span>{message.pubkey}</span>,
  renderContent: (message) => <p>{message.content}</p>, renderComposer: () => <div data-testid="real-host-composer" />,
};

describe("original Forum presentation with real host adapters", () => {
  it("keeps the forum composer closed to archived and non-member visits", async () => {
    const host = await render(<ForumView {...base} archived />);
    expect(button(host, "Archived").disabled).toBe(true);
    expect(host.querySelector("[data-testid=real-host-composer]")).toBeNull();
    const replyHost = await render(<ForumView {...base} isMember={false} selectedPostId="post" post={post} />);
    expect(replyHost.querySelector("[data-testid=real-host-composer]")).toBeNull();
  });
  it("opens the original full editor and preserves explicit query failures", async () => {
    const retry = vi.fn();
    const host = await render(<ForumView {...base} error="permission denied" onRetry={retry} />);
    expect(host.textContent).not.toContain("No posts");
    expect(host.querySelector("[role=alert]")!.textContent).toContain("permission denied");
    await click(button(host, "Retry")); expect(retry).toHaveBeenCalledTimes(1);
    expect(button(host, "Start").disabled).toBe(true);
    const admitted = await render(<ForumView {...base} />);
    await click(button(admitted, "Start")); expect(admitted.querySelector("[data-testid=real-host-composer]")).not.toBeNull();
  });
  it("renders the original root/reply structure and wires navigation and next page", async () => {
    const back = vi.fn(); const more = vi.fn();
    const host = await render(<ForumView {...base} selectedPostId="post" post={post}
      replies={[{...post, eventId: "reply", content: "Reply body"}]} hasMore onMore={more} onSelectPost={back} />);
    expect(host.querySelector("[data-forum-event-id=post]")!.textContent).toContain("Original post");
    expect(host.querySelector("[data-forum-event-id=reply]")!.textContent).toContain("Reply body");
    expect(host.querySelector("[data-testid=real-host-composer]")).not.toBeNull();
    await click(button(host, "More")); expect(more).toHaveBeenCalledTimes(1);
    await click(button(host, "Back")); expect(back).toHaveBeenCalledWith(null);
  });
});

async function openDelete(reply: boolean, confirm: () => Promise<void>) {
  setLocale("en");
  const host = await render(<DeleteActionMenu reply={reply} onConfirm={confirm} />);
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true})));
  await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
  return document.querySelector<HTMLElement>('[role="alertdialog"]')!;
}

it("keeps the original deletion confirmation open until a confirmed result", async () => {
  let resolve!: () => void;
  const confirm = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const dialog = await openDelete(false, confirm);
  await click(button(dialog, "Delete post"));
  expect(button(dialog, "Deleting…").disabled).toBe(true);
  expect(button(dialog, "Cancel").disabled).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("presents an unknown deletion neutrally and checks the same host intent", async () => {
  const confirm = vi.fn().mockRejectedValueOnce(new TransportError("lost acknowledgement")).mockResolvedValue(undefined);
  const dialog = await openDelete(true, confirm);
  await click(button(dialog, "Delete reply"));
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain("Deletion outcome unknown");
  expect(dialog.querySelector('[role="alert"]')).toBeNull();
  await click(button(dialog, "Check deletion"));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("keeps a definite rejection visible without claiming content removal", async () => {
  const dialog = await openDelete(false, vi.fn().mockRejectedValue(new Error("denied")));
  await click(button(dialog, "Delete post"));
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("not been removed");
  expect(button(dialog, "Delete post").disabled).toBe(false);
});

it("uses the same original delete control in Chinese", async () => {
  setLocale("zh-CN");
  const host = await render(<DeleteActionMenu reply onConfirm={async () => {}} />);
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("删除回复");
});
