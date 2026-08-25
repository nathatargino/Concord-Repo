"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    onUpdateMessage: (callback) => {
        const subscription = (_event, message) => callback(message);
        electron_1.ipcRenderer.on('update-message', subscription);
        return () => {
            electron_1.ipcRenderer.removeListener('update-message', subscription);
        };
    },
    minimize: () => electron_1.ipcRenderer.send('window-minimize'),
    maximize: () => electron_1.ipcRenderer.send('window-maximize'),
    close: () => electron_1.ipcRenderer.send('window-close'),
    copyToClipboard: (text) => electron_1.ipcRenderer.send('copy-to-clipboard', text)
});
