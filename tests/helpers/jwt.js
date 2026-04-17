'use strict';

// Uses the same jose mock that Jest resolves for licenseService.js
const { SignJWT, exportSPKI, generateKeyPair } = require('jose');

let _keyPair = null;

async function getTestKeyPair() {
    if (_keyPair) return _keyPair;
    _keyPair = await generateKeyPair('ES256');
    return _keyPair;
}

async function getTestPublicKeyPEM() {
    const { publicKey } = await getTestKeyPair();
    return exportSPKI(publicKey);
}

async function signTestJWT(payload, { expiresIn = '7d' } = {}) {
    const { privateKey } = await getTestKeyPair();
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey);
}

async function signExpiredJWT(payload, { expiredAgo = '1h' } = {}) {
    const { privateKey } = await getTestKeyPair();
    const msAgo = parseDuration(expiredAgo);
    const iat = Math.floor((Date.now() - msAgo - 60000) / 1000);
    const exp = Math.floor((Date.now() - msAgo) / 1000);

    return new SignJWT({ ...payload, iat, exp })
        .setProtectedHeader({ alg: 'ES256' })
        .sign(privateKey);
}

function parseDuration(str) {
    const match = str.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) return 0;
    const n = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return n * (multipliers[unit] || 0);
}

module.exports = { getTestKeyPair, getTestPublicKeyPEM, signTestJWT, signExpiredJWT };
