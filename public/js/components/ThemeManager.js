import { $ } from '../utils/dom.js';

const STORAGE_KEY = 'dynamo-gui-theme';

export function initThemeManager() {
    const toggleBtn = $('#theme-toggle-btn');
    if (!toggleBtn) return;

    const saved = localStorage.getItem(STORAGE_KEY) || 'dark';
    applyTheme(saved);

    toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem(STORAGE_KEY, next);
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggleBtn = $('#theme-toggle-btn');
    if (toggleBtn) {
        toggleBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
        toggleBtn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
}
