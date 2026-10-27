// Rendert den TIE-Fighter in allen Lagen, die das Pet braucht, in einen Sprite-Atlas.
// Licht kommt immer von links oben – deshalb wird jede Flugrichtung einzeln gerendert
// statt ein Bild zu drehen.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTie, CANNON, WING_R } from './tie-model.js';

const params = new URLSearchParams(location.search);
export const FRAME = Number(params.get('frame')) || 192;   // Kantenlänge eines Bildes im Atlas (Pixel)
const SUPERSAMPLE = 2;                                       // intern doppelt so groß rendern
const HALF = 2.45;                                           // halbe Bildbreite in Modelleinheiten
const HEADINGS = 48;                                         // Flugrichtungen (7,5°-Schritte)
const ROLLS = [8, 26, 46];                                   // Schräglage: Kurve links, gerade, Kurve rechts
const PITCH_FRAMES = 16;                                     // Frontansicht (Lift) → Flug nach oben

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: params.has('webgl') });
renderer.setPixelRatio(1);
renderer.setSize(FRAME * SUPERSAMPLE, FRAME * SUPERSAMPLE);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.1, 40);
camera.position.set(0, 0, 10);

// Hauptlicht links oben vorne (mit Schatten), kühles Randlicht von hinten rechts, schwaches Fülllicht
const key = new THREE.DirectionalLight('#fff4e6', 3.4);
key.position.set(-3, 4, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
const rim = new THREE.DirectionalLight('#a9c8ff', 2.2);
rim.position.set(4, 1.5, -4);
const fill = new THREE.DirectionalLight('#c8d0ff', 0.5);
fill.position.set(2, -3, 3);
scene.add(key, rim, fill);

const tie = createTie();
scene.add(tie);

// Ausrichtung aus Bug- und Oben-Richtung (Modell: Bug = +z, oben = +y, rechts = +x)
function orient(forward, up) {
    const f = forward.clone().normalize();
    const x = new THREE.Vector3().crossVectors(up, f).normalize();
    const u = new THREE.Vector3().crossVectors(f, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, u, f));
}

// Flugpose: Bug in der Bildebene unter dem Winkel h, um die Längsachse um roll gekippt
function flightPose(h, rollDeg) {
    const f = new THREE.Vector3(Math.cos(h), Math.sin(h), 0);
    const toCam = new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3().crossVectors(f, toCam);
    const r = THREE.MathUtils.degToRad(rollDeg);
    const up = toCam.multiplyScalar(Math.cos(r)).add(side.multiplyScalar(Math.sin(r)));
    return orient(f, up);
}

const poses = [];
for (const roll of ROLLS) {
    for (let i = 0; i < HEADINGS; i++) poses.push(flightPose(i / HEADINGS * Math.PI * 2, roll));
}
const front = orient(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
const launch = flightPose(Math.PI / 2, ROLLS[1]);
for (let i = 0; i < PITCH_FRAMES; i++) {
    const t = i / (PITCH_FRAMES - 1);
    const e = t * t * (3 - 2 * t);
    poses.push(front.clone().slerp(launch, e));
}

const cols = Math.ceil(Math.sqrt(poses.length));
const rows = Math.ceil(poses.length / cols);
const atlas = document.createElement('canvas');
atlas.width = cols * FRAME;
atlas.height = rows * FRAME;
const ctx = atlas.getContext('2d');
ctx.imageSmoothingQuality = 'high';

// Lage der Kanonenmündung je Bild (in Bild-Koordinaten -1 … 1), damit die Laser richtig austreten
const cannons = [];
for (let i = 0; i < poses.length; i++) {
    tie.quaternion.copy(poses[i]);
    tie.updateMatrixWorld(true);
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, (i % cols) * FRAME, Math.floor(i / cols) * FRAME, FRAME, FRAME);
    const c = CANNON.clone().applyQuaternion(poses[i]);
    cannons.push([+(c.x / HALF).toFixed(4), +(c.y / HALF).toFixed(4)]);
}

// Unterste Flügelspitze in der Frontansicht (Bild-Koordinaten) – darauf steht das Schiff auf dem Lift
const meta = {
    frame: FRAME, cols, rows, half: HALF,
    headings: HEADINGS, rolls: ROLLS, pitchFrames: PITCH_FRAMES,
    pitchStart: HEADINGS * ROLLS.length,
    standY: +(-WING_R / HALF).toFixed(4),
    cannons
};

window.result = { image: atlas.toDataURL('image/webp', 0.9), meta };
document.body.appendChild(atlas);
atlas.style.width = '100%';
console.log(`fertig: ${poses.length} Bilder, Atlas ${atlas.width}×${atlas.height}`);
