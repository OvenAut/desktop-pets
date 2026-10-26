// Aussehen: Retro-Rakete, Triebwerksflamme, Startplatz mit Ladeanzeige, Laser und Partikel –
// alle Materialien als TSL-Shader.
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, float, vec2, vec3, mix, smoothstep, step, abs, max, length, normalize, dot, sin,
    color, oneMinus, positionLocal, positionGeometry, normalView, positionViewDirection, time,
    mx_noise_float, uv, floor, fract, pow
} from 'three/tsl';

export const SHIP_BOTTOM = 0.74;  // Abstand Mitte → Flossenspitzen (steht darauf)
export const PAD_HEIGHT = 0.2;

export const shipUniforms = {
    energy: uniform(1),           // 0 … 1 Akkustand
    thrust: uniform(0),           // 0 = aus, 1 = volle Flamme
    charging: uniform(0),         // 1 = steht auf dem Startplatz und lädt
    flicker: uniform(0),          // Störung (wenig Energie, getroffen)
    padCharge: uniform(1),
    padLights: uniform(0)
};

const cHull = color('#f1ede2');
const cRed = color('#e8384f');
const cDark = color('#3a3f4b');
const cCyan = color('#3fe0ff');
const cWarn = color('#ff3b30');
const cLaser = color('#ff2d6f');

// Comic-Licht: zwei Helligkeitsstufen + Randlicht
const LIGHT = normalize(vec3(-0.5, 0.7, 0.6));
function toon(base) {
    const band = smoothstep(-0.08, 0.08, dot(normalView, LIGHT)).mul(0.35).add(0.65);
    const rim = oneMinus(max(dot(normalView, positionViewDirection), 0)).pow(3).mul(0.35);
    const spec = smoothstep(0.96, 0.97, dot(normalView, normalize(LIGHT.add(positionViewDirection)))).mul(0.7);
    return base.mul(band).add(rim).add(spec);
}

function hullMaterial() {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
        const y = positionGeometry.y;
        const nose = step(0.36, y);
        const band = step(-0.44, y).mul(step(y, -0.34));
        const seam = smoothstep(0.012, 0.0, abs(y.sub(0.0)));     // Blechnaht
        const base = mix(mix(cHull, cRed, max(nose, band)), cDark, seam.mul(0.6));
        return toon(base);
    })();
    return m;
}

function solidMaterial(c) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = toon(c);
    return m;
}

// Bullauge: Farbe zeigt den Akku (cyan = voll, rot = leer), pulsiert beim Laden, flackert bei Störung
function glassMaterial() {
    const u = shipUniforms;
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
        const e = smoothstep(0.1, 0.6, u.energy);
        const glow = mix(cWarn, cCyan, e).toVar();
        const pulse = sin(time.mul(4)).mul(0.5).add(0.5).mul(u.charging).mul(0.5);
        const noise = mx_noise_float(vec2(time.mul(25), 0)).mul(0.5).add(0.5);
        const flick = mix(float(1), step(0.45, noise), u.flicker);
        const fres = oneMinus(max(dot(normalView, positionViewDirection), 0)).pow(2);
        const hl = smoothstep(0.93, 0.95, dot(normalView, normalize(vec3(-0.4, 0.5, 0.75))));
        return glow.mul(float(0.55).add(pulse).mul(flick)).add(fres.mul(0.4)).add(hl);
    })();
    return m;
}

// Flamme: nach unten zeigender Kegel, Farbverlauf + Rauschen, Länge = Schub
function flameMaterial() {
    const u = shipUniforms;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const t = uv().y;                                  // 0 an der Düse … 1 an der Spitze
    m.positionNode = Fn(() => {
        const p = positionLocal.toVar();
        p.x.addAssign(sin(time.mul(40).add(t.mul(9))).mul(0.04).mul(t));
        return p;
    })();
    const n = mx_noise_float(vec2(uv().x.mul(6), t.mul(5).sub(time.mul(14)))).mul(0.5).add(0.5);
    const heat = oneMinus(t).mul(0.8).add(n.mul(0.35));
    m.colorNode = mix(mix(color('#ff3d1f'), color('#ffb02e'), smoothstep(0.3, 0.7, heat)), vec3(1, 0.97, 0.85), smoothstep(0.8, 1.0, heat));
    m.opacityNode = pow(oneMinus(t), 1.3).mul(smoothstep(0.0, 0.15, u.thrust)).mul(n.mul(0.4).add(0.7)).clamp(0, 1);
    return m;
}

