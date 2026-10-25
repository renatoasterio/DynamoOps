import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    LANGUAGES, generateQuery, generateCrud, generateSdkFiles, sdkRootFolder,
} from '../public/js/codegen/index.js';
import { sq, shellQuote, jsTemplate, csVerbatim, goRaw, pyLiteral, jsKey } from '../public/js/codegen/expressions.js';
import { toPascalCase, toCamelCase, toSnakeCase, toKebabCase, entityName } from '../public/js/codegen/naming.js';

const base = { table: 'user-orders', region: 'sa-east-1', limit: 25 };
const CTX = {
    scan: { ...base, mode: 'scan', filterExpr: '', exprNames: null, exprVals: null },
    scanFilter: { ...base, mode: 'scan', filterExpr: '#s = :v', exprNames: { '#s': 'status' }, exprVals: { ':v': 'active' } },
    query: { ...base, mode: 'query', pkName: 'pk', pkVal: 'a', skName: 'sk', skOp: 'between', skVal: 1, skVal2: 9, indexName: 'by-date' },
    sql: { ...base, mode: 'sql', statement: `SELECT * FROM "user-orders" WHERE "status" = 'active'` },
};
const KEYS = { pkName: 'order_id', pkType: 'N', skName: 'created-at', skType: 'S' };

describe('codegen registry', () => {
    const ids = Object.keys(LANGUAGES);

    test('exposes the eight languages of the UI tabs', () => {
        expect(ids).toEqual(['nodejs', 'python', 'java', 'csharp', 'go', 'ruby', 'php', 'cli']);
    });

    test.each(ids)('%s implements query, crud and sdk', (id) => {
        for (const ctx of Object.values(CTX)) expect(generateQuery(id, ctx)).toEqual(expect.any(String));
        expect(generateCrud(id, KEYS, 'user-orders', 'sa-east-1')).toContain('user-orders');
        const files = generateSdkFiles(id, 'user-orders', KEYS, 'sa-east-1');
        expect(Object.keys(files).length).toBeGreaterThan(1);
        expect(files['README.md']).toBeDefined();
    });

    test('rejects unknown languages', () => {
        expect(() => generateQuery('cobol', CTX.scan)).toThrow(/Unsupported language/);
    });

    test('sdk root folder is kebab-case', () => {
        expect(sdkRootFolder('UserOrders')).toBe('user-orders-dynamo-sdk');
    });
});

describe('generated code is valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    // Node is always available, so JavaScript output is checked for real
    test.each(Object.keys(CTX))('Node.js %s snippet parses', (name) => {
        const file = join(dir, `${name}.mjs`);
        writeFileSync(file, generateQuery('nodejs', CTX[name]));
        expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    });

    test('Node.js CRUD parses with non-identifier attribute names', () => {
        const file = join(dir, 'crud.mjs');
        writeFileSync(file, generateCrud('nodejs', KEYS, 'user-orders', 'sa-east-1'));
        expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    });
});

describe('user input cannot break the generated code', () => {
    test.each([
        ['python', `Statement='SELECT * FROM "user-orders" WHERE "status" = \\'active\\''`],
        ['ruby', `statement: 'SELECT * FROM "user-orders" WHERE "status" = \\'active\\''`],
        ['php', `'Statement' => 'SELECT * FROM "user-orders" WHERE "status" = \\'active\\''`],
        ['csharp', `Statement = @"SELECT * FROM ""user-orders"" WHERE ""status"" = 'active'"`],
        ['java', `.statement("SELECT * FROM \\"user-orders\\" WHERE \\"status\\" = 'active'")`],
        ['cli', `--statement 'SELECT * FROM "user-orders" WHERE "status" = '\\''active'\\''' `],
    ])('%s escapes quotes in a PartiQL statement', (lang, expected) => {
        expect(generateQuery(lang, CTX.sql)).toContain(expected.trim());
    });

    test('literal encoders', () => {
        expect(sq("it's")).toBe("'it\\'s'");
        expect(shellQuote("it's")).toBe("'it'\\''s'");
        expect(jsTemplate('a `b` ${c}')).toBe('`a \\`b\\` \\${c}`');
        expect(csVerbatim('say "hi"')).toBe('@"say ""hi"""');
        expect(goRaw('a`b')).toBe('"a`b"');
        expect(pyLiteral({ a: true, b: null, c: [1, 'x'] })).toBe('{"a":True,"b":None,"c":[1,"x"]}');
        expect(jsKey('created-at')).toBe('"created-at"');
        expect(jsKey('createdAt')).toBe('createdAt');
    });
});

describe('scan snippets reproduce the filter', () => {
    test.each(Object.keys(LANGUAGES))('%s includes the filter expression', (lang) => {
        expect(generateQuery(lang, CTX.scanFilter)).toContain('#s = :v');
    });

    test('AWS CLI sends typed DynamoDB JSON values', () => {
        const code = generateQuery('cli', CTX.scanFilter);
        expect(code).toContain(`--expression-attribute-values '{":v":{"S":"active"}}'`);
    });
});

describe('expression attribute names are plain strings', () => {
    test.each([
        ['java', '"#pk", "pk"'],
        ['csharp', 'new Dictionary<string, string> { { "#pk", "pk" }'],
        ['go', 'map[string]string{"#pk": "pk"'],
        ['php', "'ExpressionAttributeNames'  => ['#pk' => 'pk'"],
    ])('%s', (lang, expected) => {
        expect(generateQuery(lang, CTX.query)).toContain(expected);
    });
});

describe('generated code is in English like the UI', () => {
    test.each(Object.keys(LANGUAGES))('%s CRUD example', (lang) => {
        const code = generateCrud(lang, KEYS, 'user-orders', 'sa-east-1');
        expect(code).not.toMatch(/Criado|Atualizado|Deletado|Listados|encontrado|Instale|Substitua/);
    });
});

describe('naming helpers', () => {
    test('casing', () => {
        expect(toPascalCase('user-orders')).toBe('UserOrders');
        expect(toCamelCase('created_at')).toBe('createdAt');
        expect(toSnakeCase('UserOrders')).toBe('user_orders');
        expect(toKebabCase('UserOrders')).toBe('user-orders');
        expect(entityName('policies')).toBe('Policy');
    });
});
