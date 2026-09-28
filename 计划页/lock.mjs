import { randomUUID } from 'node:crypto';

export function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export async function acquireLock(guard, port) {
  const content = JSON.stringify({ pid: process.pid, port, token: randomUUID() }) + '\n';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await guard.writeNew('计划/.lock', content);
      return () => guard.removeLock(content);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = await guard.readText('计划/.lock'); }
      catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
      let owner;
      try { owner = JSON.parse(previous); } catch { throw new Error('启动锁内容不完整，请检查计划/.lock'); }
      if (isAlive(owner.pid)) throw new Error('计划页已有运行实例');
      await guard.removeLock(previous);
    }
  }
  throw new Error('无法取得启动锁');
}
