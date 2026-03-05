/**
 * DCM 资源管家 - 极致性能 16TB 优化版
 * 实现分批渲染与实时统计反馈，确保极度流畅的用户体验
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

let allFiles = []; // 大列表存储所有 DCM 元数据
let totalScannedCount = 0;

selectFolderBtn.addEventListener('click', async () => {
    try {
        const folderPath = await window.electronAPI.selectFolder();
        if (!folderPath) return;

        // 1. 初始化 UI
        resetUI();
        statsPanel.style.display = 'block';

        // 2. 发起异步扫描
        console.log('正在开启大规模扫描流程...', folderPath);
        window.electronAPI.startScan(folderPath);

    } catch (err) {
        console.error('选择目录出错:', err);
    }
});

// 核心优化：监听分批数据
window.electronAPI.onScanResultsBatch((batch) => {
    // 增加数据到内存池
    allFiles.push(...batch);

    // 实时更新统计
    countMatchSpan.textContent = allFiles.length;

    // 只渲染部分结果，避免 DOM 过载 (如果超过1000个，我们建议限制初次渲染或使用虚拟滚动)
    // 这里的策略是：按时间范围筛选并增量渲染前 500 个，更多的可以后续动态展示
    updateResults();
});

// 监听扫描进度
window.electronAPI.onScanProgressTotal((total) => {
    countTotalSpan.textContent = total;
    scanProgress.value = (total % 100); // 进度动画反馈
});

// 监听扫描结束
window.electronAPI.onScanFinished((finalTotal) => {
    countTotalSpan.textContent = finalTotal;
    scanProgress.value = 100;
    console.log('全盘扫描结束，总计扫描文件:', finalTotal);
});

function updateResults() {
    const startVal = dateStartInput.valueAsNumber;
    const endVal = dateEndInput.valueAsNumber;

    // 快速过滤
    const filtered = allFiles.filter(f => {
        const fileTime = new Date(f.lastModified).setHours(0, 0, 0, 0);
        if (!isNaN(startVal) && fileTime < startVal) return false;
        if (!isNaN(endVal) && fileTime > endVal) return false;
        return true;
    });

    countMatchSpan.textContent = filtered.length;

    // 绘制结果（仅渲染前 200 个，防止浏览器绘图线程卡死）
    // 对于 16TB 的万级数据，建议采用这种截断查看模式或引入 Virtual List
    renderFileList(filtered.slice(0, 200), filtered.length > 200);
}

function renderFileList(list, hasMore) {
    if (list.length === 0 && allFiles.length === 0) {
        resultsList.innerHTML = '<div class="empty-state"><p>正在等待全盘数据流...</p></div>';
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
                <p style="word-break: break-all; color: #64748b;">${file.path}</p>
                <p>修改时间: ${dateStr} | 大小: ${sizeStr}</p>
            </div>
            <span class="tag">DCM</span>
        `;
        fragment.appendChild(card);
    });

    if (hasMore) {
        const moreTag = document.createElement('div');
        moreTag.style.textAlign = 'center';
        moreTag.style.padding = '1rem';
        moreTag.style.color = '#94a3b8';
        moreTag.innerHTML = `<em>... 还有 ${allFiles.length - 200} 个匹配文件，请通过上方缩小日期范围查看精细结果 ...</em>`;
        fragment.appendChild(moreTag);
    }

    resultsList.innerHTML = '';
    resultsList.appendChild(fragment);
}

// 监听日期变化实时筛选
dateStartInput.addEventListener('change', updateResults);
dateEndInput.addEventListener('change', updateResults);

function resetUI() {
    allFiles = [];
    resultsList.innerHTML = '<div class="empty-state"><p>已开启大规模全盘检索，请耐心等候第一批结果...</p></div>';
    countTotalSpan.textContent = '0';
    countMatchSpan.textContent = '0';
    scanProgress.value = 0;
}

clearBtn.addEventListener('click', () => {
    window.electronAPI.stopScan(); // 先停止后台扫描
    resetUI();
    statsPanel.style.display = 'none';
    resultsList.innerHTML = '<div class="empty-state"><p>列表已清空，并已停止后台扫描</p></div>';
});
