import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPlanServer } from '../计划页/server.mjs';
import { createLearningServer } from '../学习页/server.mjs';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDirectory = path.join(appDirectory, 'public');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const planApi = /^\/api\/(?:day(?:\/[^/]+)?|state\/\d{4}-\d{2}-\d{2}|revision|search|open|event|draft|context|analysis)$/;

async function containedFile(directory, filename) {
  const base = await realpath(directory);
  const target = await realpath(path.join(base, filename));
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(target)).isFile()) {
    throw Object.assign(new Error('未找到文件'), { status: 404 });
  }
  return target;
}

function forward(request, response, port, pathname) {
  return new Promise((resolve, reject) => {
    const headers = { ...request.headers, host: `127.0.0.1:${port}` };
    delete headers.origin;
    delete headers.connection;
    const upstream = http.request({ hostname: '127.0.0.1', port, path: pathname, method: request.method, headers }, result => {
      response.writeHead(result.statusCode || 502, result.headers);
      result.pipe(response);
      result.on('end', resolve);
    });
    upstream.on('error', reject);
    request.pipe(upstream);
  });
}

async function scopedPlanCss(port) {
  const response = await fetch(`http://127.0.0.1:${port}/style.css`);
  if (!response.ok) throw new Error('计划页样式读取失败');
  const source = (await response.text())
    .replace(/^@charset\s+"UTF-8";\s*/i, '')
    .replaceAll('.plan-app', ':scope')
    .replace(':root{', ':scope{')
    .replace('body{', ':scope{');
  return `@charset "UTF-8";\n@scope (.plan-app){\n${source}\n}`;
}

export function createUnifiedServer({ planPort, learningPort, publicDirectory = defaultPublicDirectory } = {}) {
  if (!Number.isInteger(planPort) || !Number.isInteger(learningPort)) throw new Error('内部服务端口缺失');
  return http.createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const host = request.headers.host;
      const localHosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`];
      if (!localHosts.includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
        return send(403, JSON.stringify({ error: '仅允许本机同源访问' }));
      }
      const rawUrl = request.url || '/';
      const [rawPath, query = ''] = rawUrl.split('?');
      const pathname = decodeURIComponent(rawPath);
      const suffix = query ? `?${query}` : '';

      if (pathname === '/plan/style.css') {
        if (!['GET', 'HEAD'].includes(request.method)) return send(405, JSON.stringify({ error: '此资源只读' }));
        return send(200, await scopedPlanCss(planPort), 'text/css; charset=utf-8');
      }
      if (/^\/plan\/(?:app|view|insights|dates|periodic)\.js$/.test(pathname)) return forward(request, response, planPort, `${pathname.slice('/plan'.length)}${suffix}`);
      if (planApi.test(pathname)) return forward(request, response, planPort, `${pathname}${suffix}`);
      if (/^\/learn\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(pathname)) return forward(request, response, learningPort, `${pathname.slice('/learn'.length)}${suffix}`);
      if (pathname === '/api/cards' || /^\/api\/cards\/\d{1,2}$/.test(pathname)) return forward(request, response, learningPort, `${pathname}${suffix}`);

      if (!['GET', 'HEAD'].includes(request.method)) return send(405, JSON.stringify({ error: '此入口只提供页面' }));
      const assets = { '/': 'index.html', '/index.html': 'index.html', '/shell.css': 'shell.css', '/shell.js': 'shell.js' };
      const asset = assets[pathname];
      if (!asset) return send(404, JSON.stringify({ error: '未找到页面' }));
      const filename = await containedFile(publicDirectory, asset);
      return send(200, await readFile(filename), mimeTypes[path.extname(filename)]);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.status || (error.code === 'ENOENT' ? 404 : 500);
      return send(status, JSON.stringify({ error: status < 500 ? error.message : '统一入口暂时无法响应' }));
    }
  });
}

export async function startUnifiedServer({ port = 3210, guard, clock, draft, ai, learningRoot, learningPublicDirectory, publicDirectory } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须为 0–65535 的整数');
  const plan = await startPlanServer({ port: 0, guard, clock, draft, ai });
  const learning = createLearningServer({ root: learningRoot, publicDirectory: learningPublicDirectory });
  try {
    await new Promise((resolve, reject) => {
      learning.once('error', reject);
      learning.listen(0, '127.0.0.1', () => { learning.removeListener('error', reject); resolve(); });
    });
    const server = createUnifiedServer({ planPort: plan.server.address().port, learningPort: learning.address().port, publicDirectory });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    return { server, diagnostics: plan.diagnostics, async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => learning.close(error => error ? reject(error) : resolve()));
      await plan.close();
    } };
  } catch (error) {
    if (learning.listening) await new Promise(resolve => learning.close(resolve));
    await plan.close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 3210);
    const running = await startUnifiedServer({ port });
    console.log(`统一网页已启动：http://127.0.0.1:${running.server.address().port}`);
    console.log(`撕裂行：${running.diagnostics.torn}；无效行：${running.diagnostics.malformed}`);
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      try { await running.close(); } catch (error) { console.error(error.message); process.exitCode = 1; }
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? '端口 3210 已占用；请先关闭旧学习页或设置 PORT。' : error.message);
    process.exitCode = 1;
  }
}
