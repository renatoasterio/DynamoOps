module.exports = {
    // .test.mjs files import the browser ES modules (public/js) natively;
    // npm test runs Jest with --experimental-vm-modules for that.
    testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.test.mjs'],
    transform: {},
};
