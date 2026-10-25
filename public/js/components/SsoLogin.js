// SsoLogin.js — "Sign in with AWS in the browser" (IAM Identity Center / SSO)
// on the login screen. Steps: form → waiting for the browser → pick account
// and role → connect. LoginManager owns the shared Connect button and calls
// handleSsoSubmit(); everything else about the flow lives here.
import { $ } from '../utils/dom.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { escapeHtml } from '../utils/html.js';
import { loadJSON, saveJSON } from '../utils/storage.js';

const LAST_KEY = 'dynamo-gui-sso-last';

const dom = {};
let ctx = {};
let step = 'form';          // 'form' | 'waiting' | 'pick'
let session = null;         // { sessionId, startUrl, ssoRegion }
let pollTimer = null;
let preselect = null;       // { accountId, roleName } to auto-select after sign-in
let autoConnect = false;    // true when launched from a saved/recent profile
let accounts = [];

function queryDom() {
    dom.pane       = $('#login-pane-sso');
    dom.form       = $('#login-sso-form');
    dom.startUrl   = $('#login-sso-start-url');
    dom.ssoRegion  = $('#login-sso-region');
    dom.dbRegion   = $('#login-sso-db-region');
    dom.chips      = $('#login-sso-profiles');
    dom.wait       = $('#login-sso-wait');
    dom.code       = $('#login-sso-code');
    dom.reopen     = $('#login-sso-reopen');
    dom.cancel     = $('#login-sso-cancel');
    dom.pick       = $('#login-sso-pick');
    dom.account    = $('#login-sso-account');
    dom.role       = $('#login-sso-role');
    dom.pickInfo   = $('#login-sso-pick-info');
    dom.save       = $('#login-sso-save');
    dom.nameGroup  = $('#login-sso-name-group');
    dom.name       = $('#login-sso-save-name');
    dom.signout    = $('#login-sso-signout');
    dom.back       = $('#login-sso-back');
    dom.submitBtn  = $('#login-submit-btn');
    dom.testBtn    = $('#login-test-btn');
    dom.error      = $('#login-error');
}

function isSsoTabActive() {
    return document.querySelector('.login-tab.active')?.dataset.tab === 'sso';
}

export function submitLabel() {
    if (step === 'pick') return 'Connect';
    if (step === 'waiting') return 'Waiting for browser…';
    return '🌐 Sign in with AWS in browser';
}

function setStep(next) {
    step = next;
    dom.form?.classList.toggle('hidden', step !== 'form');
    dom.wait?.classList.toggle('hidden', step !== 'waiting');
    dom.pick?.classList.toggle('hidden', step !== 'pick');
    if (isSsoTabActive() && dom.submitBtn) {
        dom.submitBtn.textContent = submitLabel();
        dom.submitBtn.disabled = step === 'waiting';
        dom.testBtn?.classList.add('hidden');
    }
}

function showError(msg) {
    if (!dom.error) return;
    dom.error.textContent = msg;
    dom.error.classList.remove('hidden');
    // The login form area scrolls; make sure the message is actually visible
    dom.error.scrollIntoView({ block: 'nearest' });
}
function clearError() { dom.error?.classList.add('hidden'); }

function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function rememberLast(extra = {}) {
    saveJSON(LAST_KEY, {
        startUrl: dom.startUrl?.value.trim(),
        ssoRegion: dom.ssoRegion?.value,
        region: dom.dbRegion?.value,
        ...extra,
    });
}
const readLast = () => loadJSON(LAST_KEY, null);

/** Fills the form (from a saved profile, ~/.aws/config chip or last use). */
export function prefillSso(p = {}) {
    const sso = p.sso || p;
    if (dom.startUrl && sso.startUrl) dom.startUrl.value = sso.startUrl;
    if (dom.ssoRegion && sso.ssoRegion) dom.ssoRegion.value = sso.ssoRegion;
    if (dom.dbRegion && (p.region || sso.region)) dom.dbRegion.value = p.region || sso.region;
    if (p.envTag && ctx.setEnvPicker) ctx.setEnvPicker('#login-sso-env-picker', p.envTag);
    preselect = (sso.accountId || sso.roleName) ? { accountId: sso.accountId, roleName: sso.roleName } : null;
}

