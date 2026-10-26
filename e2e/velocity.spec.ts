import { expect, test } from './fixtures';
import { seedDocument, initialPreferences } from '../src/app/core/seed';

for (const width of [1440, 390]) {
  test(`attendance, shared planning capacity and calendar-aware real scheduling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1050 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/roadmap'); await expect(page.locator('.save-state')).toHaveText('נשמר');
    const document = seedDocument(); document.tasks = []; document.dependencies = []; document.attendance = [];
    document.members = [{ id: 'noa', teamId: 'team-a', name: 'נועה', order: 0 }, { id: 'dor', teamId: 'team-a', name: 'דור', order: 1 }];
    document.tasks.push({ id: 'velocity-task', assigneeId: 'noa', teamId: 'team-a', workItemId: 'services', title: 'משימת זמינות', estimatedWorkingDays: 5,
      planningState: 'backlog', color: '#3975d5', status: 'planned', notes: '', order: 0 });
    document.attendance = ['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-03', '2026-11-04'].map(date => ({ memberId: 'noa', date, status: 'absent' as const }));
    document.planning.plans = [{ period: '2026-10', selectedTaskIds: ['velocity-task'], teamCapacities: [] }];
    const preferences = { ...initialPreferences(), center: '2026-10-25', planning: { activeTeamId: 'team-a', activePeriod: '2026-10', collapsedGroups: [], expandedTeamIds: [] } };
    await page.evaluate(async saved => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('personal-roadmap-v1', 1); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(saved, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    }, { document, preferences });
    await page.goto('/velocity');
    await expect(page.getByRole('heading', { name: 'Velocity', exact: true })).toBeVisible();
    await expect(page.locator('.velocity-team-total')).toContainText('40');
    await expect(page.locator('.velocity-calendar h2')).toContainText('19');
    await expect(page.locator('[data-date="2026-10-30"]')).toBeDisabled();
    await expect(page.locator('.velocity-page form')).toHaveCount(0);
    await page.locator('[data-date="2026-10-27"]').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.velocity-team-total')).toContainText('39');
    await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('.velocity-team-total')).toContainText('40');
    await page.getByLabel('שנה', { exact: true }).fill('2027'); await page.getByLabel('שנה', { exact: true }).press('Tab');
    await expect(page.locator('[data-date="2027-10-26"]')).toHaveClass(/present/);
    await page.getByLabel('שנה', { exact: true }).fill('2026'); await page.getByLabel('שנה', { exact: true }).press('Tab');
    await expect(page.locator('[data-date="2026-10-26"]')).toHaveClass(/absent/);
    await expect(page.locator('.velocity-page')).toHaveAttribute('data-save-status', 'נשמר'); await page.reload();
    await expect(page.locator('[data-date="2026-10-26"]')).toHaveClass(/absent/);
    await page.screenshot({ path: `/tmp/velocity-calendar-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
    await expect(page.getByTestId('planning-available')).toContainText('40');
    await expect(page.getByTestId('planning-effort')).toContainText('5');
    await expect(page.locator('[data-member="noa"] input')).toHaveCount(0);
    await page.getByRole('button', { name: 'ל־Roadmap', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[name="schedule-start"]').fill('2026-10-25');
    await expect(dialog.locator('.schedule-summary')).toContainText('05.11.2026');
    await expect(dialog.locator('.schedule-summary')).toContainText('12 ימים קלנדריים');
    await dialog.getByRole('button', { name: 'אישור שיבוץ' }).click();
    await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link', { name: 'Roadmap', exact: true }).click();
    const bar = page.locator('.bar').filter({ hasText: '25.10' }).last();
    await expect(bar).toBeVisible(); await expect(bar).toHaveAttribute('aria-label', /5 ימי עבודה · 12 ימים קלנדריים/);
    if (width === 1440) await bar.hover(); else await bar.focus();
    await expect(page.getByRole('tooltip')).toHaveText('משימת זמינות');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    const taskRow = page.locator('.timeline-row').filter({ has: page.locator('[data-testid="task-bar-velocity-task-team-a"]') });
    await expect(taskRow.locator('.absence-marker')).toHaveCount(5);
    await expect(taskRow.locator('.absence-marker[data-date="2026-10-26"]')).toHaveAttribute('aria-label', /נועה · לא נמצא · 26.10.2026/);
    await expect(taskRow.locator('.absence-marker[data-date="2026-10-27"]')).toHaveCount(0);
    await expect(page.locator('.team-row .absence-marker')).toHaveCount(5);
    await page.getByLabel('תצוגת Roadmap', { exact: true }).selectOption('people');
    const noa = page.locator('.person-row').filter({ hasText: 'נועה' });
    const dor = page.locator('.person-row').filter({ hasText: 'דור' });
    await expect(noa.locator('.absence-marker')).toHaveCount(5);
    await expect(dor.locator('.absence-marker')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/roadmap-absences-${width}.png`, fullPage: true });
    await page.getByLabel('תצוגת Roadmap', { exact: true }).selectOption('work');
    await page.getByRole('button', { name: 'משימת זמינות מתוכננת', exact: true }).click(); await expect(page.locator('.editor-panel')).toContainText('5 ימי עבודה · 12 ימים קלנדריים');
    await page.screenshot({ path: `/tmp/velocity-roadmap-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  test(`website period drives planning and velocity across navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 768 : 844 });
    await page.goto('/roadmap'); await expect(page.locator('.save-state')).toHaveText('נשמר');
    const document = seedDocument();
    document.members = [{ id: 'noa', teamId: 'team-a', name: 'נועה', order: 0 }];
    await page.evaluate(async saved => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('personal-roadmap-v1', 1); request.onsuccess = () => resolve(request.result); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('roadmap', 'readwrite'); tx.objectStore('roadmap').put(saved, 'current'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    }, { document, preferences: initialPreferences() });
    await page.reload(); await expect(page.locator('.save-state')).toHaveText('נשמר');
    const period = page.getByRole('group', { name: 'תקופת האתר' });
    await period.getByLabel('שנה', { exact: true }).fill('2027');
    await period.getByLabel('שנה', { exact: true }).press('Tab');
    await period.getByLabel('חודש', { exact: true }).selectOption('02');
    const navigation = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await navigation.getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
    const february = await page.getByTestId('planning-available').innerText();
    await navigation.getByRole('link', { name: 'Velocity', exact: true }).click();
    await expect(page.locator('[data-date="2027-02-01"]')).toBeVisible();
    await expect(page.locator('.velocity-team-total')).toContainText(february.split(' ')[0]);
    await period.getByLabel('חודש', { exact: true }).selectOption('03');
    await expect(page.locator('[data-date="2027-03-31"]')).toBeVisible();
    await expect(page.locator('[data-date="2027-02-01"]')).toHaveCount(0);
    const march = (await page.locator('.velocity-team-total strong').innerText()).trim();
    await navigation.getByRole('link', { name: 'תכנון חודשי', exact: true }).click();
    await expect(page.getByTestId('planning-available')).toContainText(march);
    await expect(page.locator('.save-state')).toHaveText('נשמר');
    await page.reload();
    await expect(period.getByLabel('חודש', { exact: true })).toHaveValue('03');
    await expect(period.getByLabel('שנה', { exact: true })).toHaveValue('2027');
    await navigation.getByRole('link', { name: 'Velocity', exact: true }).click();
    await period.getByLabel('חודש', { exact: true }).selectOption('05');
    await expect(page.locator('[data-date="2027-05-01"]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-date="2027-05-31"]')).toBeInViewport({ ratio: 1 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
