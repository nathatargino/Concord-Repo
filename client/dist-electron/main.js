"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const http = __importStar(require("http"));
const logFile = `${os.tmpdir()}/concord-debug.log`;
fs.writeFileSync(logFile, 'Electron Started!\n');
const electron_updater_1 = require("electron-updater");
// removed url import
// In a CommonJS build we don't have import.meta.url, but we are writing TS mapped to commonjs usually for electron, or ESM if packaged cleanly.
const path = require('path');
electron_1.app.name = 'Concord';
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId('com.concord.desktop');
}
const isDev = !electron_1.app.isPackaged;
function getAppIconPath() {
    const iconFile = process.platform === 'win32' ? 'icon.ico' : 'logo.png';
    const candidates = [
        path.join(__dirname, isDev ? '../public' : '../dist', iconFile),
        path.join(__dirname, '../public', iconFile),
        path.join(__dirname, '../dist', iconFile),
        path.join(electron_1.app.getAppPath(), isDev ? 'public' : 'dist', iconFile),
        path.join(electron_1.app.getAppPath(), 'public', iconFile),
        path.join(electron_1.app.getAppPath(), iconFile),
        path.join(__dirname, isDev ? '../public/logo.png' : '../dist/logo.png'),
        path.join(__dirname, '../public/logo.png'),
        path.join(__dirname, '../dist/logo.png'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    return path.join(__dirname, '../public/logo.png');
}
function cleanOldWidevineVersions(baseDir, currentVersion) {
    try {
        if (!fs.existsSync(baseDir))
            return;
        const entries = fs.readdirSync(baseDir);
        for (const entry of entries) {
            if (entry !== currentVersion) {
                const p = path.join(baseDir, entry);
                if (fs.statSync(p).isDirectory()) {
                    fs.rmSync(p, { recursive: true, force: true });
                    fs.appendFileSync(logFile, `[Widevine] Removed obsolete Widevine version: ${entry}\n`);
                }
            }
        }
    }
    catch (e) { }
}
function copyRecursive(src, dest) {
    if (!fs.existsSync(src))
        return;
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    }
    else {
        fs.copyFileSync(src, dest);
    }
}
function ensureWidevineCdm() {
    try {
        const userData = electron_1.app.getPath('userData');
        const widevineTargetBase = path.join(userData, 'WidevineCdm');
        const targetVersion = '4.10.3112.0';
        const targetVersionDir = path.join(widevineTargetBase, targetVersion);
        const targetDll = path.join(targetVersionDir, '_platform_specific', 'win_x64', 'widevinecdm.dll');
        if (fs.existsSync(targetDll)) {
            cleanOldWidevineVersions(widevineTargetBase, targetVersion);
            return;
        }
        const candidateSources = [
            path.join(__dirname, '../build/WidevineCdm', targetVersion),
            path.join(process.resourcesPath || '', 'WidevineCdm', targetVersion),
            path.join(electron_1.app.getAppPath(), 'build/WidevineCdm', targetVersion),
        ];
        const chromeDir = 'C:\\Program Files\\Google\\Chrome\\Application';
        if (fs.existsSync(chromeDir)) {
            try {
                for (const sd of fs.readdirSync(chromeDir)) {
                    const chromeWidevine = path.join(chromeDir, sd, 'WidevineCdm');
                    if (fs.existsSync(path.join(chromeWidevine, '_platform_specific', 'win_x64', 'widevinecdm.dll'))) {
                        candidateSources.push(chromeWidevine);
                        break;
                    }
                }
            }
            catch (e) { }
        }
        const edgeDir = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application';
        if (fs.existsSync(edgeDir)) {
            try {
                for (const sd of fs.readdirSync(edgeDir)) {
                    const edgeWidevine = path.join(edgeDir, sd, 'WidevineCdm');
                    if (fs.existsSync(path.join(edgeWidevine, '_platform_specific', 'win_x64', 'widevinecdm.dll'))) {
                        candidateSources.push(edgeWidevine);
                        break;
                    }
                }
            }
            catch (e) { }
        }
        for (const src of candidateSources) {
            const srcDll = path.join(src, '_platform_specific', 'win_x64', 'widevinecdm.dll');
            if (fs.existsSync(srcDll)) {
                fs.mkdirSync(path.join(targetVersionDir, '_platform_specific', 'win_x64'), { recursive: true });
                copyRecursive(src, targetVersionDir);
                fs.appendFileSync(logFile, `[Widevine] Provisioned Widevine ${targetVersion} from: ${src}\n`);
                cleanOldWidevineVersions(widevineTargetBase, targetVersion);
                break;
            }
        }
    }
    catch (err) {
        fs.appendFileSync(logFile, `[Widevine] Provisioning error: ${err}\n`);
    }
}
// Allow autoplay without user gesture for YouTube and streaming
electron_1.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
electron_1.app.commandLine.appendSwitch('disable-gesture-requirement-for-media-playback');
electron_1.app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,WebAuthentication,WebAuthenticationCable,WebAuthnExtensions,WebAuthenticationUseNativeWinApi');
// Disable web security restrictions that block YouTube iframe audio and media streaming
electron_1.app.commandLine.appendSwitch('disable-web-security');
electron_1.app.commandLine.appendSwitch('allow-running-insecure-content');
electron_1.app.commandLine.appendSwitch('disable-site-isolation-trials');
// Ensure audio is not silenced by the renderer
electron_1.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Strip Electron from user-agent globally so YouTube and streaming services don't block
electron_1.app.userAgentFallback = electron_1.app.userAgentFallback
    .replace(/Electron\/\S+\s*/g, '')
    .replace(/concord\/\S+\s*/g, '');
electron_1.app.on('widevine-ready', (version, lastVersion) => {
    fs.appendFileSync(logFile, `[Widevine] Widevine CDM ready! version=${version}, lastVersion=${lastVersion}\n`);
});
let mainWindow = null;
let localServerPort = 0;
let previousBounds = null;
function startLocalServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = req.url === '/' ? '/index.html' : req.url;
            urlPath = urlPath?.split('?')[0] || '/index.html';
            const absolutePath = path.join(__dirname, '../dist', urlPath);
            fs.readFile(absolutePath, (err, data) => {
                if (err) {
                    fs.readFile(path.join(__dirname, '../dist/index.html'), (err2, data2) => {
                        if (err2) {
                            res.writeHead(404);
                            res.end('Not found');
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(data2);
                    });
                    return;
                }
                const ext = path.extname(absolutePath).toLowerCase();
                let mime = 'text/plain';
                if (ext === '.html')
                    mime = 'text/html';
                else if (ext === '.js' || ext === '.mjs')
                    mime = 'application/javascript';
                else if (ext === '.css')
                    mime = 'text/css';
                else if (ext === '.svg')
                    mime = 'image/svg+xml';
                else if (ext === '.png')
                    mime = 'image/png';
                else if (ext === '.json')
                    mime = 'application/json';
                else if (ext === '.ico')
                    mime = 'image/x-icon';
                res.writeHead(200, { 'Content-Type': mime });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            resolve(server.address().port);
        });
    });
}
function createWindow() {
    fs.appendFileSync(logFile, 'createWindow called!\n');
    const appIcon = getAppIconPath();
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#0e0e18',
        show: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            autoplayPolicy: 'no-user-gesture-required'
        },
        frame: false,
        titleBarStyle: 'hidden',
        icon: appIcon,
    });
    if (appIcon && fs.existsSync(appIcon)) {
        try {
            mainWindow.setIcon(appIcon);
        }
        catch (e) { }
    }
    // Spoof User-Agent to bypass YouTube's Electron blocks
    // Already done globally via app.userAgentFallback
    const url = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
        : `http://127.0.0.1:${localServerPort}`;
    mainWindow.once('ready-to-show', () => {
        fs.appendFileSync(logFile, 'ready-to-show fired!\n');
        if (appIcon && fs.existsSync(appIcon)) {
            try {
                mainWindow?.setIcon(appIcon);
            }
            catch (e) { }
        }
        mainWindow?.show();
        mainWindow?.focus();
        if (pendingDeepLink) {
            mainWindow?.webContents.send('deep-link', pendingDeepLink);
            pendingDeepLink = null;
        }
        if (process.platform === 'win32' || process.platform === 'linux') {
            const deepLinkUrl = process.argv.find(arg => arg.startsWith('concord://'));
            if (deepLinkUrl) {
                mainWindow?.webContents.send('deep-link', deepLinkUrl);
            }
        }
    });
    if (isDev) {
        mainWindow.loadURL(url);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadURL(url);
    }
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        fs.appendFileSync(logFile, `[Renderer] ${message}\n`);
    });
    // Handle auto-updates
    initAutoUpdater(mainWindow);
    // Make all links open with the browser, not with the application
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:'))
            electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('enter-full-screen', () => {
        if (isStreamingFullscreen && activeStreamingService) {
            const inst = streamingInstances.get(activeStreamingService);
            if (inst && !inst.view.webContents.isDestroyed()) {
                const b = mainWindow.getContentBounds();
                inst.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
                if (typeof inst.view.setBorderRadius === 'function') {
                    inst.view.setBorderRadius(0);
                }
            }
        }
    });
    mainWindow.on('leave-full-screen', () => {
        if (isStreamingFullscreen) {
            leaveStreamingFullscreen();
        }
    });
    mainWindow.on('resize', () => {
        if (isStreamingFullscreen && activeStreamingService) {
            const inst = streamingInstances.get(activeStreamingService);
            if (inst && !inst.view.webContents.isDestroyed()) {
                const b = mainWindow.getContentBounds();
                inst.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
            }
        }
    });
    mainWindow.webContents.on('before-input-event', (_e, input) => {
        if (input.key === 'Escape' && isStreamingFullscreen) {
            leaveStreamingFullscreen();
        }
    });
    mainWindow.on('closed', () => {
        for (const inst of streamingInstances.values()) {
            try {
                if (mainWindow && mainWindow.contentView && typeof mainWindow.contentView.removeChildView === 'function') {
                    mainWindow.contentView.removeChildView(inst.view);
                }
                inst.view.webContents.destroy?.();
            }
            catch (e) { }
        }
        streamingInstances.clear();
        mainWindow = null;
    });
}
function initAutoUpdater(window) {
    if (isDev)
        return;
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', 'Verificando atualizações...');
        }
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', `Atualização v${info.version || ''} encontrada! Baixando...`);
        }
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => {
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', 'O aplicativo está atualizado.');
        }
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        fs.appendFileSync(logFile, `autoUpdater error: ${err}\n`);
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', 'Erro ao verificar atualizações: ' + (err?.message || err));
        }
    });
    electron_updater_1.autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent || 0);
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', `Baixando atualização: ${percent}%`);
        }
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', `Versão ${info.version || ''} baixada! Reiniciando para instalar...`);
        }
        try {
            new electron_1.Notification({
                title: 'Nova atualização pronta para instalar',
                body: `A versão ${info.version || ''} do Concord foi baixada e será instalada automaticamente.`
            }).show();
        }
        catch { }
        setTimeout(() => {
            electron_updater_1.autoUpdater.quitAndInstall();
        }, 4000);
    });
    electron_updater_1.autoUpdater.checkForUpdates().catch(err => {
        fs.appendFileSync(logFile, `Initial autoUpdater.checkForUpdates error: ${err}\n`);
    });
    // Verificar atualizações a cada 1 hora em segundo plano
    setInterval(() => {
        electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
    }, 60 * 60 * 1000);
    fs.appendFileSync(logFile, 'initAutoUpdater Finished!\n');
}
// Deep Linking Setup
let pendingDeepLink = null;
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        electron_1.app.setAsDefaultProtocolClient('concord', process.execPath, [path.resolve(process.argv[1])]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('concord');
}
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
electron_1.app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
    const url = commandLine.find(arg => arg.startsWith('concord://'));
    if (url && mainWindow) {
        mainWindow.webContents.send('deep-link', url);
    }
});
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('deep-link', url);
    }
    else {
        pendingDeepLink = url;
    }
});
fs.appendFileSync(logFile, 'Waiting for app.whenReady()...\n');
let pipWindow = null;
electron_1.app.whenReady().then(async () => {
    fs.appendFileSync(logFile, 'app.whenReady() fired!\n');
    ensureWidevineCdm();
    try {
        const { components } = require('electron');
        if (components && typeof components.whenReady === 'function') {
            await components.whenReady();
            const status = typeof components.status === 'function' ? JSON.stringify(components.status()) : 'ready';
            fs.appendFileSync(logFile, `[Widevine] components.whenReady() resolved! Status: ${status}\n`);
        }
    }
    catch (wvErr) {
        fs.appendFileSync(logFile, `[Widevine] components.whenReady() error: ${wvErr}\n`);
    }
    // Handle media permissions for WebRTC
    electron_1.session.defaultSession.setPermissionCheckHandler((_webContents, _permission) => {
        return true;
    });
    electron_1.session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(true);
    });
    let selectedScreenSource = null;
    electron_1.ipcMain.handle('get-screen-sources', async () => {
        try {
            const sources = await electron_1.desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 320, height: 180 },
                fetchWindowIcons: true,
            });
            return sources.map((s) => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
                appIcon: s.appIcon ? s.appIcon.toDataURL() : undefined,
                isScreen: s.id.startsWith('screen:'),
            }));
        }
        catch (err) {
            console.error('[Main] Error getting screen sources:', err);
            return [];
        }
    });
    electron_1.ipcMain.handle('select-screen-source', (_event, data) => {
        fs.appendFileSync(logFile, `[ScreenShare-Main] select-screen-source received: ${JSON.stringify(data)}\n`);
        selectedScreenSource = { ...data, timestamp: Date.now() };
        return true;
    });
    // Handle screen share requests natively
    // Uses the user-selected screen/window source and audio preference from the picker modal
    electron_1.session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            const isRecent = selectedScreenSource && (Date.now() - selectedScreenSource.timestamp < 15000);
            const targetId = isRecent ? selectedScreenSource?.sourceId : null;
            const wantAudio = (isRecent && selectedScreenSource ? selectedScreenSource.withAudio : true) && request.audioRequested;
            fs.appendFileSync(logFile, `[ScreenShare-Main] Handler invoked: audioRequested=${request.audioRequested}, isRecent=${isRecent}, targetId=${targetId}, wantAudio=${wantAudio}\n`);
            const sources = await electron_1.desktopCapturer.getSources({ types: ['screen', 'window'] });
            let chosen = targetId ? sources.find((s) => s.id === targetId) : null;
            if (!chosen) {
                // Fallback to screen if not found or not specified
                chosen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
            }
            if (!chosen) {
                console.error('[Main] No desktop sources found');
                fs.appendFileSync(logFile, `[ScreenShare-Main] No desktop sources found!\n`);
                // @ts-ignore
                callback({});
                return;
            }
            // In Chromium on Windows, system audio loopback is supported for screen sources.
            // Individual windows do not support system loopback and passing it causes capture to fail.
            const isScreen = chosen.id.startsWith('screen:');
            const audioStream = (wantAudio && isScreen) ? 'loopback' : undefined;
            fs.appendFileSync(logFile, `[ScreenShare-Main] Calling callback with video=${chosen.id} (${chosen.name}), isScreen=${isScreen}, audio=${audioStream}\n`);
            // @ts-ignore
            callback({
                video: chosen,
                audio: audioStream,
            });
        }
        catch (err) {
            console.error('[Main] Error in setDisplayMediaRequestHandler:', err);
            fs.appendFileSync(logFile, `[ScreenShare-Main] Handler exception: ${err}\n`);
            // @ts-ignore
            callback({});
        }
    });
    const chromeVer = process.versions.chrome || '150.0.7871.250';
    const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    // Override UA globally for the entire session so ALL requests (including YouTube
    // iframe sub-frames) look like Chrome, never Electron.
    electron_1.session.defaultSession.setUserAgent(CHROME_UA);
    fs.appendFileSync(logFile, `[Main] Session UA set to: ${CHROME_UA}\n`);
    // Fix CORS/Origin for YouTube iframes
    // Electron sends requests with Origin: http://127.0.0.1:PORT which YouTube blocks/mutes.
    // We spoof it to the production URL so YouTube treats the embed as legitimate.
    electron_1.session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.youtube.com/*', 'https://*.ytimg.com/*', 'https://*.googlevideo.com/*', 'https://*.ggpht.com/*'] }, (details, callback) => {
        const isYouTube = details.url.includes('youtube.com') || details.url.includes('ytimg.com') || details.url.includes('googlevideo.com') || details.url.includes('ggpht.com');
        if (isYouTube) {
            // Only spoof Referer for the iframe HTML itself.
            // Do not spoof for xhr/fetch, as it breaks YouTube's internal API CSRF checks (403 Forbidden).
            if (details.resourceType === 'subFrame' || details.resourceType === 'mainFrame') {
                details.requestHeaders['Referer'] = 'https://concord-olive.vercel.app/';
            }
            // Always override UA to Chrome for YouTube requests to avoid Electron blocks
            details.requestHeaders['User-Agent'] = CHROME_UA;
            fs.appendFileSync(logFile, `[YT-req] ${details.url.substring(0, 80)}\n`);
        }
        callback({ requestHeaders: details.requestHeaders });
    });
    // Strip YouTube response headers that block iframe audio/autoplay in Electron
    electron_1.session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*.youtube.com/*', 'https://*.youtube-nocookie.com/*', 'https://*.ytimg.com/*', 'https://*.googlevideo.com/*'] }, (details, callback) => {
        const headers = { ...details.responseHeaders };
        // Remove X-Frame-Options so the YT iframe embeds without restriction
        delete headers['x-frame-options'];
        delete headers['X-Frame-Options'];
        // Remove CSP that blocks autoplay / media
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        if (details.url.includes('googlevideo.com')) {
            // googlevideo sets its own Access-Control-Allow-Origin matching the request origin with credentials: 'include'.
            // Overriding it with wildcard '*' violates CORS specifications and causes Chromium to block video/audio streaming chunks!
            const origin = details.referrer && details.referrer.includes('youtube-nocookie.com')
                ? 'https://www.youtube-nocookie.com'
                : 'https://www.youtube.com';
            if (!headers['access-control-allow-origin'] || headers['access-control-allow-origin'].includes('*')) {
                headers['access-control-allow-origin'] = [origin];
                headers['access-control-allow-credentials'] = ['true'];
            }
        }
        else {
            headers['access-control-allow-origin'] = ['*'];
        }
        callback({ responseHeaders: headers });
    });
    if (!isDev) {
        startLocalServer().then(port => {
            localServerPort = port;
            fs.appendFileSync(logFile, `[Main] Local server on port ${port}\n`);
            createWindow();
        });
    }
    else {
        createWindow();
    }
}).catch(err => fs.appendFileSync(logFile, `app.whenReady() ERROR: ${err}\n`));
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (mainWindow === null)
        createWindow();
});
// Basic IPC handlers
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.on('copy-to-clipboard', (event, text) => {
    electron_1.clipboard.writeText(text);
});
// Native Windows Notifications for Chat Messages
electron_1.ipcMain.on('show-chat-notification', async (_event, data) => {
    try {
        let iconImage = undefined;
        if (data.avatarUrl) {
            try {
                if (data.avatarUrl.startsWith('data:image/')) {
                    iconImage = electron_1.nativeImage.createFromDataURL(data.avatarUrl);
                }
                else if (data.avatarUrl.startsWith('http://') || data.avatarUrl.startsWith('https://')) {
                    const res = await electron_1.net.fetch(data.avatarUrl);
                    if (res.ok) {
                        const buffer = Buffer.from(await res.arrayBuffer());
                        iconImage = electron_1.nativeImage.createFromBuffer(buffer);
                    }
                }
            }
            catch (imgErr) {
                fs.appendFileSync(logFile, `[Notification] Failed to load avatar: ${imgErr}\n`);
            }
        }
        if (!iconImage || iconImage.isEmpty()) {
            const defaultIconPath = path.join(__dirname, isDev ? '../public/logo.png' : '../dist/logo.png');
            if (fs.existsSync(defaultIconPath)) {
                iconImage = electron_1.nativeImage.createFromPath(defaultIconPath);
            }
        }
        const title = data.roomName ? `${data.userName} (${data.roomName})` : data.userName;
        const notification = new electron_1.Notification({
            title,
            body: data.message || 'Nova mensagem recebida',
            icon: iconImage && !iconImage.isEmpty() ? iconImage : undefined,
            silent: false,
        });
        notification.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized())
                    mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });
        notification.show();
    }
    catch (err) {
        fs.appendFileSync(logFile, `[Notification] Error showing notification: ${err}\n`);
    }
});
// Window controls IPC
electron_1.ipcMain.on('window-minimize', () => {
    if (mainWindow)
        mainWindow.minimize();
});
electron_1.ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow.maximize();
        }
    }
});
electron_1.ipcMain.on('force-unmute', () => {
    if (mainWindow) {
        mainWindow.webContents.setAudioMuted(false);
    }
});
electron_1.ipcMain.on('window-close', () => {
    if (mainWindow)
        mainWindow.close();
});
electron_1.ipcMain.on('open-pip-window', (event, initialState) => {
    if (pipWindow) {
        pipWindow.focus();
        return;
    }
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const appIcon = getAppIconPath();
    pipWindow = new electron_1.BrowserWindow({
        width: 380,
        height: 320,
        minWidth: 320,
        minHeight: 240,
        x: width - 400,
        y: height - 340,
        alwaysOnTop: true,
        frame: false,
        backgroundColor: '#0a0a14',
        resizable: true,
        skipTaskbar: false,
        icon: appIcon,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            preload: path.join(__dirname, 'preload.js'),
            autoplayPolicy: 'no-user-gesture-required'
        }
    });
    if (appIcon && fs.existsSync(appIcon)) {
        try {
            pipWindow.setIcon(appIcon);
        }
        catch (e) { }
    }
    // Enforce 16:9 aspect ratio for the video area on resize.
    // NOTE: setAspectRatio's extraSize param is macOS-only.
    // On Windows we use the 'will-resize' event (primary) and 'resize' (fallback).
    // EXTRA_HEIGHT = dragHeader (30px) + commandsBar (~70px) = 100px
    const PIP_EXTRA_HEIGHT = 100;
    const MIN_WIDTH = 280;
    const MIN_HEIGHT = Math.round(MIN_WIDTH * 9 / 16) + PIP_EXTRA_HEIGHT;
    pipWindow.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
    // Primary: intercept resize and enforce aspect ratio before it happens
    pipWindow.on('will-resize', (e, bounds) => {
        e.preventDefault();
        const newWidth = Math.max(MIN_WIDTH, bounds.width);
        const newHeight = Math.round(newWidth * 9 / 16) + PIP_EXTRA_HEIGHT;
        pipWindow?.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: newWidth,
            height: newHeight,
        });
    });
    // Fallback: correct aspect ratio after resize in case will-resize was bypassed
    let isResizing = false;
    let resizeTimer = null;
    pipWindow.on('resize', () => {
        if (isResizing)
            return;
        if (resizeTimer)
            clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (!pipWindow || pipWindow.isDestroyed())
                return;
            const [w, h] = pipWindow.getSize();
            const targetH = Math.round(w * 9 / 16) + PIP_EXTRA_HEIGHT;
            if (Math.abs(h - targetH) > 4) {
                isResizing = true;
                pipWindow.setSize(w, targetH);
                setTimeout(() => { isResizing = false; }, 100);
            }
        }, 150);
    });
    pipWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Ensure it uses a hash route to render just the PiP
    const pipUrl = isDev
        ? `${process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'}#/pip`
        : `http://127.0.0.1:${localServerPort}/#/pip`;
    pipWindow.loadURL(pipUrl);
    pipWindow.webContents.on('did-finish-load', () => {
        pipWindow?.webContents.send('pip-sync', initialState);
    });
    pipWindow.on('closed', () => {
        pipWindow = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pip-closed');
        }
    });
});
electron_1.ipcMain.on('close-pip-window', () => {
    if (pipWindow) {
        pipWindow.close();
    }
});
electron_1.ipcMain.on('pip-move', (_event, { deltaX, deltaY }) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        const [currentX, currentY] = pipWindow.getPosition();
        pipWindow.setPosition(Math.round(currentX + deltaX), Math.round(currentY + deltaY));
    }
});
electron_1.ipcMain.on('check-for-updates', () => {
    if (!isDev) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-message', 'Verificando atualizações...');
        }
        electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-message', 'Erro ao verificar atualizações: ' + (err?.message || err));
            }
        });
    }
    else {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-message', 'Atualizações desabilitadas no modo de desenvolvimento.');
        }
    }
});
electron_1.ipcMain.on('pip-action', (event, action, payload) => {
    // Forward action from PiP window to Main window
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pip-action', action, payload);
    }
});
electron_1.ipcMain.on('pip-sync', (event, state) => {
    // If sync indicates no video is playing or queue cleared, close PiP immediately
    if (state && state.videoId === null && pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
        return;
    }
    // Forward sync state from Main window to PiP window
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.webContents.send('pip-sync', state);
    }
});
electron_1.ipcMain.on('open-base64-in-browser', (event, base64Data) => {
    try {
        const tempPath = path.join(os.tmpdir(), `concord-image-${Date.now()}.html`);
        const html = `<!DOCTYPE html>
<html>
<head><title>Visualizador de Imagem - Concord</title></head>
<body style="margin: 0; background: #0e0e18; display: flex; justify-content: center; align-items: center; height: 100vh;">
  <img src="${base64Data}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
</body>
</html>`;
        fs.writeFileSync(tempPath, html, 'utf-8');
        electron_1.shell.openPath(tempPath);
    }
    catch (e) {
        console.error('Failed to open base64 image in browser', e);
    }
});
// ─── PERSISTENT USER PREFERENCES ─────────────────────────────────────────────
// Saved to %APPDATA%\ConcordUserData\prefs.json — survives updates AND reinstalls
// because we use a separate folder (not the app install dir or userData)
function getPrefsPath() {
    // Use a stable path in the user's AppData that is NOT cleaned by the uninstaller
    const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'ConcordUserData');
    try {
        if (!fs.existsSync(appDataDir)) {
            fs.mkdirSync(appDataDir, { recursive: true });
        }
    }
    catch { }
    return path.join(appDataDir, 'prefs.json');
}
electron_1.ipcMain.on('save-preferences', async (_event, prefs) => {
    try {
        const prefsPath = getPrefsPath();
        // Merge with existing prefs so we never lose other saved keys
        let existing = {};
        if (fs.existsSync(prefsPath)) {
            const raw = await fs.promises.readFile(prefsPath, 'utf-8');
            existing = JSON.parse(raw);
        }
        await fs.promises.writeFile(prefsPath, JSON.stringify({ ...existing, ...prefs }, null, 2), 'utf-8');
    }
    catch (e) {
        console.error('Failed to save preferences:', e);
    }
});
electron_1.ipcMain.handle('load-preferences', () => {
    try {
        const prefsPath = getPrefsPath();
        if (fs.existsSync(prefsPath)) {
            return JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        }
    }
    catch (e) {
        console.error('Failed to load preferences:', e);
    }
    return {};
});
// ─── YOUTUBE QUALITY CONTROL ──────────────────────────────────────────────────
// Executes quality-setting code DIRECTLY inside the YouTube iframe sub-frame
// (bypasses cross-origin restrictions that block the renderer from doing it).
electron_1.ipcMain.handle('yt-set-quality', async (_event, quality) => {
    if (!mainWindow || mainWindow.isDestroyed())
        return false;
    const isDefault = quality === 'auto' || quality === 'default';
    const q = isDefault ? 'default' : quality;
    const qRange = isDefault ? 'auto' : quality;
    const script = `
      (function() {
        var mp = document.getElementById('movie_player') ||
                 document.querySelector('.html5-video-player');
        if (!mp) { return 'no-player'; }

        var targetQ = '${q}';
        var targetQRange = '${qRange}';

        var resMap = {
          'hd2160': 2160,
          'hd1440': 1440,
          'hd1080': 1080,
          'hd720': 720,
          'large': 480,
          'medium': 360,
          'small': 240,
          'tiny': 144
        };

        try {
          if (${isDefault}) {
            localStorage.removeItem('yt-player-quality');
            localStorage.removeItem('yt-player-quality-cap');
          } else {
            var num = resMap[targetQ] || 720;
            var payload = { data: JSON.stringify({ quality: num, previousQuality: num }), expiration: Date.now() + 31536000000, creation: Date.now() };
            localStorage.setItem('yt-player-quality', JSON.stringify(payload));
            localStorage.setItem('yt-player-quality-cap', JSON.stringify(payload));
          }
        } catch(e) {}

        var applied = [];

        // 1. Direct movie_player methods
        try {
          if (typeof mp.setPlaybackQualityRange === 'function') {
            mp.setPlaybackQualityRange(targetQRange, targetQRange);
            applied.push('sqr');
          }
        } catch(e) {
          applied.push('sqr_err:' + (e && e.message));
        }

        try {
          if (typeof mp.setPlaybackQuality === 'function') {
            mp.setPlaybackQuality(targetQ);
            applied.push('spq');
          }
        } catch(e) {
          applied.push('spq_err:' + (e && e.message));
        }

        try {
          if (typeof mp.setOption === 'function') {
            mp.setOption('playbackQuality', targetQ);
            applied.push('so');
          }
        } catch(e) {
          applied.push('so_err:' + (e && e.message));
        }

        // 2. Walk internal properties to find adaptive quality controller
        function walkObj(obj, depth) {
          if (!obj || depth > 2) return;
          var keys = Object.keys(obj);
          for (var i = 0; i < keys.length; i++) {
            try {
              var val = obj[keys[i]];
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                if (typeof val.setQuality === 'function') { try { val.setQuality(targetQRange); applied.push('wk.setQuality'); } catch(e) {} }
                if (typeof val.setMaxQuality === 'function') { try { val.setMaxQuality(targetQRange); applied.push('wk.setMaxQuality'); } catch(e) {} }
                if (typeof val.handleQualityChange === 'function') { try { val.handleQualityChange({quality: targetQRange}); applied.push('wk.handleQualityChange'); } catch(e) {} }
                if (typeof val.updatePlaybackQuality === 'function') { try { val.updatePlaybackQuality(targetQRange, targetQRange); applied.push('wk.updatePlaybackQuality'); } catch(e) {} }
                walkObj(val, depth + 1);
              }
            } catch(e2) {}
          }
        }
        walkObj(mp, 0);

        var curQ = typeof mp.getPlaybackQuality === 'function' ? mp.getPlaybackQuality() : 'unknown';
        var avail = typeof mp.getAvailableQualityLevels === 'function' ? mp.getAvailableQualityLevels() : [];

        return 'applied:[' + applied.join(',') + '] cur:' + curQ + ' avail:[' + avail.join(',') + ']';
      })()
    `;
    fs.appendFileSync(logFile, `[YT-quality] IPC called with quality='${quality}'\n`);
    // Iterate over all web contents and their subframes to find the YouTube iframe
    const { webContents } = require('electron');
    let found = false;
    let totalFrames = 0;
    for (const wc of webContents.getAllWebContents()) {
        const frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : [];
        for (const frame of frames) {
            try {
                const url = frame.url;
                totalFrames++;
                // Log ALL frame URLs for diagnostics
                fs.appendFileSync(logFile, `[YT-quality] frame[${totalFrames}] url=${url.substring(0, 80)}\n`);
                if (url && (url.includes('youtube.com/embed') || url.includes('youtube-nocookie.com/embed'))) {
                    fs.appendFileSync(logFile, `[YT-quality] FOUND YT frame → running script\n`);
                    const result = await frame.executeJavaScript(script);
                    fs.appendFileSync(logFile, `[YT-quality] result=${result}\n`);
                    found = true;
                }
            }
            catch (e) {
                fs.appendFileSync(logFile, `[YT-quality] exec error: ${e}\n`);
            }
        }
    }
    fs.appendFileSync(logFile, `[YT-quality] Done. found=${found}, totalFrames=${totalFrames}\n`);
    return found;
});
electron_1.ipcMain.handle('yt-get-qualities', async () => {
    if (!mainWindow || mainWindow.isDestroyed())
        return [];
    const script = `
      (function() {
        var mp = document.getElementById('movie_player') ||
                 document.querySelector('.html5-video-player');
        if (!mp) return [];

        if (typeof mp.getAvailableQualityLevels === 'function') {
          var levels = mp.getAvailableQualityLevels();
          if (Array.isArray(levels) && levels.length > 0) return levels;
        }
        if (typeof mp.getAvailableQualityData === 'function') {
          var data = mp.getAvailableQualityData();
          if (Array.isArray(data) && data.length > 0) {
            return data.map(function(d) { return d.quality; }).filter(Boolean);
          }
        }
        return [];
      })()
    `;
    const { webContents } = require('electron');
    for (const wc of webContents.getAllWebContents()) {
        const frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : [];
        for (const frame of frames) {
            try {
                const url = frame.url;
                if (url && (url.includes('youtube.com/embed') || url.includes('youtube-nocookie.com/embed'))) {
                    const res = await frame.executeJavaScript(script);
                    if (Array.isArray(res) && res.length > 0)
                        return res;
                }
            }
            catch (e) { }
        }
    }
    return [];
});
const streamingInstances = new Map();
let activeStreamingService = null;
let activeStreamingBounds = null;
let isStreamingFullscreen = false;
let isModalActive = false;
let modalHiddenStreamingService = null;
function getActiveStreamingInstance() {
    if (activeStreamingService && streamingInstances.has(activeStreamingService)) {
        return streamingInstances.get(activeStreamingService);
    }
    const first = streamingInstances.values().next().value;
    return first;
}
let currentStreamingVolume = 50; // 0 to 100
function applyStreamingVolumeToView(view, volume) {
    if (!view || view.webContents.isDestroyed())
        return;
    const fraction = Math.max(0, Math.min(1, volume / 100));
    const isMuted = fraction === 0;
    try {
        view.webContents.setAudioMuted(isMuted);
    }
    catch (e) { }
    view.webContents.executeJavaScript(`
        (function() {
            try {
                var mediaEls = document.querySelectorAll('video, audio');
                mediaEls.forEach(function(el) {
                    el.volume = ${fraction};
                    el.muted = ${isMuted};
                });
            } catch(e) {}
        })();
    `).catch(() => { });
}
function hideStreamingView(service) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    const inst = streamingInstances.get(service);
    if (!inst || !inst.view || inst.view.webContents.isDestroyed())
        return;
    try {
        inst.view.webContents.setAudioMuted(true);
    }
    catch (e) { }
    if (typeof inst.view.setVisible === 'function') {
        inst.view.setVisible(false);
    }
    try {
        inst.view.setBounds({ x: -20000, y: -20000, width: 1, height: 1 });
    }
    catch (e) { }
    if (mainWindow.contentView && typeof mainWindow.contentView.removeChildView === 'function') {
        try {
            mainWindow.contentView.removeChildView(inst.view);
        }
        catch (e) { }
    }
    else if (typeof mainWindow.removeBrowserView === 'function') {
        try {
            mainWindow.removeBrowserView(inst.view);
        }
        catch (e) { }
    }
}
function showStreamingView(service) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    activeStreamingService = service;
    if (isModalActive) {
        modalHiddenStreamingService = service;
        return;
    }
    const inst = streamingInstances.get(service);
    if (!inst || !inst.view || inst.view.webContents.isDestroyed())
        return;
    for (const [s] of streamingInstances.entries()) {
        if (s !== service) {
            hideStreamingView(s);
        }
    }
    if (mainWindow.contentView && typeof mainWindow.contentView.addChildView === 'function') {
        try {
            mainWindow.contentView.addChildView(inst.view);
        }
        catch (e) { }
    }
    else if (typeof mainWindow.addBrowserView === 'function') {
        try {
            mainWindow.addBrowserView(inst.view);
        }
        catch (e) { }
    }
    if (isStreamingFullscreen) {
        const b = mainWindow.getContentBounds();
        inst.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
        if (typeof inst.view.setBorderRadius === 'function') {
            inst.view.setBorderRadius(0);
        }
    }
    else if (activeStreamingBounds) {
        inst.view.setBounds(activeStreamingBounds);
        if (typeof inst.view.setBorderRadius === 'function') {
            inst.view.setBorderRadius(16);
        }
    }
    else {
        const mb = mainWindow.getContentBounds();
        const fallbackBounds = {
            x: 280,
            y: 80,
            width: Math.max(300, mb.width - 600),
            height: Math.max(200, mb.height - 180)
        };
        inst.view.setBounds(fallbackBounds);
        if (typeof inst.view.setBorderRadius === 'function') {
            inst.view.setBorderRadius(16);
        }
    }
    if (typeof inst.view.setVisible === 'function') {
        inst.view.setVisible(true);
    }
    applyStreamingVolumeToView(inst.view, currentStreamingVolume);
    try {
        inst.view.webContents.focus();
    }
    catch (e) { }
}
function enterStreamingFullscreen(inst) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    const target = inst || getActiveStreamingInstance();
    if (!target || !target.view || target.view.webContents.isDestroyed())
        return;
    isStreamingFullscreen = true;
    activeStreamingService = target.service;
    // Attach to contentView if not already attached
    if (mainWindow.contentView && typeof mainWindow.contentView.addChildView === 'function') {
        try {
            mainWindow.contentView.addChildView(target.view);
        }
        catch (e) { }
    }
    else if (typeof mainWindow.addBrowserView === 'function') {
        try {
            mainWindow.addBrowserView(target.view);
        }
        catch (e) { }
    }
    if (typeof target.view.setBorderRadius === 'function') {
        target.view.setBorderRadius(0);
    }
    if (typeof target.view.setVisible === 'function') {
        target.view.setVisible(true);
    }
    if (!mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(true);
    }
    const updateBounds = () => {
        if (!mainWindow || mainWindow.isDestroyed() || !isStreamingFullscreen)
            return;
        const b = mainWindow.getContentBounds();
        target.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
    };
    updateBounds();
    setTimeout(updateBounds, 100);
    setTimeout(updateBounds, 300);
    // Trigger platform DOM fullscreen button only if not already in HTML5 fullscreen
    target.view.webContents.executeJavaScript(`
        (function() {
            if (!document.fullscreenElement) {
                const fsBtn = document.querySelector('[data-uia="control-fullscreen-enter"]') ||
                              document.querySelector('.button-nfplayerFullscreen') ||
                              document.querySelector('.atvwebplayersdk-fullscreen-button') ||
                              document.querySelector('[data-automation-id="fullscreen-button"]');
                if (fsBtn) {
                    fsBtn.click();
                }
            }
        })()
    `).catch(() => { });
}
function leaveStreamingFullscreen(inst) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    isStreamingFullscreen = false;
    if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
    }
    const target = inst || getActiveStreamingInstance();
    if (target && !target.view.webContents.isDestroyed()) {
        if (typeof target.view.setBorderRadius === 'function') {
            target.view.setBorderRadius(16);
        }
        if (activeStreamingBounds) {
            target.view.setBounds(activeStreamingBounds);
        }
        target.view.webContents.executeJavaScript(`
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        `).catch(() => { });
    }
}
function closeStreamingInstance(targetService) {
    const s = targetService || activeStreamingService;
    if (!s)
        return;
    const inst = streamingInstances.get(s);
    if (inst && mainWindow && !mainWindow.isDestroyed()) {
        hideStreamingView(s);
        try {
            inst.view.webContents.destroy?.();
        }
        catch (e) { }
        streamingInstances.delete(s);
        if (activeStreamingService === s) {
            const remaining = Array.from(streamingInstances.keys());
            activeStreamingService = remaining.length > 0 ? remaining[0] : null;
            if (activeStreamingService) {
                showStreamingView(activeStreamingService);
            }
        }
        mainWindow.webContents.send('streaming-event', {
            type: 'closed',
            service: s,
            activeService: activeStreamingService,
            openServices: Array.from(streamingInstances.keys()),
        });
    }
}
electron_1.ipcMain.handle('open-streaming-view', async (_event, options) => {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    const safeBounds = {
        x: Math.max(0, Math.round(options.bounds.x)),
        y: Math.max(0, Math.round(options.bounds.y)),
        width: Math.max(10, Math.round(options.bounds.width)),
        height: Math.max(10, Math.round(options.bounds.height)),
    };
    activeStreamingBounds = safeBounds;
    let targetUrl = options.url?.trim();
    if (!targetUrl) {
        targetUrl = options.service === 'netflix'
            ? 'https://www.netflix.com/browse'
            : 'https://www.primevideo.com';
    }
    // Se já existe uma sessão em memória para este serviço, apenas reexiba e foque
    const existing = streamingInstances.get(options.service);
    if (existing && !existing.view.webContents.isDestroyed()) {
        showStreamingView(options.service);
        if (options.url?.trim() && existing.currentUrl !== targetUrl) {
            existing.currentUrl = targetUrl;
            existing.view.webContents.loadURL(targetUrl).catch(() => { });
        }
        return;
    }
    const partition = 'persist:streaming-session';
    const streamingSession = electron_1.session.fromPartition(partition);
    // Natural Chrome UA without Electron tokens matching the actual Chromium engine version
    const chromeVer = process.versions.chrome || '150.0.7871.250';
    const chromeMajor = chromeVer.split('.')[0] || '150';
    const cleanChromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    streamingSession.setUserAgent(cleanChromeUA);
    // Set modern Client Hints and clean UA for all streaming requests
    streamingSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        headers['User-Agent'] = cleanChromeUA;
        headers['sec-ch-ua'] = `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not_A Brand";v="24"`;
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
        callback({ requestHeaders: headers });
    });
    // Explicitly allow mediaKeySystem (EME / Widevine DRM), but block USB / HID security keys that trigger Windows Hello prompts
    streamingSession.setPermissionCheckHandler((_webContents, permission) => {
        if (permission === 'usb' || permission === 'hid' || permission === 'serial') {
            return false;
        }
        return true;
    });
    streamingSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === 'usb' || permission === 'hid' || permission === 'serial') {
            callback(false);
            return;
        }
        callback(true);
    });
    const streamingPreloadPath = path.join(__dirname, 'streaming-preload.js');
    const webPrefs = {
        session: streamingSession,
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true,
        webSecurity: true,
        preload: fs.existsSync(streamingPreloadPath) ? streamingPreloadPath : undefined,
        autoplayPolicy: 'no-user-gesture-required'
    };
    const radius = options.borderRadius ?? 16;
    let view;
    if (typeof electron_1.WebContentsView === 'function' && mainWindow.contentView && typeof mainWindow.contentView.addChildView === 'function') {
        view = new electron_1.WebContentsView({ webPreferences: webPrefs });
        view.setBackgroundColor('#000000');
        if (typeof view.setBorderRadius === 'function') {
            view.setBorderRadius(radius);
        }
    }
    else {
        view = new electron_1.BrowserView({ webPreferences: webPrefs });
        view.setBackgroundColor('#000000');
    }
    // Forward streaming view console logs to concord-debug.log for diagnostics
    view.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
        fs.appendFileSync(logFile, `[Streaming Console] ${message} (${sourceId}:${line})\n`);
    });
    const instObj = {
        service: options.service,
        view,
        currentUrl: targetUrl
    };
    // TELA CHEIA REAL: quando o player entra em tela cheia HTML5, expandir para 100% da janela/monitor
    view.webContents.on('enter-html-full-screen', () => {
        enterStreamingFullscreen(instObj);
    });
    view.webContents.on('leave-html-full-screen', () => {
        leaveStreamingFullscreen(instObj);
    });
    view.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape' && isStreamingFullscreen) {
            leaveStreamingFullscreen(instObj);
        }
    });
    view.setBounds(safeBounds);
    const applyStyling = () => {
        if (!view || view.webContents.isDestroyed())
            return;
        // Inject styles: thin 6px dark purple custom scrollbar and rounded container clipping
        const customScrollbarCss = `
            * {
                scrollbar-width: thin !important;
                scrollbar-color: rgba(124, 58, 237, 0.45) rgba(10, 10, 20, 0.6) !important;
            }
            ::-webkit-scrollbar {
                width: 6px !important;
                height: 6px !important;
            }
            ::-webkit-scrollbar-track {
                background: rgba(10, 10, 20, 0.6) !important;
            }
            ::-webkit-scrollbar-thumb {
                background: rgba(124, 58, 237, 0.45) !important;
                border-radius: 4px !important;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(124, 58, 237, 0.75) !important;
            }
            ::-webkit-scrollbar-corner {
                background: transparent !important;
            }
            :root, html, body {
                overflow-x: hidden !important;
                border-radius: ${radius}px !important;
            }
        `;
        view.webContents.insertCSS(customScrollbarCss, { cssOrigin: 'user' }).catch(() => { });
        view.webContents.executeJavaScript(`
            (function() {
                try {
                    // Neutralize WebAuthn / Passkeys in DOM to prevent Windows Security prompts
                    if (typeof window.PublicKeyCredential !== 'undefined') {
                        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function() { return Promise.resolve(false); };
                        if (typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
                            window.PublicKeyCredential.isConditionalMediationAvailable = function() { return Promise.resolve(false); };
                        }
                    }
                    if (navigator.credentials) {
                        var origGet = navigator.credentials.get ? navigator.credentials.get.bind(navigator.credentials) : null;
                        navigator.credentials.get = function(options) {
                            if (options && (options.publicKey || options.mediation === 'conditional')) {
                                return Promise.reject(new DOMException("Passkeys are disabled in Concord streaming view", "NotSupportedError"));
                            }
                            return origGet ? origGet(options) : Promise.reject(new DOMException("Not supported", "NotSupportedError"));
                        };
                        var origCreate = navigator.credentials.create ? navigator.credentials.create.bind(navigator.credentials) : null;
                        navigator.credentials.create = function(options) {
                            if (options && options.publicKey) {
                                return Promise.reject(new DOMException("Passkeys are disabled in Concord streaming view", "NotSupportedError"));
                            }
                            return origCreate ? origCreate(options) : Promise.reject(new DOMException("Not supported", "NotSupportedError"));
                        };
                    }
                    if (navigator.usb) { try { Object.defineProperty(navigator, 'usb', { get: function() { return undefined; } }); } catch(e) {} }
                    if (navigator.hid) { try { Object.defineProperty(navigator, 'hid', { get: function() { return undefined; } }); } catch(e) {} }

                    if (navigator.userAgentData) {
                        try {
                            var brands = [
                                { brand: 'Google Chrome', version: '150' },
                                { brand: 'Chromium', version: '150' },
                                { brand: 'Not_A Brand', version: '24' }
                            ];
                            Object.defineProperty(navigator, 'userAgentData', {
                                get: function() {
                                    return {
                                        brands: brands,
                                        mobile: false,
                                        platform: 'Windows',
                                        getHighEntropyValues: function() {
                                            return Promise.resolve({
                                                architecture: 'x86',
                                                bitness: '64',
                                                brands: brands,
                                                mobile: false,
                                                model: '',
                                                platform: 'Windows',
                                                platformVersion: '10.0.0',
                                                uaFullVersion: '150.0.7871.250'
                                            });
                                        }
                                    };
                                }
                            });
                        } catch(e) {}
                    }

                    var style = document.getElementById('concord-streaming-style');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'concord-streaming-style';
                        style.textContent = ${JSON.stringify(customScrollbarCss)};
                        document.head ? document.head.appendChild(style) : document.documentElement.appendChild(style);
                    }
                } catch(e) {}
            })()
        `).catch(() => { });
    };
    view.webContents.on('dom-ready', applyStyling);
    view.webContents.on('did-finish-load', () => {
        applyStyling();
    });
    view.webContents.on('did-navigate', (_e, navUrl) => {
        applyStyling();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('streaming-event', { type: 'navigate', service: options.service, url: navUrl });
        }
    });
    activeStreamingService = options.service;
    streamingInstances.set(options.service, instObj);
    if (!isModalActive) {
        showStreamingView(options.service);
    }
    else {
        modalHiddenStreamingService = options.service;
    }
    fs.appendFileSync(logFile, `[Streaming] Loading ${options.service}: ${targetUrl} (UA: ${cleanChromeUA})\n`);
    await view.webContents.loadURL(targetUrl);
    mainWindow.webContents.send('streaming-event', {
        type: 'opened',
        service: options.service,
        url: targetUrl,
        openServices: Array.from(streamingInstances.keys()),
    });
});
electron_1.ipcMain.on('set-active-media-tab', (_event, tab) => {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (tab === 'youtube') {
        hideStreamingView('netflix');
        hideStreamingView('prime');
        activeStreamingService = null;
        modalHiddenStreamingService = null;
    }
    else if (tab === 'netflix' || tab === 'prime') {
        if (!isModalActive) {
            showStreamingView(tab);
        }
        else {
            modalHiddenStreamingService = tab;
        }
    }
});
electron_1.ipcMain.on('set-modal-active', (_event, active) => {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    isModalActive = !!active;
    if (isModalActive) {
        if (activeStreamingService) {
            modalHiddenStreamingService = activeStreamingService;
        }
        hideStreamingView('netflix');
        hideStreamingView('prime');
    }
    else {
        const toRestore = modalHiddenStreamingService || activeStreamingService;
        if (toRestore && streamingInstances.has(toRestore)) {
            showStreamingView(toRestore);
        }
        modalHiddenStreamingService = null;
    }
});
electron_1.ipcMain.on('resize-streaming-view', (_event, bounds) => {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (bounds.width <= 0 || bounds.height <= 0)
        return;
    const safeBounds = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
    };
    activeStreamingBounds = safeBounds;
    if (!isStreamingFullscreen && activeStreamingService && !isModalActive) {
        const inst = streamingInstances.get(activeStreamingService);
        if (inst && typeof inst.view.setVisible === 'function') {
            inst.view.setBounds(safeBounds);
            inst.view.setVisible(true);
        }
    }
});
electron_1.ipcMain.on('close-streaming-view', (_event, service) => {
    closeStreamingInstance(service);
});
electron_1.ipcMain.on('set-streaming-volume', (_event, volume) => {
    currentStreamingVolume = typeof volume === 'number' ? volume : 50;
    for (const inst of streamingInstances.values()) {
        if (inst.view) {
            applyStreamingVolumeToView(inst.view, currentStreamingVolume);
        }
    }
});
electron_1.ipcMain.on('streaming-command', (_event, command, payload) => {
    const targetService = payload?.service || activeStreamingService;
    const inst = targetService ? streamingInstances.get(targetService) : getActiveStreamingInstance();
    if (!inst || !inst.view || inst.view.webContents.isDestroyed())
        return;
    const wc = inst.view.webContents;
    if (command === 'volume') {
        const rawVol = typeof payload === 'number' ? payload : payload?.volume;
        if (typeof rawVol === 'number') {
            currentStreamingVolume = rawVol;
            applyStreamingVolumeToView(inst.view, currentStreamingVolume);
        }
    }
    else if (command === 'play') {
        wc.focus();
        // 1. Hardware Space key event
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        // 2. DOM selectors for Prime Video & Netflix
        wc.executeJavaScript(`
            (function() {
                const v = document.querySelector('video');
                if (v && v.paused) {
                    v.play().catch(() => {});
                }
                const playBtn = document.querySelector('[data-uia="control-play-pause-play"]') ||
                                document.querySelector('.button-nfplayerPlay') ||
                                document.querySelector('.atvwebplayersdk-playpause-button') ||
                                document.querySelector('[data-automation-id="playback-play-pause"]') ||
                                document.querySelector('.pausedOverlayButton') ||
                                document.querySelector('button[aria-label*="Reproduzir"]') ||
                                document.querySelector('button[aria-label*="Play"]');
                if (playBtn) playBtn.click();
            })()
        `).catch(() => { });
    }
    else if (command === 'pause') {
        wc.focus();
        // 1. Hardware Space key event
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        // 2. DOM selectors for Prime Video & Netflix
        wc.executeJavaScript(`
            (function() {
                const v = document.querySelector('video');
                if (v && !v.paused) {
                    v.pause();
                }
                const pauseBtn = document.querySelector('[data-uia="control-play-pause-pause"]') ||
                                 document.querySelector('.button-nfplayerPause') ||
                                 document.querySelector('.atvwebplayersdk-playpause-button') ||
                                 document.querySelector('[data-automation-id="playback-play-pause"]') ||
                                 document.querySelector('button[aria-label*="Pausar"]') ||
                                 document.querySelector('button[aria-label*="Pause"]');
                if (pauseBtn) pauseBtn.click();
            })()
        `).catch(() => { });
    }
    else if (command === 'skip') {
        wc.focus();
        // 1. Hardware Right arrow key event (10 seconds fast forward on both Netflix and Prime Video)
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
        // 2. DOM selectors for 10-second fast forward button + currentTime advance
        wc.executeJavaScript(`
            (function() {
                const ff = document.querySelector('[data-uia="control-fastforward-10"]') ||
                           document.querySelector('.button-nfplayerFastForward10') ||
                           document.querySelector('.atvwebplayersdk-fastforward-button') ||
                           document.querySelector('[data-automation-id="fast-forward-button"]') ||
                           document.querySelector('button[aria-label*="Avançar 10"]') ||
                           document.querySelector('button[aria-label*="Fast forward"]') ||
                           document.querySelector('button[aria-label*="10s"]') ||
                           document.querySelector('button[aria-label*="10 s"]');
                if (ff) {
                    ff.click();
                    return;
                }
                const v = document.querySelector('video');
                if (v) {
                    v.currentTime = Math.min((v.duration || Infinity), v.currentTime + 10);
                }
            })()
        `).catch(() => { });
    }
    else if (command === 'seek' && typeof payload?.time === 'number') {
        wc.executeJavaScript(`
            (function() {
                const v = document.querySelector('video');
                if (v) v.currentTime = ${payload.time};
            })()
        `).catch(() => { });
    }
    else if (command === 'fullscreen') {
        if (isStreamingFullscreen) {
            leaveStreamingFullscreen(inst);
        }
        else {
            enterStreamingFullscreen(inst);
        }
    }
    else if (command === 'exit' || command === 'back') {
        wc.executeJavaScript(`
            (function() {
                const href = window.location.href;
                const isNetflixWatch = href.includes('netflix.com/watch');
                const isPrimeWatch = href.includes('/player') || href.includes('/gp/video/detail') || href.includes('/detail');
                const hasBackBtn = !!(
                    document.querySelector('[data-uia="control-back"]') ||
                    document.querySelector('.button-nfplayerBack') ||
                    document.querySelector('.atvwebplayersdk-back-button') ||
                    document.querySelector('[data-automation-id="back-button"]') ||
                    document.querySelector('.backButton')
                );
                return {
                    isWatching: isNetflixWatch || isPrimeWatch || hasBackBtn,
                    href: href
                };
            })()
        `).then((res) => {
            if (!res || !res.isWatching) {
                // Se já estiver fora do filme/série (no catálogo ou home), feche a transmissão
                closeStreamingInstance(inst.service);
            }
            else {
                // Se estiver assistindo ao filme/série, saia do filme e volte ao catálogo
                wc.executeJavaScript(`
                    (function() {
                        const netflixBack = document.querySelector('[data-uia="control-back"]') ||
                                            document.querySelector('.button-nfplayerBack');
                        if (netflixBack) { netflixBack.click(); return; }
                        const primeBack = document.querySelector('.atvwebplayersdk-back-button') ||
                                          document.querySelector('[data-automation-id="back-button"]') ||
                                          document.querySelector('.backButton');
                        if (primeBack) { primeBack.click(); return; }
                        const href = window.location.href;
                        if (href.includes('netflix.com')) {
                            window.location.href = 'https://www.netflix.com/browse';
                        } else {
                            window.location.href = 'https://www.primevideo.com';
                        }
                    })()
                `).catch(() => { });
            }
        }).catch(() => {
            closeStreamingInstance(inst.service);
        });
        const streamingSession = electron_1.session.fromPartition('persist:streaming-session');
        streamingSession.cookies.flushStore().catch(() => { });
    }
});
