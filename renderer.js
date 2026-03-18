/**
 * DCM 资源管家 - Renderer Logic
 */

// DOM Elements
const selectFolderBtn = document.getElementById('select-folder-btn');
const dateStartInput = document.getElementById('date-start');
const dateEndInput = document.getElementById('date-end');
const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const statsPanel = document.getElementById('stats');
const countTotalSpan = document.getElementById('count-total');
const countMatchSpan = document.getElementById('count-match');
const scanProgress = document.getElementById('scan-progress');
const selectedCountSpan = document.getElementById('selected-count');
const tbody = document.getElementById('results-tbody');
const checkAll = document.getElementById('check-all');
const folderHint = document.getElementById('folder-hint');
const folderPathText = document.getElementById('folder-path-text');

let allFiles = []; // 全量列表
let displayedFiles = []; // 搜索过滤后的列表
let selectedPaths = new Set(); // 选中

// 恢复上次扫描目录显示路径
const lastFolder = localStorage.getItem('lastDicomFolder');
if (lastFolder) {
    folderHint.style.display = 'block';
    folderPathText.textContent = lastFolder;
}

// 启动扫描
selectFolderBtn.addEventListener('click', async () => {
    try {
        const folderPath = await window.electronAPI.selectFolder();
        if (!folderPath) return; // User cancelled
        
        localStorage.setItem('lastDicomFolder', folderPath);
        folderHint.style.display = 'block';
        folderPathText.textContent = folderPath;

        const startDateStr = dateStartInput.value;
        const endDateStr = dateEndInput.value;
        
        let startTs = 0;
        let endTs = Number.MAX_SAFE_INTEGER;
        
        if (startDateStr) startTs = new Date(`${startDateStr}T00:00:00`).getTime();
        if (endDateStr) endTs = new Date(`${endDateStr}T23:59:59.999`).getTime();

        resetUI();
        statsPanel.style.display = 'block';
        
        window.electronAPI.startScan({ rootPath: folderPath, startTs, endTs });
    } catch (err) { console.error(err); }
});

function resetUI() {
    allFiles = [];
    displayedFiles = [];
    selectedPaths.clear();
    updateSelectionUI();
    analyzeBtn.style.display = 'none';
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">正在精准检索时间范围的文件...</td></tr>';
}

// 接收主进程扫描数据
window.electronAPI.onScanResultsBatch((batch) => {
    allFiles.push(...batch);
    applyFilterAndRender();
});

window.electronAPI.onScanProgressTotal((total) => {
    scanProgress.value = (total % 100);
});

window.electronAPI.onScanFinished((finalTotal) => {
    countTotalSpan.textContent = finalTotal;
    scanProgress.value = 100;
    
    if (allFiles.length > 0) analyzeBtn.style.display = 'inline-flex';
    
    if (allFiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">未在所选文件夹及时间范围内找到 DCM 文件</td></tr>';
    } else {
        applyFilterAndRender();
    }
});

// 分析按钮点击
analyzeBtn.addEventListener('click', () => {
    if (displayedFiles.length === 0) return;
    
    const paths = displayedFiles.map(f => f.path);
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `<span class="icon">🔄</span> 分析中 (0/${paths.length})`;
    
    window.electronAPI.analyzeDicom(paths);
});

// 分析进度响应
window.electronAPI.onAnalyzeResultsBatch((batch) => {
    // 映射新的dicom数据
    const dicomMap = new Map();
    for(const item of batch) dicomMap.set(item.path, item.dicom);
    
    for(const file of allFiles) {
        if (dicomMap.has(file.path)) {
            file.dicom = dicomMap.get(file.path);
        }
    }
    
    renderTable(); // 局部刷新或者全量刷新
});

window.electronAPI.onAnalyzeFinished((totalAnalyzed) => {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = `<span class="icon">✅</span> 分析完成 (${totalAnalyzed})`;
});

// --- 过滤与渲染逻辑 ---
searchInput.addEventListener('input', applyFilterAndRender);
// 输入日期变化不再自动过滤，因为过滤交给了主进程在扫描时处理，前端仅做纯文本搜索

// 解码错误的GBK中文字符
function fixGarbledText(text) {
    if (!text) return '';
    try {
        let bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            bytes[i] = text.charCodeAt(i) & 0xFF;
        }
        let decoder = new TextDecoder('gbk');
        let decoded = decoder.decode(bytes);
        if (/[\u4e00-\u9fa5]/.test(decoded)) {
            return decoded;
        }
    } catch (e) {}
    return text;
}

function applyFilterAndRender() {
    const keyword = searchInput.value.toLowerCase().trim();
    
    displayedFiles = allFiles.filter(f => {
        if (!keyword) return true;
        
        const d = f.dicom || {};
        return (
            f.name.toLowerCase().includes(keyword) ||
            (d.patientName && d.patientName.toLowerCase().includes(keyword)) ||
            (d.patientId && d.patientId.toLowerCase().includes(keyword)) ||
            (d.modality && d.modality.toLowerCase().includes(keyword))
        );
    });

    countMatchSpan.textContent = displayedFiles.length;
    renderTable();
}

