import { $, $$ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { getActiveTabConnection } from './TabManager.js';
import { trackWrite } from './CostTracker.js';

const dom = {
    dataViewer: $('#data-viewer'),
    tableView: $('#table-view'),
    jsonView: $('#json-view'),
    dataThead: $('#data-thead'),
    dataTbody: $('#data-tbody'),
    jsonContent: $('#json-content'),
    viewTableBtn: $('#view-table-btn'),
    viewJsonBtn: $('#view-json-btn'),
    welcomeState: $('#welcome-state'),
    emptyState: $('#empty-data-state'),
    loadingState: $('#loading-state'),
    tableInfoBar: $('#table-info-bar'),
    tableName: $('#current-table-name'),
    toolbar: $('#toolbar'),
    tableItemCount: $('#table-item-count'),
    schemaInfo: $('#table-schema-info'),

    // Toolbar premium actions
    exportJsonBtn: $('#export-json-btn'),
    exportCsvBtn: $('#export-csv-btn'),
    refreshTableBtn: $('#refresh-table-btn'),
    searchInput: $('#table-search-input')
};

// ─── Sort, drag, resize & inline-edit state ─────────────────────────────────
let sortCol    = null;
let sortDir    = null; // 'asc' | 'desc' | null
let dragSrcIdx = null;
// colWidths: Map<colName, px> — persists across re-renders within the same table
let colWidths  = {};
// lastSorted: shallow copy of current sorted items (updated each renderTableView)
let lastSorted = [];

export function initDataViewer() {
    if (dom.viewTableBtn) {
        dom.viewTableBtn.addEventListener('click', () => {
            state.viewMode = 'table';
            dom.viewTableBtn.classList.add('active');
            dom.viewJsonBtn.classList.remove('active');
            $('#view-chart-btn')?.classList.remove('active');
            $('#chart-view')?.classList.add('hidden');
            renderData();
        });
    }

    if (dom.viewJsonBtn) {
        dom.viewJsonBtn.addEventListener('click', () => {
            state.viewMode = 'json';
            dom.viewJsonBtn.classList.add('active');
            dom.viewTableBtn.classList.remove('active');
            $('#view-chart-btn')?.classList.remove('active');
            $('#chart-view')?.classList.add('hidden');
            renderData();
        });
    }

    document.addEventListener('renderDataRequest', () => {
        const term = dom.searchInput ? dom.searchInput.value.toLowerCase() : '';
        if (term) filterAndRender(term);
        else renderData();
    });

    document.addEventListener('resetDataViewerRequest', () => {
        resetDataViewer();
    });

    document.addEventListener('reloadTableInfoRequest', async () => {
        if (!state.currentTable) return;
        try {
            const { table } = await api('GET', `/tables/${state.currentTable}`);
            state.tableInfo = table;
            renderTableInfo(table);
            // Update active tab cache
            const activeTab = (await import('../state/store.js')).state.tabs
                .find(t => t.id === state.activeTabId);
            if (activeTab) activeTab.tableInfo = table;
        } catch (err) { /* silent */ }
    });

    // GSI delete via event delegation on schema-info bar
    dom.schemaInfo.addEventListener('click', (e) => {
        const btn = e.target.closest('.gsi-delete-btn');
        if (!btn) return;
        const indexName = btn.dataset.gsi;
        document.dispatchEvent(new CustomEvent('deleteGsiRequest', { detail: { indexName } }));
    });

    // Export & Refresh
    if (dom.exportJsonBtn) dom.exportJsonBtn.addEventListener('click', () => openExportModal('json'));
    if (dom.exportCsvBtn) dom.exportCsvBtn.addEventListener('click', () => openExportModal('csv'));
    initExportModal();
    if (dom.refreshTableBtn) {
        dom.refreshTableBtn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
        });
    }

    // Search
    if (dom.searchInput) {
        dom.searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            filterAndRender(term);
        });
    }

    // Inline cell editing — event delegation (double-click on data cells)
    dom.dataTbody?.addEventListener('dblclick', handleCellDblClick);
}

