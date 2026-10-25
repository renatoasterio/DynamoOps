'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getTestPublicKeyPEM, signTestJWT, signExpiredJWT } = require('./helpers/jwt');

// ─── Test setup: use temp dir + test key ─────────────────────────────────────

const TEST_DIR = path.join(os.tmpdir(), `dynamoops-test-${Date.now()}`);
const LICENSE_FILE = path.join(TEST_DIR, 'license.json');

// Mock electron so getUserDataPath falls back to TEST_DIR
jest.mock('electron', () => { throw new Error('no electron'); });

// Mock node-machine-id to return a fixed value
const MOCK_MACHINE_ID = 'test-machine-id-12345';
jest.mock('node-machine-id', () => ({
    machineIdSync: () => MOCK_MACHINE_ID,
}));

const EXPECTED_MACHINE_HASH = crypto
    .createHash('sha256')
    .update(MOCK_MACHINE_ID)
    .digest('hex');

let licenseService;

beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Set the public key and data dir BEFORE requiring the module
    const pubKeyPEM = await getTestPublicKeyPEM();
    process.env.DYNAMO_LICENSE_PUBLIC_KEY = pubKeyPEM;

    // Override homedir so getUserDataPath fallback uses our test dir
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);

    // Now require the module (reads env at require time)
    licenseService = require('../src/backend/services/licenseService');
});

afterEach(() => {
    // Clean up license file between tests
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
    // Also clean the .dynamoops subdir
    const subDir = path.join(TEST_DIR, '.dynamoops');
    const subFile = path.join(subDir, 'license.json');
    if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
});

afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    jest.restoreAllMocks();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function saveToken(token) {
    await licenseService.saveLicense(token);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('licenseService', () => {
    // ── planMeetsRequirement ─────────────────────────────────────────────────

    describe('planMeetsRequirement', () => {
        test('free meets free', () => {
            expect(licenseService.planMeetsRequirement('free', 'free')).toBe(true);
        });

        test('pro meets free', () => {
            expect(licenseService.planMeetsRequirement('pro', 'free')).toBe(true);
        });

        test('pro meets pro', () => {
            expect(licenseService.planMeetsRequirement('pro', 'pro')).toBe(true);
        });

        test('free does NOT meet pro', () => {
            expect(licenseService.planMeetsRequirement('free', 'pro')).toBe(false);
        });

        test('pro does NOT meet pro_plus', () => {
            expect(licenseService.planMeetsRequirement('pro', 'pro_plus')).toBe(false);
        });

        test('pro_plus meets pro', () => {
            expect(licenseService.planMeetsRequirement('pro_plus', 'pro')).toBe(true);
        });

        test('team meets everything', () => {
            expect(licenseService.planMeetsRequirement('team', 'free')).toBe(true);
            expect(licenseService.planMeetsRequirement('team', 'pro')).toBe(true);
            expect(licenseService.planMeetsRequirement('team', 'pro_plus')).toBe(true);
            expect(licenseService.planMeetsRequirement('team', 'team')).toBe(true);
        });

        test('unknown plan returns false', () => {
            expect(licenseService.planMeetsRequirement('enterprise', 'pro')).toBe(false);
            expect(licenseService.planMeetsRequirement('pro', 'enterprise')).toBe(false);
        });
    });

    // ── getLicenseStatus — no token ──────────────────────────────────────────

    describe('getLicenseStatus — no token', () => {
        test('returns free when no license.json exists', async () => {
            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });

        test('returns free for corrupted license.json', async () => {
            const dir = path.join(TEST_DIR, '.dynamoops');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'license.json'), 'GARBAGE{{{', 'utf8');
            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });

        test('returns free for license.json without token field', async () => {
            const dir = path.join(TEST_DIR, '.dynamoops');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ foo: 'bar' }), 'utf8');
            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });
    });

    // ── getLicenseStatus — valid token ───────────────────────────────────────

    describe('getLicenseStatus — valid token', () => {
        test('returns pro plan for valid JWT', async () => {
            const token = await signTestJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-TEST-1234',
                machineId: EXPECTED_MACHINE_HASH,
            });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('pro');
            expect(status.email).toBe('test@example.com');
            expect(status.key).toBe('DYNAMO-TEST-1234');
            expect(status.gracePeriod).toBe(false);
            expect(status._rawToken).toBe(token);
        });

        test('returns pro_plus for pro_plus JWT', async () => {
            const token = await signTestJWT({
                plan: 'pro_plus',
                email: 'vip@example.com',
                key: 'DYNAMO-VIP-5678',
                machineId: EXPECTED_MACHINE_HASH,
            });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('pro_plus');
        });

        test('returns team for team JWT', async () => {
            const token = await signTestJWT({
                plan: 'team',
                email: 'team@example.com',
                key: 'DYNAMO-TEAM-9999',
                machineId: EXPECTED_MACHINE_HASH,
            });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('team');
        });

        test('includes daysUntilRenewal > 0 for valid token', async () => {
            const token = await signTestJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-TEST-1234',
                machineId: EXPECTED_MACHINE_HASH,
            }, { expiresIn: '7d' });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.daysUntilRenewal).toBeGreaterThan(0);
            expect(status.daysUntilRenewal).toBeLessThanOrEqual(7);
        });
    });

    // ── getLicenseStatus — machine ID mismatch ──────────────────────────────

    describe('getLicenseStatus — machine ID mismatch', () => {
        test('returns free when machineId does not match', async () => {
            const token = await signTestJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-TEST-1234',
                machineId: 'wrong-machine-id-hash',
            });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });
    });

    // ── getLicenseStatus — expired token ─────────────────────────────────────

    describe('getLicenseStatus — expired token', () => {
        test('returns plan with gracePeriod=true when expired < 7 days ago', async () => {
            const token = await signExpiredJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-EXPIRED',
                machineId: EXPECTED_MACHINE_HASH,
            }, { expiredAgo: '2h' }); // expired 2 hours ago
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('pro');
            expect(status.gracePeriod).toBe(true);
        });

        test('returns free when expired > 7 days ago', async () => {
            const token = await signExpiredJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-DEAD',
                machineId: EXPECTED_MACHINE_HASH,
            }, { expiredAgo: '8d' }); // expired 8 days ago
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });

        test('grace period boundary: exactly 7 days past should return free', async () => {
            const token = await signExpiredJWT({
                plan: 'pro_plus',
                email: 'test@example.com',
                key: 'DYNAMO-BOUNDARY',
                machineId: EXPECTED_MACHINE_HASH,
            }, { expiredAgo: '7d' });
            await saveToken(token);

            const status = await licenseService.getLicenseStatus();
            // 7 days = exactly at boundary, should be free (> not >=)
            expect(status.plan).toBe('free');
        });
    });

    // ── getLicenseStatus — invalid/tampered token ────────────────────────────

    describe('getLicenseStatus — invalid token', () => {
        test('returns free for tampered JWT', async () => {
            const token = await signTestJWT({
                plan: 'pro',
                email: 'test@example.com',
                key: 'DYNAMO-TEST-1234',
                machineId: EXPECTED_MACHINE_HASH,
            });
            // Tamper with the token
            const tampered = token.slice(0, -10) + 'AAAAAAAAAA';
            await saveToken(tampered);

            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });

        test('returns free for completely invalid string', async () => {
            await saveToken('not-a-jwt-at-all');
            const status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });
    });

    // ── saveLicense / deactivateLicense ──────────────────────────────────────

    describe('saveLicense / deactivateLicense', () => {
        test('saveLicense writes token file', async () => {
            await licenseService.saveLicense('test-token-123');
            const dir = path.join(TEST_DIR, '.dynamoops');
            const file = path.join(dir, 'license.json');
            expect(fs.existsSync(file)).toBe(true);
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            expect(data.token).toBe('test-token-123');
        });

        test('deactivateLicense removes file', async () => {
            await licenseService.saveLicense('test-token-123');
            await licenseService.deactivateLicense();
            const dir = path.join(TEST_DIR, '.dynamoops');
            const file = path.join(dir, 'license.json');
            expect(fs.existsSync(file)).toBe(false);
        });

        test('deactivateLicense is safe when no file exists', async () => {
            await expect(licenseService.deactivateLicense()).resolves.not.toThrow();
        });

        test('full cycle: save → verify → deactivate → free', async () => {
            const token = await signTestJWT({
                plan: 'pro',
                email: 'cycle@test.com',
                key: 'DYNAMO-CYCLE',
                machineId: EXPECTED_MACHINE_HASH,
            });

            // Save → should be pro
            await licenseService.saveLicense(token);
            let status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('pro');

            // Deactivate → should be free
            await licenseService.deactivateLicense();
            status = await licenseService.getLicenseStatus();
            expect(status.plan).toBe('free');
        });
    });
});
