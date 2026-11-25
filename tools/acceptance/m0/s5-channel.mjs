// Step 5: create a channel and post a message that @mentions the linking doc.
import { createFromMenu } from './create-menu.mjs';
export default async ({ page, shot, text, BASE }) => {
  await page.goto(`${BASE}/app/home`, { waitUntil: 'load' });
  await page.getByText(/^(What should we work on\?|我们应该处理什么？)$/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await createFromMenu(page, 'channel');
  await page.waitForTimeout(2500);
  await shot('30-channel-form');
  await page.getByPlaceholder(/Feature Requests|产品讨论/).fill(process.env.M0_CHANNEL || 'm0-acceptance');
  for (let i = 0; i < 5; i++) {
    const b = page.getByRole('button', { name: /^(Next|Create|Create channel|Skip|Skip for now|Done|下一步|创建|创建频道|跳过|暂时跳过|完成)$/i }).last();
    if (!(await b.count())) break;
    console.log('click', (await b.innerText()).trim());
    await b.click(); await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(4000);
  console.log('URL', page.url());
  await shot('31-channel');
  await page.locator('div[role="textbox"][contenteditable="true"]').last().click();
  await page.keyboard.type('Please review ', { delay: 20 });
  await page.keyboard.type('@M0 linking', { delay: 80 });
  await page.waitForTimeout(3500);
  await shot('32-channel-mention');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.keyboard.type(' before the M0 sign-off.', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  await shot('33-channel-posted');
  console.log((await text()).slice(-900));
};
