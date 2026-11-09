'use strict';

const dynamoService = require('../src/backend/services/dynamoService');
const { statusFor, HttpError } = require('../src/backend/middleware/errors');

/** Fake docClient: BatchWrite returns the configured unprocessed entries per call. */
function fakeClients(unprocessedPerCall = []) {
    const calls = [];
    return {
        calls,
        docClient: {
            async send(command) {
                const requests = Object.values(command.input.RequestItems)[0];
                calls.push(requests);
                const left = unprocessedPerCall[calls.length - 1] || 0;
                return {
                    ConsumedCapacity: [{ CapacityUnits: requests.length - left }],
                    UnprocessedItems: left ? { t: requests.slice(0, left) } : {},
                };
            },
        },
    };
}

const keys = (n) => Array.from({ length: n }, (_, i) => ({ pk: `k${i}` }));

describe('dynamoService batch writes', () => {
    test('splits requests in batches of 25', async () => {
        const clients = fakeClients();
        const result = await dynamoService.batchDelete(clients, 't', keys(60));
        expect(clients.calls.map((c) => c.length)).toEqual([25, 25, 10]);
        expect(result.processedCount).toBe(60);
        expect(result.unprocessed).toEqual([]);
        expect(result.consumedCapacity.CapacityUnits).toBe(60);
    });

    test('retries unprocessed requests', async () => {
        // First call leaves 5 unprocessed, the retry processes them
        const clients = fakeClients([5, 0]);
        const result = await dynamoService.batchDelete(clients, 't', keys(10));
        expect(clients.calls.map((c) => c.length)).toEqual([10, 5]);
        expect(result.processedCount).toBe(10);
    });

    test('reports what is still unprocessed after the retries', async () => {
        const clients = fakeClients([2, 2, 2, 2]);
        const result = await dynamoService.batchWrite(clients, 't', [{ pk: 'a' }, { pk: 'b' }, { pk: 'c' }]);
        expect(clients.calls).toHaveLength(4); // 1 attempt + 3 retries
        expect(result.processedCount).toBe(1);
        expect(result.unprocessed).toEqual([{ pk: 'a' }, { pk: 'b' }]);
    });
});

describe('dynamoService input validation', () => {
    test('createTable requires a partition key', async () => {
        await expect(dynamoService.createTable({}, { TableName: 'abc' }))
            .rejects.toMatchObject({ status: 400 });
    });

    test('createGsi requires an index name', async () => {
        await expect(dynamoService.createGsi({}, 'abc', { pkName: 'pk', pkType: 'S' }))
            .rejects.toMatchObject({ status: 400 });
    });
});

describe('error status mapping', () => {
    test.each([
        ['ResourceNotFoundException', 404],
        ['ValidationException', 400],
        ['AccessDeniedException', 403],
        ['ExpiredTokenException', 401],
        ['ConditionalCheckFailedException', 409],
        ['ProvisionedThroughputExceededException', 429],
    ])('%s → %i', (name, status) => {
        const err = new Error('x');
        err.name = name;
        expect(statusFor(err)).toBe(status);
    });

    test('HttpError keeps its status; unknown errors are 500', () => {
        expect(statusFor(new HttpError(422, 'x'))).toBe(422);
        expect(statusFor(new Error('boom'))).toBe(500);
    });
});

describe('dynamoService query key types', () => {
    test('marshals a string partition key and both numeric sort bounds without losing precision', async () => {
        const { marshall } = require('@aws-sdk/util-dynamodb');
        const send = jest.fn().mockResolvedValue({});
        await dynamoService.query({ docClient: { send } }, 't', {
            keyConditionExpression: '#pk = :pkval AND #sk BETWEEN :skval AND :skval2',
            expressionAttributeValues: { ':pkval': '001', ':skval': '9007199254740993', ':skval2': '9007199254740995' },
            expressionAttributeValueTypes: { ':pkval': 'S', ':skval': 'N', ':skval2': 'N' },
        });
        expect(marshall(send.mock.calls[0][0].input.ExpressionAttributeValues)).toEqual({
            ':pkval': { S: '001' },
            ':skval': { N: '9007199254740993' },
            ':skval2': { N: '9007199254740995' },
        });
    });

    test('decodes binary input and preserves untyped values', async () => {
        const send = jest.fn().mockResolvedValue({});
        await dynamoService.query({ docClient: { send } }, 't', {
            expressionAttributeValues: { ':pkval': 'AAE=', ':filter': 42 },
            expressionAttributeValueTypes: { ':pkval': 'B' },
        });
        expect(send.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({
            ':pkval': Buffer.from([0, 1]), ':filter': 42,
        });
    });

    test.each([['N', 'abc'], ['B', '!bad!']])('rejects invalid %s input before sending', async (type, value) => {
        const send = jest.fn();
        await expect(dynamoService.query({ docClient: { send } }, 't', {
            expressionAttributeValues: { ':pkval': value },
            expressionAttributeValueTypes: { ':pkval': type },
        })).rejects.toMatchObject({ status: 400 });
        expect(send).not.toHaveBeenCalled();
    });
});
