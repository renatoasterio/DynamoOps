'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => { throw new Error('no electron'); });

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamoops-sso-'));

let ssoService, awsConfig;
let oidcCalls, ssoCalls;
let behaviour;

// Fake SDK clients: dispatch on the command class name
function fakeClient(log, handlers) {
    return (region) => ({
        send: async (cmd) => {
            const name = cmd.constructor.name;
            log.push({ region, name, input: cmd.input });
            const h = handlers[name];
            if (!h) throw new Error(`unexpected command ${name}`);
            return h(cmd.input, region);
        },
    });
}

function awsError(name) { const e = new Error(name); e.name = name; return e; }

beforeAll(() => {
    jest.spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    ssoService = require('../src/backend/services/ssoService');
    awsConfig  = require('../src/backend/config/aws');
});

beforeEach(() => {
    ssoService._reset();
    fs.rmSync(path.join(TEST_HOME, '.dynamoops'), { recursive: true, force: true });
    fs.rmSync(path.join(TEST_HOME, '.aws'), { recursive: true, force: true });
    oidcCalls = []; ssoCalls = [];
    behaviour = { tokenAttempts: 0, tokenReadyAfter: 1 };

    ssoService._setClientFactories(
        fakeClient(oidcCalls, {
            RegisterClientCommand: () => ({ clientId: 'cid', clientSecret: 'csec', clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 90 * 86400 }),
            StartDeviceAuthorizationCommand: (input) => ({
                deviceCode: 'dev-code', userCode: 'ABCD-EFGH',
                verificationUri: 'https://device.sso.us-east-1.amazonaws.com/',
                verificationUriComplete: `https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH&start=${encodeURIComponent(input.startUrl)}`,
                expiresIn: 600, interval: 1,
            }),
            CreateTokenCommand: () => {
                behaviour.tokenAttempts += 1;
                if (behaviour.tokenAttempts < behaviour.tokenReadyAfter) throw awsError('AuthorizationPendingException');
                if (behaviour.denied) throw awsError('AccessDeniedException');
                return { accessToken: 'tok-' + behaviour.tokenAttempts, expiresIn: 28800 };
            },
        }),
        fakeClient(ssoCalls, {
            ListAccountsCommand: () => ({ accountList: [
                { accountId: '222', accountName: 'Prod', emailAddress: 'p@x' },
                { accountId: '111', accountName: 'Dev', emailAddress: 'd@x' },
            ] }),
            ListAccountRolesCommand: (input) => ({ roleList: input.accountId === '111'
                ? [{ roleName: 'ReadOnly' }, { roleName: 'Admin' }]
                : [{ roleName: 'Admin' }] }),
            GetRoleCredentialsCommand: (input) => ({ roleCredentials: {
                accessKeyId: 'AKIA' + input.roleName, secretAccessKey: 'sec', sessionToken: 'tokn',
                expiration: Date.now() + (behaviour.credsTtlMs ?? 3600_000),
            } }),
        }),
    );
});

afterEach(() => {
    awsConfig.setAssumedRoleInfo(null);
    awsConfig.setCurrentConfig({ region: 'us-east-1', profile: 'default', endpoint: '' });
    awsConfig.setConnected(false);
});

afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    jest.restoreAllMocks();
});

const START = { startUrl: 'https://acme.awsapps.com/start', region: 'us-east-1' };

async function signIn() {
    const s = await ssoService.startLogin(START);
    if (s.authorized) return s.sessionId;
    let r;
    do { r = await ssoService.pollLogin(s.sessionId); } while (r.status === 'pending');
    expect(r.status).toBe('authorized');
    return s.sessionId;
}

