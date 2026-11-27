// CHAN-04 (threads, reactions, edits, deletes) in this round's channel, as a team uses it every day: alice posts, bob
// replies in the message's thread and reacts, alice edits her message (marked 已编辑) and deletes another one. Each
// action is done in the web (the message toolbar, Message/ActionMenu.tsx) and read back through the messages API
// (crates/messages: /dss/messages/channel/{cid}), and the other person sees it. Only this step's messages are read
// (found by a one-time marker), so other steps posting into the channel meanwhile do not matter.
import { compose, composing, findMessage, hoverMessage, messageAction, messages, openChannel, thread, token, waitMessage } from '../lib/collab.mjs';

export default {
  id: '23-chan-messages',
  title: '频道消息：话题回复、表情反应、编辑（已编辑）、删除（CHAN-04）',
  covers: ['CHAN-04'],
  users: ['alice', 'bob'],
  after: ['22'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', chan: 's' },
  est: 150,
  async run(h) {
    h.need('roundChannel', 'chanId');
    const cid = h.S.chanId;
    const tk = token('TGM');
    const rootText = `办公用品采购清单第一版已上传，请大家看看 ${tk}`;
    const a = h.u('alice').page; const b = h.u('bob').page;

    // alice posts; bob replies in its thread.
    // Each open-type-send holds the person's composers (composing): other steps type into this channel as alice too.
    await composing(h, 'alice', async () => compose(h, 'alice', await openChannel(h, 'alice', cid), [rootText]));
    const root = await waitMessage(h, 'alice', cid, tk);
    h.check('alice 发出的消息已在频道中', !!root, tk);
    if (!root) return;
    const replyText = `我来补充第二轮的上门名单 ${tk}-r`;
    await composing(h, 'bob', async () => {
      await openChannel(h, 'bob', cid);
      await messageAction(b, root.id, 'reply');
      const replyBox = b.locator(`[data-input-id="thread-reply-input-${root.id}"] div[role="textbox"][contenteditable="true"]`).first();
      const inline = await replyBox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
      // With the unified input (touch, or the flag on) the reply goes through the main composer in reply mode.
      await compose(h, 'bob', inline ? replyBox : b.locator('div[role="textbox"][contenteditable="true"]').last(), [replyText]);
    });
    await h.shot(b, 'thread-reply');
    let th = await thread(h, 'bob', cid, root.id);
    for (let i = 0; i < 5 && !th.replies.some((r) => String(r.content).includes(`${tk}-r`)); i++) { await h.sleep(2500); th = await thread(h, 'bob', cid, root.id); }
    h.check('bob 在该消息的话题里回复（API 话题含回复）', th.status === 200 && th.replies.some((r) => String(r.content).includes(`${tk}-r`)), { status: th.status, replies: th.replies.length });

    // bob reacts with 👍 from the toolbar.
    await messageAction(b, root.id, 'react-quick', '[data-emoji="👍"]');
    let m = null;
    for (let i = 0; i < 5; i++) {
      m = findMessage((await messages(h, 'alice', cid)).items, tk);
      if ((m?.reactions || []).some((r) => r.emoji === '👍')) break;
      await h.sleep(2000);
    }
    const thumbs = (m?.reactions || []).find((r) => r.emoji === '👍');
    h.check('bob 的 👍 反应已记录', !!thumbs && thumbs.users?.length >= 1, m?.reactions);
    await hoverMessage(b, root.id);
    await h.shot(b, 'reaction');

    // alice edits her message: Enter saves (InlineMessageEditor.tsx), the message reads （已编辑）.
    await openChannel(h, 'alice', cid);
    await messageAction(a, root.id, 'edit');
    const editor = a.locator(`[data-message-id="${root.id}"] div[contenteditable="true"]`).first();
    const editorOpen = await editor.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    h.check('编辑框打开', editorOpen);
    if (editorOpen) {
      await editor.click(); await a.keyboard.press('ControlOrMeta+a'); await a.keyboard.press('Backspace');
      await editor.pressSequentially(`办公用品采购清单第二版（已更新数量）${tk}`, { delay: 15 });
      await a.keyboard.press('Enter'); await a.waitForTimeout(3000);
    }
    let edited = null;
    for (let i = 0; i < 5; i++) {
      edited = findMessage((await messages(h, 'alice', cid)).items, tk);
      if (edited?.edited_at && /第二版/.test(edited.content)) break;
      await h.sleep(2000);
    }
    h.check('编辑已保存（edited_at、新内容）', !!edited?.edited_at && /第二版/.test(edited?.content || ''), edited && { edited_at: edited.edited_at, content: String(edited.content).slice(0, 80) });
    await b.reload({ waitUntil: 'load' }); await b.waitForTimeout(5000);
    const row = await hoverMessage(b, root.id);
    const rowText = await row.innerText().catch(() => '');
    h.check('bob 看到新内容和“（已编辑）”', /第二版/.test(rowText) && /已编辑/.test(rowText), rowText.slice(0, 200));
    await h.shot(b, 'edited');

    // alice deletes a second message of hers: the confirmation dialog (删除消息), then it is gone for bob too.
    const gone = `这条发错了，马上删除 ${tk}-x`;
    await composing(h, 'alice', async () => compose(h, 'alice', await openChannel(h, 'alice', cid), [gone]));
    const doomed = await waitMessage(h, 'alice', cid, `${tk}-x`);
    h.check('待删除的消息已发出', !!doomed);
    if (!doomed) return;
    await messageAction(a, doomed.id, 'delete');
    const dialog = a.getByRole('dialog').filter({ hasText: /删除消息|Delete message/ }).first();
    const asked = await dialog.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    const dialogText = asked ? await dialog.innerText() : '';
    h.check('删除前确认（删除消息）', asked && /删除消息/.test(dialogText), dialogText.slice(0, 120));
    await h.shot(a, 'delete-confirm');
    if (asked) await dialog.getByRole('button', { name: /^(删除|Delete)$/ }).last().click();
    await a.waitForTimeout(3000);
    // A deleted top-level message without replies leaves the timeline (pg_message_repo/timeline.rs); one still listed
    // carries deleted_at and no content.
    let after = null;
    for (let i = 0; i < 5; i++) {
      const items = (await messages(h, 'bob', cid)).items;
      after = items.find((x) => x.id === doomed.id) ?? null;
      if (!after || after.deleted_at) break;
      await h.sleep(2000);
    }
    h.check('消息已删除（API 不再列出或已标记删除）', !after || (!!after.deleted_at && !String(after.content).includes(`${tk}-x`)), after && { deleted_at: after.deleted_at });
    await b.goto(`${h.BASE}/app/channels/${cid}`, { waitUntil: 'load' }); await b.waitForTimeout(6000);
    h.check('bob 的频道里不再有被删除的消息', !(await h.text(b)).includes(`${tk}-x`));
    await h.shot(b, 'deleted');
  },
};
