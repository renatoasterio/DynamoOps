import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { escapeHtml } from '../utils/html.js';
import { loadJSON, saveJSON } from '../utils/storage.js';
import { getKeyNames } from '../utils/keySchema.js';

const MAX_VERSIONS = 20;
const STORAGE_PREFIX = 'dynamo-versions';

// ── Storage ───────────────────────────────────────────────────────────────────
// One history per item, keyed by its primary-key values
function storageKey(table, item) {
    const pkValue = getKeyNames().map(k => JSON.stringify(item[k])).join('|') || JSON.stringify(item).slice(0, 64);
    return `${STORAGE_PREFIX}-${table}-${pkValue.slice(0, 64)}`;
}

export function saveVersion(table, item) {
    if (!table || !item) return;

    const key      = storageKey(table, item);
    const existing = getVersionsRaw(key);

    const entry = { ts: new Date().toISOString(), item: JSON.parse(JSON.stringify(item)) };
    const updated = [entry, ...existing].slice(0, MAX_VERSIONS);

    if (!saveJSON(key, updated)) {
        // Storage quota — clear old entries and keep only this version
        clearOldVersionEntries();
        saveJSON(key, [entry]);
    }
}

function getVersionsRaw(key) {
    return loadJSON(key, []);
}

export function getVersions(table, item) {
    return getVersionsRaw(storageKey(table, item));
}

function clearOldVersionEntries() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
    }
    // Remove half the oldest
    keysToRemove.slice(0, Math.ceil(keysToRemove.length / 2))
        .forEach(k => localStorage.removeItem(k));
}

// ── Modal ─────────────────────────────────────────────────────────────────────
let selectedVersion = null;

export function initVersionHistory() {
    const overlay  = $('#version-history-overlay');
    const closeBtn = $('#version-history-close-btn');
    const restoreBtn = $('#version-restore-btn');

    if (!overlay) return;

    closeBtn?.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    restoreBtn?.addEventListener('click', () => {
        if (!selectedVersion) return;
        document.dispatchEvent(new CustomEvent('openItemModalRequest', {
            detail: { item: selectedVersion.item, fromHistory: true }
        }));
        closeModal();
    });

    document.addEventListener('openVersionHistoryRequest', (e) => {
        openModal(e.detail.item);
    });
}

function openModal(item) {
    if (!state.currentTable || !item) return;

    selectedVersion = null;

    const versions = getVersions(state.currentTable, item);
    const overlay  = $('#version-history-overlay');

    renderVersionList(versions, item);
    clearDiff();
    overlay.classList.remove('hidden');
}

function closeModal() {
    $('#version-history-overlay')?.classList.add('hidden');
    selectedVersion = null;
}

function renderVersionList(versions, currentItemData) {
    const listEl = $('#version-list');
    if (!listEl) return;

    if (versions.length === 0) {
        listEl.innerHTML = '<p class="version-empty">No saved versions yet.<br/>Versions are saved automatically each time you edit an item.</p>';
        $('#version-restore-btn').disabled = true;
        return;
    }

    listEl.innerHTML = versions.map((v, i) => {
        const date = new Date(v.ts);
        const label = i === 0 ? ' <span class="version-latest-tag">latest</span>' : '';
        const changes = diffSummary(v.item, currentItemData);
        const changeSummary = changes.length > 0
            ? `<span class="version-change-count">${changes.length} change${changes.length > 1 ? 's' : ''}</span>`
            : `<span class="version-change-count unchanged">no changes from current</span>`;
        return `<div class="version-entry" data-idx="${i}">
            <div class="version-entry-top">
                <span class="version-time">${date.toLocaleString()}</span>${label}
            </div>
            ${changeSummary}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.version-entry').forEach(el => {
        el.addEventListener('click', () => {
            listEl.querySelectorAll('.version-entry').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            const idx = parseInt(el.dataset.idx, 10);
            selectedVersion = versions[idx];
            renderDiff(selectedVersion.item, currentItemData);
            $('#version-restore-btn').disabled = false;
        });
    });

    // Auto-select first
    listEl.querySelector('.version-entry')?.click();
}

// ── Diff ──────────────────────────────────────────────────────────────────────
function renderDiff(oldItem, newItem) {
    const diffEl = $('#version-diff');
    if (!diffEl) return;

    const allKeys = [...new Set([...Object.keys(oldItem), ...Object.keys(newItem)])].sort();
    const rows = allKeys.map(key => {
        const inOld = key in oldItem;
        const inNew = key in newItem;
        const oldVal = JSON.stringify(oldItem[key], null, 2);
        const newVal = JSON.stringify(newItem[key], null, 2);

        if (!inOld) {
            return diffRow(key, null, newVal, 'diff-added');
        } else if (!inNew) {
            return diffRow(key, oldVal, null, 'diff-removed');
        } else if (oldVal !== newVal) {
            return diffRow(key, oldVal, newVal, 'diff-modified');
        } else {
            return diffRow(key, oldVal, oldVal, 'diff-unchanged');
        }
    });

    diffEl.innerHTML = `
        <div class="diff-header">
            <span class="diff-col-label">Saved version</span>
            <span class="diff-col-label">Current item</span>
        </div>
        ${rows.join('')}
    `;
}

function diffRow(key, oldVal, newVal, cls) {
    return `<div class="diff-row ${cls}">
        <span class="diff-key">${escapeHtml(key)}</span>
        <span class="diff-old">${oldVal !== null ? `<code>${escapeHtml(oldVal)}</code>` : '<em class="diff-nil">—</em>'}</span>
        <span class="diff-new">${newVal !== null ? `<code>${escapeHtml(newVal)}</code>` : '<em class="diff-nil">—</em>'}</span>
    </div>`;
}

function clearDiff() {
    const diffEl = $('#version-diff');
    if (diffEl) diffEl.innerHTML = '<p class="diff-placeholder">Select a version on the left to see the diff.</p>';
    $('#version-restore-btn').disabled = true;
}

function diffSummary(oldObj, newObj) {
    const changes = [];
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const k of allKeys) {
        if (!(k in oldObj)) changes.push(`+${k}`);
        else if (!(k in newObj)) changes.push(`-${k}`);
        else if (JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])) changes.push(`~${k}`);
    }
    return changes;
}

