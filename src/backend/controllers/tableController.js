const dynamoService  = require('../services/dynamoService');
const streamsService = require('../services/streamsService');
const { requireString } = require('../middleware/validate');

// Handlers are wrapped with asyncHandler in routes/api.js: errors propagate
// to the central error handler, so no try/catch here.

module.exports = {
    async list(req, res) {
        res.json({ tables: await dynamoService.listTables(req.clients) });
    },

    async describe(req, res) {
        res.json({ table: await dynamoService.describeTable(req.clients, req.params.name) });
    },

    async dashboard(req, res) {
        res.json(await dynamoService.getTableDashboard(req.clients, req.params.name));
    },

    async create(req, res) {
        const table = await dynamoService.createTable(req.clients, req.body || {});
        res.json({ success: true, table });
    },

    async delete(req, res) {
        await dynamoService.deleteTable(req.clients, req.params.name);
        res.json({ success: true, message: 'Table deleted successfully' });
    },

    async truncate(req, res) {
        const deletedCount = await dynamoService.truncateTable(req.clients, req.params.name);
        res.json({ success: true, deletedCount, message: `Successfully deleted ${deletedCount} items.` });
    },

    async createGsi(req, res) {
        const table = await dynamoService.createGsi(req.clients, req.params.name, req.body || {});
        res.json({ success: true, table });
    },

    async deleteGsi(req, res) {
        const table = await dynamoService.deleteGsi(req.clients, req.params.name, req.params.gsiName);
        res.json({ success: true, table });
    },

    async scan(req, res) {
        res.json(await dynamoService.scan(req.clients, req.params.name, req.body || {}));
    },

    async query(req, res) {
        res.json(await dynamoService.query(req.clients, req.params.name, req.body || {}));
    },

    async executeStatement(req, res) {
        const { statement, nextToken } = req.body || {};
        requireString(statement, 'statement');
        res.json(await dynamoService.executeStatement(req.clients, statement, nextToken));
    },

    async getStreamStatus(req, res) {
        res.json(await streamsService.getStreamStatus(req.clients, req.params.name));
    },

    async getStreamRecords(req, res) {
        const streamArn = requireString(req.query.streamArn, 'streamArn');
        res.json({ records: await streamsService.getRecentRecords(req.clients, streamArn) });
    },
};
