import http from 'node:http';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.dirname(appDirectory);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function containedFile(directory, filename) {
  const base = await realpath(directory);
  const target = await realpath(path.join(base, filename));
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(target)).isFile()) {
    throw Object.assign(new Error('未找到文件'), { status: 404 });
  }
  return target;
}

async function listCards(root) {
  const directory = path.join(root, '知识库');
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /^知识卡\d{2}-.+\.md$/.test(entry.name)).map(entry => {
    const [, number, name] = entry.name.match(/^知识卡(\d{2})-(.+)\.md$/);
    return { id: Number(number), title: name, filename: entry.name };
  }).sort((a, b) => a.id - b.id);
}

export function createLearningServer({ root = defaultRoot, publicDirectory = path.join(appDirectory, 'public') } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const port = request.socket.localPort;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!allowedHosts.has(request.headers.host) || (request.headers.origin && ![...allowedHosts].some(host => request.headers.origin === `http://${host}`))) {
        return send(403, JSON.stringify({ error: '仅允许本机同源访问' }));
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return send(405, JSON.stringify({ error: '学习页只读' }));
      }
      const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
      if (pathname === '/api/cards') return send(200, JSON.stringify({ cards: await listCards(root) }));
      const match = pathname.match(/^\/api\/cards\/(\d{1,2})$/);
      if (match) {
        const card = (await listCards(root)).find(item => item.id === Number(match[1]));
        if (!card) return send(404, JSON.stringify({ error: '未找到知识卡' }));
        const filename = await containedFile(path.join(root, '知识库'), card.filename);
        return send(200, JSON.stringify({ ...card, markdown: await readFile(filename, 'utf8') }));
      }
      const asset = pathname === '/' ? '/index.html' : pathname;
      // Public assets are the only filesystem surface: no repository-root static server.
      if (!/^\/[a-zA-Z0-9_/-]+\.(html|js|css)$/.test(asset) || asset.includes('..')) return send(404, JSON.stringify({ error: '未找到页面' }));
      const filename = await containedFile(publicDirectory, asset.slice(1));
      return send(200, await readFile(filename), mimeTypes[path.extname(filename)]);
    } catch (error) {
      const status = error instanceof URIError ? 400 : (error.status || (error.code === 'ENOENT' ? 404 : 500));
      send(status, JSON.stringify({ error: status === 400 ? '地址格式有误' : status === 404 ? '未找到文件' : '无法读取学习资料，请检查本地知识库文件' }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535 的整数');
  const server = createLearningServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用；可设置 PORT 后重试。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`学习页已启动：http://127.0.0.1:${port} （Ctrl+C 停止）`));
}
