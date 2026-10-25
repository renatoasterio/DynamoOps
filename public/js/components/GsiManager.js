import { $, $$ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { getActiveTabConnection } from './TabManager.js';

export function initGsiManager() {
    // Legacy: delete from schema-info bar ✕ button
    document.addEventListener('deleteGsiRequest', async (e) => {
        const { indexName } = e.detail;
        if (confirm(`Delete GSI "${indexName}"?\n\nThis action cannot be undone.`)) {
            await deleteGsi(indexName);
        }
    });

    // Open modal
    $('#indexes-btn')?.addEventListener('click', openModal);

    // Close modal
    $('#indexes-close-btn')?.addEventListener('click', closeModal);
    $('#indexes-overlay')?.addEventListener('click', e => {
        if (e.target === $('#indexes-overlay')) closeModal();
    });

    // Show create form
    $('#indexes-add-btn')?.addEventListener('click', () => {
        showView('create');
        $('#idx-create-name')?.focus();
    });

    // Cancel create
    const cancelCreate = () => showView('list');
    $('#indexes-cancel-create-btn')?.addEventListener('click', cancelCreate);
    $('#indexes-cancel-create-btn2')?.addEventListener('click', cancelCreate);

    // Projection radio toggle
    $('#indexes-overlay')?.querySelectorAll('input[name="idx-proj"]').forEach(r => {
        r.addEventListener('change', () => {
            $('#idx-create-include-wrapper')?.classList.toggle('hidden', r.value !== 'INCLUDE');
        });
    });

    // Submit
    $('#indexes-submit-btn')?.addEventListener('click', handleCreate);
}

// ─── Open/close ───────────────────────────────────────────────────────────────
function openModal() {
    if (!state.currentTable || !state.tableInfo) {
        showToast('Select a table first', 'info');
        return;
    }
    const overlay = $('#indexes-overlay');
    if (!overlay) return;

    $('#indexes-table-name-badge').textContent = state.currentTable;
    renderCards(state.tableInfo);
    showView('list');
    overlay.classList.remove('hidden');
}

function closeModal() {
    $('#indexes-overlay')?.classList.add('hidden');
}

function showView(view) {
    $('#indexes-list-view')  ?.classList.toggle('hidden', view !== 'list');
    $('#indexes-create-view')?.classList.toggle('hidden', view !== 'create');
    if (view === 'create') resetCreateForm();
}

// ─── Render cards ─────────────────────────────────────────────────────────────
function renderCards(table) {
    const container = $('#indexes-cards');
    if (!container) return;

    const attrDefs = table.AttributeDefinitions || [];
    const typeMap  = {};
    attrDefs.forEach(a => { typeMap[a.AttributeName] = a.AttributeType; });

    const cards = [];

    // Primary key
    const pk = table.KeySchema?.find(k => k.KeyType === 'HASH')?.AttributeName;
    const sk = table.KeySchema?.find(k => k.KeyType === 'RANGE')?.AttributeName;
    cards.push(buildCard({
        name: 'Primary Key',
        type: 'PRIMARY',
        status: 'ACTIVE',
        pk, sk, typeMap,
        projection: { ProjectionType: 'ALL' },
        billingMode: table.BillingModeSummary?.BillingMode,
        throughput: table.ProvisionedThroughput,
        sizeBytes: table.TableSizeBytes,
        itemCount: table.ItemCount,
        deletable: false,
    }));

    // LSIs
    (table.LocalSecondaryIndexes || []).forEach(lsi => {
        const lsiPk = lsi.KeySchema?.find(k => k.KeyType === 'HASH')?.AttributeName;
        const lsiSk = lsi.KeySchema?.find(k => k.KeyType === 'RANGE')?.AttributeName;
        cards.push(buildCard({
            name: lsi.IndexName,
            type: 'LSI',
            status: 'ACTIVE',
            pk: lsiPk, sk: lsiSk, typeMap,
            projection: lsi.Projection,
            sizeBytes: lsi.IndexSizeBytes,
            itemCount: lsi.ItemCount,
            deletable: false,
        }));
    });

    // GSIs
    (table.GlobalSecondaryIndexes || []).forEach(gsi => {
        const gsiPk = gsi.KeySchema?.find(k => k.KeyType === 'HASH')?.AttributeName;
        const gsiSk = gsi.KeySchema?.find(k => k.KeyType === 'RANGE')?.AttributeName;
        cards.push(buildCard({
            name: gsi.IndexName,
            type: 'GSI',
            status: gsi.IndexStatus || 'ACTIVE',
            pk: gsiPk, sk: gsiSk, typeMap,
            projection: gsi.Projection,
            billingMode: table.BillingModeSummary?.BillingMode,
            throughput: gsi.ProvisionedThroughput,
            sizeBytes: gsi.IndexSizeBytes,
            itemCount: gsi.ItemCount,
            deletable: true,
        }));
    });

    container.innerHTML = cards.join('');

    // Delete button listeners
    container.querySelectorAll('.idx-card-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const name = btn.dataset.name;
            if (!confirm(`Delete GSI "${name}"?\n\nThis cannot be undone.`)) return;
            btn.disabled = true;
            btn.textContent = 'Deleting…';
            await deleteGsi(name);
            // Refresh cards
            if (state.tableInfo) {
                try {
                    const { table: t } = await api('GET', `/tables/${state.currentTable}`);
                    state.tableInfo = t;
                    renderCards(t);
                } catch { /* silent */ }
            }
        });
    });
}

