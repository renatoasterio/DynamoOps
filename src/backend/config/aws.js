const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
const { fromIni } = require('@aws-sdk/credential-providers');

// In-memory cache for clients
const clientCache = new Map();

// LocalStack accepts any credentials — users running against a local endpoint
// rarely have a real ~/.aws/credentials file, so the SDK's default credential
// chain fails with "Could not load credentials from any providers". Detecting
// loopback endpoints and injecting dummy credentials fixes this cleanly.
function isLocalEndpoint(endpoint) {
    if (!endpoint) return false;
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)(:\d+)?/i.test(endpoint.trim());
}

const LOCALSTACK_CREDENTIALS = {
    accessKeyId: 'test',
    secretAccessKey: 'test',
};

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

    if (endpoint && endpoint.trim() !== '') {
        opts.endpoint = endpoint.trim();
    }

    // Only load a named profile explicitly. 'default' and empty string both
    // mean: use the SDK's default credential chain (same as CLI without --profile).
    if (profile && profile !== 'default') {
        try {
            opts.credentials = fromIni({ profile });
        } catch (e) {
            console.warn(`Failed to load profile ${profile}, falling back to default credentials`);
        }
    } else if (isLocalEndpoint(opts.endpoint)) {
        // LocalStack — bypass credential chain with dummy creds so machines
        // without ~/.aws/credentials can still connect.
        opts.credentials = LOCALSTACK_CREDENTIALS;
    }

    const clients = buildClients(opts);
    clientCache.set(cacheKey, clients);
    return clients;
}

// Environment labels the UI can attach to a session (shown as a header badge)
const ENV_TAGS = new Set(['none', 'dev', 'qa', 'staging', 'prod', 'local']);
const normalizeEnvTag = (tag) => (ENV_TAGS.has(tag) ? tag : 'none');

let globalConfig = { region: 'us-east-1', profile: 'default', endpoint: '', envTag: 'none' };
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
    /** Clients of the active session (assumed role / SSO / last connect). */
    activeClients: () => globalClients,

    createClients: (config, explicitCredentials) => {
        globalConfig = config;
        globalClients = getCachedClients(config, explicitCredentials);
    },
    setAssumedRoleInfo: (info) => { assumedRoleInfo = info; },
    setCurrentConfig: (config) => { globalConfig = { envTag: 'none', ...config }; },
    /** Labels the active session (dev / prod / …) so a page reload can restore it. */
    setEnvTag: (tag) => { globalConfig = { ...globalConfig, envTag: normalizeEnvTag(tag) }; },
    normalizeEnvTag,
    setConnected: (value) => { isConnected = value; },
};
