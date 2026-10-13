import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { Task } from '../core/model';
import { memberLabel, membersForTeam } from '../core/members';
@Component({
  selector: 'app-assignee-field', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<label class="assignee-field">אחראי<select [attr.aria-label]="'אחראי למשימה ' + task().title" [ngModel]="task().assigneeId ?? null"
    (ngModelChange)="changed.emit($event)" [disabled]="!task().teamId || store.importing()">
    <option [ngValue]="null">ללא אחראי</option>@for (member of members(); track member.id) { <option [value]="member.id">{{ label(member) }}</option> }
    </select>@if (!task().teamId) { <small>בחרו צוות כדי לשייך אחראי</small> }</label>`
})
export class AssigneeFieldComponent {
  readonly store = inject(RoadmapStore); readonly task = input.required<Task>(); readonly changed = output<string | null>();
  members() { return membersForTeam(this.store.document(), this.task().teamId); }
  label(member: ReturnType<typeof membersForTeam>[number]): string { return memberLabel(this.store.document(), member); }
}
