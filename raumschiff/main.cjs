// Electron-Hauptprozess: durchsichtiges, rahmenloses Fenster, das immer im Vordergrund liegt
// und vom Renderer mit dem Raumschiff mitbewegt wird. Durchsichtige Bereiche lassen Klicks durch.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const WINDOW_SIZE = 300;          // Fenstergröße in DIP (das Raumschiff sitzt immer in der Mitte)
const CURSOR_INTERVAL = 16;       // so oft (ms) bekommt der Renderer die Mausposition

let win, tray, cursorTimer;

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-webgpu');

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    win = new BrowserWindow({
        width: WINDOW_SIZE,
        height: WINDOW_SIZE,
        x: Math.round(workArea.x + workArea.width * 0.3),
        y: workArea.y + workArea.height - WINDOW_SIZE,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        // darf über den unteren Bildschirmrand hinausragen (Startplatz sitzt auf der Taskleiste)
        enableLargerThanScreen: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            backgroundThrottling: false
        }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile('index.html', process.env.RAUMSCHIFF_WEBGL ? { query: { webgl: '1' } } : undefined);

    // Der Mauszeiger ist das Angriffsziel -> häufiger abfragen als bei Glibber
    cursorTimer = setInterval(() => {
        if (win.isDestroyed()) return;
        win.webContents.send('cursor', screen.getCursorScreenPoint());
    }, CURSOR_INTERVAL);

    win.on('closed', () => { clearInterval(cursorTimer); win = null; });
}

function createTray() {
    // Kleine Rakete als Bitmap (BGRA), damit keine Bilddatei nötig ist
    const size = 16, buf = Buffer.alloc(size * size * 4);
    const set = (x, y, r, g, b) => {
        const i = (y * size + x) * 4;
        buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const half = y < 5 ? y * 0.6 : 3;                 // Spitze, dann Rumpf
            if (y < 13 && Math.abs(x - 7.5) <= half) set(x, y, y < 4 ? 232 : 240, y < 4 ? 56 : 236, y < 4 ? 79 : 225);
            if (y >= 9 && y < 14 && (x === 3 || x === 12)) set(x, y, 232, 56, 79);   // Flossen
            if (y >= 13 && Math.abs(x - 7.5) <= 1.5) set(x, y, 255, 170, 40);        // Flamme
        }
    }
    set(7, 6, 60, 220, 255); set(8, 6, 60, 220, 255); set(7, 7, 60, 220, 255); set(8, 7, 60, 220, 255);
    tray = new Tray(nativeImage.createFromBitmap(buf, { width: size, height: size }));
    tray.setToolTip('Raumschiff');
    tray.setContextMenu(buildMenu());
}

function buildMenu() {
    return Menu.buildFromTemplate([
        { label: 'Jetzt starten', click: () => send('command', 'launch') },
        { label: 'Zurück zur Basis', click: () => send('command', 'land') },
        { label: 'Startplatz hierher', click: () => send('command', 'home') },
        { type: 'separator' },
        {
            label: 'Mit Windows starten', type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
        },
        { label: 'Entwicklertools', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
        { type: 'separator' },
        { label: 'Beenden', click: () => app.quit() }
    ]);
}

function send(channel, value) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

// --- Schnittstelle zum Renderer ---------------------------------------------
ipcMain.on('move', (_e, x, y) => {
    if (!win) return;
    // setBounds statt setPosition: verhindert unter Windows das Wachsen des Fensters bei Skalierung ≠ 100 %
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: WINDOW_SIZE, height: WINDOW_SIZE });
});

ipcMain.on('ignore-mouse', (_e, ignore) => {
    win?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('context-menu', () => {
    buildMenu().popup({ window: win });
});

ipcMain.handle('info', () => {
    const [x, y] = win.getPosition();
    return { x, y, size: WINDOW_SIZE };
});

ipcMain.handle('work-area', (_e, x, y) => {
    return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
});

ipcMain.handle('displays', () => screen.getAllDisplays().map((d) => d.workArea));

app.on('second-instance', () => send('command', 'land'));
app.whenReady().then(() => {
    createWindow();
    createTray();
    screen.on('display-metrics-changed', () => send('command', 'displays'));
    screen.on('display-added', () => send('command', 'displays'));
    screen.on('display-removed', () => send('command', 'displays'));
});
app.on('window-all-closed', () => app.quit());
