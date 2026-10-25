import { loginHandler } from './auth.mjs';

export async function handleAuth(request, response) {
  if (new URL(request.url, 'http://127.0.0.1').pathname !== '/api/login') return false;
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) { response.writeHead(413).end(); return true; }
  }
  const adapter = {
    setHeader: (name, value) => response.setHeader(name, value),
    status(code) { response.statusCode = code; return this; },
    json(value) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); }
  };
  await loginHandler({ method: request.method, headers: request.headers, body }, adapter);
  return true;
}
