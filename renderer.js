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
const statsPanel = document.getElementById('stats');
const countTotalSpan = document.getElementById('count-total');
const countMatchSpan = document.getElementById('count-match');
const scanProgress = document.getElementById('scan-progress');
const selectedCountSpan = document.getElementById('selected-count');
const tbody = document.getElementById('results-tbody');
const checkAll = document.getElementById('check-all');
const folderHint = document.getElementById('folder-hint');
const folderPathText = document.getElementById('folder-path-text');

let allFiles = []; // 全量缓存数据
let displayedFiles = []; // 当前过滤后显示的数据
let selectedPaths = new Set(); // 选中的文件路径

// 恢复上次扫描目录
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

        resetUI();
        statsPanel.style.display = 'block';
        window.electronAPI.startScan(folderPath);
    } catch (err) { console.error(err); }
});

function resetUI() {
    allFiles = [];
    displayedFiles = [];
    selectedPaths.clear();
    updateSelectionUI();
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">正在急速扫描和读取缓存中...</td></tr>';
}

// 接收主进程扫描数据
window.electronAPI.onScanResultsBatch((batch) => {
    allFiles.push(...batch);
    applyFilterAndRender();
});

window.electronAPI.onScanProgressTotal((total) => {
    countTotalSpan.textContent = total;
    scanProgress.value = (total % 100);
});

window.electronAPI.onScanFinished((finalTotal) => {
    countTotalSpan.textContent = finalTotal;
    scanProgress.value = 100;
    
    if (allFiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">未在所选文件夹中找到 DCM 文件</td></tr>';
    } else {
        applyFilterAndRender();
    }
});

// --- 过滤与渲染逻辑 ---
searchInput.addEventListener('input', applyFilterAndRender);
dateStartInput.addEventListener('change', applyFilterAndRender);
dateEndInput.addEventListener('change', applyFilterAndRender);

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
    // 如果没有中文或者解析失败，尝试保留有用字符即可
    return text;
}

function applyFilterAndRender() {
    const keyword = searchInput.value.toLowerCase().trim();
    const startDateStr = dateStartInput.value.replace(/-/g, ''); // "YYYYMMDD"
    const endDateStr = dateEndInput.value.replace(/-/g, '');     // "YYYYMMDD"
    
    displayedFiles = allFiles.filter(f => {
        const d = f.dicom || {};
        const studyDate = d.studyDate || '';
        
        // 1. 日期过滤
        if (startDateStr && studyDate < startDateStr) return false;
        if (endDateStr && studyDate > endDateStr) return false;
        
        // 2. 关键字过滤
        if (!keyword) return true;
        
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
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">没有符合条件的结果</td></tr>';
        return;
    } else if (allFiles.length === 0) {
        return; 
    }

    const fragment = document.createDocumentFragment();
    
    // 限制单次渲染数量防止卡顿 (虚拟列表最佳，这里暂且截取前500条)
    const limit = Math.min(displayedFiles.length, 500);
    
    for(let i = 0; i < limit; i++) {
        const file = displayedFiles[i];
        const d = file.dicom || {};
        
        const tr = document.createElement('tr');
        
        // 解析修正后的姓名与 SZYQ 代码
        const rawName = fixGarbledText(d.patientName || '');
        // 拆分逻辑：通常第一个词组是姓名，后面的是代码如 SZYQ021749
        const parts = rawName.split(/\s+/).filter(Boolean);
        let name1 = parts.length > 0 ? parts[0] : '-';
        let name2 = '-';
        if (parts.length > 1) {
            // 如果剩余部分有包含数字字母的较长字符串，就作为 name2
            const codeParts = parts.slice(1).filter(p => !['-','PX','px'].includes(p));
            if (codeParts.length > 0) name2 = codeParts.join(' ');
        }
        
        // 格式化数据
        const ageClean = d.patientAge ? d.patientAge.replace(/^0+/, '').replace(/[Yy]/g, '岁') : '-';
        const dateClean = d.studyDate ? d.studyDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '-';
        
        const isChecked = selectedPaths.has(file.path);

        tr.innerHTML = `
            <td class="checkbox-col">
                <label class="custom-checkbox">
                    <input type="checkbox" class="row-checkbox" data-path="${file.path}" ${isChecked ? 'checked' : ''}>
                    <span class="checkmark"></span>
                </label>
            </td>
            <td title="${name1}">${name1}</td>
            <td title="${name2}">${name2}</td>
            <td>${ageClean}</td>
            <td>${dateClean}</td>
            <td><span class="badge">${d.modality || 'DCM'}</span></td>
            <td>${d.bodyPart || '-'}</td>
        `;
        fragment.appendChild(tr);
    }

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    if (displayedFiles.length > limit) {
        const moreTr = document.createElement('tr');
        moreTr.innerHTML = `<td colspan="7" class="empty-state">... 还有 ${displayedFiles.length - limit} 条结果未显示，请使用全局搜索精确过滤 ...</td>`;
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
    
    // 全选/反选当前过滤后的文件
    displayedFiles.forEach(f => {
        if (isChecked) {
            selectedPaths.add(f.path);
        } else {
            selectedPaths.delete(f.path);
        }
    });
    
    // 更新视图中的checkbox
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = isChecked);
    
    updateSelectionUI();
});

function updateSelectionUI() {
    selectedCountSpan.textContent = selectedPaths.size;
    exportBtn.style.display = selectedPaths.size > 0 ? 'inline-flex' : 'none';
    
    // 更新 checkAll 状态
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
    resetUI();
});
