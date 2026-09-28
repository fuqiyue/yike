import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const LEARNING_KEYS = Object.freeze(['yijing-course-progress-v1', 'yijing-course-domain-cards-v1', 'yijing-learning:quiz75:self-assessment:v1']);
const MAX_BYTES = 2 * 1024 * 1024;
const LEARNING_FILE = 'learning-progress.json';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Check every existing ancestor, including junctions; never follow user-selected links.
function safePath(filename) {
  const resolved = path.resolve(filename);
  let current = resolved;
  while (true) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('数据路径不能包含符号链接或目录联接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolved;
}

function readFile(filename, maxBytes = Infinity) {
  safePath(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink > 1) throw new Error('数据文件必须是普通文件，不能是链接');
  if (stat.size > maxBytes) throw new Error('学习进度超过 2 MB 限制');
  return fs.readFileSync(filename);
}

function validateValue(key, value) {
  if (!LEARNING_KEYS.includes(key)) throw new Error('未知学习进度键');
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) throw new Error('学习进度必须是 2 MB 以内的 JSON 字符串');
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('学习进度 JSON 无效'); }
  const valid = key === LEARNING_KEYS[0]
    ? Array.isArray(parsed) && parsed.length <= 2000 && parsed.every(item => typeof item === 'string' && item.length <= 100)
    : key === LEARNING_KEYS[1]
      ? Array.isArray(parsed) && parsed.length <= 3 && parsed.every(item => Number.isInteger(item) && item >= 1 && item <= 64)
      : plain(parsed) && Object.keys(parsed).length <= 2000 && Object.entries(parsed).every(([id, state]) => /^[A-D][1-9]\d?$/.test(id) && ['understood', 'wrong'].includes(state));
  if (!valid) throw new Error('学习进度结构无效');
}

function validateDocument(document) {
  if (!plain(document) || document.format !== 'yijing-learning' || document.version !== 1 || !plain(document.values)) throw new Error('不是受支持的学习进度文件');
  for (const [key, value] of Object.entries(document.values)) validateValue(key, value);
  const result = { format: 'yijing-learning', version: 1, values: { ...document.values } };
  if (Buffer.byteLength(JSON.stringify(result, null, 2) + '\n') > MAX_BYTES) throw new Error('学习进度总大小超过 2 MB 限制');
  return result;
}

