'use strict';

const { test, expect } = require('@playwright/test');
const os = require('os');
const { createMockServer } = require('./mock-server');
const {
    launchApp,
    waitForEmail,
    seedLicense,
    resetMock,
    getServerState,
} = require('./helpers');

// Known compat gap: macOS 26 + Electron ≤ 39 rejects Chromium's
// --remote-debugging-port=* flag, which Playwright requires to attach.
// Skipping here keeps the suite green locally; CI (Linux) still runs it,
// and HTTP-level coverage is provided by tests/e2eHttp.test.js.
const isMacOS26Plus = (() => {
    if (process.platform !== 'darwin') return false;
    const major = parseInt(os.release().split('.')[0], 10);
    // Darwin major → macOS: Darwin 25 = macOS 26 (Tahoe)
    return major >= 25;
})();

test.skip(
    isMacOS26Plus,
    'Playwright + Electron cannot drive Chromium debug flags on macOS 26. HTTP E2E (tests/e2eHttp.test.js) covers the same flow.'
);

let server;
let mockPort;
let publicKeyPem;

test.beforeAll(async () => {
    server = await createMockServer();
    mockPort = await server.start();
    publicKeyPem = server.publicKeyPem;
});

test.afterAll(async () => {
    await server?.stop();
});

test.beforeEach(async () => {
    await resetMock(mockPort);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 1 — Happy-path activation
// ═══════════════════════════════════════════════════════════════════════════════
test('user activates a Pro license and the badge flips from FREE to PRO', async () => {
    await seedLicense(mockPort, {
        key: 'DYNAMO-PRO-SIMPLE',
        plan: 'pro',
        email: 'solo@example.com',
    });

    const app = await launchApp({ mockPort, machineIdRaw: 'machine-A', publicKeyPem });
    try {
        // Badge starts as FREE
        await expect(app.window.locator('#license-plan-badge')).toHaveText('FREE');

        // Open license modal
        await app.window.click('#license-plan-badge');
        await app.window.waitForSelector('#license-modal');

        // Enter key and activate
        await app.window.fill('#license-key-input', 'DYNAMO-PRO-SIMPLE');
        await app.window.click('#license-activate-btn');

        // Modal closes, badge flips to PRO
        await app.window.waitForSelector('#license-modal', { state: 'detached', timeout: 10_000 });
        await expect(app.window.locator('#license-plan-badge')).toHaveText('PRO');

        // Server recorded the binding
        const { licenses } = await getServerState(mockPort);
        expect(licenses[0].machineId).toBe(app.machineId);
        expect(licenses[0].activationHistory[0].source).toBe('initial');
    } finally {
        await app.close();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 2 — Machine transfer via email confirmation
// ═══════════════════════════════════════════════════════════════════════════════
test('user on a new machine receives a code by email, enters it, and claims the slot', async () => {
    // Seed a license already bound to machine-A (recent activity, so email flow kicks in)
    const machineAHash = require('crypto').createHash('sha256').update('machine-A').digest('hex');
    await seedLicense(mockPort, {
        key: 'DYNAMO-PRO-TX',
        plan: 'pro',
        email: 'owner@example.com',
        machineId: machineAHash,
        activatedAt: new Date(),
        lastRefreshAt: new Date(),  // fresh → no auto-revoke
    });

    // Launch the app on machine-B
    const app = await launchApp({ mockPort, machineIdRaw: 'machine-B', publicKeyPem });
    try {
        // Enter the same key
        await app.window.click('#license-plan-badge');
        await app.window.waitForSelector('#license-modal');
        await app.window.fill('#license-key-input', 'DYNAMO-PRO-TX');
        await app.window.click('#license-activate-btn');

        // UI should pivot to the transfer code step
        await app.window.waitForSelector('#license-transfer-code', { timeout: 10_000 });
        await expect(app.window.locator('h3')).toContainText('Confirm Machine Transfer');

        // Fetch the code from the captured email
        const email = await waitForEmail(mockPort, 'owner@example.com');
        expect(email.code).toMatch(/^\d{6}$/);

        // Enter the code, confirm
        await app.window.fill('#license-transfer-code', email.code);
        await app.window.click('#license-transfer-submit');

        // Modal closes, badge becomes PRO on machine-B
        await app.window.waitForSelector('#license-modal', { state: 'detached', timeout: 10_000 });
        await expect(app.window.locator('#license-plan-badge')).toHaveText('PRO');

        // Server state now points to machine-B and logged a transfer event
        const { licenses } = await getServerState(mockPort);
        expect(licenses[0].machineId).toBe(app.machineId);
        const transferEvents = (licenses[0].activationHistory || []).filter((e) => e.source === 'transfer');
        expect(transferEvents.length).toBe(1);
    } finally {
        await app.close();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 3 — Auto-revoke after 30 days of inactivity
// ═══════════════════════════════════════════════════════════════════════════════
test('user activates on a new machine without a code when the old one is silent for 30+ days', async () => {
    const staleHash = require('crypto').createHash('sha256').update('old-machine').digest('hex');
    await seedLicense(mockPort, {
        key: 'DYNAMO-PRO-STALE',
        plan: 'pro',
        email: 'dormant@example.com',
        machineId: staleHash,
        activatedAt: new Date(Date.now() - 60 * 86400_000),
        lastRefreshAt: new Date(Date.now() - 45 * 86400_000),  // 45d ago
    });

    const app = await launchApp({ mockPort, machineIdRaw: 'fresh-machine', publicKeyPem });
    try {
        await app.window.click('#license-plan-badge');
        await app.window.waitForSelector('#license-modal');
        await app.window.fill('#license-key-input', 'DYNAMO-PRO-STALE');
        await app.window.click('#license-activate-btn');

        // Should activate directly without ever showing the transfer step
        await app.window.waitForSelector('#license-modal', { state: 'detached', timeout: 10_000 });
        await expect(app.window.locator('#license-plan-badge')).toHaveText('PRO');

        // No transfer email sent
        const { emails, licenses } = await getServerState(mockPort);
        expect(emails.length).toBe(0);

        // History records the auto-revoke
        const events = licenses[0].activationHistory || [];
        expect(events.some((e) => e.source === 'auto-revoke')).toBe(true);
    } finally {
        await app.close();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 4 — Annual transfer rate limit
// ═══════════════════════════════════════════════════════════════════════════════
test('user sees rate-limit error after 6 transfers in 365 days', async () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
        machineIdHash: `old-${i}`,
        activatedAt: new Date(Date.now() - (i + 1) * 10 * 86400_000),
        source: 'transfer',
        transferredAt: new Date(Date.now() - i * 10 * 86400_000),
    }));
    const bound = require('crypto').createHash('sha256').update('limited-machine').digest('hex');
    await seedLicense(mockPort, {
        key: 'DYNAMO-PRO-LIMIT',
        plan: 'pro',
        email: 'heavy@example.com',
        machineId: bound,
        activatedAt: new Date(),
        lastRefreshAt: new Date(),
        activationHistory: history,
    });

    const app = await launchApp({ mockPort, machineIdRaw: 'seventh-machine', publicKeyPem });
    try {
        await app.window.click('#license-plan-badge');
        await app.window.waitForSelector('#license-modal');
        await app.window.fill('#license-key-input', 'DYNAMO-PRO-LIMIT');
        await app.window.click('#license-activate-btn');

        // Error surfaces in the same modal, badge stays FREE, no transfer UI
        const errorLocator = app.window.locator('#license-activate-error');
        await expect(errorLocator).toBeVisible({ timeout: 10_000 });
        await expect(errorLocator).toContainText(/transfer limit/i);
        await expect(app.window.locator('#license-plan-badge')).toHaveText('FREE');
        await expect(app.window.locator('#license-transfer-code')).toHaveCount(0);
    } finally {
        await app.close();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 5 — Wrong transfer code surfaces attemptsLeft
// ═══════════════════════════════════════════════════════════════════════════════
test('wrong transfer code shows attemptsLeft and does not activate the license', async () => {
    const oldHash = require('crypto').createHash('sha256').update('held-machine').digest('hex');
    await seedLicense(mockPort, {
        key: 'DYNAMO-PRO-WRONG',
        plan: 'pro',
        email: 'strict@example.com',
        machineId: oldHash,
        activatedAt: new Date(),
        lastRefreshAt: new Date(),
    });

    const app = await launchApp({ mockPort, machineIdRaw: 'challenger', publicKeyPem });
    try {
        await app.window.click('#license-plan-badge');
        await app.window.fill('#license-key-input', 'DYNAMO-PRO-WRONG');
        await app.window.click('#license-activate-btn');
        await app.window.waitForSelector('#license-transfer-code');

        // Type a wrong code
        await app.window.fill('#license-transfer-code', '000000');
        await app.window.click('#license-transfer-submit');

        const errLocator = app.window.locator('#license-transfer-error');
        await expect(errLocator).toBeVisible({ timeout: 10_000 });
        await expect(errLocator).toContainText(/4 attempts left/i);

        // Badge still FREE
        await expect(app.window.locator('#license-plan-badge')).toHaveText('FREE');
    } finally {
        await app.close();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario 6 — Team member transfer receives code at member email (not owner)
// ═══════════════════════════════════════════════════════════════════════════════
test('team member moving machines receives the code at their own email', async () => {
    const memberOldHash = require('crypto').createHash('sha256').update('member-old').digest('hex');
    await seedLicense(mockPort, {
        key: 'DYNAMO-TEAM-OWNER',
        plan: 'team',
        email: 'owner@company.com',
        seatsLimit: 5,
        members: [
            {
                email: 'owner@company.com',
                role: 'owner',
                memberKey: 'TEAM-OWNER-KEY-0001',
                invitedAt: new Date(),
                acceptedAt: new Date(),
            },
            {
                email: 'engineer@company.com',
                role: 'member',
                memberKey: 'TEAM-MEMBER-KEY-002',
                invitedAt: new Date(),
                acceptedAt: new Date(),
                machineId: memberOldHash,
                activatedAt: new Date(),
                lastRefreshAt: new Date(),
            },
        ],
    });

    const app = await launchApp({ mockPort, machineIdRaw: 'member-new-laptop', publicKeyPem });
    try {
        await app.window.click('#license-plan-badge');
        await app.window.fill('#license-key-input', 'TEAM-MEMBER-KEY-002');
        await app.window.click('#license-activate-btn');

        await app.window.waitForSelector('#license-transfer-code');

        // Email goes to the MEMBER, not the owner
        const { emails } = await getServerState(mockPort);
        expect(emails.length).toBe(1);
        expect(emails[0].to).toBe('engineer@company.com');

        // Complete the transfer
        await app.window.fill('#license-transfer-code', emails[0].code);
        await app.window.click('#license-transfer-submit');

        await app.window.waitForSelector('#license-modal', { state: 'detached', timeout: 10_000 });
        await expect(app.window.locator('#license-plan-badge')).toHaveText('TEAM');

        // Server state: member now bound to new machine
        const { licenses } = await getServerState(mockPort);
        const engineer = licenses[0].members.find((m) => m.email === 'engineer@company.com');
        expect(engineer.machineId).toBe(app.machineId);
    } finally {
        await app.close();
    }
});
