import { state, getActiveTabConnection } from '../state/store.js';

function connectionHeaders(connection) {
    const headers = {};
    if (!connection) return headers;
    const { region, profile, endpoint } = connection;
    if (region) headers['x-aws-region'] = region;
    if (profile) headers['x-aws-profile'] = profile;
    if (endpoint) headers['x-aws-endpoint'] = endpoint;
    return headers;
}

/**
 * Low-level call to the local API. `body` may be a plain object (sent as JSON)
 * or a FormData (multipart upload). Throws with the server's error message.
 */
export async function api(method, path, body = null, options = {}) {
    const isForm = body instanceof FormData;
    const headers = connectionHeaders(options.connection);
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isForm ? body : JSON.stringify(body);

    const res = await fetch(`/api${path}`, opts);
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error(res.ok ? 'Failed to parse JSON response' : `${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
        throw new Error((data && data.error) || 'Unknown API error');
    }
    return data;
}

/** API call that runs against the active tab's AWS connection. */
export function connectedApi(method, path, body = null) {
    return api(method, path, body, { connection: getActiveTabConnection() });
}

/**
 * Call on /tables/<table><subPath>. Defaults to the active tab's table and
 * connection; the table name is always URL-encoded.
 */
export function tableApi(method, subPath = '', body = null, { table = state.currentTable, connection = getActiveTabConnection() } = {}) {
    return api(method, `/tables/${encodeURIComponent(table)}${subPath}`, body, { connection });
}
