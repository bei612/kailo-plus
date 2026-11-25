// Step 2: finish onboarding (workspace) until the app home. Actions in zh-CN (the deployment default since F-03a) and en,
// as in acceptance/f03a/first-login.mjs.
export default async ({ page, shot, text, BASE }) => {
  await page.goto(`${BASE}/app/`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 12; i++) {
    const url = page.url();
    const body = (await text()).replace(/\n/g, ' | ').slice(0, 300);
    console.log(`-- [${i}] ${url} :: ${body}`);
    if (!/onboarding|login/.test(url) && !/Create your workspace|Get started|创建你的工作区|开始使用/.test(body)) break;
    const name = page.getByLabel(/Workspace name|Team name|工作区名称/i);
    if (await name.count()) { await name.first().fill('Kailo M0 Acceptance'); }
    const btn = page.locator('button:not([disabled])')
      .filter({ hasText: /^\s*(开始使用|继续|暂时跳过|创建工作区|进入工作区|继续使用 Free|Get started|Continue|Create team|Create workspace|Next|Skip|Done|Not now|Later|Finish|Skip for now)/i }).first();
    if (!(await btn.count())) { await shot(`04-onboard-stuck-${i}`); break; }
    console.log('click:', (await btn.innerText()).trim());
    await btn.click();
    await page.waitForURL((u) => u.toString() !== url, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(`04-onboard-${i}`);
  }
  await page.waitForTimeout(3000);
  console.log('FINAL', page.url());
  console.log((await text()).slice(0, 1500));
  await shot('05-home');
};
