// localStorage can be unavailable (private mode, blocked storage) or full, and
// stored JSON can be corrupt: none of that should break the UI, so reads fall
// back to a default and writes report success instead of throwing.

export function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw) ?? fallback;
    } catch {
        return fallback;
    }
}

export function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

export function loadString(key, fallback = null) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

export function saveString(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function removeKey(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
