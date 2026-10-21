import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedRoadmapStorage } from '../src/app/core/shared-storage';
import { RoadmapStore } from '../src/app/core/store';
import { clone } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { RevisionConflict } from '../src/app/core/storage';
import handler, { saveScript } from '../api/roadmap';

const stores: RoadmapStore[] = [];
let shared: ReturnType<typeof seedDocument> | null;
beforeEach(() => {
  shared = null;
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { stores.splice(0).forEach(store => store.ngOnDestroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function mockApi() {
  vi.stubGlobal('location', { hostname: 'roadmap.example' });
  return vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json({ document: shared });
    const body = JSON.parse(String(init.body));
    if (body.expectedRevision !== (shared?.revision ?? null)) return Response.json({}, { status: 409 });
    shared = { ...body.document, revision: (shared?.revision ?? 0) + 1 };
    return Response.json({ revision: shared!.revision });
  }));
}
async function newStore() {
  const store = new RoadmapStore(); stores.push(store);
  await vi.waitFor(() => expect(store.saveStatus()).toBe('נשמר'));
  return store;
}
describe('shared roadmap client and synchronization', () => {
  it('loads the same roadmap across visitors, refreshes changes, and keeps view preferences out of shared writes', async () => {
    mockApi(); const first = await newStore(), second = await newStore();
    const next = clone(first.document()); next.teams[0].name = 'Shared team'; first.commit(next);
    await vi.waitFor(() => expect(shared?.teams[0].name).toBe('Shared team'));
    await second.refreshShared(); expect(second.document().teams[0].name).toBe('Shared team');
    const revision = shared!.revision;
    second.setPreferences({ dayWidth: 70 }); expect(shared!.revision).toBe(revision);
    expect(second.preferences().dayWidth).toBe(70); expect(first.preferences().dayWidth).not.toBe(70);
    expect(second.undoStack()).toEqual([]);
  });
  it('rejects stale edits without overwriting newer saved data or losing unsaved changes', async () => {
    mockApi(); const first = await newStore(), second = await newStore();
    const newer = clone(first.document()); newer.teams[0].name = 'First writer'; first.commit(newer);
    await vi.waitFor(() => expect(shared?.teams[0].name).toBe('First writer'));
    const stale = clone(second.document()); stale.teams[0].name = 'Unsaved writer'; second.commit(stale);
    await vi.waitFor(() => expect(second.conflict()).toBe(true));
    expect(shared!.teams[0].name).toBe('First writer'); expect(second.document().teams[0].name).toBe('Unsaved writer');
    await second.refreshShared(); expect(second.document().teams[0].name).toBe('Unsaved writer');
    await second.reload(); expect(second.document().teams[0].name).toBe('First writer'); expect(second.conflict()).toBe(false);
  });
  it('never overwrites a local edit when an earlier refresh completes later', async () => {
    mockApi(); const store = await newStore();
    let complete!: (value: { document: ReturnType<typeof seedDocument>; preferences: ReturnType<typeof initialPreferences> }) => void;
    vi.spyOn(SharedRoadmapStorage.prototype, 'load').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const refreshing = store.refreshShared();
    const next = clone(store.document()); next.teams[0].name = 'Local edit'; store.commit(next);
    await vi.waitFor(() => expect(shared!.teams[0].name).toBe('Local edit'));
    complete({ document: { ...seedDocument(), revision: 99 }, preferences: initialPreferences() });
    await refreshing; expect(store.document().teams[0].name).toBe('Local edit');
  });
  it('fails visibly when the database is unavailable instead of creating a separate local roadmap', async () => {
    vi.stubGlobal('location', { hostname: 'roadmap.example' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    const store = new RoadmapStore(); stores.push(store);
    await vi.waitFor(() => expect(store.error()).not.toBe(''));
    expect(store.loaded()).toBe(false); expect(store.shared).toBe(true); expect(store.saveStatus()).not.toBe('נשמר');
  });
  it('does not claim a failed remote write succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    await expect(new SharedRoadmapStorage().save(seedDocument(), initialPreferences(), null)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 409 })));
    await expect(new SharedRoadmapStorage().save(seedDocument(), initialPreferences(), null)).rejects.toBeInstanceOf(RevisionConflict);
  });
});

function response() {
  return { code: 200, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; } };
}
function mockRedis() {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'server-secret');
  return vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const command = JSON.parse(String(init.body));
    if (command[0] === 'GET') return Response.json({ result: shared === null ? null : JSON.stringify(shared) });
    expect(command.slice(0, 3)).toEqual(['EVAL', saveScript, 1]);
    if (command[4] !== String(shared?.revision ?? null)) return Response.json({ result: -1 });
    shared = JSON.parse(command[5]); return Response.json({ result: shared!.revision });
  }));
}
describe('shared server API', () => {
  it('validates data and uses atomic compare-and-set for new and existing documents', async () => {
    mockRedis();
    const save = async (document: unknown, expectedRevision: number | null) => {
      const result = response(); await handler({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: { document, expectedRevision } }, result); return result;
    };
    const first = await save(seedDocument(), null); expect(first.code).toBe(200); expect(first.body.revision).toBe(1);
    const stale = await save(seedDocument(), null); expect(stale.code).toBe(409);
    const next = seedDocument(); next.teams[0].name = 'New shared name';
    expect((await save(next, 1)).body.revision).toBe(2);
    const before = clone(shared); expect((await save({ schemaVersion: 99 }, 2)).code).toBe(400); expect(shared).toEqual(before);
    const loaded = response(); await handler({ method: 'GET', headers: {} }, loaded);
    expect(loaded.body.document.teams[0].name).toBe('New shared name');
    expect(loaded.headers['Cache-Control']).toBe('no-store'); expect(JSON.stringify(loaded.body)).not.toContain('server-secret');
  });
  it('preserves empty arrays in the JSON sent to Redis', async () => {
    mockRedis(); const document = seedDocument(); document.dependencies = []; document.planning.plans = [];
    const result = response(); await handler({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: { document, expectedRevision: null } }, result);
    expect(result.code).toBe(200); expect(shared!.dependencies).toEqual([]); expect(shared!.planning.plans).toEqual([]);
    expect(saveScript).toContain("redis.call('SET', KEYS[1], ARGV[2])");
  });
  it('reports missing configuration, unsupported methods, non-JSON requests and database failures', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const unconfigured = response(); await handler({ method: 'GET', headers: {} }, unconfigured); expect(unconfigured.code).toBe(503);
    mockRedis();
    const invalidMethod = response(); await handler({ method: 'DELETE', headers: {} }, invalidMethod); expect(invalidMethod.code).toBe(405);
    const invalidType = response(); await handler({ method: 'PUT', headers: { 'content-type': 'text/plain' } }, invalidType); expect(invalidType.code).toBe(415);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private credential error'); }));
    const failure = response(); await handler({ method: 'GET', headers: {} }, failure); expect(failure.code).toBe(503);
    expect(JSON.stringify(failure.body)).not.toContain('private credential');
  });
});
