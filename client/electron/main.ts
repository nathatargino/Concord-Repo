import { app, BrowserWindow, shell, ipcMain } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

import * as fs from 'fs';
import * as os from 'os';
const logFile = `${os.tmpdir()}/concord-debug.log`;
fs.writeFileSync(logFile, 'Electron Started!\n');

import { autoUpdater } from 'electron-updater';
// removed url import

// In a CommonJS build we don't have import.meta.url, but we are writing TS mapped to commonjs usually for electron, or ESM if packaged cleanly.
const path = require('path');
const isDev = !app.isPackaged;

let mainWindow: BrowserWindowType | null = null;

function createWindow() {
    fs.appendFileSync(logFile, 'createWindow called!\n');
    mainWindow = new BrowserWindow({
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
        mainWindow!.loadURL(url);
        mainWindow!.webContents.openDevTools();
    } else {
        mainWindow!.loadFile(path.join(__dirname, '../dist/index.html'));
    }

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
        setTimeout(() => {
            autoUpdater.quitAndInstall();
        }, 3000);
    });

    autoUpdater.checkForUpdatesAndNotify();
    fs.appendFileSync(logFile, 'initAutoUpdater Finished!\n');
}

fs.appendFileSync(logFile, 'Waiting for app.whenReady()...\n');
app.whenReady().then(() => {
    fs.appendFileSync(logFile, 'app.whenReady() fired!\n');
    createWindow();
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

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

