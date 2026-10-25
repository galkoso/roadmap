import { expect, Page, test } from './fixtures';
import { clone, palette, RoadmapDocument, SCHEMA_VERSION } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { currentPlanningPeriod } from '../src/app/core/planning';
const OCT = '2026-10', NOV = '2026-11';
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
async function period(page: Page, value: string) {
  await page.getByLabel('שנת תכנון', { exact: true }).fill(value.slice(0, 4)); await page.getByLabel('שנת תכנון', { exact: true }).press('Tab');
  await page.getByLabel('חודש תכנון', { exact: true }).selectOption(value.slice(5));
  await expect.poll(async () => (await stored(page)).preferences.planning.activePeriod).toBe(value); await saved(page);
}
async function availability(page: Page, id: string, value: string) {
  const state = await stored(page), member = state.document.members.find((member: any) => member.id === id);
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link', { name: 'Velocity', exact: true }).click();
  await page.locator('.velocity-roster button').filter({ hasText: member.name }).click();
  const dates = page.locator('.velocity-grid button:not(.weekend)');
  for (let index = 0; index < await dates.count(); index++) {
    const button = dates.nth(index), desired = index < Number(value);
    if ((await button.getAttribute('class'))!.includes('present') !== desired) await button.click();
  }
  await expect(page.locator('.velocity-footer')).toContainText('נשמר');
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await saved(page);
}
async function add(page: Page, id: string) { await row(page, 'candidates', id).getByRole('button', { name: '＋ לתכנון', exact: true }).click(); await expect(row(page, 'selected', id)).toBeVisible(); }
async function assign(page: Page, id: string, member: string) { await row(page, 'selected', id).getByRole('combobox', { name: 'אחראי למשימה', exact: false }).selectOption(member); }

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
  await replace(page, { document, preferences: { ...initialPreferences(), planning: { activeTeamId: 'team-a', activePeriod: OCT, expandedTeamIds: [], collapsedGroups: [] }, backlog: { mode: 'teams', collapsed: ['team:team-c'], scrollTop: 0 } } });
});

test('month and year isolate tasks and people availability, persist on reload and survive navigation', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'תכנון חודשי', exact: true })).toHaveAttribute('aria-current', 'page');
  await availability(page, 'm-a', '10'); await add(page, 'a'); await assign(page, 'a', 'm-a');
  await period(page, NOV); await expect(row(page, 'selected', 'a')).toHaveCount(0); await expect(page.locator('[data-member="m-a"] .planning-person-input strong')).toHaveText('22 ימים');
  await expect(row(page, 'candidates', 'a')).toHaveCount(0); await availability(page, 'm-a', '4'); await add(page, 'b');
  await period(page, '2027-10'); await expect(pane(page, 'selected').locator('.planning-task')).toHaveCount(0); await expect(page.getByTestId('planning-available')).toContainText('42');
  await period(page, OCT); await expect(row(page, 'selected', 'a')).toBeVisible(); await expect(row(page, 'selected', 'b')).toHaveCount(0);
  await expect(page.getByTestId('remaining-m-a')).toHaveText('5 ימי עבודה');
  await period(page, NOV); await page.reload(); await saved(page); await expect(page.getByLabel('חודש תכנון', { exact: true })).toHaveValue('11');
  await expect(row(page, 'selected', 'b')).toBeVisible(); await expect(page.locator('[data-member="m-a"] .planning-person-input strong')).toHaveText('4 ימים');
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await page.goBack(); await expect(page).toHaveURL(/\/planning$/); await expect(row(page, 'selected', 'b')).toBeVisible();
  await page.goForward(); await expect(page).toHaveURL(/\/backlog$/); await expect(page.getByTestId('backlog-row-a')).toBeVisible();
});

