// Rendert den Sprite-Atlas des TIE-Fighters in Chromium (Playwright) und speichert ihn unter assets/
// (tie.webp = Bilder, tie.js = Aufteilung und Kanonenpositionen).
//   node tools/render-sprites.mjs            (Playwright muss installiert sein: npm i -D playwright)
//   node tools/render-sprites.mjs --frame=256
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frame = process.argv.find((a) => a.startsWith('--frame='))?.split('=')[1] ?? '192';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

// kleiner Webserver, weil ES-Module nicht über file:// geladen werden
const server = http.createServer(async (req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, ok));
const url = `http://localhost:${server.address().port}/tools/render-sprites.html?webgl&frame=${frame}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log(m.text()));
page.on('pageerror', (e) => console.error('Fehler:', e.message));
await page.goto(url, { waitUntil: 'commit' });
await page.waitForFunction(() => window.result, null, { timeout: 600000 });
const { image, meta } = await page.evaluate(() => window.result);
await browser.close();
server.close();

await mkdir(path.join(root, 'assets'), { recursive: true });
await writeFile(path.join(root, 'assets/tie.webp'), Buffer.from(image.split(',')[1], 'base64'));
// als JS-Modul, weil fetch() von file:// in Electron nicht zuverlässig funktioniert
await writeFile(path.join(root, 'assets/tie.js'), `// automatisch erzeugt von tools/render-sprites.mjs\nexport default ${JSON.stringify(meta)};\n`);
console.log('gespeichert: assets/tie.webp, assets/tie.js');
