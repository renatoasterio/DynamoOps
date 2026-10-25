/** 12345 → "12,345"; null/undefined → "—". */
export function fmtNum(n) {
    return n === null || n === undefined ? '—' : Number(n).toLocaleString();
}

/** 1536 → "1.5 KB"; null/undefined → "—". */
export function fmtBytes(bytes) {
    if (bytes === null || bytes === undefined) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(1)} ${units[i]}`;
}
