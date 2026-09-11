import { contextBridge, ipcRenderer } from 'electron';

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            onUpdateMessage: (callback: (message: string) => void) => () => void;
            minimize: () => void;
            maximize: () => void;
            close: () => void;
            copyToClipboard?: (text: string) => void;
            forceUnmute?: () => void;
            onDeepLink?: (callback: (url: string) => void) => () => void;
            openBase64InBrowser?: (data: string) => void;
            savePreferences?: (prefs: Record<string, string>) => void;
            loadPreferences?: () => Promise<Record<string, string>>;
            toggleMiniPlayer?: (isMini: boolean) => void;
            openPipWindow?: (initialState: any) => void;
            closePipWindow?: () => void;
            sendPipAction?: (action: string, payload?: any) => void;
            sendPipSync?: (state: any) => void;
            onPipAction?: (callback: (action: string, payload?: any) => void) => () => void;
            onPipSync?: (callback: (state: any) => void) => () => void;
            onPipClosed?: (callback: () => void) => () => void;
        }
    }
}

contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdateMessage: (callback: (message: string) => void) => {
        const subscription = (_event: any, message: string) => callback(message);
        ipcRenderer.on('update-message', subscription);
        return () => {
            ipcRenderer.removeListener('update-message', subscription);
        };
    },
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    copyToClipboard: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
    forceUnmute: () => ipcRenderer.send('force-unmute'),
    onDeepLink: (callback: (url: string) => void) => {
        const subscription = (_event: any, url: string) => callback(url);
        ipcRenderer.on('deep-link', subscription);
        return () => {
            ipcRenderer.removeListener('deep-link', subscription);
        };
    },
    openBase64InBrowser: (data: string) => ipcRenderer.send('open-base64-in-browser', data),
    savePreferences: (prefs: Record<string, string>) => ipcRenderer.send('save-preferences', prefs),
    loadPreferences: () => ipcRenderer.invoke('load-preferences'),
    toggleMiniPlayer: (isMini: boolean) => ipcRenderer.send('toggle-mini-player', isMini),
    openPipWindow: (initialState: any) => ipcRenderer.send('open-pip-window', initialState),
    closePipWindow: () => ipcRenderer.send('close-pip-window'),
    sendPipAction: (action: string, payload?: any) => ipcRenderer.send('pip-action', action, payload),
    sendPipSync: (state: any) => ipcRenderer.send('pip-sync', state),
    onPipAction: (callback: (action: string, payload?: any) => void) => {
        const subscription = (_event: any, action: string, payload?: any) => callback(action, payload);
        ipcRenderer.on('pip-action', subscription);
        return () => ipcRenderer.removeListener('pip-action', subscription);
    },
    onPipSync: (callback: (state: any) => void) => {
        const subscription = (_event: any, state: any) => callback(state);
        ipcRenderer.on('pip-sync', subscription);
        return () => ipcRenderer.removeListener('pip-sync', subscription);
    },
    onPipClosed: (callback: () => void) => {
        const subscription = () => callback();
        ipcRenderer.on('pip-closed', subscription);
        return () => ipcRenderer.removeListener('pip-closed', subscription);
    }
});
