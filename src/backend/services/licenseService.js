'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { jwtVerify, importSPKI } = require('jose');
const { machineIdSync } = require('node-machine-id');

// ─── Public key (injected at build time via env or hardcoded fallback) ────────
const PUBLIC_KEY_PEM = process.env.DYNAMO_LICENSE_PUBLIC_KEY ||
`-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE673tPiicD0RkTKuA/6+J3KB+v8Oe
m3nntZKcD6Fvr7A3xjB0k2uKF0GylK4gOqpAgTvAl7i2cX53qtk4Myoo4g==
-----END PUBLIC KEY-----`;

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TIMEOUT_MS = 5_000;
const PLAN_HIERARCHY = ['free', 'pro', 'pro_plus', 'team'];

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
    return crypto
        .createHash('sha256')
        .update(machineIdSync({ original: true }))
        .digest('hex');
}

function readRawToken() {
    const filePath = getLicenseFilePath();
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data.token || null;
    } catch {
        return null;
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
        _rawToken: rawJwt,
    };
}

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Returns { plan, email, key, expiresAt, daysUntilRenewal, gracePeriod }
 * plan is always one of: 'free' | 'pro' | 'pro_plus' | 'team'
 */
async function getLicenseStatus() {
    const rawJwt = readRawToken();
    if (!rawJwt) return { plan: 'free' };
    return verifyToken(rawJwt);
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
 * Attempts online refresh; falls back to offline validation on network error.
 */
async function refreshLicense() {
    const rawJwt = readRawToken();
    if (!rawJwt) return { plan: 'free' };

    try {
        const machineId = getCurrentMachineId();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

        const baseUrl = process.env.LICENSE_SERVER_URL || 'https://dynamoops.io';
        const res = await fetch(`${baseUrl}/api/license/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: rawJwt, machineId }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            if (data.token) {
                await saveLicense(data.token);
                return verifyToken(data.token);
            }
        }
    } catch (err) {
        console.warn('[licenseService] Online refresh failed, falling back to offline:', err.message);
    }

    // Fallback to offline validation
    return verifyToken(rawJwt);
}

/**
 * Saves a new JWT token to license.json
 */
async function saveLicense(token) {
    const filePath = getLicenseFilePath();
    fs.writeFileSync(filePath, JSON.stringify({ token }, null, 2), 'utf8');
}

/**
 * Removes license.json
 */
async function deactivateLicense() {
    const filePath = getLicenseFilePath();
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = {
    getLicenseStatus,
    planMeetsRequirement,
    refreshLicense,
    saveLicense,
    deactivateLicense,
};
