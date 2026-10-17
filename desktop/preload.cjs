const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  request: value => ipcRenderer.invoke('desktop:request', value),
  // Pushed when models are added or removed in Ollama, LM Studio or OpenCode.
  onChange: listener => {
    const handler = (_event, change) => listener(change);
    ipcRenderer.on('desktop:changed', handler);
    return () => ipcRenderer.off('desktop:changed', handler);
  },
}));
