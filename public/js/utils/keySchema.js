import { state } from '../state/store.js';

/** Partition / sort key attribute names of a table or index key schema. */
export function getPkSk(keySchema = []) {
    return {
        pk: keySchema.find((k) => k.KeyType === 'HASH')?.AttributeName,
        sk: keySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName,
    };
}

/** Key attribute names of the active table (or of `tableInfo`). */
export function getKeyNames(tableInfo = state.tableInfo) {
    return (tableInfo?.KeySchema || []).map((k) => k.AttributeName);
}

/** The primary key of an item, e.g. { pk: 'user#1', sk: 42 }. */
export function extractKey(item, keyNames = getKeyNames()) {
    return Object.fromEntries(keyNames.map((k) => [k, item[k]]));
}
