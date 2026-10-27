// Detailliertes TIE-Fighter-Modell zum Vorrendern der Sprites (wird zur Laufzeit nicht gebraucht).
// Achsen: Bug = +z, oben = +y, Flügel bei ±x. Materialien sind PBR-Node-Materialien mit TSL-Details
// (Plattenfugen als Bump, Solarzellen-Raster, Rauheit je Platte).
import * as THREE from 'three/webgpu';
import {
    Fn, float, mix, smoothstep, step, abs, max, length, atan, floor, fract, hash, cos, sin,
    color, positionGeometry, bumpMap, mx_noise_float
} from 'three/tsl';

export const BALL_RADIUS = 0.5;
export const WING_X = 1.38;       // Abstand Mitte → Flügel
export const WING_R = 1.9;        // Umkreisradius des Sechseck-Flügels (Spitzen oben/unten)
export const CANNON = new THREE.Vector3(0, -0.3, 0.62);   // Mündung der Bordkanonen (Mitte zwischen beiden)

const TAU = Math.PI * 2;

// Abstand eines Punkts zu einer Gitterlinie (0 auf der Linie, 0.5 dazwischen)
const lineDist = (v) => abs(fract(v).sub(0.5)).sub(0.5).abs();

// --- Cockpitkugel: Breiten- und Längenfugen, ein paar Wartungsklappen --------------------------
function hullMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.55, roughness: 0.5 });
    const p = positionGeometry.normalize();
    const lat = atan(p.y, length(p.xz)).div(Math.PI).add(0.5);          // 0 unten … 1 oben
    const lon = atan(p.x, p.z).div(TAU).add(0.5);                      // rundherum
    const front = smoothstep(0.62, 0.7, p.z);                          // Fensterbereich frei lassen
    const seams = Fn(() => {
        const rings = smoothstep(0.012, 0.0, lineDist(lat.mul(9)));
        const meridians = smoothstep(0.01, 0.0, lineDist(lon.mul(16))).mul(step(abs(p.y), 0.93));
        return max(rings, meridians).mul(front.oneMinus());
    })();
    const cell = hash(floor(lat.mul(9)).mul(37).add(floor(lon.mul(16))));
    const grime = mx_noise_float(positionGeometry.mul(9)).mul(0.5).add(0.5);
    m.colorNode = mix(color('#8d939c'), color('#6f7681'), cell.mul(0.6).add(grime.mul(0.4))).mul(seams.mul(0.45).oneMinus());
    m.roughnessNode = float(0.38).add(cell.mul(0.25)).add(grime.mul(0.1));
    m.normalNode = bumpMap(seams.oneMinus().mul(0.6).add(grime.mul(0.15)), 1.2);
    return m;
}

// --- Flügel: dunkle Solarzellen, Linien parallel zur jeweiligen Außenkante -------------------
function panelMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide });
    // Shape-Koordinaten: x = Bug-Richtung, y = oben
    const q = positionGeometry.xy;
    const a = atan(q.y, q.x);
    const k = floor(a.div(Math.PI / 3).add(0.5));                      // Segment (Kante bei 60°·k)
    const ang = k.mul(Math.PI / 3);
    const d = q.x.mul(cos(ang)).add(q.y.mul(sin(ang)));                // Abstand zur Mitte entlang der Kantennormale
    const along = q.x.mul(sin(ang).negate()).add(q.y.mul(cos(ang)));   // entlang der Kante
    const lines = smoothstep(0.018, 0.0, lineDist(d.mul(11)));
    const cross = smoothstep(0.015, 0.0, lineDist(along.mul(3.2))).mul(0.6);
    const grid = max(lines, cross);
    const cell = hash(floor(d.mul(11)).mul(13).add(floor(along.mul(3.2))).add(k.mul(97)));
    m.colorNode = mix(color('#1a1d24'), color('#2a2f3a'), cell.mul(0.7)).add(grid.mul(0.12));
    m.roughnessNode = float(0.32).add(cell.mul(0.3)).sub(grid.mul(0.1));
    m.normalNode = bumpMap(grid.oneMinus(), 0.8);
    return m;
}

function metal(c, rough = 0.45, metalness = 0.6) {
    const m = new THREE.MeshStandardNodeMaterial({ metalness, roughness: rough });
    const grime = mx_noise_float(positionGeometry.mul(14)).mul(0.5).add(0.5);
    m.colorNode = color(c).mul(grime.mul(0.15).add(0.9));
    m.roughnessNode = float(rough).add(grime.mul(0.12));
    return m;
}

function hexShape(r) {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + i * Math.PI / 3;           // Spitzen oben und unten
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
}

