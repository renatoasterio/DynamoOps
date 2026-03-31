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
