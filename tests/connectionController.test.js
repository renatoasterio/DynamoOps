'use strict';

const awsConfig = require('../src/backend/config/aws');
const connectionController = require('../src/backend/controllers/connectionController');

function mockRes() {
    const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
    };
    return res;
}

describe('connectionController', () => {
    afterEach(() => {
        // Reset state after each test
        awsConfig.setAssumedRoleInfo(null);
        awsConfig.setCurrentConfig({ region: 'us-east-1', profile: 'default', endpoint: '' });
        awsConfig.setConnected(false);
    });

    describe('disconnect', () => {
        test('clears assumedRoleInfo', () => {
            awsConfig.setAssumedRoleInfo({ roleArn: 'arn:aws:iam::123:role/test' });
            expect(awsConfig.assumedRoleInfo).not.toBeNull();

            const res = mockRes();
            connectionController.disconnect({}, res);

            expect(awsConfig.assumedRoleInfo).toBeNull();
            expect(res._json.success).toBe(true);
        });

        test('resets currentConfig to defaults', () => {
            awsConfig.setCurrentConfig({ region: 'eu-west-1', profile: 'prod', endpoint: 'http://localhost:4566' });

            const res = mockRes();
            connectionController.disconnect({}, res);

            expect(awsConfig.currentConfig.region).toBe('us-east-1');
            expect(awsConfig.currentConfig.profile).toBe('default');
            expect(awsConfig.currentConfig.endpoint).toBe('');
        });

        test('sets connected to false', () => {
            awsConfig.setConnected(true);

            const res = mockRes();
            connectionController.disconnect({}, res);

            expect(awsConfig.isConnected).toBe(false);
        });
    });

    describe('disconnect clears LocalStack endpoint', () => {
        test('after LocalStack connect then disconnect, endpoint is cleared', () => {
            // Simulate LocalStack connection
            awsConfig.setCurrentConfig({ region: 'us-east-1', profile: 'default', endpoint: 'http://localhost:4566' });
            awsConfig.setConnected(true);
            expect(awsConfig.currentConfig.endpoint).toBe('http://localhost:4566');

            // Disconnect
            const res = mockRes();
            connectionController.disconnect({}, res);

            // Endpoint must be cleared
            expect(awsConfig.currentConfig.endpoint).toBe('');
        });
    });

    describe('connect', () => {
        test('clears assumedRoleInfo on new connection', async () => {
            awsConfig.setAssumedRoleInfo({ roleArn: 'arn:aws:iam::123:role/old' });

            const req = {
                body: { region: 'us-east-1', profile: 'default', endpoint: '' },
            };
            const res = mockRes();

            // connect will try to test the connection and may fail (no real AWS),
            // but we can still verify assumedRoleInfo is cleared
            try {
                await connectionController.connect(req, res);
            } catch (_) {}

            expect(awsConfig.assumedRoleInfo).toBeNull();
        });
    });
});
