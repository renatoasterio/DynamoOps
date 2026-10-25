const dynamoService = require('../services/dynamoService');

class ItemController {
    async put(req, res) {
        try {
            const { item } = req.body;
            const result = await dynamoService.putItem(req.clients, req.params.name, item);
            res.json({ success: true, consumedCapacity: result.consumedCapacity });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async delete(req, res) {
        try {
            const { key } = req.body;
            const result = await dynamoService.deleteItem(req.clients, req.params.name, key);
            res.json({ success: true, consumedCapacity: result.consumedCapacity });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async updateAttribute(req, res) {
        try {
            const { key, attributeName, newValue } = req.body;
            if (!key || !attributeName) {
                return res.status(400).json({ error: 'key and attributeName are required' });
            }
            const result = await dynamoService.updateAttribute(req.clients, req.params.name, key, attributeName, newValue);
            res.json({ success: true, consumedCapacity: result.consumedCapacity });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async batchDelete(req, res) {
        try {
            const { keys } = req.body;
            if (!Array.isArray(keys) || keys.length === 0) {
                return res.status(400).json({ error: 'Keys array is required and must not be empty' });
            }

            const result = await dynamoService.batchDelete(req.clients, req.params.name, keys);

            res.json({
                success: true,
                deletedCount: result.deletedCount,
                unprocessedKeysCount: result.unprocessedKeys.length,
                unprocessedKeys: result.unprocessedKeys.slice(0, 10),
                consumedCapacity: result.consumedCapacity,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async batchWrite(req, res) {
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Items array is required and must not be empty' });
            }

            const result = await dynamoService.batchWrite(req.clients, req.params.name, items);

            res.json({
                success: true,
                processedCount: result.processedCount,
                unprocessedItemsCount: result.unprocessedItems.length,
                unprocessedItems: result.unprocessedItems.slice(0, 10),
                consumedCapacity: result.consumedCapacity,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new ItemController();
