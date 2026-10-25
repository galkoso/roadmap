import { RoadmapDocument, ViewPreferences } from './model';
import { initialPreferences } from './seed';
import { RevisionConflict, RoadmapStorage, StorageAdapter, Stored } from './storage';
import { reconcilePlanningPreferences } from './planning';
import { validateDocument, validatePreferences } from './validation';

export class SharedRoadmapStorage implements StorageAdapter {
  readonly shared = true;
  private readonly preferencesKey = 'shared-roadmap-preferences-v1';
  private async request(method: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch('/api/roadmap', {
      method, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('roadmap-auth-required'));
      throw new Error('יש להתחבר מחדש כדי להמשיך לתכנון המשותף.');
    }
    if (response.status === 409) throw new RevisionConflict();
    if (!response.ok) throw new Error('לא ניתן להתחבר לתכנון המשותף. בדקו את החיבור ואת הגדרת מסד הנתונים בשרת.');
    return response.json();
  }
  async load(): Promise<Stored | undefined> {
    const result = await this.request('GET');
    if (result['document'] === null) return undefined;
    const document = validateDocument(result['document']);
    let preferences = initialPreferences();
    try {
      const saved = localStorage.getItem(this.preferencesKey);
      if (saved) preferences = validatePreferences(JSON.parse(saved));
    } catch { /* Personal view settings must not prevent loading the shared roadmap. */ }
    if (preferences.planning) preferences.planning = reconcilePlanningPreferences(preferences.planning, document);
    return { document, preferences };
  }
  savePreferences(preferences: ViewPreferences): void {
    try { localStorage.setItem(this.preferencesKey, JSON.stringify(preferences)); } catch { /* The roadmap is saved separately on the server. */ }
  }
  async save(document: RoadmapDocument, preferences: ViewPreferences, expectedRevision: number | null): Promise<number> {
    const result = await this.request('PUT', { document, expectedRevision });
    const revision = result['revision'];
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error('תשובת שמירה לא תקינה');
    this.savePreferences(preferences);
    return Number(revision);
  }
}

export function createRoadmapStorage(): StorageAdapter {
  // Local development keeps existing browser data. Every hosted deployment requires the shared API.
  const local = typeof location === 'undefined' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return local ? new RoadmapStorage() : new SharedRoadmapStorage();
}
