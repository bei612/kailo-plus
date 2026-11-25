// Step 1 (Keycloak, B-01): provision the account through the admitted path (POST /internal/accounts, design 03 §1.3;
// there is no open self-registration), then sign in through the browser: Kailo login -> Continue -> Kailo-themed
// Keycloak page -> user name / password -> back in /app. No secret is printed.
export default async ({ page, shot, text, BASE }) => {
  const email = process.env.M0_EMAIL, password = process.env.M0_PASSWORD;
  const r = await fetch("http://authentication-service:8080/internal/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-auth-key": process.env.KAILO_INTERNAL_API_KEY },
    body: JSON.stringify({ email, email_verified: true, password, first_name: "M0", last_name: "Acceptance" }),
  });
  console.log("provision", r.status);
  if (!r.ok) throw new Error(`provisioning failed: HTTP ${r.status}`);
  await page.goto(`${BASE}/app/login`, { waitUntil: "networkidle" });
  await shot("01-login-page");
  const buttons = await page.getByRole("button").allInnerTexts();
  console.log("login buttons:", buttons.join(" | "));
  await page.getByRole("button", { name: /^(Continue|继续)$/ }).click();
  await page.waitForURL(/\/idp\/realms\/kailo\//, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await shot("02-keycloak-login");
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
  await page.waitForTimeout(8000);
  console.log("URL", page.url());
  console.log((await text()).slice(0, 600));
  await shot("03-after-login");
};
