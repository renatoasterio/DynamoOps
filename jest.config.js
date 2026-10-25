module.exports = {
    testMatch: ['**/tests/**/*.test.js'],
    moduleNameMapper: {
        '^jose$': '<rootDir>/tests/__mocks__/jose.js',
    },
};
