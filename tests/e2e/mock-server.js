'use strict';

/**
 * E2E mock of the DynamoOps license server (front/).
 *
 * Implements the HTTP surface that the Electron client hits, backed by an
 * in-memory store and a freshly generated ES256 keypair so JWTs are real.
 * Emails sent via the "transfer request" flow are captured in a local array
 * and exposed at /test/emails so tests can extract the 6-digit code.
 *
 * Admin endpoints (all under /test/*) let the test suite:
 *   - POST /test/reset           → wipe all state
 *   - POST /test/seed            → create a license (plan, key, members, dates)
 *   - GET  /test/state           → dump current DB for assertions
 *   - GET  /test/emails          → read captured emails
 *   - GET  /test/public-key      → fetch the PEM (Electron loads this at start)
 */

const express = require('express');
const crypto = require('crypto');
const { SignJWT, exportSPKI, generateKeyPair } = require('jose');

const TRANSFER_RATE_LIMIT = 6;
const TRANSFER_RATE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const AUTO_REVOKE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSFER_CODE_TTL_MS = 15 * 60 * 1000;
const TRANSFER_MAX_ATTEMPTS = 5;
const TRANSFER_CODE_SECRET = 'e2e-test-transfer-secret';

function hashCode(code) {
    return crypto.createHmac('sha256', TRANSFER_CODE_SECRET).update(code).digest('hex');
}

function countRecentTransfers(history) {
    if (!Array.isArray(history)) return 0;
    const windowStart = Date.now() - TRANSFER_RATE_WINDOW_MS;
    return history.filter((ev) => {
        if (ev.source !== 'transfer') return false;
        const t = ev.transferredAt ? new Date(ev.transferredAt).getTime() : 0;
        return t >= windowStart;
    }).length;
}

function isAutoRevokable(lastRefreshAt, activatedAt) {
    const seed = lastRefreshAt || activatedAt;
    if (!seed) return false;
    return Date.now() - new Date(seed).getTime() > AUTO_REVOKE_AFTER_MS;
}

function isPendingUsable(pending) {
    if (!pending) return false;
    if (pending.attempts >= TRANSFER_MAX_ATTEMPTS) return false;
    return Date.now() <= new Date(pending.expiresAt).getTime();
}

/**
 * Creates a new mock server instance. Call `await server.start()` to get the
 * bound port. Call `server.stop()` when finished.
 */
