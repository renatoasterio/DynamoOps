import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { tableApi } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { saveVersion } from './VersionHistory.js';
import { trackedWrite } from './CostTracker.js';
import { getTemplate, buildTemplateFormHTML, buildItemFromForm } from './ItemTemplateManager.js';
import { escapeHtml } from '../utils/html.js';
import { getKeyNames, extractKey } from '../utils/keySchema.js';

// form vs json mode for new-item modal
let insertMode = 'json'; // 'form' | 'json'

const dom = {
    modalOverlay: $('#modal-overlay'),
    modalTitle: $('#modal-title'),
    modalCloseBtn: $('#modal-close-btn'),
    editorInfo: $('#editor-info'),
    itemEditor: $('#item-editor'),
    editorError: $('#editor-error'),
    modalCancelBtn: $('#modal-cancel-btn'),
    modalSaveBtn: $('#modal-save-btn'),
    
    deleteOverlay: $('#delete-overlay'),
    deleteCloseBtn: $('#delete-close-btn'),
    deletePreview: $('#delete-preview'),
    deleteCancelBtn: $('#delete-cancel-btn'),
    deleteConfirmBtn: $('#delete-confirm-btn'),
    deleteTitle: $('#delete-modal-title'),
    deleteMessage: $('#delete-modal-message'),
    
    addItemBtn: $('#add-item-btn'),
    loadingState: $('#loading-state'),
    emptyState: $('#empty-data-state'),
    dataViewer: $('#data-viewer'),
    tableInfoBar: $('#table-info-bar'),
    tableName: $('#current-table-name'),
    toolbar: $('#toolbar'),
};

export function initItemManager() {
    dom.addItemBtn.addEventListener('click', () => openEditModal(null));
    
    dom.modalCloseBtn.addEventListener('click', closeItemModal);
    dom.modalCancelBtn.addEventListener('click', closeItemModal);
    dom.modalOverlay.addEventListener('click', (e) => {
        if (e.target === dom.modalOverlay) closeItemModal();
    });

    document.addEventListener('openItemModalRequest', (e) => {
        openEditModal(e.detail ? e.detail.item : null);
    });

    document.addEventListener('openDeleteModalRequest', (e) => {
        openDeleteModal(e.detail.item);
    });

    document.addEventListener('openBulkDeleteModalRequest', (e) => {
        openBulkDeleteModal(e.detail.items);
    });

    // Toggle form ↔ JSON in new-item modal
    $('#modal-mode-toggle')?.addEventListener('click', () => {
        insertMode = insertMode === 'form' ? 'json' : 'form';
        refreshNewItemView();
    });

    dom.modalSaveBtn.addEventListener('click', async () => {
        let item;

        // Collect from template form or JSON textarea
        if (insertMode === 'form' && !state.editingItem) {
            item = buildItemFromForm();
            if (!item) {
                dom.editorError.textContent = 'Could not read the form.';
                dom.editorError.classList.remove('hidden');
                return;
            }
        } else {
            try {
                item = JSON.parse(dom.itemEditor.value);
            } catch (err) {
                dom.editorError.textContent = `Invalid JSON: ${err.message}`;
                dom.editorError.classList.remove('hidden');
                return;
            }
        }

        const keyNames = getKeyNames();
        for (const k of keyNames) {
            if (item[k] === undefined || item[k] === '') {
                dom.editorError.textContent = `Key attribute "${k}" is required.`;
                dom.editorError.classList.remove('hidden');
                return;
            }
        }

        try {
            // Save version snapshot before overwriting (only for edits, not new inserts)
            if (state.editingItem) {
                saveVersion(state.currentTable, state.editingItem);
            }
            await trackedWrite(state.currentTable, 'put', 1, () => tableApi('PUT', '/items', { item }));
            showToast(state.editingItem ? 'Item updated successfully' : 'Item created successfully', 'success');
            closeItemModal();
            document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
        } catch (err) {
            dom.editorError.textContent = err.message;
            dom.editorError.classList.remove('hidden');
        }
    });

    dom.deleteCloseBtn.addEventListener('click', closeDeleteModal);
    dom.deleteCancelBtn.addEventListener('click', closeDeleteModal);
    dom.deleteOverlay.addEventListener('click', (e) => {
        if (e.target === dom.deleteOverlay) closeDeleteModal();
    });

    dom.deleteConfirmBtn.addEventListener('click', async () => {
        if (state.deletingTargets) return confirmBulkDelete();
        if (!state.deletingTarget) return;

        const key = extractKey(state.deletingTarget);

        try {
            await trackedWrite(state.currentTable, 'delete', 1, () => tableApi('DELETE', '/items', { key }));
            showToast('Item deleted', 'success');
            closeDeleteModal();
            document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
        } catch (err) {
            showToast(`Delete failed: ${err.message}`, 'error');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeItemModal();
            closeDeleteModal();
        }
    });

}

export function openEditModal(item = null) {
    state.editingItem = item;
    dom.editorError.classList.add('hidden');

    if (item) {
        // Edit existing: always JSON
        insertMode = 'json';
        dom.modalTitle.textContent = 'Edit Item';
        dom.editorInfo.innerHTML = 'Modify the JSON below. Key attributes cannot be changed — to change keys, delete and re-create the item.';
        dom.itemEditor.value = JSON.stringify(item, null, 2);
        _showJsonEditor();
        _hideModeToggle();
    } else {
        // New item: prefer form if template exists
        const tpl = getTemplate(state.currentTable);
        insertMode = tpl ? 'form' : 'json';
        dom.modalTitle.textContent = 'New Item';
        refreshNewItemView();
        _showModeToggle(!!tpl);
    }

    dom.modalOverlay.classList.remove('hidden');
}

