// Aussehen: flacher Untertassen-Frachter mit Gabelbug, Triebwerksbogen, Lift mit Plattform, Laser und
// Partikel – alle Materialien als TSL-Shader.
// Das Schiff liegt in der lokalen xz-Ebene (Oberseite = +y, Bug = +x). Auf dem Lift sieht man es von der
// Seite (flach), im Flug wird es um die Längsachse gekippt und von oben gezeigt.
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, float, vec2, vec3, mix, smoothstep, step, abs, max, length, normalize, dot, sin, atan,
    color, oneMinus, positionGeometry, normalView, positionViewDirection, time, mx_noise_float, uv,
    floor, fract, pow, hash
} from 'three/tsl';

export const SHIP_BOTTOM = 0.16;  // Abstand Mitte → Unterseite der Landestützen (Seitenansicht)
export const NOSE = 1.15;         // Abstand Mitte → Spitze des Gabelbugs (dort kommen die Laser raus)
export const PAD_HEIGHT = 0.16;

export const shipUniforms = {
    energy: uniform(1),           // 0 … 1 Akkustand
    thrust: uniform(0),           // 0 = aus, 1 = voller Schub
    flicker: uniform(0),          // Störung (wenig Energie, getroffen)
    padCharge: uniform(1),
    beacon: uniform(0)            // Warnlicht am Lift (0 … 1)
};

const cHull = color('#d9dbd6');
const cPanel = color('#a9aea8');
const cDark = color('#3a3f4b');
const cAccent = color('#c4473a');
const cEngine = color('#5fd2ff');
const cCyan = color('#3fe0ff');
const cWarn = color('#ff3b30');
const cLaser = color('#ff2d6f');
const cHazard = color('#ffc21a');

// Comic-Licht: zwei Helligkeitsstufen + Randlicht + harter Glanz
const LIGHT = normalize(vec3(-0.5, 0.7, 0.6));
function toon(base) {
    const band = smoothstep(-0.08, 0.08, dot(normalView, LIGHT)).mul(0.35).add(0.65);
    const rim = oneMinus(max(dot(normalView, positionViewDirection), 0)).pow(3).mul(0.3);
    const spec = smoothstep(0.96, 0.97, dot(normalView, normalize(LIGHT.add(positionViewDirection)))).mul(0.5);
    return base.mul(band).add(rim).add(spec);
}

function solidMaterial(c) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = toon(c);
    return m;
}

// Rumpf: Blechplatten in Sektoren und Ringen, jede Platte leicht anders getönt, rote Zierstreifen
function hullMaterial() {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
        const p = positionGeometry;
        const r = length(p.xz);
        const a = atan(p.z, p.x).div(Math.PI * 2).add(0.5);          // 0 … 1 rundherum
        const sectors = float(14);
        const ring = floor(r.mul(4.5));
        const sector = floor(a.mul(sectors));
        const tone = hash(sector.add(ring.mul(31))).mul(0.18);
        const base = mix(cHull, cPanel, tone.mul(4).clamp(0, 1).mul(0.5)).toVar();
        // Fugen zwischen den Platten
        const seamA = smoothstep(0.035, 0.0, abs(fract(a.mul(sectors)).sub(0.5)).sub(0.5).abs()).mul(step(0.3, r));
        const seamR = smoothstep(0.02, 0.0, abs(fract(r.mul(4.5)).sub(0.5)).sub(0.5).abs());
        base.assign(mix(base, cDark, max(seamA, seamR).mul(0.45)));
        // zwei rote Streifen auf der Oberseite, schräg nach vorn
        const stripe = step(0.45, r).mul(step(r, 0.75)).mul(step(0.0, p.y)).mul(
            max(step(abs(a.sub(0.62)), 0.012), step(abs(a.sub(0.38)), 0.012)));
        base.assign(mix(base, cAccent, stripe));
        return toon(base);
    })();
    return m;
}

// Cockpitglas: Farbe zeigt den Akku (cyan = voll, rot = leer), flackert bei Störung
function glassMaterial() {
    const u = shipUniforms;
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
        const glow = mix(cWarn, cCyan, smoothstep(0.1, 0.6, u.energy));
        const noise = mx_noise_float(vec2(time.mul(25), 0)).mul(0.5).add(0.5);
        const flick = mix(float(1), step(0.45, noise), u.flicker);
        const fres = oneMinus(max(dot(normalView, positionViewDirection), 0)).pow(2);
        return glow.mul(flick.mul(0.7)).add(fres.mul(0.4));
    })();
    return m;
}

