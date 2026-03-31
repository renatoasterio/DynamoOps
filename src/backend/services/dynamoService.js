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
    DeleteCommand,
    BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

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
        const tableResult = await clients.dynamoClient.send(
            new DescribeTableCommand({ TableName: tableName })
        );
        const t = tableResult.Table;

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
        if (!TableName || !PartitionKeyName || !PartitionKeyType) {
            throw new Error('TableName, PartitionKeyName, and PartitionKeyType are required');
        }

        const AttributeDefinitions = [
            { AttributeName: PartitionKeyName, AttributeType: PartitionKeyType }
        ];
        
        const KeySchema = [
            { AttributeName: PartitionKeyName, KeyType: 'HASH' }
        ];

        if (SortKeyName && SortKeyType) {
            AttributeDefinitions.push({ AttributeName: SortKeyName, AttributeType: SortKeyType });
            KeySchema.push({ AttributeName: SortKeyName, KeyType: 'RANGE' });
        }

        const params = {
            TableName,
            AttributeDefinitions,
            KeySchema,
            BillingMode: 'PAY_PER_REQUEST',
        };

        const result = await clients.dynamoClient.send(new CreateTableCommand(params));
        return result.TableDescription;
    }

    async deleteTable(clients, tableName) {
        await clients.dynamoClient.send(new DeleteTableCommand({ TableName: tableName }));
    }

    async createGsi(clients, tableName, { indexName, pkName, pkType, skName, skType, projection, nonKeyAttrs }) {
        const AttributeDefinitions = [
            { AttributeName: pkName, AttributeType: pkType }
        ];
        const KeySchema = [
            { AttributeName: pkName, KeyType: 'HASH' }
        ];

        if (skName && skType) {
            AttributeDefinitions.push({ AttributeName: skName, AttributeType: skType });
            KeySchema.push({ AttributeName: skName, KeyType: 'RANGE' });
        }

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
            Limit: filters.limit || 50,
        };

        if (filters.exclusiveStartKey) params.ExclusiveStartKey = filters.exclusiveStartKey;
        if (filters.filterExpression) {
            params.FilterExpression = filters.filterExpression;
            if (filters.expressionAttributeValues) params.ExpressionAttributeValues = filters.expressionAttributeValues;
            if (filters.expressionAttributeNames) params.ExpressionAttributeNames = filters.expressionAttributeNames;
        }

        params.ReturnConsumedCapacity = 'TOTAL';
        const result = await clients.docClient.send(new DocScanCommand(params));
        return {
            items: result.Items || [],
            count: result.Count,
            scannedCount: result.ScannedCount,
            lastEvaluatedKey: result.LastEvaluatedKey || null,
            consumedCapacity: result.ConsumedCapacity || null,
        };
    }

    async query(clients, tableName, filters) {
        const params = {
            TableName: tableName,
            KeyConditionExpression: filters.keyConditionExpression,
            Limit: filters.limit || 50,
        };

        if (filters.expressionAttributeValues) params.ExpressionAttributeValues = filters.expressionAttributeValues;
        if (filters.expressionAttributeNames) params.ExpressionAttributeNames = filters.expressionAttributeNames;
        if (filters.filterExpression) params.FilterExpression = filters.filterExpression;
        if (filters.indexName) params.IndexName = filters.indexName;
        if (filters.exclusiveStartKey) params.ExclusiveStartKey = filters.exclusiveStartKey;
        if (filters.scanIndexForward !== undefined) params.ScanIndexForward = filters.scanIndexForward;

        params.ReturnConsumedCapacity = 'TOTAL';
        const result = await clients.docClient.send(new DocQueryCommand(params));
        return {
            items: result.Items || [],
            count: result.Count,
            scannedCount: result.ScannedCount,
            lastEvaluatedKey: result.LastEvaluatedKey || null,
            consumedCapacity: result.ConsumedCapacity || null,
        };
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
        const chunkSize = 25;
        const chunks = [];
        for (let i = 0; i < items.length; i += chunkSize) {
            chunks.push(items.slice(i, i + chunkSize));
        }

        let processedCount = 0;
        let unprocessedItems = [];
        let totalConsumedWCU = 0;

        for (const chunk of chunks) {
            const requestItems = chunk.map(item => ({
                PutRequest: { Item: item }
            }));

            const params = {
                RequestItems: { [tableName]: requestItems },
                ReturnConsumedCapacity: 'TOTAL',
            };

            const result = await clients.docClient.send(new BatchWriteCommand(params));
            processedCount += chunk.length;

            if (result.ConsumedCapacity) {
                totalConsumedWCU += result.ConsumedCapacity.reduce((s, c) => s + (c.CapacityUnits || 0), 0);
            }
            if (result.UnprocessedItems && result.UnprocessedItems[tableName]) {
                 unprocessedItems = unprocessedItems.concat(result.UnprocessedItems[tableName]);
                 processedCount -= result.UnprocessedItems[tableName].length;
            }
        }

        return { processedCount, unprocessedItems, consumedCapacity: { CapacityUnits: totalConsumedWCU } };
    }

    async truncateTable(clients, tableName) {
        const tableDescription = await clients.dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
        const keySchema = tableDescription.Table.KeySchema;
        const keyAttributeNames = keySchema.map(k => k.AttributeName);

        let totalDeleted = 0;
        let lastEvaluatedKey = undefined;
        const chunkSize = 25; 

        do {
            const scanParams = {
                TableName: tableName,
                ProjectionExpression: keyAttributeNames.map((_, i) => `#k${i}`).join(', '),
                ExpressionAttributeNames: keyAttributeNames.reduce((acc, name, i) => {
                    acc[`#k${i}`] = name;
                    return acc;
                }, {}),
                ExclusiveStartKey: lastEvaluatedKey
            };

            const scanResult = await clients.docClient.send(new DocScanCommand(scanParams));
            const items = scanResult.Items || [];
            lastEvaluatedKey = scanResult.LastEvaluatedKey;

            if (items.length === 0) continue;

            const chunks = [];
            for (let i = 0; i < items.length; i += chunkSize) {
                chunks.push(items.slice(i, i + chunkSize));
            }

            for (const chunk of chunks) {
                const requestItems = chunk.map(item => ({
                    DeleteRequest: { Key: item }
                }));

                const batchParams = {
                    RequestItems: { [tableName]: requestItems }
                };

                const batchResult = await clients.docClient.send(new BatchWriteCommand(batchParams));
                totalDeleted += chunk.length - (batchResult.UnprocessedItems?.[tableName]?.length || 0);
            }
        } while (lastEvaluatedKey);

        return totalDeleted;
    }
}

module.exports = new DynamoService();
