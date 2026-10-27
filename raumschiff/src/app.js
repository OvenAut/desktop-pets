// Verhalten des Raumschiffs: wartet unsichtbar im Hangar (Fenster 1 × 1 Pixel) und lädt. Steht der
// Mauszeiger lange still, fährt es auf einem Lift von unten herauf, startet, jagt und beschießt den
// Mauszeiger, fliegt bei leerem Akku zurück, landet auf dem Lift und fährt wieder hinunter.
import * as THREE from 'three/webgpu';
import { createScene, shipUniforms as U, SHIP_BOTTOM, NOSE } from './ship.js';

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
const VIEW_WIDTH = 5;             // sichtbare Breite in Welteinheiten (Schiff ≈ 2 lang)
const IDLE_TRIGGER = Number(params.get('idle')) || 5 * 60;   // so lange muss der Mauszeiger stillstehen (s)
const IDLE_TOLERANCE = 3;         // kleinere Bewegungen (Pixel) zählen nicht als Bewegung
const CHARGE_TIME = 15;           // Sekunden von leer bis voll (lädt im Hangar)
const LIFT_SPEED = 120;           // Pixel pro Sekunde
const LIFT_RISE = 45;             // so weit fährt der Lift über die Taskleiste hinaus (Pixel)
const FLIGHT_DRAIN = 0.025;       // Akkuverbrauch pro Sekunde im Flug
const SHOT_COST = 0.015;          // Akkuverbrauch pro Schuss
const RETURN_AT = 0.15;           // darunter fliegt es zurück zum Lift
const MAX_SPEED = 480;            // Pixel pro Sekunde
const ORBIT_RADIUS = 130;         // Abstand zum Mauszeiger beim Angriff
const FIRE_RANGE = 210;
const LASER_SPEED = 900;
const BURST = 3;                  // Schüsse pro Salve
const BURST_GAP = 0.12;
const BURST_PAUSE = 0.9;
const TURN_RATE = 6;              // Drehgeschwindigkeit (rad/s)
const LIFT_VIEW_OFFSET = 90;      // bei Lift-Szenen sitzt das Schiff höher im Fenster, damit der Lift zu sehen ist

// ---------------------------------------------------------------------------
// Host: Electron (über preload.cjs) oder – zum Ausprobieren – ein normaler Browser
// ---------------------------------------------------------------------------
const host = window.petHost ?? createBrowserHost();
const info = await host.info();
const SIZE = info.size;
const PX = SIZE / VIEW_WIDTH;     // Pixel pro Welteinheit

function createBrowserHost() {
    // Im Browser ist das Seitenfenster der "Bildschirm" (unten 40 px "Taskleiste")
    const size = 300, taskbar = 40;
    let cursorFn = () => {};
    let commandFn = () => {};
    const bounds = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    const area = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight - taskbar });
    const canvas = () => document.querySelector('canvas');
    addEventListener('pointermove', (e) => cursorFn({ x: e.clientX, y: e.clientY }));
    addEventListener('keydown', (e) => {
        const map = { l: 'launch', b: 'land' };
        if (map[e.key]) commandFn(map[e.key]);
    });
    document.body.style.background = 'linear-gradient(#5b6b88, #2b3242)';
    const bar = document.createElement('div');
    Object.assign(bar.style, { position: 'fixed', left: 0, right: 0, bottom: 0, height: `${taskbar}px`, background: '#1b1f29' });
    document.body.appendChild(bar);
    return {
        browser: true,
        info: async () => ({ x: 0, y: 0, size }),
        move: (x, y) => {
            const c = canvas();
            if (c) Object.assign(c.style, { display: 'block', left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
        },
        hide: () => { const c = canvas(); if (c) c.style.display = 'none'; },
        ignoreMouse: (ignore) => { const c = canvas(); if (c) c.style.pointerEvents = ignore ? 'none' : 'auto'; },
        contextMenu: () => {},
        workArea: async () => area(),
        displayBounds: async () => bounds(),
        displays: async () => [area()],
        onCursor: (fn) => { cursorFn = fn; },
        onCommand: (fn) => { commandFn = fn; }
    };
}

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------
// ?webgl in der Adresse (bzw. RAUMSCHIFF_WEBGL=1 beim Start) erzwingt WebGL 2, falls WebGPU zickt
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: params.has('webgl') });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
if (host.browser) Object.assign(renderer.domElement.style, { position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 1 });
document.body.appendChild(renderer.domElement);
await renderer.init();
console.log(`Raumschiff rendert mit ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'}`);

