import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

// Disable security warnings for local testing (optional)
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow: BrowserWindow | null;
let pipWindow: BrowserWindow | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#000000', // Matches app dark theme
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // Enable SharedArrayBuffer for FFmpeg WASM (Temporary until native ffmpeg is implemented)
            // Note: This requires headers as well, which local web server usually provides.
            // In file protocol, Electron needs explicit handling or session configuration.
        },
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        // Open DevTools in development
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Allow Document Picture-in-Picture and other window opens
    mainWindow.webContents.setWindowOpenHandler((details) => {
        console.log('[Main] setWindowOpenHandler triggered:', details);
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                // To allow the opener to script the new window (required for PiP),
                // we must match the parent's webPreferences OR ensure contextIsolation/sandboxing allows it.
                // For about:blank, Electron usually handles this, but explicit overrides help.
                webPreferences: {
                    // Inherit critical settings
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false, // Match parent (if parent is not sandboxed)
                    preload: path.join(__dirname, 'preload.js')
                },
                // Removing menu bar is standard for PiP
                autoHideMenuBar: true,
                backgroundColor: '#000000',
                // Important: Ensure it's not hidden by default
                show: true
            }
        };
    });

    // Log when windows are actually created (successful 'allow')
    mainWindow.webContents.on('did-create-window', (window, details) => {
        console.log('[Main] did-create-window:', details);
        window.once('closed', () => {
            console.log('[Main] Child window closed');
        });
    });

    // Enable SharedArrayBuffer for FFmpeg WASM inside Electron
    // WARNING: COOP/COEP can break popups if not carefully managed.
    // We only apply this to the main window's navigation.
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...details.responseHeaders };

        // Only apply High-Performance headers to the app origin or blob/file
        // This is a bit broad, but necessary for WASM.
        // Disabled temporarily to debug PiP
        // headers['Cross-Origin-Opener-Policy'] = ['same-origin'];
        // headers['Cross-Origin-Embedder-Policy'] = ['require-corp'];

        callback({ responseHeaders: headers });
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
// PiP Window Control
ipcMain.handle('pip:open', () => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.focus();
        return { success: true, existed: true };
    }

    pipWindow = new BrowserWindow({
        width: 400,
        height: 600,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Load the same app but with a hash to indicate PiP mode
    if (process.env.VITE_DEV_SERVER_URL) {
        pipWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/pip`);
    } else {
        pipWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'pip'
        });
    }

    pipWindow.on('closed', () => {
        pipWindow = null;
    });

    // Set independent zoom level (reset to 100%)
    pipWindow.webContents.setZoomFactor(1.0);

    return { success: true, existed: false };
});

ipcMain.handle('pip:close', () => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
        return { success: true };
    }
    return { success: false };
});

// Sync state from main window to PiP window
ipcMain.handle('pip:syncState', (_event, state) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.webContents.send('pip:stateUpdate', state);
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('app:version', () => app.getVersion());

import { fetchQQWithDecrypt } from './services/qq-decrypt';

ipcMain.handle('net:request', async (_event, config) => {
    const { method, url, headers, body } = config;

    try {
        // Special handling for QQ Decrypt
        if (url.includes('/api/qq-decrypt')) {
            // Extract query params
            const urlObj = new URL(url, 'http://dummy.com'); // Base needed for relative URLs
            const params = Object.fromEntries(urlObj.searchParams);
            return await fetchQQWithDecrypt(urlObj.pathname, params);
        }

        // Handle proxy rewrites if they still exist in the URL passing strategy
        // But ideally the client passes the proper URL or we map it here.
        // Providers currently use "/api/netease/..." which relies on Vite proxy.
        // We need to rewrite these to real URLs.

        let targetUrl = url;
        let finalHeaders = { ...headers };

        if (url.startsWith('/api/netease')) {
            targetUrl = url.replace('/api/netease', 'http://music.163.com');
            finalHeaders['Referer'] = 'http://music.163.com/';
            finalHeaders['Origin'] = 'http://music.163.com';
            finalHeaders['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            finalHeaders['Cookie'] = 'os=pc; NMTID=';
        } else if (url.startsWith('/api/qq')) {
            targetUrl = url.replace('/api/qq', 'https://c.y.qq.com');
            finalHeaders['Referer'] = 'https://y.qq.com/';
            finalHeaders['Origin'] = 'https://y.qq.com';
        } else if (url.startsWith('/api/lrclib')) {
            targetUrl = url.replace('/api/lrclib', 'https://lrclib.net/api');
        }

        const response = await fetch(targetUrl, {
            method,
            headers: finalHeaders,
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status} ${response.statusText}`);
        }

        // Return text or json based on content type or try JSON first
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }

    } catch (e: any) {
        console.error(`[Main] Request failed: ${url}`, e);
        throw e;
    }
});