export function resetDataViewer() {
    dom.welcomeState.classList.remove('hidden');
    dom.tableInfoBar.classList.add('hidden');
    dom.toolbar.classList.add('hidden');
    dom.dataViewer.classList.add('hidden');
    dom.emptyState.classList.add('hidden');
    dom.loadingState.classList.add('hidden');
    state.currentTable = null;
    state.items = [];
    state.allColumns = [];
    sortCol   = null;
    sortDir   = null;
    colWidths = {};
    if (dom.searchInput) dom.searchInput.value = '';
    const pc = $('#pagination-controls');
    if (pc) pc.classList.add('hidden');
    const ri = $('#result-info');
    if (ri) ri.textContent = '';
}

export async function selectTable(name) {
    state.currentTable = name;
    state.items = [];
    state.allColumns = [];
    state.lastEvaluatedKey = null;
    colWidths = {};

    dom.welcomeState.classList.add('hidden');
    dom.emptyState.classList.add('hidden');
    dom.dataViewer.classList.add('hidden');
    dom.loadingState.classList.remove('hidden');
    dom.tableInfoBar.classList.remove('hidden');
    dom.toolbar.classList.remove('hidden');
    dom.tableName.textContent = name;

    try {
        const { table } = await api('GET', `/tables/${name}`);
        state.tableInfo = table;
        renderTableInfo(table);
        
        document.dispatchEvent(new CustomEvent('populateQueryFieldsRequest', { detail: { table } }));
        document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
        dom.loadingState.classList.add('hidden');
    }
}

function renderTableInfo(table) {
    const keySchema = table.KeySchema || [];
    const attrDefs = table.AttributeDefinitions || [];
    const count = table.ItemCount || 0;

    dom.tableItemCount.textContent = `${count.toLocaleString()} items`;

    const tags = keySchema.map((k) => {
        const attrDef = attrDefs.find((a) => a.AttributeName === k.AttributeName);
        const type = attrDef ? attrDef.AttributeType : '?';
        const keyLabel = k.KeyType === 'HASH' ? 'PK' : 'SK';
        return `<span class="schema-tag"><span class="key-type">${keyLabel}</span>${k.AttributeName} <span style="color:var(--text-muted)">(${type})</span></span>`;
    });

    const gsis = table.GlobalSecondaryIndexes || [];
    gsis.forEach((gsi) => {
        const gsiPk = gsi.KeySchema?.find(k => k.KeyType === 'HASH')?.AttributeName || '';
        const gsiSk = gsi.KeySchema?.find(k => k.KeyType === 'RANGE')?.AttributeName;
        const status = gsi.IndexStatus || 'ACTIVE';
        const statusClass = status === 'ACTIVE' ? '' : ' gsi-creating';
        const keyInfo = gsiSk ? `${gsiPk} / ${gsiSk}` : gsiPk;
        tags.push(`<span class="schema-tag gsi-tag${statusClass}" title="GSI: ${gsi.IndexName} | Keys: ${keyInfo} | Projection: ${gsi.Projection?.ProjectionType || 'ALL'}">
            <span class="key-type">GSI</span>${gsi.IndexName}
            <span class="gsi-keys">${keyInfo}</span>
            ${status !== 'ACTIVE' ? `<span class="gsi-status">${status}</span>` : ''}
            <button class="gsi-delete-btn" data-gsi="${gsi.IndexName}" title="Delete GSI">✕</button>
        </span>`);
    });

    dom.schemaInfo.innerHTML = tags.join('');
}

export function renderData(itemsToRender = state.items) {
    if (state.viewMode === 'table') {
        renderTableView(itemsToRender);
        dom.tableView.classList.remove('hidden');
        dom.jsonView.classList.add('hidden');
    } else {
        renderJsonView(itemsToRender);
        dom.jsonView.classList.remove('hidden');
        dom.tableView.classList.add('hidden');
    }
}

function filterAndRender(term) {
    if (!state.items) return;
    const filtered = state.items.filter(item => {
        return JSON.stringify(item).toLowerCase().includes(term);
    });
    renderData(filtered);
}

