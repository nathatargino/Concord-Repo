"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => electron_1.ipcRenderer.send('check-for-updates'),
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
    copyToClipboard: (text) => electron_1.ipcRenderer.send('copy-to-clipboard', text),
    forceUnmute: () => electron_1.ipcRenderer.send('force-unmute'),
    onDeepLink: (callback) => {
        const subscription = (_event, url) => callback(url);
        electron_1.ipcRenderer.on('deep-link', subscription);
        return () => {
            electron_1.ipcRenderer.removeListener('deep-link', subscription);
        };
    },
    openBase64InBrowser: (data) => electron_1.ipcRenderer.send('open-base64-in-browser', data),
    savePreferences: (prefs) => electron_1.ipcRenderer.send('save-preferences', prefs),
    loadPreferences: () => electron_1.ipcRenderer.invoke('load-preferences'),
    toggleMiniPlayer: (isMini) => electron_1.ipcRenderer.send('toggle-mini-player', isMini),
    openPipWindow: (initialState) => electron_1.ipcRenderer.send('open-pip-window', initialState),
    closePipWindow: () => electron_1.ipcRenderer.send('close-pip-window'),
    movePipWindow: (deltaX, deltaY) => electron_1.ipcRenderer.send('pip-move', { deltaX, deltaY }),
    sendPipAction: (action, payload) => electron_1.ipcRenderer.send('pip-action', action, payload),
    sendPipSync: (state) => electron_1.ipcRenderer.send('pip-sync', state),
    onPipAction: (callback) => {
        const subscription = (_event, action, payload) => callback(action, payload);
        electron_1.ipcRenderer.on('pip-action', subscription);
        return () => electron_1.ipcRenderer.removeListener('pip-action', subscription);
    },
    onPipSync: (callback) => {
        const subscription = (_event, state) => callback(state);
        electron_1.ipcRenderer.on('pip-sync', subscription);
        return () => electron_1.ipcRenderer.removeListener('pip-sync', subscription);
    },
    onPipClosed: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on('pip-closed', subscription);
        return () => electron_1.ipcRenderer.removeListener('pip-closed', subscription);
    },
    setYouTubeQuality: (quality) => electron_1.ipcRenderer.invoke('yt-set-quality', quality),
    getYouTubeQualities: () => electron_1.ipcRenderer.invoke('yt-get-qualities'),
    openStreamingView: (options) => electron_1.ipcRenderer.invoke('open-streaming-view', options),
    resizeStreamingView: (bounds) => electron_1.ipcRenderer.send('resize-streaming-view', bounds),
    closeStreamingView: (service) => electron_1.ipcRenderer.send('close-streaming-view', service),
    setActiveMediaTab: (tab) => electron_1.ipcRenderer.send('set-active-media-tab', tab),
    sendStreamingCommand: (command, payload) => electron_1.ipcRenderer.send('streaming-command', command, payload),
    streamingCommand: (command, payload) => electron_1.ipcRenderer.send('streaming-command', command, payload),
    setStreamingVolume: (volume) => electron_1.ipcRenderer.send('set-streaming-volume', volume),
    setModalActive: (active) => electron_1.ipcRenderer.send('set-modal-active', active),
    onStreamingEvent: (callback) => {
        const subscription = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('streaming-event', subscription);
        return () => electron_1.ipcRenderer.removeListener('streaming-event', subscription);
    },
    syncStreamingPlayback: (data) => electron_1.ipcRenderer.send('sync-streaming-playback', data),
    navigateStreamingView: (service, url) => electron_1.ipcRenderer.send('navigate-streaming-view', { service, url }),
    getScreenSources: () => electron_1.ipcRenderer.invoke('get-screen-sources'),
    selectScreenSource: (data) => electron_1.ipcRenderer.invoke('select-screen-source', data),
    showNotification: (options) => electron_1.ipcRenderer.send('show-chat-notification', options),
    openGoogleAuth: (url) => electron_1.ipcRenderer.invoke('open-google-auth', url),
    cancelGoogleAuth: () => electron_1.ipcRenderer.send('cancel-google-auth'),
});
