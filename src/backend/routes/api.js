const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const connectionController = require('../controllers/connectionController');
const tableController      = require('../controllers/tableController');
const itemController       = require('../controllers/itemController');
const importController     = require('../controllers/importController');
const ssoController        = require('../controllers/ssoController');
const { requirePlan, requirePlanWhen } = require('../middleware/license');
const { isWriteStatement } = require('../utils/partiql');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Connection & Config ───────────────────────────────
router.get('/config', (req, res) => connectionController.getConfig(req, res));
router.post('/connect', (req, res) => connectionController.connect(req, res));
router.post('/disconnect', (req, res) => connectionController.disconnect(req, res));
router.post('/assume-role', (req, res) => connectionController.handleAssumeRole(req, res));

// ─── AWS IAM Identity Center (SSO) sign-in via browser ─
router.get('/sso/config',    (req, res) => ssoController.getConfig(req, res));
router.post('/sso/start',    (req, res) => ssoController.start(req, res));
router.post('/sso/poll',     (req, res) => ssoController.poll(req, res));
router.get('/sso/accounts',  (req, res) => ssoController.accounts(req, res));
router.get('/sso/roles',     (req, res) => ssoController.roles(req, res));
router.post('/sso/connect',  (req, res) => ssoController.connect(req, res));
router.post('/sso/signout',  (req, res) => ssoController.signOut(req, res));

// ─── Tables ───────────────────────────────────────────
router.get('/tables', (req, res) => tableController.list(req, res));
router.post('/tables', requirePlan('pro'), (req, res) => tableController.create(req, res));
router.get('/tables/:name', (req, res) => tableController.describe(req, res));
router.get('/tables/:name/dashboard', (req, res) => tableController.dashboard(req, res));
router.delete('/tables/:name', requirePlan('pro'), (req, res) => tableController.delete(req, res));
router.post('/tables/:name/truncate', requirePlan('pro'), (req, res) => tableController.truncate(req, res));
router.post('/tables/:name/gsi', requirePlan('pro_plus'), (req, res) => tableController.createGsi(req, res));
router.delete('/tables/:name/gsi/:gsiName', (req, res) => tableController.deleteGsi(req, res));
router.get('/tables/:name/stream', (req, res) => tableController.getStreamStatus(req, res));
router.get('/tables/:name/stream/records', requirePlan('pro'), (req, res) => tableController.getStreamRecords(req, res));

// ─── Queries & Scans ──────────────────────────────────
router.post('/tables/:name/scan', (req, res) => tableController.scan(req, res));
router.post('/tables/:name/query', (req, res) => tableController.query(req, res));
// PartiQL: SELECT is free; INSERT / UPDATE / DELETE modify data and need Pro (same as item CRUD)
router.post('/execute-statement', requirePlanWhen((req) => isWriteStatement(req.body && req.body.statement), 'pro'), (req, res) => tableController.executeStatement(req, res));

// ─── Items ────────────────────────────────────────────
router.put('/tables/:name/items', requirePlan('pro'), (req, res) => itemController.put(req, res));
router.patch('/tables/:name/items', requirePlan('pro'), (req, res) => itemController.updateAttribute(req, res));
router.delete('/tables/:name/items', requirePlan('pro'), (req, res) => itemController.delete(req, res));
router.post('/tables/:name/batch-write', requirePlan('pro'), (req, res) => itemController.batchWrite(req, res));

// ─── Import ───────────────────────────────────────────
router.post('/import/parse-excel', requirePlan('pro'), upload.single('file'), (req, res) => importController.parseExcel(req, res));

module.exports = router;
