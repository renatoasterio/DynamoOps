'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Build integrity', () => {
    // ── Critical files exist ─────────────────────────────────────────────────

    describe('required files exist', () => {
        const required = [
            'electron-main.js',
            'server.js',
            'package.json',
            'LICENSE',
            'public/index.html',
            'public/styles.css',
            'public/js/app.js',
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
        const buildScript = read('scripts/build-prod.js');

        test('copies server.js and electron-main.js to staging', () => {
            expect(buildScript).toContain("'server.js'");
            expect(buildScript).toContain("'electron-main.js'");
        });

        test('bundles the frontend with esbuild', () => {
            expect(buildScript).toContain('esbuild.buildSync');
        });
    });

    describe('package.json build config', () => {
        const pkg = JSON.parse(read('package.json'));

        test('includes server.js and electron-main.js', () => {
            expect(pkg.build.files).toContain('server.js');
            expect(pkg.build.files).toContain('electron-main.js');
        });

        test('has productName DynamoOps', () => {
            expect(pkg.build.productName).toBe('DynamoOps');
        });

        test('points to the LICENSE file (MIT + Commons Clause)', () => {
            expect(pkg.license).toBe('SEE LICENSE IN LICENSE');
            const license = read('LICENSE');
            expect(license).toContain('Commons Clause');
            expect(license).toContain('MIT License');
        });
    });

    // ── Frontend entry points ────────────────────────────────────────────────

    describe('index.html', () => {
        const html = read('public/index.html');

        test('has app.js script tag', () => {
            expect(html).toContain('<script type="module" src="js/app.js"></script>');
        });

        test('has the AWS SSO sign-in pane and tab', () => {
            expect(html).toContain('data-tab="sso"');
            expect(html).toContain('id="login-pane-sso"');
            expect(html).toContain('id="login-sso-start-url"');
        });

        test('has title DynamoOps', () => {
            expect(html).toContain('DynamoOps');
        });
    });

    describe('API routes', () => {
        const routes = read('src/backend/routes/api.js');

        test('exposes the SSO sign-in routes', () => {
            ['/sso/start', '/sso/poll', '/sso/accounts', '/sso/roles', '/sso/connect', '/sso/signout', '/sso/config']
                .forEach((r) => expect(routes).toContain(r));
        });
    });

    // ── Free for everyone: no paid-plan gating left anywhere ─────────────────

    describe('no license / paid-plan code', () => {
        const sources = [
            'electron-main.js',
            'server.js',
            'src/backend/routes/api.js',
            'public/index.html',
            'public/js/app.js',
            'public/js/api/apiClient.js',
            'public/js/components/DataViewer.js',
            'public/js/components/KeyboardManager.js',
        ];

        for (const file of sources) {
            test(`${file} has no license or plan checks`, () => {
                const src = read(file);
                expect(src).not.toMatch(/licenseManager|licenseService|requirePlan|hasPlan|showUpgradeModal/);
            });
        }

        test('license modules are gone', () => {
            [
                'src/backend/services/licenseService.js',
                'src/backend/middleware/license.js',
                'public/js/components/LicenseManager.js',
                '.env.production',
            ].forEach((f) => expect(fs.existsSync(path.join(ROOT, f))).toBe(false));
        });
    });

    // ── stsService does not inherit stale endpoint ───────────────────────────

    describe('stsService.js', () => {
        const sts = read('src/backend/services/stsService.js');

        test('does NOT fallback to awsConfig.currentConfig.endpoint', () => {
            expect(sts).not.toContain("awsConfig.currentConfig.endpoint");
        });
    });
});
