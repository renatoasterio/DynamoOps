import { $ } from './dom.js';

const ICONS = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

// Messages often carry table/attribute names or AWS error text, so they are
// set as text — never as HTML.
export function showToast(message, type = 'info') {
    const container = $('#toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = ICONS[type] || ICONS.info;

    const text = document.createElement('span');
    text.textContent = message;

    toast.append(icon, text);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
