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
const isDev = !electron_1.app.isPackaged;
// Allow autoplay without user gesture for YouTube
electron_1.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
electron_1.app.commandLine.appendSwitch('disable-gesture-requirement-for-media-playback');
electron_1.app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
// Disable web security restrictions that block YouTube iframe audio
electron_1.app.commandLine.appendSwitch('disable-web-security');
electron_1.app.commandLine.appendSwitch('allow-running-insecure-content');
electron_1.app.commandLine.appendSwitch('disable-site-isolation-trials');
// Ensure audio is not silenced by the renderer
electron_1.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Strip Electron from user-agent globally so YouTube doesn't detect and block the embed
electron_1.app.userAgentFallback = electron_1.app.userAgentFallback
    .replace(/Electron\/\S+\s*/g, '')
    .replace(/concord\/\S+\s*/g, '');
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
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#0e0e18',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            autoplayPolicy: 'no-user-gesture-required'
        },
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, isDev ? '../public/logo.png' : '../dist/logo.png'),
    });
    // Spoof User-Agent to bypass YouTube's Electron blocks
    // Already done globally via app.userAgentFallback
    const url = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
        : `http://127.0.0.1:${localServerPort}`;
    if (isDev) {
        mainWindow.loadURL(url);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadURL(url);
    }
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (pendingDeepLink) {
            mainWindow.webContents.send('deep-link', pendingDeepLink);
            pendingDeepLink = null;
        }
        if (process.platform === 'win32' || process.platform === 'linux') {
            const url = process.argv.find(arg => arg.startsWith('concord://'));
            if (url) {
                mainWindow.webContents.send('deep-link', url);
            }
        }
    });
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
    mainWindow.on('closed', () => {
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
electron_1.app.whenReady().then(() => {
    fs.appendFileSync(logFile, 'app.whenReady() fired!\n');
    // Handle media permissions for WebRTC
    electron_1.session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'display-capture', 'microphone', 'camera'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        }
        else {
            callback(false);
        }
    });
    // Handle screen share requests natively
    // Pass audio: 'loopback' so the system audio is captured alongside the screen video.
    // Without this, getDisplayMedia({ audio: true }) from the renderer gets no audio track.
    electron_1.session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        electron_1.desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            if (!sources.length) {
                console.error('No desktop sources found');
                // @ts-ignore – Electron types don't allow null but it's the documented way to reject
                callback({ video: null, audio: null });
                return;
            }
            callback({ video: sources[0], audio: 'loopback' });
        }).catch((err) => {
            console.error('Error getting desktop sources:', err);
            // @ts-ignore
            callback({ video: null, audio: null });
        });
    });
    const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    // Override UA globally for the entire session so ALL requests (including YouTube
    // iframe sub-frames) look like Chrome, never Electron.
    electron_1.session.defaultSession.setUserAgent(CHROME_UA);
    fs.appendFileSync(logFile, `[Main] Session UA set to Chrome\n`);
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
    electron_1.session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*.youtube.com/*', 'https://*.ytimg.com/*', 'https://*.googlevideo.com/*'] }, (details, callback) => {
        const headers = { ...details.responseHeaders };
        // Remove X-Frame-Options so the YT iframe embeds without restriction
        delete headers['x-frame-options'];
        delete headers['X-Frame-Options'];
        // Remove CSP that blocks autoplay / media
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        // Allow cross-origin so audio can be piped
        headers['access-control-allow-origin'] = ['*'];
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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            autoplayPolicy: 'no-user-gesture-required'
        }
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
