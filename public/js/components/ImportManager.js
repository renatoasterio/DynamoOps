import { $, $$ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { trackWrite } from './CostTracker.js';

// ─── Module state ─────────────────────────────────────────────────────────────
let parsedRows  = [];
let fileColumns = [];
let activeSheet = null;
let workbook    = null;
let abortImport = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initImportManager() {
    // Attach toolbar button listener unconditionally — no early return
    const toolbarBtn = $('#import-btn');
    if (toolbarBtn) {
        toolbarBtn.addEventListener('click', () => openModal());
    }

    // All other listeners require the modal to exist in DOM
    const overlay = $('#import-overlay');
    if (!overlay) return;

    const fileInput   = $('#import-file-input');
    const dropzone    = $('#import-dropzone');
    const sheetSelect = $('#import-sheet-select');

    // ── Close ──
    const close = () => {
        abortImport = true;
        overlay.classList.add('hidden');
    };
    $('#import-close-btn')  ?.addEventListener('click', close);
    $('#import-cancel-btn') ?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // ── Drop zone ──
    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput?.click());
        dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', e => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) handleFile(fileInput.files[0]);
        });
    }

    // ── Clear file ──
    $('#import-file-clear-btn')?.addEventListener('click', () => {
        resetFileState();
        if (fileInput) fileInput.value = '';
    });

    // ── Sheet change (Excel multi-sheet) ──
    if (sheetSelect) {
        sheetSelect.addEventListener('change', async () => {
            if (!workbook) return;
            activeSheet = sheetSelect.value;
            // Re-request parse for the selected sheet
            const fileInput = $('#import-file-input');
            const file = fileInput?.files[0];
            if (!file) return;
            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('sheet', activeSheet);
                const resp = await fetch('/api/import/parse-excel', { method: 'POST', body: formData });
                if (!resp.ok) throw new Error(resp.statusText);
                const result = await resp.json();
                parsedRows  = result.rows;
                fileColumns = result.columns;
                workbook    = { ...workbook, ...result };
                updateFileMetaLabel();
            } catch (err) {
                showToast(`Failed to load sheet: ${err.message}`, 'error');
            }
        });
    }

    // ── Step navigation ──
    $('#import-next-btn') ?.addEventListener('click', goToStep2);
    $('#import-back-btn') ?.addEventListener('click', () => goToStep1());
    $('#import-start-btn')?.addEventListener('click', startImport);
    $('#import-abort-btn')?.addEventListener('click', () => { abortImport = true; });
    $('#import-finish-btn')?.addEventListener('click', () => {
        close();
        document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
    });
}

// ─── Open ─────────────────────────────────────────────────────────────────────
function openModal() {
    const overlay = $('#import-overlay');
    if (!overlay) {
        showToast('Import modal not found — reload the page', 'error');
        return;
    }

    abortImport = false;
    parsedRows  = [];
    fileColumns = [];
    workbook    = null;
    activeSheet = null;

    resetFileState();
    populateTargetTableSelector();
    goToStep1();
    overlay.classList.remove('hidden');
}

function populateTargetTableSelector() {
    const sel = $('#import-target-table');
    if (!sel) return;

    // Get available tables from the sidebar list
    const tableItems = $$('#table-list li[data-table]');
    const names = tableItems.map(el => el.dataset.table).filter(Boolean);

    sel.innerHTML = names.length
        ? names.map(n => `<option value="${escHtml(n)}"${n === state.currentTable ? ' selected' : ''}>${escHtml(n)}</option>`).join('')
        : '<option value="">— No tables available —</option>';
}

