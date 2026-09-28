import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('.');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.join(root, `dist/交付/${version}/Yike-${version}-x64-portable.exe`);
const evidence = path.join(root, '.desktop-tests', `portable-${Date.now()}`);
const profile = path.join(evidence, 'profile');
const lockPath = path.join(profile, 'data/计划/.lock');
const checks = [];
const launches = [];
const env = { ...process.env, YIJING_USER_DATA_DIR: profile, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(profile, { recursive: true });
let browser;
let activeLaunch;

async function eventually(operation, timeout = 45000) {
  const start = Date.now();
  while (true) {
    try { return await operation(); } catch (error) {
      if (Date.now() - start >= timeout) throw error;
      await delay(200);
    }
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function launch() {
  const port = await freePort();
  activeLaunch = { port, startedAt: new Date().toISOString() };
  launches.push(activeLaunch);
  const current = activeLaunch;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--force-device-scale-factor=1'], { env, windowsHide: true, stdio: 'ignore' });
  current.launcherPid = child.pid;
  child.once('error', error => { current.error = error.message; });
  child.once('exit', code => { current.exitCode = code; });
  const endpoint = await eventually(async () => {
    if (current.error) throw new Error(current.error);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    assert.equal(response.ok, true);
    const metadata = await response.json();
    assert.ok(metadata.webSocketDebuggerUrl);
    return metadata.webSocketDebuggerUrl;
  }, 60000);
  browser = await chromium.connectOverCDP(endpoint);
  const page = await eventually(async () => {
    const candidates = browser.contexts().flatMap(context => context.pages());
    const found = candidates.find(item => /^http:\/\/127\.0\.0\.1:/.test(item.url()));
    assert.ok(found, 'Application window is available');
    return found;
  });
  await page.locator('#entry').waitFor();
  current.origin = new URL(page.url()).origin;
  return page;
}

async function closeNormally() {
  let owner;
  try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (browser) throw new Error('Application connected but its isolated data lock is missing');
    return;
  }
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  // Close only the PID from this run's newly created isolated profile. Never enumerate or kill applications.
  const command = `$target = Get-Process -Id ${owner.pid} -ErrorAction Stop; if (-not $target.CloseMainWindow()) { throw 'Test application has no closable main window' }`;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CloseMainWindow failed: ${code}`)));
  });
  await eventually(async () => assert.rejects(access(lockPath), { code: 'ENOENT' }), 20000);
  if (activeLaunch) activeLaunch.cleanShutdown = true;
  await browser?.close().catch(() => {});
  browser = undefined;
  await eventually(() => { assert.ok(activeLaunch?.exitCode !== undefined, 'Portable launcher exits after application closes'); }, 20000);
}

let failure;
try {
  let page = await launch();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.yijingStorage.setItem), 'function');
  checks.push({ name: 'portable starts independently with bundled runtime and isolated preload', passed: true });
  await page.locator('#entry').fill('免安装版合成持久化验收');
  await page.locator('#entry').press('Enter');
  await eventually(async () => assert.match(await page.locator('#day-list').innerText(), /免安装版合成持久化验收/));
  await page.screenshot({ path: path.join(evidence, 'plan.png'), scale: 'css' });
  await page.evaluate(() => { location.hash = 'course'; });
  const progress = page.locator('[data-progress]').first();
  await progress.waitFor();
  const progressId = await progress.getAttribute('data-progress');
  await progress.check();
  assert.ok(JSON.parse(await page.evaluate(() => window.yijingStorage.getItem('yijing-course-progress-v1'))).includes(progressId));
  await page.screenshot({ path: path.join(evidence, 'course.png') });
  checks.push({ name: 'synthetic plan and course progress save through UI', passed: true, progressId });
  await closeNormally();
  checks.push({ name: 'first normal close removes isolated data lock', passed: true });
  page = await launch();
  await eventually(async () => assert.match(await page.locator('#day-list').innerText(), /免安装版合成持久化验收/));
  await page.evaluate(() => { location.hash = 'course'; });
  await page.locator('[data-progress]').first().waitFor();
  assert.equal(await page.locator('[data-progress]').first().getAttribute('data-progress'), progressId);
  assert.equal(await page.locator('[data-progress]').first().isChecked(), true);
  checks.push({ name: 'portable relaunch preserves plan and learning progress', passed: true });
  await closeNormally();
  checks.push({ name: 'second normal close removes isolated data lock', passed: true });
} catch (error) {
  failure = error.stack;
} finally {
  if (browser || (activeLaunch && !activeLaunch.cleanShutdown)) {
    try { await closeNormally(); } catch (error) { failure = `${failure || ''}\nCleanup: ${error.stack}`; }
  }
  const result = { passed: !failure, executable, evidence, profile, checks, launches, ...(failure ? { error: failure } : {}) };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failure) process.exitCode = 1;
}
