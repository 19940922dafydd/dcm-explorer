const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
    scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path)
});
