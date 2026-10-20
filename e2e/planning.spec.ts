import { expect, Page, test } from '@playwright/test';
import { clone, palette, RoadmapDocument, SCHEMA_VERSION } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
    const value = await new Promise<any>(resolve => { const req = db.transaction('roadmap').objectStore('roadmap').get('current'); req.onsuccess = () => resolve(req.result); }); db.close(); return value;
  });
}
async function replace(page: Page, value: any) {
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('personal-roadmap-v1', 1); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(value, 'current'); tx.oncomplete = () => resolve(); }); db.close();
  }, value);
  await page.reload(); await saved(page);
}
const pane = (page: Page, key: string) => page.locator(`[data-pane="${key}"]`);
const row = (page: Page, key: string, id: string) => pane(page, key).locator(`[data-task="${id}"]`);
async function capacity(page: Page, value: string) {
  await page.getByLabel('ימי עבודה זמינים לצוות', { exact: true }).fill(value);
  await page.locator('.planning-budget-input').getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect.poll(async () => {
    const state = await stored(page), teamId = state.preferences.planning?.activeTeamId ?? state.document.teams[0].id;
    return state.document.planning.teamCapacities.find((item: any) => item.teamId === teamId)?.availableWorkingDays;
  }).toBe(Number(value));
  await saved(page);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/planning'); await saved(page);
  const document: RoadmapDocument = { ...seedDocument(), dependencies: [], members: [
    { id: 'm-a', teamId: 'team-a', name: 'דנה', order: 0 }, { id: 'm-b', teamId: 'team-a', name: 'אורי', order: 1 }
  ], workItems: [{ id: 'work-a', title: 'תשתית משותפת', order: 0 }, { id: 'work-b', title: 'תשתית משותפת', order: 1 }], tasks: [
    { id: 'a', title: 'משימה ראשונה', teamId: 'team-a', workItemId: 'work-a', estimatedWorkingDays: 5, assigneeId: 'm-a' },
    { id: 'b', title: 'משימה שנייה', teamId: 'team-a', workItemId: 'work-a', estimatedWorkingDays: 3, assigneeId: null },
    { id: 'unknown', title: 'משימה ללא היקף', teamId: 'team-a', workItemId: 'work-b', assigneeId: null },
    { id: 'solo', title: 'משימה עצמאית', teamId: 'team-a', workItemId: null, estimatedWorkingDays: 2, assigneeId: null },
    { id: 'other', title: 'משימה לצוות אחר', teamId: 'team-b', workItemId: 'work-a', estimatedWorkingDays: 4, assigneeId: null },
    { id: 'no-team', title: 'משימה ללא צוות', teamId: null, workItemId: null, estimatedWorkingDays: 1, assigneeId: null }
  ].map((task, order) => ({ ...task, order, planningState: 'backlog', notes: 'הערות לשימור', status: 'in_progress', color: palette[0] })) };
  await replace(page, { document, preferences: { ...initialPreferences(), backlog: { mode: 'teams', collapsed: ['team:team-c'], scrollTop: 0 } } });
});

test('route, active link, Back/Forward and manual capacities survive team switches and refresh', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'תכנון חודשי', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'תכנון חודשי', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('planning-remaining')).toHaveText('טרם הוזנה קיבולת');
  await capacity(page, '40.5'); await page.getByRole('button', { name: 'צוות ב׳', exact: true }).click();
  await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveValue(''); await capacity(page, '0');
  await expect.poll(async () => (await stored(page)).document.planning.teamCapacities.find((item: any) => item.teamId === 'team-b')?.availableWorkingDays).toBe(0);
  await page.reload(); await saved(page); await expect(page.getByRole('button', { name: 'צוות ב׳', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'צוות א׳', exact: true }).click(); await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveValue('40.5');
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await page.goBack(); await expect(page).toHaveURL(/\/planning$/);
  await page.goForward(); await expect(page).toHaveURL(/\/backlog$/); await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
  await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveValue('40.5');
});

