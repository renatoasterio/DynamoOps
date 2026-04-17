'use strict';

/**
 * HTTP-level E2E — drives the real licenseService against a running mock
 * license server. Every scenario exercises the full HTTP journey: real fetch,
 * real JWT sign/verify, real in-memory DB transitions, captured transactional
 * emails. This is the Electron equivalent without UI clicks — the same code
 * path as production, minus the browser automation.
 *
 * (The Playwright spec in tests/e2e/ provides identical coverage via actual UI
 * clicks, but is gated off on macOS 26 where Electron 35 rejects Chromium
 * debug flags; see playwright.config.js.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createMockServer } = require('./e2e/mock-server');

jest.mock('electron', () => { throw new Error('no electron'); });

let server;
let mockPort;
let licenseService;
let TEST_DIR;
let LICENSE_FILE;

// Test machine identities — the licenseService hashes this before sending.
function setMachine(rawId) {
    process.env.DYNAMO_TEST_MACHINE_ID = rawId;
}

function hashOf(rawId) {
    return crypto.createHash('sha256').update(rawId).digest('hex');
}

beforeAll(async () => {
    server = await createMockServer();
    mockPort = await server.start();

    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamoops-e2e-http-'));
    LICENSE_FILE = path.join(TEST_DIR, '.dynamoops', 'license.json');

    process.env.DYNAMO_LICENSE_PUBLIC_KEY = server.publicKeyPem;
    process.env.LICENSE_SERVER_URL = `http://127.0.0.1:${mockPort}`;
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);

    licenseService = require('../src/backend/services/licenseService');
});

afterEach(async () => {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
    await fetch(`http://127.0.0.1:${mockPort}/test/reset`, { method: 'POST' });
    delete process.env.DYNAMO_TEST_MACHINE_ID;
});

afterAll(async () => {
    await server.stop();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    jest.restoreAllMocks();
});

async function seedLicense(doc) {
    const res = await fetch(`http://127.0.0.1:${mockPort}/test/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
    });
    return res.json();
}

async function getServerState() {
    return (await fetch(`http://127.0.0.1:${mockPort}/test/state`)).json();
}

async function activate(key) {
    // Simulate what the activate IPC handler does in electron-main.js
    const machineId = hashOf(process.env.DYNAMO_TEST_MACHINE_ID);
    const res = await fetch(`${process.env.LICENSE_SERVER_URL}/api/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error, code: data.code };
    await licenseService.saveLicense(data.token);
    return { success: true, plan: data.plan, email: data.email, role: data.role };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 1 — First activation (happy path)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 1 — user activates a fresh Pro license', () => {
    test('activate binds the machine and licenseService reports PRO', async () => {
        await seedLicense({
            key: 'DYNAMO-PRO-FRESH',
            plan: 'pro',
            email: 'fresh@example.com',
        });
        setMachine('machine-fresh');

        const result = await activate('DYNAMO-PRO-FRESH');
        expect(result.success).toBe(true);
        expect(result.plan).toBe('pro');

        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('pro');
        expect(status.email).toBe('fresh@example.com');

        const { licenses } = await getServerState();
        expect(licenses[0].machineId).toBe(hashOf('machine-fresh'));
        expect(licenses[0].activationHistory[0].source).toBe('initial');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 2 — Machine transfer via email-confirmed code
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 2 — user moves to new machine with email code', () => {
    test('activate → 409, requestTransfer → code → confirm → new machine bound, refresh on old machine returns 410', async () => {
        // License already bound to machine-A, freshly refreshed (blocks auto-revoke)
        await seedLicense({
            key: 'DYNAMO-PRO-TX',
            plan: 'pro',
            email: 'owner@example.com',
            machineId: hashOf('machine-A'),
            activatedAt: new Date(),
            lastRefreshAt: new Date(),
        });

        // User is now on machine-B
        setMachine('machine-B');

        // Step 1: attempting to activate gets a transfer-required conflict
        const attempt = await activate('DYNAMO-PRO-TX');
        expect(attempt.success).toBe(false);
        expect(attempt.code).toBe('MACHINE_CONFLICT_TRANSFER_REQUIRED');

        // Step 2: client triggers transfer request — server emails code to owner
        const req = await licenseService.requestTransfer('DYNAMO-PRO-TX');
        expect(req.success).toBe(true);
        expect(req.emailHint).toMatch(/o.*@e.*/);

        // Step 3: fetch the emitted email, extract 6-digit code
        const { emails } = await getServerState();
        expect(emails).toHaveLength(1);
        expect(emails[0].to).toBe('owner@example.com');
        const code = emails[0].code;
        expect(code).toMatch(/^\d{6}$/);

        // Step 4: confirm with the code
        const confirm = await licenseService.confirmTransfer('DYNAMO-PRO-TX', code);
        expect(confirm.success).toBe(true);
        expect(confirm.plan).toBe('pro');

        // Client's license.json is now bound to machine-B
        expect(fs.existsSync(LICENSE_FILE)).toBe(true);
        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('pro');

        // Server state: machine changed, transfer event logged
        const state = await getServerState();
        expect(state.licenses[0].machineId).toBe(hashOf('machine-B'));
        const transferEvents = (state.licenses[0].activationHistory || []).filter((e) => e.source === 'transfer');
        expect(transferEvents).toHaveLength(1);

        // Step 5: the OLD machine's refresh (machine-A) should now be revoked
        setMachine('machine-A');
        // Simulate machine A's licenseService having the old token — we save one manually
        // to mimic the persisted state that would exist on that device.
        const fakeOldTokenPayload = {
            key: 'DYNAMO-PRO-TX',
            plan: 'pro',
            machineId: hashOf('machine-A'),
            email: 'owner@example.com',
        };
        const oldToken = [
            Buffer.from('{}').toString('base64url'),
            Buffer.from(JSON.stringify(fakeOldTokenPayload)).toString('base64url'),
            'sig',
        ].join('.');
        await licenseService.saveLicense(oldToken);

        const refreshResult = await licenseService.refreshLicense();
        expect(refreshResult.revoked).toBe(true);
        expect(refreshResult.plan).toBe('free');
        expect(fs.existsSync(LICENSE_FILE)).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 3 — Auto-revoke after 30+ days of inactivity
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 3 — auto-revoke past 30d inactivity', () => {
    test('user activates on a new machine without email code when the old one is silent', async () => {
        await seedLicense({
            key: 'DYNAMO-PRO-STALE',
            plan: 'pro',
            email: 'dormant@example.com',
            machineId: hashOf('dormant-machine'),
            activatedAt: new Date(Date.now() - 60 * 86400_000),
            lastRefreshAt: new Date(Date.now() - 45 * 86400_000), // 45d ago
        });

        setMachine('fresh-replacement');

        const result = await activate('DYNAMO-PRO-STALE');
        expect(result.success).toBe(true);
        expect(result.plan).toBe('pro');

        // No email was sent
        const { emails, licenses } = await getServerState();
        expect(emails).toHaveLength(0);

        // History records the auto-revoke
        const autoRevoke = (licenses[0].activationHistory || []).filter((e) => e.source === 'auto-revoke');
        expect(autoRevoke).toHaveLength(1);
        expect(licenses[0].machineId).toBe(hashOf('fresh-replacement'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 4 — Annual rate limit
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 4 — 6 transfers in 365d blocks further activations', () => {
    test('activate returns TRANSFER_LIMIT_EXCEEDED after reaching the yearly quota', async () => {
        const history = Array.from({ length: 6 }, (_, i) => ({
            machineIdHash: `hash-${i}`,
            activatedAt: new Date(Date.now() - (i + 1) * 10 * 86400_000),
            source: 'transfer',
            transferredAt: new Date(Date.now() - i * 10 * 86400_000),
        }));

        await seedLicense({
            key: 'DYNAMO-PRO-LIMIT',
            plan: 'pro',
            email: 'heavy@example.com',
            machineId: hashOf('currently-bound'),
            activatedAt: new Date(),
            lastRefreshAt: new Date(),
            activationHistory: history,
        });

        setMachine('seventh-attempt');

        const result = await activate('DYNAMO-PRO-LIMIT');
        expect(result.success).toBe(false);
        expect(result.code).toBe('TRANSFER_LIMIT_EXCEEDED');

        // License state must not have changed
        const { licenses } = await getServerState();
        expect(licenses[0].machineId).toBe(hashOf('currently-bound'));
    });

    test('requestTransfer itself also rejects at the limit', async () => {
        const history = Array.from({ length: 6 }, (_, i) => ({
            machineIdHash: `hash-${i}`,
            activatedAt: new Date(),
            source: 'transfer',
            transferredAt: new Date(Date.now() - i * 10 * 86400_000),
        }));
        await seedLicense({
            key: 'DYNAMO-PRO-LIMIT2',
            plan: 'pro',
            email: 'heavy2@example.com',
            machineId: hashOf('bound'),
            lastRefreshAt: new Date(),
            activationHistory: history,
        });
        setMachine('newcomer');

        const req = await licenseService.requestTransfer('DYNAMO-PRO-LIMIT2');
        expect(req.success).toBe(false);
        expect(req.code).toBe('TRANSFER_LIMIT_EXCEEDED');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 5 — Wrong code increments attempts, surfaces attemptsLeft, never activates
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 5 — wrong transfer code path', () => {
    test('wrong code returns attemptsLeft and license stays on old machine', async () => {
        await seedLicense({
            key: 'DYNAMO-PRO-WRONG',
            plan: 'pro',
            email: 'strict@example.com',
            machineId: hashOf('held-by-A'),
            lastRefreshAt: new Date(),
        });
        setMachine('attacker');

        // Kick off the request so a pendingTransfer is created
        const req = await licenseService.requestTransfer('DYNAMO-PRO-WRONG');
        expect(req.success).toBe(true);

        // Try three wrong codes
        for (let i = 0; i < 3; i++) {
            const r = await licenseService.confirmTransfer('DYNAMO-PRO-WRONG', '000000');
            expect(r.success).toBe(false);
            expect(r.attemptsLeft).toBe(5 - (i + 1));
        }

        // License is still bound to the old machine
        const { licenses } = await getServerState();
        expect(licenses[0].machineId).toBe(hashOf('held-by-A'));
        expect(licenses[0].pendingTransfer.attempts).toBe(3);
    });

    test('five wrong codes exhausts attempts and even the correct code is rejected', async () => {
        await seedLicense({
            key: 'DYNAMO-PRO-EXHAUST',
            plan: 'pro',
            email: 'locked@example.com',
            machineId: hashOf('held-machine'),
            lastRefreshAt: new Date(),
        });
        setMachine('new-machine');

        await licenseService.requestTransfer('DYNAMO-PRO-EXHAUST');

        // Grab the real code from the email
        const { emails } = await getServerState();
        const realCode = emails[0].code;

        // Burn all 5 attempts with wrong codes
        for (let i = 0; i < 5; i++) {
            await licenseService.confirmTransfer('DYNAMO-PRO-EXHAUST', '999999');
        }

        // Even the right code now fails (pending marked unusable)
        const finalAttempt = await licenseService.confirmTransfer('DYNAMO-PRO-EXHAUST', realCode);
        expect(finalAttempt.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 6 — Team member transfer: code goes to member's email, not owner's
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 6 — team member moving machines', () => {
    test('invited member transfers their seat and receives the code at their own email', async () => {
        await seedLicense({
            key: 'DYNAMO-TEAM-OWNER',
            plan: 'team',
            email: 'owner@company.com',
            seatsLimit: 5,
            members: [
                {
                    email: 'owner@company.com',
                    role: 'owner',
                    memberKey: 'TEAM-OWNER-KEY',
                    invitedAt: new Date(),
                    acceptedAt: new Date(),
                    machineId: hashOf('owner-laptop'),
                    lastRefreshAt: new Date(),
                },
                {
                    email: 'engineer@company.com',
                    role: 'member',
                    memberKey: 'TEAM-MEMBER-KEY',
                    invitedAt: new Date(),
                    acceptedAt: new Date(),
                    machineId: hashOf('member-old-machine'),
                    activatedAt: new Date(),
                    lastRefreshAt: new Date(),
                },
            ],
        });

        setMachine('member-new-laptop');

        // Member tries to activate on new laptop with their memberKey
        const conflict = await activate('TEAM-MEMBER-KEY');
        expect(conflict.code).toBe('MACHINE_CONFLICT_TRANSFER_REQUIRED');

        // Request transfer
        const req = await licenseService.requestTransfer('TEAM-MEMBER-KEY');
        expect(req.success).toBe(true);

        // Email goes to the MEMBER, not the owner
        const { emails } = await getServerState();
        expect(emails).toHaveLength(1);
        expect(emails[0].to).toBe('engineer@company.com');

        // Confirm
        const confirm = await licenseService.confirmTransfer('TEAM-MEMBER-KEY', emails[0].code);
        expect(confirm.success).toBe(true);
        expect(confirm.role).toBe('member');

        // JWT now carries team role + owner key
        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('team');
        expect(status.teamRole).toBe('member');
        expect(status.ownerKey).toBe('DYNAMO-TEAM-OWNER');

        // Server state: only the member moved, owner's binding untouched
        const { licenses } = await getServerState();
        const lic = licenses[0];
        const ownerMember = lic.members.find((m) => m.role === 'owner');
        const engineerMember = lic.members.find((m) => m.email === 'engineer@company.com');
        expect(ownerMember.machineId).toBe(hashOf('owner-laptop'));
        expect(engineerMember.machineId).toBe(hashOf('member-new-laptop'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 7 — refresh keeps lastRefreshAt fresh and returns a new JWT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 7 — daily refresh updates lastRefreshAt', () => {
    test('refresh updates lastRefreshAt on the server and rotates the JWT', async () => {
        await seedLicense({
            key: 'DYNAMO-PRO-REFRESH',
            plan: 'pro',
            email: 'heartbeat@example.com',
        });
        setMachine('active-machine');

        await activate('DYNAMO-PRO-REFRESH');
        const firstToken = (JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'))).token;

        // Wait a tick to ensure iat differs (JWTs are at 1-second resolution)
        await new Promise((r) => setTimeout(r, 1100));

        const refreshed = await licenseService.refreshLicense();
        expect(refreshed.plan).toBe('pro');
        expect(refreshed.revoked).toBeUndefined();

        const newToken = (JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'))).token;
        expect(newToken).not.toBe(firstToken);

        const { licenses } = await getServerState();
        const before = licenses[0].activatedAt;
        const after = licenses[0].lastRefreshAt;
        expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    });
});
