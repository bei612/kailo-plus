// Trial account check after the B-02a re-key: the existing account signs in through Keycloak with its original password
// (no provisioning), and its home lists its own content. No secret is printed.
export default async ({ page, shot, text, BASE }) => {
  const email = process.env.M0_EMAIL, password = process.env.M0_PASSWORD;
  // A fresh sign-in: the saved state may still hold a session, and the app never lets the network idle.
  await page.context().clearCookies();
  await page.goto(`${BASE}/app/login`, { waitUntil: "load" });
  await page.getByRole("button", { name: /^(Continue|继续)$/ }).click();
  await page.waitForURL(/\/idp\/realms\/kailo\//, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  const user = page.locator("input[name=username]");
  if (await user.count()) await user.fill(email);
  const pw = page.locator("input[name=password]");
  if (!(await pw.isVisible().catch(() => false))) {
    await page.locator("form").first().evaluate((f) => f.requestSubmit());
    await pw.waitFor({ timeout: 30000 });
  }
  await pw.fill(password);
  await Promise.all([
    page.waitForURL((u) => u.origin === BASE && u.pathname.startsWith("/app"), { timeout: 60000 }),
    page.locator("form").first().evaluate((f) => f.requestSubmit()),
  ]);
  await page.waitForTimeout(10000);
  console.log("URL", page.url());
  console.log("TEXT", (await text()).replace(/\s+/g, " ").slice(0, 1500));
  await shot("trial-01-home");
};
