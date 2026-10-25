const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBStreamsClient,
    DescribeStreamCommand,
    GetShardIteratorCommand,
    GetRecordsCommand,
} = require('@aws-sdk/client-dynamodb-streams');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

// Per-stream shard iterator cache: streamArn → { shardId: iteratorString }
const iteratorCache = new Map();

function buildStreamsClient(dynamoClient) {
    const cfg = dynamoClient.config;
    const opts = {
        region: cfg.region,
        credentials: cfg.credentials,
    };
    if (cfg.endpoint) opts.endpoint = cfg.endpoint;
    return new DynamoDBStreamsClient(opts);
}

async function getStreamStatus(clients, tableName) {
    const result = await clients.dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    const table = result.Table || {};
    const spec  = table.StreamSpecification || {};
    return {
        enabled:   spec.StreamEnabled === true,
        streamArn: table.LatestStreamArn || null,
        viewType:  spec.StreamViewType || null,
    };
}

async function getRecentRecords(clients, streamArn) {
    const streamsClient = buildStreamsClient(clients.dynamoClient);

    // Get current shards
    const descResult = await streamsClient.send(new DescribeStreamCommand({ StreamArn: streamArn }));
    const allShards  = descResult.StreamDescription?.Shards || [];

    // Keep only open shards (no EndingSequenceNumber) or most recent closed ones
    const leafShards = allShards.filter(s =>
        !allShards.some(s2 => s2.ParentShardId === s.ShardId)
    );

    const cached  = iteratorCache.get(streamArn) || {};
    const records = [];

    for (const shard of leafShards) {
        const { ShardId } = shard;
        let iterator = cached[ShardId];

        if (!iterator) {
            try {
                const it = await streamsClient.send(new GetShardIteratorCommand({
                    StreamArn: streamArn,
                    ShardId,
                    ShardIteratorType: 'LATEST',
                }));
                iterator = it.ShardIterator;
            } catch {
                continue;
            }
        }

        if (!iterator) continue;

        try {
            const recResult = await streamsClient.send(new GetRecordsCommand({
                ShardIterator: iterator,
                Limit: 100,
            }));

            cached[ShardId] = recResult.NextShardIterator || null;

            for (const record of (recResult.Records || [])) {
                const dyn = record.dynamodb || {};
                records.push({
                    eventId:   record.eventID,
                    eventName: record.eventName,           // INSERT | MODIFY | REMOVE
                    timestamp: dyn.ApproximateCreationDateTime
                        ? new Date(dyn.ApproximateCreationDateTime * 1000).toISOString()
                        : new Date().toISOString(),
                    keys:     dyn.Keys     ? unmarshall(dyn.Keys)     : {},
                    newImage: dyn.NewImage  ? unmarshall(dyn.NewImage) : null,
                    oldImage: dyn.OldImage  ? unmarshall(dyn.OldImage) : null,
                });
            }
        } catch {
            // Iterator expired — clear so it refreshes next poll
            delete cached[ShardId];
        }
    }

    iteratorCache.set(streamArn, cached);
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return records;
}

module.exports = { getStreamStatus, getRecentRecords };
