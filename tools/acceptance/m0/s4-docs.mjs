// Step 4: create the referenced doc, then a doc that @mentions it and the task.
import { createFromMenu } from './create-menu.mjs';
const newDoc = async (page, title) => {
  await page.goto(`${process.env.KAILO_URL}/app/home`, { waitUntil: 'load' });
  await page.getByText(/^(What should we work on\?|我们应该处理什么？)$/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await createFromMenu(page, 'd');
  await page.waitForURL(/\/app\/drive\/md\//, { timeout: 30000 });
  // The body editor mounts once the document's sync session is open: until then only the title and the comment box
  // are editable (a skeleton stands in for the body).
  const eds = page.locator('[contenteditable=true]');
  await page.waitForFunction(() => document.querySelectorAll('[contenteditable=true]').length >= 3, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await eds.nth(0).click();
  await page.keyboard.type(title, { delay: 25 });
  await eds.nth(1).click();
  await page.waitForTimeout(500);
  return page.url();
};
const mention = async (page, shot, query, label) => {
  await page.keyboard.type('@', { delay: 50 });
  await page.keyboard.type(query, { delay: 80 });
  await page.waitForTimeout(3500);
  await shot(label);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
};
export default async ({ page, shot, text }) => {
  const a = await newDoc(page, 'M0 referenced doc');
  await page.keyboard.type('This document is the target of the M0 backlink check.', { delay: 15 });
  await page.waitForTimeout(4000);
  await shot('20-docA');
  console.log('DOC_A', a);

  const b = await newDoc(page, 'M0 linking doc');
  await page.keyboard.type('This doc links to ', { delay: 15 });
  await mention(page, shot, 'M0 referenced', '21-docB-mention-doc');
  await page.keyboard.type(' and to the task ', { delay: 15 });
  await mention(page, shot, 'M0 acceptance task', '22-docB-mention-task');
  await page.keyboard.type(' for the M0 run.', { delay: 15 });
  await page.waitForTimeout(6000);
  await shot('23-docB');
  console.log('DOC_B', b);
  console.log((await text()).slice(0, 1200));
};
