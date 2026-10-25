import { $ } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';

// ─── Pricing (on-demand, us-east-1, standard table class) ────────────────────
// The tracker sums the ConsumedCapacity DynamoDB reports per request, so the
// matching billing model is on-demand: $0.125 per million read request units
// and $0.625 per million write request units. Provisioned tables are billed
// per provisioned unit-hour instead, so for them the dollar figure is only a
// relative indicator. Other regions and table classes differ slightly.
const PRICING = {
    RCU: 0.125 / 1_000_000,   // $ per read request unit
    WCU: 0.625 / 1_000_000,   // $ per write request unit
};

// ─── Session state ────────────────────────────────────────────────────────────
const session = {
    startedAt: Date.now(),
    totalRCU: 0,
    totalWCU: 0,
    totalCost: 0,
    queryCount: 0,
    writeCount: 0,
    alertThreshold: null,        // $ cost threshold for alert
    alertFired: false,
    perTable: {},                // { [tableName]: { rcu, wcu, cost, ops } }
    history: [],                 // last 200 operations
};

export function initCostTracker() {
    // Load persisted settings
    const saved = localStorage.getItem('costTracker');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            session.alertThreshold = parsed.alertThreshold ?? null;
        } catch { /* ignore */ }
    }

    _bindUI();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a read operation (scan / query / executeStatement).
 * @param {string} tableName
 * @param {object|null} consumedCapacity  - AWS ConsumedCapacity object
 * @param {string} opType  - 'scan' | 'query' | 'partiql'
 * @param {number} durationMs
 * @param {number} itemCount
 */
export function trackRead(tableName, consumedCapacity, opType, durationMs, itemCount) {
    const rcu = consumedCapacity?.CapacityUnits ?? 0;
    const cost = rcu * PRICING.RCU;
    _record({ tableName, opType, rcu, wcu: 0, cost, durationMs, itemCount, ts: Date.now() });
    session.totalRCU += rcu;
    session.totalCost += cost;
    session.queryCount++;
    _updateTable(tableName, rcu, 0, cost);
    _checkThreshold();
    _refreshPanel();
    return { rcu, cost };
}

/**
 * Record a write operation (put / delete / batchWrite).
 * @param {string} tableName
 * @param {object|null} consumedCapacity
 * @param {string} opType  - 'put' | 'delete' | 'batchWrite'
 * @param {number} durationMs
 * @param {number} itemCount
 */
export function trackWrite(tableName, consumedCapacity, opType, durationMs, itemCount) {
    const wcu = consumedCapacity?.CapacityUnits ?? 0;
    const cost = wcu * PRICING.WCU;
    _record({ tableName, opType, rcu: 0, wcu, cost, durationMs, itemCount, ts: Date.now() });
    session.totalWCU += wcu;
    session.totalCost += cost;
    session.writeCount++;
    _updateTable(tableName, 0, wcu, cost);
    _checkThreshold();
    _refreshPanel();
    return { wcu, cost };
}

/** Returns session summary object. */
export function getSessionSummary() {
    return {
        totalRCU: session.totalRCU,
        totalWCU: session.totalWCU,
        totalCost: session.totalCost,
        queryCount: session.queryCount,
        writeCount: session.writeCount,
        durationMin: ((Date.now() - session.startedAt) / 60000).toFixed(1),
    };
}

/** Format cost for display in the result bar. e.g. "$0.000054" */
export function fmtCost(cost) {
    if (!cost || cost === 0) return '$0';
    if (cost < 0.000001) return `$${cost.toExponential(2)}`;
    if (cost < 0.01)    return `$${cost.toFixed(6)}`;
    return `$${cost.toFixed(4)}`;
}

/** Format RCU/WCU for display. */
export function fmtCU(cu) {
    return Number(cu || 0).toFixed(1);
}

