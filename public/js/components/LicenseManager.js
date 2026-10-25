// LicenseManager.js — handles license UI and API calls via IPC
class LicenseManager {
    constructor() {
        this._status = null;
        this._modal = null;
        this._upgradeModal = null;
    }

    async init() {
        this._status = await this._fetchStatus();
        this._refreshUI();
        // The main process refreshes the license in the background. When the
        // server gives a definitive negative answer, drop to Free and say why.
        window.electronAPI?.onLicenseChanged?.((info) => this._handleLicenseChanged(info));
        // macOS menu "License…" (⌘⇧L). Keyboard shortcut itself lives in KeyboardManager.
        window.electronAPI?.onLicenseOpen?.(() => this.showLicenseModal());
    }

    /** Re-renders every license entry point (header, login screen) and plan gating. */
    _refreshUI() {
        this._renderBadge();
        this._renderLoginBar();
        this._applyPlanToUI();
    }

    // ─── Labels ──────────────────────────────────────────────────────
    _planLabel(plan) { return { free: 'FREE', pro: 'PRO', pro_plus: 'PRO+', team: 'TEAM' }[plan] || 'FREE'; }
    _planName(plan)  { return { free: 'Free', pro: 'Pro', pro_plus: 'Pro+', team: 'Team' }[plan] || 'Free'; }
    _badgeClass(plan) {
        return { free: 'badge-plan-free', pro: 'badge-plan-pro', pro_plus: 'badge-plan-proplus', team: 'badge-plan-team' }[plan]
            || 'badge-plan-free';
    }
    _shortcutLabel() {
        return /Mac/i.test(navigator.platform || '') ? '⌘⇧L' : 'Ctrl+Shift+L';
    }

    async _handleLicenseChanged(info) {
        const messages = {
            revoked:   'Your DynamoOps license was transferred to another machine. ' +
                       'This installation has been switched to the Free plan.',
            not_found: 'Your DynamoOps license is no longer valid (it may have been removed ' +
                       'from its team). This installation has been switched to the Free plan.',
            suspended: 'Your DynamoOps subscription is no longer active. This installation ' +
                       'has been switched to the Free plan until the subscription is reinstated.',
        };
        alert(messages[info?.reason] || messages.revoked);
        this._status = await this._fetchStatus();
        this._refreshUI();
    }

    // ─── Plan hierarchy ───────────────────────────────────────────────
    _planLevel(plan) {
        return { free: 0, pro: 1, pro_plus: 2, team: 3 }[plan] ?? 0;
    }

    _hasPlan(required) {
        const current = this._status?.plan || 'free';
        return this._planLevel(current) >= this._planLevel(required);
    }

    /** Public check used by components that render gated controls dynamically. */
    hasPlan(required) {
        return this._hasPlan(required);
    }