function getSortedItems(items) {
    if (!sortCol || !sortDir) return items;
    const sorted = [...items];
    sorted.sort((a, b) => {
        const va = a[sortCol], vb = b[sortCol];
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
        const sa = String(va), sb = String(vb);
        const cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
}

function renderTableView(items = state.items) {
    const keyNames = getKeyNames();
    const sorted = getSortedItems(items);
    lastSorted = sorted;

    // ── thead with sort indicators + drag-and-drop ──
    let thead = '<tr>';
    thead += '<th style="width:80px">Actions</th>';
    state.allColumns.forEach((col, colIdx) => {
        const isKey = keyNames.includes(col);
        let sortIcon = '';
        if (sortCol === col) {
            sortIcon = sortDir === 'asc'
                ? '<span class="sort-arrow sort-asc">▲</span>'
                : '<span class="sort-arrow sort-desc">▼</span>';
        } else {
            sortIcon = '<span class="sort-arrow sort-idle">⇅</span>';
        }
        const w = colWidths[col] ? ` style="width:${colWidths[col]}px;min-width:${colWidths[col]}px"` : ' style="min-width:120px"';
        thead += `<th class="${isKey ? 'key-col' : ''} col-sortable" draggable="true" data-col="${col}" data-col-idx="${colIdx}"${w}>`
            + `<span class="th-content">${escapeHtml(col)}${sortIcon}</span>`
            + `<span class="drag-handle" title="Drag to reorder">⠿</span>`
            + `<span class="col-resize-handle" data-col="${col}"></span>`
            + `</th>`;
    });
    thead += '</tr>';
    dom.dataThead.innerHTML = thead;

    // ── Sort click listeners ──
    dom.dataThead.querySelectorAll('.col-sortable').forEach(th => {
        th.addEventListener('click', (e) => {
            if (e.target.closest('.drag-handle') || e.target.closest('.col-resize-handle')) return;
            const col = th.dataset.col;
            if (sortCol === col) {
                sortDir = sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc';
                if (!sortDir) sortCol = null;
            } else {
                sortCol = col;
                sortDir = 'asc';
            }
            renderData();
        });
    });

    // ── Drag-and-drop reorder listeners ──
    dom.dataThead.querySelectorAll('th[draggable]').forEach(th => {
        th.addEventListener('dragstart', (e) => {
            if (e.target.closest('.col-resize-handle')) { e.preventDefault(); return; }
            dragSrcIdx = parseInt(th.dataset.colIdx);
            th.classList.add('col-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIdx);
        });
        th.addEventListener('dragend', () => {
            th.classList.remove('col-dragging');
            dom.dataThead.querySelectorAll('.col-drop-target').forEach(el => el.classList.remove('col-drop-target'));
        });
        th.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            th.classList.add('col-drop-target');
        });
        th.addEventListener('dragleave', () => {
            th.classList.remove('col-drop-target');
        });
        th.addEventListener('drop', (e) => {
            e.preventDefault();
            th.classList.remove('col-drop-target');
            const destIdx = parseInt(th.dataset.colIdx);
            if (dragSrcIdx === null || dragSrcIdx === destIdx) return;
            const col = state.allColumns.splice(dragSrcIdx, 1)[0];
            state.allColumns.splice(destIdx, 0, col);
            dragSrcIdx = null;
            renderData();
        });
    });

    // ── Column resize ──
    const table = dom.dataThead.closest('table');
    dom.dataThead.querySelectorAll('.col-resize-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const th    = handle.closest('th');
            const col   = handle.dataset.col;
            const startX   = e.clientX;
            const startW   = th.getBoundingClientRect().width;

            th.classList.add('col-resizing');
            table?.classList.add('is-resizing');

            const onMove = (ev) => {
                const newW = Math.max(60, startW + (ev.clientX - startX));
                th.style.width    = `${newW}px`;
                th.style.minWidth = `${newW}px`;
                colWidths[col] = newW;
            };

            const onUp = () => {
                th.classList.remove('col-resizing');
                table?.classList.remove('is-resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });

    // ── tbody ──
    let tbody = '';
    sorted.forEach((item, idx) => {
        tbody += '<tr>';
        tbody += `<td class="cell-actions">
      <button class="row-action-btn edit" data-idx="${idx}" title="Edit">✎</button>
      <button class="row-action-btn copy" data-idx="${idx}" title="Copy JSON"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      <button class="row-action-btn history" data-idx="${idx}" title="Version History">🕐</button>
      <button class="row-action-btn delete" data-idx="${idx}" title="Delete">🗑</button>
    </td>`;
        state.allColumns.forEach((col) => {
            const val = item[col];
            const display = val === undefined ? '' : formatCellValue(val);
            const isKey = keyNames.includes(col);
            const titleVal = escapeHtml(JSON.stringify(val) ?? '');
            tbody += `<td class="cell-data${isKey ? ' cell-key' : ''}" data-item-idx="${idx}" data-col="${col}" title="${titleVal}"><div class="cell-value">${display}</div></td>`;
        });
        tbody += '</tr>';
    });
    dom.dataTbody.innerHTML = tbody;

    dom.dataTbody.querySelectorAll('.row-action-btn.edit').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('openItemModalRequest', { detail: { item: sorted[btn.dataset.idx] } }));
        });
    });
    dom.dataTbody.querySelectorAll('.row-action-btn.copy').forEach((btn) => {
        btn.addEventListener('click', () => {
            const item = sorted[btn.dataset.idx];
            navigator.clipboard.writeText(JSON.stringify(item, null, 2))
                .then(() => showToast('JSON copied to clipboard', 'success'))
                .catch(() => showToast('Failed to copy JSON', 'error'));
        });
    });
    dom.dataTbody.querySelectorAll('.row-action-btn.history').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('openVersionHistoryRequest', { detail: { item: sorted[btn.dataset.idx] } }));
        });
    });
    dom.dataTbody.querySelectorAll('.row-action-btn.delete').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('openDeleteModalRequest', { detail: { item: sorted[btn.dataset.idx] } }));
        });
    });
}

