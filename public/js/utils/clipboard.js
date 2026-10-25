import { showToast } from './toast.js';

/** Copies text and reports the outcome with a toast. */
export function copyText(text, successMessage = 'Copied to clipboard') {
    return navigator.clipboard.writeText(text)
        .then(() => showToast(successMessage, 'success'))
        .catch(() => showToast('Copy failed', 'error'));
}
