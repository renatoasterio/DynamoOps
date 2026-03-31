import { $, $$ } from '../utils/dom.js';
import { state, config } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { loadTables } from './Sidebar.js';

const dom = {
    // Basic Connection
    regionSelect: $('#region-select'),
    profileInput: $('#profile-input'),
    endpointInput: $('#endpoint-input'),
    connectBtn: $('#connect-btn'),
    connStatus: $('#conn-status'),
    // Assume Role modal
    assumeRoleBtn: $('#assume-role-btn'),
    assumeRoleOverlay: $('#assume-role-overlay'),
    assumeRoleCloseBtn: $('#assume-role-close-btn'),
    arRoleArn: $('#ar-role-arn'),
    arSessionName: $('#ar-session-name'),
    arRegion: $('#ar-region'),
    arProfile: $('#ar-profile'),
    arError: $('#ar-error'),
    arCmdPreview: $('#ar-cmd-preview'),
    arCancelBtn: $('#ar-cancel-btn'),
    arLoginBtn: $('#ar-login-btn'),
    roleBadge: $('#role-badge'),
    roleBadgeText: $('#role-badge-text')
};

export function initConnectionManager() {
    dom.connectBtn?.addEventListener('click', async () => {
        const region = dom.regionSelect?.value;
        const profile = dom.profileInput?.value.trim();
        const endpoint = dom.endpointInput?.value.trim();

        if (dom.connStatus) { dom.connStatus.className = 'status connecting'; dom.connStatus.textContent = 'Connecting…'; }

        try {
            await api('POST', '/connect', { region, profile, endpoint });
            state.connected = true;
            config.region = region;
            config.profile = profile;
            config.endpoint = endpoint;

            if (dom.connStatus) { dom.connStatus.className = 'status connected'; dom.connStatus.textContent = 'Connected'; }
            showToast(`Connected to ${region}`, 'success');
            loadTables();
        } catch (err) {
            state.connected = false;
            if (dom.connStatus) { dom.connStatus.className = 'status disconnected'; dom.connStatus.textContent = 'Failed'; }
            showToast(err.message, 'error');
        }
    });

    // Assume Role Handlers
    function openAssumeRoleModal() {
        dom.arError?.classList.add('hidden');
        dom.assumeRoleOverlay?.classList.remove('hidden');
        dom.arRoleArn?.focus();
        updateCmdPreview();
    }

    function closeAssumeRoleModal() {
        dom.assumeRoleOverlay?.classList.add('hidden');
    }

    dom.assumeRoleBtn?.addEventListener('click', openAssumeRoleModal);
    dom.assumeRoleCloseBtn?.addEventListener('click', closeAssumeRoleModal);
    dom.arCancelBtn?.addEventListener('click', closeAssumeRoleModal);
    dom.assumeRoleOverlay?.addEventListener('click', (e) => {
        if (e.target === dom.assumeRoleOverlay) closeAssumeRoleModal();
    });

    function updateCmdPreview() {
        const roleArn = dom.arRoleArn?.value.trim() || '<ROLE_ARN>';
        const sessionName = dom.arSessionName?.value.trim() || 'dev-session';
        if (dom.arCmdPreview) dom.arCmdPreview.textContent = `aws sts assume-role \\\n  --role-arn ${roleArn} \\\n  --role-session-name ${sessionName}`;
    }

    dom.arRoleArn?.addEventListener('input', updateCmdPreview);
    dom.arSessionName?.addEventListener('input', updateCmdPreview);

    dom.arLoginBtn?.addEventListener('click', async () => {
        const roleArn = dom.arRoleArn?.value.trim();
        const sessionName = dom.arSessionName?.value.trim() || 'dev-session';
        const region = dom.arRegion?.value;
        const profile = dom.arProfile?.value.trim() || 'default';

        if (!roleArn) {
            if (dom.arError) { dom.arError.textContent = 'Role ARN is required.'; dom.arError.classList.remove('hidden'); }
            return;
        }

        if (dom.arLoginBtn) { dom.arLoginBtn.disabled = true; dom.arLoginBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></span> Authenticating…'; }
        dom.arError?.classList.add('hidden');
        if (dom.connStatus) { dom.connStatus.className = 'status connecting'; dom.connStatus.textContent = 'Assuming role…'; }

        try {
            const result = await api('POST', '/assume-role', { roleArn, sessionName, region, profile });
            state.connected = true;
            if (dom.connStatus) { dom.connStatus.className = 'status connected'; dom.connStatus.textContent = 'Connected'; }

            showRoleBadge(roleArn);
            showToast(`Assumed role successfully! Session: ${sessionName}`, 'success');
            closeAssumeRoleModal();
            loadTables();
        } catch (err) {
            if (dom.connStatus) { dom.connStatus.className = 'status disconnected'; dom.connStatus.textContent = 'Failed'; }
            if (dom.arError) { dom.arError.textContent = err.message; dom.arError.classList.remove('hidden'); }
        } finally {
            if (dom.arLoginBtn) { dom.arLoginBtn.disabled = false; dom.arLoginBtn.innerHTML = '<span class="btn-icon">🔐</span> Login & Connect'; }
        }
    });

    document.addEventListener('roleAssumed', (e) => {
        showRoleBadge(e.detail.roleArn);
    });
}

export function showRoleBadge(roleArn) {
    const roleName = roleArn.split('/').pop() || roleArn;
    dom.roleBadgeText.textContent = roleName;
    dom.roleBadge.classList.remove('hidden');
}

export async function fetchInitialConfig() {
    try {
        const conf = await api('GET', '/config');
        if (dom.regionSelect) dom.regionSelect.value = conf.region || 'us-east-1';
        if (dom.profileInput) dom.profileInput.value = conf.profile || 'default';
        if (dom.endpointInput) dom.endpointInput.value = conf.endpoint || '';

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