function renderJsonView(items = state.items) {
    if (!items || items.length === 0) {
        dom.jsonContent.innerHTML = '<div class="json-empty">No items to display</div>';
        return;
    }

    let html = '';
    items.forEach((item, index) => {
        html += `
            <div class="json-record-compass" data-idx="${index}">
                ${buildCompassJson(item, true, true, null)}
            </div>
        `;
    });
    dom.jsonContent.innerHTML = html;

    dom.jsonContent.querySelectorAll('.edit-rec').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.closest('.json-record-compass').dataset.idx;
            document.dispatchEvent(new CustomEvent('openItemModalRequest', { detail: { item: items[idx] } }));
        });
    });

    dom.jsonContent.querySelectorAll('.clone-rec').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.closest('.json-record-compass').dataset.idx;
            const clonedItem = JSON.parse(JSON.stringify(items[idx]));
            delete clonedItem._id;
            document.dispatchEvent(new CustomEvent('openItemModalRequest', { detail: { item: clonedItem } }));
        });
    });

    dom.jsonContent.querySelectorAll('.copy-rec').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.closest('.json-record-compass').dataset.idx;
            const item = items[idx];
            if (item) {
                navigator.clipboard.writeText(JSON.stringify(item, null, 2))
                    .then(() => showToast('Record copied to clipboard', 'success'))
                    .catch(() => showToast('Failed to copy record', 'error'));
            }
        });
    });

    dom.jsonContent.querySelectorAll('.delete-rec').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.closest('.json-record-compass').dataset.idx;
            document.dispatchEvent(new CustomEvent('openDeleteModalRequest', { detail: { item: items[idx] } }));
        });
    });
}

