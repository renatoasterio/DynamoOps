const express = require('express');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./routes/api');
const connectionMiddleware = require('./middleware/connection');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Use connection middleware for all API routes
app.use('/api', connectionMiddleware, apiRoutes);

// Expose xlsx UMD build to frontend
app.use('/vendor/xlsx', express.static(path.join(__dirname, '..', '..', 'node_modules', 'xlsx', 'dist')));

// Static files
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// SPA Fallback
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

module.exports = app;
