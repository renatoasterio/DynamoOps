const awsConfig = require('../config/aws');
const ssoService = require('../services/ssoService');

async function connectionMiddleware(req, res, next) {
    // When an assumed-role or SSO session is active, the global clients already
    // carry the temporary credentials (accessKeyId + secretKey + sessionToken).
    // Re-building clients from request headers would drop the sessionToken and
    // fall back to the base IAM user — causing AccessDenied on every request.
    if (awsConfig.assumedRoleInfo) {
        if (awsConfig.assumedRoleInfo.sso) {
            // SSO role credentials are short-lived; renew them silently while the
            // SSO token is valid so the user never gets kicked out mid-session.
            try { await ssoService.ensureFreshCredentials(); }
            catch (err) { console.warn('[sso] credential refresh failed:', err.message); }
        }
        req.clients = {
            dynamoClient:     awsConfig.dynamoClient,
            docClient:        awsConfig.docClient,
            cloudWatchClient: awsConfig.cloudWatchClient,
        };
        return next();
    }

    const region   = req.headers['x-aws-region'];
    const profile  = req.headers['x-aws-profile'];
    const endpoint = req.headers['x-aws-endpoint'];

    if (region) {
        try {
            req.clients = awsConfig.getCachedClients({ region, profile, endpoint });
        } catch (err) {
            console.error('Error creating AWS clients from headers:', err);
            req.clients = {
                dynamoClient: awsConfig.dynamoClient,
                docClient:    awsConfig.docClient,
            };
        }
    } else {
        req.clients = {
            dynamoClient: awsConfig.dynamoClient,
            docClient:    awsConfig.docClient,
        };
    }

    next();
}

module.exports = connectionMiddleware;