// ─── File handling ────────────────────────────────────────────────────────────
async function handleFile(file) {
    const ext    = file.name.split('.').pop().toLowerCase();
    const nextBtn = $('#import-next-btn');

    resetFileState();
    setStepDots(1);

    try {
        if (ext === 'json') {
            const text   = await readAsText(file);
            const parsed = JSON.parse(text);
            parsedRows  = Array.isArray(parsed) ? parsed : [parsed];
            fileColumns = inferColumns(parsedRows);

        } else if (ext === 'csv') {
            const text  = await readAsText(file);
            parsedRows  = parseCsv(text);
            fileColumns = Object.keys(parsedRows[0] || {});

        } else if (ext === 'xlsx' || ext === 'xls') {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch('/api/import/parse-excel', { method: 'POST', body: formData });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: resp.statusText }));
                throw new Error(err.error || 'Excel parse failed');
            }
            const result = await resp.json();
            workbook    = result; // store { sheets, rows, columns } as workbook stand-in
            activeSheet = result.sheets[0];
            parsedRows  = result.rows;
            fileColumns = result.columns;

            const sheetSel    = $('#import-sheet-selector');
            const sheetSelect = $('#import-sheet-select');
            if (result.sheets.length > 1 && sheetSel && sheetSelect) {
                sheetSelect.innerHTML = result.sheets
                    .map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
                sheetSel.classList.remove('hidden');
            } else {
                sheetSel?.classList.add('hidden');
            }
        } else {
            showToast('Unsupported format — use JSON, CSV or Excel', 'error');
            return;
        }

        if (!parsedRows.length) {
            showToast('File is empty or has no data rows', 'error');
            return;
        }

        // Show file info chip
        $('#import-file-name').textContent = file.name;
        updateFileMetaLabel();
        $('#import-file-info')?.classList.remove('hidden');
        if (nextBtn) nextBtn.disabled = false;

    } catch (err) {
        showToast(`Failed to parse file: ${err.message}`, 'error');
        resetFileState();
    }
}

function updateFileMetaLabel() {
    fileColumns = Object.keys(parsedRows[0] || {});
    const meta = $('#import-file-meta');
    if (meta) meta.textContent =
        `${formatNumber(parsedRows.length)} rows · ${fileColumns.length} columns`;
}

// ─── Step navigation ──────────────────────────────────────────────────────────
function goToStep1() {
    showStep(1);
    setStepDots(1);
}

function goToStep2() {
    if (!parsedRows.length) return showToast('Select a file first', 'error');

    const target = $('#import-target-table')?.value;
    if (!target) return showToast('Select a target table', 'error');

    buildMappingUI();
    showStep(2);
    setStepDots(2);
}

function showStep(n) {
    [1, 2, 3].forEach(i => {
        $(`#import-step-${i}`)?.classList.toggle('hidden', i !== n);
    });
}

function setStepDots(active) {
    $$('#import-overlay .import-step-dot').forEach(dot => {
        const n = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'done');
        if (n < active)   dot.classList.add('done');
        if (n === active) dot.classList.add('active');
    });
}

