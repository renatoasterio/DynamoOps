'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { jwtVerify, importSPKI } = require('jose');
const { machineIdSync } = require('node-machine-id');

// ─── Public key ───────────────────────────────────────────────────────────────
// Production key (same value as .env.production). DYNAMO_LICENSE_PUBLIC_KEY lets
// .env override it for local development against a dev license server.
const PUBLIC_KEY_PEM = process.env.DYNAMO_LICENSE_PUBLIC_KEY ||
`-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9jjq2HlhCkT+E9hd45KnacSdFac5
rSgB7wgAy0Tv1bavXpZDKPiCR3W6uuG/kQ6BdDNCY9fkYFrRnwA3QSq3FQ==
-----END PUBLIC KEY-----`;

const GRACE_PERIOD_MS              = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TIMEOUT_MS           = 5_000;
const ACTIVATE_TIMEOUT_MS          = 10_000;
const PERIODIC_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;     // 24h
const INITIAL_REFRESH_DELAY_MS     = 15 * 1000;               // shortly after startup
const PLAN_HIERARCHY = ['free', 'pro', 'pro_plus', 'team'];

/** Single source of truth for the license server URL (set by .env / .env.production). */
function getLicenseServerUrl() {
    return process.env.LICENSE_SERVER_URL || 'https://dynamoops.io';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserDataPath() {
    try {
        // Works only inside the Electron main process
        const { app } = require('electron');
        return app.getPath('userData');
    } catch {
        // Fallback for non-Electron / dev environments
        const dir = path.join(os.homedir(), '.dynamoops');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }
}

function getLicenseFilePath() {
    return path.join(getUserDataPath(), 'license.json');
}

function getCurrentMachineId() {
    // Test hook: allow E2E suites to pin a specific "machine" identity.
    // Has no effect in production — only triggered when the env var is set.
    const override = process.env.DYNAMO_TEST_MACHINE_ID;
    const input = override || machineIdSync({ original: true });
    return crypto.createHash('sha256').update(input).digest('hex');
}

/** Parsed license.json ({ token, suspendedAt? }) or null. */
function readLicenseFile() {
    const filePath = getLicenseFilePath();
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

function readRawToken() {
    return readLicenseFile()?.token || null;
}

function writeLicenseFile(data) {
    fs.writeFileSync(getLicenseFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * fetch with a hard timeout. Resolves to { res, body } where body is the parsed
 * JSON payload, or null when the response is not JSON (e.g. an HTML 404 page
 * from a misconfigured host — never to be mistaken for a license-server answer).
 */
async function fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        return { res, body: body && typeof body === 'object' ? body : null };
    } finally {
        clearTimeout(timer);
    }
}

// ─── Core: verify a JWT token and return a status object ─────────────────────

async function verifyToken(rawJwt) {
    let publicKey;
    try {
        publicKey = await importSPKI(PUBLIC_KEY_PEM, 'ES256');
    } catch (err) {
        console.error('[licenseService] Failed to import public key:', err.message);
        return { plan: 'free' };
    }

    let payload;
    try {
        const result = await jwtVerify(rawJwt, publicKey, {
            algorithms: ['ES256'],
            // We intentionally skip clockTolerance here and handle expiry manually
            clockTolerance: '9999 years',
        });
        payload = result.payload;
    } catch (err) {
        console.warn('[licenseService] JWT verification failed:', err.message);
        return { plan: 'free' };
    }

    // Verify machine ID
    const currentMachineId = getCurrentMachineId();
    if (payload.machineId && payload.machineId !== currentMachineId) {
        console.warn('[licenseService] Machine ID mismatch');
        return { plan: 'free' };
    }

    const now = Date.now();
    const expMs = payload.exp ? payload.exp * 1000 : null;
    const isExpired = expMs && now > expMs;

    if (isExpired) {
        const msPastExpiry = now - expMs;
        if (msPastExpiry > GRACE_PERIOD_MS) {
            return { plan: 'free' };
        }
        // Grace period — allow but flag it
        return buildStatus(payload, rawJwt, expMs, true);
    }

    return buildStatus(payload, rawJwt, expMs, false);
}

function buildStatus(payload, rawJwt, expMs, gracePeriod) {
    const daysUntilRenewal = expMs
        ? Math.max(0, Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

    return {
        plan: payload.plan || 'free',
        email: payload.email || null,
        key: payload.key || null,
        expiresAt: expMs || null,
        daysUntilRenewal,
        gracePeriod,
        teamRole: payload.teamRole || null,     // 'owner' | 'member' | null
        ownerKey: payload.ownerKey || null,     // master key for team licenses
        _rawToken: rawJwt,
    };
}

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Returns { plan, email, key, expiresAt, daysUntilRenewal, gracePeriod, suspended? }
 * plan is always one of: 'free' | 'pro' | 'pro_plus' | 'team'
 */
async function getLicenseStatus() {
    const data = readLicenseFile();
    if (!data?.token) return { plan: 'free' };

    const status = await verifyToken(data.token);
    if (data.suspendedAt && status.plan !== 'free') {
        // The server reported the subscription as inactive. Keep the token so a
        // later refresh can restore the plan once the subscription is reinstated,
        // but grant nothing in the meantime.
        return { ...status, plan: 'free', suspended: true, suspendedPlan: status.plan };
    }
    return status;
}

/**
 * Returns true if currentPlan >= requiredPlan in hierarchy: free < pro < pro_plus < team
 */
function planMeetsRequirement(currentPlan, requiredPlan) {
    const currentIdx = PLAN_HIERARCHY.indexOf(currentPlan);
    const requiredIdx = PLAN_HIERARCHY.indexOf(requiredPlan);
    if (currentIdx === -1 || requiredIdx === -1) return false;
    return currentIdx >= requiredIdx;
}

/**
 * Activates a license key on this machine and stores the returned JWT.
 * Returns { success, plan, email, role } or { success: false, error, code }.
 * `code` is the server's machine-readable code (MACHINE_CONFLICT_TRANSFER_REQUIRED,
 * TRANSFER_LIMIT_EXCEEDED, …) — the UI uses it to start the transfer flow.
 */
async function activateLicense(key) {
    let res, body;
    try {
        ({ res, body } = await fetchJson(`${getLicenseServerUrl()}/api/license/activate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ key, machineId: getCurrentMachineId() }),
        }, ACTIVATE_TIMEOUT_MS));
    } catch (err) {
        console.warn('[licenseService] activation request failed:', err.message);
        return { success: false, error: 'Network error. Check your connection.', code: 'NETWORK_ERROR' };
    }

    if (!res.ok) {
        return {
            success: false,
            error: body?.error || `Activation failed (HTTP ${res.status})`,
            code: body?.code,
        };
    }
    if (!body?.token) {
        return { success: false, error: 'License server did not return a token.' };
    }

    await saveLicense(body.token);
    return { success: true, plan: body.plan, email: body.email, role: body.role };
}

/**
 * Attempts online refresh; falls back to offline validation when the server
 * cannot be reached or gives a non-conclusive answer.
 *
 * Definitive server answers (JSON error bodies only):
 *   410 → slot taken by another machine → local license wiped, { revoked: true, reason: 'revoked' }
 *   404 → key / team membership gone    → local license wiped, { revoked: true, reason: 'not_found' }
 *   402 → subscription suspended        → token kept, plan 'free', { suspended: true, reason: 'suspended' }
 */
async function refreshLicense() {
    const data = readLicenseFile();
    const rawJwt = data?.token;
    if (!rawJwt) return { plan: 'free' };

    try {
        const { res, body } = await fetchJson(`${getLicenseServerUrl()}/api/license/refresh`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ token: rawJwt, machineId: getCurrentMachineId() }),
        }, REFRESH_TIMEOUT_MS);

        if (res.ok && body?.token) {
            await saveLicense(body.token);           // also clears any suspension flag
            return verifyToken(body.token);
        }

        // Only trust definitive answers that are JSON errors from our API (they
        // always carry `error` and/or `code`): an HTML 404 from a wrong host
        // must never destroy a valid license.
        const isApiError = body && (typeof body.error === 'string' || typeof body.code === 'string');
        if (isApiError) {
            if (res.status === 410) {
                console.warn('[licenseService] MACHINE_REVOKED — clearing local license');
                await deactivateLicense();
                return { plan: 'free', revoked: true, reason: 'revoked' };
            }
            if (res.status === 404) {
                console.warn('[licenseService] license no longer exists on server — clearing local license');
                await deactivateLicense();
                return { plan: 'free', revoked: true, reason: 'not_found' };
            }
            if (res.status === 402) {
                console.warn('[licenseService] license suspended on server');
                const wasSuspended = Boolean(data.suspendedAt);
                if (!wasSuspended) writeLicenseFile({ ...data, suspendedAt: new Date().toISOString() });
                const status = await verifyToken(rawJwt);
                return {
                    ...status,
                    plan: 'free',
                    suspended: true,
                    suspendedPlan: status.plan,
                    justSuspended: !wasSuspended,
                    reason: 'suspended',
                };
            }
        }
        // Anything else (401 after a key rotation, 403, 5xx, non-JSON) is not
        // conclusive — fall through to offline validation.
    } catch (err) {
        console.warn('[licenseService] Online refresh failed, falling back to offline:', err.message);
    }

    return getLicenseStatus();
}

/**
 * Refreshes shortly after startup (sessions are often shorter than 24h) and
 * then once a day. onChange(result) is called when the server gives a
 * definitive negative answer (revoked / not found / newly suspended) so the
 * UI can drop to the free plan and tell the user why. Returns a stop function.
 */
function startPeriodicRefresh(onChange) {
    const tick = async () => {
        try {
            const result = await refreshLicense();
            if ((result.revoked || result.justSuspended) && typeof onChange === 'function') {
                onChange(result);
            }
        } catch (err) {
            console.warn('[licenseService] periodic refresh error:', err.message);
        }
    };
    const initial = setTimeout(tick, INITIAL_REFRESH_DELAY_MS);
    const handle  = setInterval(tick, PERIODIC_REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for these timers
    if (typeof initial.unref === 'function') initial.unref();
    if (typeof handle.unref === 'function') handle.unref();
    return () => { clearTimeout(initial); clearInterval(handle); };
}

/**
 * Requests a machine transfer for the given key. Server emails a 6-digit code
 * to the license owner; caller must then call confirmTransfer with it.
 */
async function requestTransfer(key) {
    const machineId = getCurrentMachineId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS * 2);

    const res = await fetch(`${getLicenseServerUrl()}/api/license/transfer/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-user-agent': `DynamoOps (${process.platform}-${process.arch})`,
        },
        body: JSON.stringify({ key, newMachineId: machineId }),
        signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return { success: false, error: data.error || 'Transfer request failed', code: data.code };
    }
    return { success: true, ...data };
}

/**
 * Confirms a pending transfer with the emailed code. On success, saves the new JWT.
 */
async function confirmTransfer(key, code) {
    const machineId = getCurrentMachineId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS * 2);

    const res = await fetch(`${getLicenseServerUrl()}/api/license/transfer/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, newMachineId: machineId, code }),
        signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return {
            success: false,
            error: data.error || 'Transfer confirmation failed',
            code: data.code,
            attemptsLeft: data.attemptsLeft,
        };
    }

    if (data.token) {
        await saveLicense(data.token);
    }
    return { success: true, plan: data.plan, email: data.email, role: data.role };
}

/**
 * Fetches activation history (sanitized) from the server using the current JWT.
 */
async function getActivationHistory() {
    const rawJwt = readRawToken();
    if (!rawJwt) return { success: false, error: 'No license' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS * 2);

    const res = await fetch(`${getLicenseServerUrl()}/api/license/history`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${rawJwt}` },
        signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'History fetch failed' };
    return { success: true, ...data };
}

/**
 * Saves a new JWT token to license.json (clears any suspension flag).
 */
async function saveLicense(token) {
    writeLicenseFile({ token });
}

/**
 * Removes license.json (local only).
 */
async function deactivateLicense() {
    const filePath = getLicenseFilePath();
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

/**
 * Frees this machine's slot on the server (best effort — works offline too)
 * and removes the local license.
 */
async function deactivateWithServer() {
    const data = readLicenseFile();
    if (data?.token) {
        try {
            await fetchJson(`${getLicenseServerUrl()}/api/license/deactivate`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ token: data.token, machineId: getCurrentMachineId() }),
            }, REFRESH_TIMEOUT_MS);
        } catch (err) {
            console.warn('[licenseService] server deactivation failed (continuing locally):', err.message);
        }
    }
    await deactivateLicense();
    return { success: true };
}

module.exports = {
    getLicenseStatus,
    planMeetsRequirement,
    getCurrentMachineId,
    getLicenseServerUrl,
    activateLicense,
    refreshLicense,
    saveLicense,
    deactivateLicense,
    deactivateWithServer,
    startPeriodicRefresh,
    requestTransfer,
    confirmTransfer,
    getActivationHistory,
};