function buildCompassJson(data, isRoot = false, isLast = true, keyName = null) {
    const keyHtml = keyName ? `<span class="json-key">"${escapeHtml(keyName)}"</span>: ` : '';
    const commaHtml = isLast ? '' : '<span class="json-comma">,</span>';
    
    if (data === null) return `${keyHtml}<span class="json-null">null</span>${commaHtml}`;
    if (typeof data === 'boolean') return `${keyHtml}<span class="json-boolean">${data}</span>${commaHtml}`;
    if (typeof data === 'number') return `${keyHtml}<span class="json-number">${data}</span>${commaHtml}`;
    if (typeof data === 'string') return `${keyHtml}<span class="json-string">"${escapeHtml(data)}"</span>${commaHtml}`;
    
    if (Array.isArray(data)) {
        if (data.length === 0) return `${keyHtml}[]${commaHtml}`;
        let html = `<details open class="json-node compass-node"><summary>${keyHtml}<span class="json-expanded-text">[</span><span class="json-collapsed-text">[...]${commaHtml}</span><span class="json-size"> // ${data.length} items</span></summary><div class="json-children">`;
        data.forEach((val, i) => {
            html += `<div class="json-line">${buildCompassJson(val, false, i === data.length - 1, null)}</div>`;
        });
        html += `</div><div class="json-close-bracket json-expanded-text">]${commaHtml}</div></details>`;
        return html;
    }
    
    if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 0) return `${keyHtml}{}${commaHtml}`;
        
        let rootActions = '';
        if (isRoot) {
             rootActions = `
                <div class="json-root-actions">
                    <button class="compass-btn edit-rec" title="Edit Item">✎</button>
                    <button class="compass-btn clone-rec" title="Clone Item">📄</button>
                    <button class="compass-btn copy-rec" title="Copy JSON"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                    <button class="compass-btn delete-rec" title="Delete Item">🗑</button>
                </div>`;
        }
        
        let html = `<details open class="json-node compass-node"><summary>${keyHtml}<span class="json-expanded-text">{</span><span class="json-collapsed-text">{...}${commaHtml}</span>${rootActions}</summary><div class="json-children">`;
        keys.forEach((key, i) => {
            html += `<div class="json-line">${buildCompassJson(data[key], false, i === keys.length - 1, key)}</div>`;
        });
        html += `</div><div class="json-close-bracket json-expanded-text">}${commaHtml}</div></details>`;
        return html;
    }
    return `${keyHtml}${escapeHtml(String(data))}${commaHtml}`;
}

// ─── Export Modal ────────────────────────────────────────────────────────────

let exportFormat = 'json';

function initExportModal() {
    const overlay   = $('#export-fields-overlay');
    const closeBtn  = $('#export-fields-close-btn');
    const cancelBtn = $('#export-fields-cancel-btn');
    const confirmBtn = $('#export-confirm-btn');
    const allBtn    = $('#export-select-all-btn');
    const noneBtn   = $('#export-select-none-btn');
    const keysBtn   = $('#export-select-keys-btn');

    if (!overlay) return;

    const close = () => overlay.classList.add('hidden');

    closeBtn  && closeBtn.addEventListener('click', close);
    cancelBtn && cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Format radio change
    overlay.querySelectorAll('input[name="export-format"]').forEach(radio => {
        radio.addEventListener('change', () => {
            exportFormat = radio.value;
        });
    });

    allBtn  && allBtn.addEventListener('click',  () => setAllChecked(true));
    noneBtn && noneBtn.addEventListener('click', () => setAllChecked(false));
    keysBtn && keysBtn.addEventListener('click', () => selectKeysOnly());

    confirmBtn && confirmBtn.addEventListener('click', async () => {
        const selected = getSelectedFields();
        if (!selected.length) return showToast('Select at least one field', 'error');

        const fetchAll = $('#export-fetch-all-cb')?.checked && state.lastQueryEndpoint && state.lastQueryParams;
        let items = state.items;

        if (fetchAll) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Fetching…';
            try {
                items = await fetchAllItemsForExport(confirmBtn);
            } catch (err) {
                showToast(`Export failed: ${err.message}`, 'error');
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Export';
                return;
            }
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Export';
        }

        if (exportFormat === 'csv') {
            doExportCsv(selected, items);
        } else {
            doExportJson(selected, items);
        }
        close();
    });
}

