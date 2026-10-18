import { CanDeactivateFn, Routes } from '@angular/router';
import { RoadmapPageComponent } from './ui/roadmap-page.component';
import { PlanningPageComponent } from './ui/planning-page.component';
import { BacklogPageComponent } from './ui/backlog-page.component';
const pendingEdits: CanDeactivateFn<{ canDeactivate(): boolean }> = component => component.canDeactivate();
export const routes: Routes = [
  { path: '', redirectTo: 'roadmap', pathMatch: 'full' },
  { path: 'roadmap', component: RoadmapPageComponent, title: 'מפת הדרכים של המדור', canDeactivate: [pendingEdits] },
  { path: 'backlog', component: BacklogPageComponent, title: 'בקלוג המדור', canDeactivate: [pendingEdits] },
  { path: 'planning', component: PlanningPageComponent, title: 'תכנון חודשי', canDeactivate: [pendingEdits] },
  { path: '**', redirectTo: 'roadmap' }
];