export function resetSsoFlow() {
    stopPolling();
    session = null;
    autoConnect = false;
    setStep('form');
}

// ─── ~/.aws/config chips ──────────────────────────────────────────────────────
async function loadConfigChips() {
    if (!dom.chips) return;
    try {
        const { profiles } = await api('GET', '/sso/config');
        if (!profiles?.length) { dom.chips.classList.add('hidden'); return; }
        dom.chips.innerHTML = `<span class="sso-chips-label">From ~/.aws/config:</span>` + profiles.map((p, i) => `
            <button type="button" class="sso-chip" data-idx="${i}" title="${escapeHtml(`${p.startUrl}${p.accountId ? ` · ${p.accountId}` : ''}${p.roleName ? ` / ${p.roleName}` : ''}`)}">${escapeHtml(p.profile)}</button>`).join('');
        dom.chips.classList.remove('hidden');
        dom.chips.querySelectorAll('.sso-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                const p = profiles[Number(btn.dataset.idx)];
                prefillSso({ sso: p, region: p.region || dom.dbRegion?.value });
                dom.chips.querySelectorAll('.sso-chip').forEach((b) => b.classList.toggle('active', b === btn));
            });
        });
    } catch {
        dom.chips.classList.add('hidden');
    }
}

// ─── Flow ─────────────────────────────────────────────────────────────────────
async function startFlow() {
    const startUrl = dom.startUrl?.value.trim();
    const ssoRegion = dom.ssoRegion?.value;
    if (!startUrl) { showError('Enter your SSO start URL (e.g. https://my-org.awsapps.com/start).'); dom.startUrl?.focus(); return; }
    clearError();
    rememberLast();

    setStep('waiting');
    if (dom.code) dom.code.textContent = '…';
    try {
        const res = await api('POST', '/sso/start', { startUrl, region: ssoRegion });
        session = { sessionId: res.sessionId, startUrl, ssoRegion, interval: res.interval || 5 };
        if (res.authorized) {
            showToast(res.source === 'aws-cli' ? 'Reusing your aws sso login session' : 'Signed in (cached session)', 'success');
            await afterAuthorized();
            return;
        }
        if (dom.code) dom.code.textContent = res.userCode || '';
        dom.reopen?.setAttribute('href', res.verificationUriComplete || res.verificationUri || '#');
        openBrowser(res.verificationUriComplete || res.verificationUri);
        schedulePoll(res.interval || 5);
    } catch (err) {
        setStep('form');
        showError(err.message);
    }
}

function openBrowser(url) {
    if (!url) return;
    // In Electron the window-open handler forwards this to the default browser.
    window.open(url, '_blank', 'noopener');
}

function schedulePoll(seconds) {
    stopPolling();
    pollTimer = setTimeout(pollOnce, Math.max(1, seconds) * 1000);
}

async function pollOnce() {
    if (!session || step !== 'waiting') return;
    try {
        const r = await api('POST', '/sso/poll', { sessionId: session.sessionId });
        if (r.status === 'authorized') { await afterAuthorized(); return; }
        // Honour the interval returned by StartDeviceAuthorization; back off when asked to slow down
        if (r.status === 'pending')    { schedulePoll(r.slowDown ? session.interval + 5 : session.interval); return; }
        if (r.status === 'expired')    { setStep('form'); showError('The sign-in request expired. Try again.'); return; }
        if (r.status === 'denied')     { setStep('form'); showError('Sign-in was denied in the browser.'); return; }
        setStep('form'); showError('Sign-in session was lost. Try again.');
    } catch (err) {
        setStep('form');
        showError(err.message);
    }
}

