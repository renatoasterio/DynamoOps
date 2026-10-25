#!/usr/bin/env node
/**
 * Production build script:
 *   1. Bundles the frontend (ES modules → single bundle.js) via esbuild
 *   2. Obfuscates all JS (frontend bundle + backend) via javascript-obfuscator
 *   3. Runs electron-builder from the staging directory
 *   4. Moves dist to project root and cleans up
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
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT    = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, '.build-staging');
const ARGS    = process.argv.slice(2).join(' ');

// ── Obfuscator options ────────────────────────────────────────────────────────
const OBFUSCATE_OPTS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    unicodeEscapeSequence: false,
};

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

function obfuscateFile(filePath, target = 'node') {
    const src = fs.readFileSync(filePath, 'utf8');
    try {
        const result = JavaScriptObfuscator.obfuscate(src, { ...OBFUSCATE_OPTS, target });
        fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
        console.log(`  ✔  ${path.relative(STAGING, filePath)}`);
    } catch (err) {
        console.warn(`  ✗  ${path.relative(STAGING, filePath)} — skipped (${err.message})`);
    }
}

function walkAndObfuscate(dir, target = 'node') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkAndObfuscate(full, target);
        else if (entry.name.endsWith('.js')) obfuscateFile(full, target);
    }
}

function rmDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n📦  DynamoOps — Production Build\n');

// 1. Clean & create staging
console.log('1/5  Creating staging directory…');
rmDir(STAGING);
fs.mkdirSync(STAGING, { recursive: true });

// 2. Copy source files to staging
console.log('2/5  Copying source files…');
['server.js', 'electron-main.js', 'preload.js', 'package.json', '.env.production'].forEach(f => {
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
console.log('\n3/5  Bundling frontend JS…');
const publicJsDir   = path.join(STAGING, 'public', 'js');
const bundleOutFile = path.join(publicJsDir, 'bundle.js');

esbuild.buildSync({
    entryPoints: [path.join(publicJsDir, 'app.js')],
    bundle: true,
    outfile: bundleOutFile,
    format: 'iife',           // single self-executing bundle, no import/export
    platform: 'browser',
    minify: true,             // minify before obfuscation
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

// 4. Obfuscate JS
console.log('\n4/5  Obfuscating JavaScript…\n');
// Backend (Node.js target)
obfuscateFile(path.join(STAGING, 'server.js'), 'node');
obfuscateFile(path.join(STAGING, 'electron-main.js'), 'node');
walkAndObfuscate(path.join(STAGING, 'src'), 'node');
// Frontend bundle (browser target, no eval)
obfuscateFile(bundleOutFile, 'browser-no-eval');

// 5. Run electron-builder from staging
console.log(`\n5/5  Running electron-builder ${ARGS}…\n`);
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
