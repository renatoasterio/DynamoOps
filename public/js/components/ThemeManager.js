import { $ } from '../utils/dom.js';
import { loadString, saveString } from '../utils/storage.js';

const STORAGE_KEY = 'dynamo-gui-theme';

export function initThemeManager() {
    const toggleBtn = $('#theme-toggle-btn');
    if (!toggleBtn) return;

    const saved = loadString(STORAGE_KEY, 'dark');
    applyTheme(saved);

    toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        saveString(STORAGE_KEY, next);
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
