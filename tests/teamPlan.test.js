'use strict';

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getTestPublicKeyPEM, signTestJWT } = require('./helpers/jwt');

const TEST_DIR = path.join(os.tmpdir(), `dynamoops-team-test-${Date.now()}`);

jest.mock('electron', () => { throw new Error('no electron'); });

const MOCK_MACHINE_ID = 'team-test-machine';
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
    process.env.DYNAMO_LICENSE_PUBLIC_KEY = await getTestPublicKeyPEM();
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);
    licenseService = require('../src/backend/services/licenseService');
});

afterEach(() => {
    const subFile = path.join(TEST_DIR, '.dynamoops', 'license.json');
    if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
});

afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team plan — JWT payload validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team plan — JWT payload', () => {
    test('team owner JWT produces status with teamRole=owner and ownerKey', async () => {
        const ownerKey  = 'DYNAMO-TEAM-OWNER-MASTER-1111';
        const memberKey = 'TEAM-AAAA-BBBB-CCCC-DDDD';

        const token = await signTestJWT({
            key: memberKey,
            plan: 'team',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'owner@example.com',
            ownerKey,
            teamRole: 'owner',
        });
        await licenseService.saveLicense(token);

        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('team');
        expect(status.teamRole).toBe('owner');
        expect(status.ownerKey).toBe(ownerKey);
        expect(status.email).toBe('owner@example.com');
    });

    test('team member JWT produces status with teamRole=member', async () => {
        const ownerKey  = 'DYNAMO-TEAM-OWNER-MASTER-2222';
        const memberKey = 'TEAM-XXXX-YYYY-ZZZZ-WWWW';

        const token = await signTestJWT({
            key: memberKey,
            plan: 'team',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'member@example.com',
            ownerKey,
            teamRole: 'member',
        });
        await licenseService.saveLicense(token);

        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('team');
        expect(status.teamRole).toBe('member');
        expect(status.ownerKey).toBe(ownerKey);
    });

    test('team plan passes pro_plus requirement (hierarchy)', async () => {
        expect(licenseService.planMeetsRequirement('team', 'pro_plus')).toBe(true);
        expect(licenseService.planMeetsRequirement('team', 'pro')).toBe(true);
        expect(licenseService.planMeetsRequirement('team', 'free')).toBe(true);
    });

    test('pro_plus does NOT meet team requirement', () => {
        expect(licenseService.planMeetsRequirement('pro_plus', 'team')).toBe(false);
    });

    test('non-team JWT has teamRole=null and ownerKey=null', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-KEY',
            plan: 'pro',
            machineId: EXPECTED_MACHINE_HASH,
            email: 'solo@example.com',
        });
        await licenseService.saveLicense(token);

        const status = await licenseService.getLicenseStatus();
        expect(status.plan).toBe('pro');
        expect(status.teamRole).toBeNull();
        expect(status.ownerKey).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team helpers (memberKey generation, seat limits)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team member key generation', () => {
    // Simulates the memberKey pattern used by the server
    function generateMemberKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const group = () =>
            Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        return `TEAM-${group()}-${group()}-${group()}-${group()}`;
    }

    test('memberKey starts with TEAM- prefix', () => {
        const key = generateMemberKey();
        expect(key).toMatch(/^TEAM-/);
    });

    test('memberKey has 4 groups of 4 alphanumeric chars', () => {
        const key = generateMemberKey();
        expect(key).toMatch(/^TEAM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    test('memberKey is unique per generation', () => {
        const keys = new Set();
        for (let i = 0; i < 100; i++) keys.add(generateMemberKey());
        expect(keys.size).toBe(100);
    });
});
