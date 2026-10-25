import { $ } from '../utils/dom.js';
import { api } from '../api/apiClient.js';
import { state, config } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { openTab } from './TabManager.js';
import { switchToAssumeRole } from './LoginManager.js';
import { escapeHtml } from '../utils/html.js';
import { loadString, saveString } from '../utils/storage.js';

const dom = {
    tableSearch: $('#table-search'),
    tableList: $('#table-list'),
    refreshBtn: $('#refresh-tables-btn'),
    sidebar: $('#sidebar'),
    collapseBtn: $('#sidebar-collapse-btn'),
    expandBtn: $('#sidebar-expand-btn'),
};

const COLLAPSED_KEY = 'dynamoops.sidebarCollapsed';

export function initSidebar() {
    dom.tableSearch.addEventListener('input', (e) => renderTableList(e.target.value));
    dom.refreshBtn.addEventListener('click', loadTables);

    // Collapse / expand — the collapsed state is remembered between sessions
    setSidebarCollapsed(loadString(COLLAPSED_KEY) === '1');
    if (!/Mac/i.test(navigator.platform || '')) {
        [dom.collapseBtn, dom.expandBtn].forEach(btn => { if (btn) btn.title = btn.title.replace('⌘', 'Ctrl+'); });
    }
    dom.collapseBtn?.addEventListener('click', () => setSidebarCollapsed(true));
    dom.expandBtn?.addEventListener('click', () => setSidebarCollapsed(false));

    document.addEventListener('tabChanged', () => renderTableList());
}

export function setSidebarCollapsed(collapsed) {
    dom.sidebar.classList.toggle('collapsed', collapsed);
    saveString(COLLAPSED_KEY, collapsed ? '1' : '0');
}

export function toggleSidebar() {
    setSidebarCollapsed(!dom.sidebar.classList.contains('collapsed'));
}

export async function loadTables() {
    try {
        const { tables } = await api('GET', '/tables', null, { connection: config });
        state.tables = tables;
        renderTableList();
    } catch (err) {
        const msg = err.message || '';
        const isAuthError = msg.includes('not authorized') || msg.includes('AccessDenied') || msg.includes('is not authorized to perform');

        if (isAuthError) {
            showAccessDeniedBanner(msg);
        } else {
            showToast(`Failed to load tables: ${msg}`, 'error');
        }
    }
}

function showAccessDeniedBanner(detail) {
    const list = dom.tableList;
    if (!list) return;

    // Extract the ARN of the user for display
    const arnMatch = detail.match(/User:\s*(arn:[^\s]+)/);
    const userArn  = arnMatch ? arnMatch[1] : null;
    const shortId  = userArn ? userArn.split('/').pop() : 'current user';

    list.innerHTML = `
      <li class="sidebar-auth-error">
        <div class="sae-icon">🔒</div>
        <div class="sae-title">Access denied</div>
        <div class="sae-user">${escapeHtml(shortId)}</div>
        <div class="sae-desc">No permission for <code>dynamodb:ListTables</code>.<br>Use Assume Role to connect with a role that has access.</div>
        <button class="sae-btn" id="sae-assume-btn">Assume Role →</button>
      </li>`;

    $('#sae-assume-btn')?.addEventListener('click', () => switchToAssumeRole());
}

export function renderTableList(filter = '') {
    const filtered = filter
        ? state.tables.filter((t) => t.toLowerCase().includes(filter.toLowerCase()))
        : state.tables;

    if (filtered.length === 0) {
        dom.tableList.innerHTML = `<li class="empty-state">${state.tables.length === 0 ? 'No tables found' : 'No matching tables'}</li>`;
        return;
    }

    dom.tableList.innerHTML = filtered
        .map((t) => `<li data-table="${escapeHtml(t)}" class="${t === state.currentTable ? 'active' : ''}">${escapeHtml(t)}</li>`)
        .join('');

    dom.tableList.querySelectorAll('li[data-table]').forEach((li) => {
        li.addEventListener('click', () => openTab(li.dataset.table));
    });
}
