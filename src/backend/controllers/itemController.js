const dynamoService = require('../services/dynamoService');
const { requireObject, requireString, requireArray } = require('../middleware/validate');

// How many unprocessed entries are echoed back to the UI for diagnostics
const UNPROCESSED_SAMPLE = 10;

module.exports = {
    async put(req, res) {
        const item = requireObject(req.body?.item, 'item');
        const result = await dynamoService.putItem(req.clients, req.params.name, item);
        res.json({ success: true, consumedCapacity: result.consumedCapacity });
    },

    async delete(req, res) {
        const key = requireObject(req.body?.key, 'key');
        const result = await dynamoService.deleteItem(req.clients, req.params.name, key);
        res.json({ success: true, consumedCapacity: result.consumedCapacity });
    },

    async updateAttribute(req, res) {
        const { key, attributeName, newValue } = req.body || {};
        requireObject(key, 'key');
        requireString(attributeName, 'attributeName');
        const result = await dynamoService.updateAttribute(req.clients, req.params.name, key, attributeName, newValue);
        res.json({ success: true, consumedCapacity: result.consumedCapacity });
    },

    async batchWrite(req, res) {
        const items = requireArray(req.body?.items, 'items', { of: requireObject });
        const result = await dynamoService.batchWrite(req.clients, req.params.name, items);
        res.json({
            success: true,
            processedCount: result.processedCount,
            unprocessedItemsCount: result.unprocessed.length,
            unprocessedItems: result.unprocessed.slice(0, UNPROCESSED_SAMPLE),
            consumedCapacity: result.consumedCapacity,
        });
    },

    async batchDelete(req, res) {
        const keys = requireArray(req.body?.keys, 'keys', { of: requireObject });
        const result = await dynamoService.batchDelete(req.clients, req.params.name, keys);
        res.json({
            success: true,
            deletedCount: result.processedCount,
            unprocessedKeysCount: result.unprocessed.length,
            unprocessedKeys: result.unprocessed.slice(0, UNPROCESSED_SAMPLE),
            consumedCapacity: result.consumedCapacity,
        });
    },
};
