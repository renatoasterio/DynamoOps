const dynamoService  = require('../services/dynamoService');
const streamsService = require('../services/streamsService');

class TableController {
    async list(req, res) {
        try {
            const tables = await dynamoService.listTables(req.clients);
            res.json({ tables });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async describe(req, res) {
        try {
            const table = await dynamoService.describeTable(req.clients, req.params.name);
            res.json({ table });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async dashboard(req, res) {
        try {
            const data = await dynamoService.getTableDashboard(req.clients, req.params.name);
            res.json(data);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async create(req, res) {
        try {
            const tableDescription = await dynamoService.createTable(req.clients, req.body);
            res.json({ success: true, table: tableDescription });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async delete(req, res) {
        try {
            await dynamoService.deleteTable(req.clients, req.params.name);
            res.json({ success: true, message: 'Table deleted successfully' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async scan(req, res) {
        try {
            const result = await dynamoService.scan(req.clients, req.params.name, req.body);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async query(req, res) {
        try {
            const result = await dynamoService.query(req.clients, req.params.name, req.body);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async executeStatement(req, res) {
        try {
            const { statement, nextToken } = req.body;
            if (!statement) return res.status(400).json({ error: 'Statement is required' });

            const result = await dynamoService.executeStatement(req.clients, statement, nextToken);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async truncate(req, res) {
        try {
            const deletedCount = await dynamoService.truncateTable(req.clients, req.params.name);
            res.json({ success: true, deletedCount, message: `Successfully deleted ${deletedCount} items.` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async createGsi(req, res) {
        try {
            const tableDescription = await dynamoService.createGsi(req.clients, req.params.name, req.body);
            res.json({ success: true, table: tableDescription });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async deleteGsi(req, res) {
        try {
            const tableDescription = await dynamoService.deleteGsi(req.clients, req.params.name, req.params.gsiName);
            res.json({ success: true, table: tableDescription });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getStreamStatus(req, res) {
        try {
            const status = await streamsService.getStreamStatus(req.clients, req.params.name);
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getStreamRecords(req, res) {
        try {
            const { streamArn } = req.query;
            if (!streamArn) return res.status(400).json({ error: 'streamArn query param required' });
            const records = await streamsService.getRecentRecords(req.clients, streamArn);
            res.json({ records });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new TableController();
