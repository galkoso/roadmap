import { expect, test, Page } from './fixtures';
import { initialPreferences, seedDocument } from '../src/app/core/seed';

async function prepare(page: Page) {
  await page.goto('/roadmap');
  await expect(page.locator('.save-state')).toHaveText('נשמר');
  const document = seedDocument();
  document.members = [{ id: 'mobile-person', teamId: 'team-a', name: 'איש צוות עם שם ארוך לבדיקת תצוגה בטלפון', order: 0 }];
  document.attendance = [{ memberId: 'mobile-person', date: '2026-10-12', status: 'absent' }];
  document.tasks = [{ id: 'mobile-task', teamId: 'team-a', workItemId: null, assigneeId: 'mobile-person', title: 'משימה עם כותרת ארוכה לבדיקת תצוגה בטלפון ובמסכים קטנים', estimatedWorkingDays: 3, planningState: 'backlog', status: 'planned', color: '#3975d5', notes: '', order: 0 }];
  document.dependencies = [];
  const preferences = { ...initialPreferences(), planning: { activeTeamId: 'team-a', activePeriod: '2026-10', collapsedGroups: [], expandedTeamIds: [] } };
  await page.evaluate(async saved => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('personal-roadmap-v1', 1); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(saved, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { document, preferences });
  await page.goto('/velocity');
  await expect(page.locator('.velocity-calendar h2')).toBeVisible();
}

for (const width of [320, 390, 768]) {
  test(`mobile pages and dialogs fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page);
    for (const route of ['/velocity', '/planning', '/backlog', '/roadmap']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
      if (route === '/velocity') {
        const cells = page.locator('.velocity-grid button');
        for (const cell of await cells.all()) expect(await cell.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      if (route === '/backlog') {
        await page.getByRole('button', { name: '＋ פריט לבקלוג', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.keyboard.press('Escape');
      }
    }
    await page.screenshot({ path: `test-results/mobile-roadmap-${width}.png`, fullPage: true });
  });
}

test('touch painting sets a consistent status, skips weekends, saves on release and undoes in one step', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const grid = page.locator('.velocity-grid'); await grid.scrollIntoViewIfNeeded();
  const session = await context.newCDPSession(page);
  async function touch(type: string, date?: string) {
    const box = date ? await page.locator(`[data-date="${date}"]`).boundingBox() : null;
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: box ? [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] : [] });
  }
  await touch('touchStart', '2026-10-11');
  await touch('touchMove', '2026-10-12');
  await touch('touchMove', '2026-10-13');
  await touch('touchMove', '2026-10-16');
  await expect(grid.locator('.paint-preview')).toHaveCount(3);
  await touch('touchEnd');
  for (const date of ['11', '12', '13']) await expect(page.locator(`[data-date="2026-10-${date}"]`)).toHaveClass(/absent/);
  await expect(page.locator('[data-date="2026-10-16"]')).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-date="2026-10-11"]')).toHaveClass(/present/);
  await expect(page.locator('[data-date="2026-10-12"]')).toHaveClass(/absent/);
  await expect(page.locator('[data-date="2026-10-13"]')).toHaveClass(/present/);
  await grid.scrollIntoViewIfNeeded();
  await touch('touchStart', '2026-10-12'); await touch('touchMove', '2026-10-13'); await touch('touchEnd');
  await expect(page.locator('[data-date="2026-10-12"]')).toHaveClass(/present/);
  await expect(page.locator('[data-date="2026-10-13"]')).toHaveClass(/present/);
  await touch('touchStart', '2026-10-14'); await touch('touchCancel');
  await expect(page.locator('[data-date="2026-10-14"]')).toHaveClass(/present/);
  await expect(grid.locator('.paint-preview')).toHaveCount(0);
  await expect(page.locator('.velocity-page')).toHaveAttribute('data-save-status', 'נשמר');
  await page.reload();
  await expect(page.locator('[data-date="2026-10-12"]')).toHaveClass(/present/);
  await page.locator('[data-date="2026-10-14"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-date="2026-10-14"]')).toHaveClass(/absent/);
});
