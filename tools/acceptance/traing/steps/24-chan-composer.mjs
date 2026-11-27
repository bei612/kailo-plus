// CHAN-03 (the composer: @mentions, attachments, drafts) and CHAN-05 (the channel's 附件 tab, message → task) in this
// round's channel. alice keeps an unsent draft across leaving the channel (Input/shared-draft.ts: per-channel
// localStorage), sends a message @mentioning bob with an image attached (+ → 添加附件, ComposerAddMenu.tsx), finds it in
// the channel's 附件 tab, and turns the message into a task (the toolbar's 任务, Channel.tsx onCreateTask: the message's
// text as title, the mentioned people as assignees). The API shows the mention, the attachment and bob as the task's
// assignee. 26 checks that bob is notified of both.
import { compose, composing, fillTaskComposer, messageAction, openChannel, mentionsUser, PROP, pngBytes, taskProperty, token, track, waitMessage } from '../lib/collab.mjs';
import { channelTab, findDocs } from '../lib/ui.mjs';
import { workspaceMembers } from './22-channel.mjs';

export default {
  id: '24-chan-composer',
  title: '输入框：草稿保留、@提及、附件、附件页签、消息转任务（CHAN-03、CHAN-05）',
  covers: ['CHAN-03', 'CHAN-05'],
  users: ['alice', 'bob'],
  after: ['22'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', chan: 's' },
  est: 180,
  async run(h) {
    h.need('roundChannel', 'chanId');
    const cid = h.S.chanId;
    const a = h.u('alice').page;
    const tk = token('TGC');
    const w = await workspaceMembers(h, 'alice');
    const bobId = w.people.find((p) => p.email === h.acc.bob.email.toLowerCase())?.id;
    h.check('找到 bob 的账号', !!bobId);
    if (!bobId) return;

    // Draft: typed, not sent, still there after leaving and coming back. Until the message below is sent this step is
    // alice's only composer (composing): the stored draft is shared by all her pages.
    await composing(h, 'alice', async () => {
      let box = await openChannel(h, 'alice', cid);
      const draft = `草稿：采购预算待定 ${tk}-d`;
      await compose(h, 'alice', box, [draft], { send: false });
      await a.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await a.waitForTimeout(3000);
      box = await openChannel(h, 'alice', cid);
      const kept = (await box.innerText().catch(() => '')).includes(`${tk}-d`);
      const stored = await a.evaluate((k) => localStorage.getItem(k) || '', `input-value-channel:${cid}-persist-v0`).catch(() => '');
      h.check('离开频道再回来，未发送的草稿仍在', kept, { editor: kept, localStorage: stored.includes(`${tk}-d`) });
      await h.shot(a, 'draft-kept');
      await box.click(); await a.keyboard.press('ControlOrMeta+a'); await a.keyboard.press('Backspace'); await a.waitForTimeout(800);

      // A message @mentioning bob, with an image attached through the composer's file input.
      // The composer's 添加 (+) menu → 添加附件 opens the system file picker (ComposerAddMenu.tsx; ChannelInput.tsx
      // addMenuGroups 'attach' → create-collapsed-input-state.ts): the file goes to that chooser.
      const scope = a.locator(`[data-input-id="channel-input-${cid}"]`);
      const plus = (await scope.count()) ? scope.getByRole('button', { name: /^(添加|Add)$/ }).first() : a.getByRole('button', { name: /^(添加|Add)$/ }).last();
      await plus.click(); await a.waitForTimeout(800);
      const chooser = a.waitForEvent('filechooser', { timeout: 15000 });
      await a.getByRole('menuitem', { name: /^(添加附件|Attach files)/ }).first().click();
      await (await chooser).setFiles({ name: `采购清单-${tk}.png`, mimeType: 'image/png', buffer: pngBytes() });
      await a.waitForTimeout(4000);
      await h.shot(a, 'attachment-staged');
      await compose(h, 'alice', box, ['请 ', { mention: '博', pick: /周博|博 周|博周/ }, ` 核对采购清单 ${tk}`]);
    });
    await a.waitForTimeout(3000);
    const m = await waitMessage(h, 'alice', cid, tk);
    h.check('带提及与附件的消息已发出', !!m, tk);
    if (!m) return;
    h.S.mention = { messageId: m.id, channelId: cid, token: tk };
    h.saveState();
    h.check('消息 @提及了 bob（mentions / 内容）', mentionsUser(m, bobId), { mentions: m.mentions, content: String(m.content).slice(0, 160) });
    h.check('消息带一个附件', (m.attachments || []).length >= 1, m.attachments);
    await h.shot(a, 'mention-attachment-sent');

    // The channel's attachments tab lists it (GET /dss/channels/{cid}/attachments).
    const att = await h.api('alice', 'GET', `/dss/channels/${cid}/attachments?limit=50`);
    h.check('频道附件列表含该消息的附件', att.status === 200 && (att.body?.items || []).some((x) => x.message_id === m.id), { status: att.status, n: (att.body?.items || []).length });
    const tab = await channelTab(a, 'attachments');
    await a.waitForTimeout(4000);
    h.check('打开频道“附件”页签', tab);
    await h.shot(a, 'attachments-tab');
    await channelTab(a, 'messages'); await a.waitForTimeout(3000);

    // Message → task: prefilled with the message's text and bob as the assignee.
    await messageAction(a, m.id, 'create-task');
    await h.shot(a, 'task-from-message');
    const titleText = await a.locator('[data-task-composer-title]').first().innerText().catch(() => '');
    h.check('任务标题预填为消息内容', titleText.includes(tk), titleText.slice(0, 120));
    // The composer opens as a popover, so the route may not change: the task is then found by the message's token.
    let taskId = await fillTaskComposer(h, 'alice', '');
    for (let i = 0; i < 6 && !taskId; i++) {
      taskId = (await findDocs(h, 'alice', new RegExp(tk)))[0]?.id ?? null;
      if (!taskId) await h.sleep(3000);
    }
    track(h, 'doc', taskId);
    h.check('从消息新建了任务', !!taskId, a.url());
    if (!taskId) return;
    h.S.mention.taskId = taskId;
    h.saveState();
    let as = null;
    for (let i = 0; i < 5; i++) {
      as = await taskProperty(h, 'alice', taskId, PROP.ASSIGNEES);
      if (JSON.stringify(as.prop?.value ?? '').toLowerCase().includes(bobId.toLowerCase())) break;
      await h.sleep(2000);
    }
    h.check('任务指派给消息里提及的 bob', JSON.stringify(as?.prop?.value ?? '').toLowerCase().includes(bobId.toLowerCase()), { status: as?.status, value: as?.prop?.value });
    await a.waitForTimeout(2000);
    await h.shot(a, 'task-created');
  },
};
