'use strict';

const awsConfig = require('../config/aws');
const ssoService = require('../services/ssoService');
const dynamoService = require('../services/dynamoService');
const { requireString } = require('../middleware/validate');

module.exports = {
    getConfig(_req, res) {
        res.json({ profiles: ssoService.readAwsConfigProfiles() });
    },

    async start(req, res) {
        const { startUrl, region } = req.body || {};
        requireString(startUrl, 'startUrl');
        requireString(region, 'region');
        res.json(await ssoService.startLogin({ startUrl, region }));
    },

    async poll(req, res) {
        const sessionId = requireString(req.body?.sessionId, 'sessionId');
        res.json(await ssoService.pollLogin(sessionId));
    },

    async accounts(req, res) {
        res.json({ accounts: await ssoService.listAccounts(req.query.sessionId) });
    },

    async roles(req, res) {
        res.json({ roles: await ssoService.listRoles(req.query.sessionId, req.query.accountId) });
    },

    async connect(req, res) {
        // A new SSO session replaces any previous assumed-role / SSO session
        awsConfig.setAssumedRoleInfo(null);
        try {
            const result = await ssoService.connect(req.body || {});
            const tableCount = await dynamoService.testConnection(awsConfig.activeClients());
            awsConfig.setEnvTag(req.body?.envTag);
            awsConfig.setConnected(true);
            res.json({ success: true, config: result.config, role: result.role, tableCount });
        } catch (err) {
            awsConfig.setAssumedRoleInfo(null);
            throw err;
        }
    },

    signOut(req, res) {
        res.json(ssoService.signOut(req.body || {}));
    },
};
