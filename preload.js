const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
    startScan: (path) => ipcRenderer.send('start-scan', path),
    stopScan: () => ipcRenderer.send('stop-scan'),
    readFile: (path) => ipcRenderer.invoke('read-file', path),

    onScanProgressTotal: (callback) => ipcRenderer.on('scan-progress-total', (event, count) => callback(count)),
    onScanResultsBatch: (callback) => ipcRenderer.on('scan-results-batch', (event, batch) => callback(batch)),
    onScanFinished: (callback) => ipcRenderer.on('scan-finished', (event, total) => callback(total)),
    exportFiles: (data) => ipcRenderer.invoke('export-files', data),
    onExportProgress: (callback) => ipcRenderer.on('export-progress', (event, data) => callback(data)),
    analyzeDicom: (paths) => ipcRenderer.send('analyze-dicom', paths),
    onAnalyzeResultsBatch: (callback) => ipcRenderer.on('analyze-results-batch', (event, batch) => callback(batch)),
    onAnalyzeFinished: (callback) => ipcRenderer.on('analyze-finished', (event, total) => callback(total))
});
