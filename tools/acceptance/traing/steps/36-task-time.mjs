// TASK-02 (time tracking) and TASK-01's board view. alice creates a task from the launcher (新建 → 任务), logs 1h 30m
// on it through its 时间 pill (记录时间 → 要记录的时长, log-time-input.tsx), runs its timer for a minute (开始计时 → 停止计时,
// task-timer-button.tsx), and the time API holds both entries (/dss/time/tasks/{id}/entries, /dss/time/timer). Then
// /app/tasks switches to 看板 (TasksControls.tsx 任务布局) and shows the task, and back to 列表.
import { newTask, token, track } from '../lib/collab.mjs';

async function entries(h, taskId) {
  const r = await h.api('alice', 'GET', `/dss/time/tasks/${taskId}/entries`);
  const list = Array.isArray(r.body) ? r.body : (r.body?.entries || r.body?.items || []);
  return { status: r.status, list, minutes: list.reduce((s, e) => s + (Number(e.minutes) || 0), 0) };
}

export default {
  id: '36-task-time',
  title: '任务工时：手动记录、计时器；任务看板视图（TASK-02、TASK-01）',
  covers: ['TASK-02', 'TASK-01'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 210,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    const title = `TG 工时验收 ${token('TGT')}`;
    const id = await newTask(h, 'alice', title);
    track(h, 'doc', id);
    h.check('从新建菜单建任务', !!id, a.url());
    if (!id) return;
    if (!a.url().includes(id)) { await a.goto(`${h.BASE}/app/drive/task/${id}`, { waitUntil: 'load' }); }
    await a.waitForTimeout(6000);

    // Manual entry: the 时间 pill, the length, Enter.
    await a.getByRole('button', { name: /^(记录时间|已记录时间：.*|Log time)$/ }).first().click();
    await a.waitForTimeout(1200);
    const len = a.getByLabel(/^(要记录的时长|Length to log)$/).first();
    const opened = await len.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    h.check('“时间”弹层打开（中文）', opened);
    if (opened) { await len.fill('1h 30m'); await a.waitForTimeout(600); await h.shot(a, 'log-time'); await len.press('Enter'); }
    await a.waitForTimeout(3000);
    let e = await entries(h, id);
    for (let i = 0; i < 4 && e.minutes < 90; i++) { await h.sleep(2000); e = await entries(h, id); }
    h.check('手动记录 90 分钟（工时 API）', e.status === 200 && e.list.some((x) => Number(x.minutes) === 90), { status: e.status, entries: e.list.map((x) => x.minutes) });
    await a.keyboard.press('Escape');

    // The timer: start, a running timer on this task, stop after a minute logs it.
    await a.getByRole('button', { name: /^(开始计时|Start timer)$/ }).first().click();
    await a.waitForTimeout(3000);
    const timer = await h.api('alice', 'GET', '/dss/time/timer');
    h.check('计时器在此任务上运行', timer.status === 200 && JSON.stringify(timer.body ?? '').includes(id), { status: timer.status, body: JSON.stringify(timer.body ?? '').slice(0, 200) });
    await h.shot(a, 'timer-running');
    await a.waitForTimeout(62000);
    await a.getByRole('button', { name: /^(停止计时|Stop timer)/ }).first().click();
    await a.waitForTimeout(1500);
    // Stopping may ask how to end it (停止并记录 / 丢弃): log it.
    const log = a.getByRole('menuitem', { name: /^(停止并记录|Stop and log)$/ }).or(a.getByRole('button', { name: /^(停止并记录|Stop and log)$/ }));
    if (await log.count()) await log.first().click();
    await a.waitForTimeout(3000);
    const after = await h.api('alice', 'GET', '/dss/time/timer');
    h.check('计时器已停止', !JSON.stringify(after.body ?? '').includes(id), JSON.stringify(after.body ?? '').slice(0, 200));
    e = await entries(h, id);
    for (let i = 0; i < 4 && e.list.length < 2; i++) { await h.sleep(2000); e = await entries(h, id); }
    h.check('计时记录了一条工时（≥ 1 分钟）', e.list.length >= 2 && e.minutes >= 91, { entries: e.list.map((x) => x.minutes) });
    await h.shot(a, 'time-logged');

    // Tasks board.
    await a.goto(`${h.BASE}/app/tasks`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    const board = a.getByRole('button', { name: /^(看板|Board)$/ }).first();
    h.check('任务视图有“看板”切换', (await board.count()) > 0);
    if (await board.count()) {
      await board.click(); await a.waitForTimeout(4000);
      h.check('看板已选中', (await board.getAttribute('aria-pressed')) === 'true');
      h.check('看板中显示该任务', (await h.text(a)).includes(title));
      await h.shot(a, 'tasks-board');
      await a.getByRole('button', { name: /^(列表|List)$/ }).first().click().catch(() => {});
      await a.waitForTimeout(2000);
    }
  },
};