function createRocket() {
    const u = shipUniforms;
    const ship = new THREE.Group();   // Position + Ausrichtung in der Bildebene
    const hull = new THREE.Group();   // Rollen um die Längsachse, Trudeln
    ship.add(hull);

    const profile = [
        [0, -0.56], [0.2, -0.56], [0.33, -0.42], [0.37, -0.15], [0.36, 0.12],
        [0.3, 0.36], [0.18, 0.58], [0.06, 0.7], [0, 0.72]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    hull.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), hullMaterial()));

    // drei Flossen, dienen auch als Landebeine
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0.05);
    finShape.lineTo(0.28, -0.42);
    finShape.lineTo(0.3, -SHIP_BOTTOM);
    finShape.lineTo(0.18, -0.62);
    finShape.lineTo(0, -0.5);
    const finGeometry = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: false });
    finGeometry.translate(0.3, 0, -0.025);
    const finMaterial = solidMaterial(cRed);
    for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(finGeometry, finMaterial);
        fin.rotation.y = i * Math.PI * 2 / 3 + Math.PI / 2;
        hull.add(fin);
    }

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.12, 24), solidMaterial(cDark));
    nozzle.position.y = -0.6;
    hull.add(nozzle);

    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), glassMaterial());
    glass.position.set(0, 0.16, 0.3);
    glass.scale.z = 0.5;
    hull.add(glass);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 32), solidMaterial(cDark));
    frame.position.set(0, 0.16, 0.315);
    hull.add(frame);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1, 24, 1, true), flameMaterial());
    flame.rotation.x = Math.PI;
    hull.add(flame);
    const setThrust = (value) => {
        u.thrust.value = value;
        const len = 0.15 + value * 0.9;
        flame.scale.set(0.7 + value * 0.4, len, 0.7 + value * 0.4);
        flame.position.y = -0.64 - len / 2;
        flame.visible = value > 0.01;
    };
    setThrust(0);

    return { ship, hull, setThrust };
}

// Startplatz mit Ladebalken (8 Zellen) und zwei Blinklichtern
function createPad() {
    const u = shipUniforms;
    const pad = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.9, PAD_HEIGHT, 0.6), solidMaterial(color('#4a5263')));
    slab.position.y = PAD_HEIGHT / 2;
    pad.add(slab);

    const barMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const cells = 8;
    const q = uv();
    const cell = floor(q.x.mul(cells));
    const inCell = smoothstep(0.08, 0.16, fract(q.x.mul(cells))).mul(smoothstep(0.92, 0.84, fract(q.x.mul(cells))))
        .mul(smoothstep(0.15, 0.3, q.y)).mul(smoothstep(0.85, 0.7, q.y));
    const level = u.padCharge.mul(cells);
    const filled = step(cell.add(1), level.add(0.001));
    const active = step(cell, level).mul(oneMinus(filled));      // gerade ladende Zelle blinkt
    const blink = sin(time.mul(8)).mul(0.5).add(0.5);
    const cellColor = mix(cWarn, color('#5dff7a'), cell.div(cells - 1));
    barMaterial.colorNode = cellColor;
    barMaterial.opacityNode = inCell.mul(max(filled, active.mul(blink)).mul(0.85).add(0.15));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.12), barMaterial);
    bar.position.set(0, PAD_HEIGHT / 2, 0.31);
    pad.add(bar);

    const lampMaterial = new THREE.MeshBasicNodeMaterial();
    lampMaterial.colorNode = mix(color('#552222'), color('#ff6a4d'), u.padLights);
    for (const s of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), lampMaterial);
        lamp.position.set(s * 0.88, PAD_HEIGHT + 0.03, 0.2);
        pad.add(lamp);
    }
    return pad;
}

