'use strict';

/**
 * AWS IAM Identity Center (SSO) sign-in for the desktop app.
 *
 * Flow (same as `aws sso login`, OAuth 2.0 device authorization):
 *   1. startLogin()  → RegisterClient (cached ~90 days) + StartDeviceAuthorization
 *                      → the UI opens verificationUriComplete in the browser
 *   2. pollLogin()   → CreateToken until the user finishes in the browser
 *   3. listAccounts / listRoles → user picks account + permission set
 *   4. connect()     → GetRoleCredentials → temporary AWS credentials wired into
 *                      config/aws.js exactly like an assumed role
 *   5. ensureFreshCredentials() renews the role credentials transparently while
 *      the SSO access token (≈8h) is still valid.
 *
 * Access tokens are cached in <userData>/sso-cache.json (mode 0600) so the
 * browser step is skipped on the next launch; an existing `aws sso login`
 * token in ~/.aws/sso/cache is reused as well.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
    SSOOIDCClient, RegisterClientCommand, StartDeviceAuthorizationCommand, CreateTokenCommand,
} = require('@aws-sdk/client-sso-oidc');
const {
    SSOClient, ListAccountsCommand, ListAccountRolesCommand, GetRoleCredentialsCommand,
} = require('@aws-sdk/client-sso');
const awsConfig = require('../config/aws');

const CLIENT_NAME       = 'DynamoOps';
const GRANT_TYPE        = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const SAFETY_MS         = 60 * 1000;

// ─── Storage ──────────────────────────────────────────────────────────────────

function getUserDataPath() {
    try {
        const { app } = require('electron');
        return app.getPath('userData');
    } catch {
        const dir = path.join(os.homedir(), '.dynamoops');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }
}

function cacheFile() { return path.join(getUserDataPath(), 'sso-cache.json'); }

function readCache() {
    try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) || {}; } catch { return {}; }
}

function writeCache(data) {
    const file = cacheFile();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
}

function normalizeStartUrl(url) {
    let s = String(url || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    return s.replace(/\/+$/, '');
}

function tokenKey(startUrl, region) { return `${normalizeStartUrl(startUrl)}|${region}`; }

// ─── SDK clients (replaceable in tests) ───────────────────────────────────────

let makeOidcClient = (region) => new SSOOIDCClient({ region });
let makeSsoClient  = (region) => new SSOClient({ region });

// ─── In-memory state ──────────────────────────────────────────────────────────

const pending  = new Map(); // sessionId → device authorization in progress
const sessions = new Map(); // sessionId → { accessToken, expiresAt, region, startUrl }

// ─── Error mapping ────────────────────────────────────────────────────────────

/**
 * The SSO-OIDC API reports problems as { name, error, error_description } with
 * message "UnknownError"; turn that into something a person can act on.
 */
function describeSsoError(err, context) {
    const name = err?.name || err?.__type || '';
    const detail = err?.error_description && err.error_description !== 'Invalid request'
        ? ` (${err.error_description})`
        : '';
    if (context === 'start' && (name === 'InvalidRequestException' || err?.error === 'invalid_request')) {
        return new Error(`AWS did not recognize this SSO start URL in the selected SSO region${detail}. ` +
            'Check the access portal URL (it looks like https://<org>.awsapps.com/start) and the region where IAM Identity Center is enabled.');
    }
    if (name === 'InvalidClientException') {
        return new Error('The cached client registration is no longer valid. Try again — DynamoOps will register a new one.');
    }
    if (name === 'UnauthorizedClientException' || name === 'UnauthorizedException') {
        return new Error('AWS rejected the sign-in request. Make sure your user has access to this access portal.');
    }
    if (name === 'TooManyRequestsException' || name === 'SlowDownException') {
        return new Error('AWS is rate-limiting sign-in requests. Wait a moment and try again.');
    }
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|NetworkingError/i.test(String(err?.code || err?.name || err?.message))) {
        return new Error('Could not reach AWS. Check your internet connection or VPN and try again.');
    }
    const msg = err?.message && err.message !== 'UnknownError' ? err.message : (err?.error_description || name || 'Unknown error');
    return new Error(`${context === 'start' ? 'SSO sign-in failed' : 'SSO request failed'}: ${msg}`);
}

