const awsConfig = require('../config/aws');
const { assumeRole } = require('../services/stsService');
const dynamoService = require('../services/dynamoService');

const DEFAULT_CONFIG = { region: 'us-east-1', profile: 'default', endpoint: '' };

module.exports = {
    getConfig(_req, res) {
        res.json({
            ...awsConfig.currentConfig,
            assumedRole: awsConfig.assumedRoleInfo,
            connected: awsConfig.isConnected,
        });
    },

    async connect(req, res) {
        const { region, profile, endpoint } = req.body || {};
        const newConfig = {
            region: region || DEFAULT_CONFIG.region,
            profile: profile || DEFAULT_CONFIG.profile,
            endpoint: endpoint || DEFAULT_CONFIG.endpoint,
        };

        // Clear any previous assumed-role session so the middleware
        // doesn't keep using stale STS credentials.
        awsConfig.setAssumedRoleInfo(null);
        awsConfig.setCurrentConfig(newConfig);
        awsConfig.createClients(newConfig);

        const tableCount = await dynamoService.testConnection(awsConfig.activeClients());
        awsConfig.setConnected(true);
        res.json({ success: true, config: newConfig, tableCount });
    },

    disconnect(_req, res) {
        awsConfig.setAssumedRoleInfo(null);
        awsConfig.setCurrentConfig({ ...DEFAULT_CONFIG });
        awsConfig.setConnected(false);
        res.json({ success: true });
    },

    async handleAssumeRole(req, res) {
        const result = await assumeRole(req.body || {});
        const tableCount = await dynamoService.testConnection(awsConfig.activeClients());
        awsConfig.setConnected(true);
        res.json({ success: true, config: result.config, role: result.role, tableCount });
    },
};
