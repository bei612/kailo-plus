// Screenshot of the web sign-in page only (zh-CN with M0_LOCALE=zh-CN).
export default async ({ page, shot, BASE }) => {
  await page.goto(`${BASE}/app/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot("60-web-login-c8d1");
};