test('soldier breakdown stays independent, warns on excess and rejects blank saves explicitly', async ({ page }) => {
  await capacity(page, '40'); await page.getByRole('button', { name: 'פירוט לפי חיילים', exact: true }).click();
  await page.getByLabel('דנה', { exact: true }).fill('15'); await page.locator('.planning-member').filter({ has: page.getByLabel('דנה', { exact: true }) }).getByRole('button', { name: 'שמירה', exact: true }).click();
  await page.getByLabel('אורי', { exact: true }).fill('10'); await page.locator('.planning-member').filter({ has: page.getByLabel('אורי', { exact: true }) }).getByRole('button', { name: 'שמירה', exact: true }).click(); await saved(page);
  await expect(page.locator('.planning-distribution')).toContainText('ימי עבודה שטרם חולקו: 15');
  await capacity(page, '20'); await expect(page.locator('.planning-distribution')).toContainText('חורג ב־5');
  await page.getByLabel('ימי עבודה זמינים לצוות', { exact: true }).fill(''); await page.locator('.planning-budget-input button').click();
  await expect(page.getByRole('alert')).toContainText('יש להזין'); expect((await stored(page)).document.planning.teamCapacities[0].availableWorkingDays).toBe(20);
  await page.getByLabel('ימי עבודה זמינים לצוות', { exact: true }).fill('20'); await page.locator('.planning-budget-input button').click();
  await page.reload(); await saved(page); await expect(page.getByLabel('דנה', { exact: true })).toHaveValue('15');
  await page.getByRole('button', { name: 'צוות ג׳', exact: true }).click(); await page.getByRole('button', { name: 'פירוט לפי חיילים', exact: true }).click();
  await expect(page.getByText('אין חיילים בצוות.', { exact: false })).toBeVisible();
  expect((await stored(page)).document.tasks.every((task: any) => task.assigneeId === (task.id === 'a' ? 'm-a' : null))).toBe(true);
});

test('membership moves only between planning panes, opens destinations, supports Undo and keeps original backlog unchanged', async ({ page }) => {
  const before = await stored(page); await capacity(page, '4.5');
  const candidateGroup = pane(page, 'candidates').locator('[data-work="work-a"]'), selectedGroup = pane(page, 'selected').locator('[data-work="work-a"]');
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await saved(page);
  await expect(row(page, 'candidates', 'a')).toHaveCount(0); await expect(row(page, 'selected', 'a')).toBeVisible();
  await expect(selectedGroup.locator('.planning-work-toggle')).toContainText('1 משימות · 5 ימי עבודה');
  await expect(candidateGroup.locator('.planning-work-toggle')).toContainText('1 משימות · 3 ימי עבודה');
  await expect(page.getByTestId('planning-remaining')).toContainText('-0.5'); await expect(page.getByText('חריגה של 0.5 ימי עבודה', { exact: true })).toBeVisible();
  await selectedGroup.locator('.planning-work-toggle').click(); await expect(row(page, 'selected', 'a')).toHaveCount(0);
  await row(page, 'candidates', 'b').getByRole('button', { name: '＋ לתכנון', exact: true }).click();
  await expect(row(page, 'selected', 'a')).toBeVisible(); await expect(candidateGroup).toHaveCount(0);
  await row(page, 'selected', 'a').getByRole('button', { name: 'הסרה מהתכנון משימה ראשונה', exact: true }).click();
  await expect(row(page, 'candidates', 'a')).toBeVisible();
  await candidateGroup.locator('.planning-work-toggle').focus(); await page.keyboard.press('Control+z');
  await expect(row(page, 'selected', 'a')).toBeVisible(); await page.keyboard.press('Control+Shift+z'); await expect(row(page, 'candidates', 'a')).toBeVisible(); await saved(page);
  expect((await stored(page)).document.tasks).toEqual(before.document.tasks);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByTestId('backlog-row-a')).toBeVisible(); await expect(page.getByTestId('backlog-row-b')).toBeVisible();
});

test('work identity, independent collapse, unknown effort and shared estimate editing', async ({ page }) => {
  await capacity(page, '10');
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click();
  await row(page, 'candidates', 'unknown').getByRole('button', { name: '＋ לתכנון', exact: true }).click();
  await expect(pane(page, 'selected').locator('.planning-work')).toHaveCount(2);
  await expect(page.getByTestId('planning-effort')).toContainText('5'); await expect(page.getByText('יתרה לפי היקף ידוע בלבד; אינה סופית', { exact: true })).toBeVisible();
  const candidate = pane(page, 'candidates').locator('[data-work="work-a"] .planning-work-toggle');
  await candidate.click(); await expect(row(page, 'selected', 'a')).toBeVisible();
  await row(page, 'selected', 'unknown').getByRole('button', { name: 'השלמת היקף', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true }); await editor.getByLabel('משך משוער בימי עבודה').fill('7');
  await editor.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await saved(page);
  await expect(page.getByTestId('planning-effort')).toContainText('12'); await expect(page.getByTestId('planning-remaining')).toContainText('-2');
  await expect(candidate).toHaveAttribute('aria-expanded', 'false'); await page.reload(); await saved(page); await expect(candidate).toHaveAttribute('aria-expanded', 'false');
});

