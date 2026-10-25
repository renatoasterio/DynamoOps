/**
 * ItemTemplateManager.js
 * Per-table item templates stored in localStorage.
 * A template is a list of field definitions used to generate a structured
 * insert form instead of a raw JSON textarea.
 */

import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { showToast } from '../utils/toast.js';

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = (tableName) => `dynamo_template_${tableName}`;

export function getTemplate(tableName) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY(tableName));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveTemplate(tableName, fields) {
    localStorage.setItem(STORAGE_KEY(tableName), JSON.stringify(fields));
}

function deleteTemplate(tableName) {
    localStorage.removeItem(STORAGE_KEY(tableName));
}

// ─── Build a JSON object from template + form values ─────────────────────────

export function buildItemFromForm() {
    const form = $('#template-form');
    if (!form) return null;
    const item = {};
    form.querySelectorAll('.tpl-field-row').forEach(row => {
        const name = row.dataset.fieldName;
        const type = row.dataset.fieldType;
        const input = row.querySelector('.tpl-field-input');
        if (!name || !input) return;
        const raw = input.value;
        if (raw === '' && !row.dataset.required) return;
        item[name] = castValue(raw, type);
    });
    return item;
}

function castValue(raw, type) {
    if (type === 'N')    return raw === '' ? 0 : Number(raw);
    if (type === 'BOOL') return raw === 'true';
    if (type === 'NULL') return null;
    if (type === 'L')    { try { return JSON.parse(raw); } catch { return []; } }
    if (type === 'M')    { try { return JSON.parse(raw); } catch { return {}; } }
    return raw; // S / default
}

// ─── Template editor modal ────────────────────────────────────────────────────

let editingFields = [];

export function initItemTemplateManager() {
    $('#template-btn')?.addEventListener('click', openTemplateEditor);
    $('#template-editor-close')?.addEventListener('click', closeTemplateEditor);
    $('#template-editor-overlay')?.addEventListener('click', e => {
        if (e.target === $('#template-editor-overlay')) closeTemplateEditor();
    });

    $('#template-add-field-btn')?.addEventListener('click', () => {
        editingFields.push({ name: '', type: 'S', required: false, defaultValue: '' });
        renderFieldRows();
    });

    $('#template-save-btn')?.addEventListener('click', () => {
        const cleaned = editingFields.filter(f => f.name.trim());
        if (!cleaned.length) {
            deleteTemplate(state.currentTable);
            showToast('Template removed', 'info');
        } else {
            saveTemplate(state.currentTable, cleaned);
            showToast(`Template saved with ${cleaned.length} fields`, 'success');
        }
        closeTemplateEditor();
        document.dispatchEvent(new CustomEvent('templateChanged'));
    });

    $('#template-delete-btn')?.addEventListener('click', () => {
        deleteTemplate(state.currentTable);
        showToast('Template removed', 'info');
        closeTemplateEditor();
        document.dispatchEvent(new CustomEvent('templateChanged'));
    });

    // Listen for table changes to update template button badge
    document.addEventListener('tabChanged', updateTemplateBadge);
    document.addEventListener('templateChanged', updateTemplateBadge);
}

function openTemplateEditor() {
    if (!state.currentTable) { showToast('Select a table first', 'info'); return; }
    const overlay = $('#template-editor-overlay');
    if (!overlay) return;

    overlay.querySelector('.tpl-table-name').textContent = state.currentTable;

    // Load existing template or seed from key schema
    const existing = getTemplate(state.currentTable);
    if (existing) {
        editingFields = JSON.parse(JSON.stringify(existing));
    } else {
        // Pre-seed from key schema
        editingFields = [];
        const schema = state.tableInfo?.KeySchema || [];
        const defs   = state.tableInfo?.AttributeDefinitions || [];
        schema.forEach(k => {
            const attr = defs.find(a => a.AttributeName === k.AttributeName);
            editingFields.push({
                name: k.AttributeName,
                type: attr?.AttributeType || 'S',
                required: true,
                defaultValue: '',
                isKey: true,
            });
        });
    }

    renderFieldRows();
    overlay.classList.remove('hidden');
}

function closeTemplateEditor() {
    $('#template-editor-overlay')?.classList.add('hidden');
}