function buildCard({ name, type, status, pk, sk, typeMap, projection, billingMode, throughput, sizeBytes, itemCount, deletable }) {
    const statusClass = (status || 'ACTIVE').toLowerCase();
    const typeClass   = type.toLowerCase();

    // Keys section
    const pkRow = pk
        ? `<div class="idx-key-row">
            <span class="idx-key-badge pk">PK</span>
            <span class="idx-key-name">${esc(pk)}</span>
            <span class="idx-key-type">${typeMap[pk] || '?'}</span>
           </div>`
        : '';
    const skRow = sk
        ? `<div class="idx-key-row">
            <span class="idx-key-badge sk">SK</span>
            <span class="idx-key-name">${esc(sk)}</span>
            <span class="idx-key-type">${typeMap[sk] || '?'}</span>
           </div>`
        : `<span class="idx-muted">No sort key</span>`;

    // Projection section
    const projType = projection?.ProjectionType || projection?.projectionType || 'ALL';
    const nonKeys  = projection?.NonKeyAttributes || projection?.nonKeyAttributes || [];
    const projHtml = projType === 'INCLUDE' && nonKeys.length
        ? `<span class="idx-value">${esc(projType)}</span>
           <div class="idx-tag-list">${nonKeys.map(a => `<span class="idx-tag">${esc(a)}</span>`).join('')}</div>`
        : `<span class="idx-value">${esc(projType)}</span>`;

    // Throughput / size section
    let metaHtml = '';
    if (billingMode === 'PAY_PER_REQUEST' || !throughput) {
        metaHtml = `<span class="idx-value">On-demand</span>`;
    } else {
        metaHtml = `
            <span class="idx-muted">RCU <strong>${fmtNum(throughput.ReadCapacityUnits ?? throughput.readCapacityUnits)}</strong>
             &nbsp;WCU <strong>${fmtNum(throughput.WriteCapacityUnits ?? throughput.writeCapacityUnits)}</strong></span>`;
    }
    if (sizeBytes != null) metaHtml += `<span class="idx-muted">${fmtBytes(sizeBytes)} · ${fmtNum(itemCount ?? 0)} items</span>`;

    const deleteBtn = deletable
        ? `<button class="idx-card-delete-btn" data-name="${esc(name)}">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
               Delete
           </button>`
        : '';

    return `
        <div class="idx-card">
            <div class="idx-card-header">
                <span class="idx-card-name" title="${esc(name)}">${esc(name)}</span>
                <span class="idx-type-badge ${typeClass}">${type}</span>
                <span class="idx-status-badge ${statusClass}">${status}</span>
                ${deleteBtn}
            </div>
            <div class="idx-card-body">
                <div class="idx-card-section">
                    <span class="idx-section-label">Keys</span>
                    ${pkRow}${skRow}
                </div>
                <div class="idx-card-section">
                    <span class="idx-section-label">Projection</span>
                    ${projHtml}
                </div>
                <div class="idx-card-section">
                    <span class="idx-section-label">Capacity / Size</span>
                    ${metaHtml}
                </div>
            </div>
        </div>`;
}

// ─── Create ───────────────────────────────────────────────────────────────────
async function handleCreate() {
    const errorEl   = $('#indexes-create-error');
    const submitBtn = $('#indexes-submit-btn');

    const indexName  = $('#idx-create-name')?.value.trim();
    const pkName     = $('#idx-create-pk-name')?.value.trim();
    const pkType     = $('#idx-create-pk-type')?.value;
    const skName     = $('#idx-create-sk-name')?.value.trim() || undefined;
    const skType     = $('#idx-create-sk-type')?.value;
    const projection = $('input[name="idx-proj"]:checked')?.value || 'ALL';
    const nonKeyAttrs = ($('#idx-create-non-key')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

    const showErr = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); } };
    errorEl?.classList.add('hidden');

    if (!indexName) return showErr('Index Name is required.');
    if (!pkName)    return showErr('Partition Key is required.');
    if (projection === 'INCLUDE' && !nonKeyAttrs.length)
        return showErr('Specify at least one attribute for INCLUDE projection.');

    const orig = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Creating…';

    try {
        await api('POST', `/tables/${state.currentTable}/gsi`, {
            indexName, pkName, pkType, skName, skType, projection, nonKeyAttrs,
            connection: getActiveTabConnection()
        });
        showToast(`GSI "${indexName}" creation started — may take a few minutes.`, 'success');
        document.dispatchEvent(new CustomEvent('reloadTableInfoRequest'));
        // Reload table info and refresh cards
        try {
            const { table } = await api('GET', `/tables/${state.currentTable}`);
            state.tableInfo = table;
            renderCards(table);
        } catch { /* silent */ }
        showView('list');
    } catch (err) {
        showErr(err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = orig;
    }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
export async function deleteGsi(indexName) {
    if (!state.currentTable) return;
    try {
        await api('DELETE', `/tables/${state.currentTable}/gsi/${encodeURIComponent(indexName)}`, null, {
            connection: getActiveTabConnection()
        });
        showToast(`GSI "${indexName}" deletion started.`, 'warning');
        document.dispatchEvent(new CustomEvent('reloadTableInfoRequest'));
    } catch (err) {
        showToast(`Failed to delete GSI: ${err.message}`, 'error');
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resetCreateForm() {
    ['idx-create-name','idx-create-pk-name','idx-create-sk-name','idx-create-non-key']
        .forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
    const allRadio = $('input[name="idx-proj"][value="ALL"]');
    if (allRadio) allRadio.checked = true;
    $('#idx-create-include-wrapper')?.classList.add('hidden');
    $('#indexes-create-error')?.classList.add('hidden');
}

function fmtNum(n) { return Number(n).toLocaleString(); }

function fmtBytes(b) {
    if (!b) return '0 B';
    const u = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}
