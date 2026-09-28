import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('.');
const { version, build } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packaged = path.join(root, 'dist/build/win-unpacked/resources/app');
const release = path.join(root, 'dist/交付', version);
const locales = (await readdir(path.join(root, 'dist/build/win-unpacked/locales'))).sort();
assert.deepEqual(locales, build.electronLanguages.map(language => `${language}.pak`).sort());
assert.equal(JSON.parse(await readFile(path.join(packaged, 'package.json'), 'utf8')).version, version);
const permitted = [
  /^package\.json$/,
  /^桌面\/(?:main\.mjs|preload\.cjs|data\.mjs|ai\.mjs|assets\/icon\.ico)$/,
  /^网页\/(?:server\.mjs|package\.json|public\/[a-zA-Z0-9_.-]+)$/,
  /^计划页\/(?:[a-zA-Z0-9_-]+\.mjs|package\.json|public\/[a-zA-Z0-9_.-]+)$/,
  /^学习页\/(?:server\.mjs|package\.json|public\/[a-zA-Z0-9_.-]+)$/,
  /^知识库\/知识卡[^/]+\.md$/,
  /^实录\/_模板-实录\.md$/,
];
async function list(directory) {
  const results = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), 'No packaged symlinks');
    const target = path.join(directory, item.name);
    if (item.isDirectory()) results.push(...await list(target));
    else results.push(target);
  }
  return results;
}
const hash = content => createHash('sha256').update(content).digest('hex');
const resources = [];
for (const file of await list(packaged)) {
  const name = path.relative(packaged, file).split(path.sep).join('/');
  assert.ok(permitted.some(pattern => pattern.test(name)), `Unexpected resource: ${name}`);
  assert.ok(!/\.test\.|\.lock$|node_modules|\.git/.test(name), `Unexpected test/runtime data: ${name}`);
  const bytes = await readFile(file);
  if (name !== 'package.json') assert.equal(hash(bytes), hash(await readFile(path.join(root, name))), `Stale resource: ${name}`);
  resources.push({ name, sha256: hash(bytes), bytes: bytes.length });
}
for (const required of ['桌面/main.mjs', '桌面/preload.cjs', '桌面/data.mjs', '实录/_模板-实录.md', '学习页/public/storage.js']) assert.ok(resources.some(item => item.name === required));
const artifacts = [];
for (const name of [`Yike-${version}-x64-setup.exe`, `Yike-${version}-x64-portable.exe`]) {
  const file = path.join(release, name);
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
  artifacts.push({ name, bytes: (await stat(file)).size, sha256: hash(bytes) });
}
assert.equal(artifacts.length, 2, 'Both installer and portable EXE must exist');
await writeFile(path.join(root, 'dist/build/release-manifest.json'), JSON.stringify({ version, locales, resources, artifacts }, null, 2));
await writeFile(path.join(release, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
console.log(JSON.stringify({ passed: true, resourceCount: resources.length, knowledgeCards: resources.filter(item => item.name.startsWith('知识库/')).length, artifacts }, null, 2));
