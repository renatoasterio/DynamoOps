import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { tableApi } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { escapeHtml } from '../utils/html.js';

const MAX_RECORDS = 200;
const POLL_INTERVAL_MS = 3000;

let pollTimer      = null;
let isPaused       = false;
let streamArn      = null;
let records        = [];
let isOpen         = false;

const dom = {
    get panel()       { return $('#streams-panel'); },
    get toggleBtn()   { return $('#stream-toggle-btn'); },
    get statusBadge() { return $('#stream-status-badge'); },
    get feed()        { return $('#stream-feed'); },
    get pauseBtn()    { return $('#stream-pause-btn'); },
    get clearBtn()    { return $('#stream-clear-btn'); },
    get countEl()     { return $('#stream-record-count'); },
    get emptyMsg()    { return $('#stream-empty-msg'); },
};

export function initStreamsPanel() {
    if (!dom.toggleBtn) return;

    dom.toggleBtn.addEventListener('click', togglePanel);
    dom.pauseBtn?.addEventListener('click', togglePause);
    dom.clearBtn?.addEventListener('click', clearFeed);

    // Reset when table changes or logout
    document.addEventListener('tabChanged', () => closePanel());
    document.addEventListener('resetDataViewerRequest', () => closePanel());
}

// ── Open / Close ──────────────────────────────────────────────────────────────
async function togglePanel() {
    if (isOpen) { closePanel(); return; }

    if (!state.currentTable) {
        showToast('Select a table first', 'info');
        return;
    }

    // Check stream status
    try {
        const status = await tableApi('GET', '/stream');

        if (!status.enabled) {
            showToast('Stream is not enabled for this table. Enable it in AWS Console → Table → Exports and streams.', 'warning');
            return;
        }

        streamArn = status.streamArn;
        // Short label keeps the toolbar on one row; the full view type is in the tooltip.
        const SHORT = { KEYS_ONLY: 'KEYS', NEW_IMAGE: 'NEW', OLD_IMAGE: 'OLD', NEW_AND_OLD_IMAGES: 'NEW+OLD' };
        dom.statusBadge.textContent = SHORT[status.viewType] || status.viewType || 'ENABLED';
        dom.statusBadge.title = `Stream view type: ${status.viewType || 'ENABLED'}`;
        dom.statusBadge.classList.remove('hidden');
    } catch (err) {
        showToast(`Stream check failed: ${err.message}`, 'error');
        return;
    }

    isOpen    = true;
    isPaused  = false;
    records   = [];
    dom.panel.classList.remove('hidden');
    dom.toggleBtn.classList.add('active');
    dom.pauseBtn.textContent = '⏸ Pause';
    renderFeed();
    startPolling();
}

function closePanel() {
    isOpen = false;
    stopPolling();
    dom.panel?.classList.add('hidden');
    dom.toggleBtn?.classList.remove('active');
    dom.statusBadge?.classList.add('hidden');
    streamArn = null;
    records   = [];
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
    stopPolling();
    poll(); // immediate first fetch
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
    if (!isOpen || isPaused || !streamArn) return;

    try {
        const data = await tableApi('GET', `/stream/records?streamArn=${encodeURIComponent(streamArn)}`);

        if (data.records?.length > 0) {
            records = [...records, ...data.records].slice(-MAX_RECORDS);
            renderFeed();
        }
    } catch { /* silent — stream may have been deleted */ }
}

function togglePause() {
    isPaused = !isPaused;
    dom.pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    if (!isPaused) poll();
}

function clearFeed() {
    records = [];
    renderFeed();
}

// ── Render ────────────────────────────────────────────────────────────────────
const OP_CONFIG = {
    INSERT: { label: 'INSERT', cls: 'stream-op-insert' },
    MODIFY: { label: 'MODIFY', cls: 'stream-op-modify' },
    REMOVE: { label: 'REMOVE', cls: 'stream-op-remove' },
};

function renderFeed() {
    const feed = dom.feed;
    if (!feed) return;

    if (records.length === 0) {
        feed.innerHTML = '';
        dom.emptyMsg?.classList.remove('hidden');
        if (dom.countEl) dom.countEl.textContent = '0 events';
        return;
    }

    dom.emptyMsg?.classList.add('hidden');
    if (dom.countEl) dom.countEl.textContent = `${records.length} events`;

    const wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;

    feed.innerHTML = records.slice().reverse().map(r => {
        const cfg  = OP_CONFIG[r.eventName] || { label: r.eventName, cls: '' };
        const time = new Date(r.timestamp).toLocaleTimeString();
        const keyStr = Object.entries(r.keys)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');

        let changeStr = '';
        if (r.eventName === 'MODIFY' && r.oldImage && r.newImage) {
            const diffs = diffSummary(r.oldImage, r.newImage);
            changeStr = diffs.length > 0
                ? `<span class="stream-change">${escapeHtml(diffs.slice(0, 3).join(' · '))}${diffs.length > 3 ? ` +${diffs.length - 3} more` : ''}</span>`
                : '';
        } else if (r.eventName === 'INSERT' && r.newImage) {
            const attrCount = Object.keys(r.newImage).length;
            changeStr = `<span class="stream-change">${attrCount} attributes</span>`;
        }

        return `<div class="stream-record">
            <span class="stream-time">${time}</span>
            <span class="stream-op ${cfg.cls}">${cfg.label}</span>
            <span class="stream-keys">${escapeHtml(keyStr)}</span>
            ${changeStr}
        </div>`;
    }).join('');

    if (wasAtBottom) feed.scrollTop = 0; // newest is at top
}

function diffSummary(oldObj, newObj) {
    const changes = [];
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const k of allKeys) {
        if (!(k in oldObj))  changes.push(`+${k}`);
        else if (!(k in newObj)) changes.push(`-${k}`);
        else if (JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])) changes.push(`~${k}`);
    }
    return changes;
}