describe('ssoService — device authorization flow', () => {
    test('startLogin registers the client once and returns the browser URL + code', async () => {
        const s = await ssoService.startLogin(START);
        expect(s.authorized).toBe(false);
        expect(s.userCode).toBe('ABCD-EFGH');
        expect(s.verificationUriComplete).toContain('user_code=ABCD-EFGH');
        expect(oidcCalls.map((c) => c.name)).toEqual(['RegisterClientCommand', 'StartDeviceAuthorizationCommand']);

        // second start (new session) reuses the cached client registration
        await ssoService.startLogin(START);
        expect(oidcCalls.filter((c) => c.name === 'RegisterClientCommand')).toHaveLength(1);
    });

    test('normalizes the start URL (scheme + trailing slash)', () => {
        expect(ssoService.normalizeStartUrl(' acme.awsapps.com/start/ ')).toBe('https://acme.awsapps.com/start');
        expect(ssoService.normalizeStartUrl('')).toBe('');
    });

    test('pollLogin reports pending until the browser approves, then caches the token', async () => {
        behaviour.tokenReadyAfter = 3;
        const s = await ssoService.startLogin(START);
        expect((await ssoService.pollLogin(s.sessionId)).status).toBe('pending');
        expect((await ssoService.pollLogin(s.sessionId)).status).toBe('pending');
        const ok = await ssoService.pollLogin(s.sessionId);
        expect(ok.status).toBe('authorized');
        expect(ok.expiresAt).toBeGreaterThan(Date.now());

        const cacheFile = path.join(TEST_HOME, '.dynamoops', 'sso-cache.json');
        expect(fs.existsSync(cacheFile)).toBe(true);
        expect((fs.statSync(cacheFile).mode & 0o777)).toBe(0o600);

        // next launch: no browser needed
        const again = await ssoService.startLogin(START);
        expect(again.authorized).toBe(true);
        expect(again.source).toBe('cache');
    });

    test('denied / expired / unknown sessions are reported, not thrown', async () => {
        behaviour.denied = true;
        const s = await ssoService.startLogin(START);
        expect((await ssoService.pollLogin(s.sessionId)).status).toBe('denied');
        expect((await ssoService.pollLogin('nope')).status).toBe('unknown');
    });

    test('reuses an existing `aws sso login` token from ~/.aws/sso/cache', async () => {
        const dir = path.join(TEST_HOME, '.aws', 'sso', 'cache');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'abc.json'), JSON.stringify({
            startUrl: 'https://acme.awsapps.com/start/', region: 'us-east-1',
            accessToken: 'cli-token', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }));
        const s = await ssoService.startLogin(START);
        expect(s.authorized).toBe(true);
        expect(s.source).toBe('aws-cli');
        expect(oidcCalls).toHaveLength(0);
    });
});

describe('ssoService — accounts, roles, connect', () => {
    test('lists accounts sorted by name and roles per account', async () => {
        const id = await signIn();
        const accounts = await ssoService.listAccounts(id);
        expect(accounts.map((a) => a.accountName)).toEqual(['Dev', 'Prod']);
        const roles = await ssoService.listRoles(id, '111');
        expect(roles.map((r) => r.roleName)).toEqual(['Admin', 'ReadOnly']);
        expect(ssoCalls[0].input.accessToken).toMatch(/^tok-/);
    });

    test('connect wires temporary credentials into awsConfig like an assumed role', async () => {
        const id = await signIn();
        const result = await ssoService.connect({ sessionId: id, accountId: '111', accountName: 'Dev', roleName: 'Admin', region: 'sa-east-1' });

        expect(result.config).toEqual({ region: 'sa-east-1', profile: 'sso', endpoint: '' });
        expect(awsConfig.currentConfig.profile).toBe('sso');
        expect(awsConfig.assumedRoleInfo.roleArn).toBe('arn:aws:iam::111:role/Admin');
        expect(awsConfig.assumedRoleInfo.sso).toMatchObject({ accountId: '111', roleName: 'Admin', accountName: 'Dev', startUrl: START.startUrl });
        expect(Date.parse(awsConfig.assumedRoleInfo.expiration)).toBeGreaterThan(Date.now());

        const creds = await awsConfig.dynamoClient.config.credentials();
        expect(creds.accessKeyId).toBe('AKIAAdmin');
        expect(creds.sessionToken).toBe('tokn');
    });

    test('connect requires a live session and an account/role', async () => {
        await expect(ssoService.connect({ sessionId: 'missing', accountId: '1', roleName: 'r' })).rejects.toThrow(/sign in again/i);
        const id = await signIn();
        await expect(ssoService.connect({ sessionId: id, accountId: '', roleName: '' })).rejects.toThrow(/required/);
    });

    test('ensureFreshCredentials renews role credentials shortly before expiry', async () => {
        behaviour.credsTtlMs = 2 * 60_000; // expires in 2 min → inside the 5 min window
        const id = await signIn();
        await ssoService.connect({ sessionId: id, accountId: '111', roleName: 'Admin', region: 'us-east-1' });
        const before = awsConfig.assumedRoleInfo.expiration;

        behaviour.credsTtlMs = 3600_000;
        expect(await ssoService.ensureFreshCredentials()).toBe(true);
        expect(Date.parse(awsConfig.assumedRoleInfo.expiration)).toBeGreaterThan(Date.parse(before));
        expect(ssoCalls.filter((c) => c.name === 'GetRoleCredentialsCommand')).toHaveLength(2);

        // nothing to do when far from expiry, or when no SSO session is active
        expect(await ssoService.ensureFreshCredentials()).toBe(false);
        awsConfig.setAssumedRoleInfo({ roleArn: 'arn:aws:iam::1:role/x', expiration: new Date(Date.now() + 1000).toISOString() });
        expect(await ssoService.ensureFreshCredentials()).toBe(false);
    });

    test('signOut forgets the cached token so the browser is needed again', async () => {
        await signIn();
        expect((await ssoService.startLogin(START)).authorized).toBe(true);
        ssoService.signOut(START);
        expect((await ssoService.startLogin(START)).authorized).toBe(false);
    });
});

