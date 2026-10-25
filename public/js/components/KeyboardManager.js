import { state } from '../state/store.js';
import { closeTab, switchTab } from './TabManager.js';
import { executeQuery } from './QueryPanel.js';
import { $ } from '../utils/dom.js';
import { setSidebarCollapsed, toggleSidebar } from './Sidebar.js';

export function initKeyboardManager() {
    document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
    // Escape: close topmost open modal
    if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal-overlay:not(.hidden)');
        if (openModal) {
            openModal.classList.add('hidden');
            e.preventDefault();
        }
        return;
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Cmd/Ctrl+Shift+L — License window. Works everywhere (login screen too),
    // even with focus inside an input.
    if (e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        window.licenseManager?.showLicenseModal();
        return;
    }

    const tag = document.activeElement?.tagName;
    // Allow Cmd+Enter inside textareas (SQL editor), block other shortcuts in inputs
    const isInput = (tag === 'INPUT' || tag === 'SELECT') ||
        (tag === 'TEXTAREA' && e.key.toLowerCase() !== 'enter');

    if (isInput && e.key.toLowerCase() !== 'enter') return;

    switch (e.key.toLowerCase()) {
        case 'enter': // Cmd+Enter — Execute query (single handler; ItemManager defers to this one)
            if (state.currentTable && !isAnyModalOpen()) {
                e.preventDefault();
                executeQuery(false);
            }
            break;

        case 'w': // Cmd+W — Close active tab
            if (state.activeTabId && !isAnyModalOpen()) {
                e.preventDefault();
                closeTab(state.activeTabId);
            }
            break;

        case 'r': // Cmd+R — Refresh
            if (state.currentTable) {
                e.preventDefault();
                executeQuery(false);
            }
            break;

        case ']': // Cmd+] — Next tab
            if (state.tabs.length > 1) {
                e.preventDefault();
                navigateTabs(1);
            }
            break;

        case '[': // Cmd+[ — Prev tab
            if (state.tabs.length > 1) {
                e.preventDefault();
                navigateTabs(-1);
            }
            break;

        case 'f': // Cmd+F — Focus table search
            if (!isInput) {
                e.preventDefault();
                const search = $('#table-search-input');
                if (search) { search.focus(); search.select(); }
            }
            break;

        case 'b': // Cmd+B — Collapse / expand sidebar
            e.preventDefault();
            toggleSidebar();
            break;

        case 'k': { // Cmd+K — Focus sidebar table filter (expands it if collapsed)
            e.preventDefault();
            setSidebarCollapsed(false);
            const sidebarSearch = $('#table-search');
            if (sidebarSearch) { sidebarSearch.focus(); sidebarSearch.select(); }
            break;
        }
    }
}

function navigateTabs(direction) {
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx === -1) return;
    const next = (idx + direction + state.tabs.length) % state.tabs.length;
    switchTab(state.tabs[next].id);
}

function isAnyModalOpen() {
    // Generic modals share .modal-overlay; the item editor and delete dialogs have their own overlays.
    return !!document.querySelector('.modal-overlay:not(.hidden), #modal-overlay:not(.hidden), #delete-overlay:not(.hidden)');
}
