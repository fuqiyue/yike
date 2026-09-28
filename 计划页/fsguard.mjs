import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TORN_MARKER = ' <!-- interrupted-tail -->';
const denied = () => Object.assign(new Error('文件路径不在许可范围内'), { code: 'EACCES' });

export function createGuard(root = defaultRoot, { resourceRoot = root } = {}) {
  const dataBase = path.resolve(root);
  const resourceBase = path.resolve(resourceRoot);
  let pending = Promise.resolve();
  const serial = operation => {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  };
  async function resolveAllowed(relative, write = false) {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || relative.includes(':') || path.isAbsolute(relative)) throw denied();
    const segments = relative.replace(/\/$/, '').split('/');
    if (segments.some(part => !part || part === '.' || part === '..')) throw denied();
    const plan = segments[0] === '计划';
    const template = relative === '实录/_模板-实录.md';
    const asset = relative.startsWith('计划页/public/');
    const knowledge = /^知识库\/知识卡(?:0[0-9]|[1-6][0-9]|7[0-5])-[^/]+\.md$/.test(relative) || relative === '知识库';
    if (!plan && (write || (!template && !asset && !knowledge))) throw denied();
    const base = plan ? dataBase : resourceBase;
    const target = path.resolve(base, ...segments);
    const rel = path.relative(base, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw denied();
    // Refuse links at every component, including the configured root.
    let cursor = path.parse(base).root;
    for (const part of path.relative(cursor, target).split(path.sep)) {
      cursor = path.join(cursor, part);
      try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw denied(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  async function prepare(relative) {
    const filename = await resolveAllowed(relative, true);
    if (!relative.endsWith('.md') && relative !== '计划/.lock') throw denied();
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await resolveAllowed(relative, true);
    return filename;
  }
  return {
    // Drain writes already submitted; individual write promises retain errors.
    async flush() { await pending; },
    async readText(relative) { return fs.readFile(await resolveAllowed(relative), 'utf8'); },
    async metadata(relative) {
      const stat = await fs.stat(await resolveAllowed(relative), { bigint: true });
      return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
    },
    async listNames(relative) {
      const filename = await resolveAllowed(relative);
      try {
        return (await fs.readdir(filename, { withFileTypes: true })).filter(item => item.isFile() && !item.isSymbolicLink()).map(item => item.name);
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    appendLine(relative, line) {
      return serial(async () => {
        const limit = relative === '计划/资料/变更.md' ? 262144 : /\s改\s/.test(line) ? 65536 : 4096;
        if (relative === '计划/.lock' || typeof line !== 'string' || /[\r\n\0]/u.test(line) || Buffer.byteLength(line + '\n') >= limit) throw new Error('记录必须是一行且小于允许的长度');
        const filename = await prepare(relative);
        let repair = '';
        let handle;
        try {
          handle = await fs.open(filename, 'r');
          const { size } = await handle.stat();
          if (size) {
            const tail = Buffer.alloc(1);
            await handle.read(tail, 0, 1, size - 1);
            if (tail[0] !== 10) repair = `${TORN_MARKER}\n`;
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        finally { await handle?.close(); }
        await fs.appendFile(filename, `${repair}${line}\n`, 'utf8');
      });
    },
    writeNew(relative, text) {
      return serial(async () => fs.writeFile(await prepare(relative), text, { encoding: 'utf8', flag: 'wx' }));
    },
    removeLock(expected) {
      return serial(async () => {
        const filename = await resolveAllowed('计划/.lock', true);
        try {
          if (await fs.readFile(filename, 'utf8') !== expected) return false;
          await fs.unlink(filename);
          return true;
        } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
    }
  };
}

const defaultGuard = createGuard();
export const readText = (...args) => defaultGuard.readText(...args);
export const appendLine = (...args) => defaultGuard.appendLine(...args);
export const writeNew = (...args) => defaultGuard.writeNew(...args);

export async function disposeTestWorkspace(root) {
  const verified = path.resolve(root);
  if (path.dirname(verified) !== path.resolve(os.tmpdir()) || !/^plan-room-test-[a-zA-Z0-9]+$/.test(path.basename(verified))) throw denied();
  await fs.rm(verified, { recursive: true, force: true });
}

// Isolated test fixtures only. Never grants extra access to the application root.
export async function createTestWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-room-test-'));
  const fixturePath = relative => {
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw denied();
    return target;
  };
  return {
    root, guard: createGuard(root),
    async seed(relative, content) {
      const target = fixturePath(relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    },
    async link(relative, targetRelative) {
      const target = fixturePath(relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(fixturePath(targetRelative), { recursive: true });
      await fs.symlink(fixturePath(targetRelative), target, 'junction');
    },
    async snapshot(relative) {
      const target = fixturePath(relative);
      const entries = await fs.readdir(target, { recursive: true });
      return entries.sort();
    },
    async source(relative) {
      if (!/^(?:计划页|学习页)\/[a-zA-Z0-9_/.-]+$/.test(relative) && relative !== '实录/_模板-实录.md') throw denied();
      if (relative.split('/').some(part => !part || part === '.' || part === '..')) throw denied();
      const target = path.resolve(defaultRoot, relative);
      if (!target.startsWith(defaultRoot + path.sep)) throw denied();
      return fs.readFile(target, 'utf8');
    },
    async dispose() { await disposeTestWorkspace(root); }
  };
}
