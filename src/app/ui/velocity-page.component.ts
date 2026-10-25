import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { isAvailable, monthDates, personCapacity, teamCapacity } from '../core/availability';
import { epoch, formatDate, isWorkingDay, monthLabel } from '../core/dates';
import { membersForTeam } from '../core/members';
import { TeamMember } from '../core/model';
import { currentPlanningPeriod, emptyPlanningPreferences, validPlanningPeriod } from '../core/planning';
import { changeAttendance } from '../core/scheduler';
import { RoadmapStore } from '../core/store';

@Component({
  selector: 'app-velocity', standalone: true, imports: [FormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './velocity-page.component.html'
})
export class VelocityPageComponent {
  readonly store = inject(RoadmapStore);
  readonly preferences = computed(() => this.store.preferences().planning ?? emptyPlanningPreferences());
  readonly period = computed(() => this.preferences().activePeriod ?? currentPlanningPeriod());
  readonly teams = computed(() => [...this.store.document().teams].sort((a, b) => a.order - b.order));
  readonly team = computed(() => this.teams().find(team => team.id === this.preferences().activeTeamId) ?? this.teams()[0]);
  readonly members = computed(() => membersForTeam(this.store.document(), this.team().id));
  readonly member = computed<TeamMember | undefined>(() => this.members().find(member => member.id === this.store.preferences().velocityMemberId) ?? this.members()[0]);
  readonly summary = computed(() => this.member() ? personCapacity(this.store.document(), this.member()!.id, this.period()) : null);
  readonly total = computed(() => teamCapacity(this.store.document(), this.team().id, this.period()));
  readonly dates = computed(() => monthDates(this.period()));
  readonly padding = computed(() => Array.from({ length: new Date(epoch(this.dates()[0]) * 86400000).getUTCDay() }, (_, i) => i));
  readonly weekdays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  readonly months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  readonly error = signal(''); readonly working = isWorkingDay; readonly monthTitle = monthLabel;
  readonly paintedDates = signal<Set<string>>(new Set());
  private stroke: { pointer: number; memberId: string; period: string; present: boolean } | null = null;
  count(id: string): number { return personCapacity(this.store.document(), id, this.period()).available; }
  present(date: string): boolean {
    return this.stroke && this.paintedDates().has(date) ? this.stroke.present : isAvailable(this.store.document(), this.member()?.id, date);
  }
  startPaint(event: PointerEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
    if (this.stroke || !event.isPrimary || event.button !== 0 || !button || button.disabled || !this.member() || !this.store.loaded()) return;
    const date = button.dataset['date']!;
    this.stroke = { pointer: event.pointerId, memberId: this.member()!.id, period: this.period(), present: !this.present(date) };
    this.paintedDates.set(new Set([date]));
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  movePaint(event: PointerEvent): void {
    if (!this.stroke || event.pointerId !== this.stroke.pointer) return;
    const grid = event.currentTarget as HTMLElement;
    const button = grid.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button[data-date]');
    if (!button || !grid.contains(button) || button.disabled) return;
    const date = button.dataset['date']!;
    if (!this.paintedDates().has(date)) this.paintedDates.update(dates => new Set([...dates, date]));
  }
  finishPaint(event: PointerEvent): void {
    if (!this.stroke || event.pointerId !== this.stroke.pointer) return;
    this.movePaint(event);
    const stroke = this.stroke, dates = [...this.paintedDates()];
    this.cancelPaint();
    if (stroke.memberId !== this.member()?.id || stroke.period !== this.period() || this.store.importing()) return;
    this.saveAttendance(dates, stroke.present);
  }
  @HostListener('window:blur') cancelPaint(): void { this.stroke = null; this.paintedDates.set(new Set()); }
  cancelPointer(event: PointerEvent): void { if (event.pointerId === this.stroke?.pointer) this.cancelPaint(); }

  label(date: string): string { return `${this.member()?.name}, ${formatDate(date)}, ${!this.working(date) ? 'סוף שבוע' : this.present(date) ? 'נמצא, לחיצה לסימון היעדרות' : 'לא נמצא, לחיצה לסימון נוכחות'}`; }
  selectTeam(activeTeamId: string): void {
    this.store.setPreferences({ planning: { ...this.preferences(), activeTeamId }, velocityMemberId: null });
  }
  selectPeriod(month: string, year: string): void {
    const activePeriod = `${year}-${month}`;
    if (!validPlanningPeriod(activePeriod)) { this.error.set('יש לבחור חודש ושנה שלמה בין 1900 ל־9999'); return; }
    this.error.set(''); this.store.setPreferences({ planning: { ...this.preferences(), activePeriod } });
  }
  selectMember(velocityMemberId: string): void { this.store.setPreferences({ velocityMemberId }); }
  toggle(date: string): void {
    if (!this.member() || !this.store.loaded() || this.store.importing()) return;
    this.saveAttendance([date], !this.present(date));
  }
  private saveAttendance(dates: string[], present: boolean): void {
    const memberId = this.member()!.id;
    try {
      let document = this.store.document(), unresolved = false;
      const changed = new Set<string>();
      for (const date of dates) {
        if (isAvailable(document, memberId, date) === present) continue;
        const result = changeAttendance(document, { memberId, date, status: present ? 'present' : 'absent' });
        document = result.document; unresolved ||= result.unresolved;
        result.changed.forEach(name => changed.add(name));
      }
      if (document !== this.store.document()) this.store.commit(document, unresolved ? 'הנוכחות עודכנה; שיבוצים מושפעים סומנו כלא מעודכנים' :
        `הנוכחות עודכנה${changed.size ? ' · עודכנו: ' + [...changed].join(', ') : ''}`);
      this.error.set('');
    } catch (error) { this.error.set((error as Error).message); }
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest('input, textarea, select') || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.store.redo() : this.store.undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); this.store.redo(); }
  }
}
