'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    licenseStatus:          () => ipcRenderer.invoke('license:status'),
    licenseActivate:        (args) => ipcRenderer.invoke('license:activate', args),
    licenseDeactivate:      () => ipcRenderer.invoke('license:deactivate'),

    // Machine transfer
    licenseTransferRequest: (args) => ipcRenderer.invoke('license:transfer-request', args),
    licenseTransferConfirm: (args) => ipcRenderer.invoke('license:transfer-confirm', args),
    licenseHistory:         () => ipcRenderer.invoke('license:history'),

    // Fired by the background refresh when the plan is lost:
    // info = { reason: 'revoked' | 'not_found' | 'suspended', plan }
    onLicenseChanged:       (cb) => ipcRenderer.on('license:changed', (_event, info) => cb(info)),
    // macOS menu "License…" (⌘⇧L)
    onLicenseOpen:          (cb) => ipcRenderer.on('license:open', () => cb()),

    // Team management
    teamListMembers:        () => ipcRenderer.invoke('team:list-members'),
    teamInvite:             (args) => ipcRenderer.invoke('team:invite', args),
    teamRemoveMember:       (args) => ipcRenderer.invoke('team:remove-member', args),
});
