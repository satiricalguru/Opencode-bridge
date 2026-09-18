const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  request: value => ipcRenderer.invoke('desktop:request', value),
}));
