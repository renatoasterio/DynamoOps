import { $, $$ } from '../utils/dom.js';
import { api } from '../api/apiClient.js';
import { state, config } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { loadTables } from './Sidebar.js';
import { initSsoLogin, handleSsoSubmit, connectSsoProfile, prefillSso, resetSsoFlow, submitLabel as ssoSubmitLabel } from './SsoLogin.js';

// ─── Env tag helpers ──────────────────────────────────────────────────────────
function getEnvPickerValue(pickerId) {
    return $(pickerId)?.querySelector('.env-pick-btn.active')?.dataset.env || 'none';
}

function setEnvPicker(pickerId, envTag) {
    const picker = $(pickerId);
    if (!picker) return;
    picker.querySelectorAll('.env-pick-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.env === (envTag || 'none'));
    });
}

function showEnvBadge(envTag) {
    const badge = $('#env-tag-badge');
    if (!badge) return;
    if (!envTag || envTag === 'none') {
        badge.classList.add('hidden');
        return;
    }
    badge.textContent = envTag.toUpperCase();
    badge.className   = `env-badge env-badge-${envTag}`;
}

function updateConnInfoBadge(region, endpoint) {
    const badge    = $('#conn-info-badge');
    const provider = $('#conn-info-provider');
    const regionEl = $('#conn-info-region');
    if (!badge || !provider || !regionEl) return;

    const isLocal = endpoint && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes('localstack'));
    provider.textContent = isLocal ? '⚡ LocalStack' : '☁ AWS';
    provider.className   = `conn-info-provider ${isLocal ? 'provider-localstack' : 'provider-aws'}`;
    regionEl.textContent = region || '';
    badge.classList.remove('hidden');
}

function hideConnInfoBadge() {
    const badge = $('#conn-info-badge');
    if (badge) badge.classList.add('hidden');
}

const dom = {
    screen: null,
    tabs: null,
    panes: null,
    submitBtn: null,
    testBtn: null,
    error: null,
    profilesList: null,
    region: null,
    profile: null,
    endpoint: null,
    saveCheckbox: null,
    profileNameGroup: null,
    profileNameInput: null,
    arAccountId: null,
    arRoleName: null,
    arRole: null,
    arSession: null,
    arRegion: null,
    arProfile: null,
    arSaveCheckbox: null,
    arNameGroup: null,
    arNameInput: null,
    appLayout: null,
    mainHeader: null,
    switchConnBtn: null,
};

function queryDom() {
    dom.screen = $('#login-screen');
    dom.tabs = $$('.login-tab');
    dom.panes = $$('.login-form-pane');
    dom.submitBtn = $('#login-submit-btn');
    dom.testBtn = $('#login-test-btn');
    dom.error = $('#login-error');
    dom.profilesList = $('#login-profiles-list');
    
    dom.region = $('#login-region');
    dom.profile = $('#login-profile');
    dom.endpoint = $('#login-endpoint');
    dom.saveCheckbox = $('#login-save-profile');
    dom.profileNameGroup = $('#login-profile-name-group');
    dom.profileNameInput = $('#login-save-name');
    
    dom.arAccountId = $('#login-ar-account-id');
    dom.arRoleName = $('#login-ar-role-name');
    dom.arRole = $('#login-ar-role');
    dom.arSession = $('#login-ar-session');
    dom.arRegion = $('#login-ar-region');
    dom.arProfile = $('#login-ar-profile');
    dom.arSaveCheckbox = $('#login-ar-save');
    dom.arNameGroup = $('#login-ar-name-group');
    dom.arNameInput = $('#login-ar-save-name');
    
    dom.appLayout = $('#app-layout');
    dom.mainHeader = $('#main-header');
    dom.switchConnBtn = $('#switch-conn-btn');
    dom.logoutBtn = $('#logout-btn');
}

let activeTab = 'quick';

function parseRoleArn(arn) {
    const match = arn && arn.match(/^arn:aws(?:-cn|-us-gov)?:iam::(\d+):role\/(.+)$/);
    return match ? { accountId: match[1], roleName: match[2] } : null;
}

