import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuard } from './fsguard.mjs';
import { createStore } from './store.mjs';
import { acquireLock } from './lock.mjs';
import { generateDraft } from './draft.mjs';
import { createContextStore } from './context.mjs';
import { createAnalysis } from './analysis.mjs';

const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/view.js': ['view.js', 'text/javascript'], '/periodic.js': ['periodic.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const issue = (status, message) => Object.assign(new Error(message), { status });
async function body(request, limit = 65536) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw issue(415, '请使用 JSON 提交');
  if (Number(request.headers['content-length']) > limit) { request.resume(); throw issue(413, '输入太长'); }
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length <= limit) chunks.push(chunk);
  }
  if (length > limit) throw issue(413, '输入太长');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw issue(400, '输入格式不正确'); }
}
export function createPlanServer({ guard = createGuard(), clock, draft = generateDraft, ai } = {}) {
  const store = createStore(guard, clock);
  const context = createContextStore(guard, store);
  const analysis = createAnalysis({ guard, store, context, ai });
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const send = (status, value, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : typeof value === 'string' ? value : JSON.stringify(value));
    };
    try {
      const host = request.headers.host;
      if (![`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '仅允许本机同源访问' });
      const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
      const day = pathname.match(/^\/api\/day\/([^/]+)$/);
      const state = pathname.match(/^\/api\/state\/([^/]+)$/);
      const asset = assets[pathname];
      if (pathname === '/api/context') {
        if (['GET', 'HEAD'].includes(request.method)) return send(200, await context.snapshot());
        if (request.method === 'POST') return send(201, await context.save(await body(request, 262144)));
        response.setHeader('Allow', 'GET, HEAD, POST');
        return send(405, { error: '此接口不支持该方法' });
      }
      if (pathname === '/api/analysis') {
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return send(405, { error: '此接口不支持该方法' }); }
        return send(200, await analysis(await body(request)));
      }
      const isRead = Boolean(day || state || ['/api/day', '/api/open', '/api/revision', '/api/search'].includes(pathname) || asset);
      const isWrite = pathname === '/api/event' || (pathname === '/api/draft' && draft);
      if (!isRead && !isWrite) return send(404, { error: '未找到页面' });
      const methods = isRead ? ['GET', 'HEAD'] : ['POST'];
      if (!methods.includes(request.method)) {
        response.setHeader('Allow', methods.join(', '));
        return send(405, { error: '此接口不支持该方法' });
      }
      if (day) return send(200, await store.day(day[1]));
      if (state) return send(200, await store.state(state[1]));
      if (pathname === '/api/revision') return send(200, { revision: await store.revision() });
      if (pathname === '/api/search') return send(200, await store.search(new URL(request.url, `http://${host}`).searchParams.get('q') || ''));
      if (pathname === '/api/day') return send(400, { error: '请提供日期' });
      if (pathname === '/api/open') return send(200, await store.open());
      if (pathname === '/api/event') return send(201, await store.event(await body(request)));
      if (pathname === '/api/draft') {
        const payload = await body(request);
        if (!payload || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'date')) throw issue(400, '请提供日期');
        return send(201, await draft(store, payload.date));
      }
      return send(200, await guard.readText(`计划页/public/${asset[0]}`), asset[1]);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.status || (error.code === 'ENOENT' ? 404 : 500);
      send(status, { error: status < 500 || error.expose === true ? error.message : '未能保存或读取，请检查本地文件后重试' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return { server, store };
}
export async function startPlanServer({ port = 3220, guard = createGuard(), clock, draft, ai } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口格式不正确');
  const release = await acquireLock(guard, port);
  const { server, store } = createPlanServer({ guard, clock, draft, ai });
  try {
    const diagnostics = await (async () => { const { malformed, torn } = await store.snapshot(); return { malformed, torn }; })();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    return { server, store, diagnostics, async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await release();
    } };
  } catch (error) { await release(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const running = await startPlanServer({ port: Number(process.env.PORT || 3220) });
    console.log(`计划页已启动：http://127.0.0.1:${running.server.address().port}`);
    console.log(`撕裂行：${running.diagnostics.torn}；无效行：${running.diagnostics.malformed}`);
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      try { await running.close(); } catch (error) { console.error(error.message); process.exitCode = 1; }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
