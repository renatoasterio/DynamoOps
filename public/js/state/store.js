export const state = {
    connected: false,
    tables: [],
    
    // Multi-tab support
    tabs: [], // Array of tab objects
    activeTabId: null,

    // Proxy properties for the active tab (maintained by TabManager)
    currentTable: null,
    tableInfo: null,
    items: [],
    allColumns: [],
    lastEvaluatedKey: null,
    nextToken: null, // For PartiQL pagination
    
    viewMode: 'table',
    queryMode: 'scan',
    filterOpen: false,
    editingItem: null,

    // Last executed query/scan params (without exclusiveStartKey) for full-table export
    lastQueryEndpoint: null,
    lastQueryParams: null,
};

export const config = {
    region: 'us-east-1',
    profile: 'default',
    endpoint: '',
    envTag: 'none',
};

/** AWS connection of the active tab (falls back to the login connection). */
export function getActiveTabConnection() {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    return activeTab ? activeTab.connection : config;
}
