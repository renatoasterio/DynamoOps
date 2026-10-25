'use strict';

const crypto = require('crypto');

// ─── Key import/export ───────────────────────────────────────────────────────

async function importSPKI(pem, alg) {
    return crypto.createPublicKey({ key: pem, format: 'pem', type: 'spki' });
}

async function exportSPKI(key) {
    return key.export({ type: 'spki', format: 'pem' });
}

// ─── Key generation ──────────────────────────────────────────────────────────

async function generateKeyPair(alg) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
    });
    return { publicKey, privateKey };
}

// ─── JWT verify ──────────────────────────────────────────────────────────────

async function jwtVerify(token, key, options = {}) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');

    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];

    // Verify signature
    const verifier = crypto.createVerify('SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const sigBuf = Buffer.from(signatureB64, 'base64url');

    // Convert raw R||S signature (64 bytes) to DER format for Node's verify
    const derSig = rawToDer(sigBuf);
    const valid = verifier.verify(key, derSig);
    if (!valid) throw new Error('signature verification failed');

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return { payload, protectedHeader: JSON.parse(Buffer.from(headerB64, 'base64url').toString()) };
}

function rawToDer(raw) {
    // P-256 signature: 32 bytes R + 32 bytes S
    const r = raw.subarray(0, 32);
    const s = raw.subarray(32, 64);

    function encodeInt(buf) {
        // Trim leading zeros, but add 0x00 if high bit is set
        let i = 0;
        while (i < buf.length - 1 && buf[i] === 0) i++;
        const trimmed = buf.subarray(i);
        const needPad = trimmed[0] & 0x80;
        const result = Buffer.alloc(trimmed.length + (needPad ? 1 : 0));
        if (needPad) result[0] = 0;
        trimmed.copy(result, needPad ? 1 : 0);
        return result;
    }

    const rEnc = encodeInt(r);
    const sEnc = encodeInt(s);
    const seqLen = 2 + rEnc.length + 2 + sEnc.length;

    const der = Buffer.alloc(2 + seqLen);
    let offset = 0;
    der[offset++] = 0x30; // SEQUENCE
    der[offset++] = seqLen;
    der[offset++] = 0x02; // INTEGER
    der[offset++] = rEnc.length;
    rEnc.copy(der, offset); offset += rEnc.length;
    der[offset++] = 0x02; // INTEGER
    der[offset++] = sEnc.length;
    sEnc.copy(der, offset);
    return der;
}

// ─── JWT sign ────────────────────────────────────────────────────────────────

class SignJWT {
    constructor(payload) {
        this._payload = { ...payload };
        this._header = {};
    }

    setProtectedHeader(header) {
        this._header = header;
        return this;
    }

    setIssuedAt() {
        if (!this._payload.iat) {
            this._payload.iat = Math.floor(Date.now() / 1000);
        }
        return this;
    }

    setExpirationTime(exp) {
        if (typeof exp === 'string') {
            const match = exp.match(/^(\d+)(s|m|h|d)$/);
            if (match) {
                const n = parseInt(match[1]);
                const mult = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
                this._payload.exp = Math.floor(Date.now() / 1000) + n * mult;
            }
        } else {
            this._payload.exp = exp;
        }
        return this;
    }

    async sign(privateKey) {
        const headerB64 = Buffer.from(JSON.stringify(this._header)).toString('base64url');
        const payloadB64 = Buffer.from(JSON.stringify(this._payload)).toString('base64url');
        const data = `${headerB64}.${payloadB64}`;

        const signer = crypto.createSign('SHA256');
        signer.update(data);
        const derSig = signer.sign(privateKey);

        // Convert DER signature to raw R||S format (64 bytes for P-256)
        const rawSig = derToRaw(derSig);
        const sigB64 = rawSig.toString('base64url');

        return `${data}.${sigB64}`;
    }
}

function derToRaw(der) {
    let offset = 2; // skip SEQUENCE tag + length
    // R
    offset++; // skip INTEGER tag
    const rLen = der[offset++];
    const rStart = der[offset] === 0 ? offset + 1 : offset;
    const rBytes = der.subarray(rStart, offset + rLen);
    offset += rLen;
    // S
    offset++; // skip INTEGER tag
    const sLen = der[offset++];
    const sStart = der[offset] === 0 ? offset + 1 : offset;
    const sBytes = der.subarray(sStart, offset + sLen);

    const raw = Buffer.alloc(64);
    rBytes.copy(raw, 32 - rBytes.length);
    sBytes.copy(raw, 64 - sBytes.length);
    return raw;
}

module.exports = {
    importSPKI,
    exportSPKI,
    generateKeyPair,
    jwtVerify,
    SignJWT,
};