// Triebwerksbogen am Heck: glimmt im Leerlauf, strahlt bei Schub
function engineMaterial() {
    const u = shipUniforms;
    const m = new THREE.MeshBasicNodeMaterial();
    const shimmer = mx_noise_float(vec2(uv().x.mul(30), time.mul(8))).mul(0.15);
    m.colorNode = mix(cDark, mix(cEngine, vec3(0.9, 1, 1), u.thrust.mul(0.6)), u.thrust.mul(0.8).add(0.2).add(shimmer));
    return m;
}

// Abgasschleier hinter dem Heck: Verlauf + Rauschen, Länge = Schub
function plumeMaterial() {
    const u = shipUniforms;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const t = oneMinus(uv().x);                        // 0 am Heck … 1 am Ende
    const across = abs(uv().y.sub(0.5)).mul(2);
    const n = mx_noise_float(vec2(uv().y.mul(8), t.mul(4).sub(time.mul(10)))).mul(0.5).add(0.5);
    m.colorNode = mix(vec3(0.9, 1, 1), cEngine, smoothstep(0.0, 0.5, t.add(across.mul(0.3))));
    m.opacityNode = pow(oneMinus(t), 1.5).mul(smoothstep(1.0, 0.4, across)).mul(n.mul(0.5).add(0.5))
        .mul(smoothstep(0.0, 0.2, u.thrust)).clamp(0, 1);
    return m;
}

function createFreighter() {
    const u = shipUniforms;
    const ship = new THREE.Group();   // Position + Kurs in der Bildebene (rotation.z)
    const hull = new THREE.Group();   // Kippen zwischen Seiten- und Draufsicht, Schräglage
    ship.add(hull);

    // flache Untertasse mit leicht gewölbter Oberseite
    const profile = [
        [0, -0.11], [0.62, -0.1], [0.82, -0.05], [0.86, 0.0], [0.8, 0.06],
        [0.55, 0.11], [0.25, 0.15], [0, 0.16]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    hull.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), hullMaterial()));

    const grey = solidMaterial(cPanel);
    const dark = solidMaterial(cDark);

    // Gabelbug: zwei Zinken mit Lücke dazwischen
    for (const s of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.2), grey);
        prong.position.set(0.86, 0, s * 0.2);
        hull.add(prong);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.21), dark);
        tip.position.set(NOSE - 0.02, 0, s * 0.2);
        hull.add(tip);
    }

    // seitlich versetztes Cockpit: Röhre mit Glaskuppel vorne
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.5, 20), grey);
    tube.rotation.z = Math.PI / 2;
    tube.rotation.y = -0.35;
    tube.position.set(0.48, 0.02, 0.72);
    hull.add(tube);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), glassMaterial());
    glass.position.set(0.72, 0.02, 0.81);
    hull.add(glass);

    // Radarschüssel oben, dreht sich
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 8, 0, Math.PI * 2, 0, 1.0), dark);
    dish.position.set(-0.1, 0.2, 0.32);
    dish.rotation.x = Math.PI;
    hull.add(dish);

    // Geschützkuppel in der Mitte, Laderampe-Andeutung unten
    const turret = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    turret.position.y = 0.14;
    hull.add(turret);

    // Landestützen (nur in der Seitenansicht zu sehen)
    for (const x of [-0.45, 0.35]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.08, 8), dark);
        leg.position.set(x, -SHIP_BOTTOM + 0.04, 0);
        hull.add(leg);
    }

    // Triebwerksbogen hinten
    const arc = 1.7;
    const engineGeometry = new THREE.TorusGeometry(0.82, 0.045, 8, 48, arc);
    engineGeometry.rotateX(Math.PI / 2);
    engineGeometry.rotateY(arc / 2 - Math.PI);
    hull.add(new THREE.Mesh(engineGeometry, engineMaterial()));

    // Abgas: eine liegende Fläche (Draufsicht) und eine stehende (Seitenansicht)
    const plume = plumeMaterial();
    const plumeTop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.3), plume);
    plumeTop.rotation.x = -Math.PI / 2;
    const plumeSide = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), plume);
    hull.add(plumeTop, plumeSide);

    const setThrust = (value) => {
        u.thrust.value = value;
        const len = 0.1 + value * 1.1;
        for (const m of [plumeTop, plumeSide]) {
            m.scale.x = len;
            m.position.x = -0.7 - len / 2;
            m.visible = value > 0.01;
        }
    };
    setThrust(0);

    const update = (dt) => { dish.rotation.y += dt * 2.5; };

    return { ship, hull, setThrust, update };
}

