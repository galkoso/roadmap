import { expect, Page, test } from '@playwright/test';
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
  await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await page.getByRole('button', { name: 'החזרת שינוי', exact: true }).click(); await saved(page); expect((await planning(page)).document.tasks).toEqual(moved.document.tasks);
});
test('work drag from another team moves all teams, one undo restores all; resize propagates', async ({ page }) => {
  const before = await planning(page); await drag(page, 'work-bar-services-team-b', 196); await saved(page);
  const moved = await planning(page);
  for (let i = 0; i < 3; i++) expect(moved.document.tasks[i].startDate).not.toBe(before.document.tasks[i].startDate);
  expect(moved.document.tasks[3]).toEqual(before.document.tasks[3]);
  await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await drag(page, architecture, 56, false, 'end'); await saved(page); const resized = await planning(page);
  expect(resized.document.tasks[0].startDate).toBe(before.document.tasks[0].startDate);
  expect(resized.document.tasks[0].endDate).not.toBe(before.document.tasks[0].endDate);
  expect(resized.document.tasks[1].startDate).not.toBe(before.document.tasks[1].startDate);
});
test('form validates weekends, changes team and metadata without scheduling, refresh restores zoom and groups', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'מימוש השירותים בביצוע' }).click();
  await page.getByLabel('תאריך התחלה', { exact: true }).fill('2026-10-16'); await expect(page.getByRole('alert')).toContainText('שישי ושבת');
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
  await page.getByRole('button', { name: 'הוספת עבודה' }).click(); await page.getByLabel('כותרת העבודה').fill('תכנון מהלשונית הראשונה'); await page.getByRole('button', { name: 'שמירת עבודה' }).click(); await saved(page);
  await second.getByRole('button', { name: 'הוספת עבודה' }).click(); await second.getByLabel('כותרת העבודה').fill('שינוי ישן'); await second.getByRole('button', { name: 'שמירת עבודה' }).click();
  await expect(second.getByRole('alert')).toContainText('בלשונית אחרת'); await expect(second.locator('.save-state')).not.toHaveText('נשמר');
  expect((await planning(page)).document.workItems.some((w: any) => w.title === 'שינוי ישן')).toBe(false);
  await second.getByRole('button', { name: 'טעינת הגרסה המקומית החדשה' }).click(); await saved(second); await expect(second.getByRole('button', { name: /תכנון מהלשונית הראשונה/ })).toBeVisible();
});
test('zoom and out-of-range navigation preserve dates; sticky dates and narrow layout', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'התקרבות', exact: true }).click(); await page.getByRole('button', { name: 'תקופה הבאה' }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'תקופה הבאה' }).click();
  await expect(page.getByTestId(architecture)).toHaveCount(0); await page.getByRole('button', { name: 'ניווט למשימה' }).first().click(); await expect(page.getByTestId(architecture)).toBeVisible();
  const header = await page.locator('.timeline-header').boundingBox(); await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 200); expect((await page.locator('.timeline-header').boundingBox())!.y).toBe(header!.y);
  await page.setViewportSize({ width: 560, height: 900 }); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('.timeline-viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
});
test('visual preview capture', async ({ page }) => { await page.screenshot({ path: 'test-results/roadmap-desktop.png', fullPage: true }); });
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
  await page.getByRole('button', { name: 'הוספת עבודה' }).click(); await page.getByLabel('כותרת העבודה').fill('עבודה ריקה'); await page.getByRole('button', { name: 'שמירת עבודה' }).click(); await saved(page);
  const empty = await planning(page), work = empty.document.workItems.find((w: any) => w.title === 'עבודה ריקה'); await expect(page.getByTestId(`work-bar-${work.id}-team-a`)).toHaveCount(0);
  await page.locator('.work-row').filter({ hasText: 'עבודה ריקה' }).getByRole('button', { name: 'עריכת עבודה' }).click(); await page.getByRole('button', { name: 'הוספת משימה', exact: false }).click();
  await page.getByLabel('שם המשימה', { exact: true }).fill('משימה קצרה'); await page.getByRole('button', { name: 'הוספת משימה', exact: true }).click(); await saved(page);
  const added = await planning(page), task = added.document.tasks.find((t: any) => t.title === 'משימה קצרה'); expect(task.startDate).toBe(task.endDate);
  await expect(page.getByTestId(`task-bar-${task.id}-team-a`)).toBeVisible(); expect((await page.getByTestId(`task-bar-${task.id}-team-a`).boundingBox())!.width).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', { name: 'משימה קצרה מתוכננת' }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'מחיקת משימה', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(empty.document.tasks);
});
test('team creation, rename, order and delete with explicit task transfer preserve dates and dependencies', async ({ page }) => {
  const before = await planning(page); await page.getByRole('button', { name: 'ניהול צוותים וגיבוי' }).click(); await page.getByRole('button', { name: 'ניהול צוותים', exact: true }).click();
  await page.getByLabel('צוות חדש').fill('צוות ד׳'); await page.getByRole('button', { name: 'הוספת צוות', exact: true }).click(); await saved(page);
  const row = page.locator('.team-edit-row').filter({ has: page.getByLabel('שם צוות ד׳', { exact: true }) });
  await row.getByRole('button', { name: 'העברת צוות למעלה' }).click(); await saved(page);
  const first = page.locator('.team-edit-row').filter({ has: page.getByLabel('שם צוות א׳', { exact: true }) });
  await first.locator('select').selectOption('team-b'); page.once('dialog', dialog => dialog.accept()); await first.getByRole('button', { name: 'מחיקה', exact: true }).click(); await saved(page);
  const changed = await planning(page); expect(changed.document.tasks[0].teamId).toBe('team-b'); expect(changed.document.tasks[0].startDate).toBe(before.document.tasks[0].startDate); expect(changed.document.dependencies).toEqual(before.document.dependencies);
  expect(changed.document.teams.some((t: any) => t.id === 'team-a')).toBe(false);
});
test('failed IndexedDB writes show error, retain memory for export and recover on retry', async ({ page }) => {
  const before = await planning(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; (window as any).__originalPut = put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota full', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'הוספת עבודה' }).click(); await page.getByLabel('כותרת העבודה').fill('תכנון שלא נשמר'); await page.getByRole('button', { name: 'שמירת עבודה' }).click();
  await expect(page.getByRole('alert')).toContainText('quota full'); await expect(page.locator('.save-state')).not.toHaveText('נשמר'); expect((await planning(page)).document).toEqual(before.document);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא המצב הנוכחי' }).click(); const download = await downloadPromise; const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).document.workItems.some((w: any) => w.title === 'תכנון שלא נשמר')).toBe(true);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__originalPut; }); await page.getByRole('button', { name: 'ניסיון שמירה נוסף' }).click(); await saved(page); expect((await planning(page)).document.workItems.length).toBe(3);
});
test('300-task browser render, vertical sticky dates, stable row DOM during preview, and offline operation', async ({ page, context }) => {
  const stored = await planning(page), doc = stored.document; doc.dependencies = []; const prototype = doc.tasks[0];
  doc.tasks = Array.from({ length: 300 }, (_, i) => ({ ...prototype, id: 'load-task-' + i, title: 'משימה ' + i, teamId: doc.teams[i % 3].id, order: i }));
  const backup = { schemaVersion: 1, exportedAt: new Date().toISOString(), document: doc, preferences: stored.preferences };
  await page.getByRole('button', { name: 'ניהול צוותים וגיבוי' }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: '300.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.getByRole('button', { name: 'אישור והחלפת התכנון' }).click(); await saved(page); await page.getByRole('button', { name: 'סגירת הגיבוי' }).click();
  await expect(page.locator('.task-bar')).toHaveCount(300); const y = (await page.locator('.timeline-header').boundingBox())!.y;
  await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 900); expect((await page.locator('.timeline-header').boundingBox())!.y).toBe(y); await page.locator('.timeline-viewport').evaluate(el => el.scrollTop = 0);
  await page.evaluate(() => { (window as any).__firstRow = document.querySelector('[data-testid="task-bar-load-task-0-team-a"]')?.closest('.timeline-row'); });
  const box = await page.getByTestId('task-bar-load-task-0-team-a').boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + 12); await page.mouse.down(); const start = Date.now(); await page.mouse.move(box!.x + box!.width / 2 + 28, box!.y + 12, { steps: 4 }); expect(Date.now() - start).toBeLessThan(1500);
  expect(await page.evaluate(() => (window as any).__firstRow === document.querySelector('[data-testid="task-bar-load-task-0-team-a"]')?.closest('.timeline-row'))).toBe(true); await page.keyboard.press('Escape'); await page.mouse.up();
  await context.setOffline(true); await page.getByRole('button', { name: 'התקרבות', exact: true }).click(); await saved(page); expect((await planning(page)).document.tasks.length).toBe(300);
});
test('horizontal scroll, period and zoom survive reload; left resize keeps end and pointer cancellation restores preview', async ({ page }) => {
  const before = await planning(page); await drag(page, architecture, 28, false, 'start'); await saved(page); const resized = await planning(page);
  expect(resized.document.tasks[0].endDate).toBe(before.document.tasks[0].endDate); expect(resized.document.tasks[0].startDate).not.toBe(before.document.tasks[0].startDate); expect(resized.document.tasks[1]).toEqual(before.document.tasks[1]);
  const bar = page.getByTestId(architecture), box = await bar.boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + 12); await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 28, box!.y + 12); await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))); await page.mouse.up(); expect((await planning(page)).document.tasks).toEqual(resized.document.tasks);
  await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft += 125); const left = await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft); await expect.poll(async () => (await planning(page)).preferences.scrollLeft).toBe(left);
  await page.reload(); await saved(page); await expect.poll(() => page.locator('.timeline-viewport').evaluate(el => el.scrollLeft)).toBe(left);
});
