import { $ } from '../utils/dom.js';
import { api } from '../api/apiClient.js';
import { loadTables } from './Sidebar.js';
import { applyConnectedState } from './LoginManager.js';

// The login screen (LoginManager) owns connecting, Assume Role and SSO.
// This module only keeps the header role badge in sync and restores the
// session on startup when the embedded backend is already connected.
const dom = {
    roleBadge: $('#role-badge'),
    roleBadgeText: $('#role-badge-text'),
};

export function initConnectionManager() {
    document.addEventListener('roleAssumed', (e) => {
        showRoleBadge(e.detail.roleArn);
    });
}

function showRoleBadge(roleArn) {
    const roleName = roleArn.split('/').pop() || roleArn;
    if (dom.roleBadgeText) dom.roleBadgeText.textContent = roleName;
    dom.roleBadge?.classList.remove('hidden');
}

/**
 * After a page reload the backend may still hold a session. Restore the UI to
 * that exact session — region, profile, endpoint, env tag — before loading
 * anything; otherwise requests go out with the default config (no endpoint),
 * i.e. to real AWS with the default credentials instead of e.g. LocalStack.
 */
export async function fetchInitialConfig() {
    let conf;
    try {
        conf = await api('GET', '/config');
    } catch {
        return; // backend not reachable yet — stay on the login screen
    }
    if (!conf.connected) return;

    applyConnectedState({
        region: conf.region,
        profile: conf.profile,
        endpoint: conf.endpoint || '',
        envTag: conf.envTag || 'none',
    });
    if (conf.assumedRole) showRoleBadge(conf.assumedRole.roleArn);
    loadTables();
    document.dispatchEvent(new CustomEvent('connectionSuccess'));
}