test('team total comes from people; assignment and reassignment update personal balances using the same task assignees', async ({ page }) => {
  await expect(page.getByLabel('ימי עבודה זמינים לצוות', { exact: true })).toHaveCount(0);
  await expect(page.locator('.planning-person button')).toHaveCount(0);
  await availability(page, 'm-a', '15'); await availability(page, 'm-b', '10'); await expect(page.getByTestId('planning-available')).toContainText('25');
  const tasks = (await stored(page)).document.tasks; await add(page, 'a'); await add(page, 'b'); await assign(page, 'a', 'm-a'); await assign(page, 'b', 'm-a');
  await expect(page.getByTestId('remaining-m-a')).toHaveText('7 ימי עבודה'); await expect(page.getByTestId('remaining-m-b')).toHaveText('10 ימי עבודה');
  await assign(page, 'a', 'm-b'); await expect(page.getByTestId('remaining-m-a')).toHaveText('12 ימי עבודה'); await expect(page.getByTestId('remaining-m-b')).toHaveText('5 ימי עבודה');
  await availability(page, 'm-b', '4'); await expect(page.getByTestId('remaining-m-b')).toHaveText('-1 ימי עבודה'); await expect(page.locator('[data-member="m-b"]')).toContainText('חריגה של 1');
  await expect(page.getByTestId('planning-available')).toContainText('19'); await expect(page.getByTestId('planning-remaining')).toContainText('11');
  expect((await stored(page)).document.tasks).toEqual(tasks.map((t: any) => ({ ...t, assigneeId: t.id === 'a' ? 'm-b' : t.id === 'b' ? 'm-a' : t.assigneeId })));
  await expect(page.locator('.planning-person input')).toHaveCount(0);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click();
  const sharedAssignee = page.getByTestId('backlog-row-a').getByLabel('אחראי למשימה משימה ראשונה');
  await expect(sharedAssignee).toHaveValue('m-b'); await sharedAssignee.selectOption('m-a'); await saved(page);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
  await expect(row(page, 'selected', 'a').getByLabel('אחראי למשימה משימה ראשונה')).toHaveValue('m-a');
  await expect(page.getByTestId('remaining-m-a')).toHaveText('7 ימי עבודה');
  await page.getByRole('button', { name: 'צוות ג׳', exact: true }).click(); await expect(page.getByText('אין אנשים בצוות.', { exact: false })).toBeVisible();
});

test('unassigned backlog selection and per-person assignment reuse the original assignee without changing the team', async ({ page }) => {
  await availability(page, 'm-a', '6'); await page.getByLabel('מקור המשימות לבחירה').selectOption('unassigned'); await expect(row(page, 'candidates', 'a')).toHaveCount(0);
  await add(page, 'no-team'); await assign(page, 'no-team', 'm-a'); await expect(page.getByTestId('remaining-m-a')).toHaveText('5 ימי עבודה');
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByTestId('backlog-row-no-team').getByLabel('צוות לפריט משימה ללא צוות').locator('option:checked')).toHaveText('ללא צוות');
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await page.getByRole('button', { name: 'צוות ב׳', exact: true }).click(); await expect(row(page, 'selected', 'no-team')).toHaveCount(0); await expect(row(page, 'candidates', 'no-team')).toHaveCount(0);
  await page.getByRole('button', { name: 'צוות א׳', exact: true }).click(); await row(page, 'selected', 'no-team').getByRole('button', { name: /^הסרה מהתכנון/ }).click();
  await expect(row(page, 'candidates', 'no-team')).toBeVisible(); await expect(page.getByTestId('remaining-m-a')).toHaveText('6 ימי עבודה');
  const task = (await stored(page)).document.tasks.find((t: any) => t.id === 'no-team'); expect(task).toMatchObject({ teamId: null, assigneeId: 'm-a', planningState: 'backlog' });
});

test('moving a task changes its planning month only and keeps its person assignment', async ({ page }) => {
  await availability(page, 'm-a', '10'); await add(page, 'a'); await assign(page, 'a', 'm-a'); await saved(page); const tasks = (await stored(page)).document.tasks;
  const monthInput = row(page, 'selected', 'a').getByLabel('חודש תכנון משימה ראשונה', { exact: true }); await monthInput.fill(NOV); await page.keyboard.press('Tab');
  await expect(row(page, 'selected', 'a')).toHaveCount(0); await expect(page.getByTestId('remaining-m-a')).toHaveText('10 ימי עבודה');
  await period(page, NOV); await expect(row(page, 'selected', 'a')).toBeVisible(); await expect(row(page, 'selected', 'a').getByLabel('אחראי למשימה משימה ראשונה')).toHaveValue('m-a');
  await expect(page.getByTestId('remaining-m-a')).toHaveText('17 ימי עבודה'); await availability(page, 'm-a', '6'); await expect(page.getByTestId('remaining-m-a')).toHaveText('1 ימי עבודה');
  expect((await stored(page)).document.tasks).toEqual(tasks);
});

