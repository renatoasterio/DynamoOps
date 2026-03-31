const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
const { fromIni } = require('@aws-sdk/credential-providers');

// In-memory cache for clients
const clientCache = new Map();

function buildClients(opts) {
    const dynamoClient = new DynamoDBClient(opts);
    const docClient = DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
        unmarshallOptions: { wrapNumbers: false },
    });
    // CloudWatch uses the same region/credentials but no custom endpoint
    const cwOpts = { region: opts.region || 'us-east-1' };
    if (opts.credentials) cwOpts.credentials = opts.credentials;
    const cloudWatchClient = new CloudWatchClient(cwOpts);
    return { dynamoClient, docClient, cloudWatchClient };
}

function getCachedClients(config, explicitCredentials) {
    const { region, profile, endpoint } = config;

    // Temporary credentials (from AssumeRole) are never cached — they expire
    if (explicitCredentials) {
        const opts = {
            region: region || 'us-east-1',
            credentials: {
                accessKeyId: explicitCredentials.AccessKeyId,
                secretAccessKey: explicitCredentials.SecretAccessKey,
                sessionToken: explicitCredentials.SessionToken,
            },
        };
        if (endpoint && endpoint.trim() !== '') opts.endpoint = endpoint.trim();
        return buildClients(opts);
    }

    const cacheKey = `${region}|${profile || 'default'}|${endpoint || ''}`;
    if (clientCache.has(cacheKey)) {
        return clientCache.get(cacheKey);
    }

    const opts = { region: region || 'us-east-1' };

    // Only load a named profile explicitly. 'default' and empty string both
    // mean: use the SDK's default credential chain (same as CLI without --profile).
    if (profile && profile !== 'default') {
        try {
            opts.credentials = fromIni({ profile });
        } catch (e) {
            console.warn(`Failed to load profile ${profile}, falling back to default credentials`);
        }
    }

    if (endpoint && endpoint.trim() !== '') {
        opts.endpoint = endpoint.trim();
    }

    const clients = buildClients(opts);
    clientCache.set(cacheKey, clients);
    return clients;
}

let globalConfig = { region: 'us-east-1', profile: 'default', endpoint: '' };
let assumedRoleInfo = null;
let isConnected = false;

// Legacy support for parts of the app that still use global clients
let globalClients = getCachedClients(globalConfig);

module.exports = {
    get currentConfig() { return globalConfig; },
    get dynamoClient() { return globalClients.dynamoClient; },
    get docClient() { return globalClients.docClient; },
    get cloudWatchClient() { return globalClients.cloudWatchClient; },
    get assumedRoleInfo() { return assumedRoleInfo; },
    get isConnected() { return isConnected; },

    getCachedClients,

    createClients: (config, explicitCredentials) => {
        globalConfig = config;
        globalClients = getCachedClients(config, explicitCredentials);
    },
    setAssumedRoleInfo: (info) => { assumedRoleInfo = info; },
    setCurrentConfig: (config) => { globalConfig = config; },
    setConnected: (value) => { isConnected = value; },
};
