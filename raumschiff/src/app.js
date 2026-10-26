// Verhalten des Raumschiffs: auf dem Startplatz laden, starten, den Mauszeiger jagen und beschießen,
// bei leerem Akku zurückfliegen und landen. Das Fenster fliegt mit, das Schiff sitzt immer in der Mitte.
import * as THREE from 'three/webgpu';
import { createScene, shipUniforms as U, SHIP_BOTTOM, PAD_HEIGHT } from './ship.js';

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
const VIEW_WIDTH = 5;             // sichtbare Breite in Welteinheiten (Rakete ≈ 1,5 hoch)
const CHARGE_TIME = 15;           // Sekunden von leer bis voll
const LAUNCH_DELAY = [8, 40];     // so lange wartet es vollgeladen bis zum Start (Sekunden)
const FLIGHT_DRAIN = 0.025;       // Akkuverbrauch pro Sekunde im Flug
const SHOT_COST = 0.015;          // Akkuverbrauch pro Schuss
const RETURN_AT = 0.15;           // darunter fliegt es zurück zur Basis
const MAX_SPEED = 480;            // Pixel pro Sekunde
const ORBIT_RADIUS = 120;         // Abstand zum Mauszeiger beim Angriff
const FIRE_RANGE = 200;
const LASER_SPEED = 900;
const BURST = 3;                  // Schüsse pro Salve
const BURST_GAP = 0.12;
const BURST_PAUSE = 0.9;
const TURN_RATE = 7;              // Drehgeschwindigkeit (rad/s)

// ---------------------------------------------------------------------------
// Host: Electron (über preload.cjs) oder – zum Ausprobieren – ein normaler Browser
// ---------------------------------------------------------------------------
const host = window.petHost ?? createBrowserHost();
const info = await host.info();
const SIZE = info.size;
const PX = SIZE / VIEW_WIDTH;     // Pixel pro Welteinheit

function createBrowserHost() {
    // Im Browser ist das Seitenfenster der "Bildschirm" und die Zeichenfläche das Pet-Fenster
    const size = 300;
    let cursorFn = () => {};
    let commandFn = () => {};
    const area = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    addEventListener('pointermove', (e) => cursorFn({ x: e.clientX, y: e.clientY }));
    addEventListener('keydown', (e) => {
        const map = { l: 'launch', b: 'land', h: 'home' };
        if (map[e.key]) commandFn(map[e.key]);
    });
    document.body.style.background = 'linear-gradient(#5b6b88, #2b3242)';
    return {
        browser: true,
        info: async () => ({ x: innerWidth * 0.3 - size / 2, y: innerHeight - size, size }),
        move: (x, y) => {
            const c = document.querySelector('canvas');
            if (c) { c.style.left = `${Math.round(x)}px`; c.style.top = `${Math.round(y)}px`; }
        },
        ignoreMouse: (ignore) => {
            const c = document.querySelector('canvas');
            if (c) c.style.pointerEvents = ignore ? 'none' : 'auto';
        },
        contextMenu: () => {},
        workArea: async () => area(),
        displays: async () => [area()],
        onCursor: (fn) => { cursorFn = fn; },
        onCommand: (fn) => { commandFn = fn; }
    };
}

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------
// ?webgl in der Adresse (bzw. RAUMSCHIFF_WEBGL=1 beim Start) erzwingt WebGL 2, falls WebGPU zickt
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
if (host.browser) Object.assign(renderer.domElement.style, { position: 'absolute', left: '0px', top: '0px', pointerEvents: 'none' });
document.body.appendChild(renderer.domElement);
await renderer.init();
console.log(`Raumschiff rendert mit ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'}`);

const scene = new THREE.Scene();
const half = VIEW_WIDTH / 2;
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
camera.position.set(0, 0, 10);

const fx = createScene();
const { rocket, pad } = fx;
scene.add(rocket.ship, pad);

// ---------------------------------------------------------------------------
// Zustand (alles in Bildschirmpixeln)
// ---------------------------------------------------------------------------
let area = await host.workArea(info.x + SIZE / 2, info.y + SIZE / 2);
let allAreas = await host.displays();
const home = { x: info.x + SIZE / 2 };
const groundY = () => area.y + area.height;
const landedY = () => groundY() - (SHIP_BOTTOM + PAD_HEIGHT) * PX;

const ship = { x: home.x, y: landedY(), vx: 0, vy: 0, angle: 0, spin: 0 };
const cursor = { x: home.x, y: groundY() - 300 };
const win = { x: NaN, y: NaN };