const scene = new THREE.Scene();
const half = VIEW_WIDTH / 2;
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
camera.position.set(0, 0, 10);

const fx = createScene();
const { freighter, lift: liftMesh } = fx;
scene.add(freighter.ship, liftMesh);

// ---------------------------------------------------------------------------
// Zustand (alles in Bildschirmpixeln)
// ---------------------------------------------------------------------------
let area = await host.workArea(0, 0);
let display = await host.displayBounds(0, 0);
let allAreas = await host.displays();
const groundY = () => area.y + area.height;                 // Oberkante Taskleiste
const liftTopY = () => groundY() - LIFT_RISE;               // hier hält der Lift oben
const hiddenY = () => display.y + display.height + 40;      // so tief ist der Lift samt Schiff verschwunden
const onLiftY = () => lift.y - SHIP_BOTTOM * PX;            // Schiffsmitte, wenn es auf der Plattform steht

const lift = { x: 0, y: 0 };
const ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, present: 0, bank: 0 };
const cursor = { x: 0, y: 0 };
const win = { x: NaN, y: NaN, offset: LIFT_VIEW_OFFSET };

let state = 'hidden';
let stateTime = 0;
let energy = 1;
let shotsLeft = BURST;
let shotTimer = 0;
let shake = 0;
let elapsed = 0;
let lastMoveAt = 0;            // Sekunden (Echtzeit), letzte echte Mausbewegung
let hovering = false;

const now = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Kurswinkel für eine Bildschirmrichtung (Bug = lokales +x, Bildschirm-y zeigt nach unten)
const headingTo = (dx, dy) => Math.atan2(-dy, dx);
const noseX = () => ship.x + Math.cos(ship.angle) * NOSE * PX;
const noseY = () => ship.y - Math.sin(ship.angle) * NOSE * PX;
const flying = () => ['launch', 'hunt', 'hit', 'return'].includes(state);

function setState(next) {
    state = next;
    stateTime = 0;
}

function hide() {
    setState('hidden');
    fx.clearEffects(scene);
    win.x = NaN; win.y = NaN;
    hovering = false;
    host.hide(area.x + area.width - 1, area.y + area.height - 1);
    lastMoveAt = now();            // erst nach erneutem Stillstand wieder ausrücken
}

async function deploy() {
    if (state !== 'hidden') return;
    setState('deploying');
    await refreshArea(cursor.x, cursor.y);
    // Lift seitlich neben dem Mauszeiger, damit man das Schiff hochfahren sieht
    const side = cursor.x > area.x + area.width / 2 ? -1 : 1;
    lift.x = THREE.MathUtils.clamp(cursor.x + side * 260, area.x + 170, area.x + area.width - 170);
    lift.y = hiddenY();
    Object.assign(ship, { x: lift.x, y: onLiftY(), vx: 0, vy: 0, angle: 0, spin: 0, present: 0, bank: 0 });
    win.offset = LIFT_VIEW_OFFSET;
    setState('liftUp');
}

function hit() {
    // Getroffen: trudelt, Akku fast leer, Rückflug
    setState('hit');
    ship.spin = 14;
    energy = Math.min(energy, RETURN_AT - 0.02);
    fx.burst(ship.x, ship.y);
}

function steer(tx, ty, maxSpeed, dt, gain = 2.5) {
    let dvx = (tx - ship.x) * gain, dvy = (ty - ship.y) * gain;
    const len = Math.hypot(dvx, dvy);
    if (len > maxSpeed) { dvx *= maxSpeed / len; dvy *= maxSpeed / len; }
    const k = Math.min(1, 3 * dt);
    const ax = (dvx - ship.vx) * k, ay = (dvy - ship.vy) * k;
    ship.vx += ax; ship.vy += ay;
    return Math.hypot(ax, ay) / Math.max(dt, 1e-3);
}

function turnTowards(target, dt) {
    const diff = wrapAngle(target - ship.angle);
    const step = THREE.MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
    ship.angle += step;
    ship.bank = THREE.MathUtils.lerp(ship.bank, -step / Math.max(dt, 1e-3) * 0.12, 1 - Math.exp(-dt * 6));
    return Math.abs(diff);
}

