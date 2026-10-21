import { validateDocument } from '../src/app/core/validation';

declare const process: { env: Record<string, string | undefined> };

// Compare-and-set happens inside Redis, so concurrent serverless instances cannot overwrite a newer save.
export const saveScript = `
local current = redis.call('GET', KEYS[1])
local revision = 0
if current then
  revision = cjson.decode(current).revision
  if ARGV[1] ~= tostring(revision) then return -1 end
elseif ARGV[1] ~= 'null' then return -1 end
redis.call('SET', KEYS[1], ARGV[2])
return revision + 1
`;

interface Request { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
}
export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'PUT'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'GET, PUT'); response.status(405).json({ error: 'Method not allowed' }); return;
  }
  const url = process.env['UPSTASH_REDIS_REST_URL'], token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token) { response.status(503).json({ error: 'Shared database is not configured' }); return; }
  const key = process.env['ROADMAP_STORAGE_KEY'] ?? 'roadmap:shared:v1';
  const command = async (args: unknown[]): Promise<unknown> => {
    const result = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(10000)
    });
    if (!result.ok) throw new Error('Database unavailable');
    const data = await result.json() as { result?: unknown; error?: unknown };
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('Database command failed');
    return data.result;
  };
  try {
    if (request.method === 'GET') {
      const saved = await command(['GET', key]);
      response.status(200).json({ document: saved === null ? null : validateDocument(JSON.parse(String(saved))) }); return;
    }
    // JSON-only writes avoid cross-origin form submissions; no cross-origin access is enabled.
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      response.status(415).json({ error: 'Expected application/json' }); return;
    }
    let document, expectedRevision;
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!body || typeof body !== 'object' || new TextEncoder().encode(JSON.stringify(body)).byteLength > 3_500_000) throw new Error('Invalid request');
      expectedRevision = body.expectedRevision;
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)) throw new Error('Invalid revision');
      document = validateDocument(body.document);
    } catch { response.status(400).json({ error: 'Invalid roadmap or revision; existing data was not changed' }); return; }
    document.revision = (expectedRevision ?? 0) + 1;
    const revision = await command(['EVAL', saveScript, 1, key, String(expectedRevision), JSON.stringify(document)]);
    if (revision === -1) { response.status(409).json({ error: 'Roadmap changed; reload before saving' }); return; }
    response.status(200).json({ revision });
  } catch { response.status(503).json({ error: 'Shared storage is unavailable; try again' }); }
}