function openExportModal(format) {
    if (!state.items.length) return showToast('No items to export', 'error');

    exportFormat = format;
    const overlay = $('#export-fields-overlay');
    if (!overlay) return;

    // Sync format radio
    const radio = overlay.querySelector(`input[name="export-format"][value="${format}"]`);
    if (radio) radio.checked = true;

    // Build field list
    const list       = $('#export-fields-list');
    const keyNames   = getKeyNames();
    const cols       = state.allColumns.length ? state.allColumns : Object.keys(
        state.items.reduce((acc, item) => { Object.keys(item).forEach(k => acc[k] = 1); return acc; }, {})
    );

    list.innerHTML = cols.map(col => {
        const isKey = keyNames.includes(col);
        return `
            <label class="export-field-item">
                <input type="checkbox" class="export-field-cb" data-field="${col}" checked />
                <span class="export-field-name">${escapeHtml(col)}</span>
                ${isKey ? `<span class="export-field-badge">key</span>` : ''}
            </label>`;
    }).join('');

    // Update counters
    updateExportCount();

    // Listen checkbox changes to update counter
    list.querySelectorAll('.export-field-cb').forEach(cb => {
        cb.addEventListener('change', updateExportCount);
    });

    const hasMorePages = !!state.lastEvaluatedKey && !!state.lastQueryEndpoint;
    $('#export-item-count').textContent = hasMorePages
        ? `${state.items.length}+ (more pages available)`
        : state.items.length;
    const fetchAllRow = $('#export-fetch-all-row');
    if (fetchAllRow) {
        if (hasMorePages) {
            fetchAllRow.classList.remove('hidden');
            const cb = $('#export-fetch-all-cb');
            if (cb) cb.checked = true;
        } else {
            fetchAllRow.classList.add('hidden');
        }
    }
    overlay.classList.remove('hidden');
}

function updateExportCount() {
    const all      = $$('#export-fields-list .export-field-cb');
    const checked  = all.filter(cb => cb.checked);
    $('#export-selected-count').textContent = checked.length;
    $('#export-total-count').textContent    = all.length;
}

function setAllChecked(checked) {
    $$('#export-fields-list .export-field-cb').forEach(cb => { cb.checked = checked; });
    updateExportCount();
}

function selectKeysOnly() {
    const keyNames = getKeyNames();
    $$('#export-fields-list .export-field-cb').forEach(cb => {
        cb.checked = keyNames.includes(cb.dataset.field);
    });
    updateExportCount();
}

function getSelectedFields() {
    return $$('#export-fields-list .export-field-cb')
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.field);
}

async function fetchAllItemsForExport(progressBtn) {
    const connection = getActiveTabConnection();
    const endpoint = state.lastQueryEndpoint;
    const baseParams = { ...state.lastQueryParams };
    const isSql = endpoint === '/execute-statement';
    const pageKey = isSql ? 'nextToken' : 'exclusiveStartKey';
    const resultKey = isSql ? 'nextToken' : 'lastEvaluatedKey';

    let allItems = [];
    let continuationKey = null;
    let page = 0;

    do {
        page++;
        if (progressBtn) progressBtn.textContent = `Fetching… (${allItems.length} items)`;
        const params = { ...baseParams };
        if (continuationKey) params[pageKey] = continuationKey;
        const result = await api('POST', endpoint, params, { connection });
        allItems = allItems.concat(result.items || []);
        continuationKey = result[resultKey] || null;
    } while (continuationKey);

    return allItems;
}

function doExportJson(fields, items) {
    const src = items || state.items;
    const data = src.map(item => {
        const out = {};
        fields.forEach(f => { if (f in item) out[f] = item[f]; });
        return out;
    });
    downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `${state.currentTable}_data.json`
    );
    showToast(`Exported ${data.length} items (${fields.length} fields) as JSON`, 'success');
}

