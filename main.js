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

// 优化后的扫描函数：分批发送数据，防止卡死
ipcMain.on('start-scan', async (event, rootPath) => {
    let batch = [];
    const BATCH_SIZE = 50; // 每找到50个DCM文件发一次包
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
                    // 每扫1000个文件更新一次“已扫描”总数，给用户反馈
                    if (totalScanned % 1000 === 0) {
                        mainWindow.webContents.send('scan-progress-total', totalScanned);
                    }

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
                                // 稍微给主线程留一点喘息时间，防止界面假死
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }
                        } catch (e) { /* 忽略单个文件读取错误 */ }
                    }
                }
            }
        } catch (e) {
            console.error('无法访问目录:', currentPath);
        }
    }

    await walk(rootPath);

    // 发送最后一批
    if (batch.length > 0) {
        mainWindow.webContents.send('scan-results-batch', batch);
    }
    mainWindow.webContents.send('scan-finished', totalScanned);
});

// 监听取消信号
ipcMain.on('stop-scan', () => {
    isCancelled = true;
});
