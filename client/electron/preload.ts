import { contextBridge, ipcRenderer } from 'electron';

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            onUpdateMessage: (callback: (message: string) => void) => () => void;
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
    close: () => ipcRenderer.send('window-close')
});
