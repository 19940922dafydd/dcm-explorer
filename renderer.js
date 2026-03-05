/**
 * DCM 资源管家 - 增强版逻辑
 * 1. 修复日期筛选（包含首尾、支持单日筛选）
 * 2. 新增导出功能
 */

const selectFolderBtn = document.getElementById('select-folder-btn');
const resultsList = document.getElementById('results-list');
const dateStartInput = document.getElementById('date-start');
const dateEndInput = document.getElementById('date-end');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');
const statsPanel = document.getElementById('stats');
const countTotalSpan = document.getElementById('count-total');
const countMatchSpan = document.getElementById('count-match');
const scanProgress = document.getElementById('scan-progress');

let allFiles = []; // 原始数据池
let currentFilteredFiles = []; // 经过日期筛选后的数据

selectFolderBtn.addEventListener('click', async () => {
    try {
        const folderPath = await window.electronAPI.selectFolder();
        if (!folderPath) return;
        resetUI();
        statsPanel.style.display = 'block';
        window.electronAPI.startScan(folderPath);
    } catch (err) { console.error(err); }
});

// 监听扫描
window.electronAPI.onScanResultsBatch((batch) => {
    allFiles.push(...batch);
    updateResults();
});

window.electronAPI.onScanProgressTotal((total) => {
    countTotalSpan.textContent = total;
    scanProgress.value = (total % 100);
});

window.electronAPI.onScanFinished((finalTotal) => {
    countTotalSpan.textContent = finalTotal;
    scanProgress.value = 100;
});

// --- 修复日期筛选逻辑 ---
function updateResults() {
    const startDate = dateStartInput.value; // "YYYY-MM-DD"
    const endDate = dateEndInput.value;     // "YYYY-MM-DD"

    currentFilteredFiles = allFiles.filter(file => {
        // 获取本地时间字符串 YYYY-MM-DD
        const dateObj = new Date(file.lastModified);
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const fileDateStr = `${y}-${m}-${d}`;

        let isMatch = true;
        if (startDate && fileDateStr < startDate) isMatch = false;
        if (endDate && fileDateStr > endDate) isMatch = false;

        return isMatch;
    });

    countMatchSpan.textContent = currentFilteredFiles.length;

    // 显示/隐藏导出按钮
    exportBtn.style.display = currentFilteredFiles.length > 0 ? 'inline-flex' : 'none';

    renderFileList(currentFilteredFiles.slice(0, 300), currentFilteredFiles.length > 300);
}

// --- 导出功能实现 ---
exportBtn.addEventListener('click', async () => {
    if (currentFilteredFiles.length === 0) return;

    // 1. 选择目标文件夹
    const targetFolder = await window.electronAPI.selectFolder();
    if (!targetFolder) return;

    // 2. 更改按钮状态
    exportBtn.disabled = true;
    exportBtn.textContent = '正在准备导出...';

    // 3. 调用导出
    const startTime = Date.now();
    try {
        const result = await window.electronAPI.exportFiles({
            fileList: currentFilteredFiles,
            targetFolder: targetFolder
        });

        alert(`导出完成！\n成功: ${result.success} 个\n失败: ${result.fail} 个\n耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    } catch (err) {
        alert('导出过程发生错误: ' + err.message);
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '📤 导出结果';
    }
});

// 监听导出进度
window.electronAPI.onExportProgress(({ current, total }) => {
    exportBtn.textContent = `导出中... (${current}/${total})`;
});

function renderFileList(list, hasMore) {
    if (list.length === 0 && allFiles.length === 0) {
        resultsList.innerHTML = '<div class="empty-state"><p>正在扫描磁盘...</p></div>';
        return;
    }
    if (list.length === 0) {
        resultsList.innerHTML = '<div class="empty-state"><p>根据当前日期筛选未找到文件</p></div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach((file, index) => {
        const card = document.createElement('div');
        card.className = 'file-card';
        card.style.animationDelay = `${(index % 20) * 0.02}s`;
        const dateStr = new Date(file.lastModified).toLocaleString('zh-CN');
        const sizeStr = (file.size / 1024 / 1024).toFixed(2) + ' MB';

        card.innerHTML = `
            <div class="file-info">
                <h4>${file.name}</h4>
                <p style="word-break: break-all; color: #64748b; font-size: 0.75rem;">${file.path}</p>
                <p>日期: ${dateStr} | 大小: ${sizeStr}</p>
            </div>
            <span class="tag">DCM</span>
        `;
        fragment.appendChild(card);
    });

    resultsList.innerHTML = '';
    resultsList.appendChild(fragment);
    if (hasMore) {
        const more = document.createElement('p');
        more.className = 'empty-state';
        more.style.padding = '1rem';
        more.innerHTML = `... 还有 ${currentFilteredFiles.length - 300} 个匹配文件尚未在预览中显示 ...`;
        resultsList.appendChild(more);
    }
}

dateStartInput.addEventListener('change', updateResults);
dateEndInput.addEventListener('change', updateResults);

function resetUI() {
    allFiles = [];
    currentFilteredFiles = [];
    resultsList.innerHTML = '<div class="empty-state"><p>正在启动全盘检索...</p></div>';
    exportBtn.style.display = 'none';
}

clearBtn.addEventListener('click', () => {
    window.electronAPI.stopScan();
    resetUI();
    statsPanel.style.display = 'none';
});
