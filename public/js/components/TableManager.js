import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { connectedApi, tableApi } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { resetDataViewer } from './DataViewer.js';
import { executeQuery } from './QueryPanel.js';
import { loadTables } from './Sidebar.js';

const dom = {
    // Top buttons
    createTableBtn: $('#create-table-btn'),
    deleteTableBtn: $('#delete-table-btn'),
    truncateTableBtn: $('#truncate-table-btn'),
    
    // Create Table Modal
    createTableOverlay: $('#create-table-overlay'),
    createTableCloseBtn: $('#create-table-close-btn'),
    ctTableName: $('#ct-table-name'),
    ctPkName: $('#ct-pk-name'),
    ctPkType: $('#ct-pk-type'),
    ctSkName: $('#ct-sk-name'),
    ctSkType: $('#ct-sk-type'),
    ctError: $('#ct-error'),
    ctCancelBtn: $('#ct-cancel-btn'),
    ctSubmitBtn: $('#ct-submit-btn'),
    
    // Delete Table Modal
    deleteTableOverlay: $('#delete-table-overlay'),
    deleteTableCloseBtn: $('#delete-table-close-btn'),
    dtTableNamePreview: $('#dt-table-name-preview'),
    dtConfirmName: $('#dt-confirm-name'),
    dtError: $('#dt-error'),
    dtCancelBtn: $('#dt-cancel-btn'),
    dtConfirmBtn: $('#dt-confirm-btn'),
    
    // Truncate Table Modal
    truncateTableOverlay: $('#truncate-table-overlay'),
    truncateTableCloseBtn: $('#truncate-table-close-btn'),
    ttTableNamePreview: $('#tt-table-name-preview'),
    ttConfirmName: $('#tt-confirm-name'),
    ttDeletedCount: $('#tt-deleted-count'),
    ttProgress: $('#tt-progress'),
    ttError: $('#tt-error'),
    ttCancelBtn: $('#tt-cancel-btn'),
    ttConfirmBtn: $('#tt-confirm-btn'),
};

