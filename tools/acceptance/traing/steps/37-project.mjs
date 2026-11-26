// PROJ-01: projects. alice creates a project on 项目 (/app/projects → 新建项目, create-project.tsx: 项目名称, 创建项目),
// opens its 任务 section and adds a new task to it (添加任务 → 新建任务, add-project-tasks.tsx); the project API
// (/dss/initiatives, the backend's name for projects) holds the project and lists the task, and the task carries the
// project property.
import { fillTaskComposer, PROP, taskProperty, token, track } from '../lib/collab.mjs';
import { findByTitle } from '../lib/util.mjs';

export default {
  id: '37-project',
  title: '项目：新建项目、在项目中建任务（PROJ-01）',
  covers: ['PROJ-01'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 150,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    const tk = token('TGJ');
    const name = `TG 采购项目 ${tk}`;
    await a.goto(`${h.BASE}/app/projects`, { waitUntil: 'load' }); await a.waitForTimeout(5000);
    await a.getByRole('button', { name: /^(新建项目|New project)$/ }).first().click(); await a.waitForTimeout(2000);
    const field = a.getByLabel(/^(项目名称|Project name)$/).first();
    const opened = await field.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    h.check('新建项目表单打开（中文）', opened);
    if (!opened) return;
    await field.fill(name);
    await h.shot(a, 'project-form');
    await a.getByRole('button', { name: /^(创建项目|Create project)$/ }).first().click();
    await a.waitForTimeout(5000);
    let pid = null;
    for (let i = 0; i < 5 && !pid; i++) {
      const list = await h.api('alice', 'GET', '/dss/initiatives');
      pid = findByTitle(list.body, new RegExp(tk))[0]?.id ?? null;
      if (!pid) await h.sleep(2000);
    }
    track(h, 'initiative', pid);
    h.check('项目已创建（/dss/initiatives）', !!pid, name);
    if (!pid) return;
    await h.shot(a, 'project-created');

    await a.goto(`${h.BASE}/app/projects/${pid}/tasks`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    // The task list's own 新建任务 button (new-project-task.tsx), or the 添加任务 menu's 新建任务 (add-project-tasks.tsx);
    // both open the task composer with the project set.
    const direct = a.getByRole('button', { name: /^(新建任务|New task)$/ }).first();
    if (await direct.count()) await direct.click();
    else {
      await a.getByRole('button', { name: /^(添加任务|Add task)/ }).first().click(); await a.waitForTimeout(1200);
      await a.getByRole('menuitem', { name: /^(新建任务|New task)$/ }).first().click()
        .catch(() => a.getByText(/^(新建任务|New task)$/).first().click());
    }
    await a.waitForTimeout(2000);
    const title = `TG 项目任务 ${tk}`;
    const taskId = await fillTaskComposer(h, 'alice', title);
    track(h, 'doc', taskId);
    h.check('在项目中新建任务', !!taskId, title);
    if (!taskId) return;
    let detail = null;
    for (let i = 0; i < 5; i++) {
      detail = await h.api('alice', 'GET', `/dss/initiatives/${pid}`);
      if (JSON.stringify(detail.body ?? '').includes(taskId)) break;
      await h.sleep(2000);
    }
    h.check('项目的任务列表含该任务', JSON.stringify(detail?.body ?? '').includes(taskId), { status: detail?.status, taskIds: detail?.body?.taskIds });
    const pp = await taskProperty(h, 'alice', taskId, PROP.PROJECT);
    h.check('任务的“项目”属性指向该项目', JSON.stringify(pp.prop?.value ?? '').includes(pid), pp.prop?.value);
    await a.goto(`${h.BASE}/app/projects/${pid}/tasks`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    h.check('项目任务页显示该任务', (await h.text(a)).includes(title));
    await h.shot(a, 'project-tasks');
  },
};
