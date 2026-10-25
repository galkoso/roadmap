import { expect, test } from '@playwright/test';

test('requires only a password, rejects a wrong password, remembers login, and logs out', async ({ page }) => {
  await page.goto('/backlog');
  await expect(page.getByRole('heading', { name: 'מפת הדרכים של המדור' })).toBeVisible();
  await expect(page.locator('.page-navigation')).toHaveCount(0);
  await expect(page.locator('input')).toHaveCount(1);
  await page.getByLabel('סיסמה', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('הסיסמה שגויה. נסו שוב.');
  await page.getByLabel('סיסמה', { exact: true }).fill('ztube123ztube123');
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page.locator('.page-navigation')).toBeVisible();
  await expect(page).toHaveURL(/\/backlog$/);
  await page.reload();
  await expect(page.locator('.page-navigation')).toBeVisible();
  await page.getByRole('button', { name: 'יציאה', exact: true }).click();
  await expect(page.getByLabel('סיסמה', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('סיסמה', { exact: true })).toBeVisible();
});