function buildRoleArn(accountId, roleName) {
    return `arn:aws:iam::${accountId.trim()}:role/${roleName.trim()}`;
}

export function initLoginManager() {
    queryDom();
    if (!dom.screen) {
        console.error('LoginManager: #login-screen not found');
        return;
    }

    // Env tag pickers — toggle active on click
    ['#login-env-picker', '#login-ar-env-picker', '#login-sso-env-picker'].forEach(sel => {
        $(sel)?.querySelectorAll('.env-pick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.env-picker').querySelectorAll('.env-pick-btn')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });

    // Assume Role: keep hidden ARN input in sync with Account ID + Role Name fields
    if (dom.arAccountId) dom.arAccountId.addEventListener('input', syncArnFromParts);
    if (dom.arRoleName)  dom.arRoleName.addEventListener('input',  syncArnFromParts);

    // Header common actions
    if (dom.switchConnBtn) {
        dom.switchConnBtn.addEventListener('click', () => showLogin());
    }


    if (dom.logoutBtn) {
        dom.logoutBtn.addEventListener('click', logout);
    }

    // Tab switching
    dom.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            switchTab(target);
        });
    });

    // Submit & Test buttons
    if (dom.submitBtn) dom.submitBtn.addEventListener('click', handleConnect);
    if (dom.testBtn) {
        dom.testBtn.addEventListener('click', handleTestConnection);
    }

    // Checkbox toggles
    if (dom.saveCheckbox) {
        dom.saveCheckbox.addEventListener('change', () => {
            if (dom.profileNameGroup) dom.profileNameGroup.classList.toggle('hidden', !dom.saveCheckbox.checked);
        });
    }
    if (dom.arSaveCheckbox) {
        dom.arSaveCheckbox.addEventListener('change', () => {
            if (dom.arNameGroup) dom.arNameGroup.classList.toggle('hidden', !dom.arSaveCheckbox.checked);
        });
    }

    // Listen for profile requests from Sidebar/Header
    document.addEventListener('requestAssumeRole', (e) => {
        const p = e.detail;
        showLogin();
        switchTab('assume');
        if (dom.arRole) dom.arRole.value = p.roleArn || '';
        if (dom.arSession) dom.arSession.value = p.sessionName || '';
        if (dom.arRegion) dom.arRegion.value = p.region || 'us-east-1';
        if (dom.arProfile) dom.arProfile.value = p.awsProfile || 'default';
        // Populate the Account ID + Role Name helper fields
        if (p.roleArn) {
            const parsed = parseRoleArn(p.roleArn);
            if (parsed) {
                if (dom.arAccountId) dom.arAccountId.value = parsed.accountId;
                if (dom.arRoleName) dom.arRoleName.value = parsed.roleName;
            }
        }
        if (p.envTag) setEnvPicker('#login-ar-env-picker', p.envTag);
        showToast('Assume Role profile details loaded. Click Connect to proceed.', 'info');
    });

    // AWS SSO (IAM Identity Center) sign-in via browser
    initSsoLogin({
        resetPreviousSession,
        getEnvPickerValue,
        setEnvPicker,
        onConnected: finishSsoConnect,
    });
    document.addEventListener('requestSsoLogin', (e) => {
        showLogin();
        switchTab('sso');
        prefillSso(e.detail || {});
        showToast('SSO profile loaded. Click "Sign in with AWS in browser".', 'info');
    });

    // Handle profiles update event
    document.addEventListener('profilesUpdated', () => {
        if (activeTab === 'profiles') renderLoginProfiles();
    });

    document.addEventListener('connectionSuccess', () => {
        hideLogin();
    });
}

export function switchToAssumeRole() {
    showLogin();
    switchTab('assume');
}

