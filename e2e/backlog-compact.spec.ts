import { expect, Page, test } from './fixtures';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { palette, RoadmapDocument } from '../src/app/core/model';

async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
    const value = await new Promise<any>(resolve => { const req = db.transaction('roadmap').objectStore('roadmap').get('current'); req.onsuccess = () => resolve(req.result); });
    db.close(); return value;
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto('/backlog'); await saved(page);
  const document: RoadmapDocument = { ...seedDocument(), dependencies: [], workItems: [
    { id: 'shared', title: 'תשתית Zetro', order: 0 },
    { id: 'local', title: 'היסטוריה גזרתית', teamId: 'team-a', order: 1 },
    { id: 'empty', title: 'כותרת ריקה', teamId: 'team-a', order: 2 }
  ], tasks: [
    { id: 'a', teamId: 'team-a', workItemId: 'shared', title: 'משימה ראשונה', estimatedWorkingDays: 3 },
    { id: 'b', teamId: 'team-b', workItemId: 'shared', title: 'משימה משותפת', estimatedWorkingDays: 5 },
    { id: 'c', teamId: 'team-a', workItemId: 'local', title: 'משימה שנייה', estimatedWorkingDays: 2 }
  ].map((task, order) => ({ ...task, order, planningState: 'backlog', assigneeId: null, notes: '', status: 'planned', color: palette[0] })) };
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(value, 'current'); tx.oncomplete = () => resolve(); }); db.close();
  }, { document, preferences: { ...initialPreferences(), backlog: { mode: 'teams', collapsed: ['work:shared:team:team-a', 'work:local:team:team-a', 'work:empty:team:team-a'], scrollTop: 0 } } });
  await page.reload(); await saved(page);
});
const teamA = (page: Page) => page.locator('[data-group="team:team-a"]');
const sharedA = (page: Page) => teamA(page).locator('[data-work="shared"]');
async function expandWorks(page: Page, expanded: boolean) {
  const toggles = page.locator(`.backlog-work-toggle[aria-expanded="${!expanded}"]`);
  while (await toggles.count()) await toggles.first().click();
}

test('compact projections toggle independently and persist', async ({ page }) => {
  const group = teamA(page), shared = sharedA(page), toggle = shared.locator('.backlog-work-toggle');
  await expect(group.locator('.backlog-row')).toHaveCount(0);
  await expect(group.locator('.backlog-work-summary')).toHaveCount(3);
  await expect(group.locator('.backlog-group-heading')).toContainText('3 וקטורים · 2 משימות · 5 ימי עבודה');
  await toggle.focus(); await toggle.press('Enter');
  await expect(shared.getByTestId('backlog-row-a')).toBeVisible();
  await expect(group.getByTestId('backlog-row-c')).toHaveCount(0);
  const other = page.locator('[data-group="team:team-b"] [data-work="shared"] .backlog-work-toggle');
  await other.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await saved(page); await page.reload(); await saved(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(other).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click();
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await expandWorks(page, true);
  await expect(page.locator('.backlog-row')).toHaveCount(3);
  await expandWorks(page, false);
  await expect(page.locator('.backlog-row')).toHaveCount(0);
  await expect(group.locator('.backlog-group-heading')).toHaveAttribute('aria-expanded', 'true');
  await group.locator('.backlog-group-heading').click();
  await expect(group.locator('.backlog-columns')).toHaveCount(0);
  await expect(group.locator('.backlog-work-summary')).toHaveCount(0);
});

test('add and rename keep context, IDs and cancellation without toggling', async ({ page }) => {
  const shared = sharedA(page), toggle = shared.locator('.backlog-work-toggle'), before = (await stored(page)).document;
  await shared.getByRole('button', { name: 'הוספת משימה תחת תשתית Zetro', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true });
  await expect(editor.getByLabel('צוות', { exact: true })).toHaveValue('team-a');
  await editor.getByLabel('כותרת הפריט').fill('טיוטה מבוטלת');
  await editor.getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect((await stored(page)).document).toEqual(before);
  await shared.getByRole('button', { name: 'הוספת משימה תחת תשתית Zetro', exact: true }).click();
  await editor.getByLabel('כותרת הפריט').fill('משימה חדשה בהקרנה');
  await editor.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await saved(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(shared.locator('.backlog-row')).toHaveCount(2);
  await expect(shared.locator('.count-badge')).toHaveText('2');
  await expect(shared.locator('.backlog-scope')).toHaveText('8 ימי עבודה');
  const added = (await stored(page)).document.tasks.find((task: any) => task.title === 'משימה חדשה בהקרנה');
  expect(added).toMatchObject({ teamId: 'team-a', workItemId: 'shared' });
  await toggle.click();
  await shared.getByRole('button', { name: 'עריכת כותרת תשתית Zetro', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'עריכת כותרת', exact: true });
  await rename.getByLabel('שם הכותרת').fill('שם מבוטל'); await rename.getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(toggle).toContainText('תשתית Zetro');
  await shared.getByRole('button', { name: 'עריכת כותרת תשתית Zetro', exact: true }).click();
  await rename.getByLabel('שם הכותרת').fill('תשתית משותפת מעודכנת');
  await rename.getByRole('button', { name: 'שמירת כותרת', exact: true }).click(); await saved(page);
  await expect(page.locator('[data-work="shared"] .backlog-work-toggle')).toHaveText(['‹תשתית משותפת מעודכנת', '⌄תשתית משותפת מעודכנת']);
  const after = (await stored(page)).document;
  expect(after.workItems.find((work: any) => work.id === 'shared').title).toBe('תשתית משותפת מעודכנת');
  expect(after.tasks.filter((task: any) => task.id !== added.id)).toEqual(before.tasks);
});

for (const width of [1440, 390]) {
  test(`RTL layout with long titles and all expansion states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1050 });
    await sharedA(page).getByRole('button', { name: 'עריכת כותרת תשתית Zetro', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'עריכת כותרת', exact: true });
    await rename.getByLabel('שם הכותרת').fill('כותרת עברית ארוכה עם שם Zetro ופרטים נוספים לבדיקת גלישה תקינה ושמירת פעולות זמינות');
    await rename.getByRole('button', { name: 'שמירת כותרת', exact: true }).click();
    await expandWorks(page, true);
    await expandWorks(page, false);
    await page.screenshot({ path: `test-results/compact-${width}-collapsed.png`, fullPage: true });
    await sharedA(page).locator('.backlog-work-toggle').click();
    await page.screenshot({ path: `test-results/compact-${width}-one.png`, fullPage: true });
    await expandWorks(page, true);
    await page.screenshot({ path: `test-results/compact-${width}-all.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.backlog-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const button of await page.locator('.backlog-work-actions button').all()) await expect(button).toBeVisible();
  });
}

