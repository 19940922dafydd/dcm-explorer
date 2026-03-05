const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
    startScan: (path) => ipcRenderer.send('start-scan', path),
    stopScan: () => ipcRenderer.send('stop-scan'),
    exportFiles: (data) => ipcRenderer.invoke('export-files', data),

    onScanProgressTotal: (callback) => ipcRenderer.on('scan-progress-total', (event, count) => callback(count)),
    onScanResultsBatch: (callback) => ipcRenderer.on('scan-results-batch', (event, batch) => callback(batch)),
    onScanFinished: (callback) => ipcRenderer.on('scan-finished', (event, total) => callback(total)),
    onExportProgress: (callback) => ipcRenderer.on('export-progress', (event, data) => callback(data))
});
