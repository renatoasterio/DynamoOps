'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    licenseStatus:     () => ipcRenderer.invoke('license:status'),
    licenseActivate:   (args) => ipcRenderer.invoke('license:activate', args),
    licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),

    // Team management
    teamListMembers:   () => ipcRenderer.invoke('team:list-members'),
    teamInvite:        (args) => ipcRenderer.invoke('team:invite', args),
    teamRemoveMember:  (args) => ipcRenderer.invoke('team:remove-member', args),
});
