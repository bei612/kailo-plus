// DB-01: databases. alice creates a database from the launcher (新建 → 数据库, Launcher.tsx: POST /dss/databases), adds
// a record in its table (New record, database-editor-toolbar.tsx), gives the table a select column and two records
// through the database's SQL (POST /dss/databases/query, the same engine the Agents' QueryDatabase uses), and adds a
// Board view grouped by that column (New view → Board, database-toolbar.tsx). The API shows the rows and the view; the
// board shows both stages. The database screens' copy is English in this build (zh-CN gap, reported by this step as
// a warning, not a failure). AI questions need the model and are not part of this step.
import { createFromMenu, idInUrl, track } from '../lib/collab.mjs';
import { englishLeaks } from '../lib/util.mjs';

const sql = (h, id, statement) => h.api('alice', 'POST', '/dss/databases/query', { sql: statement, databaseId: id });
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

export default {
  id: '38-database',
  title: '数据库：新建、记录、选择列、看板视图（DB-01）',
  covers: ['DB-01'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 150,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    await createFromMenu(h, a, 'database');
    await a.waitForURL(/\/app\/(drive\/)?database\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    await a.waitForTimeout(5000);
    const id = idInUrl(a.url(), 'database');
    track(h, 'database', id);
    h.check('从新建菜单建数据库并打开', !!id, a.url());
    if (!id) return;
    const db = await h.api('alice', 'GET', `/dss/databases/${id}`);
    // DatabaseDetail.tables are TableDetail: { table: { id, name, … }, sql_name, columns, views } (crates/databases models.rs).
    const table = (db.body?.tables || [])[0]?.table;
    h.check('数据库有起始表（GET /dss/databases/{id}）', db.status === 200 && !!table?.name, { status: db.status, tables: (db.body?.tables || []).map((t) => t.table?.name) });
    if (!table?.name) return;
    const T = quote(table.name);
    await h.shot(a, 'database-new');

    // A record from the UI.
    await a.getByRole('button', { name: /^(New record|新建记录)$/ }).first().click();
    await a.waitForTimeout(3000);
    let rows = await sql(h, id, `SELECT * FROM ${T}`);
    h.check('界面新建了一条记录（SQL 读到 1 行）', rows.status === 200 && (rows.body?.result?.rowIds || []).length >= 1, { status: rows.status, rows: (rows.body?.result?.rowIds || []).length, err: rows.body?.message });

    // A select column and two named records.
    const alter = await sql(h, id, `ALTER TABLE ${T} ADD COLUMN "阶段" select OPTIONS ('待采购', '已到货')`);
    h.check('新增选择列“阶段”', alter.status === 200, alter.body?.message ?? alter.status);
    const ins = await sql(h, id, `INSERT INTO ${T} ("Name", "阶段") VALUES ('显示器', '待采购'), ('办公椅', '已到货')`);
    h.check('写入两条记录', ins.status === 200 && (ins.body?.insertedRowIds || []).length === 2, ins.body?.message ?? ins.body?.insertedRowIds);
    rows = await sql(h, id, `SELECT "Name", "阶段" FROM ${T} WHERE "阶段" = '已到货'`);
    h.check('按选择列筛选读回记录', rows.status === 200 && JSON.stringify(rows.body?.result?.rows ?? '').includes('办公椅'), rows.body?.result?.rows);

    // A board view from the UI.
    await a.reload({ waitUntil: 'load' }); await a.waitForTimeout(6000);
    const views0 = await a.locator('[data-view-id]').count();
    await a.getByRole('button', { name: /^(New view|新建视图)$/ }).first().click(); await a.waitForTimeout(1000);
    await a.getByRole('menuitem', { name: /^(Board|看板)$/ }).first().click()
      .catch(() => a.getByText(/^(Board|看板)$/).first().click());
    await a.waitForTimeout(5000);
    const views1 = await a.locator('[data-view-id]').count();
    h.check('新增了看板视图', views1 > views0, { before: views0, after: views1 });
    const text = await h.text(a);
    h.check('看板显示两条记录', text.includes('显示器') && text.includes('办公椅'));
    await h.shot(a, 'database-board', { fullPage: true });
    const after = await h.api('alice', 'GET', `/dss/databases/${id}`);
    h.check('视图已保存（API 含 board 视图）', /"board"|kanban/i.test(JSON.stringify(after.body ?? '')), after.status);
    const leaks = englishLeaks(text, ['New record', 'New view', 'Add column', 'Board', 'Table']);
    if (leaks.length) h.warn('数据库界面英文残留（zh-CN 缺口）', leaks);
  },
};