function doExportCsv(fields, items) {
    const src = items || state.items;
    const csvRows = [fields.join(',')];
    src.forEach(item => {
        const values = fields.map(f => {
            const val = item[f];
            const s   = (val === null || val === undefined) ? '' : JSON.stringify(val);
            return `"${s.replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    });
    downloadBlob(
        new Blob([csvRows.join('\n')], { type: 'text/csv' }),
        `${state.currentTable}_data.csv`
    );
    showToast(`Exported ${src.length} items (${fields.length} fields) as CSV`, 'success');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function getKeyNames() {
    if (!state.tableInfo) return [];
    return (state.tableInfo.KeySchema || []).map((k) => k.AttributeName);
}

function formatCellValue(val) {
    if (val === null) return '<span style="color:var(--text-muted);font-style:italic">null</span>';
    if (typeof val === 'object') return escapeHtml(JSON.stringify(val));
    if (typeof val === 'boolean') return `<span style="color:var(--info)">${val}</span>`;
    if (typeof val === 'number') return `<span style="color:var(--warning)">${val}</span>`;
    return escapeHtml(String(val));
}

function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// ─── Inline cell editing ──────────────────────────────────────────────────────

function handleCellDblClick(e) {
    const td = e.target.closest('td.cell-data');
    if (!td || td.querySelector('.cell-inline-editor')) return;

    const col      = td.dataset.col;
    const itemIdx  = parseInt(td.dataset.itemIdx);
    const item     = lastSorted[itemIdx];
    if (!item) return;

    const keyNames = getKeyNames();
    if (keyNames.includes(col)) {
        showToast('Chaves primárias não podem ser editadas inline. Use ✎ para editar o item completo.', 'info');
        return;
    }

    const val = item[col];

    // Objects / arrays → open full modal editor
    if (val !== null && val !== undefined && typeof val === 'object') {
        document.dispatchEvent(new CustomEvent('openItemModalRequest', { detail: { item } }));
        return;
    }

    startInlineEdit(td, col, itemIdx, val);
}

function startInlineEdit(td, col, itemIdx, origVal) {
    const origDisplay = td.innerHTML;
    const isNum  = typeof origVal === 'number';
    const isBool = typeof origVal === 'boolean';
    const valStr = origVal === null || origVal === undefined ? '' : String(origVal);

    td.classList.add('cell-editing');
    td.innerHTML = `<input class="cell-inline-editor" type="${isNum ? 'number' : 'text'}" value="${escapeHtml(valStr)}"${isBool ? ' placeholder="true / false"' : ''} />`;

    const input = td.querySelector('.cell-inline-editor');
    input.focus();
    input.select();

    let committed = false;

    const cancel = () => {
        if (committed) return;
        committed = true;
        td.classList.remove('cell-editing');
        td.innerHTML = origDisplay;
    };

    const commit = () => {
        if (committed) return;
        committed = true;
        _applyInlineEdit(td, col, itemIdx, origVal, input.value, origDisplay);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    // Small timeout lets Enter's commit() run before blur fires
    input.addEventListener('blur', () => setTimeout(() => { if (!committed) commit(); }, 80));
}

async function _applyInlineEdit(td, col, itemIdx, origVal, rawStr, origDisplay) {
    const newStr = rawStr.trim();
    const isNum  = typeof origVal === 'number';
    const isBool = typeof origVal === 'boolean';

    let newVal;
    if (isBool) {
        newVal = newStr.toLowerCase() === 'true';
    } else if (isNum) {
        newVal = newStr === '' ? undefined : Number(newStr);
        if (newStr !== '' && isNaN(newVal)) newVal = newStr;
    } else if (origVal === null) {
        newVal = newStr === '' ? null : newStr;
    } else if (origVal === undefined) {
        newVal = newStr === '' ? undefined : newStr;
    } else {
        newVal = newStr;
    }

    // Re-read current item (may have changed from a prior inline edit in this render)
    const currentItem = lastSorted[itemIdx];
    if (JSON.stringify(newVal) === JSON.stringify(currentItem[col])) {
        td.classList.remove('cell-editing');
        td.innerHTML = origDisplay;
        return;
    }

    const updatedItem = { ...currentItem };
    if (newVal === undefined) {
        delete updatedItem[col];
    } else {
        updatedItem[col] = newVal;
    }

    td.classList.remove('cell-editing');
    td.innerHTML = '<span class="cell-saving">saving…</span>';

    // Build the primary key object from the current item
    const keyNames = getKeyNames();
    const key = {};
    for (const k of keyNames) key[k] = currentItem[k];

    try {
        const connection = getActiveTabConnection();
        const _t0 = Date.now();
        const result = await api('PATCH', `/tables/${state.currentTable}/items`, { key, attributeName: col, newValue: newVal }, { connection });
        trackWrite(state.currentTable, result?.consumedCapacity, 'update', Date.now() - _t0, 1);

        // Update in-memory state
        const realIdx = state.items.indexOf(currentItem);
        if (realIdx !== -1) state.items[realIdx] = updatedItem;
        lastSorted[itemIdx] = updatedItem;

        td.innerHTML = `<div class="cell-value">${newVal === undefined ? '' : formatCellValue(newVal)}</div>`;
        td.title     = escapeHtml(JSON.stringify(newVal) ?? '');
        showToast(`"${col}" atualizado`, 'success');
    } catch (err) {
        td.innerHTML = origDisplay;
        showToast(`Falha ao salvar: ${err.message}`, 'error');
    }
}
