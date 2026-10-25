import { inject } from '@angular/core';
import { Session } from './core/session';
import { CanActivateFn, CanDeactivateFn, Router, Routes } from '@angular/router';
import { RoadmapPageComponent } from './ui/roadmap-page.component';
import { PlanningPageComponent } from './ui/planning-page.component';
import { BacklogPageComponent } from './ui/backlog-page.component';
import { VelocityPageComponent } from './ui/velocity-page.component';
const pendingEdits: CanDeactivateFn<{ canDeactivate(): boolean }> = component => component.canDeactivate();
const backlogAccess: CanActivateFn = async () => {
  const session = inject(Session), router = inject(Router);
  try { await session.check(); } catch { return router.parseUrl('/velocity'); }
  return !session.authenticated() || session.canViewBacklog() || router.parseUrl('/velocity');
};
export const routes: Routes = [
  { path: '', redirectTo: 'velocity', pathMatch: 'full' },
  { path: 'roadmap', component: RoadmapPageComponent, title: 'מפת הדרכים של המדור', canDeactivate: [pendingEdits] },
  { path: 'backlog', component: BacklogPageComponent, title: 'בקלוג המדור', canActivate: [backlogAccess], canDeactivate: [pendingEdits] },
  { path: 'planning', component: PlanningPageComponent, title: 'תכנון חודשי', canDeactivate: [pendingEdits] },
  { path: 'velocity', component: VelocityPageComponent, title: 'Velocity — זמינות צוותית' },
  { path: '**', redirectTo: 'velocity' }
];
