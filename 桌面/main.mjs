import { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUnifiedServer } from '../网页/server.mjs';
import { createGuard } from '../计划页/fsguard.mjs';
import { createLearningStore, importPlan, backupData } from './data.mjs';
import { createAIService } from './ai.mjs';

const resourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A stable profile shared by installer and portable editions; independent of version/port.
const profileRoot = process.env.YIJING_USER_DATA_DIR
  ? path.resolve(process.env.YIJING_USER_DATA_DIR)
  : path.join(app.getPath('appData'), 'Yike');
app.setPath('userData', profileRoot);
app.setAppUserModelId('local.yijing.yike');
app.setName('一刻');
const dataRoot = path.join(profileRoot, 'data');
let win, running, guard, learning, ai, origin, busy = false, quitting = false, mayQuit = false, quitRequested = false, unloadCancelled = false;

function report(error) {
  dialog.showErrorBox('一刻 · 操作未完成', error instanceof Error ? error.message : String(error));
}
function focusWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
async function stopServer() {
  if (!running) return;
  const previous = running;
  running = undefined;
  await previous.close();
  await guard.flush();
}
async function startServer() {
  guard = createGuard(dataRoot, { resourceRoot });
  running = await startUnifiedServer({ port: 0, guard, learningRoot: resourceRoot, ai });
  origin = `http://127.0.0.1:${running.server.address().port}`;
}
async function shutdown() {
  if (quitting) return;
  if (busy) { quitRequested = true; return; }
  quitting = true;
  ai?.cancel();
  try {
    if (win && !win.isDestroyed()) {
      // Stop new renderer requests before draining the existing HTTP requests.
      unloadCancelled = false;
      await win.loadURL('about:blank');
      if (unloadCancelled) { quitting = false; quitRequested = false; return; }
      win.hide();
    }
    await stopServer();
    mayQuit = true;
    app.quit();
  } catch (error) {
    if (unloadCancelled) { quitting = false; quitRequested = false; win?.show(); return; }
    report(error);
    mayQuit = true;
    app.exit(1);
  }
}

async function withOperation(operation) {
  if (busy || quitting) return;
  busy = true;
  try { await operation(); }
  catch (error) { report(error); }
  finally { busy = false; if (quitRequested) void shutdown(); }
}

// The original data root is never modified. Copy only into an empty desktop plan.
async function importOldPlan() {
  const selected = await dialog.showOpenDialog(win, {
    title: '选择包含“计划”子文件夹的原项目目录或备份目录', properties: ['openDirectory'],
  });
  if (selected.canceled) return;
  const choice = await dialog.showMessageBox(win, {
    type: 'question', title: '导入旧计划',
    message: '复制旧计划到桌面版，原文件保留。',
    detail: '请先关闭使用这份旧数据的网页版服务。仅在桌面版计划为空时允许导入；已有记录不会被覆盖。两份数据之后不会自动同步。',
    buttons: ['导入', '取消'], defaultId: 0, cancelId: 1,
  });
  if (choice.response !== 0) return;
  await paused(async () => {
    const result = await importPlan(selected.filePaths[0], dataRoot);
    await dialog.showMessageBox(win, { type: 'info', message: '计划已导入，原文件保留。', detail: `复制 ${result.fileCount} 个文件。` });
  });
}

async function paused(operation) {
  const hash = win.webContents.getURL().split('#')[1] || 'plan';
  ai?.cancel();
  unloadCancelled = false;
  try { await win.loadURL('about:blank'); }
  catch (error) { if (unloadCancelled) return; throw error; }
  if (unloadCancelled) return;
  try {
    await stopServer();
    await operation();
  } finally {
    if (!quitting) {
      await startServer();
      await win.loadURL(`${origin}/#${hash}`);
    }
  }
}

