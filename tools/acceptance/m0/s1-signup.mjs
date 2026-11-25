// Step 1: register a new account by email code, create the workspace.
export default async ({ page, shot, text, mailCode, BASE }) => {
  const email = process.env.M0_EMAIL;
  await page.goto(`${BASE}/app/login`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await shot('01-login-page');
  await page.getByText(/Continue with email/i).click();
  await page.waitForTimeout(1000);
  const input = page.locator('input').first();
  await input.fill(email);
  await shot('02-login-email');
  const sentAt = Date.now() - 5000;
  await input.press('Enter');
  const code = await mailCode(email, sentAt);
  if (!code) throw new Error('no sign-in code arrived in Mailpit');
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  if ((await inputs.count()) > 1) { await inputs.first().click(); await page.keyboard.type(code, { delay: 60 }); }
  else { await inputs.first().fill(code); await inputs.first().press('Enter'); }
  await page.waitForTimeout(8000);
  console.log('URL', page.url());
  console.log((await text()).slice(0, 800));
  await shot('03-after-code');
};