function clampToScreens() {
    const left = Math.min(...allAreas.map((a) => a.x)) + 40;
    const right = Math.max(...allAreas.map((a) => a.x + a.width)) - 40;
    const top = Math.min(...allAreas.map((a) => a.y)) + 40;
    const bottom = groundY() - 60;
    ship.x = THREE.MathUtils.clamp(ship.x, left, right);
    ship.y = THREE.MathUtils.clamp(ship.y, top, bottom);
}

async function refreshArea(x = lift.x, y = groundY() - 10) {
    allAreas = await host.displays();
    area = await host.workArea(x, y);
    display = await host.displayBounds(x, y);
}

// ---------------------------------------------------------------------------
// Maus: Stillstand erkennen, Hover-Test (Klick-Durchlass), Klick = Treffer
// ---------------------------------------------------------------------------
const lastCursor = { x: NaN, y: NaN };
host.onCursor((p) => {
    cursor.x = p.x; cursor.y = p.y;
    if (!(Math.abs(p.x - lastCursor.x) <= IDLE_TOLERANCE && Math.abs(p.y - lastCursor.y) <= IDLE_TOLERANCE)) {
        lastCursor.x = p.x; lastCursor.y = p.y;
        lastMoveAt = now();
    }
    if (state === 'hidden' || state === 'deploying') return;
    const over = Math.hypot(p.x - ship.x, p.y - ship.y) < 0.75 * PX;
    if (over !== hovering) {
        hovering = over;
        host.ignoreMouse(!over);
    }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (flying() && state !== 'hit') hit();
    else shake = 0.4;                          // auf dem Lift: nur Wackeln
});
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); host.contextMenu(); });

host.onCommand((cmd) => {
    if (cmd === 'launch') deploy();
    if (cmd === 'land' && (state === 'hunt' || state === 'launch')) setState('return');
    if (cmd === 'displays') refreshArea();
});

