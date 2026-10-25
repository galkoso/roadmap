import { legacyFields } from '../tests/legacy-fields';
import { expect, Page, test } from './fixtures';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function planning(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('personal-roadmap-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const result = await new Promise<any>(resolve => { const request = db.transaction('roadmap').objectStore('roadmap').get('current'); request.onsuccess = () => resolve(request.result); }); db.close(); return result;
  });
}
const architecture = 'task-bar-architecture-team-a';
async function drag(page: Page, id: string, pixels: number, cancel = false, handle?: 'start' | 'end') {
  const locator = page.getByTestId(id); const box = await locator.boundingBox(); if (!box) throw new Error('missing bar');
  const x = handle === 'start' ? box.x + 3 : handle === 'end' ? box.x + box.width - 3 : box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + pixels, y, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape'); await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await saved(page); });
test('shared projections, per-team folding, keyboard, RTL and aligned calendar', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'שדרוג תשתית השירותים משותפת' })).toHaveCount(3);
  const titles = await page.locator('.work-title').all(); await titles[0].focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId(architecture)).toHaveCount(0); await expect(page.getByTestId('task-bar-implementation-team-b')).toBeVisible();
  await page.keyboard.press('Enter'); await expect(page.getByTestId(architecture)).toBeVisible();
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  const original = await planning(page); const task = original.document.tasks[0];
  const alignment = await page.evaluate(({ id, date, center }) => {
    const bar = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const index = Math.round((Date.parse(date) - Date.parse(center)) / 86400000) + 50;
    const tick = document.querySelectorAll('.day-band > div')[index] as HTMLElement;
    return { bar: bar.getBoundingClientRect().x, tick: tick.getBoundingClientRect().x };
  }, { id: architecture, date: task.startDate, center: original.preferences.center });
  expect(Math.abs(alignment.bar - alignment.tick)).toBeLessThan(3);
  const names = await page.locator('.names-header').boundingBox();
  await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft += 220);
  const after = await page.locator('.names-header').boundingBox(); expect(after!.x).toBe(names!.x);
});
test('task drag previews descendants, Escape restores them, commit and undo form one command', async ({ page }) => {
  const before = await planning(page); const boxes = await page.locator('.task-bar').evaluateAll(bars => bars.map(b => (b as HTMLElement).style.left));
  await drag(page, architecture, 56, true); await expect(page.locator('.notice')).toContainText('הגרירה בוטלה');
  expect(await page.locator('.task-bar').evaluateAll(bars => bars.map(b => (b as HTMLElement).style.left))).toEqual(boxes);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await drag(page, architecture, 56); await saved(page); const moved = await planning(page);
  expect(moved.document.tasks[0].startDate).not.toBe(before.document.tasks[0].startDate);
  expect(moved.document.tasks[1].startDate).not.toBe(before.document.tasks[1].startDate);
  expect(moved.document.tasks[2].startDate).not.toBe(before.document.tasks[2].startDate);
  expect(moved.document.tasks[3]).toEqual(before.document.tasks[3]);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z'); await saved(page); expect((await planning(page)).document.tasks).toEqual(moved.document.tasks);
});
test('work drag from another team moves all teams, one undo restores all; resize propagates', async ({ page }) => {
  const before = await planning(page); await drag(page, 'work-bar-services-team-b', 196); await saved(page);
  const moved = await planning(page);
  for (let i = 0; i < 3; i++) expect(moved.document.tasks[i].startDate).not.toBe(before.document.tasks[i].startDate);
  expect(moved.document.tasks[3]).toEqual(before.document.tasks[3]);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await drag(page, architecture, 56, false, 'end'); await saved(page); const resized = await planning(page);
  expect(resized.document.tasks[0].startDate).toBe(before.document.tasks[0].startDate);
  expect(resized.document.tasks[0].endDate).not.toBe(before.document.tasks[0].endDate);
  expect(resized.document.tasks[1].startDate).not.toBe(before.document.tasks[1].startDate);
});
test('form previews unavailable anchors, changes team and metadata without scheduling, refresh restores zoom and groups', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'מימוש השירותים בביצוע' }).click();
  await page.getByLabel('תאריך התחלה', { exact: true }).fill('2026-10-16'); await expect(page.locator('.editor-panel')).toContainText('התחלה בפועל'); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('תאריך התחלה', { exact: true }).fill(before.document.tasks[1].startDate);
  await page.getByLabel('צוות אחראי', { exact: true }).selectOption('team-c'); await page.getByLabel('תיאור / הערות').fill('בדיקת טקסט <b>רגיל</b>');
  await page.getByRole('button', { name: 'שמירת השינויים' }).click(); await saved(page);
  const changed = await planning(page); expect(changed.document.tasks[1].teamId).toBe('team-c'); expect(changed.document.tasks[1].startDate).toBe(before.document.tasks[1].startDate); expect(changed.document.dependencies).toEqual(before.document.dependencies);
  await expect(page.getByTestId('task-bar-implementation-team-c')).toBeVisible(); await expect(page.getByTestId('task-bar-implementation-team-b')).toHaveCount(0);
  await page.getByRole('button', { name: 'רבעונים', exact: true }).click(); await page.getByRole('button', { name: /צוות א׳ 1/ }).click(); await saved(page);
  await expect.poll(async () => (await planning(page)).preferences.collapsed).toContain('team:team-a');
  await page.reload(); await saved(page); expect((await planning(page)).document.tasks).toEqual(changed.document.tasks);
  await expect(page.getByRole('button', { name: 'רבעונים', exact: true })).toHaveClass(/active/); await expect(page.getByTestId(architecture)).toHaveCount(0);
});
test('backup export-import, invalid file stays untouched, HTML stays text', async ({ page }) => {
  await page.getByRole('button', { name: 'ניהול צוותים וגיבוי' }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  const before = await planning(page), downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא גיבוי JSON' }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/^roadmap-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk); const buffer = Buffer.concat(chunks);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":42}') });
  await expect(page.getByRole('alert')).toContainText('גרסת'); expect((await planning(page)).document).toEqual(before.document);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer }); await expect(page.getByText('הגיבוי תקין ומוכן לייבוא')).toBeVisible();
  await page.getByRole('button', { name: 'אישור והחלפת התכנון' }).click(); await saved(page); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
});
test('two tabs refuse stale writes and offer reload while preserving in-memory backup', async ({ page, context }) => {
  const second = await context.newPage(); await second.goto('/'); await saved(second);
  await page.getByRole('button', { name: 'כותרת חדשה' }).click(); await page.getByLabel('שם הכותרת').fill('תכנון מהלשונית הראשונה'); await page.getByRole('button', { name: 'שמירת כותרת' }).click(); await saved(page);
  await second.getByRole('button', { name: 'כותרת חדשה' }).click(); await second.getByLabel('שם הכותרת').fill('שינוי ישן'); await second.getByRole('button', { name: 'שמירת כותרת' }).click();
  await expect(second.getByRole('alert')).toContainText('בלשונית אחרת'); await expect(second.locator('.save-state')).not.toHaveText('נשמר');
  expect((await planning(page)).document.workItems.some((w: any) => w.title === 'שינוי ישן')).toBe(false);
  await second.getByRole('button', { name: 'טעינת הגרסה החדשה' }).click(); await saved(second); await expect(second.locator('.work-title').filter({ hasText: 'תכנון מהלשונית הראשונה' })).toBeVisible();
});
test('view changes and out-of-range navigation preserve dates; sticky dates and narrow layout', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'שבועות', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  for (let i = 0; i < 8; i++) {
    const start = await page.locator('.date-header').getAttribute('data-range-start');
    await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft = el.scrollWidth - el.clientWidth);
    await expect.poll(() => page.locator('.date-header').getAttribute('data-range-start')).not.toBe(start);
  }
  await expect(page.getByTestId(architecture)).toHaveCount(0); await page.getByRole('button', { name: 'ניווט למשימה' }).first().click(); await expect(page.getByTestId(architecture)).toBeVisible();
  const header = await page.locator('.timeline-header').boundingBox(); await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 200); expect((await page.locator('.timeline-header').boundingBox())!.y).toBe(header!.y);
  await page.setViewportSize({ width: 560, height: 900 }); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('.timeline-viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
});
test('dark mode visual preview capture', async ({ page }) => { await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark'); await page.screenshot({ path: 'test-results/roadmap-desktop.png', fullPage: true }); });
test('rename a shared work updates three projections; cycle is rejected atomically and dependency names remain available when collapsed', async ({ page }) => {
  await page.getByRole('button', { name: 'עריכת עבודה', exact: true }).first().click(); await page.getByLabel('כותרת העבודה').fill('תשתית משותפת מעודכנת'); await page.getByRole('button', { name: 'שמירת עבודה' }).click(); await saved(page);
  await expect(page.locator('.work-title').filter({ hasText: 'תשתית משותפת מעודכנת' })).toHaveCount(3); expect((await planning(page)).document.workItems.length).toBe(2);
  const before = await planning(page); await page.getByRole('button', { name: 'תכנון הארכיטקטורה הושלמה' }).click();
  await page.getByRole('checkbox', { name: /בדיקות והטמעה/ }).check(); await page.getByRole('button', { name: 'שמירת השינויים' }).click(); await expect(page.getByRole('alert')).toContainText('מעגל');
  expect((await planning(page)).document).toEqual(before.document); await page.getByRole('button', { name: 'סגירת עריכת משימה' }).click();
  await page.getByRole('button', { name: /צוות א׳ 1/ }).click(); await page.getByRole('button', { name: 'מימוש השירותים בביצוע' }).click();
  await expect(page.locator('.dependency-picker')).toContainText('תכנון הארכיטקטורה'); await expect(page.locator('.dependency-lines path[marker-end]')).toHaveCount(1);
});
test('create empty work and its first one-day task, then delete without affecting independent planning', async ({ page }) => {
  await page.getByRole('button', { name: 'כותרת חדשה' }).click(); await page.getByLabel('שם הכותרת').fill('עבודה ריקה'); await page.getByRole('button', { name: 'שמירת כותרת' }).click(); await saved(page);
  const empty = await planning(page), work = empty.document.workItems.find((w: any) => w.title === 'עבודה ריקה'); await expect(page.getByTestId(`work-bar-${work.id}-team-a`)).toHaveCount(0);
  await page.locator('.work-row').filter({ hasText: 'עבודה ריקה' }).getByRole('button', { name: 'הוספת משימה תחת עבודה ריקה', exact: true }).click();
  await page.getByLabel('שם המשימה', { exact: true }).fill('משימה קצרה'); await page.getByRole('button', { name: 'הוספת משימה', exact: true }).click(); await saved(page);
  const added = await planning(page), task = added.document.tasks.find((t: any) => t.title === 'משימה קצרה'); expect(task.startDate).toBe(task.endDate);
  await expect(page.getByTestId(`task-bar-${task.id}-team-a`)).toBeVisible(); expect((await page.getByTestId(`task-bar-${task.id}-team-a`).boundingBox())!.width).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: 'משימה קצרה מתוכננת' }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'מחיקת משימה', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(empty.document.tasks);
});
test('team creation, rename, order and delete with explicit task transfer preserve dates and dependencies', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'שינוי שם הצוות צוות א׳', exact: true }).click();
  const nameInput = page.getByLabel('שם צוות א׳', { exact: true }); await expect(nameInput).toBeFocused(); await nameInput.fill('צוות תשתיות'); await nameInput.press('Enter');
  await expect.poll(async () => (await planning(page)).document.teams[0].name).toBe('צוות תשתיות');
  await page.getByLabel('צוות חדש').fill('צוות ד׳'); await page.getByRole('button', { name: 'הוספת צוות', exact: true }).click(); await saved(page);
  const row = page.locator('.team-edit-row').filter({ has: page.getByLabel('שם צוות ד׳', { exact: true }) });
  await row.getByRole('button', { name: 'העברת צוות למעלה' }).click(); await saved(page);
  const first = page.locator('.team-edit-row').filter({ has: page.getByLabel('שם צוות תשתיות', { exact: true }) });
  await first.locator('select').selectOption('team-b'); page.once('dialog', dialog => dialog.accept()); await first.getByRole('button', { name: 'מחיקה', exact: true }).click(); await saved(page);
  const changed = await planning(page); expect(changed.document.tasks[0].teamId).toBe('team-b'); expect(changed.document.tasks[0].startDate).toBe(before.document.tasks[0].startDate); expect(changed.document.dependencies).toEqual(before.document.dependencies);
  expect(changed.document.teams.some((t: any) => t.id === 'team-a')).toBe(false);
});
test('failed IndexedDB writes show error, retain memory for export and recover on retry', async ({ page }) => {
  const before = await planning(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; (window as any).__originalPut = put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota full', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'כותרת חדשה' }).click(); await page.getByLabel('שם הכותרת').fill('תכנון שלא נשמר'); await page.getByRole('button', { name: 'שמירת כותרת' }).click();
  await expect(page.getByRole('alert')).toContainText('quota full'); await expect(page.locator('.save-state')).not.toHaveText('נשמר'); expect((await planning(page)).document).toEqual(before.document);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא המצב הנוכחי' }).click(); const download = await downloadPromise; const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).document.workItems.some((w: any) => w.title === 'תכנון שלא נשמר')).toBe(true);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__originalPut; }); await page.getByRole('button', { name: 'ניסיון שמירה נוסף' }).click(); await saved(page); expect((await planning(page)).document.workItems.length).toBe(3);
});
test('300-task browser render, vertical sticky dates, stable row DOM during preview, and offline operation', async ({ page, context }) => {
  const stored = await planning(page), doc = stored.document; doc.dependencies = []; const prototype = doc.tasks[0];
  doc.tasks = Array.from({ length: 300 }, (_, i) => ({ ...prototype, id: 'load-task-' + i, title: 'משימה ' + i, teamId: doc.teams[i % 3].id, order: i }));
  const backup = { schemaVersion: doc.schemaVersion, exportedAt: new Date().toISOString(), document: doc, preferences: stored.preferences };
  await page.getByRole('button', { name: 'ניהול צוותים וגיבוי' }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: '300.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.getByRole('button', { name: 'אישור והחלפת התכנון' }).click(); await saved(page); await page.getByRole('button', { name: 'סגירת הגיבוי' }).click();
  await expect(page.locator('.task-bar')).toHaveCount(300); const y = (await page.locator('.timeline-header').boundingBox())!.y;
  await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 900); expect((await page.locator('.timeline-header').boundingBox())!.y).toBe(y); await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 0);
  await page.evaluate(() => { (window as any).__firstRow = document.querySelector('[data-testid="task-bar-load-task-0-team-a"]')?.closest('.timeline-row'); });
  const box = await page.getByTestId('task-bar-load-task-0-team-a').boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + 12); await page.mouse.down(); const start = Date.now(); await page.mouse.move(box!.x + box!.width / 2 + 28, box!.y + 12, { steps: 4 }); expect(Date.now() - start).toBeLessThan(1500);
  expect(await page.evaluate(() => (window as any).__firstRow === document.querySelector('[data-testid="task-bar-load-task-0-team-a"]')?.closest('.timeline-row'))).toBe(true); await page.keyboard.press('Escape'); await page.mouse.up();
  await context.setOffline(true); await page.getByRole('button', { name: 'שבועות', exact: true }).click(); await saved(page); expect((await planning(page)).document.tasks.length).toBe(300);
});
test('reload returns to today; left resize keeps end and pointer cancellation restores preview', async ({ page }) => {
  const before = await planning(page); await drag(page, architecture, 28, false, 'start'); await saved(page); const resized = await planning(page);
  expect(resized.document.tasks[0].endDate).toBe(before.document.tasks[0].endDate); expect(resized.document.tasks[0].startDate).not.toBe(before.document.tasks[0].startDate); expect(legacyFields(resized.document.tasks[1])).toEqual(legacyFields(before.document.tasks[1]));
  const bar = page.getByTestId(architecture), box = await bar.boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + 12); await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 28, box!.y + 12); await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))); await page.mouse.up(); expect((await planning(page)).document.tasks).toEqual(resized.document.tasks);
  await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft += 125); const centeredDate = await page.locator('.timeline-viewport').evaluate(el => { const ticks = el.querySelectorAll('.day-band > div'); const box = el.getBoundingClientRect(), x = box.x + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2; return Array.from(ticks).find(t => { const rect = t.getBoundingClientRect(); return rect.left <= x && rect.right > x; })?.textContent; });
  await expect.poll(async () => Number((await planning(page)).preferences.center.slice(8))).toBe(Number(centeredDate));
  await page.reload(); await saved(page); await expect.poll(async () => page.locator('.timeline-viewport').evaluate(el => { const line = el.querySelector('.today-line')!.getBoundingClientRect(); const box = el.getBoundingClientRect(); return Math.abs(line.x - (box.x + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2)); })).toBeLessThan(3);
});
test('timeline delete buttons confirm, remove only related data, and undo restores shared missions', async ({ page }) => {
  const before = await planning(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'מחיקת משימה מימוש השירותים', exact: true }).click();
  expect((await planning(page)).document).toEqual(before.document);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'מחיקת משימה מימוש השירותים', exact: true }).click();
  await expect.poll(async () => (await planning(page)).document.tasks.length).toBe(3); await saved(page);
  const removed = await planning(page);
  expect(removed.document.tasks).toEqual(before.document.tasks.filter((t: any) => t.id !== 'implementation'));
  expect(removed.document.dependencies).toEqual([]);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await planning(page)).document.tasks).toEqual(before.document.tasks);
  expect((await planning(page)).document.dependencies).toEqual(before.document.dependencies);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'מחיקת עבודה שדרוג תשתית השירותים', exact: true }).nth(1).click();
  await expect.poll(async () => (await planning(page)).document.tasks.length).toBe(1); await saved(page);
  const workRemoved = await planning(page); expect(workRemoved.document.tasks).toEqual([before.document.tasks[3]]);
  expect(workRemoved.document.workItems).toEqual([before.document.workItems[1]]);
  await expect(page.locator('.work-title').filter({ hasText: 'שדרוג תשתית השירותים' })).toHaveCount(0);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await planning(page)).document.tasks).toEqual(before.document.tasks);
  await expect(page.locator('.work-title').filter({ hasText: 'שדרוג תשתית השירותים' })).toHaveCount(3);
});
test('every view recenters on today and refresh preserves mission dates', async ({ page }) => {
  const before = await planning(page);
  const current = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  async function centeredToday() {
    await expect.poll(() => page.locator('.timeline-viewport').evaluate(el => {
      const line = el.querySelector('.today-line'); if (!line) return Infinity;
      const box = el.getBoundingClientRect();
      return Math.abs(line.getBoundingClientRect().x - (box.x + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2));
    })).toBeLessThan(3);
  }
  await centeredToday();
  for (const mode of ['שבועות', 'חודשים', 'רבעונים']) {
    await page.getByRole('button', { name: mode, exact: true }).click(); await centeredToday();
    await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft += 120);
    await page.getByRole('button', { name: mode, exact: true }).click(); await centeredToday();
  }
  await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft += 400);
  await page.reload(); await saved(page); await centeredToday();
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
});
for (const mode of ['שבועות', 'חודשים', 'רבעונים']) {
  test(`continuous scrolling in ${mode} reaches future and past years without arrows or date changes`, async ({ page }) => {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const before = await planning(page), viewport = page.locator('.timeline-viewport');
    const originalStart = await page.locator('.date-header').getAttribute('data-range-start');
    const originalTicks = await page.locator('.day-band > div').count();
    const namesX = (await page.locator('.names-header').boundingBox())!.x;
    async function scrollEdge(direction: number) {
      const oldStart = await page.locator('.date-header').getAttribute('data-range-start');
      const expected = await viewport.evaluate((el, direction) => {
        el.scrollLeft = direction > 0 ? el.scrollWidth - el.clientWidth : 0;
        const start = el.querySelector('.date-header')!.getAttribute('data-range-start')!;
        const tickWidth = (el.querySelector('.day-band > div') as HTMLElement).getBoundingClientRect().width;
        const dayWidth = document.querySelector('.segmented .active')?.textContent === 'רבעונים' ? tickWidth / 7 : tickWidth;
        return Date.parse(start) / 86400000 + (el.scrollLeft + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2) / dayWidth;
      }, direction);
      await expect.poll(() => page.locator('.date-header').getAttribute('data-range-start')).not.toBe(oldStart);
      const actual = await viewport.evaluate(el => {
        const start = el.querySelector('.date-header')!.getAttribute('data-range-start')!;
        const tickWidth = (el.querySelector('.day-band > div') as HTMLElement).getBoundingClientRect().width;
        const dayWidth = document.querySelector('.segmented .active')?.textContent === 'רבעונים' ? tickWidth / 7 : tickWidth;
        return Date.parse(start) / 86400000 + (el.scrollLeft + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2) / dayWidth;
      });
      expect(Math.abs(actual - expected)).toBeLessThan(0.05);
    }
    for (let i = 0; i < 20; i++) await scrollEdge(1);
    const future = await page.locator('.date-header').getAttribute('data-range-start');
    expect(Date.parse(future!) - Date.parse(originalStart!)).toBeGreaterThan(365 * 86400000);
    for (let i = 0; i < 40; i++) await scrollEdge(-1);
    const past = await page.locator('.date-header').getAttribute('data-range-start');
    expect(Date.parse(originalStart!) - Date.parse(past!)).toBeGreaterThan(365 * 86400000);
    expect(await page.locator('.day-band > div').count()).toBe(originalTicks);
    expect((await page.locator('.names-header').boundingBox())!.x).toBe(namesX);
    expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect.poll(() => viewport.evaluate(el => {
      const line = el.querySelector('.today-line'); if (!line) return Infinity;
      return Math.abs(line.getBoundingClientRect().x - (el.getBoundingClientRect().x + (el.clientWidth - (el.querySelector('.names-header') as HTMLElement).offsetWidth) / 2));
    })).toBeLessThan(3);
  });
}
test('heading creation and task creation validate separately, preserve inclusive dates and undo as separate actions', async ({ page }) => {
  const before = await planning(page), add = page.getByRole('button', { name: 'כותרת חדשה' });
  await add.click(); const dialog = page.getByRole('dialog', { name: 'כותרת חדשה', exact: true });
  await expect(dialog.getByLabel('שם הכותרת')).toBeFocused(); await dialog.getByLabel('שם הכותרת').fill('טיוטה לביטול');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(add).toBeFocused();
  expect((await planning(page)).document).toEqual(before.document);
  await add.click(); await dialog.getByLabel('שם הכותרת').fill('  '); await dialog.getByRole('button', { name: 'שמירת כותרת' }).click();
  await expect(dialog.getByRole('alert')).toContainText('יש להזין שם'); expect((await planning(page)).document).toEqual(before.document);
  await dialog.getByLabel('שם הכותרת').fill('כותרת עם משימה'); await dialog.getByLabel('צוות הכותרת').selectOption('team-c');
  await expect(dialog.locator('input[type=date], input[type=number]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'שמירת כותרת' }).click(); await saved(page);
  const headingState = await planning(page), work = headingState.document.workItems.find((w: any) => w.title === 'כותרת עם משימה');
  expect(headingState.document.tasks).toEqual(before.document.tasks);
  const row = page.locator('.work-row').filter({ hasText: 'כותרת עם משימה' });
  await row.getByRole('button', { name: 'הוספת משימה תחת כותרת עם משימה', exact: true }).click();
  const editor = page.getByRole('region', { name: 'עריכת משימה' });
  await editor.getByLabel('שם המשימה', { exact: true }).fill('משימה עם תקופה');
  await editor.getByLabel('היקף בימי עבודה', { exact: true }).fill('5');
  await editor.getByLabel('תאריך התחלה', { exact: true }).fill('2026-10-16');
  await expect(editor).toContainText('התחלה בפועל 18.10.2026'); await expect(editor.getByRole('button', { name: 'הוספת משימה', exact: true })).toBeEnabled();
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await editor.getByLabel('תאריך התחלה', { exact: true }).fill('2026-10-15'); await expect(editor).toContainText('5 ימי עבודה');
  await page.screenshot({ path: 'test-results/create-task-editor.png' });
  await editor.getByRole('button', { name: 'הוספת משימה', exact: true }).click();
  await expect.poll(async () => (await planning(page)).document.tasks.length).toBe(before.document.tasks.length + 1); await saved(page);
  const after = await planning(page), task = after.document.tasks.find((t: any) => t.workItemId === work.id);
  expect(task.startDate).toBe('2026-10-15'); expect(task.endDate).toBe('2026-10-21'); expect(task.teamId).toBe('team-c');
  await expect(page.getByTestId(`work-bar-${work.id}-team-c`)).toHaveCount(0); await expect(page.getByTestId(`task-bar-${task.id}-team-c`)).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks); expect((await planning(page)).document.workItems).toEqual(headingState.document.workItems);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page); expect((await planning(page)).document.workItems).toEqual(before.document.workItems);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z'); await saved(page);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z'); await saved(page);
  await expect.poll(async () => (await planning(page)).document.tasks).toEqual(after.document.tasks);
  await page.reload(); await saved(page); expect((await planning(page)).document.tasks).toEqual(after.document.tasks);
});
