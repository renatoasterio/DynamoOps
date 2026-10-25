const express = require('express');
const multer  = require('multer');

const connectionController = require('../controllers/connectionController');
const tableController      = require('../controllers/tableController');
const itemController       = require('../controllers/itemController');
const importController     = require('../controllers/importController');
const ssoController        = require('../controllers/ssoController');
const { asyncHandler }       = require('../middleware/errors');
const { resourceNameParam }  = require('../middleware/validate');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

// Every handler goes through asyncHandler → errors reach the central error handler
const h = asyncHandler;

// Table / index names are validated once for every route that has them
router.param('name', resourceNameParam);
router.param('gsiName', resourceNameParam);

// ─── Connection & Config ───────────────────────────────
router.get('/config', h(connectionController.getConfig));
router.post('/connect', h(connectionController.connect));
router.post('/disconnect', h(connectionController.disconnect));
router.post('/assume-role', h(connectionController.handleAssumeRole));

// ─── AWS IAM Identity Center (SSO) sign-in via browser ─
router.get('/sso/config',    h(ssoController.getConfig));
router.post('/sso/start',    h(ssoController.start));
router.post('/sso/poll',     h(ssoController.poll));
router.get('/sso/accounts',  h(ssoController.accounts));
router.get('/sso/roles',     h(ssoController.roles));
router.post('/sso/connect',  h(ssoController.connect));
router.post('/sso/signout',  h(ssoController.signOut));

// ─── Tables ───────────────────────────────────────────
router.get('/tables', h(tableController.list));
router.post('/tables', h(tableController.create));
router.get('/tables/:name', h(tableController.describe));
router.get('/tables/:name/dashboard', h(tableController.dashboard));
router.delete('/tables/:name', h(tableController.delete));
router.post('/tables/:name/truncate', h(tableController.truncate));
router.post('/tables/:name/gsi', h(tableController.createGsi));
router.delete('/tables/:name/gsi/:gsiName', h(tableController.deleteGsi));
router.get('/tables/:name/stream', h(tableController.getStreamStatus));
router.get('/tables/:name/stream/records', h(tableController.getStreamRecords));

// ─── Queries & Scans ──────────────────────────────────
router.post('/tables/:name/scan', h(tableController.scan));
router.post('/tables/:name/query', h(tableController.query));
router.post('/execute-statement', h(tableController.executeStatement));

// ─── Items ────────────────────────────────────────────
router.put('/tables/:name/items', h(itemController.put));
router.patch('/tables/:name/items', h(itemController.updateAttribute));
router.delete('/tables/:name/items', h(itemController.delete));
router.post('/tables/:name/batch-write', h(itemController.batchWrite));
router.post('/tables/:name/batch-delete', h(itemController.batchDelete));

// ─── Import ───────────────────────────────────────────
router.post('/import/parse-excel', upload.single('file'), h(importController.parseExcel));

module.exports = router;