describe('ssoService.readAwsConfigProfiles', () => {
    test('parses sso-session based and legacy sso_* profiles, skips non-SSO ones', () => {
        const dir = path.join(TEST_HOME, '.aws');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'config'), `
[default]
region = us-east-1

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start/
sso_region = us-east-2

[profile dev]
sso_session = acme
sso_account_id = 111
sso_role_name = Admin
region = sa-east-1

[profile legacy]
sso_start_url = https://old.awsapps.com/start
sso_region = eu-west-1
sso_account_id = 333
sso_role_name = ReadOnly

[profile plain]
region = us-west-2
`);
        const profiles = ssoService.readAwsConfigProfiles();
        expect(profiles).toEqual([
            { profile: 'dev', startUrl: 'https://acme.awsapps.com/start', ssoRegion: 'us-east-2', accountId: '111', roleName: 'Admin', region: 'sa-east-1' },
            { profile: 'legacy', startUrl: 'https://old.awsapps.com/start', ssoRegion: 'eu-west-1', accountId: '333', roleName: 'ReadOnly', region: '' },
        ]);
    });

    test('returns an empty list without a config file', () => {
        expect(ssoService.readAwsConfigProfiles()).toEqual([]);
    });
});

describe('ssoService — error messages', () => {
    test('an unknown start URL becomes an actionable message (not "UnknownError")', async () => {
        ssoService._setClientFactories(fakeClient(oidcCalls, {
            RegisterClientCommand: () => ({ clientId: 'cid', clientSecret: 'csec', clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400 }),
            StartDeviceAuthorizationCommand: () => {
                const e = new Error('UnknownError');
                e.name = 'InvalidRequestException'; e.error = 'invalid_request'; e.error_description = 'Invalid request';
                throw e;
            },
        }), null);
        await expect(ssoService.startLogin({ startUrl: 'https://nope.awsapps.com/start', region: 'us-east-1' }))
            .rejects.toThrow(/did not recognize this SSO start URL/);
    });

    test('a stale client registration is dropped from the cache', async () => {
        let registrations = 0;
        ssoService._setClientFactories(fakeClient(oidcCalls, {
            RegisterClientCommand: () => { registrations += 1; return { clientId: 'cid' + registrations, clientSecret: 'x', clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400 }; },
            StartDeviceAuthorizationCommand: () => { const e = new Error('UnknownError'); e.name = 'InvalidClientException'; throw e; },
        }), null);
        await expect(ssoService.startLogin(START)).rejects.toThrow(/no longer valid/);
        await expect(ssoService.startLogin(START)).rejects.toThrow(/no longer valid/);
        expect(registrations).toBe(2); // re-registered after the first failure
    });

    test('describeSsoError keeps useful SDK messages and maps network failures', () => {
        expect(ssoService.describeSsoError({ name: 'ValidationException', message: 'accessToken is required' }, 'accounts').message)
            .toBe('SSO request failed: accessToken is required');
        expect(ssoService.describeSsoError({ name: 'Error', code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND oidc.us-east-1.amazonaws.com' }, 'start').message)
            .toMatch(/Could not reach AWS/);
    });
});
