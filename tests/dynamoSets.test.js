'use strict';

const http = require('http');
const net = require('net');
const { setReplacer, decodeSets } = require('../src/backend/utils/dynamoSets');
const dynamoService = require('../src/backend/services/dynamoService');
const { start } = require('../server');
const { HOST } = require('../src/backend/config/server');

describe('DynamoDB sets over JSON (#10)', () => {
    const item = {
        id: 'set-test',
        owners: new Set(['payments', 'web']),
        weights: new Set([1, 2]),
        blobs: new Set([new Uint8Array([1, 2, 3])]),
        nested: { tags: new Set(['a']) },
    };

    test('sets are serialized as tagged objects instead of {}', () => {
        expect(JSON.parse(JSON.stringify(item, setReplacer))).toEqual({
            id: 'set-test',
            owners: { $SS: ['payments', 'web'] },
            weights: { $NS: [1, 2] },
            blobs: { $BS: ['AQID'] },
            nested: { tags: { $SS: ['a'] } },
        });
    });

    test('tagged objects round-trip back to Sets', () => {
        const decoded = decodeSets(JSON.parse(JSON.stringify(item, setReplacer)));
        expect(decoded).toEqual(item);
        expect(decoded.weights).toBeInstanceOf(Set);
    });

    test('plain maps and lists are left alone', () => {
        const value = { m: { $SS: 'not-an-array' }, l: [1, { a: 1 }], two: { $SS: [], x: 1 } };
        expect(decodeSets(value)).toEqual(value);
    });

    test('putItem writes sets, not maps', async () => {
        const sent = [];
        const clients = { docClient: { send: async (c) => { sent.push(c.input); return {}; } } };
        await dynamoService.putItem(clients, 't', { id: 'x', owners: { $SS: ['a', 'b'] } });
        expect(sent[0].Item.owners).toEqual(new Set(['a', 'b']));
    });
});

describe('import without overwrite (#8)', () => {
    function fakeClients(existing) {
        const puts = [];
        return {
            puts,
            dynamoClient: { send: async () => ({ Table: { KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }] } }) },
            docClient: {
                async send(command) {
                    if (command.input.RequestItems) throw new Error('BatchWrite must not be used');
                    puts.push(command.input);
                    if (existing.includes(command.input.Item.pk)) {
                        const err = new Error('exists');
                        err.name = 'ConditionalCheckFailedException';
                        throw err;
                    }
                    return { ConsumedCapacity: { CapacityUnits: 1 } };
                },
            },
        };
    }

    test('existing items are skipped with a conditional put', async () => {
        const clients = fakeClients(['b']);
        const result = await dynamoService.batchWrite(clients, 't', [{ pk: 'a' }, { pk: 'b' }, { pk: 'c' }], { overwrite: false });
        expect(result).toMatchObject({ processedCount: 2, skippedCount: 1, unprocessed: [] });
        expect(clients.puts[0]).toMatchObject({
            ConditionExpression: 'attribute_not_exists(#pk)',
            ExpressionAttributeNames: { '#pk': 'pk' },
        });
    });
});

describe('server start (#11)', () => {
    test('falls back to a free port when the preferred one is taken', async () => {
        const blocker = net.createServer().listen(0, HOST);
        await new Promise((r) => blocker.once('listening', r));
        const taken = blocker.address().port;

        const port = await start(taken, { fallback: true });
        expect(port).not.toBe(taken);

        // The Host/Origin checks follow the actual port
        const status = await new Promise((resolve, reject) => {
            http.get({ host: HOST, port, path: '/', headers: { Host: `localhost:${port}` } }, (res) => {
                res.resume();
                resolve(res.statusCode);
            }).on('error', reject);
        });
        expect(status).toBe(200);
        blocker.close();
    });

    test('without fallback a taken port is an error', async () => {
        const blocker = net.createServer().listen(0, HOST);
        await new Promise((r) => blocker.once('listening', r));
        await expect(start(blocker.address().port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
        blocker.close();
    });
});
