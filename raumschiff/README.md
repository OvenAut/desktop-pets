# Raumschiff – Desktop-Haustier für Windows

Ein TIE-Fighter, der unsichtbar in seinem Hangar unter dem Bildschirm wartet. Steht der Mauszeiger
**5 Minuten still**, fährt er auf einem **Lift von unten herauf**, startet, **jagt den Mauszeiger und
beschießt ihn mit grünen Lasern** – und muss bei leerem Akku zurück, auf dem Lift landen und wieder
hinunter in den Hangar zum Aufladen.

Der TIE ist ein **vorgerenderter Sprite**: ein detailliertes 3D-Modell (PBR-Materialien mit
TSL-Details: Plattenfugen, Solarzellen-Raster, Schatten, Umgebungslicht) wird einmal in allen nötigen
Lagen in einen Atlas gerendert – 48 Flugrichtungen × 3 Schräglagen für Kurven plus 16 Bilder für das
Abkippen aus der Frontansicht beim Start. Weil jede Richtung einzeln gerendert ist, kommt das Licht
immer von links oben. Zur Laufzeit wählt ein TSL-Shader nur noch das passende Bild aus; Lift, Laser,
Funken, Rauch, Ionen-Glühen und das rote Warnpulsen bei leerem Akku sind ebenfalls TSL.

## Ablauf

1. **Hangar** – das Fenster ist nur 1 × 1 Pixel groß und unsichtbar, es wird nichts gezeichnet;
   der Akku lädt (ca. 15 s von leer bis voll).
2. **Lift** – steht der Mauszeiger 5 Minuten still (und der Akku ist voll), wird das Fenster groß und
   der Lift fährt neben dem Mauszeiger mit Warnlichtern von unten über die Taskleiste herauf.
3. **Start** – Triebwerke laufen warm, er hebt ab und kippt dabei aus der Frontansicht in die Flugansicht.
4. **Angriff** – umkreist den Mauszeiger, dreht sich zu ihm, legt sich in die Kurven und feuert Salven
   aus je 3 Doppelschüssen. Fliegen und Schießen kosten Akku; wird er knapp, pulsiert er rot und flackert.
5. **Rückkehr** – unter 15 % fliegt er zurück, richtet sich auf, ruft den Lift, landet auf den Flügelspitzen und
   fährt hinunter. Danach ist das Fenster wieder 1 Pixel groß, bis der Mauszeiger erneut 5 Minuten stillsteht.

## Bedienung

| Aktion | Wirkung |
| --- | --- |
| Klick auf das fliegende Schiff | Treffer! Es trudelt, raucht und muss sofort zurück |
| Tray-Symbol / Rechtsklick auf das Schiff | Menü: Jetzt starten, Zurück zur Basis, Mit Windows starten, Beenden |

Die durchsichtigen Teile des Fensters lassen Mausklicks durch – man kann also weiterarbeiten,
während man beschossen wird. Nur das Schiff selbst ist anklickbar.

## Starten

```bash
cd desktop-pets/raumschiff
npm install
npm start
```

Ohne Electron zum Ausprobieren im Browser: `npx http-server -c-1 .` im Projektordner und
`index.html?idle=5` öffnen (Wartezeit 5 s; Tasten **L** sofort starten, **B** zurück zur Basis).

## Windows-Build

```bash
npm run dist
```

Erzeugt in `dist/` eine portable `.exe` und einen Installer (electron-builder).

## Hinweise

- Fällt WebGPU aus, mit `set RAUMSCHIFF_WEBGL=1` vor `npm start` WebGL 2 erzwingen; im Browser `index.html?webgl`.
- Zum Testen die Wartezeit verkürzen: `set RAUMSCHIFF_IDLE=10` (Sekunden) vor `npm start`.
- Einstellungen (Wartezeit, Ladezeit, Lift, Verbrauch, Geschwindigkeit, Salven) stehen oben in `src/app.js`.
- Aufbau: `main.cjs` (Fenster, Tray, Mausdurchlass), `preload.cjs` (IPC-Brücke),
  `src/ship.js` (Sprite, Lift, Effekte als TSL), `src/app.js` (Verhalten/Flug),
  `assets/tie.webp` + `assets/tie.js` (Sprite-Atlas und Aufteilung).

## Sprites neu rendern

Das Modell steht in `tools/tie-model.js`, Kamera, Licht und Bildauswahl in `tools/render-sprites.js`.
Nach Änderungen den Atlas neu erzeugen (braucht Playwright mit Chromium):

```bash
npm i -D playwright && npx playwright install chromium
npm run sprites                       # 192 px pro Bild
node tools/render-sprites.mjs --frame=256   # schärfer, größere Datei
```

Zum Anschauen im Browser: `tools/render-sprites.html?webgl` über einen lokalen Webserver öffnen.
