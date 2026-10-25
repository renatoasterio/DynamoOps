const {
    ListTablesCommand,
    DescribeTableCommand,
    CreateTableCommand,
    DeleteTableCommand,
    UpdateTableCommand,
    ExecuteStatementCommand
} = require('@aws-sdk/client-dynamodb');
const {
    GetMetricStatisticsCommand,
    DescribeAlarmsForMetricCommand,
} = require('@aws-sdk/client-cloudwatch');
const {
    ScanCommand: DocScanCommand,
    QueryCommand: DocQueryCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { badRequest } = require('../middleware/errors');

// BatchWriteItem accepts at most 25 requests per call
const BATCH_WRITE_LIMIT = 25;
// Retries for items DynamoDB returns as unprocessed (throttling)
const BATCH_MAX_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 50;

function chunk(list, size) {
    const chunks = [];
    for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
    return chunks;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sumCapacityUnits(consumedCapacity = []) {
    return consumedCapacity.reduce((sum, c) => sum + (c.CapacityUnits || 0), 0);
}

/** Shapes a Scan/Query response for the UI. */
function toPage(result) {
    return {
        items: result.Items || [],
        count: result.Count,
        scannedCount: result.ScannedCount,
        lastEvaluatedKey: result.LastEvaluatedKey || null,
        consumedCapacity: result.ConsumedCapacity || null,
    };
}

/** Key schema + attribute definitions for a table or GSI (sort key optional). */
function buildKeySchema(pkName, pkType, skName, skType) {
    if (!pkName || !pkType) throw badRequest('Partition key name and type are required');
    const AttributeDefinitions = [{ AttributeName: pkName, AttributeType: pkType }];
    const KeySchema = [{ AttributeName: pkName, KeyType: 'HASH' }];
    if (skName && skType) {
        AttributeDefinitions.push({ AttributeName: skName, AttributeType: skType });
        KeySchema.push({ AttributeName: skName, KeyType: 'RANGE' });
    }
    return { AttributeDefinitions, KeySchema };
}

/**
 * Sends PutRequest/DeleteRequest entries in batches of 25, retrying the
 * unprocessed ones with exponential backoff.
 * Returns { processedCount, unprocessed: [request], consumedCapacity }.
 */
async function writeInBatches(clients, tableName, requests) {
    let processedCount = 0;
    let unprocessed = [];
    let capacityUnits = 0;

    for (const batch of chunk(requests, BATCH_WRITE_LIMIT)) {
        let pending = batch;
        for (let attempt = 0; pending.length && attempt <= BATCH_MAX_RETRIES; attempt++) {
            if (attempt > 0) await sleep(100 * 2 ** attempt);
            const result = await clients.docClient.send(new BatchWriteCommand({
                RequestItems: { [tableName]: pending },
                ReturnConsumedCapacity: 'TOTAL',
            }));
            capacityUnits += sumCapacityUnits(result.ConsumedCapacity);
            const left = result.UnprocessedItems?.[tableName] || [];
            processedCount += pending.length - left.length;
            pending = left;
        }
        unprocessed = unprocessed.concat(pending);
    }

    return { processedCount, unprocessed, consumedCapacity: { CapacityUnits: capacityUnits } };
}

class DynamoService {

    async testConnection(clients) {
        const result = await clients.dynamoClient.send(new ListTablesCommand({ Limit: 1 }));
        return result.TableNames.length;
    }

    async listTables(clients) {
        let allTables = [];
        let lastEvaluated = undefined;
        do {
            const result = await clients.dynamoClient.send(
                new ListTablesCommand({ ExclusiveStartTableName: lastEvaluated })
            );
            allTables = allTables.concat(result.TableNames || []);
            lastEvaluated = result.LastEvaluatedTableName;
        } while (lastEvaluated);
        return allTables;
    }

    async describeTable(clients, tableName) {
        const result = await clients.dynamoClient.send(
            new DescribeTableCommand({ TableName: tableName })
        );
        return result.Table;
    }

    async getTableDashboard(clients, tableName) {
        const t = await this.describeTable(clients, tableName);

        // CloudWatch: last 24 h, 1-hour granularity
        let cwMetrics = null;
        let alarms = [];
        if (clients.cloudWatchClient) {
            try {
                const now   = new Date();
                const start = new Date(now - 24 * 60 * 60 * 1000);
                const dims  = [{ Name: 'TableName', Value: tableName }];
                const period = 3600;

                const metric = (name, stat) => clients.cloudWatchClient.send(
                    new GetMetricStatisticsCommand({
                        Namespace: 'AWS/DynamoDB',
                        MetricName: name,
                        Dimensions: dims,
                        StartTime: start,
                        EndTime: now,
                        Period: period,
                        Statistics: [stat],
                    })
                );

                const [rcu, wcu, lat, throttledReads, throttledWrites] = await Promise.all([
                    metric('ConsumedReadCapacityUnits',  'Sum'),
                    metric('ConsumedWriteCapacityUnits', 'Sum'),
                    metric('SuccessfulRequestLatency',   'Average'),
                    metric('ReadThrottleEvents',         'Sum'),
                    metric('WriteThrottleEvents',        'Sum'),
                ]);

                const sort = pts => pts.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
                cwMetrics = {
                    rcu:             sort(rcu.Datapoints).map(d => ({ t: d.Timestamp, v: d.Sum })),
                    wcu:             sort(wcu.Datapoints).map(d => ({ t: d.Timestamp, v: d.Sum })),
                    latency:         sort(lat.Datapoints).map(d => ({ t: d.Timestamp, v: Math.round(d.Average * 10) / 10 })),
                    throttledReads:  sort(throttledReads.Datapoints).map(d => ({ t: d.Timestamp, v: d.Sum })),
                    throttledWrites: sort(throttledWrites.Datapoints).map(d => ({ t: d.Timestamp, v: d.Sum })),
                };

                // Active alarms for this table
                const alarmResult = await clients.cloudWatchClient.send(
                    new DescribeAlarmsForMetricCommand({
                        Namespace: 'AWS/DynamoDB',
                        MetricName: 'ConsumedReadCapacityUnits',
                        Dimensions: dims,
                    })
                );
                alarms = (alarmResult.MetricAlarms || []).map(a => ({
                    name: a.AlarmName,
                    state: a.StateValue,
                    reason: a.StateReason,
                }));
            } catch (_) {
                cwMetrics = null;
            }
        }

        return {
            tableName:    t.TableName,
            status:       t.TableStatus,
            itemCount:    t.ItemCount,
            sizeBytes:    t.TableSizeBytes,
            createdAt:    t.CreationDateTime,
            billingMode:  t.BillingModeSummary?.BillingMode || 'PROVISIONED',
            throughput: {
                read:          t.ProvisionedThroughput?.ReadCapacityUnits  ?? 0,
                write:         t.ProvisionedThroughput?.WriteCapacityUnits ?? 0,
                lastDecreaseAt: t.ProvisionedThroughput?.LastDecreaseDateTime,
                lastIncreaseAt: t.ProvisionedThroughput?.LastIncreaseDateTime,
            },
            gsiCount:     (t.GlobalSecondaryIndexes || []).length,
            lsiCount:     (t.LocalSecondaryIndexes  || []).length,
            replicaCount: (t.Replicas || []).length,
            streamEnabled: !!t.StreamSpecification?.StreamEnabled,
            keySchema:    t.KeySchema,
            attributes:   t.AttributeDefinitions,
            cwMetrics,
            alarms,
        };
    }

    async createTable(clients, { TableName, PartitionKeyName, PartitionKeyType, SortKeyName, SortKeyType }) {
        if (!TableName) throw badRequest('TableName is required');

        const params = {
            TableName,
            ...buildKeySchema(PartitionKeyName, PartitionKeyType, SortKeyName, SortKeyType),
            BillingMode: 'PAY_PER_REQUEST',
        };

        const result = await clients.dynamoClient.send(new CreateTableCommand(params));
        return result.TableDescription;
    }

    async deleteTable(clients, tableName) {
        await clients.dynamoClient.send(new DeleteTableCommand({ TableName: tableName }));
    }

    async createGsi(clients, tableName, { indexName, pkName, pkType, skName, skType, projection, nonKeyAttrs }) {
        if (!indexName) throw badRequest('indexName is required');
        const { AttributeDefinitions, KeySchema } = buildKeySchema(pkName, pkType, skName, skType);

        const Projection = { ProjectionType: projection || 'ALL' };
        if (projection === 'INCLUDE' && nonKeyAttrs?.length > 0) {
            Projection.NonKeyAttributes = nonKeyAttrs;
        }

        const params = {
            TableName: tableName,
            AttributeDefinitions,
            GlobalSecondaryIndexUpdates: [{
                Create: { IndexName: indexName, KeySchema, Projection }
            }]
        };

        const result = await clients.dynamoClient.send(new UpdateTableCommand(params));
        return result.TableDescription;
    }

    async deleteGsi(clients, tableName, indexName) {
        const params = {
            TableName: tableName,
            GlobalSecondaryIndexUpdates: [{
                Delete: { IndexName: indexName }
            }]
        };
        const result = await clients.dynamoClient.send(new UpdateTableCommand(params));
        return result.TableDescription;
    }

    async scan(clients, tableName, filters) {
        const params = {
            TableName: tableName,
            Limit: filters.limit || DEFAULT_PAGE_SIZE,
        };

        if (filters.exclusiveStartKey) params.ExclusiveStartKey = filters.exclusiveStartKey;
        if (filters.filterExpression) {
            params.FilterExpression = filters.filterExpression;
            if (filters.expressionAttributeValues) params.ExpressionAttributeValues = filters.expressionAttributeValues;
            if (filters.expressionAttributeNames) params.ExpressionAttributeNames = filters.expressionAttributeNames;
        }

        params.ReturnConsumedCapacity = 'TOTAL';
        return toPage(await clients.docClient.send(new DocScanCommand(params)));
    }

    async query(clients, tableName, filters) {
        const params = {
            TableName: tableName,
            KeyConditionExpression: filters.keyConditionExpression,
            Limit: filters.limit || DEFAULT_PAGE_SIZE,
        };

        if (filters.expressionAttributeValues) params.ExpressionAttributeValues = filters.expressionAttributeValues;
        if (filters.expressionAttributeNames) params.ExpressionAttributeNames = filters.expressionAttributeNames;
        if (filters.filterExpression) params.FilterExpression = filters.filterExpression;
        if (filters.indexName) params.IndexName = filters.indexName;
        if (filters.exclusiveStartKey) params.ExclusiveStartKey = filters.exclusiveStartKey;
        if (filters.scanIndexForward !== undefined) params.ScanIndexForward = filters.scanIndexForward;

        params.ReturnConsumedCapacity = 'TOTAL';
        return toPage(await clients.docClient.send(new DocQueryCommand(params)));
    }

    async executeStatement(clients, statement, nextToken) {
        const params = { Statement: statement, ReturnConsumedCapacity: 'TOTAL' };
        if (nextToken) params.NextToken = nextToken;

        const result = await clients.dynamoClient.send(new ExecuteStatementCommand(params));
        const items = (result.Items || []).map(item => unmarshall(item));

        return {
            items: items,
            nextToken: result.NextToken || null,
            consumedCapacity: result.ConsumedCapacity || null,
        };
    }

    async updateAttribute(clients, tableName, key, attributeName, newValue) {
        const params = {
            TableName: tableName,
            Key: key,
            ReturnConsumedCapacity: 'TOTAL',
        };

        if (newValue === undefined || newValue === null) {
            // REMOVE the attribute entirely
            params.UpdateExpression = 'REMOVE #attr';
            params.ExpressionAttributeNames = { '#attr': attributeName };
        } else {
            params.UpdateExpression = 'SET #attr = :val';
            params.ExpressionAttributeNames = { '#attr': attributeName };
            params.ExpressionAttributeValues = { ':val': newValue };
        }

        const result = await clients.docClient.send(new UpdateCommand(params));
        return { consumedCapacity: result.ConsumedCapacity || null };
    }

    async putItem(clients, tableName, item) {
        const result = await clients.docClient.send(new PutCommand({
            TableName: tableName, Item: item, ReturnConsumedCapacity: 'TOTAL'
        }));
        return { consumedCapacity: result.ConsumedCapacity || null };
    }

    async deleteItem(clients, tableName, key) {
        const result = await clients.docClient.send(new DeleteCommand({
            TableName: tableName, Key: key, ReturnConsumedCapacity: 'TOTAL'
        }));
        return { consumedCapacity: result.ConsumedCapacity || null };
    }

    async batchWrite(clients, tableName, items) {
        const result = await writeInBatches(clients, tableName, items.map((Item) => ({ PutRequest: { Item } })));
        return { ...result, unprocessed: result.unprocessed.map((r) => r.PutRequest.Item) };
    }

    async batchDelete(clients, tableName, keys) {
        const result = await writeInBatches(clients, tableName, keys.map((Key) => ({ DeleteRequest: { Key } })));
        return { ...result, unprocessed: result.unprocessed.map((r) => r.DeleteRequest.Key) };
    }

    async truncateTable(clients, tableName) {
        const table = await this.describeTable(clients, tableName);
        const keyNames = table.KeySchema.map((k) => k.AttributeName);
        // Scan only the key attributes — that is all a DeleteRequest needs
        const projection = {
            ProjectionExpression: keyNames.map((_, i) => `#k${i}`).join(', '),
            ExpressionAttributeNames: Object.fromEntries(keyNames.map((name, i) => [`#k${i}`, name])),
        };

        let deletedCount = 0;
        let lastEvaluatedKey;
        do {
            const page = await clients.docClient.send(new DocScanCommand({
                TableName: tableName, ...projection, ExclusiveStartKey: lastEvaluatedKey,
            }));
            lastEvaluatedKey = page.LastEvaluatedKey;
            const keys = page.Items || [];
            if (keys.length) deletedCount += (await this.batchDelete(clients, tableName, keys)).processedCount;
        } while (lastEvaluatedKey);

        return deletedCount;
    }
}

module.exports = new DynamoService();
