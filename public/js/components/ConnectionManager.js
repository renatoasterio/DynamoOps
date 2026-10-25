import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { loadTables } from './Sidebar.js';

// The login screen (LoginManager) owns connecting, Assume Role and SSO.
// This module only keeps the header role badge in sync and restores the
// session on startup when the embedded backend is already connected.
const dom = {
    connStatus: $('#conn-status'),
    roleBadge: $('#role-badge'),
    roleBadgeText: $('#role-badge-text'),
};

export function initConnectionManager() {
    document.addEventListener('roleAssumed', (e) => {
        showRoleBadge(e.detail.roleArn);
    });
}

export function showRoleBadge(roleArn) {
    const roleName = roleArn.split('/').pop() || roleArn;
    if (dom.roleBadgeText) dom.roleBadgeText.textContent = roleName;
    dom.roleBadge?.classList.remove('hidden');
}

export async function fetchInitialConfig() {
    try {
        const conf = await api('GET', '/config');
        if (conf.connected) {
            if (conf.assumedRole) showRoleBadge(conf.assumedRole.roleArn);
            if (dom.connStatus) { dom.connStatus.className = 'status connected'; dom.connStatus.textContent = 'Connected'; }
            state.connected = true;
            loadTables();
            document.dispatchEvent(new CustomEvent('connectionSuccess'));
        }
    } catch {
        // ignore error on load
    }
}
