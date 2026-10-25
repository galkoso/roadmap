import { legacyFields } from '../tests/legacy-fields';
import { expect, Page, test } from './fixtures';
import { SCHEMA_VERSION } from '../src/app/core/model';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function planning(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const open = indexedDB.open('personal-roadmap-v1', 1); open.onsuccess = () => resolve(open.result); });
    const stored = await new Promise<any>(resolve => { const req = db.transaction('roadmap').objectStore('roadmap').get('current'); req.onsuccess = () => resolve(req.result); }); db.close(); return stored;
  });
}
async function create(page: Page, title: string, options?: { team?: string; work?: string; notes?: string }) {
  await page.getByRole('button', { name: 'פריט לבקלוג' }).click();
  const dialog = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true }); await dialog.getByLabel('כותרת הפריט').fill(title);
  if (options?.team) await dialog.getByLabel('צוות', { exact: true }).selectOption({ label: options.team });
  if (options?.work) await dialog.getByLabel('כותרת', { exact: true }).selectOption({ label: options.work });
  if (options?.notes) await dialog.getByLabel('תיאור / הערות').fill(options.notes);
  await dialog.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await planning(page)).document.tasks.some((t: any) => t.title === title)).toBe(true); await saved(page);
  return (await planning(page)).document.tasks.find((t: any) => t.title === title);
}
async function schedule(page: Page, id: string, start = '2027-10-14', days = '2') {
  await page.getByTestId('backlog-row-' + id).getByRole('button', { name: 'שיבוץ בזמן' }).click();
  const dialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true });
  await dialog.getByLabel('תאריך התחלה').fill(start); await dialog.getByLabel('מספר ימי עבודה').fill(days);
  return dialog;
}
test.beforeEach(async ({ page }) => { await page.goto('/backlog'); await saved(page); });
test('date-free unassigned creation, team reassignment and work groups keep a single source of truth', async ({ page }) => {
  const before = await planning(page), a = await create(page, 'פריט ללא שיוכים', { notes: '<b>טקסט בלבד</b>' }), b = await create(page, 'פריט נוסף');
  expect(a.planningState).toBe('backlog'); expect(a.teamId).toBeNull(); expect(a.workItemId).toBeNull(); expect(a.startDate).toBeUndefined(); expect(a.endDate).toBeUndefined();
  const row = page.getByTestId('backlog-row-' + a.id); await expect(row.locator('xpath=ancestor::section[@data-group][1]')).toHaveAttribute('data-group', 'unassigned');
  await row.getByRole('combobox', { name: 'צוות לפריט ' + a.title }).selectOption({ label: 'צוות ב׳' }); await expect(row.locator('xpath=ancestor::section[@data-group][1]')).toHaveAttribute('data-group', 'team:team-b');
  await row.getByRole('combobox', { name: 'צוות לפריט ' + a.title }).selectOption({ label: 'ללא צוות' }); await expect(row.locator('xpath=ancestor::section[@data-group][1]')).toHaveAttribute('data-group', 'unassigned');
  await expect(page.locator('.backlog-row')).toHaveCount(2);
  await expect(page.getByTestId('backlog-row-' + b.id)).toBeVisible();
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === a.id).teamId).toBeNull();
  const after = await planning(page); expect(after.document.teams).toEqual(before.document.teams); expect(after.document.workItems).toEqual(before.document.workItems);
  expect(after.document.tasks.find((t: any) => t.id === a.id).notes).toBe(a.notes); expect(after.document.tasks.filter((t: any) => t.id === a.id)).toHaveLength(1);
});
test('router links, direct refresh, browser Back/Forward and exact timeline view restoration', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'בקלוג המדור' })).toBeVisible(); await expect(page.getByRole('link', { name: 'בקלוג', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await expect(page).toHaveURL(/\/roadmap$/);
  await page.getByRole('button', { name: 'שבועות', exact: true }).click();
  await page.locator('.timeline-viewport').evaluate(el => { el.scrollLeft += 140; el.scrollTop = 120; });
  const state = await page.locator('.timeline-viewport').evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop, start: el.querySelector('.date-header')!.getAttribute('data-range-start') }));
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page).toHaveURL(/\/backlog$/);
  await page.getByRole('button', { name: /ללא צוות.*0 וקטורים/ }).click();
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'שבועות', exact: true })).toHaveClass(/active/);
  await expect.poll(() => page.locator('.timeline-viewport').evaluate(el => el.scrollLeft)).toBe(state.left);
  expect(await page.locator('.date-header').getAttribute('data-range-start')).toBe(state.start);
  await page.goBack(); await expect(page).toHaveURL(/\/backlog$/); await expect(page.getByRole('button', { name: /ללא צוות.*0 וקטורים/ })).toHaveAttribute('aria-expanded', 'false');
  await page.goForward(); await expect(page).toHaveURL(/\/roadmap$/); await page.goto('/backlog'); await page.reload(); await saved(page); await expect(page.getByRole('heading', { name: 'בקלוג המדור' })).toBeVisible();
});
test('schedule keeps identity and metadata, remains in backlog page, reveals independent unassigned task outside the range, then returns and undoes', async ({ page }) => {
  const item = await create(page, 'משימה מדורית עצמאית', { notes: 'הערה לשימור' });
  const dialog = await schedule(page, item.id); await expect(dialog.locator('.schedule-summary')).toContainText('17.10.2027');
  await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click(); await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(/\/backlog$/);
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === item.id).planningState).toBe('scheduled');
  await expect(page.getByTestId('backlog-row-' + item.id)).toHaveCount(0); const scheduled = (await planning(page)).document.tasks.find((t: any) => t.id === item.id);
  expect(scheduled.notes).toBe(item.notes); expect(scheduled.teamId).toBeNull(); expect(scheduled.workItemId).toBeNull();
  await page.getByRole('button', { name: 'הצג בציר הזמן', exact: true }).click(); await expect(page).toHaveURL(/\/roadmap\?task=/);
  const bar = page.getByTestId(`task-bar-${item.id}-__unassigned__`); await expect(bar).toBeInViewport();
  await expect(page.getByRole('button', { name: /משימות עצמאיות/ })).toBeVisible(); await expect(page.getByRole('button', { name: /ללא צוות 1/ })).toBeVisible();
  expect((await planning(page)).document.tasks.filter((t: any) => t.id === item.id)).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'החזרה לבקלוג', exact: true }).click();
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === item.id).planningState).toBe('backlog');
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === item.id).planningState).toBe('scheduled');
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z');
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByTestId('backlog-row-' + item.id)).toBeVisible();
  const returned = (await planning(page)).document.tasks.find((t: any) => t.id === item.id); expect(returned.startDate).toBeUndefined(); expect(returned.notes).toBe(item.notes);
});
test('collapsed groups are opened by show-in-roadmap and backlog items do not extend work range or move when the work is dragged', async ({ page }) => {
  const item = await create(page, 'המשך העבודה המשותפת', { team: 'צוות ג׳', work: 'שדרוג תשתית השירותים' });
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await page.getByRole('button', { name: /צוות ג׳ 1/ }).click(); await page.getByRole('button', { name: 'עריכת עבודה', exact: true }).first().click();
  const stored = await planning(page); await page.getByLabel('הזזת כל העבודה לתאריך התחלה').fill('2026-11-01'); await page.getByRole('button', { name: 'שמירת עבודה' }).click();
  await expect.poll(async () => (await planning(page)).document.tasks[0].startDate).toBe('2026-11-01');
  expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id)).toEqual(stored.document.tasks.find((t: any) => t.id === item.id));
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); const dialog = await schedule(page, item.id); await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click();
  await page.getByRole('button', { name: 'הצג בציר הזמן' }).click(); await expect(page.getByTestId(`task-bar-${item.id}-team-c`)).toBeInViewport();
  await expect(page.getByRole('button', { name: /צוות ג׳ 2/ })).toHaveAttribute('aria-expanded', 'true');
});
test('return blockers name scheduled successors; backlog predecessors block scheduling and dependency removal is explicit', async ({ page }) => {
  await page.getByRole('link', { name: 'Roadmap' }).click(); await page.getByRole('button', { name: 'תכנון הארכיטקטורה הושלמה' }).click(); await page.getByRole('button', { name: 'החזרה לבקלוג' }).click();
  await expect(page.getByRole('alert')).toContainText('מימוש השירותים'); await expect(page.getByRole('alert')).toContainText('בדיקות והטמעה');
  await page.getByRole('button', { name: 'סגירת עריכת משימה' }).click(); await page.getByRole('button', { name: 'בדיקות והטמעה מתוכננת' }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'החזרה לבקלוג' }).click();
  await page.getByRole('button', { name: 'מימוש השירותים בביצוע' }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'החזרה לבקלוג' }).click();
  await page.getByRole('link', { name: 'בקלוג' }).click(); const dialog = await schedule(page, 'testing'); await expect(dialog.getByRole('alert')).toContainText('מימוש השירותים');
  await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click(); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'עריכת הפריט והתלויות' }).click(); const editor = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true }); await editor.getByRole('button', { name: /הסרת תלות/ }).click(); await editor.getByRole('button', { name: 'שמירת פריט' }).click();
  expect((await planning(page)).document.dependencies.some((d: any) => d.successorId === 'testing')).toBe(false);
  const next = await schedule(page, 'testing', '2026-10-15', '1'); await expect(next.locator('.schedule-summary')).toContainText('15.10.2026'); await next.getByRole('button', { name: 'אישור שיבוץ' }).click();
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === 'testing').planningState).toBe('scheduled');
  expect((await planning(page)).document.tasks.find((t: any) => t.id === 'implementation').planningState).toBe('backlog');
});
test('unsaved roadmap forms are protected when navigating; cancelled scheduling does not change the item', async ({ page }) => {
  const item = await create(page, 'שיבוץ לביטול'); const dialog = await schedule(page, item.id); await dialog.getByRole('button', { name: 'ביטול', exact: true }).click();
  expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id)).toEqual(item);
  await page.getByRole('link', { name: 'Roadmap' }).click(); await page.getByRole('button', { name: 'מימוש השירותים בביצוע' }).click(); await page.getByLabel('תיאור / הערות').fill('טיוטה שלא נשמרה');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page).toHaveURL(/\/roadmap$/); await expect(page.getByLabel('תיאור / הערות')).toHaveValue('טיוטה שלא נשמרה');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page).toHaveURL(/\/backlog$/);
});
test('old IndexedDB documents migrate in place; invalid old data remain stored and can be exported for inspection', async ({ page }) => {
  const stored = await planning(page), legacy = { ...stored, document: { ...stored.document, schemaVersion: 1, tasks: stored.document.tasks.map(({ planningState, ...task }: any) => task) } };
  async function replace(value: any) { await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(value, 'current'); tx.oncomplete = () => resolve(); }); db.close();
  }, value); }
  await replace(legacy); await page.reload(); await saved(page); await expect.poll(async () => (await planning(page)).document.schemaVersion).toBe(SCHEMA_VERSION);
  const migrated = await planning(page); expect(migrated.document.tasks.map(legacyFields).map(({ planningState, ...task }: any) => task)).toEqual(legacy.document.tasks);
  legacy.document.tasks[0].startDate = '2026-02-30'; await replace(legacy); await page.reload(); await expect(page.getByRole('alert')).toContainText('תאריך');
  expect((await planning(page)).document).toEqual(legacy.document);
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא הנתונים המקוריים לבדיקה' }).click(); const download = await promise;
  const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).document).toEqual(legacy.document);
});
test('backlog backup and legacy import are atomic; write failure retains the scheduled item in memory without duplicate IDs', async ({ page }) => {
  const item = await create(page, 'פריט גיבוי', { notes: 'צבע והערות נשמרים' }), before = await planning(page);
  await page.evaluate(() => { (window as any).__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota full', 'QuotaExceededError'); }; });
  const dialog = await schedule(page, item.id); await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click(); await expect(page.getByRole('alert')).toContainText('quota full');
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא המצב הנוכחי' }).click(); const download = await promise;
  const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream!) chunks.push(chunk); const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup.schemaVersion).toBe(SCHEMA_VERSION); expect(backup.document.tasks.filter((t: any) => t.id === item.id)).toHaveLength(1); expect(backup.document.tasks.find((t: any) => t.id === item.id).planningState).toBe('scheduled');
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__put; }); await page.getByRole('button', { name: 'ניסיון שמירה נוסף' }).click(); await saved(page);
  await page.reload(); await saved(page); expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id).planningState).toBe('scheduled');
});
test('backlog dialog and small-screen layout are keyboard accessible', async ({ page }) => {
  await page.getByRole('button', { name: 'פריט לבקלוג' }).focus(); await page.keyboard.press('Enter'); await expect(page.getByLabel('כותרת הפריט')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  const item = await create(page, 'פריט לתצוגה צרה'); await page.locator('.backlog-list').focus(); await page.keyboard.press('Control+z'); await expect(page.getByTestId('backlog-row-' + item.id)).toHaveCount(0); await page.keyboard.press('Control+Shift+z'); await expect(page.getByTestId('backlog-row-' + item.id)).toBeVisible(); await page.screenshot({ path: 'test-results/backlog-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 560, height: 900 }); await expect(page.getByRole('heading', { name: 'בקלוג המדור' })).toBeVisible(); await page.getByRole('button', { name: 'שיבוץ בזמן' }).scrollIntoViewIfNeeded(); await expect(page.getByRole('button', { name: 'שיבוץ בזמן' })).toBeInViewport();
});
test('backlog metadata survives a backup round-trip and old backup import migrates without changing old task data', async ({ page }) => {
  const item = await create(page, 'פריט לייצוא', { work: 'שדרוג תשתית השירותים', notes: '<script>טקסט בלבד</script>' });
  await page.getByTestId('backlog-row-' + item.id).getByRole('button', { name: 'פריט לייצוא מתוכננת', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'פריט לבקלוג' }); await editor.getByLabel('משך משוער בימי עבודה').fill('9'); await editor.getByLabel('סטטוס', { exact: true }).selectOption('completed'); await editor.getByRole('button', { name: 'בחירת צבע #239b87', exact: true }).click(); await editor.getByRole('button', { name: 'שמירת פריט' }).click(); await saved(page);
  await page.getByRole('link', { name: 'Roadmap' }).click(); await page.getByRole('button', { name: 'ניהול צוותים וגיבוי' }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא גיבוי JSON' }).click(); const download = await promise;
  const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream!) chunks.push(chunk); const buffer = Buffer.concat(chunks), backup = JSON.parse(buffer.toString());
  expect(backup.document.tasks.find((t: any) => t.id === item.id)).toMatchObject({ planningState: 'backlog', estimatedWorkingDays: 9, color: '#239b87', status: 'completed', notes: item.notes, teamId: null });
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer }); await page.getByRole('button', { name: 'אישור והחלפת התכנון' }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(backup.document.tasks);
  const oldTasks = backup.document.tasks.filter((t: any) => t.planningState === 'scheduled').map(({ planningState, ...task }: any) => task);
  const old = { ...backup, schemaVersion: 1, document: { ...backup.document, schemaVersion: 1, tasks: oldTasks } };
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) }); await page.getByRole('button', { name: 'אישור והחלפת התכנון' }).click();
  await expect.poll(async () => (await planning(page)).document.tasks.length).toBe(oldTasks.length); await saved(page);
  expect((await planning(page)).document.tasks.map(legacyFields).map(({ planningState, ...task }: any) => task)).toEqual(oldTasks);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await planning(page)).document.tasks.length).toBe(backup.document.tasks.length);
});

