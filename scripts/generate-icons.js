#!/usr/bin/env node
/**
 * Generates app icons for macOS (.icns) and Windows (.ico)
 * from assets/icons/icon.svg using only built-in macOS tools.
 *
 * Requirements: macOS (uses sips + iconutil)
 * Usage: node scripts/generate-icons.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SVG  = path.join(ROOT, 'assets', 'icons', 'icon.svg');
const OUT  = path.join(ROOT, 'assets', 'icons');

// ─── helpers ────────────────────────────────────────────────────────────────

function run(cmd) {
    execSync(cmd, { stdio: 'inherit' });
}

function log(msg) { console.log(`\x1b[36m[icons]\x1b[0m ${msg}`); }

// Resize the master SVG to a square PNG at a given size using sips
function makePng(size, dest) {
    // sips can read SVG on macOS 12+; resample after conversion
    const tmp = path.join(OUT, `_tmp_${size}.png`);
    run(`sips -s format png "${SVG}" --out "${tmp}" --resampleHeightWidth ${size} ${size} 2>/dev/null`);
    if (dest !== tmp) fs.renameSync(tmp, dest);
    return dest;
}

// ─── macOS .icns ────────────────────────────────────────────────────────────

function buildIcns() {
    const iconset = path.join(OUT, 'AppIcon.iconset');
    fs.mkdirSync(iconset, { recursive: true });

    // Required iconset sizes (name → px)
    const sizes = [
        ['icon_16x16',       16],
        ['icon_16x16@2x',    32],
        ['icon_32x32',       32],
        ['icon_32x32@2x',    64],
        ['icon_128x128',     128],
        ['icon_128x128@2x',  256],
        ['icon_256x256',     256],
        ['icon_256x256@2x',  512],
        ['icon_512x512',     512],
        ['icon_512x512@2x',  1024],
    ];

    for (const [name, px] of sizes) {
        log(`  PNG ${px}×${px} → ${name}.png`);
        makePng(px, path.join(iconset, `${name}.png`));
    }

    const icns = path.join(OUT, 'icon.icns');
    run(`iconutil -c icns "${iconset}" -o "${icns}"`);
    log(`✓ icon.icns created`);

    // Clean up iconset folder
    fs.rmSync(iconset, { recursive: true, force: true });
}

// ─── Windows .ico (pure Node.js, no deps) ────────────────────────────────────
// Reads PNG files and builds a valid .ico with multiple sizes embedded.

function buildIco() {
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const pngs = [];

    for (const size of icoSizes) {
        const tmp = path.join(OUT, `_ico_${size}.png`);
        log(`  PNG ${size}×${size} for ICO`);
        makePng(size, tmp);
        pngs.push({ size, file: tmp });
    }

    // .ico file format:
    //   6  bytes  header (type=1, count=N)
    //   16 bytes  per image directory entry
    //   N × PNG   raw PNG data appended
    const count   = pngs.length;
    const dirSize = 6 + count * 16;

    // Calculate offsets
    let offset = dirSize;
    const entries = pngs.map(({ size, file }) => {
        const data   = fs.readFileSync(file);
        const entry  = { size, data, offset };
        offset      += data.length;
        return entry;
    });

    // Build header
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0,     0); // reserved
    header.writeUInt16LE(1,     2); // type = icon
    header.writeUInt16LE(count, 4); // image count

    // Build directory entries
    const dirs = entries.map(({ size, data, offset }) => {
        const dir = Buffer.alloc(16);
        dir.writeUInt8(size === 256 ? 0 : size, 0); // width  (0 = 256)
        dir.writeUInt8(size === 256 ? 0 : size, 1); // height (0 = 256)
        dir.writeUInt8(0,             2); // color count
        dir.writeUInt8(0,             3); // reserved
        dir.writeUInt16LE(1,          4); // planes
        dir.writeUInt16LE(32,         6); // bit count
        dir.writeUInt32LE(data.length, 8); // size of image data
        dir.writeUInt32LE(offset,     12); // offset of image data
        return dir;
    });

    const icoPath = path.join(OUT, 'icon.ico');
    const fd = fs.openSync(icoPath, 'w');
    fs.writeSync(fd, header);
    dirs.forEach(d => fs.writeSync(fd, d));
    entries.forEach(({ data }) => fs.writeSync(fd, data));
    fs.closeSync(fd);

    // Clean up temp PNGs
    entries.forEach(({ size }) => {
        const tmp = path.join(OUT, `_ico_${size}.png`);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    });

    log(`✓ icon.ico created`);
}

// ─── master 1024px PNG (used by electron-builder as fallback) ───────────────

function buildMasterPng() {
    makePng(1024, path.join(OUT, 'icon.png'));
    log(`✓ icon.png (1024×1024) created`);
}

// ─── main ────────────────────────────────────────────────────────────────────

log('Generating icons from icon.svg …');
buildMasterPng();
buildIcns();
buildIco();
log('\nDone! Files written to assets/icons/');
log('  icon.png   — master PNG 1024×1024');
log('  icon.icns  — macOS');
log('  icon.ico   — Windows');
