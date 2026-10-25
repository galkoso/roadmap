import { expect, test } from './fixtures';
import { seedDocument } from '../src/app/core/seed';
import { RoadmapDocument } from '../src/app/core/model';

test('two independent visitors see the same saved roadmap and live updates', async ({ browser, baseURL, request }) => {
  let shared: RoadmapDocument | null = null;
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    for (const context of [first, second]) {
      await context.route('https://shared-roadmap.test/**', async route => {
        const incoming = route.request(), url = new URL(incoming.url());
        if (url.pathname === '/api/login') { await route.fulfill({ json: { authenticated: true } }); return; }
        if (url.pathname === '/api/roadmap') {
          if (incoming.method() === 'GET') { await route.fulfill({ json: { document: shared } }); return; }
          const body = incoming.postDataJSON();
          if (body.expectedRevision !== (shared?.revision ?? null)) {
            await route.fulfill({ status: 409, json: { error: 'Conflict' } }); return;
          }
          shared = { ...body.document, revision: (shared?.revision ?? 0) + 1 };
          await route.fulfill({ json: { revision: shared!.revision } }); return;
        }
        const response = await request.get(baseURL + url.pathname);
        await route.fulfill({ response });
      });
    }
    const editor = await first.newPage(), viewer = await second.newPage();
    await editor.goto('https://shared-roadmap.test/roadmap');
    await expect(editor.locator('.save-state')).toHaveText('נשמר');
    await viewer.clock.install();
    await viewer.goto('https://shared-roadmap.test/roadmap');
    await expect(viewer.locator('.save-state')).toHaveText('נשמר');
    await expect(viewer.locator('.local-badge')).toContainText('מרחב משותף');
    await editor.getByRole('button', { name: 'עריכת צוותים', exact: true }).click();
    const row = editor.locator('.team-edit-row').first();
    await row.locator('input').fill('צוות משותף לבדיקה');
    await row.getByRole('button', { name: 'שמירת שם', exact: true }).click();
    await expect(editor.locator('.save-state')).toHaveText('נשמר');
    expect(shared!.teams[0].name).toBe('צוות משותף לבדיקה');
    await viewer.clock.fastForward(11000);
    await expect(viewer.getByRole('button', { name: 'שינוי שם הצוות צוות משותף לבדיקה', exact: true })).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByRole('button', { name: 'שינוי שם הצוות צוות משותף לבדיקה', exact: true })).toBeVisible();
    expect(shared!.tasks.length).toBe(seedDocument().tasks.length);
  } finally { await first.close(); await second.close(); }
});
