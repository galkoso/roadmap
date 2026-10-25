import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAuth } from '../server/http-auth.mjs';

const authServer = createServer(async (request, response) => {
  if (!await handleAuth(request, response)) response.writeHead(404).end();
});
await new Promise(resolve => authServer.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'roadmap-dev-'));
const proxy = join(directory, 'proxy.json');
await writeFile(proxy, JSON.stringify({ '/api/login': { target: `http://127.0.0.1:${authServer.address().port}`, secure: false } }));
const child = spawn('ng', ['serve', '--host', '127.0.0.1', '--proxy-config', proxy, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', async code => { authServer.close(); await rm(directory, { recursive: true, force: true }); process.exitCode = code ?? 1; });
