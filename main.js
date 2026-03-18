const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dicomParser = require('dicom-parser');

// --- Caching System ---
let CACHE_FILE;
let globalCache = {};

function initCache() {
    CACHE_FILE = path.join(app.getPath('userData'), 'dicom_cache.json');
    try {
        if (fs.existsSync(CACHE_FILE)) {
            globalCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to read cache:', e);
        globalCache = {};
    }
}

function saveCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(globalCache), 'utf8');
    } catch (e) {
        console.error('Failed to save cache:', e);
    }
}

async function parseDicomFile(filePath) {
    try {
        // Read the first 512KB for performance
        const fd = await fs.promises.open(filePath, 'r');
        const chunkSize = 512 * 1024;
        const buf = Buffer.alloc(chunkSize);
        const { bytesRead } = await fd.read(buf, 0, chunkSize, 0);
        await fd.close();

        let dataSet;
        try {
            dataSet = dicomParser.parseDicom(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
        } catch (err) {
            // Fallback to reading full file
            const fullBuf = await fs.promises.readFile(filePath);
            dataSet = dicomParser.parseDicom(new Uint8Array(fullBuf.buffer, fullBuf.byteOffset, fullBuf.length));
        }

        const getStr = (tag) => {
            try { return dataSet.string(tag) || ''; } catch(e) { return ''; }
        };

        return {
            patientName: getStr('x00100010').replace(/\^/g, ' ').trim(),
            patientId: getStr('x00100020').trim(),
            patientSex: getStr('x00100040').trim(),
            patientAge: getStr('x00101010').trim(),
            studyDate: getStr('x00080020').trim(),
            modality: getStr('x00080060').trim(),
            bodyPart: getStr('x00180015').trim(),
            institution: getStr('x00080080').trim()
        };
    } catch (e) {
        return null;
    }
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
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

app.whenReady().then(() => {
    initCache();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
});

// --- Core Scanning Logic with Cache ---
let isCancelled = false;

ipcMain.on('start-scan', async (event, rootPath) => {
    isCancelled = false;
    
    // Check if the directory is already fully cached
    if (globalCache[rootPath]) {
        const cachedFiles = Object.values(globalCache[rootPath]);
        const BATCH_SIZE = 100;
        for (let i = 0; i < cachedFiles.length; i += BATCH_SIZE) {
            if (isCancelled) break;
            mainWindow.webContents.send('scan-results-batch', cachedFiles.slice(i, i + BATCH_SIZE));
            await new Promise(resolve => setTimeout(resolve, 10)); // Prevent blocking UI
        }
        mainWindow.webContents.send('scan-finished', cachedFiles.length);
        return;
    }

    // New directory: Start full scan and build cache
    globalCache[rootPath] = {};
    let batch = [];
    let totalScanned = 0;
    const BATCH_SIZE = 50;
    const CONCURRENCY = 8;
    let promiseQueue = [];

    async function processFile(fullPath, entryName) {
        try {
            const stats = await fs.promises.stat(fullPath);
            const dicomData = await parseDicomFile(fullPath);
            
            const fileData = {
                name: entryName,
                path: fullPath,
                lastModified: stats.mtimeMs,
                size: stats.size,
                dicom: dicomData || {}
            };

            globalCache[rootPath][fullPath] = fileData;
            batch.push(fileData);

            if (batch.length >= BATCH_SIZE) {
                const currentBatch = [...batch];
                batch = [];
                mainWindow.webContents.send('scan-results-batch', currentBatch);
            }
        } catch (e) {
            // file access error, just skip
        }
    }

    async function walk(currentPath) {
        if (isCancelled) return;
        try {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                if (isCancelled) return;
                const fullPath = path.join(currentPath, entry.name);
                
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    totalScanned++;
                    if (totalScanned % 500 === 0) mainWindow.webContents.send('scan-progress-total', totalScanned);

                    if (entry.name.toLowerCase().endsWith('.dcm')) {
                        const p = processFile(fullPath, entry.name);
                        promiseQueue.push(p);

                        if (promiseQueue.length >= CONCURRENCY) {
                            await Promise.all(promiseQueue);
                            promiseQueue = [];
                        }
                    }
                }
            }
        } catch (e) { }
    }

    await walk(rootPath);
    if (promiseQueue.length > 0) {
        await Promise.all(promiseQueue);
    }
    if (batch.length > 0) {
        mainWindow.webContents.send('scan-results-batch', batch);
    }
    
    saveCache();
    mainWindow.webContents.send('scan-finished', totalScanned);
});

ipcMain.on('stop-scan', () => { isCancelled = true; });

// --- Multi-select Export Logic ---
ipcMain.handle('export-files', async (event, { filePaths, targetFolder }) => {
    let successCount = 0;
    let failCount = 0;

    for (const filePath of filePaths) {
        try {
            const fileName = path.basename(filePath);
            const destPath = path.join(targetFolder, fileName);
            let uniquePath = destPath;
            
            if (fs.existsSync(destPath)) {
                const ext = path.extname(fileName);
                const name = path.basename(fileName, ext);
                uniquePath = path.join(targetFolder, `${name}_${Date.now()}${ext}`);
            }

            await fs.promises.copyFile(filePath, uniquePath);
            successCount++;

            if (successCount % 10 === 0) {
                mainWindow.webContents.send('export-progress', { current: successCount, total: filePaths.length });
            }
        } catch (err) {
            console.error('Copy failed:', filePath, err);
            failCount++;
        }
    }
    return { success: successCount, fail: failCount };
});

// --- Read file for renderer preview ---
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const buf = await fs.promises.readFile(filePath);
        return buf;
    } catch(e) {
        throw e;
    }
});
