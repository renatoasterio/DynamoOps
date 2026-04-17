'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getTestPublicKeyPEM, signTestJWT } = require('./helpers/jwt');

const TEST_DIR = path.join(os.tmpdir(), `dynamoops-transfer-test-${Date.now()}`);
const LICENSE_FILE = path.join(TEST_DIR, '.dynamoops', 'license.json');

jest.mock('electron', () => { throw new Error('no electron'); });

const MOCK_MACHINE_ID = 'transfer-test-machine';
jest.mock('node-machine-id', () => ({
    machineIdSync: () => MOCK_MACHINE_ID,
}));

const EXPECTED_MACHINE_HASH = crypto
    .createHash('sha256')
    .update(MOCK_MACHINE_ID)
    .digest('hex');

let licenseService;
let fetchCalls;

beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.DYNAMO_LICENSE_PUBLIC_KEY = await getTestPublicKeyPEM();
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);
    licenseService = require('../src/backend/services/licenseService');
});

beforeEach(() => {
    fetchCalls = [];
});

afterEach(() => {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
    delete global.fetch;
});

afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    jest.restoreAllMocks();
});

function mockFetch(responses) {
    let call = 0;
    global.fetch = jest.fn(async (url, opts) => {
        fetchCalls.push({ url, opts });
        const response = Array.isArray(responses) ? responses[call++] : responses;
        return {
            ok: response.ok !== false && response.status >= 200 && response.status < 300,
            status: response.status,
            json: async () => response.body,
        };
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// refreshLicense — MACHINE_REVOKED (410) handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('refreshLicense with MACHINE_REVOKED', () => {
    test('410 response deletes local license.json and returns { revoked: true }', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-1234',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'pro@example.com',
        });
        await licenseService.saveLicense(token);
        expect(fs.existsSync(LICENSE_FILE)).toBe(true);

        mockFetch({ status: 410, body: { code: 'MACHINE_REVOKED' } });

        const result = await licenseService.refreshLicense();

        expect(result.plan).toBe('free');
        expect(result.revoked).toBe(true);
        expect(fs.existsSync(LICENSE_FILE)).toBe(false);
        expect(fetchCalls[0].url).toMatch(/\/api\/license\/refresh$/);
    });

    test('200 response saves new token and keeps license.json', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-9999',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'pro2@example.com',
        });
        await licenseService.saveLicense(token);

        const newToken = await signTestJWT({
            key: 'DYNAMO-PRO-9999',
            plan: 'pro_plus',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'pro2@example.com',
        });
        mockFetch({ status: 200, body: { token: newToken } });

        const result = await licenseService.refreshLicense();

        expect(result.plan).toBe('pro_plus');
        expect(result.revoked).toBeUndefined();
        expect(fs.existsSync(LICENSE_FILE)).toBe(true);
    });

    test('network failure falls back to offline validation', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-OFF',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'off@example.com',
        });
        await licenseService.saveLicense(token);

        global.fetch = jest.fn(async () => { throw new Error('network down'); });

        const result = await licenseService.refreshLicense();

        expect(result.plan).toBe('pro');
        expect(result.revoked).toBeUndefined();
        expect(fs.existsSync(LICENSE_FILE)).toBe(true); // preserved
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requestTransfer / confirmTransfer flows
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestTransfer', () => {
    test('posts key + newMachineId and returns emailHint', async () => {
        mockFetch({
            status: 200,
            body: { ok: true, expiresInMinutes: 15, emailHint: 'r***@o***.com' },
        });

        const result = await licenseService.requestTransfer('DYNAMO-PRO-AAAA');

        expect(result.success).toBe(true);
        expect(result.emailHint).toBe('r***@o***.com');

        const sent = JSON.parse(fetchCalls[0].opts.body);
        expect(sent.key).toBe('DYNAMO-PRO-AAAA');
        expect(sent.newMachineId).toBe(EXPECTED_MACHINE_HASH);
        expect(fetchCalls[0].opts.headers['x-user-agent']).toContain('DynamoOps');
    });

    test('surfaces TRANSFER_LIMIT_EXCEEDED cleanly', async () => {
        mockFetch({
            status: 429,
            body: { error: 'Annual transfer limit reached.', code: 'TRANSFER_LIMIT_EXCEEDED' },
        });

        const result = await licenseService.requestTransfer('DYNAMO-PRO-BBBB');

        expect(result.success).toBe(false);
        expect(result.code).toBe('TRANSFER_LIMIT_EXCEEDED');
    });
});

describe('confirmTransfer', () => {
    test('saves new JWT on success', async () => {
        const newToken = await signTestJWT({
            key: 'DYNAMO-PRO-CCCC',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'conf@example.com',
        });
        mockFetch({
            status: 200,
            body: { token: newToken, plan: 'pro', email: 'conf@example.com' },
        });

        const result = await licenseService.confirmTransfer('DYNAMO-PRO-CCCC', '123456');

        expect(result.success).toBe(true);
        expect(result.plan).toBe('pro');
        expect(fs.existsSync(LICENSE_FILE)).toBe(true);

        const saved = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
        expect(saved.token).toBe(newToken);
    });

    test('returns attemptsLeft when code is wrong', async () => {
        mockFetch({
            status: 400,
            body: { error: 'Invalid or expired code', attemptsLeft: 3 },
        });

        const result = await licenseService.confirmTransfer('DYNAMO-PRO-DDDD', '000000');

        expect(result.success).toBe(false);
        expect(result.attemptsLeft).toBe(3);
        expect(fs.existsSync(LICENSE_FILE)).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getActivationHistory
// ═══════════════════════════════════════════════════════════════════════════════

describe('getActivationHistory', () => {
    test('returns { success: false } when no license is present', async () => {
        const result = await licenseService.getActivationHistory();
        expect(result.success).toBe(false);
    });

    test('fetches with Bearer token when license exists', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-HIST',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'hist@example.com',
        });
        await licenseService.saveLicense(token);

        mockFetch({
            status: 200,
            body: {
                current: { machineSuffix: 'abcdef', activatedAt: new Date().toISOString() },
                history: [],
            },
        });

        const result = await licenseService.getActivationHistory();

        expect(result.success).toBe(true);
        expect(result.current.machineSuffix).toBe('abcdef');
        expect(fetchCalls[0].opts.headers.Authorization).toBe(`Bearer ${token}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// startPeriodicRefresh — onRevoked callback triggers on 410
// ═══════════════════════════════════════════════════════════════════════════════

describe('startPeriodicRefresh', () => {
    test('invokes onRevoked callback when refresh returns 410', async () => {
        jest.useFakeTimers();

        const token = await signTestJWT({
            key: 'DYNAMO-PRO-PER',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'per@example.com',
        });
        await licenseService.saveLicense(token);

        mockFetch({ status: 410, body: { code: 'MACHINE_REVOKED' } });

        const onRevoked = jest.fn();
        const stop = licenseService.startPeriodicRefresh(onRevoked);

        // Advance 24h to trigger the first tick and allow async callback to resolve
        await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

        expect(onRevoked).toHaveBeenCalledTimes(1);

        stop();
        jest.useRealTimers();
    });
});
