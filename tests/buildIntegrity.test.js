'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

describe('Build integrity', () => {
    // ── Critical files exist ─────────────────────────────────────────────────

    describe('required files exist', () => {
        const required = [
            'electron-main.js',
            'preload.js',
            'server.js',
            'package.json',
            '.env.production',
            'public/index.html',
            'public/styles.css',
            'public/js/app.js',
            'public/js/components/LicenseManager.js',
            'src/backend/services/licenseService.js',
            'src/backend/middleware/license.js',
            'src/backend/controllers/connectionController.js',
            'src/backend/config/aws.js',
            'scripts/build-prod.js',
        ];

        for (const file of required) {
            test(`${file} exists`, () => {
                expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
            });
        }
    });

    // ── Build script copies all critical files ───────────────────────────────

    describe('build-prod.js configuration', () => {
        const buildScript = fs.readFileSync(path.join(ROOT, 'scripts/build-prod.js'), 'utf8');

        test('copies preload.js to staging', () => {
            expect(buildScript).toContain("'preload.js'");
        });

        test('copies .env.production to staging', () => {
            expect(buildScript).toContain("'.env.production'");
        });

        test('copies electron-main.js to staging', () => {
            expect(buildScript).toContain("'electron-main.js'");
        });

        test('disableConsoleOutput is true', () => {
            expect(buildScript).toContain('disableConsoleOutput: true');
        });
    });

    // ── package.json electron-builder files array ────────────────────────────

    describe('package.json build config', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const files = pkg.build?.files || [];

        test('includes preload.js', () => {
            expect(files).toContain('preload.js');
        });

        test('includes .env.production', () => {
            expect(files).toContain('.env.production');
        });

        test('includes server.js', () => {
            expect(files).toContain('server.js');
        });

        test('includes electron-main.js', () => {
            expect(files).toContain('electron-main.js');
        });

        test('has productName DynamoOps', () => {
            expect(pkg.build.productName).toBe('DynamoOps');
        });
    });

    // ── electron-main.js loads env file ──────────────────────────────────────

    describe('electron-main.js', () => {
        const mainJs = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');

        test('loads .env.production in prod', () => {
            expect(mainJs).toContain(".env.production");
        });

        test('has preload.js reference', () => {
            expect(mainJs).toContain("preload.js");
        });

        test('has license IPC handlers', () => {
            expect(mainJs).toContain("license:status");
            expect(mainJs).toContain("license:activate");
            expect(mainJs).toContain("license:deactivate");
        });

        test('activates against the configured LICENSE_SERVER', () => {
            // URL now comes from the LICENSE_SERVER_URL env var (set by
            // .env.production to https://dynamoops.io). The template literal
            // uses a LICENSE_SERVER constant declared at the top of the file.
            expect(mainJs).toContain("process.env.LICENSE_SERVER_URL");
            expect(mainJs).toContain("'https://dynamoops.io'"); // fallback default
            expect(mainJs).toContain("${LICENSE_SERVER}/api/license/activate");
        });
    });

    // ── .env.production has required vars ────────────────────────────────────

    describe('.env.production', () => {
        const envContent = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');

        test('has DYNAMO_LICENSE_PUBLIC_KEY', () => {
            expect(envContent).toContain('DYNAMO_LICENSE_PUBLIC_KEY');
            expect(envContent).toContain('BEGIN PUBLIC KEY');
        });

        test('has LICENSE_SERVER_URL pointing to production', () => {
            expect(envContent).toContain('LICENSE_SERVER_URL=https://dynamoops.io');
        });

        test('does NOT contain test/dev URLs', () => {
            expect(envContent).not.toContain('localhost:3000');
        });
    });

    // ── index.html has LicenseManager loaded ─────────────────────────────────

    describe('index.html', () => {
        const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

        test('does NOT have standalone LicenseManager script tag', () => {
            // LicenseManager should be bundled via app.js import, not a separate <script>
            expect(html).not.toContain('<script src="/js/components/LicenseManager.js">');
            expect(html).not.toContain("<script src='/js/components/LicenseManager.js'>");
        });

        test('has app.js script tag', () => {
            expect(html).toContain('js/app.js');
        });

        test('has license badge container in header', () => {
            expect(html).toContain('header-actions');
        });

        test('has title DynamoOps', () => {
            expect(html).toContain('DynamoOps');
        });
    });

    // ── app.js imports LicenseManager ────────────────────────────────────────

    describe('app.js', () => {
        const appJs = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

        test('imports LicenseManager.js', () => {
            expect(appJs).toContain("./components/LicenseManager.js");
        });

        test('initializes licenseManager', () => {
            expect(appJs).toContain('window.licenseManager');
            expect(appJs).toContain('.init()');
        });
    });

    // ── LicenseManager.js has UI rules ───────────────────────────────────────

    describe('LicenseManager.js', () => {
        const lm = fs.readFileSync(path.join(ROOT, 'public/js/components/LicenseManager.js'), 'utf8');

        test('defines _applyPlanToUI', () => {
            expect(lm).toContain('_applyPlanToUI');
        });

        test('hides add-item-btn for free plan', () => {
            expect(lm).toContain('add-item-btn');
        });

        test('hides import-btn for free plan', () => {
            expect(lm).toContain('import-btn');
        });

        test('hides schema-export-btn for non pro_plus', () => {
            expect(lm).toContain('schema-export-btn');
        });

        test('hides code-gen-btn for non pro_plus', () => {
            expect(lm).toContain('code-gen-btn');
        });

        test('creates window.licenseManager', () => {
            expect(lm).toContain('window.licenseManager');
        });

        test('shows upgrade modal with correct URL', () => {
            expect(lm).toContain('dynamoops.io/#pricing');
        });
    });

    // ── preload.js exposes correct API ───────────────────────────────────────

    describe('preload.js', () => {
        const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

        test('exposes licenseStatus', () => {
            expect(preload).toContain('licenseStatus');
        });

        test('exposes licenseActivate', () => {
            expect(preload).toContain('licenseActivate');
        });

        test('exposes licenseDeactivate', () => {
            expect(preload).toContain('licenseDeactivate');
        });

        test('uses contextBridge', () => {
            expect(preload).toContain('contextBridge');
        });
    });

    // ── Route protection ─────────────────────────────────────────────────────

    describe('API routes have license protection', () => {
        const routes = fs.readFileSync(path.join(ROOT, 'src/backend/routes/api.js'), 'utf8');

        test('create table requires pro', () => {
            expect(routes).toMatch(/post.*tables.*requirePlan.*pro/i);
        });

        test('delete item requires pro', () => {
            expect(routes).toMatch(/delete.*items.*requirePlan.*pro/i);
        });

        test('imports requirePlan', () => {
            expect(routes).toContain('requirePlan');
        });
    });

    // ── stsService does not inherit stale endpoint ───────────────────────────

    describe('stsService.js', () => {
        const sts = fs.readFileSync(path.join(ROOT, 'src/backend/services/stsService.js'), 'utf8');

        test('does NOT fallback to awsConfig.currentConfig.endpoint', () => {
            expect(sts).not.toContain("awsConfig.currentConfig.endpoint");
        });
    });
});