// ─── Client registration (cached per region) ──────────────────────────────────

async function getRegisteredClient(region) {
    const cache = readCache();
    const cached = cache.clients?.[region];
    if (cached && cached.clientSecretExpiresAt > Date.now() + SAFETY_MS) return cached;

    const res = await makeOidcClient(region).send(new RegisterClientCommand({
        clientName: CLIENT_NAME,
        clientType: 'public',
        scopes: ['sso:account:access'],
    }));
    const reg = {
        clientId: res.clientId,
        clientSecret: res.clientSecret,
        clientSecretExpiresAt: (res.clientSecretExpiresAt || 0) * 1000,
    };
    cache.clients = { ...(cache.clients || {}), [region]: reg };
    writeCache(cache);
    return reg;
}

// ─── Token cache (ours + AWS CLI's) ──────────────────────────────────────────

function findCachedToken(startUrl, region) {
    const cache = readCache();
    const own = cache.tokens?.[tokenKey(startUrl, region)];
    if (own && own.expiresAt > Date.now() + SAFETY_MS) return { ...own, source: 'cache' };

    // Reuse an `aws sso login` session from the CLI cache
    try {
        const dir = path.join(os.homedir(), '.aws', 'sso', 'cache');
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.json')) continue;
            let j;
            try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
            if (!j?.accessToken || !j.startUrl) continue;
            if (normalizeStartUrl(j.startUrl) !== normalizeStartUrl(startUrl)) continue;
            if (j.region && j.region !== region) continue;
            const exp = Date.parse(j.expiresAt);
            if (exp > Date.now() + SAFETY_MS) {
                return { accessToken: j.accessToken, expiresAt: exp, region, startUrl: normalizeStartUrl(startUrl), source: 'aws-cli' };
            }
        }
    } catch { /* no CLI cache directory */ }
    return null;
}

function storeToken(startUrl, region, token) {
    const cache = readCache();
    cache.tokens = {
        ...(cache.tokens || {}),
        [tokenKey(startUrl, region)]: { accessToken: token.accessToken, expiresAt: token.expiresAt, region, startUrl: normalizeStartUrl(startUrl) },
    };
    writeCache(cache);
}

function createSession(startUrl, region, token) {
    const id = crypto.randomUUID();
    sessions.set(id, { accessToken: token.accessToken, expiresAt: token.expiresAt, region, startUrl: normalizeStartUrl(startUrl) });
    return id;
}

function requireSession(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) throw new Error('SSO session not found. Please sign in again.');
    if (s.expiresAt < Date.now()) { sessions.delete(sessionId); throw new Error('SSO session expired. Please sign in again.'); }
    return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the sign-in. When a valid token is cached the browser step is
 * skipped and { authorized: true } is returned straight away.
 */
async function startLogin({ startUrl, region }) {
    const url = normalizeStartUrl(startUrl);
    if (!url) throw new Error('SSO start URL is required (e.g. https://my-org.awsapps.com/start)');
    if (!region) throw new Error('SSO region is required');

    const cached = findCachedToken(url, region);
    if (cached) {
        return { sessionId: createSession(url, region, cached), authorized: true, expiresAt: cached.expiresAt, source: cached.source };
    }

    let client, auth;
    try {
        client = await getRegisteredClient(region);
        auth = await makeOidcClient(region).send(new StartDeviceAuthorizationCommand({
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            startUrl: url,
        }));
    } catch (err) {
        if (err?.name === 'InvalidClientException') {
            // stale registration → drop it so the next attempt re-registers
            const cache = readCache();
            if (cache.clients) { delete cache.clients[region]; writeCache(cache); }
        }
        throw describeSsoError(err, 'start');
    }

    const sessionId = crypto.randomUUID();
    pending.set(sessionId, {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        deviceCode: auth.deviceCode,
        region,
        startUrl: url,
        interval: auth.interval || 5,
        expiresAt: Date.now() + (auth.expiresIn || 600) * 1000,
    });

    return {
        sessionId,
        authorized: false,
        userCode: auth.userCode,
        verificationUri: auth.verificationUri,
        verificationUriComplete: auth.verificationUriComplete,
        expiresIn: auth.expiresIn || 600,
        interval: auth.interval || 5,
    };
}