test('task three-dot menu moves to backlog atomically, supports cancel and Undo, and reports dependency blockers', async ({ page }) => {
  await page.getByRole('link', { name: 'Roadmap' }).click();
  const initial = (await planning(page)).document;
  const actions = page.getByRole('button', { name: 'פעולות משימה בדיקות והטמעה', exact: true });
  await actions.focus(); await page.keyboard.press('Enter');
  const menu = page.locator('#task-menu-testing'); await expect(menu).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss()); await menu.getByRole('button', { name: 'העברה לבקלוג', exact: true }).click();
  await expect(menu).not.toBeVisible(); expect((await planning(page)).document).toEqual(initial);
  await actions.click(); page.once('dialog', dialog => dialog.accept());
  await menu.getByRole('button', { name: 'העברה לבקלוג', exact: true }).click(); await saved(page);
  const moved = (await planning(page)).document;
  const original = initial.tasks.find((t: any) => t.id === 'testing');
  const { startDate, endDate, ...metadata } = original;
  expect(moved.tasks.find((t: any) => t.id === 'testing')).toEqual({ ...metadata, estimatedWorkingDays: 2, planningState: 'backlog' });
  expect(moved.dependencies).toEqual(initial.dependencies);
  await expect(actions).toHaveCount(0);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByTestId('backlog-row-testing')).toBeVisible();
  await page.getByRole('link', { name: 'Roadmap' }).click(); await page.locator('.timeline-viewport').focus(); await page.keyboard.press('Control+z'); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(initial.tasks);
  await page.getByRole('button', { name: 'פעולות משימה תכנון הארכיטקטורה', exact: true }).click();
  await page.locator('#task-menu-architecture').getByRole('button', { name: 'העברה לבקלוג', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('מימוש השירותים'); await expect(page.locator('.notice')).toContainText('בדיקות והטמעה');
  expect((await planning(page)).document.tasks).toEqual(initial.tasks);
  await actions.click(); await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
});