function refreshNewItemView() {
    dom.editorError.classList.add('hidden');
    const tpl = getTemplate(state.currentTable);
    const toggle = $('#modal-mode-toggle');
    if (toggle) toggle.textContent = insertMode === 'form' ? '{ } JSON' : '📋 Form';

    if (insertMode === 'form' && tpl) {
        dom.editorInfo.innerHTML = `Template: <strong>${escapeHtml(state.currentTable)}</strong> · ${tpl.length} fields`;
        _showFormEditor(tpl);
    } else {
        const keyNames = getKeyNames();
        // Pre-fill JSON with template defaults if available, else just keys
        let seed = {};
        if (tpl) {
            tpl.forEach(f => { seed[f.name] = f.defaultValue !== undefined ? f.defaultValue : ''; });
        } else {
            keyNames.forEach(k => { seed[k] = ''; });
        }
        dom.editorInfo.innerHTML = `Required keys: <strong>${escapeHtml(keyNames.join(', '))}</strong>`;
        dom.itemEditor.value = JSON.stringify(seed, null, 2);
        _showJsonEditor();
    }
}

function _showJsonEditor() {
    dom.itemEditor.closest?.('.item-editor-wrap')?.classList.remove('hidden');
    dom.itemEditor.classList.remove('hidden');
    $('#template-form-wrap')?.classList.add('hidden');
}

function _showFormEditor(tpl) {
    dom.itemEditor.classList.add('hidden');
    const wrap = $('#template-form-wrap');
    if (wrap) {
        wrap.innerHTML = buildTemplateFormHTML(state.currentTable) || '';
        wrap.classList.remove('hidden');
    }
}

function _showModeToggle(hasTpl) {
    const toggle = $('#modal-mode-toggle');
    if (!toggle) return;
    toggle.classList.toggle('hidden', !hasTpl);
    toggle.textContent = insertMode === 'form' ? '{ } JSON' : '📋 Form';
}

function _hideModeToggle() {
    $('#modal-mode-toggle')?.classList.add('hidden');
}

function closeItemModal() {
    dom.modalOverlay.classList.add('hidden');
    state.editingItem = null;
}

export function openDeleteModal(item) {
    state.deletingTarget = item;
    state.deletingTargets = null;
    dom.deleteTitle.textContent = 'Delete Item';
    dom.deleteMessage.textContent = 'Are you sure you want to delete this item? This action cannot be undone.';
    dom.deleteConfirmBtn.textContent = 'Delete';
    dom.deletePreview.textContent = JSON.stringify(item, null, 2);
    dom.deleteOverlay.classList.remove('hidden');
}

const BULK_PREVIEW_LIMIT = 50;

export function openBulkDeleteModal(items) {
    state.deletingTarget = null;
    state.deletingTargets = items;
    const keys = items.map((item) => extractKey(item));
    const n = items.length;
    dom.deleteTitle.textContent = `Delete ${n} Item${n > 1 ? 's' : ''}`;
    dom.deleteMessage.textContent = `Are you sure you want to delete ${n} item${n > 1 ? 's' : ''}? This action cannot be undone.`;
    dom.deleteConfirmBtn.textContent = `Delete ${n}`;
    let preview = keys.slice(0, BULK_PREVIEW_LIMIT).map(k => JSON.stringify(k)).join('\n');
    if (n > BULK_PREVIEW_LIMIT) preview += `\n… and ${n - BULK_PREVIEW_LIMIT} more`;
    dom.deletePreview.textContent = preview;
    dom.deleteOverlay.classList.remove('hidden');
}

async function confirmBulkDelete() {
    const keys = state.deletingTargets.map((item) => extractKey(item));
    dom.deleteConfirmBtn.disabled = true;
    dom.deleteConfirmBtn.textContent = 'Deleting…';
    try {
        const result = await trackedWrite(state.currentTable, 'batchDelete', (r) => r.deletedCount,
            () => tableApi('POST', '/batch-delete', { keys }));
        if (result.unprocessedKeysCount > 0) {
            showToast(`${result.deletedCount} deleted, ${result.unprocessedKeysCount} not processed (throttled) — try again`, 'error');
        } else {
            showToast(`${result.deletedCount} item${result.deletedCount > 1 ? 's' : ''} deleted`, 'success');
        }
        closeDeleteModal();
        document.dispatchEvent(new CustomEvent('clearRowSelectionRequest'));
        document.dispatchEvent(new CustomEvent('executeQueryRequest', { detail: { isNextPage: false } }));
    } catch (err) {
        showToast(`Delete failed: ${err.message}`, 'error');
        dom.deleteConfirmBtn.textContent = `Delete ${keys.length}`;
    } finally {
        dom.deleteConfirmBtn.disabled = false;
    }
}

function closeDeleteModal() {
    dom.deleteOverlay.classList.add('hidden');
    state.deletingTarget = null;
    state.deletingTargets = null;
}
