const awsConfig = require('../config/aws');
const { assumeRole } = require('../services/stsService');
const dynamoService = require('../services/dynamoService');

class ConnectionController {
    getConfig(req, res) {
        res.json({
            ...awsConfig.currentConfig,
            assumedRole: awsConfig.assumedRoleInfo,
            connected: awsConfig.isConnected,
        });
    }

    async connect(req, res) {
        try {
            const { region, profile, endpoint } = req.body;
            const newConfig = {
                region: region || 'us-east-1',
                profile: profile || 'default',
                endpoint: endpoint || '',
            };
            
            // Still update global config for legacy reasons/initial state
            awsConfig.setCurrentConfig(newConfig);
            awsConfig.createClients(newConfig);

            // Get clients for THIS specific config to test it
            const clients = awsConfig.getCachedClients(newConfig);
            const tableCount = await dynamoService.testConnection(clients);
            awsConfig.setConnected(true);

            res.json({ success: true, config: newConfig, tableCount });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }

    disconnect(req, res) {
        awsConfig.setAssumedRoleInfo(null);
        awsConfig.setConnected(false);
        res.json({ success: true });
    }

    async handleAssumeRole(req, res) {
        try {
            const result = await assumeRole(req.body);
            const tableCount = await dynamoService.testConnection({
                dynamoClient: awsConfig.dynamoClient,
                docClient: awsConfig.docClient,
            });
            awsConfig.setConnected(true);

            res.json({
                success: true,
                config: result.config,
                role: result.role,
                tableCount
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
}

module.exports = new ConnectionController();
