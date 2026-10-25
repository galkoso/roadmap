import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticated, loginHandler, session } from '../server/auth.mjs';
import roadmap from '../api/roadmap';

function response() {
  return { code: 200, body: {} as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; } };
}
const headers = { 'content-type': 'application/json' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('password login', () => {
  it('rejects incorrect passwords and protects both data reads and writes before database access', async () => {
    const invalid = response();
    await loginHandler({ method: 'POST', headers, body: { password: 'incorrect' } }, invalid);
    expect(invalid.code).toBe(401); expect(invalid.headers['Set-Cookie']).toBeUndefined();
    for (const method of ['GET', 'PUT']) {
      const result = response(); await roadmap({ method, headers }, result); expect(result.code).toBe(401);
    }
  });
  it('creates a signed HttpOnly session, rejects tampering, expires, and clears on logout', async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('ROADMAP_SESSION_SECRET', 'test-session-key');
    const result = response(); await loginHandler({ method: 'POST', headers, body: { password: 'galko' } }, result);
    expect(result.code).toBe(200);
    const cookie = result.headers['Set-Cookie'];
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Secure');
    expect(authenticated({ cookie })).toBe(true);
    expect(authenticated({ cookie: cookie.replace('roadmap_session=', 'roadmap_session=9') })).toBe(false);
    const status = response(); await loginHandler({ method: 'GET', headers: { cookie } }, status);
    expect(status.body).toEqual({ authenticated: true, canViewBacklog: true });
    const logout = response(); await loginHandler({ method: 'DELETE', headers }, logout);
    expect(logout.headers['Set-Cookie']).toContain('Max-Age=0');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(authenticated({ cookie })).toBe(false);
  });
  it('keeps the member permission signed and rejects the previous password and old sessions', async () => {
    const result = response();
    await loginHandler({ method: 'POST', headers, body: { password: 'mador123hozi' } }, result);
    expect(result.body).toEqual({ authenticated: true, canViewBacklog: false });
    const cookie = result.headers['Set-Cookie'];
    expect(session({ cookie })).toEqual({ authenticated: true, canViewBacklog: false });
    expect(authenticated({ cookie: cookie.replace('.member.', '.owner.') })).toBe(false);
    expect(authenticated({ cookie: cookie.replace('.member', '') })).toBe(false);
    const previous = response();
    await loginHandler({ method: 'POST', headers, body: { password: 'ztube123ztube123' } }, previous);
    expect(previous.code).toBe(401);
  });
  it('requires JSON for login and logout', async () => {
    for (const method of ['POST', 'DELETE']) {
      const result = response(); await loginHandler({ method, headers: {}, body: { password: 'galko' } }, result);
      expect(result.code).toBe(415);
    }
  });
});