async function createMockServer() {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const publicKeyPem = await exportSPKI(publicKey);

    const state = {
        licenses: new Map(),  // key (owner key) → license doc
        emails: [],           // captured emails
    };

    async function signJwt(payload) {
        return new SignJWT(payload)
            .setProtectedHeader({ alg: 'ES256' })
            .setIssuedAt()
            .setExpirationTime('3d')
            .sign(privateKey);
    }

    function findLicenseByKey(key) {
        if (state.licenses.has(key)) {
            const lic = state.licenses.get(key);
            if (lic.plan === 'team') {
                const owner = (lic.members || []).find((m) => m.role === 'owner');
                return owner ? { license: lic, kind: 'team-owner', member: owner } : null;
            }
            return { license: lic, kind: 'individual' };
        }
        // Search members
        for (const lic of state.licenses.values()) {
            const member = (lic.members || []).find((m) => m.memberKey === key);
            if (member) {
                return {
                    license: lic,
                    kind: member.role === 'owner' ? 'team-owner' : 'team-member',
                    member,
                };
            }
        }
        return null;
    }

    const app = express();
    app.use(express.json());

    // ─── Admin: reset/seed/inspect ──────────────────────────────────────────
    app.post('/test/reset', (_req, res) => {
        state.licenses.clear();
        state.emails.length = 0;
        res.json({ ok: true });
    });

    app.post('/test/seed', (req, res) => {
        const license = { createdAt: new Date(), status: 'active', ...req.body };
        state.licenses.set(license.key, license);
        res.json({ ok: true, license });
    });

    app.get('/test/state', (_req, res) => {
        res.json({
            licenses: Array.from(state.licenses.values()),
            emails: state.emails,
        });
    });

    app.get('/test/emails', (_req, res) => {
        res.json(state.emails);
    });

    app.get('/test/public-key', (_req, res) => {
        res.type('text/plain').send(publicKeyPem);
    });

    // ─── POST /api/license/activate ─────────────────────────────────────────
    app.post('/api/license/activate', async (req, res) => {
        const { key, machineId } = req.body || {};
        if (!key || !machineId) return res.status(400).json({ error: 'key and machineId required' });

        const resolved = findLicenseByKey(key);
        if (!resolved) return res.status(404).json({ error: 'License key not found' });
        if (resolved.license.status !== 'active') return res.status(402).json({ error: 'not active' });

        const now = new Date();

        // Branch: team vs individual
        if (resolved.kind !== 'individual') {
            const { license, member } = resolved;
            const teamRole = member.role;
            if (member.machineId && member.machineId !== machineId) {
                if (isAutoRevokable(member.lastRefreshAt, member.activatedAt)) {
                    (member.activationHistory ??= []).push({
                        machineIdHash: member.machineId,
                        activatedAt: member.activatedAt ?? now,
                        source: 'auto-revoke',
                        transferredAt: now,
                    });
                    member.machineId = machineId;
                    member.activatedAt = now;
                    member.lastRefreshAt = now;
                    const token = await signJwt({
                        key: member.memberKey, plan: 'team', machineId,
                        email: member.email, ownerKey: license.key, teamRole,
                    });
                    return res.json({ token, plan: 'team', email: member.email, role: teamRole });
                }
                if (countRecentTransfers(member.activationHistory) >= TRANSFER_RATE_LIMIT) {
                    return res.status(429).json({
                        error: 'Annual machine transfer limit reached.',
                        code: 'TRANSFER_LIMIT_EXCEEDED',
                    });
                }
                return res.status(409).json({
                    error: 'License already activated on another machine',
                    code: 'MACHINE_CONFLICT_TRANSFER_REQUIRED',
                });
            }
            if (!member.machineId) {
                member.machineId = machineId;
                member.activatedAt = now;
                member.acceptedAt = now;
                member.lastRefreshAt = now;
                (member.activationHistory ??= []).push({
                    machineIdHash: machineId, activatedAt: now, source: 'initial',
                });
            }
            const token = await signJwt({
                key: member.memberKey, plan: 'team', machineId,
                email: member.email, ownerKey: license.key, teamRole,
            });
            return res.json({ token, plan: 'team', email: member.email, role: teamRole });
        }

        // Individual
        const lic = resolved.license;
        if (lic.machineId && lic.machineId !== machineId) {
            if (isAutoRevokable(lic.lastRefreshAt, lic.activatedAt)) {
                (lic.activationHistory ??= []).push({
                    machineIdHash: lic.machineId,
                    activatedAt: lic.activatedAt ?? now,
                    source: 'auto-revoke',
                    transferredAt: now,
                });
                lic.machineId = machineId;
                lic.activatedAt = now;
                lic.lastRefreshAt = now;
                const token = await signJwt({
                    key: lic.key, plan: lic.plan, machineId, email: lic.email,
                });
                return res.json({ token, plan: lic.plan, email: lic.email });
            }
            if (countRecentTransfers(lic.activationHistory) >= TRANSFER_RATE_LIMIT) {
                return res.status(429).json({
                    error: 'Annual machine transfer limit reached.',
                    code: 'TRANSFER_LIMIT_EXCEEDED',
                });
            }
            return res.status(409).json({
                error: 'License already activated on another machine',
                code: 'MACHINE_CONFLICT_TRANSFER_REQUIRED',
            });
        }

        if (!lic.machineId) {
            lic.machineId = machineId;
            lic.activatedAt = now;
            lic.lastRefreshAt = now;
            (lic.activationHistory ??= []).push({
                machineIdHash: machineId, activatedAt: now, source: 'initial',
            });
        }
        const token = await signJwt({
            key: lic.key, plan: lic.plan, machineId, email: lic.email,
        });
        return res.json({ token, plan: lic.plan, email: lic.email });
    });

    // ─── POST /api/license/refresh ──────────────────────────────────────────
    app.post('/api/license/refresh', async (req, res) => {
        const { token, machineId } = req.body || {};
        if (!token || !machineId) return res.status(400).json({ error: 'required' });

        let payload;
        try {
            // Decode without verifying — the mock trusts its own JWTs and
            // we want to check machine binding even for expired tokens.
            const [, b64] = token.split('.');
            payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
        } catch {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const resolved = findLicenseByKey(payload.key);
        if (!resolved) return res.status(402).json({ error: 'not active' });

        const now = new Date();

        if (resolved.kind !== 'individual') {
            const { member } = resolved;
            if (member.machineId && member.machineId !== machineId) {
                return res.status(410).json({
                    error: 'License was transferred', code: 'MACHINE_REVOKED',
                });
            }
            member.lastRefreshAt = now;
            const newToken = await signJwt({
                key: member.memberKey, plan: 'team', machineId,
                email: member.email, ownerKey: resolved.license.key, teamRole: member.role,
            });
            return res.json({ token: newToken, plan: 'team', email: member.email, role: member.role });
        }

        const lic = resolved.license;
        if (lic.machineId && lic.machineId !== machineId) {
            return res.status(410).json({
                error: 'License was transferred', code: 'MACHINE_REVOKED',
            });
        }
        lic.lastRefreshAt = now;
        const newToken = await signJwt({
            key: lic.key, plan: lic.plan, machineId, email: lic.email,
        });
        return res.json({ token: newToken, plan: lic.plan, email: lic.email });
    });

    // ─── POST /api/license/deactivate ───────────────────────────────────────
    app.post('/api/license/deactivate', (req, res) => {
        const { token, machineId } = req.body || {};
        if (!token || !machineId) return res.status(400).json({ error: 'required' });
        let payload;
        try {
            payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        } catch {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const resolved = findLicenseByKey(payload.key);
        if (!resolved) return res.json({ success: true });

        const now = new Date();
        if (resolved.kind !== 'individual') {
            const { member } = resolved;
            if (member.machineId === machineId) {
                (member.activationHistory ??= []).push({
                    machineIdHash: member.machineId,
                    activatedAt: member.activatedAt ?? now,
                    source: 'deactivate-reactivate',
                    transferredAt: now,
                });
                delete member.machineId;
                delete member.activatedAt;
                delete member.lastRefreshAt;
            }
        } else {
            const lic = resolved.license;
            if (lic.machineId === machineId) {
                (lic.activationHistory ??= []).push({
                    machineIdHash: lic.machineId,
                    activatedAt: lic.activatedAt ?? now,
                    source: 'deactivate-reactivate',
                    transferredAt: now,
                });
                delete lic.machineId;
                delete lic.activatedAt;
                delete lic.lastRefreshAt;
            }
        }
        res.json({ success: true });
    });

    // ─── POST /api/license/transfer/request ─────────────────────────────────
    app.post('/api/license/transfer/request', (req, res) => {
        const { key, newMachineId } = req.body || {};
        if (!key || !newMachineId) return res.status(400).json({ error: 'required' });

        const resolved = findLicenseByKey(key);
        if (!resolved) return res.status(404).json({ error: 'not found' });

        const history = resolved.kind === 'individual'
            ? resolved.license.activationHistory
            : resolved.member.activationHistory;
        if (countRecentTransfers(history) >= TRANSFER_RATE_LIMIT) {
            return res.status(429).json({
                error: 'Annual transfer limit reached', code: 'TRANSFER_LIMIT_EXCEEDED',
            });
        }

        const code = String(100000 + Math.floor(Math.random() * 900000));
        const pending = {
            requestedFromMachineId: newMachineId,
            codeHash: hashCode(code),
            expiresAt: new Date(Date.now() + TRANSFER_CODE_TTL_MS),
            attempts: 0,
            requestedAt: new Date(),
        };
        if (resolved.kind === 'individual') {
            resolved.license.pendingTransfer = pending;
        } else {
            resolved.member.pendingTransfer = pending;
        }

        const toEmail = resolved.kind === 'individual' ? resolved.license.email : resolved.member.email;
        state.emails.push({
            to: toEmail,
            subject: `DynamoOps — code ${code} to confirm machine transfer`,
            code,
            html: `<p>Code: <b>${code}</b></p>`,
            sentAt: new Date(),
            licenseKey: key,
        });

        res.json({ ok: true, expiresInMinutes: 15, emailHint: toEmail.replace(/^(.).*@(.).*$/, '$1***@$2***') });
    });

    // ─── POST /api/license/transfer/confirm ─────────────────────────────────
    app.post('/api/license/transfer/confirm', async (req, res) => {
        const { key, newMachineId, code } = req.body || {};
        if (!key || !newMachineId || !code) return res.status(400).json({ error: 'required' });

        const resolved = findLicenseByKey(key);
        if (!resolved) return res.status(404).json({ error: 'not found' });

        const pending = resolved.kind === 'individual'
            ? resolved.license.pendingTransfer
            : resolved.member.pendingTransfer;
        if (!isPendingUsable(pending)) {
            return res.status(400).json({ error: 'Transfer request expired or not found.' });
        }
        if (pending.requestedFromMachineId !== newMachineId) {
            pending.attempts += 1;
            return res.status(400).json({ error: 'Invalid transfer context' });
        }
        const candidate = hashCode(code);
        if (candidate !== pending.codeHash) {
            pending.attempts += 1;
            return res.status(400).json({
                error: 'Invalid or expired code',
                attemptsLeft: Math.max(0, TRANSFER_MAX_ATTEMPTS - pending.attempts),
            });
        }

        const now = new Date();
        let token;
        if (resolved.kind === 'individual') {
            const lic = resolved.license;
            (lic.activationHistory ??= []).push({
                machineIdHash: lic.machineId ?? 'unknown',
                activatedAt: lic.activatedAt ?? now,
                source: 'transfer',
                transferredAt: now,
            });
            lic.machineId = newMachineId;
            lic.activatedAt = now;
            lic.lastRefreshAt = now;
            delete lic.pendingTransfer;
            token = await signJwt({
                key: lic.key, plan: lic.plan, machineId: newMachineId, email: lic.email,
            });
            return res.json({ token, plan: lic.plan, email: lic.email });
        }

        const { license: lic, member } = resolved;
        (member.activationHistory ??= []).push({
            machineIdHash: member.machineId ?? 'unknown',
            activatedAt: member.activatedAt ?? now,
            source: 'transfer',
            transferredAt: now,
        });
        member.machineId = newMachineId;
        member.activatedAt = now;
        member.lastRefreshAt = now;
        delete member.pendingTransfer;
        token = await signJwt({
            key: member.memberKey, plan: 'team', machineId: newMachineId,
            email: member.email, ownerKey: lic.key, teamRole: member.role,
        });
        res.json({ token, plan: 'team', email: member.email, role: member.role });
    });

    // ─── GET /api/license/history ────────────────────────────────────────────
    app.get('/api/license/history', (req, res) => {
        const auth = req.headers.authorization;
        if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

        let payload;
        try {
            payload = JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString());
        } catch {
            return res.status(401).json({ error: 'Invalid' });
        }

        const resolved = findLicenseByKey(payload.key);
        if (!resolved) return res.status(404).json({ error: 'not found' });

        let history = [];
        let currentMachineId;
        let currentActivatedAt;
        let currentLastRefreshAt;
        if (resolved.kind !== 'individual') {
            history = resolved.member.activationHistory || [];
            currentMachineId = resolved.member.machineId;
            currentActivatedAt = resolved.member.activatedAt;
            currentLastRefreshAt = resolved.member.lastRefreshAt;
        } else {
            history = resolved.license.activationHistory || [];
            currentMachineId = resolved.license.machineId;
            currentActivatedAt = resolved.license.activatedAt;
            currentLastRefreshAt = resolved.license.lastRefreshAt;
        }

        const sanitized = history.map((ev) => ({
            machineSuffix: (ev.machineIdHash || '').slice(-6),
            activatedAt: ev.activatedAt,
            transferredAt: ev.transferredAt,
            source: ev.source,
        }));
        const current = currentMachineId ? {
            machineSuffix: currentMachineId.slice(-6),
            activatedAt: currentActivatedAt,
            lastRefreshAt: currentLastRefreshAt,
        } : null;
        res.json({ current, history: sanitized });
    });

    // ─── Bind ────────────────────────────────────────────────────────────────
    let server;
    async function start() {
        return new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                resolve(server.address().port);
            });
        });
    }
    function stop() {
        return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
    }

    return { start, stop, publicKeyPem, state };
}

module.exports = { createMockServer };
