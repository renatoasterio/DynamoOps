export async function api(method, path, body = null, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    
    if (options.connection) {
        const { region, profile, endpoint } = options.connection;
        if (region) headers['x-aws-region'] = region;
        if (profile) headers['x-aws-profile'] = profile;
        if (endpoint) headers['x-aws-endpoint'] = endpoint;
    }

    const opts = {
        method,
        headers,
    };
    if (body) {
        opts.body = JSON.stringify(body);
    }
    
    const res = await fetch(`/api${path}`, opts);
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error('Failed to parse JSON response');
    }
    
    if (!res.ok) {
        throw new Error((data && data.error) || 'Unknown API error');
    }
    return data;
}