export function initTableManager() {
    // ─── Create Table
    function openCreateTableModal() {
        dom.ctError.classList.add('hidden');
        dom.ctTableName.value = '';
        dom.ctPkName.value = '';
        dom.ctPkType.value = 'S';
        dom.ctSkName.value = '';
        dom.ctSkType.value = 'S';
        dom.createTableOverlay.classList.remove('hidden');
        dom.ctTableName.focus();
    }
    
    function closeCreateTableModal() {
        dom.createTableOverlay.classList.add('hidden');
    }

    dom.createTableBtn.addEventListener('click', openCreateTableModal);
    dom.createTableCloseBtn.addEventListener('click', closeCreateTableModal);
    dom.ctCancelBtn.addEventListener('click', closeCreateTableModal);

    dom.ctSubmitBtn.addEventListener('click', async () => {
        const TableName = dom.ctTableName.value.trim();
        const PartitionKeyName = dom.ctPkName.value.trim();
        const PartitionKeyType = dom.ctPkType.value;
        const SortKeyName = dom.ctSkName.value.trim();
        const SortKeyType = dom.ctSkType.value;

        if (!TableName || !PartitionKeyName) {
            dom.ctError.textContent = 'Table Name and Partition Key are required.';
            dom.ctError.classList.remove('hidden');
            return;
        }

        dom.ctSubmitBtn.disabled = true;
        dom.ctSubmitBtn.textContent = 'Creating…';
        dom.ctError.classList.add('hidden');

        try {
            await connectedApi('POST', '/tables', { TableName, PartitionKeyName, PartitionKeyType, SortKeyName, SortKeyType });
            showToast(`Creating table ${TableName}...`, 'success');
            closeCreateTableModal();
            setTimeout(loadTables, 1500);
        } catch (err) {
            dom.ctError.textContent = err.message;
            dom.ctError.classList.remove('hidden');
        } finally {
            dom.ctSubmitBtn.disabled = false;
            dom.ctSubmitBtn.textContent = 'Create Table';
        }
    });

    // ─── Delete Table
    function openDeleteTableModal() {
        if (!state.currentTable) return;
        dom.dtError.classList.add('hidden');
        dom.dtConfirmName.value = '';
        dom.dtTableNamePreview.textContent = state.currentTable;
        dom.dtConfirmBtn.disabled = true;
        dom.deleteTableOverlay.classList.remove('hidden');
        dom.dtConfirmName.focus();
    }

    function closeDeleteTableModal() {
        dom.deleteTableOverlay.classList.add('hidden');
    }

    if (dom.deleteTableBtn) dom.deleteTableBtn.addEventListener('click', openDeleteTableModal);
    dom.deleteTableCloseBtn.addEventListener('click', closeDeleteTableModal);
    dom.dtCancelBtn.addEventListener('click', closeDeleteTableModal);

    dom.dtConfirmName.addEventListener('input', () => {
        dom.dtConfirmBtn.disabled = dom.dtConfirmName.value.trim() !== state.currentTable;
    });

    dom.dtConfirmBtn.addEventListener('click', async () => {
        if (dom.dtConfirmName.value.trim() !== state.currentTable) return;

        dom.dtConfirmBtn.disabled = true;
        dom.dtConfirmBtn.textContent = 'Deleting…';
        dom.dtError.classList.add('hidden');

        try {
            await tableApi('DELETE');
            showToast(`Table ${state.currentTable} deleted successfully`, 'success');
            closeDeleteTableModal();
            resetDataViewer();
            loadTables();
        } catch (err) {
            dom.dtError.textContent = err.message;
            dom.dtError.classList.remove('hidden');
            dom.dtConfirmBtn.disabled = false;
            dom.dtConfirmBtn.textContent = 'Delete Table';
        }
    });

    // ─── Truncate Table
    function openTruncateTableModal() {
        if (!state.currentTable) return;
        dom.ttError.classList.add('hidden');
        dom.ttProgress.classList.add('hidden');
        dom.ttConfirmName.value = '';
        dom.ttTableNamePreview.textContent = state.currentTable;
        dom.ttConfirmBtn.disabled = true;
        dom.truncateTableOverlay.classList.remove('hidden');
        dom.ttConfirmName.focus();
    }

    function closeTruncateTableModal() {
        dom.truncateTableOverlay.classList.add('hidden');
        dom.ttConfirmBtn.textContent = 'Truncate Table';
    }

    if (dom.truncateTableBtn) dom.truncateTableBtn.addEventListener('click', openTruncateTableModal);
    dom.truncateTableCloseBtn.addEventListener('click', closeTruncateTableModal);
    dom.ttCancelBtn.addEventListener('click', closeTruncateTableModal);

    dom.ttConfirmName.addEventListener('input', () => {
        dom.ttConfirmBtn.disabled = dom.ttConfirmName.value.trim() !== state.currentTable;
    });

    dom.ttConfirmBtn.addEventListener('click', async () => {
        if (dom.ttConfirmName.value.trim() !== state.currentTable) return;

        dom.ttConfirmBtn.disabled = true;
        dom.ttConfirmBtn.textContent = 'Truncating…';
        dom.ttError.classList.add('hidden');
        dom.ttProgress.classList.remove('hidden');
        dom.ttDeletedCount.textContent = '...';

        try {
            const result = await tableApi('POST', '/truncate');
            dom.ttDeletedCount.textContent = result.deletedCount;
            showToast(`Table ${state.currentTable} truncated. Deleted ${result.deletedCount} items.`, 'warning');
            
            setTimeout(() => {
                closeTruncateTableModal();
                executeQuery(false); 
            }, 1500);
        } catch (err) {
            dom.ttError.textContent = err.message;
            dom.ttError.classList.remove('hidden');
            dom.ttConfirmBtn.disabled = false;
            dom.ttConfirmBtn.textContent = 'Truncate Table';
        }
    });
}
