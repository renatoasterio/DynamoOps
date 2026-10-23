const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

const isMac  = process.platform === 'darwin';
const isProd = app.isPackaged;   // true when installed/built, false in dev

// Test hook: isolate E2E runs by moving license.json to a disposable dir.
if (process.env.DYNAMO_TEST_USER_DATA_DIR) {
    app.setPath('userData', process.env.DYNAMO_TEST_USER_DATA_DIR);
}

// ─── Load environment variables from .env / .env.production ─────────
(function loadEnvFile() {
    const envFile = isProd ? '.env.production' : '.env';
    const envPath = path.join(__dirname, envFile);
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        // Expand \n to actual newlines (for PEM keys)
        val = val.replace(/\\n/g, '\n');
        if (!process.env[key]) process.env[key] = val;
    }
})();

// ─── Start the Express server in the same process ────────────────────
const PORT = 3457;
process.env.PORT = PORT;
require('./server');

let mainWindow;

function createWindow() {
    const winOptions = {
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'DynamoOps',
        backgroundColor: '#0c0e14',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !isProd,   // DevTools only available in development
            preload: path.join(__dirname, 'preload.js'),
        },
        show: false,
    };

    if (isMac) {
        winOptions.titleBarStyle = 'hiddenInset';
        winOptions.trafficLightPosition = { x: 14, y: 14 };
    } else {
        // Windows: hide the menu bar (no browser-like Edit/View/Window menu)
        winOptions.frame = true;
        winOptions.autoHideMenuBar = true;
    }

    mainWindow = new BrowserWindow(winOptions);

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Block keyboard shortcuts that open DevTools in production
    if (isProd) {
        mainWindow.webContents.on('before-input-event', (_event, input) => {
            const isDevToolsShortcut =
                (input.control || input.meta) && input.shift && input.key === 'I' ||
                input.key === 'F12';
            if (isDevToolsShortcut) _event.preventDefault();
        });
    }

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// ─── Application Menu ─────────────────────────────────────────────────
function createMenu() {
    // Windows: no menu bar — native title bar handles minimize/maximize/close
    if (!isMac) {
        Menu.setApplicationMenu(null);
        return;
    }

    // macOS: keep standard Mac menu (required for copy/paste/quit shortcuts)
    const template = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'togglefullscreen' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                // DevTools only in development
                ...(!isProd ? [
                    { type: 'separator' },
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                ] : []),
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── License IPC ──────────────────────────────────────────────────────
const licenseService = require('./src/backend/services/licenseService');

// Single source of truth for the server URL (LICENSE_SERVER_URL from .env / .env.production)
const LICENSE_SERVER = licenseService.getLicenseServerUrl();

ipcMain.handle('license:status', async () => {
    return await licenseService.getLicenseStatus();
});

// Activation lives in licenseService so the exact production code path is
// covered by the HTTP e2e suite. Error responses keep the server's `code`
// (MACHINE_CONFLICT_TRANSFER_REQUIRED, TRANSFER_LIMIT_EXCEEDED, …) so the UI
// can start the machine-transfer flow.
ipcMain.handle('license:activate', async (_, { key }) => {
    try {
        return await licenseService.activateLicense(key);
    } catch (err) {
        return { success: false, error: err.message || 'Activation failed' };
    }
});

// ─── Team management IPC ──────────────────────────────────────────────

ipcMain.handle('team:list-members', async () => {
    try {
        const status = await licenseService.getLicenseStatus();
        if (status.plan !== 'team' || !status._rawToken) {
            return { success: false, error: 'Team plan required' };
        }
        const res = await fetch(`${LICENSE_SERVER}/api/team/members`, {
            method:  'GET',
            headers: { Authorization: `Bearer ${status._rawToken}` },
            signal:  AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error };
        return { success: true, ...data };
    } catch (err) {
        return { success: false, error: 'Network error. Check your connection.' };
    }
});

ipcMain.handle('team:invite', async (_, { email }) => {
    try {
        const status = await licenseService.getLicenseStatus();
        if (status.plan !== 'team' || !status._rawToken) {
            return { success: false, error: 'Team plan required' };
        }
        const res = await fetch(`${LICENSE_SERVER}/api/team/invite`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${status._rawToken}`,
            },
            body:   JSON.stringify({ email }),
            signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error };
        return { success: true, member: data.member };
    } catch (err) {
        return { success: false, error: 'Network error. Check your connection.' };
    }
});

ipcMain.handle('team:remove-member', async (_, { email }) => {
    try {
        const status = await licenseService.getLicenseStatus();
        if (status.plan !== 'team' || !status._rawToken) {
            return { success: false, error: 'Team plan required' };
        }
        const res = await fetch(`${LICENSE_SERVER}/api/team/members/${encodeURIComponent(email)}`, {
            method:  'DELETE',
            headers: { Authorization: `Bearer ${status._rawToken}` },
            signal:  AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok) return { success: false, error: data.error };
        return { success: true };
    } catch (err) {
        return { success: false, error: 'Network error. Check your connection.' };
    }
});

// ─── Machine transfer IPC ──────────────────────────────────────────────
ipcMain.handle('license:transfer-request', async (_, { key }) => {
    try {
        return await licenseService.requestTransfer(key);
    } catch (err) {
        return { success: false, error: err.message || 'Network error' };
    }
});

ipcMain.handle('license:transfer-confirm', async (_, { key, code }) => {
    try {
        return await licenseService.confirmTransfer(key, code);
    } catch (err) {
        return { success: false, error: err.message || 'Network error' };
    }
});

ipcMain.handle('license:history', async () => {
    try {
        return await licenseService.getActivationHistory();
    } catch (err) {
        return { success: false, error: err.message || 'Network error' };
    }
});

ipcMain.handle('license:deactivate', async () => {
    try {
        // Frees the machine slot on the server (best effort) and removes license.json
        return await licenseService.deactivateWithServer();
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ─── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
    createMenu();
    createWindow();

    // Refresh the license shortly after startup and then every 24h. When the
    // server gives a definitive negative answer (slot taken over by another
    // machine, team membership removed, subscription suspended) tell the
    // renderer so the UI drops to the free plan and explains why.
    licenseService.startPeriodicRefresh((result) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('license:changed', {
                reason: result.reason || (result.revoked ? 'revoked' : 'suspended'),
                plan:   result.plan,
            });
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    app.quit();
});