/** Polls the device authorization. Returns { status: 'pending'|'authorized'|'expired'|'denied'|'unknown' }. */
async function pollLogin(sessionId) {
    if (sessions.has(sessionId)) return { status: 'authorized', expiresAt: sessions.get(sessionId).expiresAt };
    const p = pending.get(sessionId);
    if (!p) return { status: 'unknown' };
    if (Date.now() > p.expiresAt) { pending.delete(sessionId); return { status: 'expired' }; }

    try {
        const res = await makeOidcClient(p.region).send(new CreateTokenCommand({
            clientId: p.clientId,
            clientSecret: p.clientSecret,
            grantType: GRANT_TYPE,
            deviceCode: p.deviceCode,
        }));
        const token = { accessToken: res.accessToken, expiresAt: Date.now() + (res.expiresIn || 8 * 3600) * 1000 };
        storeToken(p.startUrl, p.region, token);
        pending.delete(sessionId);
        sessions.set(sessionId, { ...token, region: p.region, startUrl: p.startUrl });
        return { status: 'authorized', expiresAt: token.expiresAt };
    } catch (err) {
        const name = err?.name || err?.__type || '';
        if (name === 'AuthorizationPendingException') return { status: 'pending' };
        if (name === 'SlowDownException')             return { status: 'pending', slowDown: true };
        if (name === 'ExpiredTokenException')         { pending.delete(sessionId); return { status: 'expired' }; }
        if (name === 'AccessDeniedException')         { pending.delete(sessionId); return { status: 'denied' }; }
        throw describeSsoError(err, 'poll');
    }
}

async function listAccounts(sessionId) {
    const s = requireSession(sessionId);
    const client = makeSsoClient(s.region);
    const out = [];
    let nextToken;
    do {
        let r;
        try { r = await client.send(new ListAccountsCommand({ accessToken: s.accessToken, nextToken, maxResults: 100 })); }
        catch (err) { throw describeSsoError(err, 'accounts'); }
        (r.accountList || []).forEach((a) => out.push({ accountId: a.accountId, accountName: a.accountName || '', email: a.emailAddress || '' }));
        nextToken = r.nextToken;
    } while (nextToken);
    out.sort((a, b) => a.accountName.localeCompare(b.accountName) || a.accountId.localeCompare(b.accountId));
    return out;
}

async function listRoles(sessionId, accountId) {
    if (!accountId) throw new Error('accountId is required');
    const s = requireSession(sessionId);
    const client = makeSsoClient(s.region);
    const out = [];
    let nextToken;
    do {
        let r;
        try { r = await client.send(new ListAccountRolesCommand({ accessToken: s.accessToken, accountId, nextToken, maxResults: 100 })); }
        catch (err) { throw describeSsoError(err, 'roles'); }
        (r.roleList || []).forEach((x) => out.push({ roleName: x.roleName }));
        nextToken = r.nextToken;
    } while (nextToken);
    out.sort((a, b) => a.roleName.localeCompare(b.roleName));
    return out;
}

async function getRoleCredentials(session, accountId, roleName) {
    let r;
    try {
        r = await makeSsoClient(session.region).send(new GetRoleCredentialsCommand({
            accessToken: session.accessToken, accountId, roleName,
        }));
    } catch (err) { throw describeSsoError(err, 'credentials'); }
    const c = r.roleCredentials;
    if (!c?.accessKeyId) throw new Error('No credentials returned for this account/role');
    return {
        AccessKeyId: c.accessKeyId,
        SecretAccessKey: c.secretAccessKey,
        SessionToken: c.sessionToken,
        Expiration: new Date(c.expiration),
    };
}

