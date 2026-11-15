const app = require('./src/backend/app');
const { HOST, getPort } = require('./src/backend/config/server');

/**
 * Starts the API on 127.0.0.1. Tries `preferredPort` first; when it is taken
 * (another DynamoOps instance, a dev copy…) and `fallback` is true, lets the OS
 * pick a free port instead of silently reusing whatever already listens there.
 * Resolves with the port actually bound.
 */
function start(preferredPort = getPort(), { fallback = false } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(preferredPort, HOST);
        server.once('listening', () => resolve(server.address().port));
        server.once('error', (err) => {
            if (fallback && err.code === 'EADDRINUSE' && preferredPort !== 0) {
                console.warn(`Port ${preferredPort} is in use — picking a free port`);
                resolve(start(0, { fallback: false }));
            } else {
                reject(err);
            }
        });
    });
}

if (require.main === module) {
    start().then((port) => {
        console.log(`\n  🚀  DynamoOps running at  http://localhost:${port}\n`);
    }).catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}

module.exports = { start };