export function createLearningStore(dataRoot) {
  const root = safePath(dataRoot);
  fs.mkdirSync(root, { recursive: true });
  const filename = path.join(root, LEARNING_FILE);
  const load = () => {
    try { return validateDocument(JSON.parse(readFile(filename, MAX_BYTES).toString('utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return { format: 'yijing-learning', version: 1, values: {} };
      throw new Error(`学习进度读取失败，原文件已保留：${error.message}`);
    }
  };
  load(); // Fail visibly at startup instead of silently resetting corrupt data.
  const save = document => {
    const validated = validateDocument(document);
    load(); // Never overwrite externally damaged data.
    safePath(filename);
    const temporary = path.join(root, `.learning-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx');
      fs.writeFileSync(fd, JSON.stringify(validated, null, 2) + '\n');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, filename);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return { keyCount: Object.keys(validated.values).length };
  };
  return {
    getItem(key) {
      if (!LEARNING_KEYS.includes(key)) throw new Error('未知学习进度键');
      const { values } = load();
      return own(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      validateValue(key, value);
      const document = load(); document.values[key] = value;
      save(document);
    },
    exportData: load,
    // Import is a complete snapshot; omitted known keys are cleared.
    importData(document) {
      const incoming = validateDocument(document);
      save(incoming);
      return { importedKeys: Object.keys(incoming.values).length };
    },
  };
}

function scan(directory) {
  safePath(directory);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) throw new Error('计划目录不能包含链接');
    if (stat.isDirectory()) files.push(...scan(filename));
    else if (stat.isFile()) files.push(filename);
    else throw new Error('计划目录包含不支持的文件类型');
  }
  return files;
}

function requireStopped(plan) {
  const lock = path.join(plan, '.lock');
  try {
    const { pid } = JSON.parse(readFile(lock, 4096).toString('utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('锁信息无效');
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    throw new Error('计划服务正在运行，请先关闭网页版或桌面应用');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const digest = buffer => createHash('sha256').update(buffer).digest('hex');
function copyVerified(source, destination) {
  const original = readFile(source);
  safePath(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, original, { flag: 'wx' });
  const sha256 = digest(original);
  if (digest(readFile(destination)) !== sha256 || digest(readFile(source)) !== sha256) throw new Error('复制校验失败或源文件已变化');
  return { sha256, bytes: original.length };
}
function within(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function removeEmptyTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('目标计划目录不是空目录');
    removeEmptyTree(path.join(directory, entry.name));
  }
  fs.rmdirSync(directory);
}

export async function importPlan(sourceRoot, dataRoot) {
  const source = safePath(path.join(sourceRoot, '计划'));
  const root = safePath(dataRoot);
  const target = path.join(root, '计划');
  if (within(source, root) || within(root, source)) throw new Error('导入源和目标不能相同或互相包含');
  requireStopped(source);
  const files = scan(source).filter(file => /\.md$/i.test(file));
  if (!files.length) throw new Error('所选目录的计划文件夹没有 Markdown 数据');
  fs.mkdirSync(root, { recursive: true });
  safePath(target);
  if (fs.existsSync(target) && scan(target).length) throw new Error('目标计划已有数据，不能覆盖；请使用空白数据目录');
  const staging = fs.mkdtempSync(path.join(root, '.plan-import-'));
  const manifest = [];
  try {
    for (const sourceFile of files) {
      const relative = path.relative(source, sourceFile);
      manifest.push({ path: relative, ...copyVerified(sourceFile, path.join(staging, relative)) });
    }
    requireStopped(source);
    const after = scan(source).filter(file => /\.md$/i.test(file));
    if (after.length !== files.length || after.some((file, index) => file !== files[index] || digest(readFile(file)) !== manifest[index].sha256)) throw new Error('导入期间源计划发生变化，请关闭服务后重试');
    if (fs.existsSync(target)) {
      if (scan(target).length) throw new Error('导入期间目标计划出现数据，已取消');
      removeEmptyTree(target);
    }
    fs.renameSync(staging, target);
    return { directory: target, fileCount: manifest.length, files: manifest };
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
}

export async function backupData(dataRoot, destinationParent) {
  const root = safePath(dataRoot);
  const parent = safePath(destinationParent);
  if (within(root, parent)) throw new Error('备份目的地不能位于应用数据目录内');
  if (!fs.statSync(parent).isDirectory()) throw new Error('请选择备份目录');
  const plan = path.join(root, '计划');
  requireStopped(plan);
  const sources = fs.existsSync(plan) ? scan(plan).filter(file => /\.md$/i.test(file)) : [];
  const learning = path.join(root, LEARNING_FILE);
  if (fs.existsSync(learning)) {
    validateDocument(JSON.parse(readFile(learning, MAX_BYTES).toString('utf8')));
    sources.push(learning);
  }
  const name = `周易备份-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const staging = fs.mkdtempSync(path.join(parent, '.yijing-backup-'));
  const directory = path.join(parent, name);
  const manifest = [];
  try {
    for (const source of sources) {
      const relative = path.relative(root, source);
      manifest.push({ path: relative, ...copyVerified(source, path.join(staging, relative)) });
    }
    requireStopped(plan);
    const after = fs.existsSync(plan) ? scan(plan).filter(file => /\.md$/i.test(file)) : [];
    if (fs.existsSync(learning)) after.push(learning);
    if (after.length !== sources.length || after.some((file, index) => file !== sources[index] || digest(readFile(file)) !== manifest[index].sha256)) throw new Error('备份期间数据发生变化，请关闭服务后重试');
    fs.renameSync(staging, directory);
    return { directory, fileCount: manifest.length, files: manifest };
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
}