/** Fetches role credentials and wires them into the app's AWS clients (like an assumed role). */
async function connect({ sessionId, accountId, roleName, accountName, region, endpoint }) {
    const s = requireSession(sessionId);
    if (!accountId || !roleName) throw new Error('Account and role are required');

    const creds = await getRoleCredentials(s, accountId, roleName);
    const newConfig = { region: region || 'us-east-1', profile: 'sso', endpoint: endpoint || '' };

    awsConfig.setCurrentConfig(newConfig);
    awsConfig.createClients(newConfig, creds);
    awsConfig.setAssumedRoleInfo({
        roleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
        sessionName: 'sso',
        expiration: creds.Expiration.toISOString(),
        assumedAt: new Date().toISOString(),
        sso: {
            sessionId,
            accountId,
            accountName: accountName || '',
            roleName,
            startUrl: s.startUrl,
            ssoRegion: s.region,
            tokenExpiresAt: s.expiresAt,
        },
    });
    return { config: newConfig, role: awsConfig.assumedRoleInfo };
}

let refreshing = null;

/**
 * Renews SSO role credentials when they are about to expire, as long as the
 * SSO token is still valid. Called by the connection middleware on every
 * request; cheap when nothing needs to happen. Resolves to true if renewed.
 */
async function ensureFreshCredentials() {
    const info = awsConfig.assumedRoleInfo;
    if (!info?.sso) return false;
    const expMs = Date.parse(info.expiration);
    if (!expMs || expMs - Date.now() > REFRESH_BEFORE_MS) return false;
    if (refreshing) return refreshing;

    refreshing = (async () => {
        const s = sessions.get(info.sso.sessionId);
        if (!s || s.expiresAt < Date.now()) return false;
        const creds = await getRoleCredentials(s, info.sso.accountId, info.sso.roleName);
        awsConfig.createClients(awsConfig.currentConfig, creds);
        awsConfig.setAssumedRoleInfo({ ...info, expiration: creds.Expiration.toISOString(), assumedAt: new Date().toISOString() });
        return true;
    })().finally(() => { refreshing = null; });
    return refreshing;
}

/** Forgets the cached token for a start URL (next sign-in goes through the browser again). */
function signOut({ startUrl, region }) {
    const url = normalizeStartUrl(startUrl);
    for (const [id, s] of sessions) {
        if (s.startUrl === url && (!region || s.region === region)) sessions.delete(id);
    }
    const cache = readCache();
    if (cache.tokens) {
        for (const key of Object.keys(cache.tokens)) {
            if (key.startsWith(`${url}|`) && (!region || key.endsWith(`|${region}`))) delete cache.tokens[key];
        }
        writeCache(cache);
    }
    return { success: true };
}

/** SSO-enabled profiles from ~/.aws/config ([sso-session] and legacy sso_* keys). */
function readAwsConfigProfiles() {
    const file = path.join(os.homedir(), '.aws', 'config');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }

    const sections = {};
    let current = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const header = line.match(/^\[(.+)\]$/);
        if (header) { current = header[1].trim(); sections[current] = {}; continue; }
        const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
        if (kv && current) sections[current][kv[1].trim()] = kv[2].trim();
    }

    const ssoSessions = {};
    for (const [name, v] of Object.entries(sections)) {
        const m = name.match(/^sso-session\s+(.+)$/);
        if (m) ssoSessions[m[1]] = v;
    }

    const out = [];
    for (const [name, v] of Object.entries(sections)) {
        const m = name.match(/^profile\s+(.+)$/);
        const profile = m ? m[1] : (name === 'default' ? 'default' : null);
        if (!profile) continue;
        const sess = v.sso_session ? ssoSessions[v.sso_session] : null;
        const startUrl = v.sso_start_url || sess?.sso_start_url;
        if (!startUrl) continue;
        out.push({
            profile,
            startUrl: normalizeStartUrl(startUrl),
            ssoRegion: v.sso_region || sess?.sso_region || v.region || 'us-east-1',
            accountId: v.sso_account_id || '',
            roleName: v.sso_role_name || '',
            region: v.region || '',
        });
    }
    return out;
}

module.exports = {
    startLogin,
    pollLogin,
    listAccounts,
    listRoles,
    connect,
    ensureFreshCredentials,
    signOut,
    readAwsConfigProfiles,
    normalizeStartUrl,
    describeSsoError,
    // test hooks
    _setClientFactories(oidc, sso) { if (oidc) makeOidcClient = oidc; if (sso) makeSsoClient = sso; },
    _reset() { pending.clear(); sessions.clear(); refreshing = null; },
};
