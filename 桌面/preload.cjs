const { contextBridge, ipcRenderer } = require('electron');

function call(operation, key, value) {
  const result = ipcRenderer.sendSync('yike:learning', operation, key, value);
  if (!result?.ok) throw new Error(result?.error || '学习进度未能保存');
  return result.value;
}

// Only this small, key-validated capability crosses the renderer boundary.
contextBridge.exposeInMainWorld('yijingStorage', Object.freeze({
  getItem: key => call('get', key),
  setItem: (key, value) => call('set', key, value),
}));

contextBridge.exposeInMainWorld('yikeDesktop', Object.freeze({
  action: operation => ipcRenderer.invoke('yike:desktop', operation),
  aiSettings: () => ipcRenderer.invoke('yike:desktop', 'ai-settings'),
  saveAI: value => ipcRenderer.invoke('yike:desktop', 'save-ai', value),
}));
