// The global create menu (key `c` on home) and one of its entries by its in-menu key: d document, t task, g channel.
// The menu is opened and seen before the entry key is pressed — a blind key after `c` goes to whatever holds focus
// (the home composer's Enter binding focused the prompt instead of creating a document, 2026-11-25 official r2).
const MENU_ENTRY = /^(Document|文档)$/;

export async function createFromMenu(page, key, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.locator('body').click({ position: { x: 900, y: 120 } });
    await page.keyboard.press('c');
    const opened = await page.getByText(MENU_ENTRY).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    if (opened) {
      await page.keyboard.press(key);
      return;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`the create menu did not open after ${attempts} attempts`);
}