test('known effort, missing effort, independent groups and per-month collapse remain coherent', async ({ page }) => {
  await availability(page, 'm-a', '10'); await add(page, 'a'); await add(page, 'unknown'); await assign(page, 'unknown', 'm-a');
  await expect(pane(page, 'selected').locator('.planning-work')).toHaveCount(2); await expect(page.locator('[data-member="m-a"]')).toContainText('1 חסר היקף');
  const selectedToggle = pane(page, 'selected').locator('[data-work="work-a"] .planning-work-toggle'), candidateToggle = pane(page, 'candidates').locator('[data-work="work-a"] .planning-work-toggle');
  await candidateToggle.click(); await expect(selectedToggle).toHaveAttribute('aria-expanded', 'true');
  await row(page, 'selected', 'unknown').getByRole('button', { name: 'השלמת היקף', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true }); await editor.getByLabel('משך משוער בימי עבודה').fill('12'); await editor.getByRole('button', { name: 'שמירת פריט', exact: true }).click();
  await expect(page.getByTestId('remaining-m-a')).toHaveText('-7 ימי עבודה'); await expect(page.getByTestId('planning-effort')).toContainText('17');
  await selectedToggle.click(); await period(page, NOV); await expect(pane(page, 'candidates').locator('[data-work="work-a"] .planning-work-toggle')).toHaveAttribute('aria-expanded', 'true');
  await period(page, OCT); await expect(selectedToggle).toHaveAttribute('aria-expanded', 'false'); await expect(candidateToggle).toHaveAttribute('aria-expanded', 'false');
});

test('person assignments, capacities and task selections participate in Undo/Redo', async ({ page }) => {
  await availability(page, 'm-a', '8'); await add(page, 'b'); await assign(page, 'b', 'm-a'); await expect(page.getByTestId('remaining-m-a')).toHaveText('5 ימי עבודה');
  await page.getByRole('heading', { level: 1 }).click(); await page.keyboard.press('Control+z'); await expect(page.getByTestId('remaining-m-a')).toHaveText('8 ימי עבודה');
  await page.keyboard.press('Control+z'); await expect(row(page, 'selected', 'b')).toHaveCount(0); await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 'selected', 'b')).toBeVisible(); await expect(page.getByTestId('remaining-m-a')).toHaveText('5 ימי עבודה');
});

test('shared scheduling validates dates and dependencies, preserves monthly assignment and removal leaves the schedule', async ({ page }) => {
  await period(page, '2027-02'); await availability(page, 'm-a', '8'); await add(page, 'a'); await assign(page, 'a', 'm-a');
  await row(page, 'selected', 'a').getByRole('button', { name: 'ל־Roadmap', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true });
  await expect(dialog.getByLabel('תאריך התחלה')).toHaveValue('2027-02-01'); await dialog.getByLabel('תאריך התחלה').fill('2027-02-05'); await expect(dialog.locator('.schedule-summary')).toContainText('07.02.2027');
  await dialog.getByRole('button', { name: 'ביטול', exact: true }).click(); await expect(row(page, 'selected', 'a')).toBeVisible();
  await row(page, 'selected', 'a').getByRole('button', { name: 'ל־Roadmap', exact: true }).click(); await dialog.getByLabel('תאריך התחלה').fill('2027-02-04'); await dialog.getByRole('button', { name: 'אישור שיבוץ', exact: true }).click();
  await expect(row(page, 'selected', 'a')).toContainText('שובצה ב־Roadmap'); await expect(page.getByTestId('remaining-m-a')).toHaveText('3 ימי עבודה');
  await row(page, 'selected', 'a').getByRole('button', { name: 'הצג בציר הזמן', exact: true }).click(); await expect(page.getByTestId('task-bar-a-team-a')).toBeInViewport();
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await row(page, 'selected', 'a').getByRole('button', { name: /^הסרה מהתכנון/ }).click(); await expect(page.getByTestId('remaining-m-a')).toHaveText('8 ימי עבודה');
  await expect.poll(async () => (await stored(page)).document.planning.plans.find((p: any) => p.period === '2027-02').selectedTaskIds).toEqual([]);
  expect((await stored(page)).document.tasks.find((t: any) => t.id === 'a')).toMatchObject({ planningState: 'scheduled', startDate: '2027-02-04', endDate: '2027-02-10' });
});

