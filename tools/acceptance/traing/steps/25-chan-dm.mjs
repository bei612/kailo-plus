// CHAN-02: direct messages, with a person and with an Agent. alice starts each from the channels view (创建频道或私信 →
// 新建私信, ConversationsCreateMenu.tsx), names the recipient in the compose (RecipientSelector: an address and Enter, or
// the Agent picked by name) and sends; the DM is created on that first message (lib/core/util/channels.ts). The API
// agrees it is the DM of the two (POST /dss/channels/get_or_create_dm answers the same channel), bob reads alice's
// message in it, and @文档助理 answers in its DM. DMs persist across rounds (one per pair); only this run's messages,
// found by a one-time token, are read.
import { messages, token } from '../lib/collab.mjs';
import { AGENTS } from '../lib/ui.mjs';
import { workspaceMembers } from './22-channel.mjs';

/** From /app/channels: 新建私信, recipient `who` (committed by Enter, or picked by `pick`), then send `text`. */
async function startDm(h, user, who, text, pick) {
  const p = h.u(user).page;
  await p.goto(`${h.BASE}/app/channels`, { waitUntil: 'load' }); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: /^(创建频道或私信|Create channel or DM.*)$/ }).first().click();
  await p.waitForTimeout(1000);
  await p.getByText(/^(新建私信|New direct message|New DM)$/).first().click();
  await p.waitForTimeout(2500);
  const to = p.getByPlaceholder(/收件人|To:/).first();
  await to.click(); await to.pressSequentially(who, { delay: 40 }); await p.waitForTimeout(2500);
  const opt = pick ? p.getByText(pick).last() : null;
  if (opt && (await opt.count())) await opt.click(); else await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  await h.shot(p, `dm-compose-${pick ? 'agent' : 'person'}`);
  const box = p.locator('div[role="textbox"][contenteditable="true"]').last();
  await box.click(); await box.pressSequentially(text, { delay: 15 });
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/app\/channels?\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(4000);
  return p.url().match(/\/app\/channels?\/([0-9a-f-]{36})/)?.[1] ?? null;
}

export default {
  id: '25-chan-dm',
  title: '私信：与成员、与 Agent 的私信（CHAN-02）',
  covers: ['CHAN-02'],
  users: ['alice', 'bob'],
  after: ['20', '21'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'quota:W': 's', 'agent:tg-doc': 'x' },
  est: 240,
  async run(h) {
    h.need('W');
    const tk = token('TGD');
    const w = await workspaceMembers(h, 'alice');
    const bobId = w.people.find((p) => p.email === h.acc.bob.email.toLowerCase())?.id;
    h.check('找到 bob 的账号', !!bobId);
    if (!bobId) return;

    // With a person.
    const text = `周博，客户名单我私信发你，先别外传 ${tk}`;
    const dm = await startDm(h, 'alice', h.acc.bob.email, text);
    h.check('与 bob 的私信已建立并打开', !!dm, h.u('alice').page.url());
    if (!dm) return;
    const same = await h.api('alice', 'POST', '/dss/channels/get_or_create_dm', { recipient_id: bobId });
    h.check('私信即 alice 与 bob 的私信（get_or_create_dm 返回同一频道）', same.status < 300 && same.body?.channel_id === dm, same.body);
    const detail = await h.api('alice', 'GET', `/dss/channels/${dm}`);
    h.check('私信频道类型为 direct_message', /direct/i.test(String(detail.body?.channel?.channel_type ?? detail.body?.channel_type ?? '')), detail.body?.channel?.channel_type ?? detail.body?.channel_type);
    const b = h.u('bob').page;
    await b.goto(`${h.BASE}/app/channels/${dm}`, { waitUntil: 'load' }); await b.waitForTimeout(6000);
    h.check('bob 在私信里看到 alice 的消息', (await h.text(b)).includes(tk));
    await h.shot(b, 'dm-bob-view');
    const bm = await messages(h, 'bob', dm);
    h.check('bob 能读取私信消息（API）', bm.status === 200 && bm.items.some((x) => String(x.content).includes(tk)), bm.status);

    // With an Agent: it answers in the DM (its greeting, when it says hi first, is not the answer: the answer says 收到).
    const ag = AGENTS.doc;
    const ask = `你好，请只用一句中文回复“收到，私信已读”。${tk}-a`;
    const adm = await startDm(h, 'alice', ag.name, ask, ag.name);
    h.check(`与 @${ag.handle} 的私信已建立`, !!adm, h.u('alice').page.url());
    if (!adm) return;
    const t0 = Date.now(); let answer = null; let mine = null;
    while (Date.now() - t0 < h.cfg.askTimeoutS * 1000) {
      const items = (await messages(h, 'alice', adm)).items;
      mine = items.find((x) => String(x.content).includes(`${tk}-a`)) ?? mine;
      if (mine) answer = items.find((x) => x.sender_id !== mine.sender_id && Date.parse(x.created_at) > Date.parse(mine.created_at) && /收到/.test(String(x.content))) ?? null;
      if (answer) break;
      await h.sleep(10000);
    }
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/channels/${adm}`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    await h.shot(a, 'dm-agent');
    h.check(`@${ag.handle} 在私信里回复`, !!answer, answer && { sender: answer.sender_id, content: String(answer.content).slice(0, 200), seconds: Math.round((Date.now() - t0) / 1000) });
  },
};
