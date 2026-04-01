// LicenseManager.js — handles license UI and API calls via IPC
class LicenseManager {
    constructor() {
        this._status = null;
        this._modal = null;
        this._upgradeModal = null;
    }

    async init() {
        this._status = await this._fetchStatus();
        this._renderBadge();
        this._applyPlanToUI();
    }

    // ─── Plan hierarchy ───────────────────────────────────────────────
    _planLevel(plan) {
        return { free: 0, pro: 1, pro_plus: 2, team: 3 }[plan] ?? 0;
    }

    _hasPlan(required) {
        const current = this._status?.plan || 'free';
        return this._planLevel(current) >= this._planLevel(required);
    }

    // ─── Apply plan restrictions to the UI ───────────────────────────
    // Each entry: { id, requiredPlan, action }
    // action 'hide'    → display:none (feature doesn't exist for this plan)
    // action 'disable' → disabled + title hint (visible but not clickable)
    _applyPlanToUI() {
        const rules = [
            // ── Pro features ─────────────────────────────────────────
            { id: 'add-item-btn',        required: 'pro', action: 'hide' },
            { id: 'template-btn',        required: 'pro', action: 'hide' },
            { id: 'import-btn',          required: 'pro', action: 'hide' },
            { id: 'export-json-btn',     required: 'pro', action: 'hide' },
            { id: 'export-csv-btn',      required: 'pro', action: 'hide' },
            { id: 'cost-panel-btn',      required: 'pro', action: 'hide' },
            { id: 'stream-toggle-btn',   required: 'pro', action: 'hide' },
            { id: 'create-table-btn',    required: 'pro', action: 'hide' },
            { id: 'delete-table-btn',    required: 'pro', action: 'hide' },
            { id: 'truncate-table-btn',  required: 'pro', action: 'hide' },
            // ── Pro+ features ────────────────────────────────────────
            { id: 'schema-export-btn',   required: 'pro_plus', action: 'hide' },
            { id: 'indexes-btn',         required: 'pro_plus', action: 'hide' },
            { id: 'code-gen-btn',        required: 'pro_plus', action: 'hide' },
        ];

        for (const { id, required, action } of rules) {
            const el = document.getElementById(id);
            if (!el) continue;

            if (this._hasPlan(required)) {
                // Restore — remove any previous restriction
                el.style.display = '';
                el.disabled = false;
                if (el.dataset.originalTitle) {
                    el.title = el.dataset.originalTitle;
                    delete el.dataset.originalTitle;
                }
            } else {
                if (action === 'hide') {
                    el.style.display = 'none';
                } else {
                    el.disabled = true;
                    if (!el.dataset.originalTitle) el.dataset.originalTitle = el.title || '';
                    el.title = `Requires ${required.replace('_', '+')} plan — click badge to upgrade`;
                }
            }
        }
    }

    async _fetchStatus() {
        if (window.electronAPI?.licenseStatus) {
            return await window.electronAPI.licenseStatus();
        }
        return { plan: 'free' };
    }

    _renderBadge() {
        // Remove existing badge
        document.getElementById('license-plan-badge')?.remove();

        const status = this._status;
        if (!status) return;

        const plan = status.plan || 'free';
        const labels = { free: 'FREE', pro: 'PRO', pro_plus: 'PRO+', team: 'TEAM' };
        const colors = {
            free:     'badge-plan-free',
            pro:      'badge-plan-pro',
            pro_plus: 'badge-plan-proplus',
            team:     'badge-plan-team',
        };

        const badge = document.createElement('div');
        badge.id = 'license-plan-badge';
        badge.className = `plan-badge ${colors[plan] || 'badge-plan-free'}`;
        badge.textContent = labels[plan] || 'FREE';
        badge.title = 'Manage License';
        badge.addEventListener('click', () => this.showLicenseModal());

        const headerActions = document.getElementById('header-actions');
        if (headerActions) {
            headerActions.insertBefore(badge, headerActions.firstChild);
        }
    }

