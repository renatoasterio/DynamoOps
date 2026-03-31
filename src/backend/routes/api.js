const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const connectionController = require('../controllers/connectionController');
const tableController      = require('../controllers/tableController');
const itemController       = require('../controllers/itemController');
const importController     = require('../controllers/importController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Connection & Config ───────────────────────────────
router.get('/config', (req, res) => connectionController.getConfig(req, res));
router.post('/connect', (req, res) => connectionController.connect(req, res));
router.post('/disconnect', (req, res) => connectionController.disconnect(req, res));
router.post('/assume-role', (req, res) => connectionController.handleAssumeRole(req, res));

// ─── Tables ───────────────────────────────────────────
router.get('/tables', (req, res) => tableController.list(req, res));
router.post('/tables', (req, res) => tableController.create(req, res));
router.get('/tables/:name', (req, res) => tableController.describe(req, res));
router.get('/tables/:name/dashboard', (req, res) => tableController.dashboard(req, res));
router.delete('/tables/:name', (req, res) => tableController.delete(req, res));
router.post('/tables/:name/truncate', (req, res) => tableController.truncate(req, res));
router.post('/tables/:name/gsi', (req, res) => tableController.createGsi(req, res));
router.delete('/tables/:name/gsi/:gsiName', (req, res) => tableController.deleteGsi(req, res));
router.get('/tables/:name/stream', (req, res) => tableController.getStreamStatus(req, res));
router.get('/tables/:name/stream/records', (req, res) => tableController.getStreamRecords(req, res));

// ─── Queries & Scans ──────────────────────────────────
router.post('/tables/:name/scan', (req, res) => tableController.scan(req, res));
router.post('/tables/:name/query', (req, res) => tableController.query(req, res));
router.post('/execute-statement', (req, res) => tableController.executeStatement(req, res));

// ─── Items ────────────────────────────────────────────
router.put('/tables/:name/items', (req, res) => itemController.put(req, res));
router.patch('/tables/:name/items', (req, res) => itemController.updateAttribute(req, res));
router.delete('/tables/:name/items', (req, res) => itemController.delete(req, res));
router.post('/tables/:name/batch-write', (req, res) => itemController.batchWrite(req, res));

// ─── Import ───────────────────────────────────────────
router.post('/import/parse-excel', upload.single('file'), (req, res) => importController.parseExcel(req, res));

module.exports = router;