test('shared handoff validates, cancels, schedules the same record outside any month and removal leaves it scheduled', async ({ page }) => {
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await saved(page); const before = await stored(page);
  await row(page, 'selected', 'a').getByRole('button', { name: 'ל־Roadmap', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true });
  await expect(dialog.getByLabel('אחראי למשימה משימה ראשונה')).toHaveValue('m-a');
  await dialog.getByLabel('תאריך התחלה').fill('2027-02-05'); await expect(dialog.getByRole('alert')).toContainText('שישי');
  await dialog.getByRole('button', { name: 'אישור שיבוץ', exact: true }).click(); expect((await stored(page)).document.tasks).toEqual(before.document.tasks);
  await dialog.getByRole('button', { name: 'ביטול', exact: true }).click(); expect((await stored(page)).document.planning).toEqual(before.document.planning);
  await row(page, 'selected', 'a').getByRole('button', { name: 'ל־Roadmap', exact: true }).click();
  await dialog.getByLabel('תאריך התחלה').fill('2027-02-04'); await dialog.getByLabel('מספר ימי עבודה').fill('5'); await dialog.getByRole('button', { name: 'אישור שיבוץ', exact: true }).click(); await saved(page);
  await expect(row(page, 'selected', 'a')).toContainText('שובצה ב־Roadmap'); await expect(page.getByTestId('planning-effort')).toContainText('5');
  const after = await stored(page); expect(after.document.tasks).toHaveLength(before.document.tasks.length);
  expect(after.document.tasks.find((t: any) => t.id === 'a')).toMatchObject({ ...before.document.tasks.find((t: any) => t.id === 'a'), planningState: 'scheduled', startDate: '2027-02-04', endDate: '2027-02-10' });
  await row(page, 'selected', 'a').getByRole('button', { name: 'הצג בציר הזמן', exact: true }).click(); await expect(page.getByTestId('task-bar-a-team-a')).toBeInViewport();
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await row(page, 'selected', 'a').getByRole('button', { name: 'הסרה מהתכנון משימה ראשונה', exact: true }).click(); await saved(page);
  await expect(row(page, 'candidates', 'a')).toHaveCount(0); expect((await stored(page)).document.tasks).toEqual(after.document.tasks);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByTestId('backlog-row-a')).toHaveCount(0);
});

test('unscheduled dependencies remain blockers in the reused scheduling dialog', async ({ page }) => {
  const state = await stored(page); state.document.dependencies = [{ id: 'link', predecessorId: 'b', successorId: 'a', type: 'finish_to_start', lagWorkingDays: 0 }]; await replace(page, state);
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await saved(page); const before = await stored(page);
  await row(page, 'selected', 'a').getByRole('button', { name: 'ל־Roadmap', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true }); await expect(dialog.getByRole('alert')).toContainText('משימה שנייה');
  await dialog.getByRole('button', { name: 'אישור שיבוץ', exact: true }).click(); await dialog.getByRole('button', { name: 'ביטול', exact: true }).click();
  expect((await stored(page)).document.tasks).toEqual(before.document.tasks); expect((await stored(page)).document.planning).toEqual(before.document.planning);
});

