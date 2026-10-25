const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');
const connectionMiddleware = require('./middleware/connection');
const { localOnly, securityHeaders } = require('./middleware/security');
const { HttpError, errorHandler } = require('./middleware/errors');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(localOnly);
app.use(express.json({ limit: '50mb' }));

app.use('/api', connectionMiddleware, apiRoutes);
app.use('/api', (req, _res, next) => next(new HttpError(404, `Unknown API route: ${req.method} ${req.path}`)));

// Static files
app.use(express.static(PUBLIC_DIR));

// SPA Fallback
app.get('*', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(errorHandler);

module.exports = app;
