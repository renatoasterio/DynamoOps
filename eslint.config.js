const globals = require('globals');

const rules = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
};

module.exports = [
    { ignores: ['node_modules/**', 'dist/**', '.build-staging/**', 'public/js/lib/**'] },
    {
        // Renderer: ES modules running in the browser / Electron sandbox
        files: ['public/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser, JSZip: 'readonly' },
        },
        rules,
    },
    {
        // Main process, Express backend, build scripts and tests: CommonJS on Node
        files: ['*.js', 'src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.jest },
        },
        rules,
    },
];
