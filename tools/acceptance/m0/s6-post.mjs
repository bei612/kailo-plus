// Step 6: in the channel, post a message that @mentions the linking doc.
export default async ({ page, shot, text }) => {
  await page.goto(process.env.M0_CHANNEL_URL, { waitUntil: 'load' });
  const composer = page.getByText(/Type @ to share with/).first();
  await composer.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('div[role="textbox"][contenteditable="true"]').last().click();
  await page.keyboard.type('Please review ', { delay: 20 });
  await page.keyboard.type('@M0 linking', { delay: 80 });
  await page.waitForTimeout(3500);
  await shot('32-channel-mention');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.keyboard.type(' before the M0 sign-off.', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  await shot('33-channel-posted');
  console.log((await text()).slice(-700));
};