    // ─── Apply plan restrictions to the UI ───────────────────────────
    // Each entry: { id, requiredPlan, action }
    // action 'hide'    → display:none (feature doesn't exist for this plan)
    // action 'disable' → disabled + title hint (visible but not clickable)
    _applyPlanToUI() {
        const rules = [
            // ── Pro features ─────────────────────────────────────────
            { id: 'add-item-btn',        required: 'pro', action: 'hide' },
            { id: 'bulk-delete-btn',     required: 'pro', action: 'hide' },
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

        // Dynamically rendered controls (schema-bar GSI delete buttons) are swept here too.
        document.querySelectorAll('.gsi-delete-btn').forEach(el => {
            el.style.display = this._hasPlan('pro_plus') ? '' : 'none';
        });

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

    // ─── Header entry point ──────────────────────────────────────────
    // Free plan → a real call-to-action button; paid plan → the plan badge.
    _renderBadge() {
        document.getElementById('license-plan-badge')?.remove();

        const status = this._status;
        const headerActions = document.getElementById('header-actions');
        if (!status || !headerActions) return;

        const plan = status.plan || 'free';
        const hint = `(${this._shortcutLabel()})`;
        let el;

        if (plan === 'free') {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'license-cta-btn';
            el.innerHTML = `
                <span class="license-cta-key" aria-hidden="true">🔑</span>
                <span>${status.suspended ? 'Subscription inactive' : 'Activate license'}</span>
                <span class="plan-badge">FREE</span>`;
            el.title = status.suspended
                ? `Your subscription is inactive — click for details ${hint}`
                : `Enter your license key to unlock Pro features ${hint}`;
        } else {
            el = document.createElement('div');
            el.className = `plan-badge plan-badge-paid ${this._badgeClass(plan)}`;
            el.setAttribute('role', 'button');
            el.innerHTML = `<span>${this._planLabel(plan)}</span>${status.gracePeriod ? '<span title="Offline — grace period active">⚠️</span>' : ''}`;
            el.title = `${this._planName(plan)} plan${status.email ? ' · ' + status.email : ''} — click to manage ${hint}`;
        }

        el.id = 'license-plan-badge';
        el.addEventListener('click', () => this.showLicenseModal());
        headerActions.insertBefore(el, headerActions.firstChild);
    }

    // ─── Login screen entry point ────────────────────────────────────
    // The login screen is the first thing users see, so the license must be
    // reachable from here as well (the header is hidden until connected).
    _renderLoginBar() {
        const bar = document.getElementById('login-license-bar');
        if (!bar) return;

        const status = this._status;
        if (!status) { bar.classList.add('hidden'); return; }

        const plan = status.plan || 'free';
        if (plan === 'free') {
            bar.innerHTML = `
                <div class="login-license-status">
                    <span class="plan-badge badge-plan-free">FREE</span>
                    <span>${status.suspended ? 'Subscription inactive' : 'Pro features are locked'}</span>
                </div>
                <button type="button" id="login-license-btn" class="login-license-link primary">🔑 Activate license</button>`;
        } else {
            bar.innerHTML = `
                <div class="login-license-status">
                    <span class="plan-badge ${this._badgeClass(plan)}">${this._planLabel(plan)}</span>
                    <span class="login-license-email" title="${this._escape(status.email || '')}">${this._escape(status.email || '')}</span>
                </div>
                <button type="button" id="login-license-btn" class="login-license-link">Manage license</button>`;
        }
        bar.classList.remove('hidden');
        document.getElementById('login-license-btn')?.addEventListener('click', () => this.showLicenseModal());
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
                    <button type="button" class="btn-secondary" id="upgrade-have-key-btn">
                        I have a license key
                    </button>
                </div>
                <button type="button" class="upgrade-modal-cancel" id="upgrade-cancel-btn">Not now</button>
            </div>
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
        document.getElementById('upgrade-cancel-btn')?.addEventListener('click', () => modal.remove());
        document.getElementById('upgrade-have-key-btn')?.addEventListener('click', () => {
            modal.remove();
            this.showLicenseModal();
        });
    }

    showLicenseModal() {
        document.getElementById('license-modal')?.remove();
        document.getElementById('upgrade-modal')?.remove();

        const status = this._status || { plan: 'free' };
        const plan = status.plan || 'free';
        const isFree = plan === 'free';
        const shortcut = this._shortcutLabel();

        const modal = document.createElement('div');
        modal.id = 'license-modal';
        modal.className = 'modal-overlay';

        const warnings = `
            ${status.gracePeriod ? `<div class="license-warning">⚠️ License expired — grace period active. Connect to the internet to renew.</div>` : ''}
            ${status.suspended ? `<div class="license-warning">⚠️ Subscription inactive — your ${this._planName(status.suspendedPlan)} plan will be restored automatically once the subscription is reinstated.${status.email ? ` (${this._escape(status.email)})` : ''}</div>` : ''}`;

        const freeBody = `
            <div class="license-modal-head">
                <div class="license-modal-title">
                    <span class="license-modal-icon" aria-hidden="true">🔑</span>
                    <h3>Activate DynamoOps</h3>
                </div>
                <button type="button" class="modal-close" id="license-modal-close" aria-label="Close">&times;</button>
            </div>
            <p class="license-modal-sub">Paste the license key you received by email to unlock Pro features on this machine.</p>
            ${warnings}
            <div class="license-activate-section">
                <label class="license-field-label" for="license-key-input">License key</label>
                <div class="license-input-row">
                    <input type="text" id="license-key-input" class="license-key-input"
                           placeholder="DYNAMO-XXXX-XXXX-XXXX-XXXX"
                           autocomplete="off" autocapitalize="characters" spellcheck="false" />
                    <button type="button" id="license-paste-btn" class="btn-secondary license-paste-btn" title="Paste from clipboard">Paste</button>
                </div>
                <button type="button" id="license-activate-btn" class="btn-primary license-activate-main">Activate license</button>
                <div id="license-activate-error" class="license-error hidden" role="alert"></div>
                <p class="license-hint license-hint-muted">
                    Keys look like <code>DYNAMO-…</code> (or <code>TEAM-…</code> for team seats) and were sent to the email used at checkout — check your spam folder.
                </p>
            </div>
            <div class="license-modal-footer">
                <span class="license-modal-footer-plan">Current plan <span class="plan-badge badge-plan-free">FREE</span></span>
                <a href="https://dynamoops.io/#pricing" target="_blank" class="license-modal-link">Don't have a key? See plans ↗</a>
            </div>
            <p class="license-shortcut-hint">Tip: press <kbd class="license-kbd">${shortcut}</kbd> to open this window anytime.</p>`;

        const paidBody = `
            <div class="license-modal-head">
                <div class="license-modal-title">
                    <span class="license-modal-icon" aria-hidden="true">✓</span>
                    <h3>Your license</h3>
                </div>
                <button type="button" class="modal-close" id="license-modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="license-status-section">
                <div class="license-current-plan">
                    <span class="label">Current plan</span>
                    <span class="plan-badge ${this._badgeClass(plan)}">${this._planName(plan)}</span>
                    ${status.teamRole ? `<span class="license-team-role">${status.teamRole === 'owner' ? '👑 Owner' : '👤 Member'}</span>` : ''}
                </div>
                ${status.email ? `<div class="license-email">Registered to <strong>${this._escape(status.email)}</strong></div>` : ''}
                ${status.expiresAt ? `<div class="license-renews">License check valid until <strong>${new Date(status.expiresAt).toLocaleDateString()}</strong></div>` : ''}
                ${warnings}
            </div>
            ${plan === 'team' ? `
            <div class="license-team-section">
                <div class="license-team-role">Team plan — ${status.teamRole === 'owner' ? 'you manage the seats' : 'managed by your team owner'}</div>
                <button type="button" id="team-manage-btn" class="btn-secondary">Manage Team</button>
            </div>` : ''}
            <div class="license-history-section">
                <button type="button" id="license-history-btn" class="btn-secondary">View activation history</button>
            </div>
            <div class="license-deactivate-section">
                <p class="license-hint">Deactivating frees this machine slot so you can activate on another machine.</p>
                <button type="button" id="license-deactivate-btn" class="btn-danger">Deactivate on this machine</button>
                <div id="license-deactivate-error" class="license-error hidden"></div>
            </div>
            <p class="license-shortcut-hint">Tip: press <kbd class="license-kbd">${shortcut}</kbd> to open this window anytime.</p>`;

        modal.innerHTML = `<div class="modal-box license-modal-box">${isFree ? freeBody : paidBody}</div>`;

        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        document.getElementById('license-modal-close')?.addEventListener('click', () => modal.remove());

        if (isFree) this._wireActivation(modal);

        // Wire up team management
        document.getElementById('team-manage-btn')?.addEventListener('click', () => {
            modal.remove();
            this.showTeamModal();
        });

        // Wire up history
        document.getElementById('license-history-btn')?.addEventListener('click', () => {
            modal.remove();
            this.showHistoryModal();
        });

        // Wire up deactivate
        document.getElementById('license-deactivate-btn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('license-deactivate-error');
            const btn   = document.getElementById('license-deactivate-btn');
            btn.textContent = 'Deactivating…';
            btn.disabled = true;
            const result = await window.electronAPI?.licenseDeactivate();
            if (result?.success) {
                modal.remove();
                this._status = await this._fetchStatus();
                this._refreshUI();
            } else {
                btn.textContent = 'Deactivate on this machine';
                btn.disabled = false;
                this._showError(errEl, result?.error || 'Deactivation failed.');
            }
        });
    }

    // ─── Activation form behaviour ───────────────────────────────────
    _wireActivation(modal) {
        const input = document.getElementById('license-key-input');
        const errEl = document.getElementById('license-activate-error');
        const btn   = document.getElementById('license-activate-btn');
        if (!input || !btn) return;

        const normalize = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

        input.addEventListener('input', () => {
            const caret = input.selectionStart;
            input.value = normalize(input.value);
            try { input.setSelectionRange(caret, caret); } catch { /* ignore */ }
            input.classList.remove('invalid');
            errEl?.classList.add('hidden');
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
        });
        document.getElementById('license-paste-btn')?.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) input.value = normalize(text);
            } catch { /* clipboard not available — user can paste manually */ }
            input.focus();
        });
        setTimeout(() => input.focus(), 60);

        btn.addEventListener('click', async () => {
            const key = normalize(input.value);
            if (!key) {
                input.classList.add('invalid');
                input.focus();
                this._showError(errEl, 'Enter your license key.', 0);
                return;
            }

            btn.textContent = 'Activating…';
            btn.disabled = true;
            input.disabled = true;

            const result = window.electronAPI?.licenseActivate
                ? await window.electronAPI.licenseActivate({ key })
                : { success: false, error: 'Activation is only available inside the DynamoOps desktop app.' };

            if (result?.success) {
                this._status = await this._fetchStatus();
                this._refreshUI();
                this._showActivationSuccess(modal, result);
                return;
            }

            btn.textContent = 'Activate license';
            btn.disabled = false;
            input.disabled = false;

            if (result?.code === 'MACHINE_CONFLICT_TRANSFER_REQUIRED') {
                await this._startTransferFlow(modal, key);
                return;
            }
            if (result?.code === 'TRANSFER_LIMIT_EXCEEDED') {
                this._showError(errEl, 'Annual transfer limit reached. Contact suporte@dynamoops.io for help.', 0);
                return;
            }
            input.classList.add('invalid');
            input.focus();
            this._showError(errEl, this._friendlyActivationError(result), 0);
        });
    }

    _friendlyActivationError(result) {
        const raw = String(result?.error || '');
        if (result?.code === 'NETWORK_ERROR' || /network/i.test(raw)) {
            return 'Could not reach dynamoops.io. Check your internet connection and try again.';
        }
        if (/not found/i.test(raw)) {
            return 'We couldn\'t find this key. Check for typos — the key is in your purchase email.';
        }
        if (/not active/i.test(raw)) {
            return 'This license is not active (the subscription was cancelled or payment failed). Contact suporte@dynamoops.io if this is unexpected.';
        }
        return raw || 'Activation failed. Please try again.';
    }

    _showActivationSuccess(modal, result) {
        const box = modal.querySelector('.modal-box');
        if (!box) return;
        const plan = result?.plan || this._status?.plan || 'pro';
        box.innerHTML = `
            <div class="license-success-state">
                <div class="license-success-icon" aria-hidden="true">✓</div>
                <h3>${this._planName(plan)} plan activated</h3>
                <p class="license-modal-sub">
                    ${result?.email ? `Registered to <strong>${this._escape(result.email)}</strong>. ` : ''}
                    Pro features are now unlocked on this machine.
                </p>
                <button type="button" id="license-success-done" class="btn-primary license-activate-main">Start using DynamoOps</button>
            </div>`;
        document.getElementById('license-success-done')?.addEventListener('click', () => modal.remove());
        setTimeout(() => { if (document.body.contains(modal)) modal.remove(); }, 5000);
    }

    async showTeamModal() {
        const existing = document.getElementById('team-modal');
        if (existing) existing.remove();

        const isOwner = this._status?.teamRole === 'owner';

        const modal = document.createElement('div');
        modal.id = 'team-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box team-modal-box">
                <div class="modal-header">
                    <h3>Team Management</h3>
                    <button class="modal-close" id="team-modal-close">&times;</button>
                </div>
                <div id="team-loading" class="team-loading">Loading members…</div>
                <div id="team-content" class="hidden">
                    <div class="team-seats-row">
                        <span>Seats used: <strong id="team-seats-used">—</strong> / <strong id="team-seats-limit">—</strong></span>
                    </div>
                    <div id="team-members-list" class="team-members-list"></div>
                    ${isOwner ? `
                    <div class="team-invite-section">
                        <h4>Invite new member</h4>
                        <div class="team-invite-row">
                            <input type="email" id="team-invite-email" placeholder="colleague@company.com" class="team-invite-input" />
                            <button id="team-invite-btn" class="btn-primary">Invite</button>
                        </div>
                        <div id="team-invite-error" class="license-error hidden"></div>
                        <div id="team-invite-success" class="license-success hidden"></div>
                    </div>
                    ` : `
                    <div class="team-member-hint">
                        Contact your team owner to add or remove members.
                    </div>
                    `}
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        document.getElementById('team-modal-close')?.addEventListener('click', () => modal.remove());

        await this._loadTeamMembers();

        if (isOwner) {
            document.getElementById('team-invite-btn')?.addEventListener('click', async () => {
                const input  = document.getElementById('team-invite-email');
                const errEl  = document.getElementById('team-invite-error');
                const okEl   = document.getElementById('team-invite-success');
                const btn    = document.getElementById('team-invite-btn');
                const email  = input.value.trim().toLowerCase();
                if (!email) { this._showError(errEl, 'Enter an email address.'); return; }

                btn.textContent = 'Sending…';
                btn.disabled = true;
                const result = await window.electronAPI?.teamInvite({ email });
                btn.textContent = 'Invite';
                btn.disabled = false;

                if (result?.success) {
                    input.value = '';
                    okEl.textContent = `✓ Invitation sent to ${email}`;
                    okEl.classList.remove('hidden');
                    setTimeout(() => okEl.classList.add('hidden'), 5000);
                    await this._loadTeamMembers();
                } else {
                    this._showError(errEl, result?.error || 'Failed to send invite.');
                }
            });
        }
    }

    async _loadTeamMembers() {
        const loading = document.getElementById('team-loading');
        const content = document.getElementById('team-content');
        const list    = document.getElementById('team-members-list');
        if (!loading || !content || !list) return;

        const result = await window.electronAPI?.teamListMembers();
        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (!result?.success) {
            list.innerHTML = `<div class="license-error">${result?.error || 'Failed to load members'}</div>`;
            return;
        }

        document.getElementById('team-seats-used').textContent = result.seatsUsed;
        document.getElementById('team-seats-limit').textContent = result.seatsLimit;

        const isOwner = this._status?.teamRole === 'owner';

        list.innerHTML = result.members.map((m) => {
            const roleBadge = m.role === 'owner'
                ? '<span class="team-role-badge team-role-owner">Owner</span>'
                : '<span class="team-role-badge team-role-member">Member</span>';
            const statusBadge = m.activated
                ? '<span class="team-status-badge team-status-active">Active</span>'
                : '<span class="team-status-badge team-status-pending">Pending</span>';
            const removeBtn = (isOwner && m.role !== 'owner')
                ? `<button class="team-remove-btn" data-email="${m.email}" title="Remove member">✕</button>`
                : '';
            const keyLine = (isOwner && m.memberKey)
                ? `<div class="team-member-key" title="Share this key with ${m.email}">${m.memberKey}</div>`
                : '';
            return `
                <div class="team-member-row">
                    <div class="team-member-info">
                        <div class="team-member-email">${this._escape(m.email)}</div>
                        <div class="team-member-meta">${roleBadge} ${statusBadge}</div>
                        ${keyLine}
                    </div>
                    ${removeBtn}
                </div>
            `;
        }).join('');

        if (isOwner) {
            list.querySelectorAll('.team-remove-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const email = btn.dataset.email;
                    if (!confirm(`Remove ${email} from the team?`)) return;
                    btn.disabled = true;
                    const res = await window.electronAPI?.teamRemoveMember({ email });
                    if (res?.success) {
                        await this._loadTeamMembers();
                    } else {
                        btn.disabled = false;
                        alert(res?.error || 'Failed to remove member');
                    }
                });
            });
        }
    }

    async _startTransferFlow(modal, key) {
        // Step 1: ask server to email a code to the owner
        const req = await window.electronAPI?.licenseTransferRequest({ key });
        if (!req?.success) {
            if (req?.code === 'TRANSFER_LIMIT_EXCEEDED') {
                alert('Annual transfer limit reached. Contact suporte@dynamoops.io.');
            } else {
                alert(req?.error || 'Could not start transfer.');
            }
            return;
        }

        // Step 2: replace modal contents with a code input
        const hint = req.emailHint || '';
        const mins = req.expiresInMinutes || 15;
        const body = modal.querySelector('.modal-box');
        if (!body) return;
        body.innerHTML = `
            <div class="modal-header">
                <h3>Confirm Machine Transfer</h3>
                <button class="modal-close" id="license-modal-close">&times;</button>
            </div>
            <div class="license-transfer-section">
                <p class="license-hint">
                    We sent a 6-digit code to <strong>${this._escape(hint)}</strong>.
                    The code expires in ${mins} minutes.
                </p>
                <input type="text"
                       id="license-transfer-code"
                       class="license-transfer-code-input"
                       placeholder="123456"
                       maxlength="6"
                       autocomplete="off" />
                <div class="license-transfer-actions">
                    <button id="license-transfer-submit" class="btn-primary">Confirm transfer</button>
                    <a href="#" id="license-transfer-resend" class="license-transfer-resend-link">Resend email</a>
                </div>
                <div id="license-transfer-error" class="license-error hidden"></div>
            </div>
        `;
        document.getElementById('license-modal-close')?.addEventListener('click', () => modal.remove());

        document.getElementById('license-transfer-submit')?.addEventListener('click', async () => {
            const input = document.getElementById('license-transfer-code');
            const errEl = document.getElementById('license-transfer-error');
            const btn   = document.getElementById('license-transfer-submit');
            const code  = input.value.trim();
            if (!/^\d{6}$/.test(code)) {
                this._showError(errEl, 'Enter the 6-digit code from the email.');
                return;
            }
            btn.textContent = 'Confirming…';
            btn.disabled = true;

            const res = await window.electronAPI?.licenseTransferConfirm({ key, code });
            if (res?.success) {
                modal.remove();
                this._status = await this._fetchStatus();
                this._refreshUI();
                return;
            }

            btn.textContent = 'Confirm transfer';
            btn.disabled = false;
            if (res?.code === 'TRANSFER_LIMIT_EXCEEDED') {
                this._showError(errEl, 'Annual transfer limit reached.');
            } else if (typeof res?.attemptsLeft === 'number') {
                this._showError(
                    errEl,
                    `Invalid code (${res.attemptsLeft} attempts left).`
                );
            } else {
                this._showError(errEl, res?.error || 'Could not confirm transfer.');
            }
        });

        document.getElementById('license-transfer-resend')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await this._startTransferFlow(modal, key);
        });
    }

    async showHistoryModal() {
        document.getElementById('license-history-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'license-history-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box license-history-modal-box">
                <div class="modal-header">
                    <h3>Activation History</h3>
                    <button class="modal-close" id="license-history-close">&times;</button>
                </div>
                <div id="license-history-loading" class="team-loading">Loading…</div>
                <div id="license-history-content" class="hidden"></div>
            </div>
        `;
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        document.getElementById('license-history-close')?.addEventListener('click', () => modal.remove());

        const result = await window.electronAPI?.licenseHistory();
        const loading = document.getElementById('license-history-loading');
        const content = document.getElementById('license-history-content');
        loading?.classList.add('hidden');
        content?.classList.remove('hidden');

        if (!result?.success) {
            content.innerHTML = `<div class="license-error">${this._escape(result?.error || 'Failed to load history')}</div>`;
            return;
        }

        const current = result.current;
        const history = result.history || [];
        const sourceLabels = {
            initial: 'First activation',
            transfer: 'Machine transfer',
            'auto-revoke': 'Auto-released (30d inactive)',
            'deactivate-reactivate': 'Manual deactivation',
        };

        const currentBlock = current
            ? `
                <div class="activation-history-current">
                    <div class="activation-history-label">Current machine</div>
                    <div class="activation-history-row">
                        <div class="activation-history-id">…${this._escape(current.machineSuffix)}</div>
                        <div class="activation-history-dates">
                            Activated: ${current.activatedAt ? new Date(current.activatedAt).toLocaleString() : '—'}<br />
                            Last refresh: ${current.lastRefreshAt ? new Date(current.lastRefreshAt).toLocaleString() : 'never'}
                        </div>
                    </div>
                </div>
            `
            : '';

        const historyBlock = history.length === 0
            ? '<div class="team-member-hint">No past activations yet.</div>'
            : history.slice().reverse().map((ev) => `
                <div class="activation-history-row">
                    <div class="activation-history-id">…${this._escape(ev.machineSuffix)}</div>
                    <div class="activation-history-dates">
                        ${ev.activatedAt ? new Date(ev.activatedAt).toLocaleDateString() : '—'}
                        → ${ev.transferredAt ? new Date(ev.transferredAt).toLocaleDateString() : 'current'}
                    </div>
                    <span class="activation-history-source-badge activation-history-source-${this._escape(ev.source)}">
                        ${this._escape(sourceLabels[ev.source] || ev.source)}
                    </span>
                </div>
            `).join('');

        content.innerHTML = currentBlock + `
            <div class="activation-history-label" style="margin-top:16px;">Previous machines</div>
            ${historyBlock}
        `;
    }

    _escape(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    /** Shows an inline error. hideAfter = 0 keeps it until the next input. */
    _showError(el, msg, hideAfter = 5000) {
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        if (hideAfter > 0) setTimeout(() => el.classList.add('hidden'), hideAfter);
    }
}

window.licenseManager = new LicenseManager();