function renderFieldRows() {
    const container = $('#template-fields-list');
    if (!container) return;

    container.innerHTML = editingFields.length === 0
        ? '<div class="tpl-empty-hint">No fields defined. Click "＋ Add Field" to get started.</div>'
        : editingFields.map((f, i) => fieldRowHTML(f, i)).join('');

    // Bind row events
    container.querySelectorAll('.tpl-field-row').forEach((row, i) => {
        row.querySelector('.tpl-fname')?.addEventListener('input', e => {
            editingFields[i].name = e.target.value;
        });
        row.querySelector('.tpl-ftype')?.addEventListener('change', e => {
            editingFields[i].type = e.target.value;
            // Re-render only this row's default input
            const defInput = row.querySelector('.tpl-fdefault');
            if (defInput) defInput.outerHTML = defaultInputHTML(editingFields[i]);
        });
        row.querySelector('.tpl-frequired')?.addEventListener('change', e => {
            editingFields[i].required = e.target.checked;
        });
        row.querySelector('.tpl-fdefault')?.addEventListener('input', e => {
            editingFields[i].defaultValue = e.target.value;
        });
        row.querySelector('.tpl-remove-btn')?.addEventListener('click', () => {
            editingFields.splice(i, 1);
            renderFieldRows();
        });
        // Drag reorder
        row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', i); });
        row.addEventListener('dragover',  e => e.preventDefault());
        row.addEventListener('drop',      e => {
            const from = parseInt(e.dataTransfer.getData('text/plain'));
            const [moved] = editingFields.splice(from, 1);
            editingFields.splice(i, 0, moved);
            renderFieldRows();
        });
    });
}

function fieldRowHTML(f, i) {
    const typeOptions = ['S', 'N', 'BOOL', 'NULL', 'L', 'M'].map(t =>
        `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    return `<div class="tpl-field-row ${f.isKey ? 'tpl-key-row' : ''}" draggable="true">
      <span class="tpl-drag-handle" title="Drag to reorder">⠿</span>
      <input class="tpl-fname" type="text" placeholder="field name" value="${escHtml(f.name)}" ${f.isKey ? 'readonly' : ''}/>
      <select class="tpl-ftype" ${f.isKey ? 'disabled' : ''}>${typeOptions}</select>
      ${defaultInputHTML(f)}
      <label class="tpl-req-label" title="Required field">
        <input class="tpl-frequired" type="checkbox" ${f.required ? 'checked' : ''}/>
        <span>Req</span>
      </label>
      ${f.isKey ? '<span class="tpl-key-badge">KEY</span>' : `<button class="tpl-remove-btn" title="Remove field">✕</button>`}
    </div>`;
}

function defaultInputHTML(f) {
    if (f.type === 'BOOL') {
        return `<select class="tpl-fdefault">
          <option value="" ${!f.defaultValue ? 'selected' : ''}>—</option>
          <option value="true"  ${ f.defaultValue === 'true'  ? 'selected' : ''}>true</option>
          <option value="false" ${ f.defaultValue === 'false' ? 'selected' : ''}>false</option>
        </select>`;
    }
    if (f.type === 'NULL') return `<input class="tpl-fdefault" type="text" placeholder="null" disabled value=""/>`;
    return `<input class="tpl-fdefault" type="text" placeholder="default" value="${escHtml(f.defaultValue || '')}"/>`;
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ─── Template insert form (rendered inside item modal) ────────────────────────

export function buildTemplateFormHTML(tableName) {
    const tpl = getTemplate(tableName);
    if (!tpl?.length) return null;

    const rows = tpl.map(f => {
        const required = f.required ? '<span class="tpl-req-star">*</span>' : '';
        const typeLabel = { S: 'String', N: 'Number', BOOL: 'Boolean', NULL: 'Null', L: 'List', M: 'Map' }[f.type] || f.type;
        let input;
        if (f.type === 'BOOL') {
            input = `<select class="tpl-field-input form-input" data-name="${escHtml(f.name)}" data-type="BOOL">
              <option value="">—</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>`;
        } else if (f.type === 'NULL') {
            input = `<input class="tpl-field-input form-input" type="text" data-name="${escHtml(f.name)}" data-type="NULL" value="null" disabled/>`;
        } else {
            const ph = f.type === 'L' ? '["value1","value2"]' : f.type === 'M' ? '{"key":"value"}' : (f.defaultValue || '');
            input = `<input class="tpl-field-input form-input" type="${f.type === 'N' ? 'number' : 'text'}"
              data-name="${escHtml(f.name)}" data-type="${f.type}"
              placeholder="${escHtml(ph)}" value="${escHtml(f.defaultValue || '')}"/>`;
        }
        return `<div class="tpl-field-row" data-field-name="${escHtml(f.name)}" data-field-type="${f.type}" ${f.required ? 'data-required="1"' : ''}>
          <label class="tpl-form-label">${escHtml(f.name)} ${required}<span class="tpl-form-type">${typeLabel}</span></label>
          ${input}
        </div>`;
    }).join('');

    return `<div id="template-form" class="template-form">${rows}</div>`;
}

// ─── Badge on template button ─────────────────────────────────────────────────

function updateTemplateBadge() {
    const btn = $('#template-btn');
    if (!btn) return;
    const tpl = state.currentTable ? getTemplate(state.currentTable) : null;
    btn.classList.toggle('template-btn-active', !!(tpl?.length));
    const badge = btn.querySelector('.tpl-badge');
    if (badge) badge.textContent = tpl?.length ? tpl.length : '';
}

export { updateTemplateBadge };
