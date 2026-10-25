// Single HTML escaper for every innerHTML / template-string sink.
// Escapes quotes too, so it is safe inside attribute values (title="…").
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
