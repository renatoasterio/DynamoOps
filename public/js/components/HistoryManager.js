import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { escapeHtml } from '../utils/html.js';
import { loadJSON, saveJSON } from '../utils/storage.js';

const STORAGE_KEY = 'dynamo-gui-query-history';
const MAX_HISTORY = 50;

const getHistory = () => loadJSON(STORAGE_KEY, []);
const saveHistory = (history) => saveJSON(STORAGE_KEY, history);

export function initHistoryManager() {
    const toggleBtn = $('#history-toggle-btn');
    const panel = $('#history-panel');
    const clearBtn = $('#history-clear-btn');

    if (!toggleBtn || !panel) return;

    toggleBtn.addEventListener('click', () => {
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        toggleBtn.classList.toggle('active', isHidden);
        if (isHidden) renderHistory();
    });

    clearBtn.addEventListener('click', () => {
        if (confirm('Clear all query history?')) {
            saveHistory([]);
            renderHistory();
            showToast('History cleared', 'info');
        }
    });

    // Initial render if visible
    if (!panel.classList.contains('hidden')) renderHistory();
}

export function addToHistory(type, params) {
    const history = getHistory();
    const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        table: state.currentTable,
        type,
        params
    };

    // Prevent duplicates (simple comparison of stringified params)
    const paramsStr = JSON.stringify(params);
    const exists = history.some(h => h.table === entry.table && h.type === entry.type && JSON.stringify(h.params) === paramsStr);
    
    if (exists) {
        // Move to top
        const index = history.findIndex(h => h.table === entry.table && h.type === entry.type && JSON.stringify(h.params) === paramsStr);
        history.splice(index, 1);
    }

    history.unshift(entry);
    
    if (history.length > MAX_HISTORY) history.pop();
    
    saveHistory(history);
    renderHistory();
}

function renderHistory() {
    const list = $('#history-list');
    if (!list) return;

    const history = getHistory();
    if (history.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-style:italic;padding:10px">No history items yet.</p>';
        return;
    }

    list.innerHTML = history.map(entry => {
        const snippet = getSnippet(entry);
        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="history-item" data-id="${escapeHtml(entry.id)}">
                <div class="history-item-info">
                    <div class="history-item-top">
                        <span class="history-item-type ${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span>
                        <span class="history-item-table">${escapeHtml(entry.table)}</span>
                    </div>
                    <div class="history-item-snippet">${escapeHtml(snippet)}</div>
                </div>
                <div class="history-item-time">${time}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            const entry = getHistory().find(h => h.id === id);
            if (entry) {
                document.dispatchEvent(new CustomEvent('loadHistoryEntry', { detail: { entry } }));
            }
        });
    });
}

function getSnippet(entry) {
    const p = entry.params;
    if (entry.type === 'sql') return p.statement;
    if (entry.type === 'query') {
        let s = `PK: ${p.expressionAttributeValues[':pkval']}`;
        if (p.keyConditionExpression.includes('AND')) s += ` | SK filter active`;
        return s;
    }
    if (entry.type === 'scan') {
        return p.filterExpression || '(All items)';
    }
    return '';
}
