'use strict';

/**
 * The local API performs DynamoDB operations with the user's AWS credentials.
 * Binding to 127.0.0.1 keeps other machines out; these checks keep other
 * *websites* out — a page open in the user's browser can still send requests
 * to http://127.0.0.1:<port>:
 *
 *  - Host check  → blocks DNS-rebinding (evil.com resolving to 127.0.0.1
 *                  sends `Host: evil.com`).
 *  - Origin check → blocks cross-site requests (CSRF); browsers always send
 *                  Origin on cross-origin POST/PUT/PATCH/DELETE and fetches.
 */

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

function allowedHosts(port) {
    return new Set(LOCAL_HOSTNAMES.map((h) => `${h}:${port}`));
}

function localOnly(req, res, next) {
    const hosts = allowedHosts(req.socket.localPort);

    if (!hosts.has(String(req.headers.host || '').toLowerCase())) {
        return res.status(403).json({ error: 'Forbidden host' });
    }

    const origin = req.headers.origin;
    if (origin && !hosts.has(origin.toLowerCase().replace(/^http:\/\//, ''))) {
        return res.status(403).json({ error: 'Forbidden origin' });
    }

    next();
}

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    // Inline style attributes are used throughout the rendered UI
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

function securityHeaders(_req, res, next) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
}

module.exports = { localOnly, securityHeaders, CONTENT_SECURITY_POLICY };