function renderTable() {
    if (displayedFiles.length === 0 && allFiles.length > 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">没有符合条件的结果</td></tr>';
        return;
    } else if (allFiles.length === 0) {
        return; 
    }

    const fragment = document.createDocumentFragment();
    const limit = Math.min(displayedFiles.length, 500);
    
    for(let i = 0; i < limit; i++) {
        const file = displayedFiles[i];
        const d = file.dicom; // may be undefined before analysis
        
        const tr = document.createElement('tr');
        
        let name1 = '-';
        let name2 = '-';
        let ageClean = '-';
        let modalityText = '-';
        let bodyPartText = '-';
        let rawName = '-';

        if (d) {
            rawName = fixGarbledText(d.patientName || '');
            const parts = rawName.split(/\s+/).filter(Boolean);
            name1 = parts.length > 0 ? parts[0] : '-';
            name2 = '-';
            if (parts.length > 1) {
                const codeParts = parts.slice(1).filter(p => !['-','PX','px'].includes(p));
                if (codeParts.length > 0) name2 = codeParts.join(' ');
            }
            ageClean = d.patientAge ? d.patientAge.replace(/^0+/, '').replace(/[Yy]/g, '岁') : '-';
            modalityText = d.modality || 'DCM';
            bodyPartText = d.bodyPart || '-';
        }

        const fileDateObj = new Date(file.lastModified);
        const y = fileDateObj.getFullYear();
        const m = String(fileDateObj.getMonth() + 1).padStart(2, '0');
        const day = String(fileDateObj.getDate()).padStart(2, '0');
        const h = String(fileDateObj.getHours()).padStart(2, '0');
        const min = String(fileDateObj.getMinutes()).padStart(2, '0');
        const dateClean = `${y}-${m}-${day} ${h}:${min}`;
        
        const isChecked = selectedPaths.has(file.path);

        tr.innerHTML = `
            <td class="checkbox-col">
                <label class="custom-checkbox">
                    <input type="checkbox" class="row-checkbox" data-path="${file.path}" ${isChecked ? 'checked' : ''}>
                    <span class="checkmark"></span>
                </label>
            </td>
            <td title="${file.name}">${file.name}</td>
            <td title="${name1}">${name1}</td>
            <td title="${name2}">${name2}</td>
            <td>${ageClean}</td>
            <td>${dateClean}</td>
            <td>${d ? `<span class="badge">${modalityText}</span>` : modalityText}</td>
            <td>${bodyPartText}</td>
        `;
        fragment.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    if (displayedFiles.length > limit) {
        const moreTr = document.createElement('tr');
        moreTr.innerHTML = `<td colspan="8" class="empty-state">... 还有 ${displayedFiles.length - limit} 条结果未显示，请使用全局搜索精确过滤 ...</td>`;
        tbody.appendChild(moreTr);
    }
    
    bindRowEvents();
    updateSelectionUI();
}

// --- 选择逻辑 ---
function bindRowEvents() {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const path = e.target.getAttribute('data-path');
            if (e.target.checked) {
                selectedPaths.add(path);
            } else {
                selectedPaths.delete(path);
            }
            updateSelectionUI();
        });
    });
}

checkAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    
    displayedFiles.forEach(f => {
        if (isChecked) selectedPaths.add(f.path);
        else selectedPaths.delete(f.path);
    });
    
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = isChecked);
    updateSelectionUI();
});

function updateSelectionUI() {
    selectedCountSpan.textContent = selectedPaths.size;
    exportBtn.style.display = selectedPaths.size > 0 ? 'inline-flex' : 'none';
    
    if (displayedFiles.length > 0 && selectedPaths.size >= displayedFiles.length) {
        checkAll.checked = true;
    } else {
        checkAll.checked = false;
    }
}

// --- 导出逻辑 ---
exportBtn.addEventListener('click', async () => {
    if (selectedPaths.size === 0) return;

    const targetFolder = await window.electronAPI.selectFolder();
    if (!targetFolder) return;

    exportBtn.disabled = true;
    const pathsArray = Array.from(selectedPaths);
    exportBtn.innerHTML = `📤 导出中... (0/${pathsArray.length})`;

    const startTime = Date.now();
    try {
        const result = await window.electronAPI.exportFiles({
            filePaths: pathsArray,
            targetFolder: targetFolder
        });
        alert(`导出完成！\n成功: ${result.success} 个\n失败: ${result.fail} 个\n耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    } catch (err) {
        alert('导出过程发生错误: ' + err.message);
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = `📤 导出选中项 (<span id="selected-count">${selectedPaths.size}</span>)`;
    }
});

window.electronAPI.onExportProgress(({ current, total }) => {
    exportBtn.innerHTML = `📤 导出中... (${current}/${total})`;
});

clearBtn.addEventListener('click', () => {
    window.electronAPI.stopScan();
    localStorage.removeItem('lastDicomFolder');
    folderHint.style.display = 'none';
    statsPanel.style.display = 'none';
    searchInput.value = '';
    analyzeBtn.style.display = 'none';
    resetUI();
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">尚未选择文件夹，点击上方按钮开始探索</td></tr>';
});
