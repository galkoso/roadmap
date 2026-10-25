import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Session {
  readonly authenticated = signal(false);
  readonly canViewBacklog = signal(false);
  private pending?: Promise<void>;
  apply(value: { authenticated?: boolean; canViewBacklog?: boolean }): void {
    this.authenticated.set(value.authenticated === true);
    this.canViewBacklog.set(value.authenticated === true && value.canViewBacklog === true);
  }
  check(): Promise<void> {
    return this.pending ??= (async () => {
      const response = await fetch('/api/login', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Session check failed');
      this.apply(await response.json());
    })().catch(error => { this.pending = undefined; throw error; });
  }
}
