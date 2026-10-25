// Native JS values ⇄ DynamoDB JSON (typed AttributeValues: S, N, BOOL, NULL, L, M)

/** Native value → AttributeValue, e.g. 42 → { N: '42' }. */
export function toAttributeValue(value) {
    if (value === null || value === undefined) return { NULL: true };
    if (typeof value === 'string') return { S: value };
    if (typeof value === 'number') return { N: String(value) };
    if (typeof value === 'boolean') return { BOOL: value };
    if (Array.isArray(value)) return { L: value.map(toAttributeValue) };
    if (typeof value === 'object') return { M: toDynamoJson(value) };
    return { S: String(value) };
}

/** Native item / map → DynamoDB JSON (each attribute as a typed AttributeValue). */
export function toDynamoJson(item) {
    return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toAttributeValue(v)]));
}
