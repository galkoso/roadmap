import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { Task, TeamMember } from '../core/model.js';
import { memberLabel } from '../core/members.js';
@Component({
  selector: 'app-assignee-field', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.Default,
  template: `<label class="assignee-field">אחראי<select [attr.aria-label]="'אחראי למשימה ' + task().title" [ngModel]="task().assigneeId ?? null"
    (ngModelChange)="changed.emit($event)" [disabled]="store.importing() || !store.loaded()">
    <option [ngValue]="null">ללא אחראי</option>@for (member of members(); track member.id) { <option [value]="member.id" [disabled]="outsideScope(member)">{{ label(member) }}</option> }
    </select>@if (!members().length) { <small>אין אנשי צוות זמינים לבחירה</small> }</label>`
})
// Editors mutate draft fields in place; this control shares the task's single assignee across all pages.
export class AssigneeFieldComponent {
  readonly store = inject(RoadmapStore); readonly task = input.required<Task>(); readonly changed = output<string | null>();
  readonly scopeTeamId = input<string | null>(null);
  private teamId(): string | null { return this.task().teamId ?? this.scopeTeamId(); }
  members(): TeamMember[] {
    const teamId = this.teamId();
    return this.store.document().members.filter(member => teamId === null || member.teamId === teamId || member.id === this.task().assigneeId)
      .sort((a, b) => a.order - b.order);
  }
  outsideScope(member: TeamMember): boolean { return this.teamId() !== null && member.teamId !== this.teamId(); }
  label(member: TeamMember): string {
    const doc = this.store.document(), name = memberLabel(doc, member);
    return this.task().teamId === null ? `${name} · ${doc.teams.find(team => team.id === member.teamId)?.name ?? ''}` : name;
  }
}