function switchTab(tabId) {
    activeTab = tabId;
    
    if (dom.tabs) dom.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    if (dom.panes) dom.panes.forEach(p => p.classList.toggle('hidden', p.id !== `login-pane-${tabId}`));
    
    if (tabId === 'profiles') {
        renderLoginProfiles();
    }
    if (tabId === 'assume') {
        renderRoleHistory();
    }
    
    // Update button text visibility
    if (dom.submitBtn) {
        if (tabId === 'profiles') {
            dom.submitBtn.classList.add('hidden');
            if (dom.testBtn) dom.testBtn.classList.add('hidden');
        } else if (tabId === 'sso') {
            dom.submitBtn.classList.remove('hidden');
            dom.submitBtn.disabled = false;
            if (dom.testBtn) dom.testBtn.classList.add('hidden');
            dom.submitBtn.textContent = ssoSubmitLabel();
        } else {
            dom.submitBtn.classList.remove('hidden');
            dom.submitBtn.disabled = false;
            if (dom.testBtn) dom.testBtn.classList.remove('hidden');
            dom.submitBtn.textContent = tabId === 'assume' ? 'Assume Role & Connect' : 'Connect to DynamoDB';
        }
    }
}

function getRecentConnections() {
    try {
        return JSON.parse(localStorage.getItem('dynamo-gui-recent') || '[]');
    } catch { return []; }
}

function trackRecentConnection(params) {
    let recent = getRecentConnections();
    const id = params.sso
        ? `recent-sso-${params.sso.startUrl}-${params.sso.accountId}-${params.sso.roleName}`
        : params.roleArn ? `recent-ar-${params.roleArn}` : `recent-${params.region}-${params.awsProfile}-${params.endpoint || ''}`;
    recent = recent.filter(r => r.id !== id);
    recent.unshift({ ...params, id, timestamp: Date.now() });
    recent = recent.slice(0, 5);
    localStorage.setItem('dynamo-gui-recent', JSON.stringify(recent));
}

// ─── Role History (per-tab assume-role history) ───────────────────────────────

const ROLE_HISTORY_KEY = 'dynamo-gui-role-history';

function getRoleHistory() {
    try { return JSON.parse(localStorage.getItem(ROLE_HISTORY_KEY) || '[]'); } catch { return []; }
}

function addRoleHistory(entry) {
    let history = getRoleHistory();
    // Deduplicate by roleArn + awsProfile
    history = history.filter(h => !(h.roleArn === entry.roleArn && h.awsProfile === entry.awsProfile));
    history.unshift({ ...entry, timestamp: Date.now() });
    history = history.slice(0, 10);
    localStorage.setItem(ROLE_HISTORY_KEY, JSON.stringify(history));
}

function renderRoleHistory() {
    const container = $('#ar-history-list');
    const wrapper   = $('#ar-role-history');
    if (!container || !wrapper) return;

    const history = getRoleHistory();
    if (!history.length) { wrapper.classList.add('hidden'); return; }

    wrapper.classList.remove('hidden');
    container.innerHTML = history.map((h, i) => {
        const parsed   = parseRoleArn(h.roleArn);
        const roleName = parsed?.roleName || h.roleArn;
        const accountId = parsed?.accountId || '';
        const envClass = h.envTag && h.envTag !== 'none' ? ` ar-hist-env-${h.envTag}` : '';
        return `
          <button class="ar-hist-item${envClass}" data-idx="${i}" type="button">
            <span class="ar-hist-role">${roleName}</span>
            <span class="ar-hist-meta">${accountId}${h.awsProfile !== 'default' ? ' · ' + h.awsProfile : ''}${h.envTag && h.envTag !== 'none' ? ' · ' + h.envTag.toUpperCase() : ''}</span>
          </button>`;
    }).join('');

    container.querySelectorAll('.ar-hist-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const h = history[parseInt(btn.dataset.idx)];
            const parsed = parseRoleArn(h.roleArn);
            if (parsed) {
                if (dom.arAccountId) dom.arAccountId.value = parsed.accountId;
                if (dom.arRoleName)  dom.arRoleName.value  = parsed.roleName;
            }
            if (dom.arProfile) dom.arProfile.value = h.awsProfile || 'default';
            if (dom.arRegion)  dom.arRegion.value  = h.region || 'us-east-1';
            if (dom.arSession) dom.arSession.value = h.sessionName || '';
            if (h.envTag) setEnvPicker('#login-ar-env-picker', h.envTag);
            syncArnFromParts();
        });
    });
}