// Lift: Plattform (Oberkante = Ursprung) mit Ladebalken und Warnlichtern, darunter die Hubsäule
function createLift() {
    const u = shipUniforms;
    const lift = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.3, PAD_HEIGHT, 0.7), solidMaterial(color('#4a5263')));
    slab.position.y = -PAD_HEIGHT / 2;
    lift.add(slab);

    // Hubsäule mit Warnstreifen, reicht weit nach unten aus dem Fenster heraus
    const columnMaterial = new THREE.MeshBasicNodeMaterial();
    columnMaterial.colorNode = Fn(() => {
        const p = positionGeometry;
        const stripes = step(0.5, fract(p.x.add(p.y).mul(3)));
        return toon(mix(cDark, cHazard, stripes.mul(0.85)));
    })();
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8, 0.4), columnMaterial);
    column.position.y = -PAD_HEIGHT - 4;
    lift.add(column);
    for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 8, 0.08), solidMaterial(color('#6b7385')));
        rail.position.set(s * 0.75, -PAD_HEIGHT - 4, 0);
        lift.add(rail);
    }

    // Ladebalken an der Vorderkante (8 Zellen)
    const barMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const cells = 8;
    const q = uv();
    const cell = floor(q.x.mul(cells));
    const f = fract(q.x.mul(cells));
    const inCell = smoothstep(0.08, 0.16, f).mul(smoothstep(0.92, 0.84, f))
        .mul(smoothstep(0.15, 0.3, q.y)).mul(smoothstep(0.85, 0.7, q.y));
    const level = u.padCharge.mul(cells);
    const filled = step(cell.add(1), level.add(0.001));
    const active = step(cell, level).mul(oneMinus(filled));
    const blink = sin(time.mul(8)).mul(0.5).add(0.5);
    barMaterial.colorNode = mix(cWarn, color('#5dff7a'), cell.div(cells - 1));
    barMaterial.opacityNode = inCell.mul(max(filled, active.mul(blink)).mul(0.85).add(0.15));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.1), barMaterial);
    bar.position.set(0, -PAD_HEIGHT / 2, 0.36);
    lift.add(bar);

    // Rundumleuchten
    const lampMaterial = new THREE.MeshBasicNodeMaterial();
    lampMaterial.colorNode = mix(color('#5a3a10'), color('#ffb020'), u.beacon);
    for (const s of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lampMaterial);
        lamp.position.set(s * 1.05, 0.03, 0.2);
        lift.add(lamp);
    }
    return lift;
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
    const freighter = createFreighter();
    const lift = createLift();
    const laserGeo = new THREE.PlaneGeometry(1, 1);
    const laserMat = laserMaterial();
    const sprites = { spark: spriteMaterial('spark'), ring: spriteMaterial('ring'), smoke: spriteMaterial('smoke') };
    const effects = [];       // { obj, sx, sy, vx, vy, age, life, size, kind }

    // Laser fliegt in Bildschirmpixeln von (sx, sy) nach (tx, ty)
    function fireLaser(sx, sy, tx, ty, speed, onHit) {
        const obj = new THREE.Mesh(laserGeo, laserMat);
        const dist = Math.max(1, Math.hypot(tx - sx, ty - sy));
        effects.push({ obj, kind: 'laser', sx, sy, vx: (tx - sx) / dist * speed, vy: (ty - sy) / dist * speed, age: 0, life: dist / speed, onHit });
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

    function clearEffects(scene) {
        for (const e of effects) scene.remove(e.obj);
        effects.length = 0;
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

    return { freighter, lift, fireLaser, spawn, burst, updateEffects, clearEffects };
}
