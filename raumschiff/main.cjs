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
    // Kleiner TIE-Fighter als Bitmap (BGRA), damit keine Bilddatei nötig ist
    const size = 16, buf = Buffer.alloc(size * size * 4);
    const set = (x, y, r, g, b) => {
        const i = (y * size + x) * 4;
        buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    };
    // TIE von vorne: |o|
    for (let y = 1; y < 15; y++) { set(1, y, 170, 176, 186); set(2, y, 120, 126, 136); set(13, y, 120, 126, 136); set(14, y, 170, 176, 186); }
    for (let x = 3; x < 13; x++) set(x, 8, 150, 156, 166);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - 7.5, dy = y - 8;
            if (dx * dx + dy * dy <= 9) set(x, y, 185, 190, 198);
            if (dx * dx + dy * dy <= 2.5) set(x, y, 40, 46, 56);
        }
    }
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
