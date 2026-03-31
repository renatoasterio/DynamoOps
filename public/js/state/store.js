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
};

export const config = {
    region: 'us-east-1',
    profile: 'default',
    endpoint: '',
    envTag: 'none',
};
