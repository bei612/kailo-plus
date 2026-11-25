// Step 7: open a referenced document and show its References (backlinks) in the side panel.
const open = async (page, shot, text, url, label) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  const refs = page.getByText(/^(References|引用了)/).first();
  if (!(await refs.isVisible().catch(() => false))) {
    const labels = await page.locator('button[aria-label]').evaluateAll((els) =>
      els.map((e) => [e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().x), Math.round(e.getBoundingClientRect().y)]));
    console.log(label, 'buttons', JSON.stringify(labels.filter((l) => l[2] < 60)));
    const toggle = page.locator('button[aria-label]').filter({ hasText: '' })
      .and(page.locator('[aria-label*="panel" i], [aria-label*="sidebar" i], [aria-label*="details" i]')).last();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(4000); }
  }
  const section = page.getByText(/^(References|引用了)/).first();
  if (await section.isVisible().catch(() => false)) { await section.click().catch(() => {}); await page.waitForTimeout(3000); }
  await shot(label);
  console.log(label, (await text()).slice(0, 1500).replace(/\n/g, ' | '));
};
export default async ({ page, shot, text }) => {
  await open(page, shot, text, process.env.M0_DOC_URL, process.env.M0_SHOT || '40-backlinks');
};
