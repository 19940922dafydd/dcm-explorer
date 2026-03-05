/**
 * DCM 资源管家 - 渲染进程逻辑 (Renderer)
 * 使用通过 preload.js 暴露的 electronAPI 进行操作
 */

const selectFolderBtn = document.getElementById('select-folder-btn');
const resultsList = document.getElementById('results-list');
const dateStartInput = document.getElementById('date-start');
const dateEndInput = document.getElementById('date-end');
const clearBtn = document.getElementById('clear-btn');
const statsPanel = document.getElementById('stats');
const countTotalSpan = document.getElementById('count-total');
const countMatchSpan = document.getElementById('count-match');
const scanProgress = document.getElementById('scan-progress');

let allFiles = []; // 存储所有找到的文件数据

selectFolderBtn.addEventListener('click', async () => {
    try {
        // 1. 调用原生对话框选择目录
        const folderPath = await window.electronAPI.selectFolder();
        if (!folderPath) return; // 用户取消

        // 2. 更新 UI 状态
        resetUI();
        statsPanel.style.display = 'block';

        // 3. 调用主进程进行高效文件扫描
        console.log('正在扫描文件夹:', folderPath);
        const startTime = Date.now();

        const filesFound = await window.electronAPI.scanDirectory(folderPath);

        console.log(`扫描完成！共耗时 ${Date.now() - startTime}ms，找到 ${filesFound.length} 个 DCM 文件。`);

        // 4. 处理数据并显示
        allFiles = filesFound.map(f => ({
            ...f,
            dateObj: new Date(f.lastModified)
        }));

        updateResults();

    } catch (err) {
        console.error('扫描失败:', err);
        alert('文件系统扫描出现错误: ' + err.message);
    }
});

function updateResults() {
    const startVal = dateStartInput.valueAsNumber;
    const endVal = dateEndInput.valueAsNumber;

    // 筛选逻辑
    const filtered = allFiles.filter(file => {
        let isDateMatch = true;
        const fileDay = new Date(file.lastModified).setHours(0, 0, 0, 0);

        if (!isNaN(startVal)) {
            if (fileDay < startVal) isDateMatch = false;
        }
        if (!isNaN(endVal)) {
            if (fileDay > endVal) isDateMatch = false;
        }
        return isDateMatch;
    });

    // 更新统计
    countTotalSpan.textContent = allFiles.length;
    countMatchSpan.textContent = filtered.length;
    scanProgress.value = 100;

    // 渲染列表
    renderFileList(filtered);
}

function renderFileList(list) {
    if (list.length === 0) {
        resultsList.innerHTML = '<div class="empty-state"><p>未找到符合条件的 DCM 文件</p></div>';
        return;
    }

    resultsList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    list.forEach((file, index) => {
        const card = document.createElement('div');
        card.className = 'file-card';
        card.style.animationDelay = `${Math.min(index * 0.02, 1)}s`; // 防止大量文件导致动画延迟过长

        const dateStr = new Date(file.lastModified).toLocaleString('zh-CN');
        const sizeStr = (file.size / 1024 / 1024).toFixed(2) + ' MB';

        card.innerHTML = `
            <div class="file-info">
                <h4>${file.name}</h4>
                <p style="word-break: break-all;">路径: ${file.path}</p>
                <p>修改时间: ${dateStr} | 大小: ${sizeStr}</p>
            </div>
            <span class="tag">DCM</span>
        `;
        fragment.appendChild(card);
    });

    resultsList.appendChild(fragment);
}

// 监听日期变化实时筛选
dateStartInput.addEventListener('change', updateResults);
dateEndInput.addEventListener('change', updateResults);

// 重置与清空
function resetUI() {
    resultsList.innerHTML = '<div class="empty-state"><p>正在扫描本地文件系统...</p></div>';
    countTotalSpan.textContent = '0';
    countMatchSpan.textContent = '0';
    scanProgress.value = 0;
}

clearBtn.addEventListener('click', () => {
    allFiles = [];
    resetUI();
    statsPanel.style.display = 'none';
    resultsList.innerHTML = '<div class="empty-state"><p>列表已清空</p></div>';
});
