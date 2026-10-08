import { expect, it, vi } from "vitest";
import { act } from "react";
import { setLocale } from "../src/i18n";
import { ComposerReplyBanner, MessageRowSurface, MessageActionBarSurface, type TimelineMessage } from "../src/react/messages";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render, click } from "./render";
import { applyMessageEdits, imetaMediaFromTags, restoreImetaMediaDisplayLabels, stripImetaMediaLines, findSpoileredImetaMediaUrls } from "../src/react/messages";
import { resolveMessageMentionClipboard } from "../src/react/messages/resolveMentionNames";
import { buildMentionClipboardHtml, parseMentionClipboardRecords } from "../src/react/composer/features/messages/lib/mentionClipboard";

const message: TimelineMessage = { id: "message", pubkey: "author", author: "Alice", body: "Hello", createdAt: 1770000000, depth: 0, time: "", tags: [] };

it("copies only the original resolved identity, including reference tags, aliases and qualified duplicate names", () => {
  const first = "ab".repeat(32), second = "cd".repeat(32);
  const profiles = {
    [first]: {displayName:"Alex",name:"first",nip05Handle:"first-handle@buzz.example",avatarUrl:null,ownerPubkey:null},
    [second]: {displayName:"Alex",avatarUrl:null,nip05Handle:null,ownerPubkey:null},
  };
  const copy = (body: string, tags: string[][]) => {
    const html = buildMentionClipboardHtml(resolveMessageMentionClipboard(tags, profiles, body));
    return html ? parseMentionClipboardRecords(html) : [];
  };
  expect(copy("@first @first-handle", [["mention",first.toUpperCase()]])).toEqual([
    {label:"first",pubkey:first}, {label:"first-handle",pubkey:first},
  ]);
  expect(copy("@Alex", [["p",first],["p",second]])).toEqual([]);
  expect(copy(`@Alex @Alex (${second})`, [["p",first],["p",second]])).toEqual([
    {label:"Alex",pubkey:first}, {label:`Alex (${second})`,pubkey:second},
  ]);
  expect(copy(`@Alex (${second})`, [["p",first]])).not.toContainEqual({label:`Alex (${second})`,pubkey:second});
});

it("copying an edited message honors its latest body identity snapshot rather than historical recipients", () => {
  const old = "ab".repeat(32), current = "cd".repeat(32);
  const profiles = {
    [old]: {displayName:"Old",avatarUrl:null,nip05Handle:null,ownerPubkey:null},
    [current]: {displayName:"Current",avatarUrl:null,nip05Handle:null,ownerPubkey:null},
  };
  expect(resolveMessageMentionClipboard([["p",old],["buzz:mention-snapshot"],["mention",current]], profiles, "@Old @Current").identities)
    .toEqual([{label:"Current",pubkey:current}]);
  expect(resolveMessageMentionClipboard([["p",old],["buzz:mention-snapshot"]], profiles, "@Old").identities).toEqual([]);
  expect(resolveMessageMentionClipboard(undefined, profiles, "@Current").identities).toEqual([]);
  expect(resolveMessageMentionClipboard([["mention",current]], undefined, `@Current (${current})`).identities)
    .toEqual([{label:`Current (${current})`,pubkey:current}]);
});

it("keeps an ambiguous long mention plain without losing a separate unambiguous short mention", () => {
  const first = "ab".repeat(32), second = "cd".repeat(32), third = "ef".repeat(32);
  const profiles = Object.fromEntries([[first,"Sam"],[second,"Sam Lee"],[third,"Sam Lee"]].map(([pubkey, displayName]) =>
    [pubkey!, {displayName:displayName!,avatarUrl:null,nip05Handle:null,ownerPubkey:null}]));
  const tags = [["p",first],["p",second],["p",third]];
  expect(buildMentionClipboardHtml(resolveMessageMentionClipboard(tags, profiles, "@Sam Lee"))).toBeNull();
  const html = buildMentionClipboardHtml(resolveMessageMentionClipboard(tags, profiles, "@Sam Lee and @Sam"))!;
  expect(html).toContain("@Sam Lee and <span");
  expect(parseMentionClipboardRecords(html)).toEqual([{label:"Sam",pubkey:first}]);
});

