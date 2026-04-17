'use strict';

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { getTestPublicKeyPEM, signTestJWT } = require('./helpers/jwt');

const TEST_DIR = path.join(os.tmpdir(), `dynamoops-mw-test-${Date.now()}`);

jest.mock('electron', () => { throw new Error('no electron'); });

const MOCK_MACHINE_ID = 'test-machine-mw';
jest.mock('node-machine-id', () => ({
    machineIdSync: () => MOCK_MACHINE_ID,
}));

const EXPECTED_MACHINE_HASH = crypto
    .createHash('sha256')
    .update(MOCK_MACHINE_ID)
    .digest('hex');

let requirePlan, licenseService;

beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.DYNAMO_LICENSE_PUBLIC_KEY = await getTestPublicKeyPEM();
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);

    licenseService = require('../src/backend/services/licenseService');
    ({ requirePlan } = require('../src/backend/middleware/license'));
});

afterEach(() => {
    const subFile = path.join(TEST_DIR, '.dynamoops', 'license.json');
    if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
});

afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    jest.restoreAllMocks();
});

function mockReqRes() {
    const req = {};
    const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
    };
    const next = jest.fn();
    return { req, res, next };
}

describe('requirePlan middleware', () => {
    test('blocks free user from pro endpoint → 402', async () => {
        // No license file → free
        const middleware = requirePlan('pro');
        const { req, res, next } = mockReqRes();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(402);
        expect(res._json.requiredPlan).toBe('pro');
        expect(res._json.currentPlan).toBe('free');
        expect(res._json.upgradeUrl).toBeDefined();
    });

    test('allows pro user on pro endpoint → next()', async () => {
        const token = await signTestJWT({
            plan: 'pro',
            email: 'pro@test.com',
            key: 'DYNAMO-PRO-MW',
            machineId: EXPECTED_MACHINE_HASH,
        });
        await licenseService.saveLicense(token);

        const middleware = requirePlan('pro');
        const { req, res, next } = mockReqRes();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.license).toBeDefined();
        expect(req.license.plan).toBe('pro');
    });

    test('blocks pro user from pro_plus endpoint → 402', async () => {
        const token = await signTestJWT({
            plan: 'pro',
            email: 'pro@test.com',
            key: 'DYNAMO-PRO-MW',
            machineId: EXPECTED_MACHINE_HASH,
        });
        await licenseService.saveLicense(token);

        const middleware = requirePlan('pro_plus');
        const { req, res, next } = mockReqRes();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(402);
        expect(res._json.currentPlan).toBe('pro');
    });

    test('allows pro_plus user on pro endpoint → next()', async () => {
        const token = await signTestJWT({
            plan: 'pro_plus',
            email: 'plus@test.com',
            key: 'DYNAMO-PLUS-MW',
            machineId: EXPECTED_MACHINE_HASH,
        });
        await licenseService.saveLicense(token);

        const middleware = requirePlan('pro');
        const { req, res, next } = mockReqRes();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.license.plan).toBe('pro_plus');
    });

    test('allows team user on all endpoints', async () => {
        const token = await signTestJWT({
            plan: 'team',
            email: 'team@test.com',
            key: 'DYNAMO-TEAM-MW',
            machineId: EXPECTED_MACHINE_HASH,
        });
        await licenseService.saveLicense(token);

        for (const plan of ['free', 'pro', 'pro_plus', 'team']) {
            const middleware = requirePlan(plan);
            const { req, res, next } = mockReqRes();
            await middleware(req, res, next);
            expect(next).toHaveBeenCalled();
        }
    });

    test('free user passes free endpoint → next()', async () => {
        const middleware = requirePlan('free');
        const { req, res, next } = mockReqRes();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});
