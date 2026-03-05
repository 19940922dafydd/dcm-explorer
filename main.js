const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "DCM 资源管家",
        icon: path.join(__dirname, 'icon.ico'), // 可选
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        backgroundColor: '#0f172a' // 匹配网页背景色，防止闪烁
    });

    win.loadFile('index.html');
    // win.webContents.openDevTools(); // 调试时开启
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// 处理打开文件夹的请求
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (canceled) {
        return null;
    } else {
        return filePaths[0];
    }
});

// 递归递归文件并在后端处理（效率更高）
ipcMain.handle('scan-directory', async (event, rootPath) => {
    const results = [];

    async function traverse(currentPath) {
        const files = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(currentPath, file.name);
            if (file.isDirectory()) {
                await traverse(fullPath);
            } else if (file.name.toLowerCase().endsWith('.dcm')) {
                const stats = fs.statSync(fullPath);
                results.push({
                    name: file.name,
                    path: fullPath,
                    lastModified: stats.mtimeMs,
                    size: stats.size
                });
            }
        }
    }

    try {
        await traverse(rootPath);
        return results;
    } catch (err) {
        console.error(err);
        throw err;
    }
});