it("overlays only the original author's same-channel latest edit while retaining row identity and ancestry", () => {
  const original = {id:"original",kind:9,pubkey:"alice",created_at:1,content:"before",tags:[["h","channel"],["e","root","","reply"],["p","bob"],["imeta","url old"]]};
  const edit = {id:"edit",kind:40003,pubkey:"alice",created_at:2,content:"after",tags:[["h","channel"],["e","original"],["p","carol"]]};
  const [result] = applyMessageEdits([original], [edit, {...edit,id:"old",created_at:0,content:"stale"},
    {...edit,id:"forged",created_at:8,pubkey:"mallory",content:"wrong author"},
    {...edit,id:"foreign",created_at:9,tags:[["h","other"],["e","original"]],content:"wrong scope"}]);
  expect(result).toEqual({...original,content:"after",tags:[["h","channel"],["e","root","","reply"],["p","bob"],["p","carol"]]});
  const unscoped = {...original,tags:[]};
  expect(applyMessageEdits([unscoped], [{...edit,tags:[["e","original"]]}])).toEqual([unscoped]);
});

it("restores original file labels and media spoilers without leaving media markdown in edited body", () => {
  const image = "https://relay.example/media/image.png";
  const file = "https://relay.example/media/report.pdf";
  const body = `Text\n\n||![image](${image})||\n[Report \\[final\\]](${file})`;
  const tags = [["imeta",`url ${image}`,"m image/png",`x ${"a".repeat(64)}`,"size 3"],
    ["imeta",`url ${file}`,"m application/pdf",`x ${"b".repeat(64)}`,"size 4","filename report.pdf"]];
  const media = restoreImetaMediaDisplayLabels(body, imetaMediaFromTags(tags));
  expect(media[1]?.displayLabel).toBe("Report [final]");
  expect(stripImetaMediaLines(body, media)).toBe("Text");
  expect([...findSpoileredImetaMediaUrls(body, media)]).toEqual([image]);
});

it("uses the original editing banner ahead of reply mode and retains Chinese/English cancel controls", async () => {
  const cancel = vi.fn();
  const host = await render(<ComposerReplyBanner isEditing replyTarget={message} onCancelEdit={cancel} />);
  await act(async () => setLocale("zh-CN"));
  expect(host.textContent).toContain("正在编辑消息");
  expect(host.textContent).not.toContain("正在回复");
  await click(host.querySelector<HTMLButtonElement>('[aria-label="取消编辑"]')!);
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => setLocale("en"));
  expect(host.textContent).toContain("Editing message");
});

it("opens the original edit menu and transfers focus only after its close handoff", async () => {
  const edit = vi.fn();
  const host = await render(<TooltipProvider><MessageActionBarSurface message={message} onCopyMessage={vi.fn()} onEdit={edit} /></TooltipProvider>);
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="more-actions-message"]')!;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown", bubbles:true})); });
  const item = document.querySelector<HTMLElement>('[data-testid="edit-message-message"]');
  expect(item).not.toBeNull();
  await click(item!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(edit).toHaveBeenCalledWith(message);
});

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
  await act(async () => setLocale("zh-CN"));
  expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Alice");
  expect(host.querySelector('[data-testid="message-send-status"]')?.textContent).toBe("发送中…");
  await act(async () => setLocale("en"));
  expect(host.querySelector('[data-testid="message-send-status"]')?.textContent).toBe("Sending…");
  expect(host.querySelector('[data-testid="copy-link-message-message"]')).toBeNull();
  expect(host.querySelector('[data-testid="more-actions-message"]')).toBeNull();
});

it("shares the original reply banner and cancel callback with reactive Chinese and English labels", async () => {
  const cancel = vi.fn();
  const host = await render(<ComposerReplyBanner replyTarget={message} onCancelReply={cancel} />);
  await act(async () => setLocale("zh-CN"));
  expect(host.textContent).toContain("正在回复 Alice");
  await click(host.querySelector<HTMLButtonElement>('[aria-label="取消回复"]')!);
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => setLocale("en"));
  expect(host.textContent).toContain("Replying to Alice");
  expect(host.querySelector('[aria-label="Cancel reply"]')).not.toBeNull();
});
