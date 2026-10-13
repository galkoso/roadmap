import { RoadmapDocument, ViewPreferences } from './model';
export class RevisionConflict extends Error { constructor() { super('התכנון השתנה בלשונית אחרת. השינויים בזיכרון נשמרו; ייצאו גיבוי או טענו את הגרסה החדשה'); } }
interface Stored { document: RoadmapDocument; preferences: ViewPreferences }
export class RoadmapStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly name = 'personal-roadmap-v1') {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('roadmap');
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => { this.database = undefined; reject(request.error); };
      request.onblocked = () => reject(new Error('פתיחת השמירה חסומה בלשונית אחרת'));
    });
  }
  async load(): Promise<Stored | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roadmap', 'readonly'), request = tx.objectStore('roadmap').get('current');
      let result: Stored | undefined;
      request.onsuccess = () => { result = request.result as Stored | undefined; };
      tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async save(document: RoadmapDocument, preferences: ViewPreferences, expectedRevision: number | null): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roadmap', 'readwrite'), store = tx.objectStore('roadmap');
      const get = store.get('current'); let conflict = false, revision = 0; let writeError: unknown;
      get.onsuccess = () => {
        const stored = get.result as Stored | undefined;
        const current = stored?.document.revision ?? null;
        if (current !== expectedRevision) { conflict = true; tx.abort(); return; }
        revision = (current ?? 0) + 1;
        try { store.put({ document: { ...document, revision }, preferences }, 'current'); } catch (error) { writeError = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(revision);
      tx.onabort = tx.onerror = () => reject(conflict ? new RevisionConflict() : writeError ?? tx.error ?? new Error('השמירה המקומית נכשלה'));
    });
  }
}