let state = 'charging';
let stateTime = 0;
let energy = 0.6;
let launchAt = Infinity;
let relocate = false;          // nach dem Start direkt zum neuen Startplatz fliegen
let shotsLeft = BURST;
let shotTimer = 0;
let shake = 0;
let elapsed = 0;
let hovering = false;

const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Ausrichtung der Nase für eine Bildschirmrichtung (Nase = lokales +y, Bildschirm-y zeigt nach unten)
const headingTo = (dx, dy) => Math.atan2(-dx, -dy);
const noseX = () => ship.x - Math.sin(ship.angle) * 0.72 * PX;
const noseY = () => ship.y - Math.cos(ship.angle) * 0.72 * PX;

function setState(next) {
    state = next;
    stateTime = 0;
    if (next === 'charging') launchAt = Infinity;
}

function launch() {
    if (state !== 'charging') return;
    setState('launch');
    ship.vx = 0; ship.vy = 0;
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
    ship.angle += THREE.MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
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

async function refreshArea() {
    allAreas = await host.displays();
    area = await host.workArea(home.x, area.y + area.height - 10);
}

// ---------------------------------------------------------------------------
// Maus: Hover-Test (Klick-Durchlass), Klick = Treffer
// ---------------------------------------------------------------------------
host.onCursor((p) => {
    cursor.x = p.x; cursor.y = p.y;
    const over = Math.hypot(p.x - ship.x, p.y - ship.y) < 0.5 * PX;
    if (over !== hovering) {
        hovering = over;
        host.ignoreMouse(!over);
    }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (state === 'hunt' || state === 'launch' || state === 'return') hit();
    else if (state === 'charging' && energy >= 1) launch();
    else shake = 0.4;                         // beim Laden nicht stören!
});
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); host.contextMenu(); });

host.onCommand((cmd) => {
    if (cmd === 'launch') launch();
    if (cmd === 'land' && (state === 'hunt' || state === 'launch')) setState('return');
    if (cmd === 'displays') refreshArea();
    if (cmd === 'home') {
        host.workArea(cursor.x, cursor.y).then((a) => {
            area = a;
            home.x = THREE.MathUtils.clamp(cursor.x, a.x + SIZE / 2, a.x + a.width - SIZE / 2);
            if (state === 'charging') { relocate = true; launch(); }
            else if (state !== 'landing') setState('return');
        });
    }
});

