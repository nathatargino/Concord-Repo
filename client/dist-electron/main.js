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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const logFile = `${os.tmpdir()}/concord-debug.log`;
fs.writeFileSync(logFile, 'Electron Started!\n');
const electron_updater_1 = require("electron-updater");
// removed url import
// In a CommonJS build we don't have import.meta.url, but we are writing TS mapped to commonjs usually for electron, or ESM if packaged cleanly.
const path = require('path');
const isDev = !electron_1.app.isPackaged;
// Allow autoplay without user gesture for YouTube
electron_1.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let mainWindow = null;
function createWindow() {
    fs.appendFileSync(logFile, 'createWindow called!\n');
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        },
        frame: false,
        titleBarStyle: 'hidden',
        // Customize titlebar or icon here
    });
    const url = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
        : `file://${path.join(__dirname, '../dist/index.html')}`;
    if (isDev) {
        mainWindow.loadURL(url);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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
        window.webContents.send('update-message', 'Verificando atualizações...');
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        window.webContents.send('update-message', 'Atualização disponível.');
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => {
        window.webContents.send('update-message', 'O aplicativo está atualizado.');
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        window.webContents.send('update-message', 'Erro ao atualizar: ' + err);
    });
    electron_updater_1.autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Abaixando velocidade de " + progressObj.bytesPerSecond;
        log_message = log_message + ' - Baixado ' + progressObj.percent + '%';
        log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
        window.webContents.send('update-message', log_message);
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        window.webContents.send('update-message', 'Atualização baixada. O app será reiniciado para instalar.');
        new electron_1.Notification({
            title: 'Nova atualização pronta para instalar',
            body: `A versão ${info.version || ''} do Concord foi baixada e será instalada automaticamente.`
        }).show();
        setTimeout(() => {
            electron_updater_1.autoUpdater.quitAndInstall();
        }, 5000);
    });
    electron_updater_1.autoUpdater.checkForUpdates();
    fs.appendFileSync(logFile, 'initAutoUpdater Finished!\n');
}
fs.appendFileSync(logFile, 'Waiting for app.whenReady()...\n');
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
    electron_1.session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        electron_1.desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            // Automatically grant access to the primary screen
            callback({ video: sources[0] });
        }).catch((err) => {
            console.error('Error getting desktop sources:', err);
            // @ts-ignore
            callback({ video: null });
        });
    });
    // Fix CORS/Origin for Giphy API
    electron_1.session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.giphy.com/*'] }, (details, callback) => {
        details.requestHeaders['Origin'] = 'https://concord-repo.onrender.com';
        details.requestHeaders['Referer'] = 'https://concord-repo.onrender.com/';
        callback({ requestHeaders: details.requestHeaders });
    });
    createWindow();
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
electron_1.ipcMain.on('window-close', () => {
    if (mainWindow)
        mainWindow.close();
});