    showUpgradeModal(requiredPlan) {
        const existing = document.getElementById('upgrade-modal');
        if (existing) existing.remove();

        const planNames = { pro: 'Pro', pro_plus: 'Pro+', team: 'Team' };
        const modal = document.createElement('div');
        modal.id = 'upgrade-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box upgrade-modal-box">
                <div class="upgrade-modal-icon">🔒</div>
                <h3>Upgrade Required</h3>
                <p>This feature requires the <strong>${planNames[requiredPlan] || requiredPlan}</strong> plan.</p>
                <div class="upgrade-modal-actions">
                    <a href="https://dynamoops.io/#pricing" target="_blank" class="btn-primary">
                        View Plans
                    </a>
                    <button class="btn-secondary" onclick="document.getElementById('upgrade-modal').remove()">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
    }

    showLicenseModal() {
        const existing = document.getElementById('license-modal');
        if (existing) existing.remove();

        const status = this._status;
        const plan = status?.plan || 'free';
        const planNames = { free: 'Free', pro: 'Pro', pro_plus: 'Pro+', team: 'Team' };

        const modal = document.createElement('div');
        modal.id = 'license-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box license-modal-box">
                <div class="modal-header">
                    <h3>License</h3>
                    <button class="modal-close" id="license-modal-close">&times;</button>
                </div>
                <div class="license-status-section">
                    <div class="license-current-plan">
                        <span class="label">Current plan</span>
                        <span class="plan-badge ${plan === 'free' ? 'badge-plan-free' : plan === 'pro' ? 'badge-plan-pro' : plan === 'pro_plus' ? 'badge-plan-proplus' : 'badge-plan-team'}">
                            ${planNames[plan] || 'Free'}
                        </span>
                    </div>
                    ${status?.email ? `<div class="license-email">Registered to: <strong>${status.email}</strong></div>` : ''}
                    ${status?.expiresAt ? `<div class="license-renews">Renews: <strong>${new Date(status.expiresAt).toLocaleDateString()}</strong></div>` : ''}
                    ${status?.gracePeriod ? `<div class="license-warning">⚠️ License expired — grace period active. Connect to internet to renew.</div>` : ''}
                </div>
                ${plan === 'free' ? `
                <div class="license-activate-section">
                    <p class="license-hint">Have a license key? Enter it below.</p>
                    <div class="license-input-row">
                        <input type="text" id="license-key-input" placeholder="DYNAMO-XXXX-XXXX-XXXX-XXXX" class="license-key-input" />
                        <button id="license-activate-btn" class="btn-primary">Activate</button>
                    </div>
                    <div id="license-activate-error" class="license-error hidden"></div>
                    <div class="license-get-key">
                        Don't have a key? <a href="https://dynamoops.io/#pricing" target="_blank">Get one →</a>
                    </div>
                </div>
                ` : `
                <div class="license-deactivate-section">
                    <p class="license-hint">Deactivating frees this machine slot so you can activate on another machine.</p>
                    <button id="license-deactivate-btn" class="btn-danger">Deactivate License</button>
                    <div id="license-deactivate-error" class="license-error hidden"></div>
                </div>
                `}
            </div>
        `;

        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        document.getElementById('license-modal-close')?.addEventListener('click', () => modal.remove());

        // Wire up activate
        document.getElementById('license-activate-btn')?.addEventListener('click', async () => {
            const key    = document.getElementById('license-key-input').value.trim();
            const errEl  = document.getElementById('license-activate-error');
            const btn    = document.getElementById('license-activate-btn');
            if (!key) { this._showError(errEl, 'Enter a license key.'); return; }
            btn.textContent = 'Activating...';
            btn.disabled = true;
            const result = await window.electronAPI?.licenseActivate({ key });
            if (result?.success) {
                modal.remove();
                this._status = await this._fetchStatus();
                this._renderBadge();
                this._applyPlanToUI();
            } else {
                btn.textContent = 'Activate';
                btn.disabled = false;
                this._showError(errEl, result?.error || 'Activation failed.');
            }
        });

        // Wire up deactivate
        document.getElementById('license-deactivate-btn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('license-deactivate-error');
            const btn   = document.getElementById('license-deactivate-btn');
            btn.textContent = 'Deactivating...';
            btn.disabled = true;
            const result = await window.electronAPI?.licenseDeactivate();
            if (result?.success) {
                modal.remove();
                this._status = await this._fetchStatus();
                this._renderBadge();
                this._applyPlanToUI();
            } else {
                btn.textContent = 'Deactivate License';
                btn.disabled = false;
                this._showError(errEl, result?.error || 'Deactivation failed.');
            }
        });
    }

    _showError(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }
}

window.licenseManager = new LicenseManager();