export function resetSession() {
    session.startedAt = Date.now();
    session.totalRCU = 0;
    session.totalWCU = 0;
    session.totalCost = 0;
    session.queryCount = 0;
    session.writeCount = 0;
    session.alertFired = false;
    session.perTable = {};
    session.history = [];
    _refreshPanel();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _record(entry) {
    session.history.unshift(entry);
    if (session.history.length > 200) session.history.pop();
}

function _updateTable(tableName, rcu, wcu, cost) {
    if (!session.perTable[tableName]) {
        session.perTable[tableName] = { rcu: 0, wcu: 0, cost: 0, ops: 0 };
    }
    session.perTable[tableName].rcu  += rcu;
    session.perTable[tableName].wcu  += wcu;
    session.perTable[tableName].cost += cost;
    session.perTable[tableName].ops++;
}

function _checkThreshold() {
    if (session.alertThreshold && !session.alertFired && session.totalCost >= session.alertThreshold) {
        session.alertFired = true;
        showToast(`Cost alert: session cost reached ${fmtCost(session.totalCost)} (threshold: ${fmtCost(session.alertThreshold)})`, 'warning');
    }
}

// ─── Panel rendering ──────────────────────────────────────────────────────────

function _bindUI() {
    $('#cost-panel-btn')?.addEventListener('click', () => {
        const panel = $('#cost-analytics-panel');
        if (!panel) return;
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !isHidden);
        if (!isHidden) return;
        _refreshPanel();
    });

    $('#cost-panel-close')?.addEventListener('click', () => {
        $('#cost-analytics-panel')?.classList.add('hidden');
    });

    $('#cost-reset-btn')?.addEventListener('click', () => {
        if (confirm('Reset session cost statistics?')) resetSession();
    });

    $('#cost-threshold-btn')?.addEventListener('click', () => {
        const input = $('#cost-threshold-input');
        const val = parseFloat(input?.value);
        if (isNaN(val) || val <= 0) {
            showToast('Enter a valid threshold amount in USD', 'error');
            return;
        }
        session.alertThreshold = val;
        session.alertFired = false;
        localStorage.setItem('costTracker', JSON.stringify({ alertThreshold: val }));
        showToast(`Cost alert set at ${fmtCost(val)}`, 'success');
    });

    $('#cost-threshold-clear')?.addEventListener('click', () => {
        session.alertThreshold = null;
        session.alertFired = false;
        const input = $('#cost-threshold-input');
        if (input) input.value = '';
        localStorage.removeItem('costTracker');
        showToast('Cost alert cleared', 'info');
        _refreshPanel();
    });
}

