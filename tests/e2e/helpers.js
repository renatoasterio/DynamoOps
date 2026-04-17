'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { _electron: electron } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Launches Electron pointing at the mock server with the given test-scoped env.
 * Returns { app, window, userDataDir, machineId } and a cleanup fn.
 */
async function launchApp({ mockPort, machineIdRaw, publicKeyPem }) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamoops-e2e-'));
    const machineId = crypto.createHash('sha256').update(machineIdRaw).digest('hex');

    const app = await electron.launch({
        args: [path.join(ROOT, 'electron-main.js')],
        cwd: ROOT,
        env: {
            ...process.env,
            LICENSE_SERVER_URL: `http://127.0.0.1:${mockPort}`,
            DYNAMO_LICENSE_PUBLIC_KEY: publicKeyPem,
            DYNAMO_TEST_MACHINE_ID: machineIdRaw,
            DYNAMO_TEST_USER_DATA_DIR: userDataDir,
            NODE_ENV: 'test',
        },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // Wait for LicenseManager to finish init and render the badge
    await window.waitForSelector('#license-plan-badge', { timeout: 15_000 });

    return {
        app,
        window,
        machineId,
        userDataDir,
        async close() {
            try { await app.close(); } catch { /* ignore */ }
            try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        },
    };
}

/**
 * Polls the mock server for the most recent email sent to a given address.
 * Returns the email once it shows up, or throws after 5 seconds.
 */
async function waitForEmail(mockPort, to, { timeoutMs = 5_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const res = await fetch(`http://127.0.0.1:${mockPort}/test/emails`);
        const emails = await res.json();
        const match = emails.filter((e) => e.to === to).pop();
        if (match) return match;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`No email to ${to} within ${timeoutMs}ms`);
}

async function seedLicense(mockPort, license) {
    const res = await fetch(`http://127.0.0.1:${mockPort}/test/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(license),
    });
    return res.json();
}

async function resetMock(mockPort) {
    await fetch(`http://127.0.0.1:${mockPort}/test/reset`, { method: 'POST' });
}

async function getServerState(mockPort) {
    const res = await fetch(`http://127.0.0.1:${mockPort}/test/state`);
    return res.json();
}

module.exports = {
    launchApp,
    waitForEmail,
    seedLicense,
    resetMock,
    getServerState,
};