test('backlog-only works disappear from roadmap and both creation forms can save directly to backlog without dates', async ({ page }) => {
  await page.getByRole('link', { name: 'Roadmap' }).click();
  await page.getByRole('button', { name: 'פעולות משימה הקמת מערכת הניטור', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#task-menu-monitor').getByRole('button', { name: 'העברה לבקלוג' }).click(); await saved(page);
  await expect(page.locator('.work-row').filter({ hasText: 'מערכת ניטור חדשה' })).toHaveCount(0);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page);
  await expect(page.locator('.work-row').filter({ hasText: 'מערכת ניטור חדשה' })).toHaveCount(1);
  await page.getByRole('button', { name: 'משימה חדשה', exact: false }).click();
  const standaloneEditor = page.getByRole('region', { name: 'עריכת משימה' });
  await standaloneEditor.getByLabel('שם המשימה', { exact: true }).fill('משימה ישירות לבקלוג');
  await standaloneEditor.getByRole('checkbox', { name: 'הוספה לבקלוג', exact: true }).check();
  await expect(standaloneEditor.getByLabel('תאריך התחלה')).toHaveCount(0);
  await standaloneEditor.getByLabel('צוות אחראי', { exact: true }).selectOption({ label: 'ללא צוות' });
  await standaloneEditor.getByLabel('משך משוער בימי עבודה').fill('8');
  await standaloneEditor.getByRole('button', { name: 'הוספת משימה', exact: true }).click(); await saved(page);
  const created = (await planning(page)).document.tasks.find((t: any) => t.title === 'משימה ישירות לבקלוג');
  expect(created).toMatchObject({ planningState: 'backlog', teamId: null, workItemId: null, estimatedWorkingDays: 8 }); expect(created.startDate).toBeUndefined(); expect(created.endDate).toBeUndefined();
  await expect(page.locator('.task-name').filter({ hasText: created.title })).toHaveCount(0);
  await page.getByRole('button', { name: 'עריכת עבודה', exact: true }).first().click();
  await page.getByRole('region', { name: 'עריכת עבודה' }).getByRole('button', { name: 'הוספת משימה', exact: false }).click();
  const editor = page.getByRole('region', { name: 'עריכת משימה' });
  await editor.getByLabel('שם המשימה', { exact: true }).fill('משימה חדשה בבקלוג');
  await editor.getByRole('checkbox', { name: 'הוספה לבקלוג', exact: true }).check();
  await editor.getByLabel('משך משוער בימי עבודה').fill('4');
  await expect(editor.getByLabel('תאריך התחלה')).toHaveCount(0);
  await editor.getByRole('checkbox', { name: /תכנון הארכיטקטורה/ }).check();
  await editor.getByRole('button', { name: 'הוספת משימה', exact: true }).click(); await saved(page);
  const added = (await planning(page)).document.tasks.find((t: any) => t.title === 'משימה חדשה בבקלוג');
  expect(added.estimatedWorkingDays).toBe(4); expect(added.planningState).toBe('backlog'); expect(added.startDate).toBeUndefined(); expect(added.endDate).toBeUndefined();
  expect((await planning(page)).document.dependencies.some((d: any) => d.successorId === added.id && d.predecessorId === 'architecture')).toBe(true);
  await expect(page.getByRole('button', { name: 'משימה חדשה בבקלוג מתוכננת', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click();
  await expect(page.getByTestId('backlog-row-' + created.id)).toBeVisible(); await expect(page.getByTestId('backlog-row-' + added.id)).toBeVisible();
  await page.reload(); await saved(page); await expect(page.getByTestId('backlog-row-' + created.id)).toBeVisible();
});

test('backlog estimates validate, persist, survive backup and Undo, and prefill scheduling; return uses inclusive working duration', async ({ page }) => {
  await page.getByRole('button', { name: 'פריט לבקלוג' }).click();
  const editor = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true });
  await editor.getByLabel('כותרת הפריט').fill('משימה עם הערכת משך');
  await editor.getByLabel('משך משוער בימי עבודה').fill('0'); await editor.getByRole('button', { name: 'שמירת פריט' }).click();
  await expect(editor.getByRole('alert')).toContainText('משך משוער');
  await editor.getByLabel('משך משוער בימי עבודה').fill('7'); await editor.getByRole('button', { name: 'שמירת פריט' }).click(); await saved(page);
  const item = (await planning(page)).document.tasks.find((t: any) => t.title === 'משימה עם הערכת משך');
  expect(item.estimatedWorkingDays).toBe(7); expect(item.startDate).toBeUndefined();
  const row = page.getByTestId('backlog-row-' + item.id); await expect(row.getByRole('spinbutton')).toHaveValue('7');
  await row.getByRole('button', { name: 'משימה עם הערכת משך מתוכננת', exact: true }).click();
  await editor.getByLabel('משך משוער בימי עבודה').fill('3'); await editor.getByRole('button', { name: 'שמירת פריט' }).click(); await saved(page);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await saved(page); await expect(row.getByRole('spinbutton')).toHaveValue('7');
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z'); await saved(page); await expect(row.getByRole('spinbutton')).toHaveValue('3');
  await page.reload(); await saved(page); await expect(row.getByRole('spinbutton')).toHaveValue('3');
  await row.getByRole('button', { name: 'שיבוץ בזמן' }).click();
  const scheduleDialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true });
  await expect(scheduleDialog.getByLabel('מספר ימי עבודה')).toHaveValue('3');
  await scheduleDialog.getByLabel('תאריך התחלה').fill('2026-10-15');
  await expect(scheduleDialog.locator('.schedule-summary')).toContainText('19.10.2026');
  await scheduleDialog.getByRole('button', { name: 'אישור שיבוץ' }).click(); await saved(page);
  await page.getByRole('button', { name: 'הצג בציר הזמן' }).click();
  await page.getByRole('button', { name: 'פעולות משימה משימה עם הערכת משך', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.locator('[popover]:popover-open').getByRole('button', { name: 'העברה לבקלוג' }).click(); await saved(page);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(row.getByRole('spinbutton')).toHaveValue('3');
});


test('quick duration edits update team totals across teams, validate and persist with Undo', async ({ page }) => {
  const first = await create(page, 'משך מהיר ראשון', { team: 'צוות א׳' });
  const second = await create(page, 'משך מהיר שני', { team: 'צוות א׳' });
  const row = page.getByTestId('backlog-row-' + first.id), duration = row.getByRole('spinbutton');
  const heading = page.locator('[data-group="team:team-a"] > .backlog-group-heading');
  await expect(heading).toContainText('10 ימי עבודה');
  await duration.fill('8'); await duration.press('Enter'); await saved(page);
  await expect(heading).toContainText('13 ימי עבודה');
  await duration.fill('0'); await duration.press('Tab');
  await expect(row.getByRole('alert')).toContainText('מספר שלם'); await expect(duration).toHaveValue('8');
  expect((await planning(page)).document.tasks.find((t: any) => t.id === first.id).estimatedWorkingDays).toBe(8);
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z');
  await expect(duration).toHaveValue('5'); await expect(heading).toContainText('10 ימי עבודה');
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+Shift+z');
  await expect(heading).toContainText('13 ימי עבודה');
  await expect(page.locator('.backlog-group > .backlog-group-heading').filter({ hasText: 'צוות א׳' })).toContainText('13 ימי עבודה');
  await page.getByTestId('backlog-row-' + second.id).getByRole('combobox', { name: 'צוות לפריט ' + second.title }).selectOption({ label: 'צוות ב׳' });
  await expect(page.locator('.backlog-group > .backlog-group-heading').filter({ hasText: 'צוות א׳' })).toContainText('8 ימי עבודה');
  await expect(page.locator('.backlog-group > .backlog-group-heading').filter({ hasText: 'צוות ב׳' })).toContainText('5 ימי עבודה');
  await duration.fill('6'); await duration.press('Tab');
  await expect.poll(async () => (await planning(page)).document.tasks.find((t: any) => t.id === first.id).estimatedWorkingDays).toBe(6); await saved(page);
  await page.reload(); await saved(page); await expect(duration).toHaveValue('6');
  await row.getByRole('button', { name: 'שיבוץ בזמן' }).click();
  await expect(page.getByRole('dialog').getByLabel('מספר ימי עבודה')).toHaveValue('6');
  await page.getByRole('dialog').getByRole('button', { name: 'ביטול', exact: true }).click();
  await heading.click(); await expect(heading).toContainText('6 ימי עבודה');
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
});
