import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { getActiveTabConnection } from './TabManager.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString();
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusColor(s) {
    if (s === 'ACTIVE') return '#34d399';
    if (s === 'CREATING' || s === 'UPDATING') return '#fbbf24';
    return '#f87171';
}

// ─── SVG Sparkline chart ───────────────────────────────────────────────────────

function sparkline(points, { color = '#6366f1', width = 260, height = 50, fill = true } = {}) {
    if (!points || points.length === 0) {
        return `<svg width="${width}" height="${height}"><text x="${width/2}" y="${height/2}" text-anchor="middle" font-size="11" fill="#555">No data</text></svg>`;
    }
    const vals  = points.map(p => p.v);
    const times = points.map(p => new Date(p.t).getTime());
    const minV  = Math.min(...vals);
    const maxV  = Math.max(...vals);
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const pad   = 4;

    const sx = maxT === minT ? () => width / 2 : (t) => pad + ((new Date(t) - minT) / (maxT - minT)) * (width - pad * 2);
    const sy = maxV === minV ? () => height / 2 : (v) => pad + (1 - (v - minV) / (maxV - minV)) * (height - pad * 2);

    const pts = points.map(p => `${sx(p.t)},${sy(p.v)}`).join(' ');
    const fillPath = fill ? `<polygon points="${sx(points[0].t)},${height} ${pts} ${sx(points[points.length-1].t)},${height}" fill="${color}" fill-opacity="0.12"/>` : '';

    return `<svg width="${width}" height="${height}" style="overflow:visible">
      ${fillPath}
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
      ${points.map(p => `<circle cx="${sx(p.t)}" cy="${sy(p.v)}" r="2.5" fill="${color}"/>`).join('')}
    </svg>`;
}

// ─── Alarm badge ──────────────────────────────────────────────────────────────

