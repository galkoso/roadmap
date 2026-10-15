import { expect, Page, test } from '@playwright/test';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'פריט לבקלוג' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('כותרת הפריט').fill(title);
  await dialog.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await saved(page);
}
async function titles(page: Page) { return page.locator('.backlog-title span').evaluateAll(elements => elements.map(el => el.childNodes[0].textContent)); }
test('drag ordering saves, supports Undo/Redo and keyboard ordering across backlog views', async ({ page }) => {
  await page.goto('/backlog'); await saved(page);
  for (const title of ['ראשונה', 'שנייה', 'שלישית']) await create(page, title);
  await page.getByRole('button', { name: 'רשימה אחת', exact: true }).click();
  await expect(page.locator('.backlog-drag-handle')).toHaveCount(3);
  const source = page.getByRole('button', { name: 'סידור משימה שלישית', exact: true });
  const target = page.locator('.backlog-row').filter({ hasText: 'ראשונה' });
  await source.dragTo(target, { targetPosition: { x: 50, y: 5 } }); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['ראשונה', 'שנייה', 'שלישית']);
  await page.getByRole('button', { name: 'החזרת שינוי', exact: true }).click(); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await source.focus(); await source.press('ArrowDown'); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['ראשונה', 'שלישית', 'שנייה']);
  await source.press('ArrowUp'); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  for (const mode of ['לפי עבודות', 'לפי אנשים']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  }
  await page.reload(); await saved(page);
  await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  const first = page.getByRole('button', { name: 'סידור משימה שלישית', exact: true });
  await first.press('ArrowUp'); await expect.poll(() => titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await expect(page.locator('.backlog-drag-handle')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'סידור משימות', exact: true })).toHaveCount(0);
});
async function storedDocument(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('personal-roadmap-v1', 1); request.onsuccess = () => resolve(request.result); });
    const stored = await new Promise<any>(resolve => { const request = db.transaction('roadmap').objectStore('roadmap').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return stored.document;
  });
}
test('group ordering preserves assignments, other groups and scheduled tasks', async ({ page }) => {
  await page.goto('/backlog'); await saved(page);
  for (const title of ['משימה בקבוצה ראשונה', 'משימה בקבוצה שנייה', 'משימה בקבוצה אחרת']) await create(page, title);
  const rows = page.locator('.backlog-row');
  for (const title of ['משימה בקבוצה ראשונה', 'משימה בקבוצה שנייה']) {
    await rows.filter({ hasText: title }).getByRole('combobox', { name: 'צוות לפריט ' + title }).selectOption('team-a');
  }
  await rows.filter({ hasText: 'משימה בקבוצה אחרת' }).getByRole('combobox', { name: 'צוות לפריט משימה בקבוצה אחרת' }).selectOption('team-b');
  await saved(page); const before = await storedDocument(page);
  const handle = page.getByRole('button', { name: 'סידור משימה משימה בקבוצה שנייה', exact: true });
  await handle.dragTo(rows.filter({ hasText: 'משימה בקבוצה ראשונה' }), { targetPosition: { x: 50, y: 5 } });
  await expect.poll(() => titles(page)).toEqual(['משימה בקבוצה שנייה', 'משימה בקבוצה ראשונה', 'משימה בקבוצה אחרת']); await saved(page);
  await handle.dragTo(rows.filter({ hasText: 'משימה בקבוצה אחרת' }), { targetPosition: { x: 50, y: 5 } });
  await expect.poll(() => titles(page)).toEqual(['משימה בקבוצה שנייה', 'משימה בקבוצה ראשונה', 'משימה בקבוצה אחרת']);
  const after = await storedDocument(page);
  for (const task of before.tasks) {
    const updated = after.tasks.find((t: any) => t.id === task.id);
    if (task.planningState === 'scheduled') expect(updated).toEqual(task);
    else expect({ ...updated, order: task.order }).toEqual(task);
  }
  expect(after.dependencies).toEqual(before.dependencies);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/backlog-order-mobile.png', fullPage: true });
});
