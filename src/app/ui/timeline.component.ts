import { AfterViewInit, ChangeDetectorRef, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, OnDestroy, output, signal, ViewChild } from '@angular/core';
import { AssigneeFieldComponent } from './assignee-field.component';
import { groupByPeople, personKey } from '../core/members';
import { RoadmapStore } from '../core/store';
import { clone, isScheduled, RoadmapDocument, ScheduledTask, Team, WorkItem } from '../core/model';
import { addDays, daysBetween, duration, formatDate, isWorkingDay, monthLabel, nextWorkingDay, today } from '../core/dates';
import { editTask, shiftTask, shiftWork, workRange } from '../core/scheduler';
import { statuses } from '../core/model';
interface Row { key: string; kind: 'team' | 'work' | 'person' | 'task'; personName?: string; initial?: string; count?: number; team: Team & { unassigned?: boolean }; independent?: boolean; work?: WorkItem; task?: ScheduledTask; start?: string; end?: string; shared?: boolean }
interface Drag { pointer: number; x: number; id: string; kind: 'work' | 'move' | 'start' | 'end'; base: RoadmapDocument; start: string; end: string; next: RoadmapDocument; moved: boolean }
@Component({
  selector: 'app-timeline', standalone: true, imports: [AssigneeFieldComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="timeline-caption"><span>{{ periodLabel() }}</span><span class="legend"><i></i> עבודה כוללת <b></b> סוף שבוע <span class="today-dot"></span> היום</span></div>
    <div #viewport class="timeline-viewport" (scroll)="onScroll()" aria-label="ציר הזמן; תאריכים מתקדמים משמאל לימין" tabindex="0">
      <div class="timeline-canvas" [style.width.px]="width() + namesWidth()">
        <div class="timeline-header">
          <div class="date-header" [style.width.px]="width()" [attr.data-range-start]="start()">
            <div class="month-band">@for (month of months(); track month.start) { <div [style.left.px]="x(month.start)" [style.width.px]="month.width">{{ month.label }}</div> }</div>
            <div class="day-band">@for (tick of ticks(); track tick.date) { <div [style.left.px]="x(tick.date)" [style.width.px]="tick.width" [class.weekend]="!working(tick.date)"><span>{{ tick.label }}</span></div> }</div>
          </div>
          <div class="names-header" [style.width.px]="namesWidth()">צוותים, עבודות ומשימות <small>{{ scheduledTasks().length }} משימות</small></div>
        </div>
        <div class="rows-area" [style.--day-width]="store.preferences().dayWidth + 'px'">
          <div class="calendar-background" [style.width.px]="width()" [style.background-image]="background()"></div>
          @if (todayX() >= 0 && todayX() <= width()) { <div class="today-line" [style.left.px]="todayX()"><span>היום</span></div> }
          @for (row of rows(); track row.key) {
            <div class="timeline-row" [class.team-row]="row.kind === 'team'" [class.work-row]="row.kind === 'work'" [class.person-row]="row.kind === 'person'" [class.unassigned-person]="row.kind === 'person' && !row.initial" [class.assignment-highlight]="row.task?.id === highlighted()" [class.selected]="row.task?.id === selected()">
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
              <div class="row-name" dir="rtl" [style.width.px]="namesWidth()">
                @if (row.kind === 'team') {
                  <button class="hierarchy team-title" (click)="toggle(row.key)" [attr.aria-expanded]="!collapsed(row.key)"><span>{{ collapsed(row.key) ? '‹' : '⌄' }}</span><i class="team-icon">{{ row.team.name.slice(-2, -1) }}</i>{{ row.team.name }}<small>{{ teamCount(row.team.id) }}</small></button>@if (!row.team.unassigned) { <button class="row-action team-name-edit" [attr.aria-label]="'שינוי שם הצוות ' + row.team.name" title="שינוי שם הצוות" (click)="editTeam.emit(row.team.id)">✎</button> }
                } @else if (row.kind === 'person') {
                  <button class="hierarchy person-title" (click)="toggle(row.key)" [attr.aria-expanded]="!collapsed(row.key)"><span>{{ collapsed(row.key) ? '‹' : '⌄' }}</span><span class="initial-avatar" aria-hidden="true">{{ row.initial ?? '–' }}</span><span class="name-text">{{ row.personName }}</span><small>{{ row.count }} משימות{{ row.count === 0 ? ' · אין משימות בציר' : '' }}</small></button>
                } @else if (row.kind === 'work') {
                  <button class="hierarchy work-title" (click)="toggle(row.key)" [attr.aria-expanded]="!collapsed(row.key)"><span>{{ collapsed(row.key) ? '‹' : '⌄' }}</span><span class="name-text">{{ row.work!.title }}</span>@if (row.shared) { <span class="shared" title="עבודה משותפת">משותפת</span> }</button>
                  @if (!row.independent) { <div class="row-actions"><button class="row-action" aria-label="עריכת עבודה" (click)="editWork.emit(row.work!.id)">⋯</button><button class="row-action delete-action" [attr.aria-label]="'מחיקת עבודה ' + row.work!.title" title="מחיקת עבודה" (click)="deleteWork.emit(row.work!.id)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button></div> }
                } @else {
                  <button class="task-name" (click)="selectTask.emit(row.task!.id)"><i [style.background]="row.task!.color"></i><span class="name-text">{{ row.task!.title }}<small>{{ status[row.task!.status] }}@if (store.preferences().grouping === 'people') { · {{ row.work?.title ?? 'משימה עצמאית' }} }</small></span></button>
                  <app-assignee-field [task]="row.task!" (changed)="store.assign(row.task!.id, $event)"/><div class="row-actions"><button class="row-action" [attr.aria-label]="'פעולות משימה ' + row.task!.title" [attr.popovertarget]="'task-menu-' + row.task!.id" (click)="positionTaskMenu($event)">⋯</button>
                    <div popover class="task-action-menu" [id]="'task-menu-' + row.task!.id" [style.top.px]="taskMenuPosition().top" [style.left.px]="taskMenuPosition().left">
                      <button (click)="taskMenuAction($event, row.task!.id, false)">עריכת משימה</button>
                      <button (click)="taskMenuAction($event, row.task!.id, true)">העברה לבקלוג</button>
                    </div>@if (!intersects(row.start!, row.end!)) { <button class="row-action" aria-label="ניווט למשימה" title="ניווט למשימה" (click)="goTo(row.start!)">↗</button> }<button class="row-action delete-action" [attr.aria-label]="'מחיקת משימה ' + row.task!.title" title="מחיקת משימה" (click)="deleteTask.emit(row.task!.id)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button></div>
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
    <div class="timeline-footer"><span>גללו ימינה ושמאלה להמשך התכנון · גררו פס להזזה · Escape לביטול</span><span>{{ rows().length }} שורות מוצגות</span></div>
  `
})
export class TimelineComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(RoadmapStore);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly selected = input<string | null>(null);
  readonly moveToBacklog = output<string>(); readonly deleteTask = output<string>(); readonly deleteWork = output<string>();
  readonly selectTask = output<string>(); readonly editWork = output<string>(); readonly editTeam = output<string>();
  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;
  readonly taskMenuPosition = signal({ top: 0, left: 0 });
  positionTaskMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.taskMenuPosition.set({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 100)), left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) });
  }
  taskMenuAction(event: MouseEvent, id: string, backlog: boolean): void {
    (event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover();
    if (backlog) this.moveToBacklog.emit(id); else this.selectTask.emit(id);
  }
  readonly status = statuses; readonly working = isWorkingDay;
  private drag: Drag | null = null; private suppressClick = false; private scrollTimer?: ReturnType<typeof setTimeout>; private positioning = false;
  private readonly windowCenter = signal(today());
  private readonly viewportWidth = signal(0);
  readonly namesWidth = computed(() => this.viewportWidth() > 0 && this.viewportWidth() < 600 ? 300 : 420);
  private resizeObserver?: ResizeObserver;
  private destroyed = false;
  readonly span = computed(() => Math.max(({ weeks: 42, months: 100, quarters: 366 })[this.store.preferences().mode],
    Math.ceil(Math.max(0, this.viewportWidth() - this.namesWidth()) / this.store.preferences().dayWidth) * 2 + 14));
  private layoutKey = ''; 
  readonly start = computed(() => addDays(this.windowCenter(), -Math.floor(this.span() / 2)));
  readonly width = computed(() => this.span() * this.store.preferences().dayWidth);
  readonly periodLabel = computed(() => `${formatDate(this.start())} — ${formatDate(addDays(this.start(), this.span() - 1))}`);
  readonly todayX = computed(() => this.x(today()) + this.store.preferences().dayWidth / 2);
  readonly highlighted = signal<string | null>(null);
  private highlightTimer?: ReturnType<typeof setTimeout>;
  readonly scheduledTasks = computed(() => this.store.visible().tasks.filter(isScheduled));
  readonly rows = computed<Row[]>(() => {
    const doc = this.store.visible(), scheduled = this.scheduledTasks(), result: Row[] = [], collapsed = new Set(this.collapsedKeys());
    if (this.store.preferences().grouping === 'people') {
      for (const group of groupByPeople(doc, scheduled)) {
        const team: Team & { unassigned?: boolean } = { id: group.teamId ?? '__unassigned__', name: group.name, order: 0, unassigned: group.teamId === null };
        result.push({ key: group.key, kind: 'team', team });
        if (collapsed.has(group.key)) continue;
        const addTasks = (tasks: ScheduledTask[]) => {
          for (const task of tasks) result.push({ key: task.id, kind: 'task', team, task, work: doc.workItems.find(w => w.id === task.workItemId), start: task.startDate, end: task.endDate });
        };
        if (group.teamId === null) addTasks(group.tasks);
        else for (const person of group.groups) {
          result.push({ key: person.key, kind: 'person', team, personName: person.name, initial: person.member?.name.slice(0, 1), count: person.tasks.length });
          if (!collapsed.has(person.key)) addTasks(person.tasks);
        }
      }
      return result;
    }
    const populatedWorks = new Set(doc.tasks.map(t => t.workItemId));
    const workTasks = new Map<string, ScheduledTask[]>();
    for (const t of scheduled) if (t.workItemId) workTasks.set(t.workItemId, [...(workTasks.get(t.workItemId) ?? []), t]);
    const teams: (Team & { unassigned?: boolean })[] = [...doc.teams].sort((a, b) => a.order - b.order);
    if (scheduled.some(t => t.teamId === null)) teams.push({ id: '__unassigned__', name: 'ללא צוות', order: teams.length, unassigned: true });
    for (const team of teams) {
      const groupKey = team.unassigned ? 'team:unassigned' : 'team:' + team.id;
      const owns = (t: ScheduledTask): boolean => t.teamId === (team.unassigned ? null : team.id);
      result.push({ key: groupKey, kind: 'team', team });
      if (collapsed.has(groupKey)) continue;
      for (const work of [...doc.workItems].sort((a, b) => a.order - b.order)) {
        const all = workTasks.get(work.id) ?? [], tasks = all.filter(owns).sort((a, b) => a.order - b.order);
        if (!tasks.length && (populatedWorks.has(work.id) || team.unassigned || team.id !== teams[0].id)) continue;
        const key = 'work:' + work.id + ':' + team.id, range = workRange(doc, work.id);
        result.push({ key, kind: 'work', team, work, start: range?.startDate, end: range?.endDate, shared: new Set(all.map(t => t.teamId)).size > 1 });
        if (!collapsed.has(key)) for (const task of tasks) result.push({ key: task.id, kind: 'task', team, work, task, start: task.startDate, end: task.endDate });
      }
      const independent = scheduled.filter(t => owns(t) && t.workItemId === null).sort((a, b) => a.order - b.order);
      if (independent.length) {
        const key = 'independent:' + team.id;
        result.push({ key, kind: 'work', team, independent: true, work: { id: '__independent__', title: 'משימות עצמאיות', order: 0 } });
        if (!collapsed.has(key)) for (const task of independent) result.push({ key: task.id, kind: 'task', team, independent: true, task, start: task.startDate, end: task.endDate });
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
    for (let i = 0; i < this.span(); i++) if (!isWorkingDay(addDays(this.start(), i))) stops.push(`transparent ${i * width}px, var(--weekend) ${i * width}px, var(--weekend) ${(i + 1) * width}px, transparent ${(i + 1) * width}px`);
    return `linear-gradient(to right, ${stops.join(', ')}), repeating-linear-gradient(to right, transparent 0, transparent ${width - 1}px, var(--grid) ${width - 1}px, var(--grid) ${width}px)`;
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
  private preferenceKey(center = this.store.preferences().center): string {
    const p = this.store.preferences(); return `${p.mode}:${p.dayWidth}:${center}`;
  }
  constructor() {
    effect(() => {
      const id = this.store.assignmentFocus();
      if (!id || !this.scheduledTasks().some(t => t.id === id)) return;
      this.store.assignmentFocus.set(null); this.highlighted.set(id); clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => this.highlighted.set(null), 2200);
      this.revealGrouping(id);
    });
    effect(() => {
      const key = this.preferenceKey();
      if (key !== this.layoutKey) {
        this.layoutKey = key; this.windowCenter.set(this.store.preferences().timelineAnchor ?? this.store.preferences().center);
        setTimeout(() => this.position(), 0);
      }
    });
  }
  ngAfterViewInit(): void {
    this.viewportWidth.set(this.viewport.nativeElement.clientWidth);
    this.changeDetector.detectChanges(); this.position();
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.viewport.nativeElement.clientWidth; if (width === this.viewportWidth()) return;
      const center = this.visibleCenter(); this.windowCenter.set(center); this.viewportWidth.set(width);
      this.changeDetector.detectChanges(); this.position(center);
    });
    this.resizeObserver.observe(this.viewport.nativeElement);
  }
  ngOnDestroy(): void { this.destroyed = true; clearTimeout(this.scrollTimer); clearTimeout(this.highlightTimer); this.resizeObserver?.disconnect(); }
  recenter(): void {
    clearTimeout(this.scrollTimer); this.windowCenter.set(this.store.preferences().center);
    setTimeout(() => this.position(), 0);
  }
  position(center = this.store.preferences().center): void {
    if (!this.viewport || this.drag || this.destroyed) return; clearTimeout(this.scrollTimer); this.positioning = true;
    const el = this.viewport.nativeElement;
    el.scrollLeft = this.store.preferences().scrollLeft ?? Math.max(0, this.x(center) + this.store.preferences().dayWidth / 2 - (el.clientWidth - this.namesWidth()) / 2);
    el.scrollTop = this.store.preferences().scrollTop ?? 0;
    setTimeout(() => { this.positioning = false; }, 0);
  }
  captureView(): void {
    clearTimeout(this.scrollTimer);
    const el = this.viewport.nativeElement, center = this.visibleCenter(); this.layoutKey = this.preferenceKey(center);
    this.store.setPreferences({ center, timelineAnchor: this.windowCenter(), scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
  }
  onScroll(): void {
    if (this.positioning || this.drag || this.destroyed) return;
    const el = this.viewport.nativeElement, left = el.scrollLeft;
    const chartWidth = Math.max(0, el.clientWidth - this.namesWidth()), max = this.width() - chartWidth;
    const threshold = Math.min(chartWidth / 4, this.store.preferences().dayWidth * 7);
    const direction = left >= max - threshold ? 1 : left <= threshold ? -1 : 0;
    if (direction && max > 0) {
      // Keep a bounded date window and compensate its origin shift before painting.
      // The same date stays under the pointer; task dates and row identities never change.
      const shift = direction * Math.floor(this.span() / 3);
      this.positioning = true; this.windowCenter.update(center => addDays(center, shift));
      this.changeDetector.detectChanges(); el.scrollLeft = left - shift * this.store.preferences().dayWidth;
      setTimeout(() => { this.positioning = false; }, 0);
    }
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const center = this.visibleCenter(); this.layoutKey = this.preferenceKey(center);
      const preferences = this.store.preferences();
      if (center === preferences.center && preferences.scrollLeft === undefined) return;
      this.store.setPreferences({ center, timelineAnchor: this.windowCenter(), scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
    }, 250);
  }
  visibleCenter(): string {
    if (!this.viewport) return this.store.preferences().center;
    const el = this.viewport.nativeElement;
    return addDays(this.start(), Math.floor((el.scrollLeft + (el.clientWidth - this.namesWidth()) / 2) / this.store.preferences().dayWidth));
  }
  revealTask(id: string): void {
    const task = this.store.document().tasks.find(t => t.id === id); if (!task || !isScheduled(task)) return;
    const team = task.teamId ?? '__unassigned__';
    this.revealGrouping(id);
    this.goTo(task.startDate);
    setTimeout(() => {
      if (this.destroyed) return;
      const index = this.rows().findIndex(row => row.task?.id === id);
      this.viewport.nativeElement.scrollTop = Math.max(0, index * 48 - 60);
      this.viewport.nativeElement.querySelector<HTMLElement>(`[data-testid="task-bar-${CSS.escape(id)}-${CSS.escape(team)}"]`)?.focus({ preventScroll: true });
    }, 30);
  }
  revealGrouping(id: string): void {
    const task = this.store.document().tasks.find(t => t.id === id); if (!task || !isScheduled(task)) return;
    const team = task.teamId ?? '__unassigned__', teamKey = task.teamId ? 'team:' + task.teamId : 'team:unassigned';
    const groupKey = this.store.preferences().grouping === 'people' ? personKey(team, task.assigneeId ?? null) : task.workItemId ? 'work:' + task.workItemId + ':' + team : 'independent:' + team;
    const keys = this.collapsedKeys().filter(k => k !== teamKey && k !== groupKey);
    this.store.setPreferences(this.store.preferences().grouping === 'people' ? { peopleCollapsed: keys } : { collapsed: keys });
    setTimeout(() => {
      if (!this.viewport || this.destroyed) return;
      const index = this.rows().findIndex(row => row.task?.id === id), el = this.viewport.nativeElement;
      const top = index * 48;
      if (top < el.scrollTop + 70 || top > el.scrollTop + el.clientHeight - 48) el.scrollTop = Math.max(0, top - 70);
    }, 0);
  }
  x(date: string): number { return daysBetween(this.start(), date) * this.store.preferences().dayWidth; }
  barLeft(date: string): number { return Math.max(0, this.x(date)) + 2; }
  barWidth(start: string, end: string): number { return Math.max(8, Math.min(this.width(), this.x(addDays(end, 1))) - Math.max(0, this.x(start)) - 4); }
  intersects(start: string, end: string): boolean { return end >= this.start() && start < addDays(this.start(), this.span()); }
  shortDate(date: string): string { return `${date.slice(8)}.${date.slice(5, 7)}`; }
  barLabel(row: Row): string { return `${row.task?.title ?? row.work?.title}: ${formatDate(row.start!)} – ${formatDate(row.end!)}${row.task ? ' · ' + duration(row.start!, row.end!) + ' ימי עבודה' : ''}`; }
  collapsedKeys(): string[] { const p = this.store.preferences(); return p.grouping === 'people' ? p.peopleCollapsed ?? [] : p.collapsed; }
  collapsed(key: string): boolean { return this.collapsedKeys().includes(key); }
  toggle(key: string): void {
    const keys = this.collapsedKeys(), collapsed = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
    this.store.setPreferences(this.store.preferences().grouping === 'people' ? { peopleCollapsed: collapsed } : { collapsed });
  }
  teamCount(id: string): number { return this.scheduledTasks().filter(t => t.teamId === (id === '__unassigned__' ? null : id)).length; }
  goTo(date: string): void { this.store.setPreferences({ center: date, scrollLeft: undefined, timelineAnchor: undefined, scrollTop: 0 }); this.recenter(); }
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
        const count = new Set(drag.next.tasks.filter(isScheduled).filter(t => t.workItemId === drag.id).map(t => t.teamId)).size;
        const range = workRange(drag.next, drag.id)!;
        this.store.notice.set(`הזזת כל משימות העבודה · ${count} צוותים · ${formatDate(range.startDate)}`);
      } else {
        const task = drag.next.tasks.find(t => t.id === drag.id)! as ScheduledTask;
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
