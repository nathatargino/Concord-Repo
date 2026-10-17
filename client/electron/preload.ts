import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
    getAppVersion: () => Promise<string>;
    isWindowsStore?: () => Promise<boolean>;
    checkForUpdates: () => void;
    installUpdate?: () => void;
    onUpdateDownloaded?: (callback: (version: string) => void) => () => void;
    onUpdateMessage: (callback: (message: string) => void) => () => void;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    copyToClipboard?: (text: string) => void;
    copyImageToClipboard?: (url: string) => Promise<boolean>;
    forceUnmute?: () => void;
    onDeepLink: (callback: (url: string) => void) => () => void;
    getInitialDeepLink?: () => Promise<string | null>;
    openBase64InBrowser?: (data: string) => void;
    savePreferences?: (prefs: Record<string, string>) => void;
    loadPreferences?: () => Promise<Record<string, string>>;
    saveSecureToken?: (key: string, value: string) => Promise<boolean>;
    loadSecureToken?: (key: string) => Promise<string | null>;
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
    /** Widevine Streaming (Netflix / Prime Video / Crunchyroll) */
    openStreamingView?: (options: { service: 'netflix' | 'prime' | 'crunchyroll'; url?: string; bounds: { x: number; y: number; width: number; height: number }; borderRadius?: number }) => Promise<void>;
    resizeStreamingView?: (bounds: { x: number; y: number; width: number; height: number }) => void;
    closeStreamingView?: (service?: 'netflix' | 'prime' | 'crunchyroll') => void;
    setActiveMediaTab?: (tab: 'youtube' | 'netflix' | 'prime' | 'crunchyroll') => void;
    sendStreamingCommand?: (command: string, payload?: any) => void;
    streamingCommand?: (command: string, payload?: any) => void;
    setStreamingVolume?: (volume: number) => void;
    setModalActive?: (active: boolean) => void;
    onStreamingEvent?: (callback: (event: any) => void) => () => void;
    syncStreamingPlayback?: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number; service?: 'netflix' | 'prime' | 'crunchyroll'; autoDrift?: boolean }) => void;
    navigateStreamingView?: (service: 'netflix' | 'prime' | 'crunchyroll', url: string) => void;
    /** Navigate directly to a specific title inside the streaming view (Watch Party deep link) */
    navigateToTitle?: (data: { service: 'netflix' | 'prime' | 'crunchyroll'; url: string; autoPlay?: boolean }) => void;
    /** Query current URL and playback state of a streaming view (including subframes) */
    getStreamingState?: (service?: 'netflix' | 'prime' | 'crunchyroll') => Promise<{ ok: boolean; service: 'netflix' | 'prime' | 'crunchyroll' | null; url: string; positionSeconds: number; isPlaying: boolean; hasVideo: boolean }>;
    /** Screen Share Source Picker */
    getScreenSources?: () => Promise<Array<{ id: string; name: string; thumbnail: string; appIcon?: string; isScreen: boolean }>>;
    selectScreenSource?: (data: { sourceId: string; withAudio: boolean }) => Promise<boolean>;
    /** Native Windows Notifications */
    showNotification?: (options: { userName: string; message: string; roomName?: string; avatarUrl?: string | null; forceShow?: boolean }) => void;
    openGoogleAuth?: (url: string) => Promise<{ success: boolean; url?: string; canceled?: boolean }>;
    cancelGoogleAuth?: () => void;
    /** Global Keyboard Shortcuts (Keybinds) */
    getKeybinds?: () => Promise<{ keybindMicMute: string; keybindDeafen: string; keybindsEnabled: boolean }>;
    setKeybinds?: (data: { keybindMicMute?: string; keybindDeafen?: string; keybindsEnabled?: boolean }) => Promise<{ ok: boolean; keybinds?: { keybindMicMute: string; keybindDeafen: string; keybindsEnabled: boolean }; error?: string }>;
    onGlobalShortcut?: (callback: (action: 'toggle-mic' | 'toggle-deafen') => void) => () => void;
    /** Iniciar com o Windows (Auto Launch) */
    getAutoLaunch?: () => Promise<boolean>;
    setAutoLaunch?: (enabled: boolean) => Promise<{ ok: boolean; openAtLogin?: boolean; error?: string }>;
}

declare global {
    interface Window {
        electron: ElectronAPI;
        electronAPI: ElectronAPI;
    }
}

// Global deep-link caching and pub/sub to guarantee zero missed events
let cachedDeepLink: string | null = null;
const deepLinkListeners = new Set<(url: string) => void>();

ipcRenderer.on('deep-link', (_event: any, url: string) => {
    cachedDeepLink = url;
    for (const listener of deepLinkListeners) {
        try {
            listener(url);
        } catch (err) {
            console.error('[Preload] Error in onDeepLink listener:', err);
        }
    }
});