function alarmBadge(a) {
    const colors = { OK: '#34d399', ALARM: '#f87171', INSUFFICIENT_DATA: '#fbbf24' };
    const c = colors[a.state] || '#888';
    return `<div class="dash-alarm-item">
      <span class="dash-alarm-dot" style="background:${c}"></span>
      <span class="dash-alarm-name">${a.name}</span>
      <span class="dash-alarm-state" style="color:${c}">${a.state}</span>
    </div>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────

function renderDashboard(data) {
    const panel = $('#dashboard-panel');
    if (!panel) return;

    const billing = data.billingMode === 'PAY_PER_REQUEST' ? 'On-Demand' : 'Provisioned';
    const hasStream = data.streamEnabled;

    panel.querySelector('.dash-body').innerHTML = `
      <!-- ── Stats grid ── -->
      <div class="dash-section">
        <div class="dash-stats-grid">
          <div class="dash-stat">
            <div class="dash-stat-label">Status</div>
            <div class="dash-stat-value" style="color:${statusColor(data.status)}">${data.status}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Item Count</div>
            <div class="dash-stat-value">${fmtNum(data.itemCount)}</div>
            <div class="dash-stat-sub">estimated</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Table Size</div>
            <div class="dash-stat-value">${fmtBytes(data.sizeBytes)}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Billing</div>
            <div class="dash-stat-value">${billing}</div>
          </div>
          ${billing === 'Provisioned' ? `
          <div class="dash-stat">
            <div class="dash-stat-label">Prov. RCU</div>
            <div class="dash-stat-value">${fmtNum(data.throughput.read)}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Prov. WCU</div>
            <div class="dash-stat-value">${fmtNum(data.throughput.write)}</div>
          </div>` : ''}
          <div class="dash-stat">
            <div class="dash-stat-label">GSIs</div>
            <div class="dash-stat-value">${data.gsiCount}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">LSIs</div>
            <div class="dash-stat-value">${data.lsiCount}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Streams</div>
            <div class="dash-stat-value" style="color:${hasStream ? '#34d399' : '#888'}">${hasStream ? 'ON' : 'OFF'}</div>
          </div>
          <div class="dash-stat">
            <div class="dash-stat-label">Replicas</div>
            <div class="dash-stat-value">${data.replicaCount || 0}</div>
          </div>
          <div class="dash-stat dash-stat-wide">
            <div class="dash-stat-label">Created</div>
            <div class="dash-stat-value">${fmtDate(data.createdAt)}</div>
          </div>
        </div>
      </div>

      <!-- ── Key Schema ── -->
      <div class="dash-section">
        <div class="dash-section-title">Key Schema</div>
        <div class="dash-key-schema">
          ${(data.keySchema || []).map(k => {
              const attr = (data.attributes || []).find(a => a.AttributeName === k.AttributeName);
              const typeLabel = { S: 'String', N: 'Number', B: 'Binary' }[attr?.AttributeType] || attr?.AttributeType || '?';
              const roleLabel = k.KeyType === 'HASH' ? 'Partition Key' : 'Sort Key';
              const roleColor = k.KeyType === 'HASH' ? '#6366f1' : '#a78bfa';
              return `<div class="dash-key-item">
                <span class="dash-key-name">${k.AttributeName}</span>
                <span class="dash-key-type">${typeLabel}</span>
                <span class="dash-key-role" style="color:${roleColor}">${roleLabel}</span>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ── CloudWatch Metrics ── -->
      ${data.cwMetrics ? `
      <div class="dash-section">
        <div class="dash-section-title">CloudWatch — last 24 h</div>
        <div class="dash-charts">
          ${cwChart('Consumed RCU', data.cwMetrics.rcu, '#6366f1')}
          ${cwChart('Consumed WCU', data.cwMetrics.wcu, '#a78bfa')}
          ${cwChart('Latency (ms)', data.cwMetrics.latency, '#34d399')}
          ${cwChart('Read Throttles', data.cwMetrics.throttledReads, '#f87171')}
          ${cwChart('Write Throttles', data.cwMetrics.throttledWrites, '#fb923c')}
        </div>
      </div>` : `
      <div class="dash-section">
        <div class="dash-section-title">CloudWatch</div>
        <div class="dash-no-cw">CloudWatch metrics unavailable for this endpoint.<br>Connect to a real AWS region to see live metrics.</div>
      </div>`}

      <!-- ── Alarms ── -->
      ${data.alarms?.length ? `
      <div class="dash-section">
        <div class="dash-section-title">Active Alarms</div>
        <div class="dash-alarms">${data.alarms.map(alarmBadge).join('')}</div>
      </div>` : ''}
    `;
}

function cwChart(label, points, color) {
    const total = points.reduce((s, p) => s + p.v, 0);
    const avg   = points.length ? (total / points.length).toFixed(1) : 0;
    return `<div class="dash-chart-card">
      <div class="dash-chart-label">${label}</div>
      <div class="dash-chart-total">${Number(total.toFixed(1)).toLocaleString()} <span class="dash-chart-avg">avg ${avg}/h</span></div>
      ${sparkline(points, { color, width: 200, height: 44 })}
    </div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initTableDashboard() {
    $('#dashboard-btn')?.addEventListener('click', openDashboard);
    $('#dashboard-close-btn')?.addEventListener('click', closeDashboard);
    $('#dashboard-refresh-btn')?.addEventListener('click', loadDashboard);
}

function openDashboard() {
    if (!state.currentTable) { showToast('Selecione uma tabela primeiro', 'info'); return; }
    const panel = $('#dashboard-panel');
    if (!panel) return;
    panel.querySelector('.dash-table-name').textContent = state.currentTable;
    panel.classList.remove('hidden');
    loadDashboard();
}

function closeDashboard() {
    $('#dashboard-panel')?.classList.add('hidden');
}

async function loadDashboard() {
    const panel = $('#dashboard-panel');
    if (!panel) return;

    const body = panel.querySelector('.dash-body');
    body.innerHTML = '<div class="dash-loading">⏳ Carregando métricas…</div>';

    try {
        const connection = getActiveTabConnection();
        const data = await api('GET', `/tables/${state.currentTable}/dashboard`, null, { connection });
        renderDashboard(data);
    } catch (err) {
        body.innerHTML = `<div class="dash-error">Erro ao carregar métricas: ${err.message}</div>`;
        showToast('Falha ao carregar dashboard', 'error');
    }
}
