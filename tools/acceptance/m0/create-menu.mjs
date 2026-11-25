// The global create menu (key `c` on home), then one of its entries, picked by clicking it as a person would.
// The menu is seen before anything is picked: a blind key after `c` went to whatever held focus (the home composer's
// Enter focused the prompt instead of creating a document, 2026-11-25 official r2), and once the menu is open its
// search field holds focus in search mode, so an entry key (`t`) is typed into the search instead (r3).
const ENTRIES = {
  document: /^(Document|文档)$/,
  task: /^(Task|任务)$/,
  channel: /^(Channel|频道)$/,
};

export async function createFromMenu(page, entry, { attempts = 3 } = {}) {
  const name = ENTRIES[entry];
  if (!name) throw new Error(`unknown create-menu entry ${entry}`);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.locator('body').click({ position: { x: 900, y: 120 } });
    await page.keyboard.press('c');
    const item = page.getByText(name).first();
    if (await item.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
      // The launcher (apps/web features/command/Launcher.tsx) opens in search mode by default with its field focused:
      // a pointer click only selects the entry (setSelectedIndexFromPointer) and Enter runs the selected entry.
      await item.click();
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`the create menu did not open after ${attempts} attempts`);
}
