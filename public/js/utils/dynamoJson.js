// Native JS values ⇄ DynamoDB JSON (typed AttributeValues: S, N, BOOL, NULL, L, M, SS, NS, BS)

const SET_TAGS = { $SS: 'SS', $NS: 'NS', $BS: 'BS' };

/**
 * The API sends DynamoDB sets as tagged objects — { "$SS": [...] },
 * { "$NS": [...] }, { "$BS": [<base64>] } — so they survive JSON and are
 * written back as sets. Returns 'SS' | 'NS' | 'BS', or null for anything else.
 */
export function setTypeOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== 1 || !SET_TAGS[keys[0]] || !Array.isArray(value[keys[0]])) return null;
    return SET_TAGS[keys[0]];
}

/** Native value → AttributeValue, e.g. 42 → { N: '42' }. */
export function toAttributeValue(value) {
    if (value === null || value === undefined) return { NULL: true };
    if (typeof value === 'string') return { S: value };
    if (typeof value === 'number') return { N: String(value) };
    if (typeof value === 'boolean') return { BOOL: value };
    if (Array.isArray(value)) return { L: value.map(toAttributeValue) };
    const setType = setTypeOf(value);
    if (setType) {
        const values = value[`$${setType}`];
        return { [setType]: setType === 'NS' ? values.map(String) : values };
    }
    if (typeof value === 'object') return { M: toDynamoJson(value) };
    return { S: String(value) };
}

/** Native item / map → DynamoDB JSON (each attribute as a typed AttributeValue). */
export function toDynamoJson(item) {
    return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toAttributeValue(v)]));
}
