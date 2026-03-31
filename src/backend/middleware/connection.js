const awsConfig = require('../config/aws');

function connectionMiddleware(req, res, next) {
    // When an assumed-role session is active, the global clients already carry
    // the temporary STS credentials (accessKeyId + secretKey + sessionToken).
    // Re-building clients from request headers would drop the sessionToken and
    // fall back to the base IAM user — causing AccessDenied on every request.
    if (awsConfig.assumedRoleInfo) {
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
