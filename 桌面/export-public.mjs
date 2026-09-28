import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Export only explicitly allowed source paths. Never read personal directories
// or copy the source repository's .git history. Content review is still required.
const root = path.resolve('.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const destination = path.join(root, 'dist', 'public-source', `yike-${pkg.version}`);
const files = ['package.json', 'package-lock.json', '实录/_模板-实录.md'];
const desktop = [
  'main.mjs', 'preload.cjs', 'data.mjs', 'ai.mjs', 'data.test.mjs', 'ai.test.mjs',
  'build-icon.mjs', 'prepare-release.mjs', 'verify-distribution.mjs',
  'verify-layout.mjs', 'verify-periodic.mjs', 'verify-opportunities.mjs',
  'verify-portable.mjs', 'export-public.mjs', 'PUBLIC_README.md',
];
files.push(...desktop.map(file => `桌面/${file}`));
async function collect(directory, accepts) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed: ${name}`);
    if (entry.isDirectory() && !['node_modules', '.git', 'dist', '.desktop-tests'].includes(entry.name)) await collect(name, accepts);
    else if (entry.isFile() && accepts(name)) files.push(name);
  }
}
for (const directory of ['计划页', '学习页', '网页']) {
  await collect(directory, name => /\.(?:mjs|js|css|html|cjs|cmd)$/.test(name) || name === `${directory}/package.json`);
}
await collect('桌面/assets', name => /\.(?:ico|png|svg)$/.test(name));
for (const entry of await readdir(path.join(root, '知识库'), { withFileTypes: true })) {
  if (entry.isFile() && /^知识卡\d{2}-.+\.md$/.test(entry.name)) files.push(`知识库/${entry.name}`);
}
// Refuse an existing destination: publishing never deletes or resets a checkout.
await mkdir(path.dirname(destination), { recursive: true });
await mkdir(destination);
const manifest = [];
function publicContent(name, bytes) {
  if (!name.endsWith('.md')) return bytes;
  let text = bytes.toString('utf8');
  if (/^知识库\/知识卡(?:67|68|74)-/.test(name)) text = text.replace(/^cd "[A-Z]:\/[^"\r\n]+"$/gm, '# 在项目根目录运行以下命令');
  if (name === '实录/_模板-实录.md') text = text.replace(/卦域: <[^\r\n]+>/, '卦域: <根据事实选择处境标签；参照知识卡00的定域路由，定不下来填 未决>');
  if (name.startsWith('知识库/知识卡00-')) {
    text = text.replace(/## 七、产品合规立场[^\n]*\r?\n[\s\S]*?(?=本库定位是)/, '## 七、产品合规立场\n\n> 以下为知识库的使用边界与解释口径。推测不代表系统获得预测能力。\n\n');
    text = text.split('\n').filter(line => !/logic_readme|logic_change|logic_domains|logic_version|项目大纲|\.\.\/工具\/|\.\.\/推演\//.test(line)).join('\n');
    text = text.replace(/，索引 `实录\/_索引\.md`/, '');
  }
  return Buffer.from(text);
}
async function put(name, bytes) {
  await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await writeFile(path.join(destination, name), bytes, { flag: 'wx' });
  manifest.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const name of [...new Set(files)].sort()) {
  if (!(await lstat(path.join(root, name))).isFile()) throw new Error(`Not a regular file: ${name}`);
  await put(name, publicContent(name, await readFile(path.join(root, name))));
}
await put('README.md', await readFile(path.join(root, '桌面/PUBLIC_README.md')));
await put('.gitignore', Buffer.from(`node_modules/\ndist/\n.build-cache/\n.desktop-tests/\n.env\n.env.*\n*.log\n*.pem\n*.key\n计划/\n推演/\n回顾/\n实录/*\n!实录/_模板-实录.md\ndata/\nprofile/\nprofiles/\nbackups/\npersonal-imports/\nai-settings.json\nlearning-progress.json\nThumbs.db\ndesktop.ini\n.DS_Store\n`));
await writeFile(path.join(destination, 'PUBLIC_SOURCE_MANIFEST.json'), JSON.stringify({ version: pkg.version, files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ destination, files: manifest.length, copiedHistory: false, contentReviewRequired: true }));
