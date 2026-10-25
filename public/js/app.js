import { fetchInitialConfig, initConnectionManager } from './components/ConnectionManager.js';
import { initSidebar } from './components/Sidebar.js';
import { initTableManager } from './components/TableManager.js';
import { initDataViewer } from './components/DataViewer.js';
import { initQueryPanel } from './components/QueryPanel.js';
import { initItemManager } from './components/ItemManager.js';
import { initThemeManager } from './components/ThemeManager.js';
import { initHistoryManager } from './components/HistoryManager.js';
import { initTabManager } from './components/TabManager.js';
import { initLoginManager } from './components/LoginManager.js';
import { initKeyboardManager } from './components/KeyboardManager.js';
import { initSchemaExporter } from './components/SchemaExporter.js';
import { initGsiManager } from './components/GsiManager.js';
import { initStreamsPanel } from './components/StreamsPanel.js';
import { initVersionHistory } from './components/VersionHistory.js';
import { initImportManager } from './components/ImportManager.js';
import { initCostTracker } from './components/CostTracker.js';
import { initCodeGenerator } from './components/CodeGenerator.js';
import { initTableDashboard } from './components/TableDashboard.js';
import { initChartView } from './components/ChartView.js';
import { initItemTemplateManager } from './components/ItemTemplateManager.js';

document.addEventListener('DOMContentLoaded', () => {
    initThemeManager();
    initLoginManager();
    initHistoryManager();
    initTabManager();
    initConnectionManager();
    initSidebar();
    initTableManager();
    initDataViewer();
    initQueryPanel();
    initItemManager();
    initSchemaExporter();
    initGsiManager();
    initStreamsPanel();
    initVersionHistory();
    initImportManager();
    initCostTracker();
    initCodeGenerator();
    initTableDashboard();
    initChartView();
    initItemTemplateManager();
    initKeyboardManager();

    // Load initial AWS config if server has credentials cached
    fetchInitialConfig();
});
