// Step 8: the same account in a zh-CN browser: home, a document and the channel in Chinese, then Settings > Appearance
// (Kailo theme). Run with M0_LOCALE=zh-CN.
export default async ({ page, shot, text, BASE }) => {
  await page.goto(`${BASE}/app/home`, { waitUntil: "load" });
  await page.waitForTimeout(8000);
  await shot("50-home-zh");
  console.log("HOME", (await text()).slice(0, 400).replace(/\n/g, " | "));
  for (const [url, label] of [[process.env.M0_DOC_URL, "51-doc-zh"], [process.env.M0_CHANNEL_URL, "52-channel-zh"]]) {
    if (!url) continue;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(8000);
    await shot(label);
  }
  await page.goto(`${BASE}/app/home`, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  await page.locator("body").click({ position: { x: 900, y: 120 } });
  await page.keyboard.press("Control+;");
  await page.waitForTimeout(2500);
  const tab = page.getByText(/^(外观|Appearance)$/).first();
  await tab.click();
  await page.waitForTimeout(2500);
  await shot("53-settings-appearance-zh");
  console.log("APPEARANCE", (await text()).slice(0, 900).replace(/\n/g, " | "));
  const lang = await page.evaluate(() => document.documentElement.lang);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-accent") || getComputedStyle(document.documentElement).getPropertyValue("--accent"));
  console.log("html lang", lang, "accent", accent.trim());
};
