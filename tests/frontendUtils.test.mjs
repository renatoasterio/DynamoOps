import { escapeHtml } from '../public/js/utils/html.js';
import { toDynamoJson } from '../public/js/utils/dynamoJson.js';
import { getPkSk, getKeyNames, extractKey } from '../public/js/utils/keySchema.js';
import { fmtNum, fmtBytes } from '../public/js/utils/format.js';

describe('escapeHtml', () => {
    test('escapes every HTML-significant character, quotes included', () => {
        expect(escapeHtml(`<img src=x onerror="a('b')">&`))
            .toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    });

    test('is safe inside a double-quoted attribute', () => {
        const value = '" onmouseover="alert(1)';
        expect(`title="${escapeHtml(value)}"`).not.toMatch(/"\s+onmouseover="/);
    });

    test('null and undefined become empty strings; other values are stringified', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(42)).toBe('42');
    });
});

describe('toDynamoJson', () => {
    test('types every value', () => {
        expect(toDynamoJson({ s: 'a', n: 1.5, b: true, z: null, l: [1, 'x'], m: { k: 'v' } })).toEqual({
            s: { S: 'a' },
            n: { N: '1.5' },
            b: { BOOL: true },
            z: { NULL: true },
            l: { L: [{ N: '1' }, { S: 'x' }] },
            m: { M: { k: { S: 'v' } } },
        });
    });
});

describe('keySchema', () => {
    const tableInfo = { KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }] };

    test('getPkSk / getKeyNames / extractKey', () => {
        expect(getPkSk(tableInfo.KeySchema)).toEqual({ pk: 'pk', sk: 'sk' });
        expect(getPkSk(undefined)).toEqual({ pk: undefined, sk: undefined });
        expect(getKeyNames(tableInfo)).toEqual(['pk', 'sk']);
        expect(extractKey({ pk: 'a', sk: 1, other: true }, ['pk', 'sk'])).toEqual({ pk: 'a', sk: 1 });
    });
});

describe('format', () => {
    test('fmtNum / fmtBytes', () => {
        expect(fmtNum(null)).toBe('—');
        expect(fmtBytes(null)).toBe('—');
        expect(fmtBytes(512)).toBe('512 B');
        expect(fmtBytes(1536)).toBe('1.5 KB');
        expect(fmtBytes(5 * 1024 ** 3)).toBe('5.0 GB');
    });
});
