import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

export const test = base.extend<{ authenticatedSession: void }>({
  authenticatedSession: [async ({ context }, use) => {
    const response = await context.request.post('/api/login', { data: { password: 'ztube123ztube123' } });
    if (!response.ok()) throw new Error('Test login failed');
    await use();
  }, { auto: true }]
});