test('task search reveals collapsed matches and restores groups when cleared', async ({ page }) => {
  const before = await stored(page);
  const search = page.getByRole('searchbox', { name: 'חיפוש משימות', exact: true });
  await search.fill('  ראשונה  ');
  await expect(page.locator('.backlog-row')).toHaveCount(1);
  await expect(page.getByTestId('backlog-row-a')).toBeVisible();
  await expect(page.locator('[data-work="empty"]')).toHaveCount(0);
  await sharedA(page).locator('.backlog-work-toggle').click();
  await expect(page.locator('.backlog-row')).toHaveCount(0);
  await search.fill('משותפת');
  await expect(page.getByTestId('backlog-row-b')).toBeVisible();
  await search.fill('אין משימה כזאת');
  await expect(page.getByText('לא נמצאו משימות התואמות לחיפוש.', { exact: true })).toBeVisible();
  await expect(page.locator('.backlog-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'ניקוי חיפוש', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(sharedA(page).locator('.backlog-work-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(teamA(page).locator('[data-work="empty"]')).toBeVisible();
  const after = await stored(page);
  expect(after.document).toEqual({ ...before.document, revision: after.document.revision });
  expect(after.preferences.backlog.collapsed).toEqual(before.preferences.backlog.collapsed);
});

for (const mode of ['people', 'list'] as const) {
  test(`simplified backlog shows works even with saved ${mode} preference`, async ({ page }) => {
    const before = await stored(page);
    await page.evaluate(async mode => {
      const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
      await new Promise<void>(resolve => {
        const tx = db.transaction('roadmap', 'readwrite'), store = tx.objectStore('roadmap'), req = store.get('current');
        req.onsuccess = () => { const value = req.result; value.preferences.backlog.mode = mode; store.put(value, 'current'); };
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, mode);
    await page.reload(); await saved(page);
    await expect(sharedA(page)).toBeVisible();
    const toolbar = page.getByRole('region', { name: 'כלי בקלוג' });
    for (const name of ['אנשי הצוות', 'לפי עבודות', 'לפי אנשים', 'רשימה אחת', 'פתיחת הכול', 'קיפול הכול', 'ביטול שינוי', 'החזרת שינוי']) {
      await expect(toolbar.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('.backlog-count')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'חיפוש משימות', exact: true }).fill('ראשונה');
    await expect(page.getByTestId('backlog-row-a')).toBeVisible();
    expect((await stored(page)).document).toEqual(before.document);
  });
}
