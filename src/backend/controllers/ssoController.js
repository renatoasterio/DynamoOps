'use strict';

const awsConfig = require('../config/aws');
const ssoService = require('../services/ssoService');
const dynamoService = require('../services/dynamoService');

function fail(res, err, status = 500) {
    res.status(status).json({ success: false, error: err.message || String(err) });
}

class SsoController {
    getConfig(_req, res) {
        try {
            res.json({ profiles: ssoService.readAwsConfigProfiles() });
        } catch (err) { fail(res, err); }
    }

    async start(req, res) {
        try {
            const { startUrl, region } = req.body || {};
            if (!startUrl || !region) return fail(res, new Error('startUrl and region are required'), 400);
            res.json(await ssoService.startLogin({ startUrl, region }));
        } catch (err) { fail(res, err); }
    }

    async poll(req, res) {
        try {
            const { sessionId } = req.body || {};
            if (!sessionId) return fail(res, new Error('sessionId is required'), 400);
            res.json(await ssoService.pollLogin(sessionId));
        } catch (err) { fail(res, err); }
    }

    async accounts(req, res) {
        try {
            res.json({ accounts: await ssoService.listAccounts(req.query.sessionId) });
        } catch (err) { fail(res, err); }
    }

    async roles(req, res) {
        try {
            res.json({ roles: await ssoService.listRoles(req.query.sessionId, req.query.accountId) });
        } catch (err) { fail(res, err); }
    }

    async connect(req, res) {
        try {
            // A new SSO session replaces any previous assumed-role / SSO session
            awsConfig.setAssumedRoleInfo(null);
            const result = await ssoService.connect(req.body || {});
            const tableCount = await dynamoService.testConnection({
                dynamoClient: awsConfig.dynamoClient,
                docClient: awsConfig.docClient,
            });
            awsConfig.setConnected(true);
            res.json({ success: true, config: result.config, role: result.role, tableCount });
        } catch (err) {
            awsConfig.setAssumedRoleInfo(null);
            fail(res, err);
        }
    }

    signOut(req, res) {
        try {
            res.json(ssoService.signOut(req.body || {}));
        } catch (err) { fail(res, err); }
    }
}

module.exports = new SsoController();
