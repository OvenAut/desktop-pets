// Electron-Hauptprozess: durchsichtiges, rahmenloses Fenster, das immer im Vordergrund liegt
// und vom Renderer mit dem Raumschiff mitbewegt wird. Durchsichtige Bereiche lassen Klicks durch.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const WINDOW_SIZE = 300;          // Fenstergröße im Einsatz in DIP (das Raumschiff sitzt immer in der Mitte)
// Im Hangar ist das Fenster nur 1 × 1 Pixel groß und unsichtbar; erst für den Einsatz wird es groß.
const CURSOR_INTERVAL = 16;       // so oft (ms) bekommt der Renderer die Mausposition

let win, tray, cursorTimer;

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
// Das 1-Pixel-Fenster im Hangar soll nicht als "verdeckt" gelten und eingefroren werden
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    win = new BrowserWindow({
        width: 1,
        height: 1,
        x: workArea.x + workArea.width - 1,
        y: workArea.y + workArea.height - 1,
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
        // darf über den unteren Bildschirmrand hinausragen (der Lift kommt von unten herauf)
        enableLargerThanScreen: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            backgroundThrottling: false
        }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    // RAUMSCHIFF_WEBGL=1 erzwingt WebGL 2, RAUMSCHIFF_IDLE=10 verkürzt die Wartezeit (Sekunden) zum Testen
    const query = {};
    if (process.env.RAUMSCHIFF_WEBGL) query.webgl = '1';
    if (process.env.RAUMSCHIFF_IDLE) query.idle = process.env.RAUMSCHIFF_IDLE;
    win.loadFile('index.html', { query });

    // Der Mauszeiger ist das Angriffsziel (und sein Stillstand der Auslöser) -> häufig abfragen
    cursorTimer = setInterval(() => {
        if (win.isDestroyed()) return;
        win.webContents.send('cursor', screen.getCursorScreenPoint());
    }, CURSOR_INTERVAL);

    win.on('closed', () => { clearInterval(cursorTimer); win = null; });
}

function createTray() {
    // Kleines Raumschiff als Bitmap (BGRA), damit keine Bilddatei nötig ist
    const size = 16, buf = Buffer.alloc(size * size * 4);
    const set = (x, y, r, g, b) => {
        const i = (y * size + x) * 4;
        buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - 7, dy = y - 7.5;
            if (dx * dx + dy * dy <= 30) set(x, y, 205, 208, 202);                 // Untertasse
            if (x >= 12 && (y === 5 || y === 6 || y === 9 || y === 10)) set(x, y, 160, 166, 158);   // Gabelbug
            if (dx * dx + dy * dy <= 30 && dx < -3 && Math.abs(dy) < 3.5) set(x, y, 95, 210, 255);  // Triebwerk
        }
    }
    set(7, 7, 60, 64, 75); set(7, 8, 60, 64, 75);
    set(11, 12, 63, 224, 255); set(12, 12, 63, 224, 255);   // Cockpit
    tray = new Tray(nativeImage.createFromBitmap(buf, { width: size, height: size }));
    tray.setToolTip('Raumschiff');
    tray.setContextMenu(buildMenu());
}

function buildMenu() {
    return Menu.buildFromTemplate([
        { label: 'Jetzt starten', click: () => send('command', 'launch') },
        { label: 'Zurück zur Basis', click: () => send('command', 'land') },
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

// Hangar: Fenster auf 1 × 1 Pixel schrumpfen
ipcMain.on('hide', (_e, x, y) => {
    if (!win) return;
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 });
    win.setIgnoreMouseEvents(true, { forward: true });
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

// ganzer Bildschirm (inkl. Taskleiste): unterhalb davon wartet der Lift
ipcMain.handle('display-bounds', (_e, x, y) => {
    return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).bounds;
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
