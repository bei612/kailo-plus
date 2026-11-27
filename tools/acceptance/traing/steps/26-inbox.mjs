// INBOX-01: the unified notification inbox. 24 @mentioned bob in a channel message and turned it into a task
// assigned to him; bob is notified of both (notification_service: channel_mention, task_assigned), sees them in 通知
// (/app/notifications, features/notifications-inbox: rows [data-notification-row], 提到了你 / 给你分配了任务), and marks
// the mention done (标记为已完成), which the notification service records. The home and activity pages open too.
import { findNotification, notifications } from '../lib/collab.mjs';

export default {
  id: '26-inbox',
  title: '通知收件箱：提及与任务指派通知、标记完成（INBOX-01）',
  covers: ['INBOX-01'],
  users: ['bob'],
  after: ['24'],
  locks: { 'ws:bob': 's' },
  est: 120,
  async run(h) {
    h.need('mention.messageId');
    const { messageId, taskId, token: tk } = h.S.mention;
    let n = { items: [] }; let mention = null; let assigned = null;
    for (let i = 0; i < 12 && !(mention && (assigned || !taskId)); i++) {
      n = await notifications(h, 'bob');
      mention = findNotification(n.items, 'channel_mention', messageId);
      if (taskId) assigned = findNotification(n.items, 'task_assigned', taskId);
      if (!(mention && (assigned || !taskId))) await h.sleep(5000);
    }
    h.check('bob 收到频道提及通知（channel_mention）', !!mention, { status: n.status, types: [...new Set(n.items.map((x) => x.notification_event_type))] });
    if (taskId) h.check('bob 收到任务指派通知（task_assigned）', !!assigned, taskId);
    else h.check('24 已从消息建任务', false, 'no taskId');

    const b = h.u('bob').page;
    await b.goto(`${h.BASE}/app/notifications`, { waitUntil: 'load' });
    h.check('通知页打开（未被重定向）', /\/app\/notifications/.test(b.url()), b.url());
    // The mention's row: a channel mention card is "<who> in <channel>" over the message itself, the mention shown as a
    // badge (notifications-inbox/primitives/describe-row.ts), so the row is the one holding the message's token and its
    // @mention. Rows load and settle asynchronously: read until it is there (or 30 s pass), not after a fixed wait.
    const rows = b.locator('[data-notification-row]');
    let texts = []; let mentionRow = -1;
    for (let i = 0; i < 15 && mentionRow < 0; i++) {
      await b.waitForTimeout(2000);
      texts = await rows.evaluateAll((els) => els.map((e) => e.innerText)).catch(() => []);
      mentionRow = texts.findIndex((t) => t.includes(tk) && /@/.test(t) && !/给你分配了任务|assigned you/i.test(t));
    }
    await h.shot(b, 'inbox');
    h.check('收件箱有提及 bob 的一行', mentionRow >= 0, texts.slice(0, 6).map((t) => t.slice(0, 80)));
    // describe-row.ts inPlace() joins who and where with a literal English " in " (zh-CN gap).
    if (mentionRow >= 0 && /\S in #/.test(texts[mentionRow])) h.warn('收件箱提及行英文残留（“in #频道”，zh-CN 缺口）', texts[mentionRow].slice(0, 80));
    h.check('收件箱有指派给 bob 的任务一行', texts.some((t) => /给你分配了任务|分配/.test(t)), texts.slice(0, 6).map((t) => t.slice(0, 80)));
    if (mentionRow < 0) return;
    const row = rows.nth(mentionRow);
    await row.hover(); await b.waitForTimeout(600);
    await row.getByRole('button', { name: /^(标记为已完成|Mark (as )?done)$/ }).first().click().catch((e) => h.warn('done button', e.message));
    await b.waitForTimeout(4000);
    await h.shot(b, 'inbox-after-done');
    let done = null;
    for (let i = 0; i < 5; i++) {
      done = findNotification((await notifications(h, 'bob', 'done')).items, 'channel_mention', messageId);
      if (done) break;
      await h.sleep(2000);
    }
    h.check('标记完成后通知状态为 done', !!done, done && { state: done.state });

    for (const [path, label] of [['/app/home', 'home'], ['/app/activity', 'activity']]) {
      await b.goto(`${h.BASE}${path}`, { waitUntil: 'load' }); await b.waitForTimeout(5000);
      h.check(`${label} 页打开`, b.url().includes(path), b.url());
      await h.shot(b, label);
    }
  },
};
