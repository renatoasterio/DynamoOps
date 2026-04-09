/**
 * ChartView.js
 * Adds Chart and Heatmap view modes to the data viewer.
 * All charts are pure SVG — no external libraries.
 */

import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';

// Active chart sub-tab: 'timeline' | 'distribution' | 'heatmap'
let activeChart = 'timeline';

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initChartView() {
    // View mode toggle buttons (chart + heatmap added alongside Table/JSON)
    $('#view-chart-btn')?.addEventListener('click', () => switchView('chart'));

    // Chart sub-tabs
    $('#chart-tab-timeline')?.addEventListener('click',     () => switchChartTab('timeline'));
    $('#chart-tab-distribution')?.addEventListener('click', () => switchChartTab('distribution'));
    $('#chart-tab-heatmap')?.addEventListener('click',      () => switchChartTab('heatmap'));

    // Rebuild when new data is rendered
    document.addEventListener('renderDataRequest', () => {
        if (!$('#chart-view')?.classList.contains('hidden')) renderActiveChart();
    });

    // Field selector changes
    $('#chart-date-field')?.addEventListener('change',   () => renderTimeline());
    $('#chart-num-field')?.addEventListener('change',    () => renderDistribution());
    $('#chart-granularity')?.addEventListener('change',  () => renderTimeline());

    // Re-render charts on resize so bar widths adapt to container
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (!$('#chart-view')?.classList.contains('hidden')) renderActiveChart();
        }, 200);
    });
}

export function switchToChartView() { switchView('chart'); }

// ─── View switching ───────────────────────────────────────────────────────────

function switchView(mode) {
    // Deactivate table/json/chart buttons
    ['view-table-btn', 'view-json-btn', 'view-chart-btn'].forEach(id => {
        $(`#${id}`)?.classList.toggle('active', id === `view-${mode}-btn`);
    });
    // Show/hide panels
    ['table-view', 'json-view', 'chart-view'].forEach(id => {
        $(`#${id}`)?.classList.toggle('hidden', id !== `${mode}-view`);
    });
    if (mode === 'chart') {
        populateFieldSelectors();
        renderActiveChart();
    }
}

function switchChartTab(tab) {
    activeChart = tab;
    ['timeline', 'distribution', 'heatmap'].forEach(t => {
        $(`#chart-tab-${t}`)?.classList.toggle('active', t === tab);
        $(`#chart-panel-${t}`)?.classList.toggle('hidden', t !== tab);
    });
    // Show relevant controls
    $('#chart-date-field')?.classList.toggle('hidden', tab !== 'timeline');
    $('#chart-granularity')?.classList.toggle('hidden', tab !== 'timeline');
    $('#chart-num-field')?.classList.toggle('hidden', tab !== 'distribution');
    renderActiveChart();
}

function renderActiveChart() {
    if (activeChart === 'timeline')     renderTimeline();
    else if (activeChart === 'distribution') renderDistribution();
    else renderHeatmap();
}

// ─── Field detection ──────────────────────────────────────────────────────────

function detectDateFields() {
    if (!state.items?.length) return [];
    const sample = state.items.slice(0, 50);
    return state.allColumns?.filter(col => {
        const vals = sample.map(i => i[col]).filter(Boolean);
        return vals.some(v => {
            if (typeof v !== 'string') return false;
            const d = new Date(v);
            return !isNaN(d) && v.length >= 8;
        });
    }) || [];
}

function detectNumericFields() {
    if (!state.items?.length) return [];
    const sample = state.items.slice(0, 50);
    return state.allColumns?.filter(col => {
        const vals = sample.map(i => i[col]).filter(v => v != null);
        return vals.length > 0 && vals.every(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))));
    }) || [];
}

function populateFieldSelectors() {
    const dateFields = detectDateFields();
    const numFields  = detectNumericFields();

    const dateSelect = $('#chart-date-field');
    const numSelect  = $('#chart-num-field');

    if (dateSelect) {
        dateSelect.innerHTML = dateFields.length
            ? dateFields.map(f => `<option value="${f}">${f}</option>`).join('')
            : '<option value="">No date field found</option>';
    }
    if (numSelect) {
        numSelect.innerHTML = numFields.length
            ? numFields.map(f => `<option value="${f}">${f}</option>`).join('')
            : '<option value="">No numeric field found</option>';
    }
}

