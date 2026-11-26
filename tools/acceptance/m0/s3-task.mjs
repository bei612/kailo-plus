// Step 3: create a task.
import { createFromMenu } from './create-menu.mjs';
export default async ({ page, shot, text, BASE }) => {
  await page.goto(`${BASE}/app/home`, { waitUntil: 'load' });
  await page.getByText(/^(What should we work on\?|我们应该处理什么？)$/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await createFromMenu(page, 'task');
  await page.waitForTimeout(2500);
  await shot('10-task-form');
  console.log((await text()).slice(-600));
  // Type into the title itself (the composer marks it data-task-composer-title, new-task-title-focus.ts), not into
  // whatever holds focus: the title autofocuses, but a key that reached it first moves focus to the description.
  const title = page.locator('[data-task-composer-title] [contenteditable="true"]').first();
  await title.waitFor({ state: 'visible', timeout: 15000 });
  await title.click();
  await page.keyboard.type('M0 acceptance task', { delay: 30 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Create Task|创建任务/i }).click();
  await page.waitForTimeout(5000);
  console.log('URL', page.url());
  await shot('11-task-created');
  console.log((await text()).slice(0, 800));
};
