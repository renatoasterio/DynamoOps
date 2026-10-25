'use strict';

const { statementVerb, isWriteStatement } = require('../src/backend/utils/partiql');

describe('partiql.isWriteStatement', () => {
    test('SELECT is a read', () => {
        expect(isWriteStatement('SELECT * FROM "t"')).toBe(false);
        expect(isWriteStatement('  select * from "t" where "pk" = \'x\'')).toBe(false);
    });

    test('INSERT / UPDATE / DELETE are writes (any case, leading whitespace)', () => {
        expect(isWriteStatement('INSERT INTO "t" VALUE {\'pk\': \'1\'}')).toBe(true);
        expect(isWriteStatement('\n  update "t" set "a" = 1 where "pk" = \'1\'')).toBe(true);
        expect(isWriteStatement('Delete FROM "t" WHERE "pk" = \'1\'')).toBe(true);
    });

    test('leading comments are skipped', () => {
        expect(isWriteStatement('-- cleanup\n-- second line\nDELETE FROM "t" WHERE "pk" = \'1\'')).toBe(true);
        expect(isWriteStatement('-- just looking\nSELECT * FROM "t"')).toBe(false);
    });

    test('a write verb inside a string or later in a SELECT does not count', () => {
        expect(isWriteStatement('SELECT * FROM "t" WHERE "note" = \'DELETE me\'')).toBe(false);
    });

    test('empty / unknown statements are not writes', () => {
        expect(isWriteStatement('')).toBe(false);
        expect(isWriteStatement(null)).toBe(false);
        expect(isWriteStatement('EXPLAIN SELECT 1')).toBe(false);
        expect(statementVerb('   ')).toBe('');
    });
});
