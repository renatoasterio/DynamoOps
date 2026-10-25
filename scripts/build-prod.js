#!/usr/bin/env node
/**
 * Production build script:
 *   1. Bundles the frontend (ES modules → single bundle.js) via esbuild
 *   2. Runs electron-builder from the staging directory
 *   3. Moves dist to project root and cleans up
 *
 * Source files are NEVER modified.
 *
 * Usage:
 *   node scripts/build-prod.js --mac --arm64
 *   node scripts/build-prod.js --win --x64
 *   node scripts/build-prod.js --mac --universal
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const esbuild       = require('esbuild');

const ROOT    = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, '.build-staging');
const ARGS    = process.argv.slice(2).join(' ');

// ── Helpers ───────────────────────────────────────────────────────────────────
function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

function rmDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n📦  DynamoOps — Production Build\n');

// 1. Clean & create staging
console.log('1/4  Creating staging directory…');
rmDir(STAGING);
fs.mkdirSync(STAGING, { recursive: true });

// 2. Copy source files to staging
console.log('2/4  Copying source files…');
['server.js', 'electron-main.js', 'package.json'].forEach(f => {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STAGING, f));
});
copyDir(path.join(ROOT, 'src'),    path.join(STAGING, 'src'));
copyDir(path.join(ROOT, 'public'), path.join(STAGING, 'public'));
copyDir(path.join(ROOT, 'assets'), path.join(STAGING, 'assets'));

// Copy node_modules into staging. A symlink breaks electron-builder's
// transitive-dependency walk — it only ends up packaging the direct deps,
// leaving sub-packages like body-parser out of the asar (causes
// "Cannot find module 'body-parser'" on startup). APFS copy-on-write
// makes the real copy nearly free on macOS.
const nmSrc = path.join(ROOT, 'node_modules');
const nmDest = path.join(STAGING, 'node_modules');
if (fs.existsSync(nmSrc)) {
    // dereference:false keeps npm's internal .bin/ symlinks intact. Those
    // point at sibling packages (.bin/electron-builder → ../electron-builder/...)
    // and break if resolved to absolute paths in STAGING.
    fs.cpSync(nmSrc, nmDest, { recursive: true });
}

// 3. Bundle frontend ES modules into a single file
console.log('\n3/4  Bundling frontend JS…');
const publicJsDir   = path.join(STAGING, 'public', 'js');
const bundleOutFile = path.join(publicJsDir, 'bundle.js');

esbuild.buildSync({
    entryPoints: [path.join(publicJsDir, 'app.js')],
    bundle: true,
    outfile: bundleOutFile,
    format: 'iife',           // single self-executing bundle, no import/export
    platform: 'browser',
    minify: true,
    treeShaking: true,
    target: ['chrome108'],    // Electron 28+ uses Chrome 120, so this is safe
    logLevel: 'silent',
});
console.log('  ✔  bundle.js created');

// Replace app.js and all component files with stubs (bundle replaces them)
// app.js in HTML is replaced with bundle.js below; delete the old modules
rmDir(path.join(publicJsDir, 'components'));
rmDir(path.join(publicJsDir, 'utils'));
rmDir(path.join(publicJsDir, 'state'));
rmDir(path.join(publicJsDir, 'api'));
fs.unlinkSync(path.join(publicJsDir, 'app.js'));

// Update index.html to load bundle.js instead of app.js
const indexPath = path.join(STAGING, 'public', 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace(
    '<script type="module" src="js/app.js"></script>',
    '<script src="js/bundle.js"></script>'
);
fs.writeFileSync(indexPath, indexHtml, 'utf8');
console.log('  ✔  index.html updated to use bundle.js');

// 4. Run electron-builder from staging
console.log(`\n4/4  Running electron-builder ${ARGS}…\n`);
execSync(
    `npx electron-builder ${ARGS} --project "${STAGING}" --publish never`,
    { stdio: 'inherit', cwd: STAGING }
);

// Move dist to root & clean staging
const stagingDist = path.join(STAGING, 'dist');
const rootDist    = path.join(ROOT, 'dist');
if (fs.existsSync(stagingDist)) {
    rmDir(rootDist);
    fs.renameSync(stagingDist, rootDist);
}
rmDir(STAGING);

console.log('\n✅  Build complete. Output in dist/\n');
