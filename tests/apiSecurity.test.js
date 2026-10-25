'use strict';

const http = require('http');
const app = require('../src/backend/app');
const { HOST } = require('../src/backend/config/server');

let server;
let port;

beforeAll(() => new Promise((resolve) => {
    server = app.listen(0, HOST, () => {
        port = server.address().port;
        resolve();
    });
}));

afterAll(() => new Promise((resolve) => server.close(resolve)));

// Raw http.request so Host / Origin headers can be forged (fetch forbids it)
function request(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: HOST, port, path, method,
            headers: { host: `localhost:${port}`, ...headers },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch { /* not JSON */ }
                resolve({ status: res.statusCode, headers: res.headers, json });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

describe('API security', () => {
    test('listens only on the loopback interface', () => {
        expect(server.address().address).toBe('127.0.0.1');
    });

    test('accepts same-origin requests from the app', async () => {
        const res = await request('/api/config', { headers: { origin: `http://localhost:${port}` } });
        expect(res.status).toBe(200);
        expect(res.json).toHaveProperty('region');
    });

    test('rejects a foreign Host header (DNS rebinding)', async () => {
        const res = await request('/api/config', { headers: { host: 'evil.example:80' } });
        expect(res.status).toBe(403);
    });

    test('rejects cross-site requests (CSRF from another website)', async () => {
        const res = await request('/api/disconnect', {
            method: 'POST',
            headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
            body: '{}',
        });
        expect(res.status).toBe(403);
    });

    test('does not send permissive CORS headers', async () => {
        const res = await request('/api/config', { headers: { origin: 'https://evil.example' } });
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('sends a Content-Security-Policy and hardening headers', async () => {
        const res = await request('/');
        expect(res.headers['content-security-policy']).toContain("script-src 'self'");
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    test('rejects invalid table names before reaching AWS', async () => {
        const res = await request('/api/tables/bad%20name!');
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/Invalid name/);
    });

    test('validates request bodies', async () => {
        const res = await request('/api/tables/valid-table/batch-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ keys: [] }),
        });
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/keys/);
    });

    test('unknown API routes return a JSON 404', async () => {
        const res = await request('/api/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.json.success).toBe(false);
    });

    test('malformed JSON returns 400, not 500', async () => {
        const res = await request('/api/connect', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{not json',
        });
        expect(res.status).toBe(400);
    });
});
