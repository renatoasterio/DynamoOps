// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.js/,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    workers: 1,          // Electron tests must be serial (one app per process)
    retries: 0,
    fullyParallel: false,
    reporter: [['list']],
    use: {
        trace: 'retain-on-failure',
    },
});
