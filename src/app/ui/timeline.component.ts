import { AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, output, ViewChild } from '@angular/core';
import { RoadmapStore } from '../core/store';
import { clone, RoadmapDocument, Task, Team, WorkItem } from '../core/model';
import { addDays, daysBetween, duration, formatDate, isWorkingDay, monthLabel, nextWorkingDay, today } from '../core/dates';
import { editTask, shiftTask, shiftWork, workRange } from '../core/scheduler';
import { statuses } from '../core/model';
interface Row { key: string; kind: 'team' | 'work' | 'task'; team: Team; work?: WorkItem; task?: Task; start?: string; end?: string; shared?: boolean }
interface Drag { pointer: number; x: number; id: string; kind: 'work' | 'move' | 'start' | 'end'; base: RoadmapDocument; start: string; end: string; next: RoadmapDocument; moved: boolean }
@Component({
  selector: 'app-timeline', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="timeline-caption"><span>{{ periodLabel() }}</span><span class="legend"><i></i> עבודה כוללת <b></b> סוף שבוע <span class="today-dot"></span> היום</span></div>
    <div #viewport class="timeline-viewport" (scroll)="onScroll()" aria-label="ציר הזמן; תאריכים מתקדמים משמאל לימין" tabindex="0">
      <div class="timeline-canvas" [style.width.px]="width() + 320">
        <div class="timeline-header">
          <div class="date-header" [style.width.px]="width()">
            <div class="month-band">@for (month of months(); track month.start) { <div [style.left.px]="x(month.start)" [style.width.px]="month.width">{{ month.label }}</div> }</div>
            <div class="day-band">@for (tick of ticks(); track tick.date) { <div [style.left.px]="x(tick.date)" [style.width.px]="tick.width" [class.weekend]="!working(tick.date)"><span>{{ tick.label }}</span></div> }</div>
          </div>
          <div class="names-header">צוותים, עבודות ומשימות <small>{{ store.visible().tasks.length }} משימות</small></div>
        </div>
        <div class="rows-area" [style.--day-width]="store.preferences().dayWidth + 'px'">
          <div class="calendar-background" [style.width.px]="width()" [style.background-image]="background()"></div>
          @if (todayX() >= 0 && todayX() <= width()) { <div class="today-line" [style.left.px]="todayX()"><span>היום</span></div> }
          @for (row of rows(); track row.key) {
            <div class="timeline-row" [class.team-row]="row.kind === 'team'" [class.work-row]="row.kind === 'work'" [class.selected]="row.task?.id === selected()">
              <div class="lane" [style.width.px]="width()">
                @if (row.start && row.end && intersects(row.start, row.end)) {
                  <button class="bar" [class.work-bar]="row.kind === 'work'" [class.task-bar]="row.kind === 'task'"
                    [style.left.px]="barLeft(row.start)" [style.width.px]="barWidth(row.start, row.end)"
                    [style.background]="row.task?.color ?? '#a9b4c5'" [attr.data-testid]="row.kind + '-bar-' + (row.task?.id ?? row.work?.id) + '-' + row.team.id"
                    [attr.aria-label]="barLabel(row)" [title]="barLabel(row)" (pointerdown)="begin($event, row, row.kind === 'work' ? 'work' : 'move')"
                    (click)="barClick(row)">
                    @if (row.kind === 'task') { <span class="resize-handle start" aria-hidden="true" (pointerdown)="begin($event, row, 'start')"></span> }
                    @if (barWidth(row.start, row.end) > 150) { <span class="bar-dates">{{ shortDate(row.start) }} – {{ shortDate(row.end) }}</span> }
                    @if (row.kind === 'task') { <span class="resize-handle end" aria-hidden="true" (pointerdown)="begin($event, row, 'end')"></span> }
                  </button>
                }
              </div>
              <div class="row-name" dir="rtl">
                @if (row.kind === 'team') {
                  <button class="hierarchy team-title" (click)="toggle(row.key)" [attr.aria-expanded]="!collapsed(row.key)"><span>{{ collapsed(row.key) ? '‹' : '⌄' }}</span><i class="team-icon">{{ row.team.name.slice(-2, -1) }}</i>{{ row.team.name }}<small>{{ teamCount(row.team.id) }}</small></button>
                } @else if (row.kind === 'work') {
                  <button class="hierarchy work-title" (click)="toggle(row.key)" [attr.aria-expanded]="!collapsed(row.key)"><span>{{ collapsed(row.key) ? '‹' : '⌄' }}</span><span class="name-text">{{ row.work!.title }}</span>@if (row.shared) { <span class="shared" title="עבודה משותפת">משותפת</span> }</button>
                  <button class="row-action" aria-label="עריכת עבודה" (click)="editWork.emit(row.work!.id)">⋯</button>
                } @else {
                  <button class="task-name" (click)="selectTask.emit(row.task!.id)"><i [style.background]="row.task!.color"></i><span class="name-text">{{ row.task!.title }}<small>{{ status[row.task!.status] }}</small></span></button>
                  @if (!intersects(row.start!, row.end!)) { <button class="row-action" aria-label="ניווט למשימה" title="ניווט למשימה" (click)="goTo(row.start!)">↗</button> }
                }
              </div>
            </div>
          }
          <svg class="dependency-lines" [attr.width]="width()" [attr.height]="rows().length * 48" aria-hidden="true">
            <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#64748b"/></marker></defs>
            @for (line of lines(); track line.key) { <path [attr.d]="line.path" marker-end="url(#arrow)"/> }
          </svg>
        </div>
      </div>
    </div>
    <div class="timeline-footer"><span>גררו פס להזזה · קצוות משימה לשינוי משך · Escape לביטול</span><span>{{ rows().length }} שורות מוצגות</span></div>
  `
})
export class TimelineComponent implements AfterViewInit {
  readonly store = inject(RoadmapStore);
  readonly selected = input<string | null>(null);
  readonly selectTask = output<string>(); readonly editWork = output<string>();
  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;
  readonly status = statuses; readonly working = isWorkingDay;
  private drag: Drag | null = null; private suppressClick = false; private scrollTimer?: ReturnType<typeof setTimeout>; private positioning = false;
  readonly span = computed(() => ({ weeks: 42, months: 100, quarters: 366 })[this.store.preferences().mode]);
  private layoutKey = ''; 
  readonly start = computed(() => addDays(this.store.preferences().center, -Math.floor(this.span() / 2)));
  readonly width = computed(() => this.span() * this.store.preferences().dayWidth);
  readonly periodLabel = computed(() => `${formatDate(this.start())} — ${formatDate(addDays(this.start(), this.span() - 1))}`);
  readonly todayX = computed(() => this.x(today()) + this.store.preferences().dayWidth / 2);
  readonly rows = computed<Row[]>(() => {
    const doc = this.store.visible(), result: Row[] = [], collapsed = new Set(this.store.preferences().collapsed);
    const workTasks = new Map<string, Task[]>();
    for (const t of doc.tasks) workTasks.set(t.workItemId, [...(workTasks.get(t.workItemId) ?? []), t]);
    for (const team of [...doc.teams].sort((a, b) => a.order - b.order)) {
      result.push({ key: 'team:' + team.id, kind: 'team', team });
      if (collapsed.has('team:' + team.id)) continue;
      for (const work of [...doc.workItems].sort((a, b) => a.order - b.order)) {
        const all = workTasks.get(work.id) ?? [], tasks = all.filter(t => t.teamId === team.id).sort((a, b) => a.order - b.order);
        if (!tasks.length && (all.length || team.id !== [...doc.teams].sort((a, b) => a.order - b.order)[0].id)) continue;
        const key = 'work:' + work.id + ':' + team.id, range = workRange(doc, work.id);
        result.push({ key, kind: 'work', team, work, start: range?.startDate, end: range?.endDate, shared: new Set(all.map(t => t.teamId)).size > 1 });
        if (!collapsed.has(key)) for (const task of tasks) result.push({ key: task.id, kind: 'task', team, work, task, start: task.startDate, end: task.endDate });
      }
    }
    return result;
  });
  readonly months = computed(() => {
    const result: { start: string; label: string; width: number }[] = [];
    let date = this.start(), end = addDays(date, this.span());
    while (date < end) {
      const next = date.slice(0, 7) + '-01'; const value = new Date(next + 'T00:00:00Z'); const quarter = this.store.preferences().mode === 'quarters'; const number = Math.floor(value.getUTCMonth() / 3) + 1; const label = quarter ? `רבעון ${number} · ${value.getUTCFullYear()}` : monthLabel(date); value.setUTCMonth(quarter ? number * 3 : value.getUTCMonth() + 1);
      const stop = value.toISOString().slice(0, 10) < end ? value.toISOString().slice(0, 10) : end;
      result.push({ start: date, label, width: daysBetween(date, stop) * this.store.preferences().dayWidth }); date = stop;
    }
    return result;
  });
  readonly ticks = computed(() => {
    const mode = this.store.preferences().mode, step = mode === 'quarters' ? 7 : mode === 'months' && this.store.preferences().dayWidth < 20 ? 2 : 1;
    return Array.from({ length: Math.ceil(this.span() / step) }, (_, i) => {
      const date = addDays(this.start(), i * step);
      return { date, label: mode === 'quarters' ? this.shortDate(date) : `${Number(date.slice(8))}${mode === 'weeks' ? ' · ' + ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][new Date(date + 'T00:00:00Z').getUTCDay()] : ''}`, width: Math.min(step, this.span() - i * step) * this.store.preferences().dayWidth };
    });
  });
  readonly background = computed(() => {
    if (this.store.preferences().mode === 'quarters') return 'none';
    const width = this.store.preferences().dayWidth, stops: string[] = [];
    for (let i = 0; i < this.span(); i++) if (!isWorkingDay(addDays(this.start(), i))) stops.push(`transparent ${i * width}px, #f1f4f8 ${i * width}px, #f1f4f8 ${(i + 1) * width}px, transparent ${(i + 1) * width}px`);
    return `linear-gradient(to right, ${stops.join(', ')}), repeating-linear-gradient(to right, transparent 0, transparent ${width - 1}px, #e9edf3 ${width - 1}px, #e9edf3 ${width}px)`;
  });
  readonly lines = computed(() => {
    const selected = this.selected(); if (!selected) return [];
    const rows = this.rows(), doc = this.store.visible();
    return doc.dependencies.filter(d => d.predecessorId === selected || d.successorId === selected).flatMap(d => {
      const a = rows.findIndex(r => r.task?.id === d.predecessorId), b = rows.findIndex(r => r.task?.id === d.successorId);
      if (a < 0 || b < 0 || !this.intersects(rows[a].start!, rows[a].end!) || !this.intersects(rows[b].start!, rows[b].end!)) return [];
      const x1 = this.x(addDays(rows[a].end!, 1)), x2 = this.x(rows[b].start!), y1 = a * 48 + 24, y2 = b * 48 + 24;
      return [{ key: d.id, path: `M ${x1} ${y1} H ${x1 + 12} V ${y2} H ${x2}` }];
    });
  });
  constructor() { effect(() => { const p = this.store.preferences(); const key = p.mode + ':' + p.dayWidth + ':' + p.center; if (key !== this.layoutKey) { this.layoutKey = key; setTimeout(() => this.position(), 0); } }); }
  ngAfterViewInit(): void { this.position(); }
  position(): void {
    if (!this.viewport || this.drag) return; clearTimeout(this.scrollTimer); this.positioning = true;
    const el = this.viewport.nativeElement; el.scrollLeft = this.store.preferences().scrollLeft ?? Math.max(0, this.width() / 2 - (el.clientWidth - 320) / 2);
    setTimeout(() => { this.positioning = false; }, 0);
  }
  onScroll(): void {
    if (this.positioning || this.drag) return; clearTimeout(this.scrollTimer); this.scrollTimer = setTimeout(() => this.store.setPreferences({ scrollLeft: this.viewport.nativeElement.scrollLeft }), 250);
  }
  visibleCenter(): string {
    if (!this.viewport) return this.store.preferences().center;
    const el = this.viewport.nativeElement;
    return addDays(this.start(), Math.round((el.scrollLeft + (el.clientWidth - 320) / 2) / this.store.preferences().dayWidth));
  }
  x(date: string): number { return daysBetween(this.start(), date) * this.store.preferences().dayWidth; }
  barLeft(date: string): number { return Math.max(0, this.x(date)) + 2; }
  barWidth(start: string, end: string): number { return Math.max(8, Math.min(this.width(), this.x(addDays(end, 1))) - Math.max(0, this.x(start)) - 4); }
  intersects(start: string, end: string): boolean { return end >= this.start() && start < addDays(this.start(), this.span()); }
  shortDate(date: string): string { return `${date.slice(8)}.${date.slice(5, 7)}`; }
  barLabel(row: Row): string { return `${row.task?.title ?? row.work?.title}: ${formatDate(row.start!)} – ${formatDate(row.end!)}${row.task ? ' · ' + duration(row.start!, row.end!) + ' ימי עבודה' : ''}`; }
  collapsed(key: string): boolean { return this.store.preferences().collapsed.includes(key); }
  toggle(key: string): void { const keys = this.store.preferences().collapsed; this.store.setPreferences({ collapsed: keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key] }); }
  teamCount(id: string): number { return this.store.visible().tasks.filter(t => t.teamId === id).length; }
  goTo(date: string): void { this.store.setPreferences({ center: date, scrollLeft: undefined }); }
  barClick(row: Row): void { if (this.suppressClick) { this.suppressClick = false; return; } if (row.task) this.selectTask.emit(row.task.id); else this.editWork.emit(row.work!.id); }
  begin(event: PointerEvent, row: Row, kind: Drag['kind']): void {
    if (event.button !== 0 || (!this.store.loaded() || this.store.importing())) return; event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const base = clone(this.store.document());
    this.drag = { pointer: event.pointerId, x: event.clientX, id: kind === 'work' ? row.work!.id : row.task!.id, kind, base, start: row.start!, end: row.end!, next: base, moved: false };
  }
  @HostListener('document:pointermove', ['$event']) move(event: PointerEvent): void {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    const delta = Math.round((event.clientX - drag.x) / this.store.preferences().dayWidth);
    if (Math.abs(event.clientX - drag.x) < 4 && !drag.moved) return; drag.moved = true;
    const date = nextWorkingDay(addDays(drag.kind === 'end' ? drag.end : drag.start, delta));
    try {
      if (drag.kind === 'work') drag.next = shiftWork(drag.base, drag.id, date);
      else if (drag.kind === 'move') drag.next = shiftTask(drag.base, drag.id, date);
      else drag.next = editTask(drag.base, drag.id, drag.kind === 'start' ? { startDate: date > drag.end ? drag.end : date } : { endDate: date < drag.start ? drag.start : date });
      this.store.preview.set(drag.next);
      if (drag.kind === 'work') {
        const count = new Set(drag.next.tasks.filter(t => t.workItemId === drag.id).map(t => t.teamId)).size;
        const range = workRange(drag.next, drag.id)!;
        this.store.notice.set(`הזזת כל משימות העבודה · ${count} צוותים · ${formatDate(range.startDate)}`);
      } else {
        const task = drag.next.tasks.find(t => t.id === drag.id)!;
        const changed = drag.next.tasks.filter(t => t.id !== drag.id && drag.base.tasks.some(o => o.id === t.id && (o.startDate !== t.startDate || o.endDate !== t.endDate))).map(t => t.title);
        this.store.notice.set(`${formatDate(task.startDate)} – ${formatDate(task.endDate)} · ${duration(task.startDate, task.endDate)} ימי עבודה${task.startDate !== date && drag.kind !== 'end' ? ' · הוצמד למועד חוקי' : ''}${changed.length ? ' · עודכנו: ' + changed.join(', ') : ''}`);
      }
    } catch (error) { this.store.notice.set(error instanceof Error ? error.message : 'שינוי אינו תקין'); }
  }
  @HostListener('document:pointerup', ['$event']) finish(event: PointerEvent): void {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return; this.drag = null;
    this.suppressClick = drag.moved;
    if (drag.moved) this.store.commit(drag.next, this.store.notice()); else this.store.preview.set(null);
  }
  @HostListener('document:pointercancel') cancel(): void { if (this.drag) { this.drag = null; this.store.preview.set(null); this.store.notice.set('הגרירה בוטלה'); this.suppressClick = true; } }
  @HostListener('document:keydown.escape') escape(): void { this.cancel(); }
}