// ---------------------------------------------------------------------------
// Laser und Partikel; Positionen werden in Bildschirmpixeln geführt, damit sie
// am Bildschirm stehen bleiben, während das Fenster mit dem Schiff mitfliegt.
// ---------------------------------------------------------------------------
function laserMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const d = abs(uv().y.sub(0.5)).mul(2);
    const ends = smoothstep(0.0, 0.2, uv().x).mul(smoothstep(1.0, 0.6, uv().x));
    const core = smoothstep(0.35, 0.05, d);
    m.colorNode = mix(cLaser, vec3(1), core);
    m.opacityNode = max(core, smoothstep(1.0, 0.0, d).mul(0.6)).mul(ends);
    return m;
}

function spriteMaterial(kind) {
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const d = length(uv().sub(0.5)).mul(2);
    if (kind === 'spark') {
        m.colorNode = mix(vec3(1, 0.98, 0.8), color('#ff8a2a'), smoothstep(0.0, 0.6, d));
        m.opacityNode = smoothstep(1.0, 0.0, d).pow(1.5);
    } else if (kind === 'ring') {
        m.colorNode = color('#ffd166');
        m.opacityNode = smoothstep(0.12, 0.0, abs(d.sub(0.8)));
    } else {
        // Rauch: weiche, leicht ausgefranste Wolke
        const n = mx_noise_float(uv().mul(4)).mul(0.25);
        m.colorNode = color('#c9ccd4');
        m.opacityNode = smoothstep(1.0, 0.3, d.add(n)).mul(0.55);
    }
    return m;
}

export function createScene() {
    const rocket = createRocket();
    const pad = createPad();
    const laserGeo = new THREE.PlaneGeometry(1, 1);
    const laserMat = laserMaterial();
    const sprites = { spark: spriteMaterial('spark'), ring: spriteMaterial('ring'), smoke: spriteMaterial('smoke') };
    const effects = [];       // { obj, sx, sy, vx, vy, age, life, size, kind }

    // Laser fliegt in Bildschirmpixeln von (sx, sy) nach (tx, ty)
    function fireLaser(sx, sy, tx, ty, speed, onHit) {
        const obj = new THREE.Mesh(laserGeo, laserMat);
        const dist = Math.hypot(tx - sx, ty - sy);
        effects.push({ obj, kind: 'laser', sx, sy, vx: (tx - sx) / dist * speed, vy: (ty - sy) / dist * speed, age: 0, life: dist / speed, onHit });
        return obj;
    }

    function spawn(kind, sx, sy, vx = 0, vy = 0, size = 0.3, life = 0.6) {
        effects.push({ obj: new THREE.Sprite(sprites[kind]), kind, sx, sy, vx, vy, age: 0, life, size });
    }

    function burst(sx, sy) {
        spawn('ring', sx, sy, 0, 0, 0.9, 0.35);
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 220;
            spawn('spark', sx, sy, Math.cos(a) * v, Math.sin(a) * v, 0.12 + Math.random() * 0.12, 0.35 + Math.random() * 0.3);
        }
    }

    // toWorld rechnet Bildschirmpixel in Szenenkoordinaten des aktuellen Fensters um
    function updateEffects(dt, scene, toWorld) {
        for (let i = effects.length - 1; i >= 0; i--) {
            const e = effects[i];
            if (!e.obj.parent) scene.add(e.obj);
            e.age += dt;
            const t = e.age / e.life;
            if (t >= 1) {
                scene.remove(e.obj);
                effects.splice(i, 1);
                e.onHit?.(e.sx, e.sy);
                continue;
            }
            e.sx += e.vx * dt;
            e.sy += e.vy * dt;
            const w = toWorld(e.sx, e.sy);
            e.obj.position.set(w.x, w.y, 2);
            if (e.kind === 'laser') {
                e.obj.rotation.z = Math.atan2(-e.vy, e.vx);
                e.obj.scale.set(0.55, 0.1, 1);
            } else if (e.kind === 'ring') {
                e.obj.scale.setScalar(e.size * (0.2 + t));
            } else if (e.kind === 'smoke') {
                e.vx *= Math.exp(-dt * 2); e.vy *= Math.exp(-dt * 2);
                e.obj.scale.setScalar(e.size * (0.5 + t) * Math.min(1, (1 - t) * 3));
            } else {
                e.vy += 300 * dt;
                e.obj.scale.setScalar(e.size * (1 - t));
            }
        }
    }

    return { rocket, pad, fireLaser, spawn, burst, updateEffects };
}
