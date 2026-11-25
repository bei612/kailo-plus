// Kailo M0 acceptance harness (playwright-core 1.62 in mcr.microsoft.com/playwright:v1.62.0-noble, --network host).
// usage: node run.mjs <state.json> <steps.mjs>   env: KAILO_URL, MAILPIT_URL, SHOTS
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BASE = process.env.KAILO_URL;
const MAILPIT = process.env.MAILPIT_URL;
const SHOTS = process.env.SHOTS || '/w/shots';
const [stateFile, stepsFile] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, locale: process.env.M0_LOCALE || "en-US",
  storageState: fs.existsSync(stateFile) ? stateFile : undefined,
});
const page = await ctx.newPage();
const errors = [];
page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
const shot = async (n) => { await page.screenshot({ path: `${SHOTS}/${n}.png` }); console.log('SHOT', n); };
const text = async () => (await page.innerText('body')).replace(/\n{2,}/g, '\n').slice(0, 3000);
const mailCode = async (email, after = 0) => {
  for (let i = 0; i < 60; i++) {
    const j = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
    const m = (j.messages || []).find((x) => Date.parse(x.Created) > after);
    if (m) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      return (full.Text || '').match(/\b\d{6}\b/)?.[0];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
};
const steps = (await import(stepsFile)).default;
let ok = true;
try { await steps({ page, ctx, shot, text, mailCode, BASE }); }
catch (e) { ok = false; console.log('STEP ERROR', e.message.slice(0, 600)); await shot('error-' + Date.now()); }
finally {
  console.log('5xx:', [...new Set(errors)].join('\n  '));
  await ctx.storageState({ path: stateFile });
  await browser.close();
}
process.exit(ok ? 0 : 1);
