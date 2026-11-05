const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saveDdl', {
  list: () => ipcRenderer.invoke('ddl:list'),
  add: (input) => ipcRenderer.invoke('ddl:add', input),
  addText: (text) => ipcRenderer.invoke('ddl:add-text', text),
  toggle: (id) => ipcRenderer.invoke('ddl:toggle', id),
  remove: (id) => ipcRenderer.invoke('ddl:remove', id),
  exportIcs: () => ipcRenderer.invoke('ddl:export'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:autostart', enabled),
  setContextMenu: (install) => ipcRenderer.invoke('settings:context-menu', install),
  importDocument: () => ipcRenderer.invoke('document:pick'),
  extractFile: (filePath) => ipcRenderer.invoke('document:extract', filePath),
  saveAI: (input) => ipcRenderer.invoke('settings:save-ai', input),
  testAI: (input) => ipcRenderer.invoke('settings:test-ai', input),
  clearAIKey: () => ipcRenderer.invoke('settings:clear-ai-key'),
  show: () => ipcRenderer.invoke('app:show'),
  dataFile: () => ipcRenderer.invoke('app:data-file'),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ddl:changed', listener);
    return () => ipcRenderer.removeListener('ddl:changed', listener);
  },
  onFocusItem: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('ddl:focus', listener);
    return () => ipcRenderer.removeListener('ddl:focus', listener);
  },
});