for (const width of [1440, 390]) {
  test(`mixed selection, compact groups and keyboard disclosure at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await capacity(page, '20');
    for (const id of ['a', 'solo']) await row(page, 'candidates', id).getByRole('button', { name: '＋ לתכנון', exact: true }).click();
    const disclosure = pane(page, 'selected').locator('[data-work="work-a"] .planning-work-toggle'); await disclosure.focus(); await disclosure.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false'); await expect(row(page, 'selected', 'a')).toHaveCount(0);
    const box = await disclosure.boundingBox(); expect(box!.height).toBeLessThanOrEqual(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('heading', { level: 1 }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    await page.screenshot({ path: `test-results/planning-${width}.png`, fullPage: true });
    await disclosure.press('Space'); await expect(row(page, 'selected', 'a')).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    await page.screenshot({ path: `test-results/planning-${width}-expanded.png`, fullPage: true });
  });
}

test('JSON backup roundtrip includes capacities and preferences; invalid import is atomic and old backup starts empty', async ({ page }) => {
  await capacity(page, '20'); await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await saved(page); const before = await stored(page);
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'ניהול צוותים וגיבוי', exact: true }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא גיבוי JSON', exact: false }).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(SCHEMA_VERSION); expect(backup.document.planning).toEqual(before.document.planning);
  const bad = clone(backup); bad.document.planning.selectedTaskIds.push('missing'); const snapshot = await stored(page);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.locator('.backup-panel .field-error')).toContainText('משימה חסרה'); expect((await stored(page)).document).toEqual(snapshot.document);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'planning.json', mimeType: 'application/json', buffer }); await page.getByRole('button', { name: 'אישור והחלפת התכנון', exact: true }).click(); await saved(page);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await expect(row(page, 'selected', 'a')).toBeVisible(); await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveValue('20');
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'ניהול צוותים וגיבוי', exact: true }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  const old = clone(backup); old.schemaVersion = old.document.schemaVersion = 3; delete old.document.planning; delete old.preferences.planning;
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) }); await page.getByRole('button', { name: 'אישור והחלפת התכנון', exact: true }).click(); await saved(page);
  const imported = await stored(page); expect(imported.document.tasks).toEqual(backup.document.tasks); expect(imported.document.planning).toEqual({ selectedTaskIds: [], teamCapacities: [] });
});

test('real team reassignment follows the task, no-team selection is explicit, and deletion cleans membership', async ({ page }) => {
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await saved(page);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click();
  await page.getByTestId('backlog-row-a').getByLabel('צוות לפריט משימה ראשונה').selectOption('team-b'); await saved(page);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await expect(row(page, 'selected', 'a')).toHaveCount(0);
  await page.getByRole('button', { name: 'צוות ב׳', exact: true }).click(); await expect(row(page, 'selected', 'a')).toBeVisible();
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await page.getByTestId('backlog-row-a').getByLabel('צוות לפריט משימה ראשונה').selectOption({ label: 'ללא צוות' }); await saved(page);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
  const unresolved = page.getByRole('region', { name: 'משימות בתכנון ללא צוות' }); await expect(unresolved).toContainText('משימה ראשונה');
  await unresolved.getByRole('button', { name: 'עדכון צוות', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true });
  await dialog.getByLabel('צוות', { exact: true }).selectOption('team-a'); await dialog.getByLabel('כותרת הפריט').fill('משימה ששונתה'); await dialog.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await saved(page);
  await expect(unresolved).toHaveCount(0); await page.getByRole('button', { name: 'צוות א׳', exact: true }).click(); await expect(row(page, 'selected', 'a')).toContainText('משימה ששונתה');
  await row(page, 'selected', 'a').locator('.planning-task-title').click(); page.once('dialog', d => d.accept()); await dialog.getByRole('button', { name: 'מחיקת פריט', exact: true }).click();
  await expect.poll(async () => (await stored(page)).document.planning.selectedTaskIds).toEqual([]); await expect(row(page, 'selected', 'a')).toHaveCount(0);
});

test('navigation through planning preserves Roadmap range and backlog collapse state', async ({ page }) => {
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'שבועות', exact: true }).click();
  const viewport = page.locator('.timeline-viewport'); await viewport.evaluate(el => el.scrollLeft += 130);
  const state = await viewport.evaluate(el => ({ left: el.scrollLeft, range: el.querySelector('.date-header')!.getAttribute('data-range-start') }));
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await page.getByRole('link', { name: 'בקלוג', exact: true }).click();
  const heading = page.locator('[data-group="team:team-a"] > .backlog-group-heading'); await heading.click(); await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'שבועות', exact: true })).toHaveClass(/active/);
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(state.left); expect(await page.locator('.date-header').getAttribute('data-range-start')).toBe(state.range);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(heading).toHaveAttribute('aria-expanded', 'false');
});

test('planning save failure preserves stored data, keeps one in-memory selection and reports an unsaved state', async ({ page }) => {
  const before = await stored(page);
  await page.evaluate(() => { (window as any).__planningPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota full', 'QuotaExceededError'); }; });
  await row(page, 'candidates', 'a').getByRole('button', { name: '＋ לתכנון', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('quota full'); await expect(page.locator('.save-state')).not.toHaveText('נשמר');
  await expect(row(page, 'selected', 'a')).toHaveCount(1); expect((await stored(page)).document.planning).toEqual(before.document.planning);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__planningPut; }); await page.getByRole('button', { name: 'ניסיון שמירה נוסף', exact: true }).click(); await saved(page);
  await expect.poll(async () => (await stored(page)).document.planning.selectedTaskIds).toEqual(['a']);
  await page.reload(); await saved(page); await expect(row(page, 'selected', 'a')).toHaveCount(1);
});