function createWing(side, mats) {
    // Flügel in seiner eigenen Ebene bauen (Shape-x = Bug, Shape-y = oben, Dicke entlang z),
    // dann so drehen, dass Shape-x → Modell-z und Dicke → Modell-x
    const wing = new THREE.Group();

    const frameShape = hexShape(WING_R);
    frameShape.holes.push(hexShape(WING_R - 0.12));
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, {
        depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 1
    }), mats.frame);
    frame.geometry.translate(0, 0, -0.04);
    wing.add(frame);

    // Solarfläche (zweiseitig, leicht vertieft gegenüber dem Rahmen)
    const panel = new THREE.Mesh(new THREE.ShapeGeometry(hexShape(WING_R - 0.1)), mats.panel);
    wing.add(panel);

    // Speichen von der Nabe zu den sechs Ecken, auf beiden Seiten aufgesetzt
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + i * Math.PI / 3;
        const len = WING_R - 0.3;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), mats.frame);
        spoke.position.set(Math.cos(a) * (0.25 + len / 2), Math.sin(a) * (0.25 + len / 2), 0);
        spoke.rotation.z = a;
        wing.add(spoke);
    }
    // Nabe mit Ringen
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 48), mats.frame);
    hub.rotation.x = Math.PI / 2;
    wing.add(hub);
    for (const z of [-0.09, 0.09]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 12, 48), mats.dark);
        ring.position.z = z;
        wing.add(ring);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 32), mats.dark);
        cap.rotation.x = Math.PI / 2;
        cap.position.z = z * 1.2;
        wing.add(cap);
    }

    wing.rotation.y = -Math.PI / 2;              // Shape-x → Modell-z, Shape-z → Modell-x
    wing.position.x = side * WING_X;
    return wing;
}

function createPylon(side, mats) {
    const pylon = new THREE.Group();
    const len = WING_X - 0.42;
    // facettierter Träger, zum Flügel hin breiter
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, len, 8), mats.hull);
    arm.rotation.z = side * Math.PI / 2;
    arm.position.x = side * (0.42 + len / 2);
    pylon.add(arm);
    // Gelenkring an der Kugel
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 40), mats.frame);
    collar.rotation.z = Math.PI / 2;
    collar.position.x = side * 0.46;
    pylon.add(collar);
    // Versteifung oben/unten (flache Platten)
    for (const y of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.03, 0.14), mats.frame);
        fin.position.set(side * (0.55 + len * 0.35), y * 0.12, 0);
        fin.rotation.z = side * y * -0.12;
        pylon.add(fin);
    }
    return pylon;
}

export function createTie() {
    const mats = {
        hull: hullMaterial(),
        frame: metal('#7e858f', 0.42, 0.65),
        dark: metal('#34383f', 0.5, 0.5),
        panel: panelMaterial(),
        glass: new THREE.MeshPhysicalNodeMaterial({ color: '#0b1015', metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
        glow: new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3.0, 0.9, 0.35) })
    };
    const tie = new THREE.Group();

    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 128, 96), mats.hull);
    tie.add(ball);

    // Frontfenster: Rahmen, dunkles Glas, Nabe und acht Streben
    const wz = 0.39, wr = 0.29;
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(wr + 0.05, wr + 0.07, 0.1, 64, 1, true), mats.frame);
    flange.rotation.x = Math.PI / 2;
    flange.position.z = wz;
    tie.add(flange);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(wr + 0.03, 0.035, 16, 64), mats.frame);
    rim.position.z = wz + 0.05;
    tie.add(rim);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(wr + 0.02, 64), mats.glass);
    glass.position.z = wz + 0.01;
    tie.add(glass);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 24), mats.frame);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = wz + 0.05;
    tie.add(hub);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const strut = new THREE.Mesh(new THREE.BoxGeometry(wr - 0.04, 0.022, 0.03), mats.frame);
        strut.position.set(Math.cos(a) * (0.05 + (wr - 0.04) / 2), Math.sin(a) * (0.05 + (wr - 0.04) / 2), wz + 0.045);
        strut.rotation.z = a;
        tie.add(strut);
    }

    // Bordkanonen unter dem Fenster
    for (const s of [-1, 1]) {
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.26, 16), mats.dark);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(s * 0.1, CANNON.y, CANNON.z - 0.13);
        tie.add(gun);
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 16), mats.frame);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position.set(s * 0.1, CANNON.y, CANNON.z - 0.01);
        tie.add(muzzle);
    }

    // Einstiegsluke oben, Triebwerksauslässe hinten
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.06, 40), mats.frame);
    hatch.position.y = 0.48;
    tie.add(hatch);
    const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 8, 40), mats.dark);
    hatchRing.rotation.x = Math.PI / 2;
    hatchRing.position.y = 0.515;
    tie.add(hatchRing);
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 40), mats.dark);
    rear.rotation.x = Math.PI / 2;
    rear.position.z = -0.46;
    tie.add(rear);
    for (const s of [-1, 1]) {
        const port = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), mats.glow);
        port.rotation.y = Math.PI;
        port.position.set(s * 0.1, 0, -0.505);
        tie.add(port);
    }

    for (const s of [-1, 1]) {
        tie.add(createPylon(s, mats));
        tie.add(createWing(s, mats));
    }

    tie.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return tie;
}
