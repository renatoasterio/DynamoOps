const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const isMac  = process.platform === 'darwin';
const isProd = app.isPackaged;   // true when installed/built, false in dev

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

// ─── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
    createMenu();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    app.quit();
});