// Query initial deep link on startup if available in main process
ipcRenderer.invoke('get-initial-deep-link').then((url: string | null) => {
    if (url) {
        cachedDeepLink = url;
        for (const listener of deepLinkListeners) {
            try {
                listener(url);
            } catch (err) {
                console.error('[Preload] Error in onDeepLink listener:', err);
            }
        }
    }
}).catch(() => {});

const electronBridge: ElectronAPI = {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    isWindowsStore: () => ipcRenderer.invoke('is-windows-store'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    installUpdate: () => ipcRenderer.send('install-update'),
    onUpdateDownloaded: (callback: (version: string) => void) => {
        const subscription = (_event: any, version: string) => callback(version);
        ipcRenderer.on('update-downloaded', subscription);
        return () => {
            ipcRenderer.removeListener('update-downloaded', subscription);
        };
    },
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
    copyImageToClipboard: (url: string) => ipcRenderer.invoke('copy-image-to-clipboard', url),
    forceUnmute: () => ipcRenderer.send('force-unmute'),
    onDeepLink: (callback: (url: string) => void) => {
        deepLinkListeners.add(callback);
        if (cachedDeepLink) {
            const urlToDeliver = cachedDeepLink;
            setTimeout(() => {
                if (deepLinkListeners.has(callback)) {
                    callback(urlToDeliver);
                }
            }, 0);
        }
        return () => {
            deepLinkListeners.delete(callback);
        };
    },
    getInitialDeepLink: () => ipcRenderer.invoke('get-initial-deep-link'),
    openBase64InBrowser: (data: string) => ipcRenderer.send('open-base64-in-browser', data),
    savePreferences: (prefs: Record<string, string>) => ipcRenderer.send('save-preferences', prefs),
    loadPreferences: () => ipcRenderer.invoke('load-preferences'),
    saveSecureToken: (key: string, value: string) => ipcRenderer.invoke('save-secure-token', key, value),
    loadSecureToken: (key: string) => ipcRenderer.invoke('load-secure-token', key),
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
    openStreamingView: (options: { service: 'netflix' | 'prime' | 'crunchyroll'; url?: string; bounds: { x: number; y: number; width: number; height: number }; borderRadius?: number }) => ipcRenderer.invoke('open-streaming-view', options),
    resizeStreamingView: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('resize-streaming-view', bounds),
    closeStreamingView: (service?: 'netflix' | 'prime' | 'crunchyroll') => ipcRenderer.send('close-streaming-view', service),
    setActiveMediaTab: (tab: 'youtube' | 'netflix' | 'prime' | 'crunchyroll') => ipcRenderer.send('set-active-media-tab', tab),
    sendStreamingCommand: (command: string, payload?: any) => ipcRenderer.send('streaming-command', command, payload),
    streamingCommand: (command: string, payload?: any) => ipcRenderer.send('streaming-command', command, payload),
    setStreamingVolume: (volume: number) => ipcRenderer.send('set-streaming-volume', volume),
    setModalActive: (active: boolean) => ipcRenderer.send('set-modal-active', active),
    onStreamingEvent: (callback: (event: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data);
        ipcRenderer.on('streaming-event', subscription);
        return () => ipcRenderer.removeListener('streaming-event', subscription);
    },
    syncStreamingPlayback: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number; service?: 'netflix' | 'prime' | 'crunchyroll'; autoDrift?: boolean }) => ipcRenderer.send('sync-streaming-playback', data),
    navigateStreamingView: (service: 'netflix' | 'prime' | 'crunchyroll', url: string) => ipcRenderer.send('navigate-streaming-view', { service, url }),
    navigateToTitle: (data: { service: 'netflix' | 'prime' | 'crunchyroll'; url: string; autoPlay?: boolean }) => ipcRenderer.send('navigate-to-title', data),
    getStreamingState: (service?: 'netflix' | 'prime' | 'crunchyroll') => ipcRenderer.invoke('get-streaming-state', service),
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
    selectScreenSource: (data: { sourceId: string; withAudio: boolean }) => ipcRenderer.invoke('select-screen-source', data),
    showNotification: (options: { userName: string; message: string; roomName?: string; avatarUrl?: string | null; forceShow?: boolean }) =>
        ipcRenderer.send('show-chat-notification', options),
    openGoogleAuth: (url: string) => ipcRenderer.invoke('open-google-auth', url),
    cancelGoogleAuth: () => ipcRenderer.send('cancel-google-auth'),
    getKeybinds: () => ipcRenderer.invoke('get-keybinds'),
    setKeybinds: (data: any) => ipcRenderer.invoke('set-keybinds', data),
    onGlobalShortcut: (cb: (action: 'toggle-mic' | 'toggle-deafen') => void) => {
        const subscription = (_event: any, action: 'toggle-mic' | 'toggle-deafen') => cb(action);
        ipcRenderer.on('global-shortcut-triggered', subscription);
        return () => {
            ipcRenderer.removeListener('global-shortcut-triggered', subscription);
        };
    },
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),
};

contextBridge.exposeInMainWorld('electron', electronBridge);
contextBridge.exposeInMainWorld('electronAPI', electronBridge);