async function exportLearning() {
  const selected = await dialog.showSaveDialog(win, {
    title: '导出学习进度', defaultPath: `一刻-学习进度-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: '学习进度', extensions: ['json'] }],
  });
  if (selected.canceled || !selected.filePath) return;
  const relative = path.relative(dataRoot, path.resolve(selected.filePath));
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('请导出到应用数据目录以外的位置。');
  await fs.writeFile(selected.filePath, JSON.stringify(learning.exportData(), null, 2), 'utf8');
}

async function importLearning() {
  const selected = await dialog.showOpenDialog(win, {
    title: '导入浏览器或桌面版导出的学习进度', properties: ['openFile'],
    filters: [{ name: '学习进度', extensions: ['json'] }],
  });
  if (selected.canceled) return;
  const file = selected.filePaths[0];
  if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('进度文件过大，未导入。');
  const document = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  const selectedAction = await dialog.showMessageBox(win, {
    type: 'question', message: '用文件中的学习进度替换桌面版进度？',
    detail: '将先备份当前进度。计划记录不受影响；导入后页面会重新加载。',
    buttons: ['备份并导入', '取消'], defaultId: 0, cancelId: 1,
  });
  if (selectedAction.response !== 0) return;
  await fs.mkdir(path.join(profileRoot, 'backups'), { recursive: true });
  await fs.writeFile(path.join(profileRoot, 'backups', `learning-${Date.now()}.json`), JSON.stringify(learning.exportData(), null, 2), { flag: 'wx' });
  learning.importData(document);
  win.reload();
}

async function makeBackup() {
  const selected = await dialog.showOpenDialog(win, { title: '选择备份保存位置', properties: ['openDirectory', 'createDirectory'] });
  if (selected.canceled) return;
  await paused(async () => {
    const result = await backupData(dataRoot, selected.filePaths[0]);
    await dialog.showMessageBox(win, { type: 'info', message: '备份已完成。', detail: typeof result === 'string' ? result : result.path || result.directory || '已创建新的备份文件夹，包含计划记录和学习进度。' });
  });
}

function installMenu() {
  Menu.setApplicationMenu(null);
}
async function desktopAction(operation) {
  const actions = {
    'open-data': async () => { const error = await shell.openPath(dataRoot); if (error) throw new Error(error); },
    'backup': makeBackup, 'import-plan': importOldPlan,
    'import-learning': importLearning, 'export-learning': exportLearning,
    'reload': async () => win.reload(),
    'zoom-in': async () => win.webContents.setZoomLevel(Math.min(5, win.webContents.getZoomLevel() + 0.5)),
    'zoom-out': async () => win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5)),
    'zoom-reset': async () => win.webContents.setZoomLevel(0),
    'fullscreen': async () => win.setFullScreen(!win.isFullScreen()),
    'about': async () => dialog.showMessageBox(win, { type: 'info', title: '一刻', message: `一刻 ${app.getVersion()}`, detail: '任务、个人条件与事件档案保存在本机。仅点击分析才会向你配置的模型服务发送预览中的资料。备份包含计划、条件、档案、分析和学习进度；模型密钥不进入备份。' }),
    'quit': async () => app.quit(),
  };
  if (!Object.hasOwn(actions, operation)) throw new Error('不支持此操作');
  if (busy || quitting) throw new Error('另一个操作正在进行，请稍候');
  busy = true;
  try { await actions[operation](); return { ok: true }; }
  finally { busy = false; if (quitRequested) void shutdown(); }
}

function trustedSender(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.on('before-quit', event => {
    if (mayQuit) return;
    event.preventDefault();
    void shutdown();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    learning = createLearningStore(dataRoot);
    ai = createAIService(profileRoot, safeStorage);
    await startServer();
    ipcMain.handle('yike:desktop', async (event, operation, payload) => {
      if (!trustedSender(event) || quitting) throw new Error('此页面没有桌面设置访问权限');
      if (operation === 'ai-settings') return ai.info();
      if (operation === 'save-ai') return ai.save(payload);
      return desktopAction(operation);
    });
    ipcMain.on('yike:learning', (event, operation, key, value) => {
      try {
        if (!trustedSender(event) || quitting || (operation !== 'get' && operation !== 'set')) throw new Error('此页面没有学习进度访问权限');
        const result = operation === 'get' ? learning.getItem(key) : learning.setItem(key, value);
        event.returnValue = { ok: true, value: result ?? null };
      } catch (error) { event.returnValue = { ok: false, error: error.message }; }
    });
    win = new BrowserWindow({
      width: 1280, height: 860, minWidth: 760, minHeight: 580,
      show: false, backgroundColor: '#f5f3ec', title: '一刻',
      icon: path.join(resourceRoot, '桌面/assets/icon.ico'),
      webPreferences: {
        preload: path.join(resourceRoot, '桌面/preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        spellcheck: false,
      },
    });
    win.on('close', event => { if (!mayQuit) { event.preventDefault(); void shutdown(); } });
    win.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', message: '还有尚未保存的内容', detail: '返回编辑可以继续保存；放弃后这些未保存的修改将丢失。', buttons: ['返回编辑', '放弃并继续'], defaultId: 0, cancelId: 0 });
      if (choice === 1) event.preventDefault();
      else unloadCancelled = true;
    });
    const session = win.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    // No remote pages, popups or embedded Node-enabled surfaces.
    session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url === 'about:blank' || details.url.startsWith('blob:' + origin + '/') || details.url.startsWith(origin + '/');
      callback({ cancel: !allowed });
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin + '/')) event.preventDefault();
    });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    installMenu();
    await win.loadURL(`${origin}/#plan`);
    win.show();
  }).catch(async error => {
    report(error);
    try { await stopServer(); } catch { /* the stale PID lock remains recoverable */ }
    mayQuit = true;
    app.exit(1);
  });
}
