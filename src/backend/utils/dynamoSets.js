'use strict';

/**
 * DynamoDB sets (SS / NS / BS) ⇄ JSON.
 *
 * The DocumentClient unmarshalls sets into JavaScript `Set`s, which
 * JSON.stringify turns into `{}` — the values are lost on the way to the UI
 * and an item saved back from the editor would overwrite them with an empty
 * map. On the wire a set is therefore a tagged object:
 *
 *   { "$SS": ["a", "b"] }   { "$NS": [1, 2] }   { "$BS": ["<base64>", …] }
 *
 * `setReplacer` (used as Express's JSON replacer) produces it and `decodeSets`
 * turns it back into a `Set` before an item is written.
 */

const SET_TAGS = ['$SS', '$NS', '$BS'];

const isBinary = (v) => v instanceof Uint8Array;

/** Set → tagged object, or null when `value` is not a DocumentClient set. */
function encodeSet(value) {
    if (!(value instanceof Set)) return null;
    const values = [...value];
    if (values.every((v) => typeof v === 'number' || typeof v === 'bigint')) {
        return { $NS: values.map((v) => (typeof v === 'bigint' ? v.toString() : v)) };
    }
    if (values.every(isBinary)) {
        return { $BS: values.map((v) => Buffer.from(v).toString('base64')) };
    }
    return { $SS: values.map(String) };
}

/** JSON.stringify replacer: serializes sets as tagged objects. */
function setReplacer(_key, value) {
    return encodeSet(value) ?? value;
}

/** Tag of a tagged set object (`'$SS'` …), or null. */
function setTag(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== 1 || !SET_TAGS.includes(keys[0])) return null;
    return Array.isArray(value[keys[0]]) ? keys[0] : null;
}

/** Recursively turns tagged set objects back into `Set`s for the DocumentClient. */
function decodeSets(value) {
    if (Array.isArray(value)) return value.map(decodeSets);
    if (!value || typeof value !== 'object' || isBinary(value) || value instanceof Set) return value;

    const tag = setTag(value);
    if (tag === '$SS') return new Set(value.$SS.map(String));
    if (tag === '$NS') return new Set(value.$NS.map(Number));
    if (tag === '$BS') return new Set(value.$BS.map((b) => new Uint8Array(Buffer.from(String(b), 'base64'))));

    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeSets(v)]));
}

module.exports = { setReplacer, decodeSets, encodeSet };
