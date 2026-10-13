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
  await expect(page.locator('.backlog-drag-handle')).toHaveCount(0);
  await page.getByRole('button', { name: 'סידור משימות', exact: true }).click();
  const source = page.getByRole('button', { name: 'סידור משימה שלישית', exact: true });
  const target = page.locator('.backlog-row').filter({ hasText: 'ראשונה' });
  await source.dragTo(target, { targetPosition: { x: 50, y: 5 } }); await saved(page);
  expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page);
  expect(await titles(page)).toEqual(['ראשונה', 'שנייה', 'שלישית']);
  await page.getByRole('button', { name: 'החזרת שינוי', exact: true }).click(); await saved(page);
  expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await source.focus(); await source.press('ArrowDown'); await saved(page);
  expect(await titles(page)).toEqual(['ראשונה', 'שלישית', 'שנייה']);
  await source.press('ArrowUp'); await saved(page);
  expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  for (const mode of ['לפי עבודות', 'לפי אנשים']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  }
  await page.reload(); await saved(page);
  expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await page.getByRole('button', { name: 'סידור משימות', exact: true }).click();
  const first = page.getByRole('button', { name: 'סידור משימה שלישית', exact: true });
  await first.press('ArrowUp'); expect(await titles(page)).toEqual(['שלישית', 'ראשונה', 'שנייה']);
  await page.getByRole('button', { name: 'סיום סידור', exact: true }).click();
  await expect(page.locator('.backlog-drag-handle')).toHaveCount(0);
});