function syncArnFromParts() {
    const accountId = dom.arAccountId ? dom.arAccountId.value.trim().replace(/-/g, '') : '';
    const roleName  = dom.arRoleName  ? dom.arRoleName.value.trim()  : '';
    if (accountId && roleName && dom.arRole) {
        dom.arRole.value = `arn:aws:iam::${accountId}:role/${roleName}`;
    }
}

function renderLoginProfiles() {
    if (!dom.profilesList) return;
    const profiles = JSON.parse(localStorage.getItem('dynamo-gui-profiles') || '{}');
    const recent = getRecentConnections();
    const profileKeys = Object.keys(profiles);
    
    let html = '';
    
    if (recent.length > 0) {
        html += '<div class="profile-section-label">Recent Connections</div>';
        html += recent.map(r => `
            <div class="saved-profile-item-login recent" data-id="${r.id}" data-type="recent">
                <div class="profile-info">
                    <div class="profile-name">${r.sso ? '🌐 AWS SSO' : r.roleArn ? '🛡️ Assume Role' : '⚡ Quick Connect'}</div>
                    <div class="profile-meta">${r.region} · ${r.sso ? `${r.sso.accountName || r.sso.accountId} / ${r.sso.roleName}` : r.roleArn ? r.roleArn.split('/').pop() : r.awsProfile}</div>
                </div>
                <div class="profile-action">→</div>
            </div>
        `).join('');
    }
    
    if (profileKeys.length > 0) {
        html += '<div class="profile-section-label">Saved Profiles</div>';
        html += profileKeys.map(name => {
            const p = profiles[name];
            return `
                <div class="saved-profile-item-login" data-id="${name}" data-type="saved">
                    <div class="profile-info">
                        <div class="profile-name">${name}</div>
                        <div class="profile-meta">${p.sso ? '🌐 ' : p.roleArn ? '🛡️ ' : ''}${p.region} · ${p.sso ? `${p.sso.accountName || p.sso.accountId} / ${p.sso.roleName}` : p.roleArn ? p.roleArn.split('/').pop() : p.awsProfile}</div>
                    </div>
                    <div class="profile-actions">
                        <button type="button" class="profile-delete-login" data-name="${name}" title="Delete saved profile">🗑</button>
                        <div class="profile-action">⚡</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    if (!html) {
        dom.profilesList.innerHTML = '<p style="color:var(--text-muted); font-style:italic; text-align:center; padding:20px;">No recent or saved connections.</p>';
        return;
    }
    
    dom.profilesList.innerHTML = html;
    
    dom.profilesList.querySelectorAll('.profile-delete-login').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = btn.dataset.name;
            if (!confirm(`Delete saved profile "${name}"?`)) return;
            const current = JSON.parse(localStorage.getItem('dynamo-gui-profiles') || '{}');
            delete current[name];
            localStorage.setItem('dynamo-gui-profiles', JSON.stringify(current));
            showToast(`Profile "${name}" deleted`, 'info');
            document.dispatchEvent(new CustomEvent('profilesUpdated'));
        });
    });

    dom.profilesList.querySelectorAll('.saved-profile-item-login').forEach(item => {
        item.addEventListener('click', async () => {
            const id = item.dataset.id;
            const type = item.dataset.type;
            const p = type === 'saved' ? profiles[id] : recent.find(r => r.id === id);

            if (!p) return;

            try {
                const envTag = p.envTag || 'none';
                if (p.sso) {
                    switchTab('sso');
                    await connectSsoProfile({ ...p, envTag });
                } else if (p.roleArn) {
                    await assumeRole(p.roleArn, p.sessionName, p.region, p.awsProfile, false, envTag);
                } else {
                    await connectWithParams(p.region, p.awsProfile, p.endpoint, false, envTag);
                }
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
}

async function handleConnect() {
    if (!dom.error || !dom.submitBtn) return;
    dom.error.classList.add('hidden');
    dom.submitBtn.disabled = true;
    const originalText = dom.submitBtn.innerHTML;
    dom.submitBtn.innerHTML = '<span class="spinner"></span> Connecting...';

    try {
        if (activeTab === 'quick') {
            const envTag = getEnvPickerValue('#login-env-picker');
            await connectWithParams(dom.region.value, dom.profile.value.trim(), dom.endpoint.value.trim(), true, envTag);
        } else if (activeTab === 'assume') {
            const roleArn = resolveRoleArn();
            const envTag  = getEnvPickerValue('#login-ar-env-picker');
            await assumeRole(roleArn, dom.arSession?.value.trim() || 'dev-session', dom.arRegion.value, dom.arProfile.value.trim(), true, envTag);
        } else if (activeTab === 'sso') {
            await handleSsoSubmit();
        }
    } catch (err) {
        dom.error.textContent = err.message;
        dom.error.classList.remove('hidden');
        dom.error.scrollIntoView({ block: 'nearest' });
    } finally {
        if (activeTab === 'sso') {
            // SsoLogin manages the button label/state per step
            dom.submitBtn.textContent = ssoSubmitLabel();
            dom.submitBtn.disabled = dom.submitBtn.textContent.startsWith('Waiting');
        } else {
            dom.submitBtn.disabled = false;
            dom.submitBtn.innerHTML = originalText;
        }
    }
}

/** Post-connect UI for an SSO session (mirrors assumeRole's success path). */
function finishSsoConnect(result, p) {
    if (p.save && p.profileName) {
        const profiles = JSON.parse(localStorage.getItem('dynamo-gui-profiles') || '{}');
        profiles[p.profileName] = {
            sso: { startUrl: p.startUrl, ssoRegion: p.ssoRegion, accountId: p.accountId, accountName: p.accountName, roleName: p.roleName },
            region: p.region, awsProfile: 'sso', envTag: p.envTag,
        };
        localStorage.setItem('dynamo-gui-profiles', JSON.stringify(profiles));
        document.dispatchEvent(new CustomEvent('profilesUpdated'));
        showToast(`SSO profile "${p.profileName}" saved locally.`, 'info');
    }
    trackRecentConnection({
        sso: { startUrl: p.startUrl, ssoRegion: p.ssoRegion, accountId: p.accountId, accountName: p.accountName, roleName: p.roleName },
        region: p.region, awsProfile: 'sso', envTag: p.envTag,
    });

    state.connected = true;
    config.region   = p.region;
    config.profile  = 'sso';
    config.endpoint = '';
    config.envTag   = p.envTag;
    showEnvBadge(p.envTag);
    updateConnInfoBadge(p.region, '');

    const connStatus = $('#conn-status');
    if (connStatus) {
        connStatus.className = 'status connected';
        connStatus.textContent = 'Connected';
    }
    if (result?.role?.roleArn) {
        document.dispatchEvent(new CustomEvent('roleAssumed', { detail: { roleArn: result.role.roleArn } }));
    }
    // Role credentials are renewed server-side while the SSO token lasts, so no
    // countdown prompt is needed here.
    clearSessionTimer();

    showToast(`Signed in as ${p.roleName} @ ${p.accountName || p.accountId}`, 'success');
    hideLogin();
    loadTables();
}

async function handleTestConnection() {
    if (!dom.error || !dom.testBtn) return;
    if (activeTab === 'sso') return; // no test step: the sign-in itself validates the session
    dom.error.classList.add('hidden');
    dom.testBtn.disabled = true;
    const originalText = dom.testBtn.innerHTML;
    dom.testBtn.innerHTML = '<span class="spinner"></span> Testing...';

    try {
        if (activeTab === 'quick') {
            await api('POST', '/connect', { 
                region: dom.region.value, 
                profile: dom.profile.value.trim(), 
                endpoint: dom.endpoint.value.trim() 
            });
            showToast('Connection test successful!', 'success');
        } else {
            const roleArn = resolveRoleArn();
            await api('POST', '/assume-role', {
                roleArn,
                sessionName: dom.arSession?.value.trim() || 'dev-session',
                region: dom.arRegion.value,
                profile: dom.arProfile.value.trim()
            });
            showToast('Assume Role test successful!', 'success');
        }
    } catch (err) {
        dom.error.textContent = `Test failed: ${err.message}`;
        dom.error.classList.remove('hidden');
        dom.error.scrollIntoView({ block: 'nearest' });
    } finally {
        dom.testBtn.disabled = false;
        dom.testBtn.innerHTML = originalText;
    }
}

function resolveRoleArn() {
    const accountId = dom.arAccountId ? dom.arAccountId.value.trim() : '';
    const roleName = dom.arRoleName ? dom.arRoleName.value.trim() : '';
    const fullArn = dom.arRole ? dom.arRole.value.trim() : '';

    if (accountId && roleName) {
        return buildRoleArn(accountId, roleName);
    }
    if (fullArn) {
        return fullArn;
    }
    throw new Error('Enter the Account ID and Role Name, or paste the full Role ARN.');
}

/**
 * Resets all client + server state from a previous connection so that a fresh
 * connect / assume-role starts with a clean slate.  Called automatically before
 * every new connection attempt.
 */
async function resetPreviousSession() {
    if (state.connected) {
        try { await api('POST', '/disconnect'); } catch (_) { /* ignore */ }
    }
    clearSessionTimer();

    state.tabs = [];
    state.activeTabId = null;
    state.currentTable = null;
    state.tableInfo = null;
    state.items = [];
    state.allColumns = [];
    state.lastEvaluatedKey = null;
    state.nextToken = null;
    state.lastQueryEndpoint = null;
    state.lastQueryParams = null;
    state.connected = false;
    state.tables = [];

    // Reset frontend connection config to prevent stale values
    config.region   = 'us-east-1';
    config.profile  = 'default';
    config.endpoint = '';
    config.envTag   = 'none';

    const tabBar = $('#tab-bar');
    if (tabBar) { tabBar.innerHTML = ''; tabBar.classList.add('hidden'); }

    // Clear sidebar
    const tableList = $('#table-list');
    if (tableList) tableList.innerHTML = '';

    document.dispatchEvent(new CustomEvent('resetDataViewerRequest'));
}

async function connectWithParams(region, profile, endpoint, allowSave = false, envTag = 'none') {
    await resetPreviousSession();

    if (allowSave && dom.saveCheckbox && dom.saveCheckbox.checked) {
        const profileName = dom.profileNameInput ? dom.profileNameInput.value.trim() : null;
        if (profileName) {
            const profiles = JSON.parse(localStorage.getItem('dynamo-gui-profiles') || '{}');
            profiles[profileName] = { region, awsProfile: profile, endpoint, envTag };
            localStorage.setItem('dynamo-gui-profiles', JSON.stringify(profiles));
            document.dispatchEvent(new CustomEvent('profilesUpdated'));
            showToast(`Profile "${profileName}" saved locally.`, 'info');
        }
    }

    try {
        await api('POST', '/connect', { region, profile, endpoint });
        trackRecentConnection({ region, awsProfile: profile, endpoint, envTag });

        state.connected  = true;
        config.region    = region;
        config.profile   = profile;
        config.endpoint  = endpoint;
        config.envTag    = envTag;
        showEnvBadge(envTag);
        updateConnInfoBadge(region, endpoint);

        const regionSel = $('#region-select');
        const profileInp = $('#profile-input');
        const endpointInp = $('#endpoint-input');
        if (regionSel) regionSel.value = region;
        if (profileInp) profileInp.value = profile;
        if (endpointInp) endpointInp.value = endpoint;

        const connStatus = $('#conn-status');
        if (connStatus) {
            connStatus.className = 'status connected';
            connStatus.textContent = 'Connected';
        }

        showToast(`Connected to ${region}`, 'success');
        hideLogin();
        loadTables();
    } catch (err) {
        throw new Error(`Connection failed: ${err.message}`);
    }
}

async function assumeRole(roleArn, sessionName, region, profile, allowSave = false, envTag = 'none') {
    if (!roleArn) throw new Error('Enter the Account ID and Role Name, or paste the full Role ARN.');
    await resetPreviousSession();

    if (allowSave && dom.arSaveCheckbox && dom.arSaveCheckbox.checked) {
        const profileName = dom.arNameInput ? dom.arNameInput.value.trim() : null;
        if (profileName) {
            const profiles = JSON.parse(localStorage.getItem('dynamo-gui-profiles') || '{}');
            profiles[profileName] = { roleArn, sessionName, region, awsProfile: profile, envTag };
            localStorage.setItem('dynamo-gui-profiles', JSON.stringify(profiles));
            document.dispatchEvent(new CustomEvent('profilesUpdated'));
            showToast(`Assume Role profile "${profileName}" saved locally.`, 'info');
        }
    }

    try {
        const result = await api('POST', '/assume-role', { roleArn, sessionName, region, profile, endpoint: '' });
        trackRecentConnection({ roleArn, sessionName, region, awsProfile: profile, envTag });
        addRoleHistory({ roleArn, sessionName, region, awsProfile: profile, envTag });

        state.connected = true;
        config.region   = region;
        config.profile  = profile;
        config.envTag   = envTag;
        showEnvBadge(envTag);
        updateConnInfoBadge(region, '');

        const connStatus = $('#conn-status');
        if (connStatus) {
            connStatus.className = 'status connected';
            connStatus.textContent = 'Connected';
        }
        document.dispatchEvent(new CustomEvent('roleAssumed', { detail: { roleArn } }));

        // Start expiration countdown using the STS-issued expiration time
        if (result?.role?.expiration) {
            startSessionExpirationTimer(result.role.expiration, roleArn, sessionName, region, profile, envTag);
        }

        showToast(`Assumed role successfully!`, 'success');
        hideLogin();
        loadTables();
    } catch (err) {
        throw new Error(`Assume Role failed: ${err.message}`);
    }
}

// ─── Session expiration timer ─────────────────────────────────────────────────

let _sessionTimerId   = null;
let _sessionCounterId = null;

function startSessionExpirationTimer(expiration, roleArn, sessionName, region, profile, envTag) {
    // Clear any previous timers
    clearInterval(_sessionTimerId);
    clearInterval(_sessionCounterId);

    const expiresAt  = new Date(expiration).getTime();
    const WARN_MS    = 5 * 60 * 1000;  // warn 5 min before expiry
    const warnAt     = expiresAt - WARN_MS;

    // Update the role badge every second with a countdown
    _sessionCounterId = setInterval(() => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            clearInterval(_sessionCounterId);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const badge = $('#role-badge-text');
        if (badge) {
            const roleName = roleArn.split('/').pop();
            badge.textContent = `${roleName} (${mins}:${secs.toString().padStart(2, '0')})`;
        }
    }, 1000);

    // Show renewal prompt when ≤5 min remain
    _sessionTimerId = setTimeout(() => {
        clearInterval(_sessionCounterId);
        _showRenewalPrompt(roleArn, sessionName, region, profile, envTag);
    }, Math.max(0, warnAt - Date.now()));
}

function _showRenewalPrompt(roleArn, sessionName, region, profile, envTag) {
    const overlay = document.createElement('div');
    overlay.id = 'session-renewal-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:9999'
    ].join(';');

    const parsed   = parseRoleArn(roleArn);
    const roleName = parsed?.roleName || roleArn;

    overlay.innerHTML = `
      <div style="background:var(--bg-elevated);border:1px solid var(--border-strong);border-radius:16px;padding:28px 32px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5)">
        <div style="font-size:32px;margin-bottom:12px">⏰</div>
        <h3 style="color:var(--text-primary);font-size:16px;margin-bottom:8px">Session expiring</h3>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:4px">The <strong style="color:var(--accent)">${roleName}</strong> session expires in less than 5 minutes.</p>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:20px">Renew now to continue without interruption.</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button id="session-renew-btn" style="background:var(--accent-gradient);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer">🔄 Renew Session</button>
          <button id="session-dismiss-btn" style="background:none;border:1px solid var(--border-default);color:var(--text-secondary);border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer">Ignore</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('session-dismiss-btn').addEventListener('click', () => overlay.remove());

    document.getElementById('session-renew-btn').addEventListener('click', async () => {
        overlay.remove();
        const btn = document.getElementById('session-renew-btn');
        try {
            await assumeRole(roleArn, sessionName || 'dev-session', region, profile, false, envTag);
            showToast('Session renewed successfully!', 'success');
        } catch (err) {
            showToast(`Renewal failed: ${err.message}`, 'error');
        }
    });

    // Hard-expire: if they didn't renew, show a blocking prompt after the session actually expires
    setTimeout(() => {
        if (!document.getElementById('session-renewal-overlay')) return;
        overlay.remove();
        _showSessionExpiredPrompt(roleArn, sessionName, region, profile, envTag);
    }, WARN_MS + 10000);

    const WARN_MS = 5 * 60 * 1000;
}

function _showSessionExpiredPrompt(roleArn, sessionName, region, profile, envTag) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.85)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:9999'
    ].join(';');

    const parsed   = parseRoleArn(roleArn);
    const roleName = parsed?.roleName || roleArn;

    overlay.innerHTML = `
      <div style="background:var(--bg-elevated);border:1px solid rgba(248,113,113,0.4);border-radius:16px;padding:28px 32px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.6)">
        <div style="font-size:32px;margin-bottom:12px">🔒</div>
        <h3 style="color:#f87171;font-size:16px;margin-bottom:8px">Session expired</h3>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:20px">The <strong>${roleName}</strong> session has expired. Renew to continue.</p>
        <button id="session-expired-renew-btn" style="background:var(--accent-gradient);color:#fff;border:none;border-radius:8px;padding:11px 24px;font-size:14px;font-weight:600;cursor:pointer;width:100%">🔄 Renew Now</button>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('session-expired-renew-btn').addEventListener('click', async () => {
        overlay.remove();
        try {
            await assumeRole(roleArn, sessionName || 'dev-session', region, profile, false, envTag);
            showToast('Session renewed!', 'success');
        } catch (err) {
            showToast(`Renewal failed: ${err.message}`, 'error');
            // Fall back to login screen
            logout();
        }
    });
}

export function clearSessionTimer() {
    clearInterval(_sessionTimerId);
    clearInterval(_sessionCounterId);
}

export function logout() {
    // Clear assumed role session on the server so the middleware resets
    api('POST', '/disconnect').catch(() => {});

    // Close all tabs and reset state
    state.tabs = [];
    state.activeTabId = null;
    state.currentTable = null;
    state.tableInfo = null;
    state.items = [];
    state.allColumns = [];
    state.lastEvaluatedKey = null;
    state.nextToken = null;
    state.connected = false;

    // Clear tab bar
    const tabBar = $('#tab-bar');
    if (tabBar) {
        tabBar.innerHTML = '';
        tabBar.classList.add('hidden');
    }

    // Reset data viewer
    document.dispatchEvent(new CustomEvent('resetDataViewerRequest'));

    // Update connection status badge
    const connStatus = $('#conn-status');
    if (connStatus) {
        connStatus.className = 'status disconnected';
        connStatus.textContent = 'Disconnected';
    }

    // Hide role badge
    const roleBadge = $('#role-badge');
    if (roleBadge) roleBadge.classList.add('hidden');

    // Clear env badge and connection info
    showEnvBadge('none');
    hideConnInfoBadge();
    config.envTag = 'none';

    showLogin();
}

export function hideLogin() {
    if (!dom.screen) queryDom();
    if (dom.screen) {
        dom.screen.style.opacity = '0';
        dom.screen.style.transform = 'scale(1.1)';
    }
    setTimeout(() => {
        if (dom.screen) dom.screen.classList.add('hidden');
        if (dom.appLayout) dom.appLayout.classList.remove('hidden');
        if (dom.mainHeader) dom.mainHeader.classList.remove('hidden');
    }, 400);
}

export function showLogin() {
    if (!dom.screen) queryDom();
    if (dom.screen) {
        dom.screen.classList.remove('hidden');
        setTimeout(() => {
            dom.screen.style.opacity = '1';
            dom.screen.style.transform = 'scale(1)';
        }, 10);
    }
    if (dom.appLayout) dom.appLayout.classList.add('hidden');
    if (dom.mainHeader) dom.mainHeader.classList.add('hidden');

    if (activeTab === 'profiles') renderLoginProfiles();
    if (activeTab === 'assume')   renderRoleHistory();
    if (activeTab === 'sso')      resetSsoFlow();
}