// ---------------------------------------------------------------------------
// Bild für Bild
// ---------------------------------------------------------------------------
function update(dt) {
    elapsed += dt;
    stateTime += dt;
    let thrust = 0;
    let flicker = energy < 0.25 ? 0.6 : 0;

    switch (state) {
        case 'charging': {
            energy = Math.min(1, energy + dt / CHARGE_TIME);
            if (energy >= 1 && launchAt === Infinity) launchAt = elapsed + rand(...LAUNCH_DELAY);
            if (elapsed >= launchAt) launch();
            ship.x = home.x; ship.y = landedY();
            ship.vx = 0; ship.vy = 0;
            turnTowards(0, dt);
            flicker = 0;
            break;
        }
        case 'launch': {
            // senkrecht hoch, Rauch am Startplatz
            thrust = 1;
            ship.vy = Math.max(ship.vy - 700 * dt, -520);
            ship.x = THREE.MathUtils.lerp(ship.x, home.x, 0.2);
            turnTowards(0, dt);
            if (stateTime < 0.8 && Math.random() < dt * 30) {
                const s = Math.sign(Math.random() - 0.5);
                fx.spawn('smoke', home.x + s * rand(10, 40), groundY() - 6, s * rand(60, 160), rand(-20, 0), rand(0.35, 0.6), rand(0.8, 1.3));
            }
            if (ship.y < landedY() - 200) setState(relocate ? 'return' : 'hunt');
            break;
        }
        case 'hunt': {
            // umkreist den Mauszeiger, bevorzugt von oben, und feuert Salven
            const a = -Math.PI / 2 + Math.sin(elapsed * 0.6) * 1.2;
            const accel = steer(cursor.x + Math.cos(a) * ORBIT_RADIUS, cursor.y + Math.sin(a) * ORBIT_RADIUS, MAX_SPEED, dt);
            thrust = THREE.MathUtils.clamp(0.45 + accel / 1500, 0.45, 1);

            const dist = Math.hypot(cursor.x - ship.x, cursor.y - ship.y);
            const speed = Math.hypot(ship.vx, ship.vy);
            const aim = dist < FIRE_RANGE + 80 || speed < 30
                ? headingTo(cursor.x - ship.x, cursor.y - ship.y)
                : headingTo(ship.vx, ship.vy);
            const off = turnTowards(aim, dt);

            shotTimer -= dt;
            if (dist < FIRE_RANGE && off < 0.25 && shotTimer <= 0) {
                const tx = cursor.x, ty = cursor.y;
                fx.fireLaser(noseX(), noseY(), tx, ty, LASER_SPEED, (x, y) => fx.burst(x, y));
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
            // langsamer zurück über den Startplatz
            const tx = home.x, ty = landedY() - 150;
            const accel = steer(tx, ty, MAX_SPEED * 0.6, dt, 1.8);
            thrust = THREE.MathUtils.clamp(0.4 + accel / 1500, 0.4, 0.8);
            const speed = Math.hypot(ship.vx, ship.vy);
            turnTowards(speed > 60 ? headingTo(ship.vx, ship.vy) : 0, dt);
            energy = Math.max(0.02, energy - FLIGHT_DRAIN * 0.3 * dt);
            if (Math.hypot(tx - ship.x, ty - ship.y) < 15 && speed < 80) { relocate = false; setState('landing'); }
            break;
        }
        case 'landing': {
            // aufrichten und sanft absetzen
            turnTowards(0, dt);
            ship.vx = 0;
            ship.x = THREE.MathUtils.lerp(ship.x, home.x, 1 - Math.exp(-dt * 5));
            ship.vy = THREE.MathUtils.clamp((landedY() - ship.y) * 2.2, 25, 220);
            thrust = 0.35;
            if (landedY() - ship.y < 1) {
                ship.y = landedY();
                ship.vy = 0;
                shake = 0.25;
                for (let i = 0; i < 8; i++) {
                    const s = i % 2 ? 1 : -1;
                    fx.spawn('smoke', home.x + s * rand(10, 30), groundY() - 6, s * rand(40, 120), rand(-15, 0), rand(0.3, 0.5), rand(0.7, 1.1));
                }
                setState('charging');
            }
            break;
        }
    }

    if (state !== 'charging') {
        ship.x += ship.vx * dt;
        ship.y += ship.vy * dt;
        if (state === 'hunt' || state === 'hit' || state === 'return') clampToScreens();
    }

    // Fenster mitbewegen (ganze Pixel), Szene relativ zur echten Fenstermitte zeichnen
    const wx = Math.round(ship.x - SIZE / 2), wy = Math.round(ship.y - SIZE / 2);
    if (wx !== win.x || wy !== win.y) { win.x = wx; win.y = wy; host.move(wx, wy); }
    const cx = win.x + SIZE / 2, cy = win.y + SIZE / 2;
    const toWorld = (sx, sy) => ({ x: (sx - cx) / PX, y: -(sy - cy) / PX });

    shake = Math.max(0, shake - dt);
    const s = toWorld(ship.x, ship.y);
    rocket.ship.position.set(s.x + Math.sin(elapsed * 60) * shake * 0.08, s.y, 0);
    rocket.ship.rotation.z = ship.angle;
    // leichtes Rollen um die Längsachse zeigt die Flossen von verschiedenen Seiten
    const rollTarget = state === 'charging' ? 0 : Math.sin(elapsed * 1.7) * 0.7;
    rocket.hull.rotation.y = THREE.MathUtils.lerp(rocket.hull.rotation.y, rollTarget, 1 - Math.exp(-dt * 3));

    const p = toWorld(home.x, groundY());
    pad.position.set(p.x, p.y, -0.5);
    pad.visible = Math.abs(p.x) < half + 1 && Math.abs(p.y) < half + 1;

    U.energy.value = Math.max(energy, 0);
    U.charging.value = state === 'charging' && energy < 1 ? 1 : 0;
    U.flicker.value = flicker;
    U.padCharge.value = state === 'charging' ? energy : 0;
    U.padLights.value = state === 'charging' ? (Math.sin(elapsed * (energy >= 1 ? 6 : 2)) > 0 ? 1 : 0.15) : 0.15;
    rocket.setThrust(THREE.MathUtils.lerp(U.thrust.value, thrust, 1 - Math.exp(-dt * 12)));

    fx.updateEffects(dt, scene, toWorld);
}

const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((t) => {
    timer.update(t);
    update(Math.min(timer.getDelta(), 1 / 20));
    renderer.render(scene, camera);
});

// zum Ausprobieren in den Entwicklertools
window.raumschiff = {
    launch, hit, uniforms: U,
    get state() { return state; },
    set energy(v) { energy = v; },
    get energy() { return energy; }
};
