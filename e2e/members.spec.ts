import { expect, Page, test } from '@playwright/test';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('נשמר'); }
async function planning(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('personal-roadmap-v1', 1); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise<any>(resolve => { const r = db.transaction('roadmap').objectStore('roadmap').get('current'); r.onsuccess = () => resolve(r.result); }); db.close(); return result;
  });
}
async function addPerson(page: Page, name: string, team = 'team-b') {
  await page.getByRole('button', { name: 'אנשי הצוותים', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'אנשי הצוותים', exact: true });
  await dialog.getByLabel('שם אדם חדש').fill(name); await dialog.getByLabel('צוות', { exact: true }).last().selectOption(team);
  await dialog.getByRole('button', { name: 'הוספת איש צוות', exact: true }).click(); await saved(page);
  const member = (await planning(page)).document.members.at(-1); await page.keyboard.press('Escape'); return member;
}
async function createBacklog(page: Page, name: string, assignee: string) {
  await page.getByRole('button', { name: 'פריט לבקלוג' }).click();
  const dialog = page.getByRole('dialog', { name: 'פריט לבקלוג', exact: true });
  await dialog.getByLabel('כותרת הפריט').fill(name); await dialog.getByLabel('צוות', { exact: true }).selectOption('team-b');
  await dialog.getByLabel('אחראי למשימה ' + name).selectOption(assignee); await dialog.getByLabel('תיאור / הערות').fill('מידע לשימור');
  await dialog.getByRole('button', { name: 'שמירת פריט', exact: true }).click(); await saved(page);
  return (await planning(page)).document.tasks.find((t: any) => t.title === name);
}
test.beforeEach(async ({ page }) => { await page.goto('/roadmap'); await saved(page); });
test('members, scoped assignment, keyboard collapse, immediate person projection and reload preserve the schedule', async ({ page }) => {
  const a = await addPerson(page, 'דנה'), b = await addPerson(page, 'דנה'), c = await addPerson(page, 'אורי', 'team-a');
  const before = await planning(page), item = before.document.tasks.find((t: any) => t.id === 'implementation');
  await page.getByLabel('אחראי למשימה ' + item.title).selectOption(a.id); await saved(page);
  expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id)).toEqual({ ...item, assigneeId: a.id });
  const viewport = page.locator('.timeline-viewport'), left = await viewport.evaluate(el => el.scrollLeft);
  await page.getByLabel('תצוגת Roadmap').selectOption('people'); await saved(page);
  expect(await viewport.evaluate(el => el.scrollLeft)).toBe(left);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks.map((t: any) => t.id === item.id ? { ...t, assigneeId: a.id } : t));
  await expect(page.locator('.person-title').filter({ hasText: a.id.slice(0, 8) })).toContainText('1 משימות');
  const destination = page.locator('.person-title').filter({ hasText: b.id.slice(0, 8) }); await destination.focus(); await page.keyboard.press('Enter');
  await expect(destination).toHaveAttribute('aria-expanded', 'false');
  const control = page.getByLabel('אחראי למשימה ' + item.title);
  const values = await control.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  expect(values.some(v => v.includes(a.id))).toBe(true); expect(values).not.toContain(c.id);
  await control.selectOption(b.id); await saved(page); await expect(destination).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.assignment-highlight')).toContainText(item.title);
  expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id)).toEqual({ ...item, assigneeId: b.id });
  await page.locator('.task-name').filter({ hasText: item.title }).click();
  const editor = page.getByRole('region', { name: 'עריכת משימה' });
  await editor.getByLabel('צוות אחראי').selectOption('team-a'); await expect(editor).toContainText('האחראי הוסר');
  await editor.getByRole('button', { name: 'שמירת השינויים', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.tasks.find((t: any) => t.id === item.id)).toEqual({ ...item, teamId: 'team-a', assigneeId: null });
  await page.reload(); await saved(page); await expect(page.getByLabel('תצוגת Roadmap')).toHaveValue('people');
  await expect(page.locator('.person-title').filter({ hasText: a.id.slice(0, 8) })).toContainText('אין משימות בציר');
  await page.screenshot({ path: 'test-results/members-roadmap.png', fullPage: true });
});
test('backlog assignment, independent views, scheduling, reveal, return and list mode preserve metadata', async ({ page }) => {
  const member = await addPerson(page, 'רוני'); await page.getByLabel('תצוגת Roadmap').selectOption('people');
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); const item = await createBacklog(page, 'רעיון מוקצה', member.id);
  await page.getByRole('button', { name: 'לפי אנשים', exact: true }).click();
  await expect(page.locator('.person-group').filter({ hasText: 'רוני' }).getByTestId('backlog-row-' + item.id)).toBeVisible();
  await page.getByTestId('backlog-row-' + item.id).getByRole('button', { name: 'שיבוץ בזמן' }).click();
  const dialog = page.getByRole('dialog', { name: 'שיבוץ בזמן', exact: true });
  await expect(dialog.getByLabel('אחראי למשימה ' + item.title)).toHaveValue(member.id);
  await dialog.getByLabel('תאריך התחלה').fill('2027-10-14'); await dialog.getByLabel('מספר ימי עבודה').fill('2');
  await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click(); await saved(page);
  const scheduled = (await planning(page)).document.tasks.find((t: any) => t.id === item.id);
  expect(scheduled.assigneeId).toBe(member.id); expect(scheduled.notes).toBe(item.notes); expect(scheduled.endDate).toBe('2027-10-17');
  await page.getByRole('button', { name: 'הצג בציר הזמן', exact: true }).click();
  await expect(page.getByTestId('task-bar-' + item.id + '-team-b')).toBeVisible(); await expect(page.getByLabel('תצוגת Roadmap')).toHaveValue('people');
  await page.getByTestId('task-bar-' + item.id + '-team-b').click();
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'החזרה לבקלוג', exact: true }).click(); await saved(page);
  const returned = (await planning(page)).document.tasks.find((t: any) => t.id === item.id);
  expect(returned).toEqual({ ...item, estimatedWorkingDays: 2 });
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await expect(page.getByRole('button', { name: 'לפי אנשים', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 650, height: 900 }); await page.screenshot({ path: 'test-results/members-backlog-narrow.png', fullPage: true });
  await page.getByRole('button', { name: 'רשימה אחת', exact: true }).click(); await expect(page.getByTestId('backlog-row-' + item.id)).toHaveCount(1);
  await page.reload(); await saved(page); await expect(page.getByRole('button', { name: 'רשימה אחת', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('move and delete confirmations count both pages, cancel is unchanged, Undo restores bulk cleanup and team deletion is blocked', async ({ page }) => {
  const member = await addPerson(page, 'מיכל'); await page.getByLabel('אחראי למשימה מימוש השירותים').selectOption(member.id); await saved(page);
  await page.getByRole('link', { name: 'בקלוג', exact: true }).click(); await createBacklog(page, 'מחשבה', member.id);
  await page.getByRole('button', { name: 'אנשי הצוותים', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'אנשי הצוותים', exact: true }), form = dialog.locator('.member-edit');
  const before = await planning(page); await form.getByLabel('צוות', { exact: true }).selectOption('team-c');
  page.once('dialog', d => { expect(d.message()).toContain('2 משימות'); return d.dismiss(); });
  await form.getByRole('button', { name: 'שמירת איש צוות', exact: true }).click(); expect((await planning(page)).document).toEqual(before.document);
  await form.getByLabel('צוות', { exact: true }).selectOption('team-c'); page.once('dialog', d => d.accept());
  await form.getByRole('button', { name: 'שמירת איש צוות', exact: true }).click(); await saved(page);
  const moved = (await planning(page)).document; expect(moved.members[0].teamId).toBe('team-c');
  expect(moved.tasks).toEqual(before.document.tasks.map((t: any) => t.assigneeId === member.id ? { ...t, assigneeId: null } : t));
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  await page.getByRole('button', { name: 'אנשי הצוותים', exact: true }).click();
  page.once('dialog', d => { expect(d.message()).toContain('2 משימות'); return d.dismiss(); });
  await form.getByRole('button', { name: 'הסרת איש צוות', exact: true }).click(); expect((await planning(page)).document.tasks).toEqual(before.document.tasks);
  page.once('dialog', d => d.accept()); await form.getByRole('button', { name: 'הסרת איש צוות', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.members).toHaveLength(0); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ביטול שינוי', exact: true }).click(); await saved(page);
  expect((await planning(page)).document.members).toEqual(before.document.members);
  await page.getByRole('link', { name: 'Roadmap', exact: true }).click(); await page.getByRole('button', { name: 'עריכת צוותים', exact: true }).click();
  await page.locator('.team-edit-row').filter({ has: page.locator('input[data-team-id="team-b"]') }).getByRole('button', { name: 'מחיקה', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('יש להעביר או להסיר'); expect((await planning(page)).document.teams).toEqual(before.document.teams);
});
