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

let requirePlan, requirePlanWhen, licenseService;

beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.DYNAMO_LICENSE_PUBLIC_KEY = await getTestPublicKeyPEM();
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_DIR);

    licenseService = require('../src/backend/services/licenseService');
    ({ requirePlan, requirePlanWhen } = require('../src/backend/middleware/license'));
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

// ═══════════════════════════════════════════════════════════════════════════════
// requirePlanWhen — conditional gate (PartiQL: SELECT free, writes need Pro)
// ═══════════════════════════════════════════════════════════════════════════════

describe('requirePlanWhen middleware', () => {
    const { isWriteStatement } = require('../src/backend/utils/partiql');
    const gate = () => requirePlanWhen((req) => isWriteStatement(req.body && req.body.statement), 'pro');

    test('free user: SELECT passes through (predicate false → no gate)', async () => {
        const { req, res, next } = mockReqRes();
        req.body = { statement: 'SELECT * FROM "t"' };
        await gate()(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res._status).toBeNull();
    });

    test('free user: INSERT is blocked with 402 and the usual upgrade payload', async () => {
        const { req, res, next } = mockReqRes();
        req.body = { statement: "INSERT INTO \"t\" VALUE {'pk': '1'}" };
        await gate()(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(402);
        expect(res._json.requiredPlan).toBe('pro');
        expect(res._json.currentPlan).toBe('free');
        expect(res._json.upgradeUrl).toContain('dynamoops.io');
    });

    test('pro user: DELETE passes and req.license is populated', async () => {
        const token = await signTestJWT({
            key: 'DYNAMO-PRO-MW', plan: 'pro', machineId: EXPECTED_MACHINE_HASH, email: 'pro@example.com',
        });
        await licenseService.saveLicense(token);

        const { req, res, next } = mockReqRes();
        req.body = { statement: 'DELETE FROM "t" WHERE "pk" = \'1\'' };
        await gate()(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.license.plan).toBe('pro');
    });

    test('a throwing predicate is treated as "gate does not apply"', async () => {
        const mw = requirePlanWhen(() => { throw new Error('boom'); }, 'pro');
        const { req, res, next } = mockReqRes();
        await mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
