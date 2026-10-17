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
try {
    fs.appendFileSync(logFile, `\n--- [PID ${process.pid}] Electron Started at ${new Date().toISOString()} ---\n`);
}
catch { }
const electron_updater_1 = require("electron-updater");
// removed url import
// In a CommonJS build we don't have import.meta.url, but we are writing TS mapped to commonjs usually for electron, or ESM if packaged cleanly.
const path = require('path');
electron_1.app.name = 'Concord';
const isDev = !electron_1.app.isPackaged;
const isWindowsStore = Boolean(process.windowsStore ||
    process.execPath.toLowerCase().includes('windowsapps') ||
    process.env.STORE_APP === 'true');
// No Windows normal (NSIS/exe), definimos o AUMID registrado no atalho para agrupar na barra de tarefas.
// No Windows Store (AppX/MSIX), o Windows gerencia o AUMID a partir do AppxManifest.xml automaticamente;
// sobrescrever o AUMID desassocia o processo do pacote da Store e reverte o ícone da barra de tarefas para o padrão.
if (process.platform === 'win32' && !isWindowsStore) {
    electron_1.app.setAppUserModelId('com.concord.desktop');
}
// Register concord:// deep link protocol client
function registerProtocolClient() {
    try {
        if (process.defaultApp || isDev) {
            if (process.argv.length >= 2) {
                electron_1.app.setAsDefaultProtocolClient('concord', process.execPath, [path.resolve(process.argv[1])]);
            }
            else {
                electron_1.app.setAsDefaultProtocolClient('concord', process.execPath);
            }
        }
        else {
            electron_1.app.setAsDefaultProtocolClient('concord');
        }
        fs.appendFileSync(logFile, `[Protocol] Registered concord:// protocol client.\n`);
    }
    catch (err) {
        fs.appendFileSync(logFile, `[Protocol] Failed to register protocol client: ${err?.message || err}\n`);
    }
}
registerProtocolClient();
function extractDeepLinkUrl(argv) {
    if (!argv || !Array.isArray(argv))
        return null;
    for (const rawArg of argv) {
        if (!rawArg)
            continue;
        const clean = rawArg.trim().replace(/^["']|["']$/g, '');
        if (clean.startsWith('concord://')) {
            return clean;
        }
    }
    return null;
}
let pendingDeepLink = extractDeepLinkUrl(process.argv);
if (pendingDeepLink) {
    fs.appendFileSync(logFile, `[DeepLink] Cold start URL detected: ${pendingDeepLink}\n`);
}
function sendDeepLinkToRenderer(rawUrl) {
    if (!rawUrl)
        return;
    const url = rawUrl.trim().replace(/^["']|["']$/g, '');
    if (!url.startsWith('concord://'))
        return;
    fs.appendFileSync(logFile, `[DeepLink] sendDeepLinkToRenderer: ${url}\n`);
    pendingDeepLink = url;
    showMainWindow();
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('deep-link', url);
    }
}
function getAppIconPath() {
    const iconFile = process.platform === 'win32' ? 'icon.ico' : 'logo.png';
    const candidates = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', iconFile),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'public', iconFile),
        path.join(process.resourcesPath, iconFile),
        path.join(path.dirname(electron_1.app.getAppPath()), 'build', iconFile),
        path.join(__dirname, isDev ? '../public' : '../dist', iconFile),
        path.join(__dirname, '../public', iconFile),
        path.join(__dirname, '../dist', iconFile),
        path.join(electron_1.app.getAppPath(), isDev ? 'public' : 'dist', iconFile),
        path.join(electron_1.app.getAppPath(), 'public', iconFile),
        path.join(electron_1.app.getAppPath(), iconFile),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'logo.png'),
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
// Desativa recursos conflitantes que interceptam teclas de mídia e autenticação WebAuthn
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
let tray = null;
let isQuitting = false;
const appStartTime = Date.now();
const streamingInstances = new Map();
let activeStreamingService = null;
let activeStreamingBounds = null;
let isStreamingFullscreen = false;
let isModalActive = false;
let modalHiddenStreamingService = null;
const startHidden = !isDev && process.argv.includes('--hidden');
function showMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
    else {
        createWindow(true);
    }
}
function createTray() {
    if (tray)
        return;
    const appIcon = getAppIconPath();
    if (!appIcon || !fs.existsSync(appIcon))
        return;
    try {
        tray = new electron_1.Tray(appIcon);
        tray.setToolTip('Concord');
        const contextMenu = electron_1.Menu.buildFromTemplate([
            {
                label: 'Abrir Concord',
                click: () => {
                    showMainWindow();
                }
            },
            {
                label: 'Verificar atualizações',
                click: () => {
                    if (!isDev) {
                        electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Sair do Concord',
                click: () => {
                    isQuitting = true;
                    electron_1.app.quit();
                }
            }
        ]);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                    mainWindow.hide();
                }
                else {
                    showMainWindow();
                }
            }
            else {
                showMainWindow();
            }
        });
        tray.on('double-click', () => {
            showMainWindow();
        });
    }
    catch (err) {
        fs.appendFileSync(logFile, `[Tray] Error creating tray: ${err}\n`);
    }
}
function setupAutoLaunch() {
    if (process.platform === 'win32' && !isDev) {
        try {
            const prefs = readPrefsFromDisk();
            const currentSettings = electron_1.app.getLoginItemSettings();
            // Determina se deve iniciar com o Windows:
            // 1. Se o usuário já definiu explicitamente 'openAtLogin' nas preferências salvas, respeitar rigorosamente.
            // 2. Se ainda não há preferência gravada, respeitar o estado atual do sistema operacional (app.getLoginItemSettings().openAtLogin).
            // NUNCA forçar openAtLogin: true incondicionalmente para evitar reativação indesejada após atualizações.
            let shouldOpenAtLogin;
            if (prefs && prefs.openAtLogin !== undefined) {
                shouldOpenAtLogin = prefs.openAtLogin === true || prefs.openAtLogin === 'true';
            }
            else {
                shouldOpenAtLogin = Boolean(currentSettings.openAtLogin);
            }
            if (currentSettings.openAtLogin !== shouldOpenAtLogin) {
                electron_1.app.setLoginItemSettings({
                    openAtLogin: shouldOpenAtLogin,
                    openAsHidden: true,
                    path: process.execPath,
                    args: ['--hidden']
                });
                fs.appendFileSync(logFile, `[AutoLaunch] Synced login item settings: openAtLogin=${shouldOpenAtLogin}\n`);
            }
            else {
                fs.appendFileSync(logFile, `[AutoLaunch] Login item settings already in desired state: openAtLogin=${shouldOpenAtLogin}\n`);
            }
        }
        catch (e) {
            fs.appendFileSync(logFile, `[AutoLaunch] Error setting login items: ${e}\n`);
        }
    }
}
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
// Tamanho mínimo da janela principal para evitar quebras no layout responsivo
const MIN_WINDOW_WIDTH = 1152;
const MIN_WINDOW_HEIGHT = 864;
function createWindow(showWindow = !process.argv.includes('--hidden')) {
    fs.appendFileSync(logFile, `createWindow called! isDev=${isDev}, showWindow=${showWindow}\n`);
    const appIconPath = getAppIconPath();
    const appIconNative = (appIconPath && fs.existsSync(appIconPath))
        ? electron_1.nativeImage.createFromPath(appIconPath)
        : undefined;
    const windowIcon = (appIconNative && !appIconNative.isEmpty()) ? appIconNative : appIconPath;
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        backgroundColor: '#0e0e18',
        show: showWindow,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            autoplayPolicy: 'no-user-gesture-required'
        },
        frame: false,
        titleBarStyle: 'hidden',
        icon: windowIcon,
    });
    if (showWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
    if (windowIcon) {
        try {
            mainWindow.setIcon(windowIcon);
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
        if (windowIcon) {
            try {
                mainWindow?.setIcon(windowIcon);
            }
            catch (e) { }
        }
        if (showWindow) {
            mainWindow?.maximize();
            mainWindow?.show();
            mainWindow?.focus();
            if (isDev || process.argv.includes('--inspect') || process.argv.includes('--dev')) {
                mainWindow?.webContents.openDevTools();
            }
        }
        if (pendingDeepLink) {
            mainWindow?.webContents.send('deep-link', pendingDeepLink);
        }
    });
    mainWindow.webContents.on('did-finish-load', () => {
        if (pendingDeepLink) {
            mainWindow?.webContents.send('deep-link', pendingDeepLink);
        }
    });
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
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
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        fs.appendFileSync(logFile, `[Main] render-process-gone: reason=${details.reason}, exitCode=${details.exitCode}\n`);
        console.error('[Main] render-process-gone:', details);
        if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
        }
    });
    mainWindow.webContents.on('unresponsive', () => {
        fs.appendFileSync(logFile, `[Main] mainWindow became unresponsive\n`);
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
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
            mainWindow?.webContents.toggleDevTools();
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
    if (isWindowsStore) {
        fs.appendFileSync(logFile, 'Running under Microsoft Store / WindowsApps. autoUpdater disabled.\n');
        if (window && !window.isDestroyed()) {
            window.webContents.send('update-message', 'Atualizações gerenciadas automaticamente pela Microsoft Store.');
        }
        return;
    }
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
            window.webContents.send('update-downloaded', info.version || '');
            window.webContents.send('update-message', `Versão ${info.version || ''} baixada! Clique em "Reiniciar para Atualizar".`);
        }
        try {
            new electron_1.Notification({
                title: 'Nova atualização pronta para instalar',
                body: `A versão ${info.version || ''} do Concord foi baixada e está pronta para ser instalada.`
            }).show();
        }
        catch { }
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
// Local Loopback Server for OAuth & Password Recovery Callback (port 54321)
let authLoopbackServer = null;
function startAuthLoopbackServer() {
    if (authLoopbackServer)
        return;
    try {
        const server = http.createServer((req, res) => {
            const reqUrl = req.url || '';
            // Endpoint to receive tokens extracted from hash via POST
            if (req.method === 'POST' && reqUrl.startsWith('/auth/token')) {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body || '{}');
                        const hash = data.hash || '';
                        const search = data.search || '';
                        const isRecovery = hash.includes('type=recovery') || search.includes('type=recovery') || (data.type === 'recovery');
                        const pathPrefix = isRecovery ? 'reset-password' : 'auth/callback';
                        const fullUrl = `concord://${pathPrefix}${search}${hash}`;
                        sendDeepLinkToRenderer(fullUrl);
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(JSON.stringify({ ok: true }));
                    }
                    catch (err) {
                        res.writeHead(400);
                        res.end();
                    }
                });
                return;
            }
            // Handle CORS preflight
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                res.end();
                return;
            }
            // Callback landing page (handles OAuth callback and Password Recovery)
            if (reqUrl.startsWith('/callback') || reqUrl.startsWith('/auth/callback') || reqUrl.startsWith('/reset-password') || reqUrl === '/' || reqUrl.startsWith('/?')) {
                try {
                    const parsedUrl = new URL(reqUrl, 'http://127.0.0.1:54321');
                    const sp = parsedUrl.searchParams;
                    const isRecovery = sp.get('type') === 'recovery' || reqUrl.includes('type=recovery') || parsedUrl.hash.includes('type=recovery') || reqUrl.startsWith('/reset-password');
                    const hasAuthPayload = Boolean(sp.get('code') || sp.get('access_token')) || isRecovery;
                    const hasAuthError = Boolean(sp.get('error') || sp.get('error_description'));
                    if (hasAuthPayload || hasAuthError) {
                        const pathPrefix = isRecovery ? 'reset-password' : 'auth/callback';
                        const fullUrl = `concord://${pathPrefix}${parsedUrl.search}${parsedUrl.hash}`;
                        sendDeepLinkToRenderer(fullUrl);
                    }
                }
                catch { }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Concord</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: #0e0e18;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #181b24;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    }
    .icon {
      width: 56px;
      height: 56px;
      background: rgba(124, 92, 255, 0.15);
      border: 1px solid rgba(124, 92, 255, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 18px;
      font-size: 26px;
    }
    h2 {
      color: #f1f2f6;
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 10px;
    }
    p {
      color: #949ba4;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .btn {
      display: inline-block;
      background: #7c5cff;
      color: #fff;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s, transform 0.1s;
    }
    .btn:hover {
      background: #6842ff;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" id="statusIcon">⏳</div>
    <h2 id="statusTitle">Processando...</h2>
    <p id="statusText">Aguarde um instante.</p>
    <a id="openBtn" class="btn" href="#" style="display:none">Abrir Concord Desktop</a>
  </div>
  <script>
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const params = new URLSearchParams(search);
    new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash).forEach((v, k) => { if (!params.has(k)) params.set(k, v); });

    const isRecovery = params.get('type') === 'recovery' || hash.includes('type=recovery') || search.includes('type=recovery') || window.location.pathname.includes('reset-password');
    const authError = params.get('error');
    const authErrorDescription = params.get('error_description');
    const hasAuthPayload = Boolean(params.get('code') || params.get('access_token')) || isRecovery;

    const icon = document.getElementById('statusIcon');
    const title = document.getElementById('statusTitle');
    const text = document.getElementById('statusText');
    const btn = document.getElementById('openBtn');

    function notifyApp() {
      fetch('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, search, type: isRecovery ? 'recovery' : undefined })
      }).catch(() => {});
    }

    if (authError || authErrorDescription) {
      // Cancelamento/erro: NUNCA exibir sucesso. Apenas informa o app para sair do estado de carregamento.
      const cancelled = authError === 'access_denied';
      icon.textContent = cancelled ? '↩️' : '⚠️';
      title.textContent = cancelled ? 'Login cancelado' : 'Não foi possível autenticar';
      text.textContent = cancelled
        ? 'Você cancelou o login com o Google. Pode fechar esta aba e voltar ao Concord.'
        : (authErrorDescription || 'Ocorreu um erro durante a autenticação. Tente novamente pelo Concord.');
      notifyApp();
    } else if (hasAuthPayload) {
      const deepLink = (isRecovery ? 'concord://reset-password' : 'concord://auth/callback') + search + hash;
      icon.textContent = isRecovery ? '🔑' : '✨';
      title.textContent = isRecovery ? 'Recuperação de Senha' : 'Autenticado com Sucesso!';
      text.textContent = isRecovery
        ? 'Token de recuperação validado. Retornando ao aplicativo Concord...'
        : 'Sua conta Google foi conectada ao Concord. Retornando ao aplicativo desktop...';
      btn.textContent = 'Abrir Concord Desktop';
      btn.href = deepLink;
      btn.style.display = 'inline-block';
      notifyApp();
      window.location.href = deepLink;
      setTimeout(() => {
        try { window.close(); } catch (e) {}
      }, 1200);
    } else {
      icon.textContent = 'ℹ️';
      title.textContent = 'Nenhuma autenticação pendente';
      text.textContent = 'Inicie o login ou recuperação pelo Concord para continuar.';
    }
  </script>
</body>
</html>`);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        server.on('error', (err) => {
            fs.appendFileSync(logFile, `[AuthLoopback] Server error: ${err.message}\n`);
        });
        server.listen(54321, '127.0.0.1', () => {
            authLoopbackServer = server;
            fs.appendFileSync(logFile, `[AuthLoopback] Escutando em http://127.0.0.1:54321/callback\n`);
        });
    }
    catch (err) {
        fs.appendFileSync(logFile, `[AuthLoopback] Start error: ${err.message}\n`);
    }
}
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    try {
        fs.appendFileSync(logFile, `[PID ${process.pid}] Secondary instance detected. Exiting immediately.\n`);
    }
    catch { }
    electron_1.app.quit();
    process.exit(0);
}
electron_1.app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    fs.appendFileSync(logFile, `[second-instance] commandLine=${JSON.stringify(commandLine)}\n`);
    showMainWindow();
    const rawUrl = extractDeepLinkUrl(commandLine);
    if (rawUrl) {
        sendDeepLinkToRenderer(rawUrl);
    }
});
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    fs.appendFileSync(logFile, `[open-url] url=${url}\n`);
    sendDeepLinkToRenderer(url);
});
fs.appendFileSync(logFile, 'Waiting for app.whenReady()...\n');
let pipWindow = null;
electron_1.app.whenReady().then(async () => {
    fs.appendFileSync(logFile, 'app.whenReady() fired!\n');
    startAuthLoopbackServer();
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
    let latestCapturerSources = [];
    electron_1.ipcMain.handle('get-screen-sources', async () => {
        try {
            // Garantir que nenhuma WebContentsView de streaming fique sobrepondo o modal de escolha de tela
            if (mainWindow && !mainWindow.isDestroyed()) {
                isModalActive = true;
                if (activeStreamingService) {
                    modalHiddenStreamingService = activeStreamingService;
                }
                hideStreamingView('netflix');
                hideStreamingView('prime');
                hideStreamingView('crunchyroll');
            }
            const sources = await electron_1.desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 320, height: 180 },
                fetchWindowIcons: true,
            });
            latestCapturerSources = sources;
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
            const isRecent = selectedScreenSource && (Date.now() - selectedScreenSource.timestamp < 60000);
            const targetId = isRecent ? selectedScreenSource?.sourceId : null;
            const wantAudio = (isRecent && selectedScreenSource ? selectedScreenSource.withAudio : true) && request.audioRequested;
            fs.appendFileSync(logFile, `[ScreenShare-Main] Handler invoked: audioRequested=${request.audioRequested}, isRecent=${isRecent}, targetId=${targetId}, wantAudio=${wantAudio}\n`);
            let chosen;
            if (targetId && latestCapturerSources.length > 0) {
                chosen = latestCapturerSources.find((s) => s.id === targetId);
            }
            if (!chosen) {
                const freshSources = await electron_1.desktopCapturer.getSources({
                    types: ['screen', 'window'],
                    thumbnailSize: { width: 150, height: 150 },
                });
                latestCapturerSources = freshSources;
                chosen = (targetId ? freshSources.find((s) => s.id === targetId) : null)
                    || freshSources.find((s) => s.id.startsWith('screen:'))
                    || freshSources[0];
            }
            if (!chosen) {
                console.error('[Main] No desktop sources found');
                fs.appendFileSync(logFile, `[ScreenShare-Main] No desktop sources found!\n`);
                // @ts-ignore
                callback({});
                return;
            }
            const isWindow = chosen.id.startsWith('window:');
            const isScreen = chosen.id.startsWith('screen:');
            const audioStream = wantAudio ? 'loopback' : undefined;
            fs.appendFileSync(logFile, `[ScreenShare-Main] Calling callback with video=${chosen.id} (isWindow=${isWindow}, isScreen=${isScreen}, name=${chosen.name}), audio=${audioStream}\n`);
            try {
                // @ts-ignore
                callback({
                    video: chosen,
                    audio: audioStream,
                });
            }
            catch (cbErr) {
                fs.appendFileSync(logFile, `[ScreenShare-Main] Callback with audio=${audioStream} failed, falling back to video only: ${cbErr}\n`);
                try {
                    // @ts-ignore
                    callback({ video: chosen });
                }
                catch { }
            }
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
    // Single unified filter for webRequest handlers in defaultSession
    // Note: Electron only allows ONE listener per webRequest event on a session.
    // Registering multiple listeners overwrites previous ones!
    const unifiedRequestFilter = {
        urls: [
            'https://youtube.com/*',
            'https://*.youtube.com/*',
            'https://youtube-nocookie.com/*',
            'https://*.youtube-nocookie.com/*',
            'https://ytimg.com/*',
            'https://*.ytimg.com/*',
            'https://googlevideo.com/*',
            'https://*.googlevideo.com/*',
            'https://ggpht.com/*',
            'https://*.ggpht.com/*',
            'https://api.giphy.com/*',
            'https://*.giphy.com/*',
            'https://giphy.com/*'
        ]
    };
    // Unified onBeforeSendHeaders: handles both YouTube and Giphy headers
    electron_1.session.defaultSession.webRequest.onBeforeSendHeaders(unifiedRequestFilter, (details, callback) => {
        const url = details.url;
        const isYouTube = url.includes('youtube.com') ||
            url.includes('youtube-nocookie.com') ||
            url.includes('ytimg.com') ||
            url.includes('googlevideo.com') ||
            url.includes('ggpht.com');
        const isGiphy = url.includes('giphy.com');
        if (isYouTube) {
            // Only spoof Referer for the iframe HTML itself.
            // Do not spoof for xhr/fetch, as it breaks YouTube's internal API CSRF checks (403 Forbidden).
            if (details.resourceType === 'subFrame' || details.resourceType === 'mainFrame') {
                details.requestHeaders['Referer'] = 'https://concord-repo.pages.dev/';
            }
            // Always override UA to Chrome for YouTube requests to avoid Electron blocks
            details.requestHeaders['User-Agent'] = CHROME_UA;
            fs.appendFileSync(logFile, `[YT-req] [${details.resourceType}] ${details.url.substring(0, 80)}\n`);
        }
        else if (isGiphy) {
            details.requestHeaders['Origin'] = 'https://concord-repo.pages.dev';
            details.requestHeaders['Referer'] = 'https://concord-repo.pages.dev/';
            details.requestHeaders['User-Agent'] = CHROME_UA;
        }
        callback({ requestHeaders: details.requestHeaders });
    });
    // Unified onHeadersReceived: handles both YouTube and Giphy CORS/security headers
    electron_1.session.defaultSession.webRequest.onHeadersReceived(unifiedRequestFilter, (details, callback) => {
        const url = details.url;
        const isYouTube = url.includes('youtube.com') ||
            url.includes('youtube-nocookie.com') ||
            url.includes('ytimg.com') ||
            url.includes('googlevideo.com') ||
            url.includes('ggpht.com');
        const isGiphy = url.includes('giphy.com');
        const headers = { ...details.responseHeaders };
        if (isYouTube) {
            // Remove X-Frame-Options and Content-Security-Policy (any casing) so YT iframe embeds freely
            for (const key of Object.keys(headers)) {
                const lower = key.toLowerCase();
                if (lower === 'x-frame-options' || lower === 'content-security-policy') {
                    delete headers[key];
                }
            }
            if (url.includes('googlevideo.com')) {
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
        }
        else if (isGiphy) {
            headers['access-control-allow-origin'] = ['*'];
            delete headers['access-control-allow-credentials'];
        }
        callback({ responseHeaders: headers });
    });
    createTray();
    setupAutoLaunch();
    try {
        const initialPrefs = readPrefsFromDisk();
        registerGlobalKeybinds(initialPrefs);
    }
    catch (err) {
        fs.appendFileSync(logFile, `[Main] Initial keybind registration error: ${err}\n`);
    }
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
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
electron_1.app.on('will-quit', () => {
    try {
        electron_1.globalShortcut.unregisterAll();
    }
    catch { }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    showMainWindow();
});
electron_1.ipcMain.handle('open-google-auth', async (_event, authUrl) => {
    try {
        fs.appendFileSync(logFile, `[GoogleAuth] Opening external browser: ${authUrl.substring(0, 100)}\n`);
        await electron_1.shell.openExternal(authUrl);
        return { success: true };
    }
    catch (err) {
        fs.appendFileSync(logFile, `[GoogleAuth] Error opening browser: ${err.message}\n`);
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.on('cancel-google-auth', () => {
    fs.appendFileSync(logFile, `[GoogleAuth] Canceled by user\n`);
});
// Basic IPC handlers
electron_1.ipcMain.handle('get-app-version', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle('get-initial-deep-link', () => {
    return pendingDeepLink;
});
electron_1.ipcMain.on('copy-to-clipboard', (event, text) => {
    electron_1.clipboard.writeText(text);
});
electron_1.ipcMain.handle('copy-image-to-clipboard', async (_event, dataUrlOrUrl) => {
    try {
        if (!dataUrlOrUrl)
            return false;
        let img;
        if (dataUrlOrUrl.startsWith('data:')) {
            img = electron_1.nativeImage.createFromDataURL(dataUrlOrUrl);
        }
        else if (dataUrlOrUrl.startsWith('http://') || dataUrlOrUrl.startsWith('https://')) {
            const response = await electron_1.net.fetch(dataUrlOrUrl);
            const arrayBuffer = await response.arrayBuffer();
            img = electron_1.nativeImage.createFromBuffer(Buffer.from(arrayBuffer));
        }
        else {
            img = electron_1.nativeImage.createFromPath(dataUrlOrUrl);
        }
        if (!img.isEmpty()) {
            electron_1.clipboard.writeImage(img);
            return true;
        }
        return false;
    }
    catch (err) {
        console.error('[Main] copy-image-to-clipboard error:', err);
        return false;
    }
});
// Native Windows Notifications for Chat Messages
electron_1.ipcMain.on('show-chat-notification', async (_event, data) => {
    try {
        if (!data.forceShow) {
            // Ignorar mensagens antigas que foram enviadas antes do Concord ser aberto
            if (typeof data.sentAt === 'number' && data.sentAt > 0 && data.sentAt < appStartTime) {
                return;
            }
            // Se a janela principal estiver visível, em foco e não minimizada, NÃO disparar notificação nativa
            if (mainWindow && !mainWindow.isDestroyed()) {
                const isFocused = mainWindow.isFocused() && !mainWindow.isMinimized() && mainWindow.isVisible();
                if (isFocused) {
                    return;
                }
            }
        }
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
            showMainWindow();
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
    const MIN_WIDTH = 280;
    const MIN_HEIGHT = 200;
    const MAX_WIDTH = Math.min(1280, Math.round(width * 0.85));
    const MAX_HEIGHT = Math.min(800, Math.round(height * 0.85));
    const appIcon = getAppIconPath();
    pipWindow = new electron_1.BrowserWindow({
        width: 380,
        height: 320,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        maxWidth: MAX_WIDTH,
        maxHeight: MAX_HEIGHT,
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
    pipWindow.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
    pipWindow.setMaximumSize(MAX_WIDTH, MAX_HEIGHT);
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
electron_1.ipcMain.handle('is-windows-store', () => isWindowsStore);
electron_1.ipcMain.on('check-for-updates', () => {
    if (isDev) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-message', 'Atualizações desabilitadas no modo de desenvolvimento.');
        }
        return;
    }
    if (isWindowsStore) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-message', 'Atualizações gerenciadas automaticamente pela Microsoft Store.');
        }
        return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-message', 'Verificando atualizações...');
    }
    electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-message', 'Erro ao verificar atualizações: ' + (err?.message || err));
        }
    });
});
electron_1.ipcMain.on('install-update', () => {
    if (isWindowsStore || isDev)
        return;
    fs.appendFileSync(logFile, 'install-update called. Performing silent background update via quitAndInstall(true, true).\n');
    isQuitting = true;
    // true, true: Instalação silenciosa sem tela nativa do NSIS e reinicia o aplicativo automaticamente com tema do Concord
    try {
        electron_updater_1.autoUpdater.quitAndInstall(true, true);
    }
    catch (e) {
        fs.appendFileSync(logFile, `autoUpdater.quitAndInstall error: ${e?.message || e}\n`);
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
// Saved to %APPDATA%\ConcordUserData\prefs.json (or user-preferences.json) — survives updates AND reinstalls
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
    const userPrefs = path.join(appDataDir, 'user-preferences.json');
    if (fs.existsSync(userPrefs))
        return userPrefs;
    return path.join(appDataDir, 'prefs.json');
}
/**
 * Tenta fazer parse do JSON com tolerância a falhas.
 * Se houver caracteres excedentes após o último `}` (corrupção por concorrência ou crash),
 * extrai e recupera o objeto JSON intacto.
 */
function safeParseJsonWithRecovery(raw) {
    if (!raw || !raw.trim())
        return { data: null, wasRecovered: false };
    try {
        return { data: JSON.parse(raw), wasRecovered: false };
    }
    catch {
        // Tentar recuperação iterativa buscando o delimitador '}' que fecha o JSON válido
        try {
            let idx = raw.length;
            while (idx > 0) {
                const nextBrace = raw.lastIndexOf('}', idx - 1);
                if (nextBrace === -1)
                    break;
                try {
                    const candidate = raw.substring(0, nextBrace + 1);
                    const parsed = JSON.parse(candidate);
                    console.warn('[Prefs] Recuperado JSON com sucesso após remoção de bytes corrompidos.');
                    return { data: parsed, wasRecovered: true };
                }
                catch {
                    idx = nextBrace;
                }
            }
        }
        catch (recoverErr) {
            console.error('[Prefs] Falha ao tentar auto-recuperar JSON:', recoverErr);
        }
    }
    return { data: null, wasRecovered: false };
}
/**
 * Escrita atômica resiliente com backup.
 * Grava primeiro em .tmp, faz flush em disco, cria backup .bak e renomeia atomicamente.
 */
function writeAtomicSync(filePath, content) {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';
    try {
        fs.writeFileSync(tmpPath, content, 'utf-8');
        if (fs.existsSync(filePath)) {
            try {
                fs.copyFileSync(filePath, bakPath);
            }
            catch { }
        }
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            fs.renameSync(tmpPath, filePath);
        }
        catch {
            fs.copyFileSync(tmpPath, filePath);
            try {
                fs.unlinkSync(tmpPath);
            }
            catch { }
        }
    }
    catch (err) {
        console.error('[Main] Erro na escrita atômica do arquivo:', filePath, err);
        try {
            if (fs.existsSync(tmpPath))
                fs.unlinkSync(tmpPath);
        }
        catch { }
    }
}
// Fila serializada assíncrona para garantir que múltiplas chamadas concorrentes de savePreferences não colidam
let prefsWriteQueue = Promise.resolve();
function readPrefsFromDisk() {
    const prefsPath = getPrefsPath();
    const bakPath = prefsPath + '.bak';
    if (fs.existsSync(prefsPath)) {
        try {
            const raw = fs.readFileSync(prefsPath, 'utf-8');
            const result = safeParseJsonWithRecovery(raw);
            if (result.data) {
                // Se foi recuperado de corrupção, regravar versão limpa atomicamente de imediato
                if (result.wasRecovered) {
                    writeAtomicSync(prefsPath, JSON.stringify(result.data, null, 2));
                }
                return result.data;
            }
        }
        catch (e) {
            console.warn('[Prefs] Erro ao ler prefs.json principal:', e);
        }
    }
    // Se o principal não existe ou falhou, tenta recuperar do backup .bak
    if (fs.existsSync(bakPath)) {
        try {
            const bakRaw = fs.readFileSync(bakPath, 'utf-8');
            const bakResult = safeParseJsonWithRecovery(bakRaw);
            if (bakResult.data) {
                console.log('[Prefs] Restaurado preferências a partir do backup .bak com sucesso.');
                writeAtomicSync(prefsPath, JSON.stringify(bakResult.data, null, 2));
                return bakResult.data;
            }
        }
        catch (e) {
            console.warn('[Prefs] Erro ao ler backup .bak:', e);
        }
    }
    return {};
}
const DEFAULT_KEYBINDS = {
    keybindMicMute: 'CommandOrControl+Shift+M',
    keybindDeafen: 'CommandOrControl+Shift+D',
    keybindsEnabled: true,
};
function getKeybindsFromPrefs(prefs) {
    const p = prefs || readPrefsFromDisk();
    return {
        keybindMicMute: typeof p.keybindMicMute === 'string' ? p.keybindMicMute : DEFAULT_KEYBINDS.keybindMicMute,
        keybindDeafen: typeof p.keybindDeafen === 'string' ? p.keybindDeafen : DEFAULT_KEYBINDS.keybindDeafen,
        keybindsEnabled: p.keybindsEnabled !== undefined ? (p.keybindsEnabled === true || p.keybindsEnabled === 'true') : DEFAULT_KEYBINDS.keybindsEnabled,
    };
}
function registerGlobalKeybinds(prefs) {
    try {
        electron_1.globalShortcut.unregisterAll();
    }
    catch (err) {
        fs.appendFileSync(logFile, `[GlobalKeybinds] unregisterAll error: ${err}\n`);
    }
    const keybinds = getKeybindsFromPrefs(prefs);
    if (keybinds.keybindsEnabled === false) {
        fs.appendFileSync(logFile, `[GlobalKeybinds] Keybinds are disabled.\n`);
        return;
    }
    if (keybinds.keybindMicMute && keybinds.keybindMicMute.trim() !== '') {
        const accel = keybinds.keybindMicMute.trim();
        try {
            const registered = electron_1.globalShortcut.register(accel, () => {
                fs.appendFileSync(logFile, `[GlobalKeybinds] Triggered: toggle-mic (${accel})\n`);
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    mainWindow.webContents.send('global-shortcut-triggered', 'toggle-mic');
                }
            });
            fs.appendFileSync(logFile, `[GlobalKeybinds] Registered mic mute (${accel}): ${registered}\n`);
        }
        catch (err) {
            fs.appendFileSync(logFile, `[GlobalKeybinds] Failed to register mic mute (${accel}): ${err?.message || err}\n`);
        }
    }
    if (keybinds.keybindDeafen && keybinds.keybindDeafen.trim() !== '') {
        const accel = keybinds.keybindDeafen.trim();
        try {
            const registered = electron_1.globalShortcut.register(accel, () => {
                fs.appendFileSync(logFile, `[GlobalKeybinds] Triggered: toggle-deafen (${accel})\n`);
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    mainWindow.webContents.send('global-shortcut-triggered', 'toggle-deafen');
                }
            });
            fs.appendFileSync(logFile, `[GlobalKeybinds] Registered deafen (${accel}): ${registered}\n`);
        }
        catch (err) {
            fs.appendFileSync(logFile, `[GlobalKeybinds] Failed to register deafen (${accel}): ${err?.message || err}\n`);
        }
    }
}
electron_1.ipcMain.on('save-preferences', (_event, prefs) => {
    if (!prefs || typeof prefs !== 'object')
        return;
    prefsWriteQueue = prefsWriteQueue.then(async () => {
        try {
            const prefsPath = getPrefsPath();
            const existing = readPrefsFromDisk();
            const merged = { ...existing, ...prefs };
            writeAtomicSync(prefsPath, JSON.stringify(merged, null, 2));
            if ('keybindMicMute' in prefs || 'keybindDeafen' in prefs || 'keybindsEnabled' in prefs) {
                registerGlobalKeybinds(merged);
            }
            if ('openAtLogin' in prefs && process.platform === 'win32' && !isDev) {
                const enable = prefs.openAtLogin === true || prefs.openAtLogin === 'true';
                try {
                    electron_1.app.setLoginItemSettings({
                        openAtLogin: enable,
                        openAsHidden: true,
                        path: process.execPath,
                        args: ['--hidden']
                    });
                    fs.appendFileSync(logFile, `[AutoLaunch] Updated login items from save-preferences: openAtLogin=${enable}\n`);
                }
                catch (e) {
                    fs.appendFileSync(logFile, `[AutoLaunch] Error updating login items from save-preferences: ${e}\n`);
                }
            }
        }
        catch (e) {
            console.error('Failed to save preferences:', e);
        }
    }).catch(err => {
        console.error('[Prefs] Erro na fila de escrita de preferências:', err);
    });
});
electron_1.ipcMain.handle('load-preferences', () => {
    try {
        return readPrefsFromDisk();
    }
    catch (e) {
        console.error('Failed to load preferences:', e);
        return {};
    }
});
electron_1.ipcMain.handle('get-auto-launch', () => {
    try {
        if (process.platform === 'win32' && !isDev) {
            const prefs = readPrefsFromDisk();
            if (prefs && prefs.openAtLogin !== undefined) {
                return prefs.openAtLogin === true || prefs.openAtLogin === 'true';
            }
            return Boolean(electron_1.app.getLoginItemSettings().openAtLogin);
        }
        return false;
    }
    catch {
        return false;
    }
});
electron_1.ipcMain.handle('set-auto-launch', (_event, enabled) => {
    try {
        if (process.platform === 'win32' && !isDev) {
            const shouldEnable = Boolean(enabled);
            electron_1.app.setLoginItemSettings({
                openAtLogin: shouldEnable,
                openAsHidden: true,
                path: process.execPath,
                args: ['--hidden']
            });
            const prefsPath = getPrefsPath();
            const existing = readPrefsFromDisk();
            existing.openAtLogin = shouldEnable;
            writeAtomicSync(prefsPath, JSON.stringify(existing, null, 2));
            fs.appendFileSync(logFile, `[AutoLaunch] Explicit set-auto-launch to ${shouldEnable}\n`);
            return { ok: true, openAtLogin: shouldEnable };
        }
        return { ok: true, openAtLogin: Boolean(enabled) };
    }
    catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
});
electron_1.ipcMain.handle('get-keybinds', () => {
    try {
        const prefs = readPrefsFromDisk();
        return getKeybindsFromPrefs(prefs);
    }
    catch (err) {
        console.error('[Main] get-keybinds error:', err);
        return DEFAULT_KEYBINDS;
    }
});
electron_1.ipcMain.handle('set-keybinds', (_event, data) => {
    try {
        const existing = readPrefsFromDisk();
        const current = getKeybindsFromPrefs(existing);
        const updated = {
            keybindMicMute: typeof data?.keybindMicMute === 'string' ? data.keybindMicMute : current.keybindMicMute,
            keybindDeafen: typeof data?.keybindDeafen === 'string' ? data.keybindDeafen : current.keybindDeafen,
            keybindsEnabled: data?.keybindsEnabled !== undefined ? Boolean(data.keybindsEnabled) : current.keybindsEnabled,
        };
        const merged = { ...existing, ...updated };
        const prefsPath = getPrefsPath();
        writeAtomicSync(prefsPath, JSON.stringify(merged, null, 2));
        registerGlobalKeybinds(updated);
        return { ok: true, keybinds: updated };
    }
    catch (err) {
        console.error('[Main] set-keybinds error:', err);
        return { ok: false, error: err?.message || String(err) };
    }
});
// Secure token storage via Electron safeStorage (DPAPI on Windows)
electron_1.ipcMain.handle('save-secure-token', async (_event, key, value) => {
    try {
        if (!key || typeof value !== 'string')
            return false;
        const prefsPath = getPrefsPath();
        const securePath = path.join(path.dirname(prefsPath), 'secure_tokens.json');
        let tokens = {};
        if (fs.existsSync(securePath)) {
            try {
                const raw = await fs.promises.readFile(securePath, 'utf8');
                const parsed = safeParseJsonWithRecovery(raw);
                if (parsed.data)
                    tokens = parsed.data;
            }
            catch { }
        }
        if (electron_1.safeStorage && electron_1.safeStorage.isEncryptionAvailable()) {
            tokens[key] = electron_1.safeStorage.encryptString(value).toString('base64');
        }
        else {
            tokens[key] = Buffer.from(value, 'utf8').toString('base64');
        }
        writeAtomicSync(securePath, JSON.stringify(tokens, null, 2));
        return true;
    }
    catch (err) {
        console.error('[Main] save-secure-token error:', err);
        return false;
    }
});
electron_1.ipcMain.handle('load-secure-token', async (_event, key) => {
    try {
        if (!key)
            return null;
        const prefsPath = getPrefsPath();
        const securePath = path.join(path.dirname(prefsPath), 'secure_tokens.json');
        if (!fs.existsSync(securePath))
            return null;
        const raw = await fs.promises.readFile(securePath, 'utf8');
        const parsed = safeParseJsonWithRecovery(raw);
        if (!parsed.data)
            return null;
        const tokenRaw = parsed.data[key];
        if (!tokenRaw)
            return null;
        if (electron_1.safeStorage && electron_1.safeStorage.isEncryptionAvailable()) {
            return electron_1.safeStorage.decryptString(Buffer.from(tokenRaw, 'base64'));
        }
        else {
            return Buffer.from(tokenRaw, 'base64').toString('utf8');
        }
    }
    catch (err) {
        console.error('[Main] load-secure-token error:', err);
        return null;
    }
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
// ==========================================
// Widevine Streaming View Management (WebContentsView / BrowserView)
// Multi-platform support: Netflix & Prime Video simultaneously in memory
// ==========================================
function getActiveStreamingInstance() {
    if (activeStreamingService && streamingInstances.has(activeStreamingService)) {
        return streamingInstances.get(activeStreamingService);
    }
    const first = streamingInstances.values().next().value;
    return first;
}
let currentStreamingVolume = 50; // 0 to 100
function broadcastToStreamingFrames(wc, channel, ...args) {
    try {
        wc.send(channel, ...args);
    }
    catch { }
    try {
        if (wc.mainFrame && Array.isArray(wc.mainFrame.framesInSubtree)) {
            for (const frame of wc.mainFrame.framesInSubtree) {
                if (frame !== wc.mainFrame) {
                    try {
                        frame.send(channel, ...args);
                    }
                    catch { }
                }
            }
        }
    }
    catch { }
}
function applyStreamingVolumeToView(view, volume) {
    if (!view || view.webContents.isDestroyed())
        return;
    const fraction = Math.max(0, Math.min(1, volume / 100));
    const isMuted = fraction === 0;
    try {
        view.webContents.setAudioMuted(isMuted);
    }
    catch (e) { }
    const volScript = `
        (function() {
            try {
                var mediaEls = document.querySelectorAll('video, audio');
                mediaEls.forEach(function(el) {
                    el.volume = ${fraction};
                    el.muted = ${isMuted};
                });
            } catch(e) {}
        })();
    `;
    view.webContents.executeJavaScript(volScript).catch(() => { });
    try {
        if (view.webContents.mainFrame && Array.isArray(view.webContents.mainFrame.framesInSubtree)) {
            for (const frame of view.webContents.mainFrame.framesInSubtree) {
                if (frame !== view.webContents.mainFrame) {
                    try {
                        frame.executeJavaScript(volScript).catch(() => { });
                    }
                    catch { }
                }
            }
        }
    }
    catch { }
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
    const fsScript = `
        (function() {
            if (!document.fullscreenElement) {
                const fsBtn = document.querySelector('[data-uia="control-fullscreen-enter"]') ||
                              document.querySelector('.button-nfplayerFullscreen') ||
                              document.querySelector('.atvwebplayersdk-fullscreen-button') ||
                              document.querySelector('[data-automation-id="fullscreen-button"]') ||
                              document.querySelector("[data-testid='vilos-fullscreen_button']") ||
                              document.querySelector("[aria-label*='Fullscreen']") ||
                              document.querySelector("[aria-label*='Tela cheia']");
                if (fsBtn) {
                    fsBtn.click();
                }
            }
        })()
    `;
    target.view.webContents.executeJavaScript(fsScript).catch(() => { });
    try {
        if (target.view.webContents.mainFrame && Array.isArray(target.view.webContents.mainFrame.framesInSubtree)) {
            for (const frame of target.view.webContents.mainFrame.framesInSubtree) {
                if (frame !== target.view.webContents.mainFrame) {
                    try {
                        frame.executeJavaScript(fsScript).catch(() => { });
                    }
                    catch { }
                }
            }
        }
    }
    catch { }
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
        if (options.service === 'netflix') {
            targetUrl = 'https://www.netflix.com/browse';
        }
        else if (options.service === 'prime') {
            targetUrl = 'https://www.primevideo.com';
        }
        else if (options.service === 'crunchyroll') {
            targetUrl = 'https://www.crunchyroll.com/';
        }
        else {
            targetUrl = 'https://www.crunchyroll.com/';
        }
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
        headers['sec-ch-ua'] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not/A)Brand";v="24"`;
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
        nodeIntegrationInSubFrames: true,
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
                            var chromeBrands = [
                                { brand: 'Chromium', version: '150' },
                                { brand: 'Google Chrome', version: '150' },
                                { brand: 'Not/A)Brand', version: '24' }
                            ];
                            var fullVersionList = [
                                { brand: 'Chromium', version: '150.0.7871.250' },
                                { brand: 'Google Chrome', version: '150.0.7871.250' },
                                { brand: 'Not/A)Brand', version: '24.0.0.0' }
                            ];
                            try {
                                Object.defineProperty(navigator.userAgentData, 'brands', {
                                    get: function() { return chromeBrands; },
                                    configurable: true
                                });
                            } catch(e) {}

                            var origFn = navigator.userAgentData.getHighEntropyValues;
                            navigator.userAgentData.getHighEntropyValues = function(hints) {
                                return (origFn ? origFn.call(navigator.userAgentData, hints) : Promise.resolve({})).then(function(res) {
                                    res = res || {};
                                    res.brands = chromeBrands;
                                    res.fullVersionList = fullVersionList;
                                    res.platform = 'Windows';
                                    res.platformVersion = res.platformVersion || '10.0.0';
                                    res.architecture = res.architecture || 'x86';
                                    res.bitness = res.bitness || '64';
                                    res.model = res.model || '';
                                    res.uaFullVersion = '150.0.7871.250';
                                    return res;
                                }).catch(function() {
                                    return {
                                        architecture: 'x86',
                                        bitness: '64',
                                        brands: chromeBrands,
                                        fullVersionList: fullVersionList,
                                        mobile: false,
                                        model: '',
                                        platform: 'Windows',
                                        platformVersion: '10.0.0',
                                        uaFullVersion: '150.0.7871.250'
                                    };
                                });
                            };
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
        if (navUrl && !navUrl.includes('static.crunchyroll.com') && !navUrl.includes('vilos')) {
            instObj.currentUrl = navUrl;
        }
        applyStyling();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('streaming-event', { type: 'navigate', service: options.service, url: navUrl });
        }
    });
    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
        if (navUrl && !navUrl.includes('static.crunchyroll.com') && !navUrl.includes('vilos')) {
            instObj.currentUrl = navUrl;
        }
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
        hideStreamingView('crunchyroll');
        activeStreamingService = null;
        modalHiddenStreamingService = null;
    }
    else if (tab === 'netflix' || tab === 'prime' || tab === 'crunchyroll') {
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
        hideStreamingView('crunchyroll');
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
/**
 * Inspeciona todos os frames (incluindo iframes cross-origin como o Vilos da Crunchyroll)
 * para obter o estado real de reprodução e URL da página principal.
 */
async function queryStreamingPlaybackState(inst) {
    const wc = inst.view?.webContents;
    const fallbackUrl = (wc && !wc.isDestroyed() ? wc.getURL() : '') || inst.currentUrl || '';
    if (!wc || wc.isDestroyed()) {
        return { url: fallbackUrl, positionSeconds: 0, isPlaying: false, hasVideo: false };
    }
    let bestVideoResult = null;
    const frames = wc.mainFrame?.framesInSubtree || [wc.mainFrame];
    for (const frame of frames) {
        if (!frame || frame.isDestroyed?.())
            continue;
        try {
            const res = await frame.executeJavaScript(`
                (function() {
                    var v = (typeof window.__concord_get_active_video === 'function')
                        ? window.__concord_get_active_video()
                        : document.querySelector('video');
                    if (!v) return { hasVideo: false, currentTime: 0, isPlaying: false, score: 0 };
                    var rect = v.getBoundingClientRect();
                    var score = (rect.width * rect.height) + (v.readyState >= 1 ? 100000 : 0) + (!v.paused ? 50000 : 0);
                    return {
                        hasVideo: true,
                        currentTime: typeof v.currentTime === 'number' && !isNaN(v.currentTime) ? v.currentTime : 0,
                        isPlaying: !v.paused,
                        score: score
                    };
                })()
            `);
            if (res && res.hasVideo && (!bestVideoResult || res.score > bestVideoResult.score)) {
                bestVideoResult = res;
            }
        }
        catch {
            // Frame pode ter sido destruído durante navegação
        }
    }
    const topUrl = wc.getURL() || inst.currentUrl || '';
    if (topUrl && !topUrl.includes('static.crunchyroll.com') && !topUrl.includes('vilos')) {
        inst.currentUrl = topUrl;
    }
    return {
        url: inst.currentUrl || topUrl || fallbackUrl,
        positionSeconds: bestVideoResult?.currentTime || 0,
        isPlaying: bestVideoResult ? bestVideoResult.isPlaying : true,
        hasVideo: Boolean(bestVideoResult?.hasVideo),
    };
}
electron_1.ipcMain.handle('get-streaming-state', async (_event, service) => {
    const targetService = service || activeStreamingService;
    const inst = targetService ? streamingInstances.get(targetService) : getActiveStreamingInstance();
    if (!inst || !inst.view || inst.view.webContents.isDestroyed()) {
        return { ok: false, service: targetService || null, url: '', positionSeconds: 0, isPlaying: false, hasVideo: false };
    }
    const state = await queryStreamingPlaybackState(inst);
    return {
        ok: true,
        service: inst.service,
        ...state,
    };
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
        broadcastToStreamingFrames(wc, 'apply-streaming-playback', { action: 'play' });
        // Sincronizar evento de playback com a Watch Party no Concord (suporta iframe Vilos da Crunchyroll)
        queryStreamingPlaybackState(inst).then((res) => {
            if (mainWindow && !mainWindow.isDestroyed() && inst.service) {
                mainWindow.webContents.send('streaming-event', {
                    type: 'playback-event',
                    playbackType: 'play',
                    service: inst.service,
                    url: res.url || inst.currentUrl || '',
                    positionSeconds: res.positionSeconds || 0,
                    isPlaying: true,
                });
            }
        }).catch(() => { });
    }
    else if (command === 'pause') {
        broadcastToStreamingFrames(wc, 'apply-streaming-playback', { action: 'pause' });
        // Sincronizar evento de playback com a Watch Party no Concord (suporta iframe Vilos da Crunchyroll)
        queryStreamingPlaybackState(inst).then((res) => {
            if (mainWindow && !mainWindow.isDestroyed() && inst.service) {
                mainWindow.webContents.send('streaming-event', {
                    type: 'playback-event',
                    playbackType: 'pause',
                    service: inst.service,
                    url: res.url || inst.currentUrl || '',
                    positionSeconds: res.positionSeconds || 0,
                    isPlaying: false,
                });
            }
        }).catch(() => { });
    }
    else if (command === 'skip') {
        broadcastToStreamingFrames(wc, 'apply-streaming-playback', { action: 'skip', deltaSeconds: 10 });
        // Sincronizar evento de seek com a Watch Party no Concord
        setTimeout(() => {
            queryStreamingPlaybackState(inst).then((res) => {
                if (mainWindow && !mainWindow.isDestroyed() && inst.service) {
                    mainWindow.webContents.send('streaming-event', {
                        type: 'playback-event',
                        playbackType: 'seek',
                        service: inst.service,
                        url: res.url || inst.currentUrl || '',
                        positionSeconds: res.positionSeconds || 0,
                        isPlaying: res.isPlaying,
                    });
                }
            }).catch(() => { });
        }, 250);
    }
    else if (command === 'seek' && typeof payload?.time === 'number') {
        broadcastToStreamingFrames(wc, 'apply-streaming-playback', { action: 'seek', positionSeconds: payload.time });
        if (mainWindow && !mainWindow.isDestroyed() && inst.service) {
            const currentTopUrl = wc.getURL() || inst.currentUrl || '';
            mainWindow.webContents.send('streaming-event', {
                type: 'playback-event',
                playbackType: 'seek',
                service: inst.service,
                url: currentTopUrl,
                positionSeconds: payload.time,
                isPlaying: true,
            });
        }
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
                const isCrunchyWatch = href.includes('crunchyroll.com') && href.includes('/watch/');
                const hasBackBtn = !!(
                    document.querySelector('[data-uia="control-back"]') ||
                    document.querySelector('.button-nfplayerBack') ||
                    document.querySelector('.atvwebplayersdk-back-button') ||
                    document.querySelector('[data-automation-id="back-button"]') ||
                    document.querySelector('.backButton') ||
                    document.querySelector("[data-testid='vilos-back_button']") ||
                    document.querySelector("[aria-label*='Back']") ||
                    document.querySelector("[aria-label*='Voltar']")
                );
                return {
                    isWatching: isNetflixWatch || isPrimeWatch || isCrunchyWatch || hasBackBtn,
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
                        const crunchyBack = document.querySelector("[data-testid='vilos-back_button']") ||
                                            document.querySelector("[aria-label*='Back']") ||
                                            document.querySelector("[aria-label*='Voltar']");
                        if (crunchyBack) { crunchyBack.click(); return; }
                        const href = window.location.href;
                        if (href.includes('netflix.com')) {
                            window.location.href = 'https://www.netflix.com/browse';
                        } else if (href.includes('primevideo.com') || href.includes('amazon.')) {
                            window.location.href = 'https://www.primevideo.com';
                        } else if (href.includes('crunchyroll.com')) {
                            window.location.href = 'https://www.crunchyroll.com/';
                        } else {
                            window.location.href = 'https://www.crunchyroll.com/';
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
// ═══════════════════════════════════════════════════════════════════
// ── WATCH PARTY SYNC IPC (NETFLIX, PRIME VIDEO & CRUNCHYROLL) ──
// ═══════════════════════════════════════════════════════════════════
electron_1.ipcMain.on('streaming-playback-event', (event, data) => {
    let service = null;
    let matchingInst = null;
    for (const [srv, inst] of streamingInstances.entries()) {
        if (inst.view && !inst.view.webContents.isDestroyed() && inst.view.webContents.id === event.sender.id) {
            service = srv;
            matchingInst = inst;
            break;
        }
    }
    if (!service) {
        service = activeStreamingService;
        matchingInst = service ? streamingInstances.get(service) || null : null;
    }
    if (mainWindow && !mainWindow.isDestroyed() && service) {
        let finalUrl = data.url;
        if (service === 'crunchyroll' || (data.url && (data.url.includes('static.crunchyroll.com') || data.url.includes('vilos') || !data.url.includes('www.crunchyroll.com')))) {
            finalUrl = matchingInst?.view?.webContents?.getURL?.() || matchingInst?.currentUrl || data.url;
        }
        mainWindow.webContents.send('streaming-event', {
            type: 'playback-event',
            playbackType: data.type,
            service,
            url: finalUrl,
            positionSeconds: data.positionSeconds,
            isPlaying: data.isPlaying,
        });
    }
});
electron_1.ipcMain.on('sync-streaming-playback', (_event, data) => {
    const targetService = data.service || activeStreamingService;
    const inst = targetService ? streamingInstances.get(targetService) : getActiveStreamingInstance();
    if (!inst || !inst.view || inst.view.webContents.isDestroyed())
        return;
    // Send command to streaming preload and all subframes
    broadcastToStreamingFrames(inst.view.webContents, 'apply-streaming-playback', data);
    fs.appendFileSync(logFile, `[WatchParty] sync-streaming-playback sent: action=${data.action} pos=${data.positionSeconds} service=${targetService}\n`);
});
electron_1.ipcMain.on('navigate-streaming-view', (_event, { service, url }) => {
    const inst = streamingInstances.get(service);
    if (inst && !inst.view.webContents.isDestroyed()) {
        // Instance already exists — navigate within it
        if (inst.currentUrl !== url) {
            inst.currentUrl = url;
            fs.appendFileSync(logFile, `[WatchParty] navigate-streaming-view: loading ${url}\n`);
            inst.view.webContents.loadURL(url).catch(() => { });
        }
    }
    else {
        // Instance doesn't exist yet — notify renderer so it can open the streaming
        // view at this URL (via "Assistir Junto" banner flow)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('streaming-event', {
                type: 'navigate-pending',
                service,
                url,
            });
            fs.appendFileSync(logFile, `[WatchParty] navigate-pending emitted for ${service}: ${url}\n`);
        }
    }
});
// ── Navigate to specific title inside an already-open streaming view ──
// Used by Watch Party "Assistir Junto" to deep-link directly to a title URL
electron_1.ipcMain.on('navigate-to-title', (_event, { service, url, autoPlay }) => {
    const inst = streamingInstances.get(service);
    if (!inst || inst.view.webContents.isDestroyed())
        return;
    if (inst.currentUrl !== url) {
        inst.currentUrl = url;
        inst.view.webContents.loadURL(url).catch(() => { });
        fs.appendFileSync(logFile, `[WatchParty] navigate-to-title: ${service} → ${url} autoPlay=${autoPlay}\n`);
    }
    else {
        // Same URL — just trigger autoPlay signal
        if (autoPlay) {
            broadcastToStreamingFrames(inst.view.webContents, 'navigate-to-title', { url, autoPlay: true });
        }
    }
});