async function afterAuthorized() {
    stopPolling();
    try {
        const { accounts: list } = await api('GET', `/sso/accounts?sessionId=${encodeURIComponent(session.sessionId)}`);
        accounts = list || [];
        if (!accounts.length) throw new Error('Your SSO user has no AWS accounts assigned.');
        dom.account.innerHTML = accounts.map((a) =>
            `<option value="${a.accountId}">${escapeHtml(a.accountName || a.accountId)} (${a.accountId})</option>`).join('');
        const wanted = preselect?.accountId && accounts.find((a) => a.accountId === preselect.accountId);
        dom.account.value = wanted ? wanted.accountId : accounts[0].accountId;
        await loadRoles();
        setStep('pick');
        if (dom.pickInfo) dom.pickInfo.textContent = `Signed in to ${session.startUrl.replace(/^https?:\/\//, '')}`;

        if (autoConnect && preselect?.roleName && dom.role.value === preselect.roleName) {
            await connectSelected();
        }
    } catch (err) {
        setStep('form');
        showError(err.message);
    } finally {
        autoConnect = false;
    }
}

async function loadRoles() {
    const accountId = dom.account?.value;
    if (!accountId) return;
    dom.role.innerHTML = '<option>Loading…</option>';
    const { roles } = await api('GET', `/sso/roles?sessionId=${encodeURIComponent(session.sessionId)}&accountId=${encodeURIComponent(accountId)}`);
    const list = roles || [];
    dom.role.innerHTML = list.length
        ? list.map((r) => `<option value="${escapeHtml(r.roleName)}">${escapeHtml(r.roleName)}</option>`).join('')
        : '<option value="">No roles in this account</option>';
    if (preselect?.roleName && list.some((r) => r.roleName === preselect.roleName)) dom.role.value = preselect.roleName;
}

async function connectSelected() {
    const accountId = dom.account?.value;
    const roleName  = dom.role?.value;
    if (!accountId || !roleName) { showError('Choose an account and a role.'); return; }
    const account = accounts.find((a) => a.accountId === accountId);
    const region  = dom.dbRegion?.value || 'us-east-1';
    const envTag  = ctx.getEnvPickerValue ? ctx.getEnvPickerValue('#login-sso-env-picker') : 'none';

    if (ctx.resetPreviousSession) await ctx.resetPreviousSession();

    const result = await api('POST', '/sso/connect', {
        sessionId: session.sessionId, accountId, roleName, accountName: account?.accountName || '', region, endpoint: '', envTag,
    });
    rememberLast({ accountId, roleName });

    const params = {
        region, envTag,
        startUrl: session.startUrl, ssoRegion: session.ssoRegion,
        accountId, accountName: account?.accountName || '', roleName,
        save: !!dom.save?.checked, profileName: dom.name?.value.trim() || '',
    };
    ctx.onConnected?.(result, params);
    setStep('form');
}

/** Called by LoginManager when the main Connect button is pressed on the SSO tab. */
export async function handleSsoSubmit() {
    if (step === 'form') { await startFlow(); return; }
    if (step === 'pick') { await connectSelected(); return; }
}

/** Saved / recent profile: prefill and run the whole flow with the stored account/role. */
export async function connectSsoProfile(p) {
    prefillSso(p);
    autoConnect = true;
    await startFlow();
}

export function initSsoLogin(context = {}) {
    ctx = context;
    queryDom();
    if (!dom.pane) return;

    const last = readLast();
    if (last) prefillSso({ sso: last, region: last.region });

    dom.account?.addEventListener('change', () => loadRoles().catch((e) => showError(e.message)));
    dom.save?.addEventListener('change', () => dom.nameGroup?.classList.toggle('hidden', !dom.save.checked));
    dom.reopen?.addEventListener('click', (e) => { e.preventDefault(); openBrowser(dom.reopen.getAttribute('href')); });
    dom.cancel?.addEventListener('click', (e) => { e.preventDefault(); resetSsoFlow(); });
    dom.back?.addEventListener('click', (e) => { e.preventDefault(); resetSsoFlow(); });
    dom.signout?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (session) {
            try { await api('POST', '/sso/signout', { startUrl: session.startUrl, region: session.ssoRegion }); } catch { /* ignore */ }
        }
        showToast('SSO session forgotten. Next sign-in will open the browser.', 'info');
        resetSsoFlow();
    });
    dom.startUrl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startFlow(); } });

    loadConfigChips();
    setStep('form');
}
