const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 850,
        title: "DCM 资源管家",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
});

// --- 核心扫描逻辑 ---
ipcMain.on('start-scan', async (event, rootPath) => {
    let batch = [];
    const BATCH_SIZE = 50;
    let totalScanned = 0;
    let isCancelled = false;

    async function walk(currentPath) {
        if (isCancelled) return;
        try {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    totalScanned++;
                    if (totalScanned % 1000 === 0) mainWindow.webContents.send('scan-progress-total', totalScanned);

                    if (entry.name.toLowerCase().endsWith('.dcm')) {
                        try {
                            const stats = await fs.promises.stat(fullPath);
                            batch.push({
                                name: entry.name,
                                path: fullPath,
                                lastModified: stats.mtimeMs,
                                size: stats.size
                            });

                            if (batch.length >= BATCH_SIZE) {
                                mainWindow.webContents.send('scan-results-batch', batch);
                                batch = [];
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }
                        } catch (e) { }
                    }
                }
            }
        } catch (e) { }
    }

    await walk(rootPath);
    if (batch.length > 0) mainWindow.webContents.send('scan-results-batch', batch);
    mainWindow.webContents.send('scan-finished', totalScanned);
});

ipcMain.on('stop-scan', () => { isCancelled = true; });

// --- 新增：批量导出/拷贝逻辑 ---
ipcMain.handle('export-files', async (event, { fileList, targetFolder }) => {
    let successCount = 0;
    let failCount = 0;

    for (const file of fileList) {
        try {
            const destPath = path.join(targetFolder, file.name);
            // 如果文件名冲突，自动重命名防止覆盖
            let uniquePath = destPath;
            if (fs.existsSync(destPath)) {
                const ext = path.extname(file.name);
                const name = path.basename(file.name, ext);
                uniquePath = path.join(targetFolder, `${name}_${Date.now()}${ext}`);
            }

            await fs.promises.copyFile(file.path, uniquePath);
            successCount++;

            // 每拷贝10个通知一次进度
            if (successCount % 10 === 0) {
                mainWindow.webContents.send('export-progress', { current: successCount, total: fileList.length });
            }
        } catch (err) {
            console.error('拷贝失败:', file.path, err);
            failCount++;
        }
    }
    return { success: successCount, fail: failCount };
});
