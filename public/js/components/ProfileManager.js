import { $ } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { config } from '../state/store.js';

const STORAGE_KEY = 'dynamo-gui-profiles';

function getProfiles() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveProfiles(profiles) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function initProfileManager() {
    const select = $('#saved-profile-select');
    const saveBtn = $('#save-profile-btn');
    const manageBtn = $('#manage-profiles-btn');
    const overlay = $('#manage-profiles-overlay');

    if (!select) return;

    populateSelect();

    document.addEventListener('profilesUpdated', () => {
        populateSelect();
    });

    select.addEventListener('change', () => {
        const name = select.value;
        if (!name) return;
        const profiles = getProfiles();
        const profile = profiles[name];
        if (!profile) return;

        const regionSelect = $('#region-select');
        const profileInput = $('#profile-input');
        const endpointInput = $('#endpoint-input');

        if (regionSelect) regionSelect.value = profile.region || 'us-east-1';
        if (profileInput) profileInput.value = profile.awsProfile || 'default';
        if (endpointInput) endpointInput.value = profile.endpoint || '';

        if (profile.roleArn) {
            // It's an Assume Role profile
            document.dispatchEvent(new CustomEvent('requestAssumeRole', { detail: profile }));
        }

        // Synchronize global config
        config.region = profile.region || 'us-east-1';
        config.profile = profile.awsProfile || 'default';
        config.endpoint = profile.endpoint || '';

        showToast(`Profile "${name}" loaded`, 'success');
    });

    saveBtn.addEventListener('click', () => {
        const name = prompt('Profile name:');
        if (!name || !name.trim()) return;

        const regionSelect = $('#region-select');
        const profileInput = $('#profile-input');
        const endpointInput = $('#endpoint-input');

        const profiles = getProfiles();
        profiles[name.trim()] = {
            region: regionSelect ? regionSelect.value : 'us-east-1',
            awsProfile: profileInput ? profileInput.value : 'default',
            endpoint: endpointInput ? endpointInput.value : '',
        };
        saveProfiles(profiles);
        populateSelect();
        select.value = name.trim();
        showToast(`Profile "${name.trim()}" saved`, 'success');
    });

    if (manageBtn && overlay) {
        manageBtn.addEventListener('click', openManageModal);
        const closeBtn = $('#manage-profiles-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeManageModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeManageModal();
        });
    }

    function populateSelect() {
        const profiles = getProfiles();
        const keys = Object.keys(profiles);
        select.innerHTML = '<option value="">— Profiles —</option>';
        keys.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
    }

    function openManageModal() {
        overlay.classList.remove('hidden');
        renderProfileList();
    }

    function closeManageModal() {
        overlay.classList.add('hidden');
    }

    function renderProfileList() {
        const container = $('#manage-profiles-list');
        if (!container) return;
        const profiles = getProfiles();
        const keys = Object.keys(profiles);

        if (keys.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-style:italic;text-align:center;padding:20px">No saved profiles yet.</p>';
            return;
        }

        container.innerHTML = keys.map(name => {
            const p = profiles[name];
            return `
                <div class="profile-list-item" data-name="${name}">
                    <div>
                        <div class="profile-name">${name}</div>
                        <div class="profile-detail">
                            ${p.roleArn ? '🛡️ ' + p.region : p.region} · 
                            ${p.roleArn ? p.roleArn.split('/').pop() : p.awsProfile}
                            ${p.endpoint ? ' · ' + p.endpoint : ''}
                        </div>
                    </div>
                    <button class="profile-delete-btn" data-name="${name}" title="Delete">🗑</button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.profile-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const n = btn.dataset.name;
                if (!confirm(`Delete profile "${n}"?`)) return;
                const profs = getProfiles();
                delete profs[n];
                saveProfiles(profs);
                populateSelect();
                renderProfileList();
                showToast(`Profile "${n}" deleted`, 'info');
            });
        });
    }
}
