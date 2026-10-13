import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, signal, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { Backup, clone, isScheduled, uid } from '../core/model';
import { addDays, addYears, formatDate, isWorkingDay, nextWorkingDay, today } from '../core/dates';
import { exportBackup, parseBackup } from '../core/validation';
import { returnToBacklog, shiftWork, workRange } from '../core/scheduler';
import { MembersDialogComponent } from './members-dialog.component';
import { TimelineComponent } from './timeline.component';
import { TaskEditorComponent } from './task-editor.component';
import { CreateWorkDialogComponent } from './create-work-dialog.component';
@Component({
  selector: 'app-roadmap', standalone: true, imports: [MembersDialogComponent, FormsModule, TimelineComponent, TaskEditorComponent, CreateWorkDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roadmap-page.component.html'
})
export class RoadmapPageComponent {
  readonly store = inject(RoadmapStore);
  private readonly route = inject(ActivatedRoute);
  @ViewChild(TaskEditorComponent) taskEditor?: TaskEditorComponent;
  @ViewChild(CreateWorkDialogComponent) createDialog?: CreateWorkDialogComponent; @ViewChild(TimelineComponent) timeline?: TimelineComponent;
  readonly selected = signal<string | null>(null); readonly panel = signal<'teams' | 'backup' | 'work' | null>(null);
  readonly newTaskWork = signal<string | null>(null); readonly menu = signal(false); readonly importCandidate = signal<Backup | null>(null);
  readonly orderedTeams = computed(() => [...this.store.document().teams].sort((a, b) => a.order - b.order));
  workId: string | null = null; workTitle = ''; workStart = ''; workError = ''; teamName = ''; readonly backupError = signal(''); readonly persistenceMessage = signal('');
  teamDrafts: Record<string, string> = {}; transfer: Record<string, string> = {};
  readonly formatted = formatDate;
  private originalWork = '';
  constructor() {
    effect(() => {
      const loaded = this.store.loaded(), id = this.store.focusTaskId() ?? this.route.snapshot.queryParamMap.get('task');
      if (loaded && id) setTimeout(() => {
        if (!this.timeline) return;
        const task = this.store.document().tasks.find(t => t.id === id);
        if (task && isScheduled(task)) { this.selected.set(id); this.timeline.revealTask(id); }
        if (this.store.focusTaskId() === id) this.store.focusTaskId.set(null);
      }, 0);
    });
  }
  private hasPendingEdits(): boolean {
    const dirty = this.taskEditor?.hasUnsavedChanges() || this.createDialog?.opened() ||
      (this.panel() === 'work' && this.originalWork !== JSON.stringify([this.workTitle, this.workStart]));
    const teamDirty = this.panel() === 'teams' && (!!this.teamName.trim() || this.store.document().teams.some(t => this.teamDrafts[t.id] !== t.name));
    return !!(dirty || teamDirty);
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasPendingEdits()) { event.preventDefault(); event.returnValue = ''; }
  }
  canDeactivate(): boolean {
    if (this.hasPendingEdits() && !confirm('יש שינויים שלא נשמרו בטופס. לעבור לעמוד אחר ולבטל אותם?')) return false;
    this.timeline?.captureView(); return true;
  }
  workCreated(event: { id: string; startDate?: string }): void {
    this.panel.set(null); this.closeEditor();
    if (event.startDate) this.timeline?.goTo(event.startDate);
  }
  selectTask(id: string): void { this.selected.set(id); this.newTaskWork.set(null); this.panel.set(null); }
  closeEditor(): void { this.selected.set(null); this.newTaskWork.set(null); }
  editWorkItem(id: string): void {
    const work = this.store.document().workItems.find(w => w.id === id);
    if (work?.teamId === undefined) this.openWork(id); else this.createDialog?.open(undefined, id);
  }
  openWork(id: string): void {
    this.workId = id; this.workTitle = this.store.document().workItems.find(w => w.id === id)?.title ?? '';
    this.workStart = id ? workRange(this.store.document(), id)?.startDate ?? '' : ''; this.workError = '';
    this.originalWork = JSON.stringify([this.workTitle, this.workStart]);
    this.panel.set('work'); this.closeEditor(); this.menu.set(false);
  }
  saveWork(): void {
    if (!this.workTitle.trim()) { this.workError = 'יש להזין כותרת עבודה'; return; }
    try {
      let doc = clone(this.store.document());
      if (this.workId) {
        const work = doc.workItems.find(w => w.id === this.workId)!; work.title = this.workTitle.trim();
        const range = workRange(doc, this.workId);
        if (range && this.workStart !== range.startDate) {
          if (!isWorkingDay(this.workStart)) throw new Error('יש לבחור יום עבודה. התאריך הבא: ' + nextWorkingDay(this.workStart));
          doc = shiftWork(doc, this.workId, this.workStart);
        }
      } else { this.workId = uid(); doc.workItems.push({ id: this.workId, title: this.workTitle.trim(), order: doc.workItems.length }); }
      this.store.commit(doc, 'העבודה נשמרה בכל הצוותים'); this.panel.set(null);
    } catch (error) { this.workError = (error as Error).message; }
  }
  addTask(id: string): void { this.panel.set(null); this.selected.set(null); this.newTaskWork.set(id); }
  moveToBacklog(id: string): void {
    const task = this.store.document().tasks.find(t => t.id === id);
    if (!task || !isScheduled(task) || this.store.importing()) return;
    try {
      const doc = returnToBacklog(this.store.document(), id);
      const draftWarning = this.selected() === id && this.taskEditor?.hasUnsavedChanges() ? ' שינויים שלא נשמרו בטופס לא ייכללו.' : '';
      if (!confirm(`להעביר את ״${task.title}״ לבקלוג? תאריכי השיבוץ יוסרו והיא תצא מציר הזמן.${draftWarning} אפשר לבטל באמצעות Undo.`)) return;
      this.store.commit(doc, `המשימה ״${task.title}״ הועברה לבקלוג`);
      if (this.selected() === id) this.closeEditor();
    } catch (error) { this.store.notice.set((error as Error).message); }
  }
  removeTask(id: string): void {
    const doc = clone(this.store.document()), task = doc.tasks.find(t => t.id === id);
    if (!task || this.store.importing()) return;
    const links = doc.dependencies.filter(d => d.predecessorId === id || d.successorId === id);
    if (!confirm(`למחוק את ״${task.title}״ ואת ${links.length} קשרי התלות שלה? יתר המשימות לא יזוזו. ניתן לבטל באמצעות Undo.`)) return;
    doc.tasks = doc.tasks.filter(t => t.id !== id);
    doc.dependencies = doc.dependencies.filter(d => d.predecessorId !== id && d.successorId !== id);
    this.store.commit(doc, `המשימה ״${task.title}״ וקשריה נמחקו`);
    if (this.selected() === id) this.closeEditor();
  }
  removeWork(id: string | null = this.workId): void {
    const doc = clone(this.store.document()), work = doc.workItems.find(w => w.id === id);
    if (!work || this.store.importing()) return;
    const tasks = doc.tasks.filter(t => t.workItemId === id), ids = new Set(tasks.map(t => t.id));
    const links = doc.dependencies.filter(d => ids.has(d.predecessorId) || ids.has(d.successorId));
    if (!confirm(`מחיקת ״${work.title}״ תסיר ${tasks.length} משימות ו־${links.length} קשרי תלות בכל הצוותים. להמשיך? ניתן לבטל באמצעות Undo.`)) return;
    doc.tasks = doc.tasks.filter(t => !ids.has(t.id)); doc.dependencies = doc.dependencies.filter(d => !links.includes(d));
    doc.workItems = doc.workItems.filter(w => w.id !== id);
    this.store.commit(doc, 'העבודה, המשימות והתלויות נמחקו');
    if (this.workId === id && this.panel() === 'work') this.panel.set(null);
    if (ids.has(this.selected() ?? '') || this.newTaskWork() === id) this.closeEditor();
  }
  showPanel(panel: 'teams' | 'backup'): void {
    this.closeEditor(); this.panel.set(panel); this.menu.set(false);
    if (panel === 'teams') this.teamDrafts = Object.fromEntries(this.store.document().teams.map(t => [t.id, t.name]));
  }
  editTeam(id: string): void {
    this.showPanel('teams');
    setTimeout(() => {
      const field = document.querySelector<HTMLInputElement>(`input[data-team-id="${CSS.escape(id)}"]`);
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' }); field?.focus({ preventScroll: true }); field?.select();
    }, 0);
  }
  renameTeam(id: string): void {
    const name = this.teamDrafts[id]?.trim(); if (!name) { this.store.notice.set('שם הצוות אינו יכול להיות ריק'); return; }
    const doc = clone(this.store.document()); doc.teams.find(t => t.id === id)!.name = name; this.store.commit(doc, 'שם הצוות עודכן');
  }
  addTeam(): void {
    if (!this.teamName.trim()) return; const doc = clone(this.store.document()), id = uid();
    doc.teams.push({ id, name: this.teamName.trim(), order: doc.teams.length }); this.teamDrafts[id] = this.teamName.trim(); this.teamName = ''; this.store.commit(doc, 'הצוות נוסף');
  }
  reorderTeam(id: string, direction: number): void {
    const doc = clone(this.store.document()), teams = [...doc.teams].sort((a, b) => a.order - b.order), index = teams.findIndex(t => t.id === id), next = index + direction;
    if (next < 0 || next >= teams.length) return; [teams[index], teams[next]] = [teams[next], teams[index]]; teams.forEach((t, i) => t.order = i); this.store.commit(doc, 'סדר הצוותים עודכן');
  }
  setGrouping(grouping: 'work' | 'people'): void {
    this.timeline?.captureView(); this.store.setPreferences({ grouping });
    if (this.selected()) this.timeline?.revealGrouping(this.selected()!);
  }
  removeTeam(id: string): void {
    const doc = clone(this.store.document()), tasks = doc.tasks.filter(t => t.teamId === id), headings = doc.workItems.filter(w => w.teamId === id), target = this.transfer[id];
    if (doc.members.some(m => m.teamId === id)) { this.store.notice.set('יש להעביר או להסיר את אנשי הצוות דרך אנשי הצוותים לפני מחיקת הצוות'); return; }
    if (doc.teams.length === 1) { this.store.notice.set('חייב להישאר צוות אחד לפחות'); return; }
    if ((tasks.length || headings.length) && (!target || target === id)) { this.store.notice.set('בחרו צוות שאליו יועברו הכותרות והמשימות לפני המחיקה'); return; }
    if (!confirm(`למחוק את הצוות? ${headings.length} כותרות ו־${tasks.length} משימות יועברו לצוות שנבחר.`)) return;
    for (const heading of headings) heading.teamId = target;
    for (const task of tasks) { task.teamId = target; task.assigneeId = null; } doc.teams = doc.teams.filter(t => t.id !== id); this.store.commit(doc, 'הצוות נמחק');
  }
  teamHeadingCount(id: string): number { return this.store.document().workItems.filter(w => w.teamId === id).length; }
  teamTaskCount(id: string): number { return this.store.document().tasks.filter(t => t.teamId === id).length; }
  navigate(direction: number): void {
    const center = this.timeline?.visibleCenter() ?? this.store.preferences().center, mode = this.store.preferences().mode;
    let date: string;
    if (mode === 'weeks') date = addDays(center, direction * 7);
    else { const value = new Date(center.slice(0, 7) + '-01T00:00:00Z'); value.setUTCMonth(value.getUTCMonth() + direction * (mode === 'quarters' ? 3 : 1)); date = value.toISOString().slice(0, 10); }
    this.store.setPreferences({ center: date, scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); this.timeline?.recenter();
  }
  navigateYear(direction: number): void {
    const center = this.timeline?.visibleCenter() ?? this.store.preferences().center;
    this.store.setPreferences({ center: addYears(center, direction), scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); this.timeline?.recenter();
  }
  goToday(): void { this.store.setPreferences({ center: today(), scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); this.timeline?.recenter(); }
  setMode(mode: 'weeks' | 'months' | 'quarters'): void { this.store.setPreferences({ mode, center: today(), dayWidth: { weeks: 44, months: 28, quarters: 10 }[mode], scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); this.timeline?.recenter(); }
  zoom(direction: number): void { this.store.setPreferences({ center: this.timeline?.visibleCenter() ?? this.store.preferences().center, dayWidth: Math.min(100, Math.max(6, this.store.preferences().dayWidth + direction * 6)), scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); }
  download(): void {
    const blob = new Blob([exportBackup(this.store.document(), this.store.preferences())], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `roadmap-backup-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async readImport(event: Event): Promise<void> {
    this.backupError.set(''); this.importCandidate.set(null);
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    try { if (file.size > 10_000_000) throw new Error('הקובץ גדול מדי (מעל 10MB)'); this.importCandidate.set(parseBackup(await file.text())); }
    catch (error) { this.backupError.set((error as Error).message); }
  }
  async confirmImport(): Promise<void> {
    const candidate = this.importCandidate(); if (!candidate) return;
    try { await this.store.importBackup(candidate); this.importCandidate.set(null); this.closeEditor(); }
    catch (error) { this.backupError.set((error as Error).message); }
  }
  async requestPersistence(): Promise<void> {
    try { const granted = await navigator.storage?.persist?.(); this.persistenceMessage.set(granted ? 'הדפדפן אישר אחסון מתמשך. עדיין מומלץ לייצא גיבויים.' : 'הדפדפן לא אישר אחסון מתמשך. ניתן להמשיך להשתמש ולייצא גיבויים.'); }
    catch { this.persistenceMessage.set('בקשת אחסון מתמשך אינה זמינה בדפדפן זה'); }
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest('input, textarea, select, dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.store.redo() : this.store.undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.store.redo(); }
  }
}
