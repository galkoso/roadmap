import { computed, Injectable, signal } from '@angular/core';
import { Backup, clone, RoadmapDocument, SCHEMA_VERSION, ViewPreferences } from './model';
import { initialPreferences, seedDocument } from './seed';
import { today } from './dates';
import { RevisionConflict, RoadmapStorage } from './storage';
import { validateDocument, validatePreferences } from './validation';
@Injectable({ providedIn: 'root' })
export class RoadmapStore {
  readonly document = signal<RoadmapDocument>(seedDocument());
  readonly preview = signal<RoadmapDocument | null>(null);
  readonly visible = computed(() => this.preview() ?? this.document());
  readonly preferences = signal<ViewPreferences>(initialPreferences());
  readonly loaded = signal(false);
  readonly importing = signal(false);
  readonly saveStatus = signal('טוען...');
  readonly error = signal('');
  readonly conflict = signal(false);
  readonly notice = signal('');
  readonly focusTaskId = signal<string | null>(null);
  readonly rawRecovery = signal<unknown>(null);
  readonly undoStack = signal<RoadmapDocument[]>([]);
  readonly redoStack = signal<RoadmapDocument[]>([]);
  private storage = new RoadmapStorage();
  private persistedRevision: number | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failed = false;
  private pending = 0;
  constructor() { void this.initialize(); }
  private async initialize(): Promise<void> {
    try {
      const saved = await this.storage.load();
      if (saved) this.rawRecovery.set(saved);
      if (saved) {
        this.document.set(validateDocument(saved.document)); this.preferences.set({ ...validatePreferences(saved.preferences), center: today(), scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 });
        this.persistedRevision = saved.document.revision; this.saveStatus.set(saved.document.schemaVersion === SCHEMA_VERSION ? 'נשמר' : 'מעדכן סכימה...'); this.rawRecovery.set(null);
      }
      this.loaded.set(true);
      if (!saved || saved.document.schemaVersion !== SCHEMA_VERSION) this.queueSave();
    } catch (error) {
      this.failed = true; this.error.set('לא ניתן לטעון תכנון מקומי. לא נכתב או הוחלף מידע. ' + this.message(error));
      this.saveStatus.set('תקלה בטעינה');
    }
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'השמירה המקומית נכשלה'; }
  commit(next: RoadmapDocument, message = 'התכנון עודכן'): void {
    if (!this.loaded() || this.importing()) return;
    next = validateDocument(next);
    this.undoStack.update(stack => [...stack.slice(-49), clone(this.document())]); this.redoStack.set([]);
    this.apply(next, message);
  }
  private apply(next: RoadmapDocument, message: string): void {
    next.revision = this.document().revision; this.document.set(next); this.preview.set(null); this.notice.set(message); this.queueSave();
  }
  undo(): void {
    const stack = this.undoStack(); if (!stack.length || this.importing()) return;
    this.redoStack.update(s => [...s, clone(this.document())]); this.undoStack.set(stack.slice(0, -1));
    this.apply(clone(stack.at(-1)!), 'השינוי בוטל');
  }
  redo(): void {
    const stack = this.redoStack(); if (!stack.length || this.importing()) return;
    this.undoStack.update(s => [...s, clone(this.document())]); this.redoStack.set(stack.slice(0, -1));
    this.apply(clone(stack.at(-1)!), 'השינוי הוחזר');
  }
  setPreferences(patch: Partial<ViewPreferences>): void { if (this.importing()) return; this.preferences.update(p => ({ ...p, ...patch })); if (this.loaded()) this.queueSave(); }
  private queueSave(): void {
    if (this.failed) { this.saveStatus.set('שינויים בזיכרון בלבד'); return; }
    const snapshot = clone(this.document()), prefs = clone(this.preferences());
    this.pending++; this.saveStatus.set('שומר...');
    this.chain = this.chain.then(async () => {
      if (this.failed) { this.pending--; return; }
      try {
        const revision = await this.storage.save(snapshot, prefs, this.persistedRevision);
        this.persistedRevision = revision; this.document.update(d => ({ ...d, revision }));
        this.pending--; if (!this.pending) this.saveStatus.set('נשמר');
      } catch (error) {
        this.pending--; this.failed = true; this.conflict.set(error instanceof RevisionConflict);
        this.error.set(error instanceof RevisionConflict ? error.message : 'השמירה המקומית נכשלה. השינויים נשארו בזיכרון. ' + this.message(error)); this.saveStatus.set('שינויים בזיכרון בלבד');
      }
    });
  }
  retry(): void { if (!this.loaded()) { this.failed = false; this.error.set(''); void this.initialize(); return; } if (this.conflict()) return; this.failed = false; this.error.set(''); this.queueSave(); }
  async reload(): Promise<void> {
    await this.chain;
    try {
      const saved = await this.storage.load(); if (!saved) throw new Error('לא נמצא תכנון שמור');
      const doc = validateDocument(saved.document), prefs = validatePreferences(saved.preferences);
      this.document.set(doc); this.preferences.set(prefs); this.persistedRevision = doc.revision;
      this.failed = false; this.conflict.set(false); this.error.set(''); this.loaded.set(true);
      this.undoStack.set([]); this.redoStack.set([]); this.preview.set(null); this.saveStatus.set('נשמר');
    } catch (error) { this.error.set(this.message(error)); }
  }
  async importBackup(backup: Backup): Promise<void> {
    const doc = validateDocument(backup.document), preferences = validatePreferences(backup.preferences);
    if (this.importing()) throw new Error('ייבוא כבר מתבצע');
    this.importing.set(true);
    await this.chain;
    if (this.failed) { this.importing.set(false); throw new Error('יש לפתור את תקלה השמירה לפני החלפת התכנון'); }
    this.saveStatus.set('שומר...');
    try {
      const revision = await this.storage.save(doc, preferences, this.persistedRevision);
      this.undoStack.update(s => [...s.slice(-49), clone(this.document())]); this.redoStack.set([]);
      this.document.set({ ...doc, revision }); this.preferences.set(preferences); this.persistedRevision = revision;
      this.saveStatus.set('נשמר'); this.notice.set('הגיבוי יובא בהצלחה');
    } catch (error) {
      this.failed = true; this.conflict.set(error instanceof RevisionConflict); this.error.set(this.message(error));
      this.saveStatus.set('תקלה בשמירה'); throw error;
    } finally { this.importing.set(false); }
  }
}