// ---------------------------------------------------------------------------
// Bild für Bild
// ---------------------------------------------------------------------------
function update(dt) {
    elapsed += dt;
    stateTime += dt;
    let thrust = 0;
    let present = 1;              // 0 = Seitenansicht (auf dem Lift), 1 = Draufsicht (im Flug)
    let flicker = energy < 0.25 ? 0.6 : 0;
    let offset = 0;
    let liftTarget = hiddenY();   // wo der Lift hinfahren soll
    let liftFollow = false;       // Schiff steht auf dem Lift und fährt mit

    switch (state) {
        case 'hidden':
        case 'deploying': return;    // Hangar läuft über den Timer unten
        case 'liftUp': {
            // von unten über die Taskleiste herauffahren
            liftTarget = liftTopY();
            liftFollow = true;
            present = 0; offset = LIFT_VIEW_OFFSET; flicker = 0;
            if (Math.abs(lift.y - liftTopY()) < 0.5) setState('ready');
            break;
        }
        case 'ready': {
            // Triebwerke warmlaufen lassen
            liftTarget = liftTopY();
            liftFollow = true;
            present = 0; offset = LIFT_VIEW_OFFSET;
            thrust = Math.min(0.45, stateTime * 0.4) * (0.8 + Math.random() * 0.2);
            if (stateTime > 1.5) {
                setState('launch');
                for (let i = 0; i < 10; i++) {
                    const s = i % 2 ? 1 : -1;
                    fx.spawn('smoke', lift.x + s * rand(20, 60), lift.y - 4, s * rand(60, 170), rand(-25, 0), rand(0.35, 0.6), rand(0.8, 1.3));
                }
            }
            break;
        }
        case 'launch': {
            // senkrecht hoch, dabei vom Seitenprofil in die Draufsicht kippen
            liftTarget = stateTime > 0.6 ? hiddenY() : liftTopY();
            thrust = 1;
            ship.vy = Math.max(ship.vy - 600 * dt, -420);
            ship.vx = 0;
            present = THREE.MathUtils.clamp((stateTime - 0.2) / 0.8, 0, 1);
            offset = LIFT_VIEW_OFFSET * (1 - present);
            if (present > 0.5) turnTowards(Math.PI / 2, dt);
            if (stateTime > 1.3) setState(energy < RETURN_AT ? 'return' : 'hunt');
            break;
        }
        case 'hunt': {
            // umkreist den Mauszeiger, bevorzugt von oben, und feuert Salven
            const a = -Math.PI / 2 + Math.sin(elapsed * 0.6) * 1.2;
            const accel = steer(cursor.x + Math.cos(a) * ORBIT_RADIUS, cursor.y + Math.sin(a) * ORBIT_RADIUS, MAX_SPEED, dt);
            thrust = THREE.MathUtils.clamp(0.4 + accel / 1500, 0.4, 1);

            const dist = Math.hypot(cursor.x - ship.x, cursor.y - ship.y);
            const speed = Math.hypot(ship.vx, ship.vy);
            const aim = dist < FIRE_RANGE + 80 || speed < 30
                ? headingTo(cursor.x - ship.x, cursor.y - ship.y)
                : headingTo(ship.vx, ship.vy);
            const off = turnTowards(aim, dt);

            shotTimer -= dt;
            if (dist < FIRE_RANGE && off < 0.25 && shotTimer <= 0) {
                fx.fireLaser(noseX(), noseY(), cursor.x, cursor.y, LASER_SPEED, (x, y) => fx.burst(x, y));
                energy -= SHOT_COST;
                shotsLeft--;
                shotTimer = shotsLeft > 0 ? BURST_GAP : BURST_PAUSE;
                if (shotsLeft <= 0) shotsLeft = BURST;
            }
            energy -= FLIGHT_DRAIN * dt;
            if (energy < RETURN_AT) setState('return');
            break;
        }
        case 'hit': {
            ship.spin *= Math.exp(-dt * 1.5);
            ship.angle += ship.spin * dt;
            ship.vx *= Math.exp(-dt * 2);
            ship.vy = ship.vy * Math.exp(-dt * 2) + 120 * dt;
            thrust = Math.random() < 0.5 ? 0.3 : 0;
            flicker = 1;
            if (Math.random() < dt * 25) fx.spawn('smoke', ship.x, ship.y, rand(-30, 30), rand(-40, 0), rand(0.25, 0.45), rand(0.6, 1));
            if (stateTime > 1.4) setState('return');
            break;
        }
        case 'return': {
            // zurück über die Lift-Stelle; kurz davor ins Seitenprofil kippen
            const tx = lift.x, ty = liftTopY() - 130;
            const accel = steer(tx, ty, MAX_SPEED * 0.6, dt, 1.8);
            thrust = THREE.MathUtils.clamp(0.4 + accel / 1500, 0.4, 0.8);
            const dist = Math.hypot(tx - ship.x, ty - ship.y);
            const speed = Math.hypot(ship.vx, ship.vy);
            const near = THREE.MathUtils.clamp(1 - (dist - 40) / 220, 0, 1);
            present = 1 - near;
            offset = LIFT_VIEW_OFFSET * near;
            turnTowards(near > 0.3 || speed < 60 ? 0 : headingTo(ship.vx, ship.vy), dt);
            energy = Math.max(0.02, energy - FLIGHT_DRAIN * 0.3 * dt);
            if (dist < 12 && speed < 60) setState('liftCall');
            break;
        }
        case 'liftCall': {
            // schwebt, bis der Lift wieder oben ist
            ship.vx = 0; ship.vy = 0;
            ship.y = liftTopY() - 130 + Math.sin(elapsed * 3) * 3;
            ship.x = THREE.MathUtils.lerp(ship.x, lift.x, 1 - Math.exp(-dt * 4));
            turnTowards(0, dt);
            liftTarget = liftTopY();
            present = 0; offset = LIFT_VIEW_OFFSET; thrust = 0.4;
            if (Math.abs(lift.y - liftTopY()) < 0.5) setState('landing');
            break;
        }
        case 'landing': {
            // sanft auf die Plattform absetzen
            turnTowards(0, dt);
            liftTarget = liftTopY();
            present = 0; offset = LIFT_VIEW_OFFSET; thrust = 0.35;
            ship.vx = 0;
            ship.x = THREE.MathUtils.lerp(ship.x, lift.x, 1 - Math.exp(-dt * 5));
            ship.vy = THREE.MathUtils.clamp((onLiftY() - ship.y) * 2.2, 20, 200);
            if (onLiftY() - ship.y < 1) {
                ship.y = onLiftY();
                ship.vy = 0;
                shake = 0.25;
                for (let i = 0; i < 8; i++) {
                    const s = i % 2 ? 1 : -1;
                    fx.spawn('smoke', lift.x + s * rand(20, 50), lift.y - 4, s * rand(40, 120), rand(-15, 0), rand(0.3, 0.5), rand(0.7, 1.1));
                }
                setState('liftDown');
            }
            break;
        }
        case 'liftDown': {
            // kurz durchatmen, dann mit dem Lift nach unten in den Hangar
            liftTarget = stateTime > 0.8 ? hiddenY() : liftTopY();
            liftFollow = true;
            present = 0; offset = LIFT_VIEW_OFFSET;
            if (lift.y >= hiddenY() - 0.5) { hide(); return; }
            break;
        }
    }

    // Lift fahren (sanft anfahren und abbremsen)
    const liftDelta = liftTarget - lift.y;
    lift.y += Math.sign(liftDelta) * Math.min(Math.abs(liftDelta), Math.min(LIFT_SPEED, 25 + Math.abs(liftDelta) * 1.5) * dt);

    if (liftFollow) {
        ship.x = lift.x; ship.y = onLiftY();
        ship.vx = 0; ship.vy = 0;
        turnTowards(0, dt);
    } else if (state !== 'liftCall') {
        ship.x += ship.vx * dt;
        ship.y += ship.vy * dt;
        if (state === 'hunt' || state === 'hit' || state === 'return') clampToScreens();
    }
    if (!flying()) ship.bank *= Math.exp(-dt * 6);

    // Fenster mitbewegen (ganze Pixel), Szene relativ zur echten Fenstermitte zeichnen
    win.offset = THREE.MathUtils.lerp(win.offset, offset, 1 - Math.exp(-dt * 6));
    const wx = Math.round(ship.x - SIZE / 2), wy = Math.round(ship.y + win.offset - SIZE / 2);
    if (wx !== win.x || wy !== win.y) { win.x = wx; win.y = wy; host.move(wx, wy); }
    const cx = win.x + SIZE / 2, cy = win.y + SIZE / 2;
    const toWorld = (sx, sy) => ({ x: (sx - cx) / PX, y: -(sy - cy) / PX });

    shake = Math.max(0, shake - dt);
    const s = toWorld(ship.x, ship.y);
    freighter.ship.position.set(s.x + Math.sin(elapsed * 60) * shake * 0.08, s.y, 0);
    freighter.ship.rotation.z = ship.angle;
    ship.present = THREE.MathUtils.lerp(ship.present, present, 1 - Math.exp(-dt * 8));
    freighter.hull.rotation.x = ship.present * Math.PI / 2 + THREE.MathUtils.clamp(ship.bank, -0.5, 0.5);
    freighter.update(dt);

    const l = toWorld(lift.x, lift.y);
    liftMesh.position.set(l.x, l.y, -1);
    liftMesh.visible = Math.abs(l.x) < half + 1.5 && l.y < half + 0.5;

    U.energy.value = Math.max(energy, 0);
    U.flicker.value = flicker;
    U.padCharge.value = energy;
    U.beacon.value = ['liftUp', 'ready', 'liftCall', 'liftDown'].includes(state) ? (Math.sin(elapsed * 9) > 0 ? 1 : 0) : 0;
    freighter.setThrust(THREE.MathUtils.lerp(U.thrust.value, thrust, 1 - Math.exp(-dt * 12)));

    fx.updateEffects(dt, scene, toWorld);
}

// Hangar: Laden und Stillstand prüfen über einen eigenen Timer, denn ein 1-Pixel-Fenster kann vom
// Betriebssystem als verdeckt gelten und bekommt dann womöglich keine Animationsbilder mehr.
let hangarTick = now();
setInterval(() => {
    const t = now(), dt = t - hangarTick;
    hangarTick = t;
    if (state !== 'hidden') return;
    energy = Math.min(1, energy + dt / CHARGE_TIME);
    if (energy >= 1 && t - lastMoveAt >= IDLE_TRIGGER) deploy();
}, 500);

const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((t) => {
    timer.update(t);
    update(Math.min(timer.getDelta(), 1 / 20));
    // im Hangar (1-Pixel-Fenster) nichts zeichnen
    if (state !== 'hidden' && state !== 'deploying') renderer.render(scene, camera);
});

// zum Ausprobieren in den Entwicklertools
window.raumschiff = {
    deploy, hit, uniforms: U,
    get state() { return state; },
    set energy(v) { energy = v; },
    get energy() { return energy; }
};
