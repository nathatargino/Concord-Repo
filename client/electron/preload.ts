import { contextBridge, ipcRenderer } from 'electron';

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            checkForUpdates: () => void;
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
            movePipWindow?: (deltaX: number, deltaY: number) => void;
            sendPipAction?: (action: string, payload?: any) => void;
            sendPipSync?: (state: any) => void;
            onPipAction?: (callback: (action: string, payload?: any) => void) => () => void;
            onPipSync?: (callback: (state: any) => void) => () => void;
            onPipClosed?: (callback: () => void) => () => void;
            /** Force YouTube stream quality via Electron main process (bypasses cross-origin) */
            setYouTubeQuality?: (quality: string) => Promise<boolean>;
            getYouTubeQualities?: () => Promise<string[]>;
            /** Widevine Streaming (Netflix / Prime Video) */
            openStreamingView?: (options: { service: 'netflix' | 'prime'; url?: string; bounds: { x: number; y: number; width: number; height: number }; borderRadius?: number }) => Promise<void>;
            resizeStreamingView?: (bounds: { x: number; y: number; width: number; height: number }) => void;
            closeStreamingView?: () => void;
            sendStreamingCommand?: (command: string, payload?: any) => void;
            onStreamingEvent?: (callback: (event: any) => void) => () => void;
            /** Screen Share Source Picker */
            getScreenSources?: () => Promise<Array<{ id: string; name: string; thumbnail: string; appIcon?: string; isScreen: boolean }>>;
            selectScreenSource?: (data: { sourceId: string; withAudio: boolean }) => Promise<boolean>;
        }
    }
}

contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
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
    movePipWindow: (deltaX: number, deltaY: number) => ipcRenderer.send('pip-move', { deltaX, deltaY }),
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
    },
    setYouTubeQuality: (quality: string) => ipcRenderer.invoke('yt-set-quality', quality),
    getYouTubeQualities: () => ipcRenderer.invoke('yt-get-qualities'),
    openStreamingView: (options: { service: 'netflix' | 'prime'; url?: string; bounds: { x: number; y: number; width: number; height: number } }) => ipcRenderer.invoke('open-streaming-view', options),
    resizeStreamingView: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('resize-streaming-view', bounds),
    closeStreamingView: () => ipcRenderer.send('close-streaming-view'),
    sendStreamingCommand: (command: string, payload?: any) => ipcRenderer.send('streaming-command', command, payload),
    streamingCommand: (command: string, payload?: any) => ipcRenderer.send('streaming-command', command, payload),
    onStreamingEvent: (callback: (event: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data);
        ipcRenderer.on('streaming-event', subscription);
        return () => ipcRenderer.removeListener('streaming-event', subscription);
    },
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
    selectScreenSource: (data: { sourceId: string; withAudio: boolean }) => ipcRenderer.invoke('select-screen-source', data),
});