test('old plan migrates to current month without losing selection, availability or original data; backups roundtrip and invalid imports are atomic', async ({ page }) => {
  const state = await stored(page), legacy = { selectedTaskIds: ['a'], teamCapacities: [{ teamId: 'team-a', availableWorkingDays: 40, memberAvailability: [{ memberId: 'm-a', availableWorkingDays: 12 }] }] };
  state.document.schemaVersion = 4; state.document.planning = legacy; state.preferences.planning.activePeriod = currentPlanningPeriod(); await replace(page, state);
  await expect(row(page, 'selected', 'a')).toBeVisible(); await expect(page.getByTestId('planning-available')).toContainText('42');
  const migrated = await stored(page); expect(migrated.document.schemaVersion).toBe(SCHEMA_VERSION); expect(migrated.document.planning.plans[0]).toMatchObject({ ...legacy, period: currentPlanningPeriod() });
  await assign(page, 'a', 'm-a'); await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'ניהול צוותים וגיבוי', exact: true }).click(); await page.getByRole('button', { name: 'גיבוי ושחזור', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'ייצוא גיבוי JSON', exact: false }).click(); const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(SCHEMA_VERSION); expect(backup.document.planning.plans[0]).not.toHaveProperty('taskMemberLinks'); expect(backup.document.tasks.find((t: any) => t.id === 'a').assigneeId).toBe('m-a');
  const bad = clone(backup); bad.document.tasks.find((t: any) => t.id === 'a').assigneeId = 'missing'; const before = await stored(page);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) }); await expect(page.locator('.backup-panel .field-error')).toContainText('אחראי'); expect((await stored(page)).document).toEqual(before.document);
  await page.getByLabel('בחירת קובץ גיבוי').setInputFiles({ name: 'monthly.json', mimeType: 'application/json', buffer }); await page.getByRole('button', { name: 'אישור והחלפת התכנון', exact: true }).click(); await saved(page);
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await expect(page.getByTestId('remaining-m-a')).toHaveText('16 ימי עבודה');
});

test('external member move cleans availability and planning assignments in every month', async ({ page }) => {
  await availability(page, 'm-a', '10'); await add(page, 'a'); await assign(page, 'a', 'm-a');
  await period(page, NOV); await availability(page, 'm-a', '12'); await add(page, 'b'); await assign(page, 'b', 'm-a');
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'אנשי הצוותים', exact: true }).click();
  const people = page.getByRole('dialog', { name: 'אנשי הצוותים', exact: true });
  const first = people.locator('.member-edit').first(); await first.getByLabel('צוות', { exact: true }).selectOption('team-b'); page.once('dialog', d => d.accept()); await first.getByRole('button', { name: 'שמירת איש צוות', exact: true }).click(); await saved(page); await page.keyboard.press('Escape');
  const doc = (await stored(page)).document; expect(doc.attendance.some((entry: any) => entry.memberId === 'm-a')).toBe(true); for (const plan of doc.planning.plans) { expect(plan.teamCapacities).toEqual([]); }
  await page.getByRole('link', { name: 'תכנון חודשי', exact: true }).click(); await expect(row(page, 'selected', 'b').getByRole('combobox', { name: 'אחראי למשימה', exact: false }).locator('option:checked')).toHaveText('ללא אחראי');
});

test('invalid years are rejected and capacity is derived; failed persistence retains monthly selections for retry', async ({ page }) => {
  const year = page.getByLabel('שנת תכנון', { exact: true }); await year.fill('0'); await year.press('Tab'); await expect(page.getByRole('alert')).toContainText('שנה'); await expect(year).toHaveValue('2026'); await page.getByLabel('חודש תכנון', { exact: true }).selectOption('11'); await period(page, OCT); await expect(page.getByRole('alert')).toHaveCount(0); await saved(page);
  await page.evaluate(() => { (window as any).__planningPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota full', 'QuotaExceededError'); }; });
  await add(page, 'a'); await expect(page.getByRole('alert')).toContainText('quota full'); await expect(page.locator('.save-state')).not.toHaveText('נשמר'); expect((await stored(page)).document.planning.plans).toEqual([]);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__planningPut; }); await page.getByRole('button', { name: 'ניסיון שמירה נוסף', exact: true }).click();
  await expect.poll(async () => (await stored(page)).document.planning.plans[0]?.selectedTaskIds).toEqual(['a']); await saved(page);
});

for (const width of [1440, 390]) {
  test(`monthly people workload and compact groups remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await availability(page, 'm-a', '12'); await availability(page, 'm-b', '6'); await add(page, 'a'); await add(page, 'solo'); await assign(page, 'a', 'm-a'); await assign(page, 'solo', 'm-b');
    const toggle = pane(page, 'selected').locator('[data-work="work-a"] .planning-work-toggle'); await toggle.focus(); await toggle.press('Enter'); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(row(page, 'selected', 'a')).toHaveCount(0);
    expect((await toggle.boundingBox())!.height).toBeLessThanOrEqual(60); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('heading', { level: 1 }).click(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `test-results/monthly-people-${width}-collapsed.png`, fullPage: true });
    await toggle.press('Space'); await expect(row(page, 'selected', 'a')).toBeVisible(); await page.getByRole('heading', { level: 1 }).click(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `test-results/monthly-people-${width}.png`, fullPage: true });
  });
}