// ─── 1. Timeline chart ────────────────────────────────────────────────────────

function renderTimeline() {
    const container = $('#chart-panel-timeline');
    if (!container) return;

    const field       = $('#chart-date-field')?.value;
    const granularity = $('#chart-granularity')?.value || 'day';
    const items       = state.items || [];

    if (!field || !items.length) {
        container.innerHTML = '<div class="chart-empty">Nenhum dado disponível. Execute uma query primeiro.</div>';
        return;
    }

    // Group by granularity bucket
    const buckets = {};
    items.forEach(item => {
        const raw = item[field];
        if (!raw) return;
        const d = new Date(raw);
        if (isNaN(d)) return;
        let key;
        if (granularity === 'hour')  key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}h`;
        else if (granularity === 'month') key = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
        else key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        buckets[key] = (buckets[key] || 0) + 1;
    });

    const entries = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) {
        container.innerHTML = '<div class="chart-empty">Nenhum item com valor válido no campo selecionado.</div>';
        return;
    }

    const cw = container.clientWidth - 40; // subtract padding
    container.innerHTML = `
      <div class="chart-title">Items por ${granularity} · campo: <strong>${field}</strong></div>
      ${barChart(entries, { color: '#6366f1', unit: 'items', containerWidth: cw })}
    `;
}

// ─── 2. Distribution chart ────────────────────────────────────────────────────

function renderDistribution() {
    const container = $('#chart-panel-distribution');
    if (!container) return;

    const field = $('#chart-num-field')?.value;
    const items = state.items || [];

    if (!field || !items.length) {
        container.innerHTML = '<div class="chart-empty">Nenhum dado disponível.</div>';
        return;
    }

    const values = items.map(i => Number(i[field])).filter(v => !isNaN(v));
    if (!values.length) {
        container.innerHTML = '<div class="chart-empty">Nenhum item com valor numérico no campo selecionado.</div>';
        return;
    }

    const min  = Math.min(...values);
    const max  = Math.max(...values);
    const mean = (values.reduce((s, v) => s + v, 0) / values.length).toFixed(2);
    const bins = 12;
    const step = (max - min) / bins || 1;

    const buckets = Array.from({ length: bins }, (_, i) => {
        const lo = min + i * step;
        const hi = lo + step;
        const count = values.filter(v => v >= lo && (i === bins - 1 ? v <= hi : v < hi)).length;
        return [`${lo.toFixed(1)}–${hi.toFixed(1)}`, count];
    });

    const stats = `<div class="chart-stats">
      <span>Min <strong>${min}</strong></span>
      <span>Max <strong>${max}</strong></span>
      <span>Avg <strong>${mean}</strong></span>
      <span>n <strong>${values.length}</strong></span>
    </div>`;

    const cw = container.clientWidth - 40;
    container.innerHTML = `
      <div class="chart-title">Distribuição de <strong>${field}</strong></div>
      ${stats}
      ${barChart(buckets, { color: '#a78bfa', unit: 'items', rotateLabels: true, containerWidth: cw })}
    `;
}

// ─── 3. Partition Heatmap ─────────────────────────────────────────────────────

function renderHeatmap() {
    const container = $('#chart-panel-heatmap');
    if (!container) return;

    const items = state.items || [];
    if (!items.length) {
        container.innerHTML = '<div class="chart-empty">Nenhum dado disponível. Execute uma query primeiro.</div>';
        return;
    }

    // Find PK
    const pkAttr = state.tableInfo?.KeySchema?.find(k => k.KeyType === 'HASH');
    const pkName = pkAttr?.AttributeName;
    if (!pkName) {
        container.innerHTML = '<div class="chart-empty">Partition key não identificada.</div>';
        return;
    }

    // Count per PK value
    const freq = {};
    items.forEach(item => {
        const val = String(item[pkName] ?? '(null)');
        freq[val] = (freq[val] || 0) + 1;
    });

    const entries    = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const totalItems = items.length;
    const topN       = entries.slice(0, 50);
    const maxVal     = topN[0]?.[1] || 1;
    const hot        = topN.filter(([,c]) => c / totalItems > 0.2).length;

    const hotWarning = hot > 0 ? `<div class="heatmap-warning">⚠️ ${hot} partition key${hot > 1 ? 's' : ''} com >20% dos items — possível hot partition</div>` : '';

    const cells = topN.map(([key, count]) => {
        const ratio     = count / maxVal;
        const pct       = ((count / totalItems) * 100).toFixed(1);
        const intensity = Math.round(ratio * 100);
        const bg        = ratio > 0.7 ? `rgba(248,113,113,${0.2 + ratio * 0.6})`
                        : ratio > 0.4 ? `rgba(251,191,36,${0.2 + ratio * 0.5})`
                        :               `rgba(99,102,241,${0.15 + ratio * 0.5})`;
        const textColor = ratio > 0.6 ? '#fff' : 'var(--text-primary)';
        return `<div class="heatmap-cell" style="background:${bg};color:${textColor}" title="${key}: ${count} items (${pct}%)">
          <div class="heatmap-key">${truncate(String(key), 18)}</div>
          <div class="heatmap-count">${count}</div>
          <div class="heatmap-bar" style="width:${intensity}%;background:${ratio > 0.6 ? 'rgba(255,255,255,0.3)' : 'rgba(99,102,241,0.3)'}"></div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="chart-title">Partition Heatmap · <strong>${pkName}</strong> · ${entries.length} valores únicos · ${totalItems} items carregados</div>
      ${hotWarning}
      <div class="heatmap-grid">${cells}</div>
      ${entries.length > 50 ? `<div class="chart-sub">Mostrando top 50 de ${entries.length} valores únicos</div>` : ''}
    `;
}

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function barChart(entries, { color = '#6366f1', unit = '', rotateLabels = false, containerWidth = 0 } = {}) {
    if (!entries.length) return '';

    // Use actual container width (with padding offset) instead of hardcoded 760
    const availW    = (containerWidth || 760) - 60;
    const maxVal    = Math.max(...entries.map(([, v]) => v));
    const barW      = Math.max(18, Math.min(52, Math.floor(availW / entries.length) - 4));
    const svgW      = entries.length * (barW + 4) + 60;
    const svgH      = 220;
    const chartH    = 160;
    const labelH    = 48;
    const padLeft   = 48;

    // Y-axis ticks
    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
        const val = Math.round((maxVal / ticks) * i);
        const y   = svgH - labelH - (i / ticks) * chartH;
        return { val, y };
    });

    const bars = entries.map(([label, val], i) => {
        const bh   = maxVal > 0 ? (val / maxVal) * chartH : 0;
        const x    = padLeft + i * (barW + 4);
        const y    = svgH - labelH - bh;
        const lx   = x + barW / 2;
        const lrot = rotateLabels ? `transform="rotate(-40,${lx},${svgH - labelH + 6})"` : '';
        const anchor = rotateLabels ? 'end' : 'middle';
        const ltext  = truncate(label, rotateLabels ? 12 : 10);
        return `
          <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${color}" fill-opacity="0.8"/>
          ${val > 0 ? `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="${color}">${val}</text>` : ''}
          <text x="${lx}" y="${svgH - labelH + 12}" text-anchor="${anchor}" font-size="10" fill="var(--text-muted)" ${lrot}>${ltext}</text>
        `;
    }).join('');

    const yAxis = yTicks.map(({ val, y }) =>
        `<line x1="${padLeft - 4}" y1="${y}" x2="${padLeft + svgW}" y2="${y}" stroke="var(--border-subtle)" stroke-dasharray="3"/>
         <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${val}</text>`
    ).join('');

    return `<div class="chart-svg-wrap" style="overflow-x:auto">
      <svg width="${Math.max(svgW, 400)}" height="${svgH}" style="display:block">
        ${yAxis}
        ${bars}
        <line x1="${padLeft}" y1="${svgH - labelH}" x2="${padLeft + entries.length * (barW + 4)}" y2="${svgH - labelH}" stroke="var(--border-default)"/>
      </svg>
    </div>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
