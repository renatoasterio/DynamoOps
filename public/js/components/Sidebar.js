import { $ } from '../utils/dom.js';
import { api } from '../api/apiClient.js';
import { state, config } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { openTab } from './TabManager.js';
import { switchToAssumeRole } from './LoginManager.js';

const dom = {
    tableSearch: $('#table-search'),
    tableList: $('#table-list'),
    refreshBtn: $('#refresh-tables-btn'),
};

export function initSidebar() {
    dom.tableSearch.addEventListener('input', (e) => renderTableList(e.target.value));
    dom.refreshBtn.addEventListener('click', loadTables);

    document.addEventListener('tabChanged', () => renderTableList());
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
        <div class="sae-title">Acesso negado</div>
        <div class="sae-user">${escHtml(shortId)}</div>
        <div class="sae-desc">Sem permissão para <code>dynamodb:ListTables</code>.<br>Use Assume Role para conectar com uma role que tenha acesso.</div>
        <button class="sae-btn" id="sae-assume-btn">Assumir Role →</button>
      </li>`;

    $('#sae-assume-btn')?.addEventListener('click', () => switchToAssumeRole());
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        .map((t) => `<li data-table="${t}" class="${t === state.currentTable ? 'active' : ''}">${t}</li>`)
        .join('');

    dom.tableList.querySelectorAll('li[data-table]').forEach((li) => {
        li.addEventListener('click', () => openTab(li.dataset.table));
    });
}
