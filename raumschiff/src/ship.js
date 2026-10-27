// Aussehen: TIE-Fighter als vorgerendertes Sprite (Atlas aus tools/render-sprites.mjs), Lift mit Plattform,
// Laser und Partikel – alle Materialien als TSL-Shader.
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, float, vec2, vec3, mix, smoothstep, step, abs, max, length, normalize, dot, sin,
    color, oneMinus, positionGeometry, normalView, positionViewDirection, time, mx_noise_float, uv,
    floor, fract, texture
} from 'three/tsl';

import tieMeta from '../assets/tie.js';

export const SPRITE_SIZE = 2.3;   // Kantenlänge eines Sprite-Bildes in Welteinheiten
// Abstand Mitte → unterste Flügelspitze in der Frontansicht: darauf steht der TIE auf dem Lift
export const SHIP_BOTTOM = -tieMeta.standY * SPRITE_SIZE / 2;
export const PAD_HEIGHT = 0.16;

export const shipUniforms = {
    energy: uniform(1),           // 0 … 1 Akkustand (wenig: rotes Warnpulsen)
    thrust: uniform(0),           // 0 = aus, 1 = voller Schub (Ionen-Glühen)
    flicker: uniform(0),          // Störung (wenig Energie, getroffen)
    padCharge: uniform(1),
    beacon: uniform(0)            // Warnlicht am Lift (0 … 1)
};

const cDark = color('#3a3f4b');
const cWarn = color('#ff3b30');
const cLaser = color('#3dff5a');                // TIE-Laser sind grün
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

// TIE-Fighter als Sprite: ein Quad, dessen Bildausschnitt aus dem vorgerenderten Atlas
// (tools/render-sprites.mjs) gewählt wird. Flackern und Warnpulsen kommen per TSL dazu.
function createTieSprite(atlas, meta) {
    const u = shipUniforms;
    const frameOffset = uniform(new THREE.Vector2());
    const cell = vec2(1 / meta.cols, 1 / meta.rows);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const sample = texture(atlas, uv().mul(cell).add(frameOffset));
    const noise = mx_noise_float(vec2(time.mul(25), 0)).mul(0.5).add(0.5);
    const flick = mix(float(1), step(0.4, noise).mul(0.5).add(0.5), u.flicker);
    const warn = oneMinus(smoothstep(0.1, 0.3, u.energy)).mul(sin(time.mul(10)).mul(0.5).add(0.5));
    material.colorNode = mix(sample.rgb, sample.rgb.mul(vec3(1.6, 0.5, 0.4)), warn.mul(0.6)).mul(flick);
    material.opacityNode = sample.a;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE), material);
    const ship = new THREE.Group();
    ship.add(mesh);

    // Ionen-Glühen hinter der Kugel, Stärke = Schub
    const glowMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const d = length(uv().sub(0.5)).mul(2);
    glowMaterial.colorNode = mix(vec3(1, 0.9, 0.7), color('#ff6a2a'), smoothstep(0.0, 0.7, d));
    glowMaterial.opacityNode = smoothstep(1.0, 0.0, d).pow(2).mul(u.thrust).mul(0.9);
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.setScalar(0.45);
    glow.position.z = -0.1;
    ship.add(glow);

    const frameOf = (index) => {
        frameOffset.value.set((index % meta.cols) / meta.cols, 1 - (Math.floor(index / meta.cols) + 1) / meta.rows);
    };

    // heading: Bugrichtung (rad, gegen den Uhrzeigersinn ab rechts), bank: -1/0/1, present: 0 = Frontansicht … 1 = Flug
    let current = 0;
    function pose(heading, bank, present) {
        const step = Math.PI * 2 / meta.headings;
        let index, rest;
        if (present < 0.98) {
            index = meta.pitchStart + Math.round(THREE.MathUtils.clamp(present, 0, 1) * (meta.pitchFrames - 1));
            rest = heading - Math.PI / 2;               // Startsequenz endet mit dem Bug nach oben
        } else {
            const h = Math.round(heading / step);
            index = (bank + 1) * meta.headings + ((h % meta.headings) + meta.headings) % meta.headings;
            rest = heading - h * step;                  // Rest bis zum nächsten Bild: Quad minimal drehen
        }
        current = index;
        frameOf(index);
        mesh.rotation.z = rest;
        // Glühen gegenüber dem Bug, in der Frontansicht verdeckt
        glow.position.x = -Math.cos(heading) * 0.12;
        glow.position.y = -Math.sin(heading) * 0.12;
        glow.visible = present > 0.5;
    }

    // Mündung der Kanonen im aktuellen Bild (Welteinheiten relativ zur Schiffsmitte)
    function cannon() {
        const [x, y] = meta.cannons[current];
        const c = Math.cos(mesh.rotation.z), s = Math.sin(mesh.rotation.z);
        const r = SPRITE_SIZE / 2;
        return { x: (x * c - y * s) * r, y: (x * s + y * c) * r };
    }

    return { ship, pose, cannon };
}

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

export async function createScene() {
    const atlas = await new THREE.TextureLoader().loadAsync(new URL('../assets/tie.webp', import.meta.url).href);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    const tie = createTieSprite(atlas, tieMeta);
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

    return { tie, lift, fireLaser, spawn, burst, updateEffects, clearEffects };
}