function _refreshPanel() {
    _refreshSummaryBar();

    const panel = $('#cost-analytics-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    _renderSessionSummary();
    _renderPerTableBreakdown();
    _renderHistory();
    _renderThresholdSection();
}

function _refreshSummaryBar() {
    const bar = $('#cost-session-bar');
    if (!bar) return;
    const { totalRCU, totalWCU, totalCost, queryCount, writeCount } = session;
    bar.innerHTML = `
        <span class="cost-bar-item" title="Total Read Capacity Units this session">
            <span class="cost-bar-icon">📖</span> ${fmtCU(totalRCU)} RCU
        </span>
        <span class="cost-bar-sep">·</span>
        <span class="cost-bar-item" title="Total Write Capacity Units this session">
            <span class="cost-bar-icon">✏️</span> ${fmtCU(totalWCU)} WCU
        </span>
        <span class="cost-bar-sep">·</span>
        <span class="cost-bar-item cost-bar-total" title="Estimated session cost">
            💰 ${fmtCost(totalCost)}
        </span>
        <span class="cost-bar-sep">·</span>
        <span class="cost-bar-item cost-bar-ops" title="${queryCount} reads · ${writeCount} writes">
            ${queryCount + writeCount} ops
        </span>`;
}

function _renderSessionSummary() {
    const el = $('#cost-session-summary');
    if (!el) return;
    const { totalRCU, totalWCU, totalCost, queryCount, writeCount, durationMin } = getSessionSummary();
    el.innerHTML = `
        <div class="cost-stat-grid">
            <div class="cost-stat-card">
                <div class="cost-stat-value">${fmtCU(totalRCU)}</div>
                <div class="cost-stat-label">Total RCU</div>
            </div>
            <div class="cost-stat-card">
                <div class="cost-stat-value">${fmtCU(totalWCU)}</div>
                <div class="cost-stat-label">Total WCU</div>
            </div>
            <div class="cost-stat-card cost-stat-highlight">
                <div class="cost-stat-value">${fmtCost(totalCost)}</div>
                <div class="cost-stat-label">Session Cost</div>
            </div>
            <div class="cost-stat-card">
                <div class="cost-stat-value">${queryCount}</div>
                <div class="cost-stat-label">Read Ops</div>
            </div>
            <div class="cost-stat-card">
                <div class="cost-stat-value">${writeCount}</div>
                <div class="cost-stat-label">Write Ops</div>
            </div>
            <div class="cost-stat-card">
                <div class="cost-stat-value">${durationMin}m</div>
                <div class="cost-stat-label">Session Time</div>
            </div>
        </div>`;
}

function _renderPerTableBreakdown() {
    const el = $('#cost-per-table');
    if (!el) return;
    const tables = Object.entries(session.perTable)
        .sort((a, b) => b[1].cost - a[1].cost);

    if (!tables.length) {
        el.innerHTML = '<p class="cost-empty">No operations recorded yet.</p>';
        return;
    }

    const maxCost = tables[0][1].cost || 1;
    el.innerHTML = tables.map(([name, stats]) => `
        <div class="cost-table-row">
            <div class="cost-table-name" title="${_esc(name)}">${_esc(name)}</div>
            <div class="cost-table-bar-wrap">
                <div class="cost-table-bar" style="width:${Math.max(2, (stats.cost / maxCost) * 100).toFixed(1)}%"></div>
            </div>
            <div class="cost-table-stats">
                <span title="Estimated cost">${fmtCost(stats.cost)}</span>
                <span class="cost-table-cu" title="RCU / WCU">${fmtCU(stats.rcu)} RCU · ${fmtCU(stats.wcu)} WCU</span>
                <span class="cost-table-ops">${stats.ops} ops</span>
            </div>
        </div>`).join('');
}

function _renderHistory() {
    const el = $('#cost-history');
    if (!el) return;
    if (!session.history.length) {
        el.innerHTML = '<p class="cost-empty">No operations recorded yet.</p>';
        return;
    }

    const opIcon = { scan: '🔍', query: '🔎', partiql: '📋', put: '✏️', delete: '🗑️', batchWrite: '📦' };
    el.innerHTML = `
        <table class="cost-history-table">
            <thead>
                <tr>
                    <th>Op</th>
                    <th>Table</th>
                    <th>CU</th>
                    <th>Cost</th>
                    <th>Items</th>
                    <th>ms</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                ${session.history.slice(0, 50).map(e => {
                    const cu = e.rcu > 0 ? `${fmtCU(e.rcu)} R` : `${fmtCU(e.wcu)} W`;
                    const time = new Date(e.ts).toLocaleTimeString();
                    return `<tr>
                        <td><span class="cost-op-badge cost-op-${e.opType}">${opIcon[e.opType] || '⚡'} ${e.opType}</span></td>
                        <td class="cost-tbl-name" title="${_esc(e.tableName)}">${_esc(e.tableName)}</td>
                        <td class="cost-cu-cell">${cu}</td>
                        <td class="cost-cost-cell">${fmtCost(e.cost)}</td>
                        <td>${e.itemCount ?? '—'}</td>
                        <td>${e.durationMs ? Math.round(e.durationMs) : '—'}</td>
                        <td class="cost-time">${time}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

function _renderThresholdSection() {
    const input = $('#cost-threshold-input');
    if (input && session.alertThreshold) {
        input.value = session.alertThreshold;
    }
    const statusEl = $('#cost-threshold-status');
    if (statusEl) {
        if (session.alertThreshold) {
            statusEl.textContent = `Alert set at ${fmtCost(session.alertThreshold)}${session.alertFired ? ' · FIRED' : ''}`;
            statusEl.className = session.alertFired ? 'cost-threshold-status fired' : 'cost-threshold-status active';
        } else {
            statusEl.textContent = 'No alert set';
            statusEl.className = 'cost-threshold-status';
        }
    }
}

function _esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}
