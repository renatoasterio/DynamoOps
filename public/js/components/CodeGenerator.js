// Code generator modal (UI only). The generators themselves live in
// ../codegen — one module per language behind a common interface.
import { $ } from '../utils/dom.js';
import { state, getActiveTabConnection } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { escapeHtml } from '../utils/html.js';
import { copyText } from '../utils/clipboard.js';
import { downloadBlob } from '../utils/download.js';
import { getPkSk } from '../utils/keySchema.js';
import { generateQuery, generateCrud, generateSdkFiles, sdkRootFolder } from '../codegen/index.js';

let currentLang = 'nodejs';
let currentMode = 'current'; // 'current' | 'crud'

export function initCodeGenerator() {
    $('#code-gen-btn')?.addEventListener('click', openModal);
    $('#code-gen-close-btn')?.addEventListener('click', closeModal);
    $('#code-gen-overlay')?.addEventListener('click', e => {
        if (e.target === $('#code-gen-overlay')) closeModal();
    });

    // Language tabs
    $('#code-gen-overlay')?.querySelectorAll('.code-gen-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentLang = tab.dataset.lang;
            $('#code-gen-overlay').querySelectorAll('.code-gen-tab')
                .forEach(t => t.classList.toggle('active', t === tab));
            renderCode();
        });
    });

    // Mode sub-tabs (Current Query / Full CRUD)
    $('#code-gen-overlay')?.querySelectorAll('.code-gen-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentMode = tab.dataset.mode;
            $('#code-gen-overlay').querySelectorAll('.code-gen-mode-tab')
                .forEach(t => t.classList.toggle('active', t === tab));
            renderCode();
        });
    });

    $('#code-gen-copy-btn')?.addEventListener('click', () => {
        const code = $('#code-gen-output')?.textContent;
        if (code) {
            copyText(code, 'Code copied!');
        }
    });

    // SDK download button
    $('#code-gen-sdk-btn')?.addEventListener('click', async () => {
        if (!state.currentTable) { showToast('Select a table first', 'info'); return; }
        const btn = $('#code-gen-sdk-btn');
        const origText = btn.textContent;
        try {
            btn.textContent = '⏳ Generating...';
            btn.disabled = true;
            await downloadSdk(currentLang, state.currentTable, getKeyInfo(), currentRegion());
            showToast(`SDK ${currentLang} downloaded!`, 'success');
        } catch (err) {
            showToast(`Failed to generate SDK: ${err.message}`, 'error');
        } finally {
            btn.textContent = origText;
            btn.disabled = false;
        }
    });
}

function openModal() {
    if (!state.currentTable) { showToast('Select a table first', 'info'); return; }
    const overlay = $('#code-gen-overlay');
    if (!overlay) return;

    const badge = $('#code-gen-table-badge');
    if (badge) badge.textContent = state.currentTable;

    // Reset to nodejs / current
    currentLang = 'nodejs'; currentMode = 'current';
    overlay.querySelectorAll('.code-gen-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === 'nodejs'));
    overlay.querySelectorAll('.code-gen-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === 'current'));

    renderCode();
    overlay.classList.remove('hidden');
}

function closeModal() { $('#code-gen-overlay')?.classList.add('hidden'); }

// ─── Context readers ──────────────────────────────────────────────────────────

// Region of the active tab's connection (tabs can point to different accounts)
const currentRegion = () => getActiveTabConnection()?.region || 'us-east-1';

function getQueryContext() {
    const mode   = state.queryMode || 'scan';
    const table  = state.currentTable || '';
    const region = currentRegion();
    const limit  = parseInt($('#page-size')?.value) || 50;

    if (mode === 'query') {
        const pkName    = $('#query-pk-name')?.value  || 'pk';
        const pkValRaw  = $('#query-pk-value')?.value || 'value';
        const skName    = $('#query-sk-name')?.value  || '';
        const skOp      = $('#query-sk-op')?.value    || '=';
        const skValRaw  = $('#query-sk-value')?.value || '';
        const skVal2Raw = $('#query-sk-value2')?.value || '';
        const indexName = $('#query-index')?.value    || '';
        const pkVal  = pkValRaw  && !isNaN(pkValRaw)  ? Number(pkValRaw)  : pkValRaw;
        const skVal  = skValRaw  && !isNaN(skValRaw)  ? Number(skValRaw)  : skValRaw;
        const skVal2 = skVal2Raw && !isNaN(skVal2Raw) ? Number(skVal2Raw) : skVal2Raw;
        return { mode, table, region, limit, pkName, pkVal, skName, skOp, skVal, skVal2, indexName };
    } else if (mode === 'sql') {
        const statement = $('#sql-statement')?.value?.trim() || `SELECT * FROM "${table}"`;
        return { mode, table, region, limit, statement };
    } else {
        const filterExpr   = $('#scan-filter-expr')?.value?.trim() || '';
        const exprNamesRaw = $('#scan-expr-names')?.value?.trim()  || '';
        const exprValsRaw  = $('#scan-expr-values')?.value?.trim() || '';
        let exprNames = null, exprVals = null;
        try { if (exprNamesRaw) exprNames = JSON.parse(exprNamesRaw); } catch { /**/ }
        try { if (exprValsRaw)  exprVals  = JSON.parse(exprValsRaw);  } catch { /**/ }
        return { mode, table, region, limit, filterExpr, exprNames, exprVals };
    }
}

function getKeyInfo() {
    const { pk, sk } = getPkSk(state.tableInfo?.KeySchema);
    const defs = state.tableInfo?.AttributeDefinitions || [];
    const typeOf = (name) => defs.find(a => a.AttributeName === name)?.AttributeType || 'S';
    return {
        pkName: pk || 'pk',
        pkType: typeOf(pk),
        skName: sk || null,
        skType: sk ? typeOf(sk) : null,
    };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderCode() {
    const ctx = getQueryContext();
    const ki  = getKeyInfo();

    const modeBadge = $('#code-gen-mode-badge');
    if (modeBadge) {
        if (currentMode === 'crud') {
            modeBadge.textContent = 'CRUD';
            modeBadge.className   = 'code-gen-mode-badge code-gen-mode-crud';
        } else {
            const labels = { scan: 'SCAN', query: 'QUERY', sql: 'PARTIQL' };
            modeBadge.textContent = labels[ctx.mode] || ctx.mode.toUpperCase();
            modeBadge.className   = `code-gen-mode-badge code-gen-mode-${ctx.mode}`;
        }
    }

    const hintEl = $('#code-gen-hint-text');
    if (hintEl) {
        hintEl.innerHTML = currentMode === 'crud'
            ? `Full example · <strong>PK</strong>: ${escapeHtml(ki.pkName)}${ki.skName ? ` · <strong>SK</strong>: ${escapeHtml(ki.skName)}` : ''}`
            : `Reflects the current query · <strong>double-click</strong> a cell to edit inline`;
    }

    const code = currentMode === 'crud'
        ? generateCrud(currentLang, ki, ctx.table, ctx.region)
        : generateQuery(currentLang, ctx);

    const output = $('#code-gen-output');
    if (output) output.textContent = code;
}

// ─── SDK download ─────────────────────────────────────────────────────────────

/** Zips the generated SDK project and downloads it (JSZip is loaded by index.html). */
async function downloadSdk(lang, tableName, keyInfo, region) {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    const files = generateSdkFiles(lang, tableName, keyInfo, region);
    const root  = sdkRootFolder(tableName);
    const zip   = new window.JSZip();
    for (const [path, content] of Object.entries(files)) {
        zip.file(`${root}/${path}`, content);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `${root}-${lang}.zip`);
}
