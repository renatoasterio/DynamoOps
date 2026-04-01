'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    licenseStatus:     () => ipcRenderer.invoke('license:status'),
    licenseActivate:   (args) => ipcRenderer.invoke('license:activate', args),
    licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
});
