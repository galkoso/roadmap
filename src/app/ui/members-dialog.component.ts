import { ChangeDetectionStrategy, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { clone, TeamMember, uid } from '../core/model';
import { assignedCount, memberLabel, membersForTeam, removeMember, updateMember } from '../core/members';
@Component({
  selector: 'app-members-dialog', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button (click)="open()" [disabled]="!store.loaded() || store.importing()">אנשי הצוותים</button>
  <dialog #dialog class="create-work-dialog members-dialog" aria-labelledby="members-heading" dir="rtl">
    <div class="panel-heading"><h2 id="members-heading">אנשי הצוותים</h2><button class="icon-button" aria-label="סגירת אנשי הצוותים" (click)="dialog.close()">×</button></div>
    <p class="field-hint">רשומות לתכנון בלבד · כל אדם שייך לצוות אחד</p>
    @for (team of teams(); track team.id) { <section class="member-team"><h3>{{ team.name }}</h3>
      @for (member of members(team.id); track member.id) { <form class="member-edit" (ngSubmit)="save(member)">
        <span class="initial-avatar" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
        <label>שם<input [name]="'name-' + member.id" [(ngModel)]="drafts[member.id].name" [attr.aria-label]="'שם ' + label(member)" required></label>
        <label>צוות<select aria-label="צוות" [name]="'team-' + member.id" [(ngModel)]="drafts[member.id].teamId">@for (target of teams(); track target.id) { <option [value]="target.id">{{ target.name }}</option> }</select></label>
        <small class="member-identity">{{ label(member) }} · {{ count(member.id) }} משימות</small>
        <button type="submit">שמירת איש צוות</button><button type="button" class="danger" (click)="remove(member)">הסרת איש צוות</button>
      </form> } @empty { <p class="field-hint">אין אנשי צוות</p> }</section> }
    <form class="add-team-form" (ngSubmit)="add()"><label>שם אדם חדש<input name="new-member" [(ngModel)]="name" required></label><label>צוות<select aria-label="צוות" name="new-member-team" [(ngModel)]="teamId" required>@for (team of teams(); track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label><button class="primary">הוספת איש צוות</button></form>
    @if (error) { <p class="field-error" role="alert">{{ error }}</p> }<p role="status">{{ store.saveStatus() }}</p>
  </dialog>`
})
export class MembersDialogComponent {
  readonly store = inject(RoadmapStore); @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  drafts: Record<string, { name: string; teamId: string }> = {}; name = ''; teamId = ''; error = '';
  teams() { return [...this.store.document().teams].sort((a, b) => a.order - b.order); }
  members(id: string) { return membersForTeam(this.store.document(), id); }
  label(member: TeamMember) { return memberLabel(this.store.document(), member); }
  count(id: string) { return assignedCount(this.store.document(), id); }
  open(): void { this.refresh(); this.name = ''; this.teamId = this.teams()[0].id; this.dialog.nativeElement.showModal(); }
  private refresh(): void { this.drafts = Object.fromEntries(this.store.document().members.map(m => [m.id, { name: m.name, teamId: m.teamId }])); this.error = ''; }
  add(): void {
    try {
      if (!this.name.trim()) throw new Error('יש להזין שם');
      const doc = clone(this.store.document()); doc.members.push({ id: uid(), name: this.name.trim(), teamId: this.teamId, order: Math.max(-1, ...doc.members.map(m => m.order)) + 1 });
      this.store.commit(doc, 'איש הצוות נוסף'); this.name = ''; this.refresh();
    } catch (error) { this.error = (error as Error).message; }
  }
  save(member: TeamMember): void {
    try {
      const draft = this.drafts[member.id], next = updateMember(this.store.document(), member.id, draft.name, draft.teamId);
      if (draft.teamId !== member.teamId && !confirm(`להעביר את ״${member.name}״ לצוות אחר? ${this.count(member.id)} משימות בציר הזמן ובבקלוג יישארו בצוותיהן ויהפכו ללא אחראי. אפשר לבטל באמצעות Undo.`)) { this.refresh(); return; }
      this.store.commit(next, 'איש הצוות עודכן'); this.refresh();
    } catch (error) { this.error = (error as Error).message; }
  }
  remove(member: TeamMember): void {
    if (!confirm(`להסיר את ״${member.name}״? ${this.count(member.id)} משימות בציר הזמן ובבקלוג יהפכו ללא אחראי. המשימות, הצוותים ושאר הנתונים יישמרו. אפשר לבטל באמצעות Undo.`)) return;
    try { this.store.commit(removeMember(this.store.document(), member.id), 'איש הצוות הוסר והמשימות הפכו ללא אחראי'); this.refresh(); }
    catch (error) { this.error = (error as Error).message; }
  }
}
