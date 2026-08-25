import { app, BrowserWindow, shell, ipcMain, session, desktopCapturer, clipboard, Notification, protocol, net } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

const logFile = `${os.tmpdir()}/concord-debug.log`;
fs.writeFileSync(logFile, 'Electron Started!\n');

import { autoUpdater } from 'electron-updater';
// removed url import

// In a CommonJS build we don't have import.meta.url, but we are writing TS mapped to commonjs usually for electron, or ESM if packaged cleanly.
const path = require('path');
const isDev = !app.isPackaged;

// Allow autoplay without user gesture for YouTube
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gesture-requirement-for-media-playback');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

app.userAgentFallback = app.userAgentFallback.replace(/Electron\/\S+ /, '').replace(/concord\/\S+ /, '');

let mainWindow: BrowserWindowType | null = null;
let localServerPort = 0;

function startLocalServer(): Promise<number> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = req.url === '/' ? '/index.html' : req.url;
            urlPath = urlPath?.split('?')[0] || '/index.html';
            
            const absolutePath = path.join(__dirname, '../dist', urlPath);
            fs.readFile(absolutePath, (err, data) => {
                if (err) {
                    fs.readFile(path.join(__dirname, '../dist/index.html'), (err2, data2) => {
                        if (err2) {
                            res.writeHead(404); res.end('Not found');
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data2);
                    });
                    return;
                }
                
                const ext = path.extname(absolutePath).toLowerCase();
                let mime = 'text/plain';
                if (ext === '.html') mime = 'text/html';
                else if (ext === '.js' || ext === '.mjs') mime = 'application/javascript';
                else if (ext === '.css') mime = 'text/css';
                else if (ext === '.svg') mime = 'image/svg+xml';
                else if (ext === '.png') mime = 'image/png';
                else if (ext === '.json') mime = 'application/json';
                else if (ext === '.ico') mime = 'image/x-icon';

                res.writeHead(200, { 'Content-Type': mime });
                res.end(data);
            });
        });
        
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as any).port);
        });
    });
}

function createWindow() {
    fs.appendFileSync(logFile, 'createWindow called!\n');
    mainWindow = new BrowserWindow({
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
            webSecurity: false,
            autoplayPolicy: 'no-user-gesture-required'
        },
        frame: false,
        titleBarStyle: 'hidden',
        // Customize titlebar or icon here
    });

    // Spoof User-Agent to bypass YouTube's Electron blocks
    // Already done globally via app.userAgentFallback

    const url = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
        : `http://127.0.0.1:${localServerPort}`;

    if (isDev) {
        mainWindow!.loadURL(url);
        mainWindow!.webContents.openDevTools();
    } else {
        mainWindow!.loadURL(url);
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow!.show();
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        fs.appendFileSync(logFile, `[Renderer] ${message}\n`);
    });

    // Handle auto-updates
    initAutoUpdater(mainWindow as BrowserWindowType);

    // Make all links open with the browser, not with the application
    mainWindow!.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
        if (url.startsWith('https:')) shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow!.on('closed', () => {
        mainWindow = null;
    });
}

function initAutoUpdater(window: BrowserWindowType) {
    if (isDev) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        window.webContents.send('update-message', 'Verificando atualizações...');
    });
    autoUpdater.on('update-available', (info) => {
        window.webContents.send('update-message', 'Atualização disponível.');
    });
    autoUpdater.on('update-not-available', (info) => {
        window.webContents.send('update-message', 'O aplicativo está atualizado.');
    });
    autoUpdater.on('error', (err) => {
        window.webContents.send('update-message', 'Erro ao atualizar: ' + err);
    });
    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Abaixando velocidade de " + progressObj.bytesPerSecond;
        log_message = log_message + ' - Baixado ' + progressObj.percent + '%';
        log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
        window.webContents.send('update-message', log_message);
    });
    autoUpdater.on('update-downloaded', (info) => {
        window.webContents.send('update-message', 'Atualização baixada. O app será reiniciado para instalar.');
        
        new Notification({
            title: 'Nova atualização pronta para instalar',
            body: `A versão ${info.version || ''} do Concord foi baixada e será instalada automaticamente.`
        }).show();

        setTimeout(() => {
            autoUpdater.quitAndInstall();
        }, 5000);
    });

    autoUpdater.checkForUpdates();
    fs.appendFileSync(logFile, 'initAutoUpdater Finished!\n');
}

fs.appendFileSync(logFile, 'Waiting for app.whenReady()...\n');
app.whenReady().then(() => {
    fs.appendFileSync(logFile, 'app.whenReady() fired!\n');
    
    // Handle media permissions for WebRTC
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'display-capture', 'microphone', 'camera'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Handle screen share requests natively
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            callback({ video: sources[0] });
        }).catch((err) => {
            console.error('Error getting desktop sources:', err);
            // @ts-ignore
            callback({ video: null });
        });
    });

    // Fix CORS/Origin for Giphy API
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://*.giphy.com/*'] },
        (details, callback) => {
            details.requestHeaders['Origin'] = 'https://concord-repo.onrender.com';
            details.requestHeaders['Referer'] = 'https://concord-repo.onrender.com/';
            callback({ requestHeaders: details.requestHeaders });
        }
    );

    if (!isDev) {
        startLocalServer().then(port => {
            localServerPort = port;
            createWindow();
        });
    } else {
        createWindow();
    }
}).catch(err => fs.appendFileSync(logFile, `app.whenReady() ERROR: ${err}\n`));

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

// Basic IPC handlers
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
});

// Window controls IPC
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('force-unmute', () => {
    if (mainWindow) {
        mainWindow.webContents.setAudioMuted(false);
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

