'use strict';

// The API acts with the user's AWS credentials, so it must only ever be
// reachable from this machine — never bind to 0.0.0.0.
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3457;

function getPort() {
    return Number(process.env.PORT) || DEFAULT_PORT;
}

module.exports = { HOST, DEFAULT_PORT, getPort };