// ─── Mapping UI ───────────────────────────────────────────────────────────────
function buildMappingUI() {
    const preview5 = parsedRows.slice(0, 5);

    // Preview table
    const previewTable = $('#import-preview-table');
    if (previewTable) {
        previewTable.innerHTML = `
            <thead><tr>${fileColumns.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>${preview5.map(row =>
                `<tr>${fileColumns.map(c => `<td>${escHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`
            ).join('')}</tbody>`;
    }

    const badge = $('#import-preview-badge');
    if (badge) badge.textContent = `first ${Math.min(5, parsedRows.length)} of ${formatNumber(parsedRows.length)}`;

    // Infer types from first 100 rows
    const sample = parsedRows.slice(0, 100);

    const container = $('#import-mapping-rows');
    if (!container) return;

    container.innerHTML = fileColumns.map(col => {
        const inferred = inferType(sample, col);
        return `
            <div class="import-mapping-row" data-col="${escHtml(col)}">
                <span class="import-mapping-col-name" title="${escHtml(col)}">${escHtml(col)}</span>
                <input type="checkbox" class="map-include" checked data-col="${escHtml(col)}" />
                <select class="import-mapping-type-select map-type" data-col="${escHtml(col)}">
                    <option value="auto"  ${inferred==='auto' ?'selected':''}>Auto</option>
                    <option value="S"     ${inferred==='S'    ?'selected':''}>String</option>
                    <option value="N"     ${inferred==='N'    ?'selected':''}>Number</option>
                    <option value="BOOL"  ${inferred==='BOOL' ?'selected':''}>Boolean</option>
                    <option value="JSON">JSON (parse)</option>
                    <option value="skip">— Skip —</option>
                </select>
                <input type="text" class="import-mapping-rename map-rename"
                    placeholder="${escHtml(col)}" data-col="${escHtml(col)}" />
            </div>`;
    }).join('');

    // Sync checkbox ↔ type selector
    container.querySelectorAll('.map-type').forEach(sel => {
        sel.addEventListener('change', () => {
            const cb = sel.closest('.import-mapping-row').querySelector('.map-include');
            if (sel.value === 'skip') cb.checked = false;
        });
    });
    container.querySelectorAll('.map-include').forEach(cb => {
        cb.addEventListener('change', () => {
            const sel = cb.closest('.import-mapping-row').querySelector('.map-type');
            if (!cb.checked && sel.value !== 'skip') sel.value = 'skip';
            if (cb.checked  && sel.value === 'skip') sel.value = 'auto';
        });
    });

    const lbl = $('#import-row-count-label');
    const target = $('#import-target-table')?.value || state.currentTable || '?';
    if (lbl) lbl.textContent = `${formatNumber(parsedRows.length)} rows → "${target}"`;
}

// ─── Import ───────────────────────────────────────────────────────────────────
async function startImport() {
    const targetTable = $('#import-target-table')?.value || state.currentTable;
    if (!targetTable) {
        showToast('No target table selected', 'error');
        goToStep1();
        return;
    }

    setStepDots(3);
    showStep(3);

    const skipEmpty = $('#import-opt-skip-empty')?.checked ?? true;
    const batchSize = Math.max(25, Math.min(5000, parseInt($('#import-opt-batch')?.value) || 500));

    // Build mapping
    const mapping = {};
    $$('#import-mapping-rows .import-mapping-row').forEach(row => {
        const col     = row.dataset.col;
        const type    = row.querySelector('.map-type').value;
        const rename  = row.querySelector('.map-rename').value.trim() || col;
        const include = row.querySelector('.map-include').checked && type !== 'skip';
        if (include) mapping[col] = { type, rename };
    });

    if (!Object.keys(mapping).length) {
        showToast('Select at least one column', 'error');
        goToStep2();
        return;
    }

    // Convert rows to DynamoDB items
    const items = parsedRows.map(row => convertRow(row, mapping, skipEmpty));
    const total = items.length;

    // Init progress UI
    abortImport = false;
    const statDone   = $('#import-stat-done');
    const statTotal  = $('#import-stat-total');
    const statErrors = $('#import-stat-errors');
    const progBar    = $('#import-progress-bar');
    const progLabel  = $('#import-progress-label');

    if (statTotal)  statTotal.textContent  = formatNumber(total);
    if (statDone)   statDone.textContent   = '0';
    if (statErrors) statErrors.textContent = '0';
    if (progLabel)  progLabel.textContent  = 'Starting…';
    if (progBar)    progBar.style.width    = '0%';
    setProgressState('running');

    let done   = 0;
    let errors = 0;
    const errList = $('#import-error-list');

    for (let i = 0; i < items.length; i += batchSize) {
        if (abortImport) break;

        const chunk = items.slice(i, i + batchSize);
        try {
            const _t0 = Date.now();
            const result = await api('POST', `/tables/${targetTable}/batch-write`, { items: chunk });
            trackWrite(targetTable, result?.consumedCapacity, 'batchWrite', Date.now() - _t0, chunk.length);
            done   += result.processedCount       ?? chunk.length;
            errors += result.unprocessedItemsCount ?? 0;
        } catch (err) {
            errors += chunk.length;
            const msg = `Batch ${Math.floor(i/batchSize)+1}: ${err.message}`;
            if (errList && errors <= 10) {
                errList.classList.remove('hidden');
                errList.innerHTML += `<span>${escHtml(msg)}</span>`;
            }
        }

        const pct = Math.round((Math.min(done + errors, total) / total) * 100);
        if (progBar)    progBar.style.width    = `${pct}%`;
        if (statDone)   statDone.textContent   = formatNumber(done);
        if (statErrors) statErrors.textContent = formatNumber(errors);
        if (progLabel)  progLabel.textContent  =
            `Importing… ${formatNumber(Math.min(i + batchSize, total))} / ${formatNumber(total)}`;

        await new Promise(r => setTimeout(r, 0)); // yield to browser
    }

    // Final
    if (abortImport) {
        setProgressState('error');
        if (progLabel) progLabel.textContent = `Aborted. ${formatNumber(done)} imported.`;
    } else if (errors === 0) {
        setProgressState('done');
        if (progBar)   progBar.style.width    = '100%';
        if (progLabel) progLabel.textContent  = `Done! ${formatNumber(done)} items imported.`;
    } else {
        setProgressState('error');
        if (progLabel) progLabel.textContent =
            `Finished with ${formatNumber(errors)} errors. ${formatNumber(done)} imported.`;
    }

    $('#import-abort-btn') ?.classList.add('hidden');
    $('#import-finish-btn')?.classList.remove('hidden');
}

function setProgressState(s) {
    const icon = $('#import-progress-icon');
    if (icon) icon.className = `import-progress-icon ${s}`;
    $('#import-spinner')   ?.classList.toggle('hidden', s !== 'running');
    $('#import-done-icon') ?.classList.toggle('hidden', s !== 'done');
    $('#import-error-icon')?.classList.toggle('hidden', s !== 'error');
}

// ─── Row conversion ───────────────────────────────────────────────────────────
function convertRow(row, mapping, skipEmpty) {
    const out = {};
    for (const [col, { type, rename }] of Object.entries(mapping)) {
        const val = row[col];
        if (skipEmpty && (val === null || val === undefined || val === '')) continue;
        const cast = castValue(val, type);
        if (cast !== undefined) out[rename] = cast;
    }
    return out;
}

function castValue(val, type) {
    if (val === null || val === undefined) return undefined;
    const s = String(val).trim();
    switch (type) {
        case 'S':    return s;
        case 'N':    { const n = Number(s); return isNaN(n) ? s : n; }
        case 'BOOL': return s === 'true' || s === '1' || s === 'yes';
        case 'JSON': try { return JSON.parse(s); } catch { return s; }
        default:     return autocast(s);
    }
}

function autocast(s) {
    if (s === '')      return s;
    if (s === 'true')  return true;
    if (s === 'false') return false;
    if (s === 'null')  return null;
    const n = Number(s);
    if (!isNaN(n) && s !== '') return n;
    try { const j = JSON.parse(s); if (typeof j === 'object') return j; } catch {}
    return s;
}

// ─── Type inference ───────────────────────────────────────────────────────────
function inferType(sample, col) {
    let num = 0, bool = 0, total = 0;
    for (const row of sample) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        total++;
        const s = String(v).trim();
        if (!isNaN(Number(s)) && s !== '') num++;
        if (s === 'true' || s === 'false') bool++;
    }
    if (!total) return 'S';
    if (bool / total > 0.9) return 'BOOL';
    if (num  / total > 0.9) return 'N';
    return 'auto';
}

function inferColumns(rows) {
    const seen = new Set();
    rows.slice(0, 200).forEach(r => Object.keys(r).forEach(k => seen.add(k)));
    return [...seen];
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length) return [];
    const headers = parseCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = parseCsvLine(line);
        const row  = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
        rows.push(row);
    }
    return rows;
}

function parseCsvLine(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
            result.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur);
    return result;
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetFileState() {
    parsedRows  = [];
    fileColumns = [];
    workbook    = null;
    activeSheet = null;
    const nextBtn = $('#import-next-btn');
    if (nextBtn) nextBtn.disabled = true;
    $('#import-file-info')     ?.classList.add('hidden');
    $('#import-sheet-selector')?.classList.add('hidden');
    $('#import-error-list')    ?.classList.add('hidden');
    const errList = $('#import-error-list');
    if (errList) errList.innerHTML = '';
    const bar = $('#import-progress-bar');
    if (bar) bar.style.width = '0%';
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function readAsText(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result);
        r.onerror = rej;
        r.readAsText(file, 'UTF-8');
    });
}

function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatNumber(n) {
    return Number(n).toLocaleString();
}
