import { $ } from '../utils/dom.js';
import { state, config } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { api } from '../api/apiClient.js';

export function initTabManager() {
    const tabBar = $('#tab-bar');
    if (!tabBar) return;

    tabBar.addEventListener('click', (e) => {
        const tabEl = e.target.closest('.tab-item');
        if (!tabEl) return;

        const tabId = tabEl.dataset.id;
        if (e.target.classList.contains('tab-close')) {
            closeTab(tabId);
        } else {
            switchTab(tabId);
        }
    });

    document.addEventListener('updateTabColumns', (e) => {
        const { table, columns } = e.detail;
        const targetTab = state.tabs.find(t => t.table === table);
        if (targetTab) {
            targetTab.allColumns = columns;
        }
    });
}

export async function openTab(tableName) {
    // Check if tab already exists for this table
    const existingTab = state.tabs.find(t => t.table === tableName);
    if (existingTab) {
        switchTab(existingTab.id);
        return;
    }

    // Create new tab
    const tabId = Date.now().toString();
    const newTab = {
        id: tabId,
        table: tableName,
        tableInfo: null,
        items: [],
        allColumns: [],
        lastKey: null,
        nextToken: null,
        queryMode: 'scan',
        filterOpen: false,
        queryState: null, // Will be populated on switch
        viewMode: 'table',
        connection: { ...config } // Capture current connection
    };

    state.tabs.push(newTab);
    await switchTab(tabId);
    
    // Auto-execute scan for new tab
    try {
        const result = await api('GET', `/tables/${tableName}`, null, { connection: newTab.connection });
        const tableInfo = result.table;
        newTab.tableInfo = tableInfo;
        
        // Update current state if this is still the active tab
        if (state.activeTabId === tabId) {
            state.tableInfo = tableInfo;
            document.dispatchEvent(new CustomEvent('populateQueryFieldsRequest', { detail: { table: tableInfo } }));
            document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
        }
    } catch (err) {
        showToast(`Error loading table ${tableName}: ${err.message}`, 'error');
    }
}

export async function switchTab(tabId) {
    // 1. Save current active tab state
    if (state.activeTabId) {
        const currentTab = state.tabs.find(t => t.id === state.activeTabId);
        if (currentTab) {
            currentTab.tableInfo = state.tableInfo;
            currentTab.items = state.items;
            currentTab.allColumns = state.allColumns;
            currentTab.lastKey = state.lastEvaluatedKey;
            currentTab.nextToken = state.nextToken;
            currentTab.queryMode = state.queryMode;
            currentTab.filterOpen = state.filterOpen;
            currentTab.viewMode = state.viewMode;
            
            document.dispatchEvent(new CustomEvent('saveTabStateRequest', { detail: { tab: currentTab } }));
        }
    }

    // 2. Load new active tab state
    const nextTab = state.tabs.find(t => t.id === tabId);
    if (!nextTab) return;

    state.activeTabId = tabId;
    state.currentTable = nextTab.table;
    state.tableInfo = nextTab.tableInfo;
    state.items = nextTab.items;
    state.allColumns = nextTab.allColumns;
    state.lastEvaluatedKey = nextTab.lastKey;
    state.nextToken = nextTab.nextToken;
    state.queryMode = nextTab.queryMode;
    state.filterOpen = nextTab.filterOpen;
    state.viewMode = nextTab.viewMode;

    // 3. Update UI
    renderTabs();
    updateMainContentVisibility();

    if (state.tableInfo) {
        document.dispatchEvent(new CustomEvent('populateQueryFieldsRequest', { detail: { table: state.tableInfo } }));
        if (nextTab.queryState) {
            document.dispatchEvent(new CustomEvent('setQueryStateRequest', { detail: { queryState: nextTab.queryState } }));
        }
        document.dispatchEvent(new CustomEvent('renderDataRequest'));
    }

    // Show toolbar/info bar
    $('#table-info-bar').classList.remove('hidden');
    $('#toolbar').classList.remove('hidden');
    $('#welcome-state').classList.add('hidden');

    document.dispatchEvent(new CustomEvent('tabChanged', { detail: { table: state.currentTable } }));
}

export function closeTab(tabId) {
    const index = state.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    state.tabs.splice(index, 1);

    if (state.activeTabId === tabId) {
        if (state.tabs.length > 0) {
            const nextTab = state.tabs[Math.max(0, index - 1)];
            switchTab(nextTab.id);
        } else {
            state.activeTabId = null;
            state.currentTable = null;
            renderTabs();
            document.dispatchEvent(new CustomEvent('tabChanged', { detail: { table: null } }));
            updateMainContentVisibility();
            document.dispatchEvent(new CustomEvent('resetDataViewerRequest'));
            $('#table-info-bar').classList.add('hidden');
            $('#toolbar').classList.add('hidden');
            $('#welcome-state').classList.remove('hidden');
        }
    } else {
        renderTabs();
    }
}

export function getActiveTabConnection() {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    return activeTab ? activeTab.connection : config;
}

function renderTabs() {
    const tabBar = $('#tab-bar');
    if (!tabBar) return;

    if (state.tabs.length === 0) {
        tabBar.innerHTML = '';
        tabBar.classList.add('hidden');
        return;
    }

    tabBar.classList.remove('hidden');
    tabBar.innerHTML = state.tabs.map(tab => `
        <div class="tab-item ${tab.id === state.activeTabId ? 'active' : ''}" data-id="${tab.id}">
            <span class="tab-icon">📊</span>
            <span class="tab-title" title="${tab.table}">${tab.table}</span>
            <span class="tab-close">✕</span>
        </div>
    `).join('');
}

function updateMainContentVisibility() {
    // This could also handle showing/hiding welcome state
}
